/**
 * Prompt enhancer (docs/BRAND-STUDIO-V2.md §8.1). Server-only: one Gemini call rewrites the
 * customer's words in the chosen model's own grammar. Any failure returns the deterministic fallback
 * with `source: 'fallback'`; this function never throws.
 *
 * The client-safe mention helpers live in `./mentions` (import that file directly from the browser).
 */
import { loadDirectorPlaybooks, playbookRuleLines } from '@/lib/brand-studio/director/playbooks';
import { blueprintShape, blueprintShots, isBlueprint } from './blueprint';
import { composeFallbackPrompt } from './fallback';
import { hasMarkSign, replaceMarks } from './marks';
import { callGeminiJson, inlinePart, studioGeminiConfig, type GeminiPart } from './gemini';
import { effectiveSeconds, keepPhrase, planShots, type PlannedShot } from './lines';
import { buildSystemInstruction } from './profiles';
import { bindReferences, mapCustomerMentions, type Binding } from './references';
import { checkEnhancedPrompt, cleanNotes, ENHANCER_RESPONSE_SCHEMA, EnhancerOutputSchema } from './schema';
import type { EnhanceDeps, EnhanceInput, EnhanceResult } from './types';

export type { EnhanceDeps, EnhanceInput, EnhanceKind, EnhanceMark, EnhanceMaterial, EnhanceReference, EnhanceResult, EnhanceRevision, EnhanceVideo } from './types';
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
const ENHANCE_TIMEOUT_MS = 25_000;

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
        }
      : null,
  };
}

function thumbParts(input: EnhanceInput, binding: Binding): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const cropThumb = input.kind === 'region_edit' ? input.editCropThumb : null;
  const hasCrop = Boolean(cropThumb && THUMB_MIMES.has(cropThumb.mime));
  if (hasCrop && cropThumb) {
    const target = binding.editTarget ?? 'image 1';
    parts.push({
      text: `Picture of ${target} (the enlarged region crop cut out from the customer's photograph — keep its framing, scale, outer silhouette, contours and surrounding pixels identical):`,
    });
    parts.push(inlinePart(cropThumb.bytes, cropThumb.mime));
  }
  const maxRefThumbs = THUMBS_MAX + (hasCrop ? 1 : 0);
  for (const b of binding.bound) {
    if (parts.length / 2 >= maxRefThumbs) break;
    const thumb = b.ref.thumb;
    if (!thumb || b.ref.kind !== 'image' || !THUMB_MIMES.has(thumb.mime)) continue;
    const name = b.token ?? b.name;
    const cues = [
      `the customer's "${b.ref.label}"`,
      b.ref.role ? `role: ${b.ref.role}` : 'role: infer from visual content and request',
      b.ref.use?.trim() ? `take: "${b.ref.use.trim()}"` : null,
      b.ref.avoid?.trim() ? `leave out: "${b.ref.avoid.trim()}"` : null,
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

export async function enhancePrompt(input: EnhanceInput, deps: EnhanceDeps): Promise<EnhanceResult> {
  const fallback = (reason: string): EnhanceResult => {
    try {
      deps.onFallback?.(reason);
    } catch {
      // a broken logger must not change the result
    }
    try {
      return composeFallbackPrompt(input);
    } catch {
      return { prompt: input.revision ? replaceMarks(input.prompt.trim(), []) : input.prompt.trim(), notes: '', source: 'fallback' };
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
    const visualParts = thumbParts(effectiveInput, binding);
    const hasVisualParts = visualParts.some((p) => 'inlineData' in p);
    const raw = await callGeminiJson(config, deps.fetch, {
      system: buildSystemInstruction(effectiveInput, binding, seconds, shots),
      parts: [{ text: JSON.stringify(payload(effectiveInput, binding, seconds, shots)) }, ...visualParts],
      schema: ENHANCER_RESPONSE_SCHEMA,
      thinking: hasVisualParts ? 'MEDIUM' : 'LOW',
      timeoutMs: ENHANCE_TIMEOUT_MS,
    });
    const parsed = EnhancerOutputSchema.safeParse(raw);
    if (!parsed.success) return fallback('bad_shape');
    const checked = checkEnhancedPrompt(parsed.data.prompt, effectiveInput, binding);
    if (!checked.ok) return fallback(checked.reason);
    // The video model never reads the customer's ①②③: they must have become words.
    if (input.revision && hasMarkSign(checked.prompt)) return fallback('mark_sign');
    // A reshoot rewrites the earlier prompt sentence by sentence; its shape is that prompt's, not a fresh blueprint's.
    if (blueprint && !input.revision && !blueprintShape(checked.prompt, seconds, input.video?.keep)) return fallback('blueprint_shape');
    return {
      prompt: checked.prompt,
      notes: cleanNotes(parsed.data.notes, input.locale, MODEL_NOTES[input.locale]),
      source: 'model',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    return fallback(/^gemini_[a-z0-9_]+$/.test(reason) ? reason : error instanceof SyntaxError ? 'bad_json' : 'request_failed');
  }
}
