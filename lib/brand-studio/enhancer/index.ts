/**
 * Prompt enhancer (docs/BRAND-STUDIO-V2.md §8.1). Server-only: one Gemini call rewrites the
 * customer's words in the chosen model's own grammar. Any failure returns the deterministic fallback
 * with `source: 'fallback'`; this function never throws.
 *
 * The client-safe mention helpers live in `./mentions` (import that file directly from the browser).
 */
import { dictatedSpans, guardRequest, type GuardedRequest } from '@/lib/ai-guard';
import { foldText, wordUnits } from '@/lib/ai-guard/text';
import { loadDirectorPlaybooks, playbookRuleLines } from '@/lib/brand-studio/director/playbooks';
import { brandSeedanceRulesV2Open, promptGuardMode } from '@/lib/flags';
import { blueprintShape, blueprintShots, isBlueprint } from './blueprint';
import { composeFallbackPrompt } from './fallback';
import { hasMarkSign, replaceMarks } from './marks';
import { callGeminiJson, inlinePart, studioGeminiConfig, type GeminiPart } from './gemini';
import { AMBIENT_AUDIO_LINE, effectiveSeconds, keepPhrase, NATIVE_AUDIO_LINE, planShots, type PlannedShot } from './lines';
import { enhanceMeta } from './meta';
import {
  buildSystemInstruction,
  gptImageAllowPhrases,
  nanoBananaAllowPhrases,
  regionEditProfileAllowPhrases,
  seedanceAllowPhrases,
  seedreamAllowPhrases,
  skinAllowFor,
  skinVariantOf,
  taskAllowPhrases,
} from './profiles';
import { sleeveVolumeLine } from './profiles/seedance';
import { bindReferences, mapCustomerMentions, type Binding } from './references';
import { checkEnhancedPrompt, cleanNotes, ENHANCED_PROMPT_MAX, ENHANCER_RESPONSE_SCHEMA, EnhancerOutputSchema, exemptText, NOTES_MAX } from './schema';
import type { EnhanceDeps, EnhanceInput, EnhanceMeta, EnhanceResult } from './types';

export { enhanceMeta } from './meta';

export type { EnhanceDeps, EnhanceInput, EnhanceKind, EnhanceMark, EnhanceMaterial, EnhanceMeta, EnhanceReference, EnhanceResult, EnhanceRevision, EnhanceVideo } from './types';
export { CORE_VERSION, PROFILE_HEADERS, MODEL_BLOCKS, profileVersionOf, planSkin, skinVariantOf } from './profiles';
export { composeFallbackPrompt } from './fallback';
export {
  findMissingReferences,
  findReferenceMentions,
  listReferenceMentions,
  type MentionKind,
  type ReferenceMention,
} from './mentions';
export { seedanceReferenceMode, type SeedanceReferenceMode } from './references';
/** The output length a video prompt is written for; send the provider the same number. */
export { effectiveSeconds } from './lines';

export const THUMBS_MAX = 9;
const THUMB_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/**
 * 2026-11-19 eval: with pictures attached the writer took 17 s at the median and 8 of 45 calls ran past the
 * old 25 s, so they silently fell back. `BRAND_STUDIO_ENHANCER_TIMEOUT_MS` (10–90 s) overrides it.
 */
const ENHANCE_TIMEOUT_MS = 45_000;

function timeoutOf(env: Record<string, string | undefined>): number {
  const n = Number(env.BRAND_STUDIO_ENHANCER_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 10_000 && n <= 90_000 ? Math.round(n) : ENHANCE_TIMEOUT_MS;
}


const MODEL_NOTES = {
  ko: '장면과 참조 설명을 모델이 알아듣기 쉽게 구체적으로 다듬었어요.',
  en: 'Made the scene and the references more specific for the model.',
} as const;

function payload(input: EnhanceInput, binding: Binding, seconds: number | null, shots: PlannedShot[]) {
  const video = input.video;
  const revision = input.revision ?? null;
  // A reshoot's change note is already inside `revision.madeWith`; sending it again would apply it twice.
  const change = revision?.mode === 'reshoot' ? '' : (video?.change?.trim() ?? '');
  return {
    request: mapCustomerMentions(input.prompt.trim(), binding.bound),
    customerLanguage: input.locale,
    references: binding.bound
      .filter((b) => b.token || binding.seedanceMode === 'frames')
      .map((b) => ({
        token: b.token,
        name: b.token ? undefined : b.name,
        chip: b.ref.label,
        kind: b.ref.kind,
        role: b.ref.role ?? null,
        take: b.ref.use?.trim() || null,
        leaveOut: b.ref.avoid?.trim() || null,
        frame: b.ref.frame ?? null,
        visualAttached: Boolean(b.ref.thumb && b.ref.kind === 'image' && THUMB_MIMES.has(b.ref.thumb.mime)),
      })),
    editTarget: binding.editTarget,
    brand: input.brand
      ? {
          nameForContextOnly: input.brand.name ?? null,
          tone: input.brand.tone ?? null,
          palette: input.brand.palette ?? [],
          rules: input.brand.rules ?? [],
        }
      : null,
    video: video
      ? {
          seconds,
          audio: video.audio,
          method: video.method ?? null,
          keep: keepPhrase(video.keep) || null,
          change: change ? mapCustomerMentions(change, binding.bound) : null,
          reference: video.sheet
            ? {
                seconds: video.sheet.seconds,
                look: video.sheet.look,
                sound: video.sheet.audio,
                ...(video.sheet.subjects ? { subjects: video.sheet.subjects } : {}),
                ...(video.sheet.setting ? { setting: video.sheet.setting } : {}),
              }
            : null,
          shots: shots.length ? shots : null,
        }
      : null,
    revision: revision
      ? {
          mode: revision.mode,
          version: revision.version,
          madeWith: revision.madeWith,
          // A reshoot's earlier requests are numbered to this run's tray (lib/brand-studio/prepare.ts), so
          // their picture mentions become tokens like the request's. An edit's stay as written: they
          // named the pictures of their own run.
          history: revision.mode === 'reshoot' ? revision.history.map((h) => mapCustomerMentions(h, binding.bound)) : revision.history,
          // ①②③ in the request: what each spot is on and where (lib/brand-studio/enhancer/marks.ts).
          ...(revision.marks?.length
            ? {
                marks: revision.marks.map((m) => ({
                  n: m.n,
                  time: m.time,
                  what: m.what,
                  x: m.x,
                  y: m.y,
                  ...(m.w !== undefined && m.h !== undefined ? { w: m.w, h: m.h } : {}),
                })),
              }
            : {}),
          // What the attached material shows, already read for this request (revision/material.ts).
          ...(revision.materials?.length ? { materials: revision.materials.map((m) => ({ n: m.n, kind: m.kind, notes: m.notes })) } : {}),
          // What the customer answered when asked what the request meant: it outranks the request's wording.
          // Its picture mentions become tokens like the request's ("이미지 2처럼" -> the picture's token).
          ...(revision.clarified
            ? { clarified: { question: revision.clarified.question, answer: mapCustomerMentions(revision.clarified.answer, binding.bound) } }
            : {}),
          // Made from the revise conversation: the settled request and the run's exact length.
          ...(revision.sheet
            ? {
                sheet: {
                  change: revision.sheet.change.map((c) => mapCustomerMentions(c, binding.bound)),
                  keep: [...revision.sheet.keep],
                  exclude: [...revision.sheet.exclude],
                },
                seconds: revision.seconds ?? null,
              }
            : {}),
        }
      : null,
  };
}

/** The customer's words in a picture caption go through `guard.data` (unchanged with the guard off). */
function thumbParts(input: EnhanceInput, binding: Binding, guard: GuardedRequest): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const cropThumb = input.kind === 'region_edit' ? input.editCropThumb : null;
  const hasCrop = Boolean(cropThumb && THUMB_MIMES.has(cropThumb.mime));
  const wide = input.kind === 'region_edit' ? input.regionWindow : null;
  if (hasCrop && cropThumb) {
    const target = binding.editTarget ?? 'image 1';
    parts.push({
      text: wide
        ? `Picture of ${target} (the customer's picture as the editor receives it; the part to change is the boxed area in the ${wide.where}, ${wide.left}-${wide.right}% from the left and ${wide.top}-${wide.bottom}% from the top — keep everything else identical):`
        : `Picture of ${target} (the enlarged region crop cut out from the customer's photograph — keep its framing, scale, outer silhouette, contours and surrounding pixels identical):`,
    });
    parts.push(inlinePart(cropThumb.bytes, cropThumb.mime));
  }
  const closeUp = hasCrop && wide?.closeUp && THUMB_MIMES.has(wide.closeUp.mime) ? wide.closeUp : null;
  if (closeUp) {
    parts.push({ text: `Close-up of the boxed part of ${binding.editTarget ?? 'image 1'} (for your eyes only; the editor does not receive it, so never name it as a figure):` });
    parts.push(inlinePart(closeUp.bytes, closeUp.mime));
  }
  const maxRefThumbs = THUMBS_MAX + (hasCrop ? 1 : 0) + (closeUp ? 1 : 0);
  for (const b of binding.bound) {
    if (parts.length / 2 >= maxRefThumbs) break;
    const thumb = b.ref.thumb;
    if (!thumb || b.ref.kind !== 'image' || !THUMB_MIMES.has(thumb.mime)) continue;
    const name = b.token ?? b.name;
    const cues = [
      `the customer's "${guard.data('label', b.ref.label)}"`,
      b.ref.role ? `role: ${b.ref.role}` : 'role: infer from visual content and request',
      b.ref.use?.trim() ? `take: "${guard.data('take', b.ref.use.trim())}"` : null,
      b.ref.avoid?.trim() ? `leave out: "${guard.data('leave out', b.ref.avoid.trim())}"` : null,
    ]
      .filter(Boolean)
      .join(', ');
    parts.push({
      text: `Picture of ${name} (${cues} — inspect the actual pixels for concrete shape, material, surface finish, colours and light cues that serve the request):`,
    });
    parts.push(inlinePart(thumb.bytes, thumb.mime));
  }
  return parts;
}

/**
 * Our fixed lines that are meant to appear in a written prompt (the prompt guard's allow-list for this
 * writer): the lines `checkEnhancedPrompt` adds, every output phrase belonging to this request's active
 * profile / task / skin mode / switch state, `dictatedSpans(system)`, and this input's deterministic
 * fallback, which the customer reads whenever the writer fails anyway.
 */
export function enhancerAllow(
  input: EnhanceInput,
  binding: Binding,
  system: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
  let fallbackText = '';
  try {
    fallbackText = composeFallbackPrompt(input, { env }).prompt;
  } catch {
    fallbackText = '';
  }

  const profilePhrases: string[] = [];
  if (input.kind === 'region_edit') {
    profilePhrases.push('Do not move or resize anything else.', ...regionEditProfileAllowPhrases(input.profile));
  } else {
    switch (input.profile) {
      case 'seedream':
        profilePhrases.push(...seedreamAllowPhrases());
        break;
      case 'nano-banana':
        profilePhrases.push(...nanoBananaAllowPhrases());
        break;
      case 'gpt-image':
        profilePhrases.push(...gptImageAllowPhrases());
        break;
      case 'seedance':
        profilePhrases.push(...seedanceAllowPhrases(env));
        break;
    }
  }

  const skinPhrases = skinAllowFor(input, binding, skinVariantOf(input.model, env));
  const taskPhrases = taskAllowPhrases(input, binding);

  const seedanceRuntimeLines: string[] = [];
  if (input.profile === 'seedance') {
    if (input.video) {
      if (input.video.audio === 'ambient') seedanceRuntimeLines.push(AMBIENT_AUDIO_LINE);
      else if (input.video.audio === 'native') seedanceRuntimeLines.push(NATIVE_AUDIO_LINE);

      if (input.kind === 'video_remix' && input.video.method === 'edit') {
        seedanceRuntimeLines.push(`Everything else in ${ref} stays as it is.`);
      }
    }

    if (brandSeedanceRulesV2Open(env)) {
      for (const b of binding.bound) {
        if (b.token && b.ref.kind === 'image' && b.ref.role === 'person') {
          const spaced = b.token.replace(/^@Image(\d+)$/i, '@Image $1');
          seedanceRuntimeLines.push(sleeveVolumeLine(b.token), sleeveVolumeLine(spaced));
        }
      }
    }
  }

  return [
    ...new Set(
      [
        ...profilePhrases,
        ...taskPhrases,
        ...skinPhrases,
        ...seedanceRuntimeLines,
        ...dictatedSpans(system),
        fallbackText,
      ].filter((s) => s.length > 0 && wordUnits(foldText(s)).length >= 4),
    ),
  ];
}

export async function enhancePrompt(input: EnhanceInput, deps: EnhanceDeps): Promise<EnhanceResult> {
  const fallback = (reason: string): EnhanceResult => {
    try {
      deps.onFallback?.(reason);
    } catch {
      // a broken logger must not change the result
    }
    let meta: EnhanceMeta | undefined;
    try {
      meta = enhanceMeta(input, 'fallback', { fallbackReason: reason, env: deps.env });
    } catch {
      meta = undefined;
    }
    try {
      return { ...composeFallbackPrompt(input, { env: deps.env }), ...(meta ? { meta } : {}) };
    } catch {
      return { prompt: input.revision ? replaceMarks(input.prompt.trim(), []) : input.prompt.trim(), notes: '', source: 'fallback', ...(meta ? { meta } : {}) };
    }
  };
  try {
    const config = studioGeminiConfig(deps.env);
    if (!config) return fallback('no_key');
    // A blueprint with nothing to change is still a remake to write: the blueprint is the request.
    const blueprint = isBlueprint(input);
    if (!input.prompt.trim() && !input.video?.change?.trim() && !blueprint) return fallback('empty_prompt');
    const playbooks = deps.sql && deps.organizationId ? await loadDirectorPlaybooks(deps.sql, deps.organizationId) : [];
    const extraRules = playbookRuleLines(playbooks);
    const effectiveInput: EnhanceInput =
      extraRules.length > 0
        ? {
            ...input,
            brand: {
              ...(input.brand ?? {}),
              rules: [...(input.brand?.rules ?? []), ...extraRules].slice(0, 18),
            },
          }
        : input;
    const binding = bindReferences(effectiveInput);
    const seconds = effectiveSeconds(effectiveInput.kind, effectiveInput.video);
    const shots = blueprint
      ? blueprintShots(seconds, effectiveInput.video)
      : effectiveInput.kind === 'video_remix' && effectiveInput.video?.method !== 'edit'
        ? planShots(seconds, effectiveInput.video)
        : [];
    const skinVariant = skinVariantOf(effectiveInput.model, deps.env);
    // The prompt guard (lib/ai-guard, docs/PROMPT-GUARD.md): canary + one shared rule on the system part,
    // the customer's material in named data blocks. With PROMPT_GUARD=off the request is byte for byte as before.
    const guard = guardRequest({
      site: 'brand-studio.enhancer',
      env: deps.env,
      internal: buildSystemInstruction(effectiveInput, binding, seconds, shots, {
        skinVariant,
        env: deps.env,
        ...(promptGuardMode(deps.env) === 'off' ? {} : { shotsInUserTurn: true }),
      }),
    });
    const visualParts = thumbParts(effectiveInput, binding, guard);
    const hasVisualParts = visualParts.some((p) => 'inlineData' in p);
    const raw = await callGeminiJson(config, deps.fetch, {
      system: guard.system,
      parts: guard.parts([{ text: guard.json('request', payload(effectiveInput, binding, seconds, shots)) }, ...visualParts]),
      schema: ENHANCER_RESPONSE_SCHEMA,
      thinking: hasVisualParts ? 'MEDIUM' : 'LOW',
      timeoutMs: timeoutOf(deps.env),
    });
    const parsed = EnhancerOutputSchema.safeParse(raw);
    if (!parsed.success) return fallback('bad_shape');
    const checked = checkEnhancedPrompt(parsed.data.prompt, effectiveInput, binding);
    if (!checked.ok) return fallback(checked.reason);
    // The video model never reads the customer's ①②③: they must have become words.
    if (input.revision && hasMarkSign(checked.prompt)) return fallback('mark_sign');
    // A reshoot rewrites the earlier prompt sentence by sentence; its shape is that prompt's, not a fresh blueprint's.
    if (blueprint && !input.revision && !blueprintShape(checked.prompt, seconds, input.video?.keep)) return fallback('blueprint_shape');
    const notes = cleanNotes(parsed.data.notes, input.locale, MODEL_NOTES[input.locale]);
    // The outgoing check, on exactly what would be shown, stored and sent. A refused prompt answers this
    // writer's own fallback (as any failed check above); a refused note answers the default note (as cleanNotes).
    const verdict = guard.check(
      { prompt: checked.prompt, notes },
      {
        // The customer's own words (as the checks above count them) and their brand notes and playbooks.
        exempt: [exemptText(effectiveInput), effectiveInput.brand?.tone ?? '', ...(effectiveInput.brand?.rules ?? [])],
        allow: enhancerAllow(effectiveInput, binding, guard.system, deps.env),
        shapes: { prompt: { maxChars: ENHANCED_PROMPT_MAX, noMarkup: true }, notes: { maxChars: NOTES_MAX, oneSentence: true } },
      },
    );
    if (verdict.blocked.includes('prompt')) return fallback(`prompt_guard_${verdict.reason}`);
    return {
      prompt: checked.prompt,
      notes: verdict.blocked.includes('notes') ? MODEL_NOTES[input.locale] : notes,
      source: 'model',
      meta: enhanceMeta(effectiveInput, 'model', { llmModel: config.model, env: deps.env }),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return fallback(/^gemini_[a-z0-9_]+$/.test(reason) ? reason : timedOut ? 'timeout' : error instanceof SyntaxError ? 'bad_json' : 'request_failed');
  }
}
