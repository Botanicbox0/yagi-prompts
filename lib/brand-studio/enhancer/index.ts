/**
 * Prompt enhancer (docs/BRAND-STUDIO-V2.md §8.1). Server-only: one Gemini call rewrites the
 * customer's words in the chosen model's own grammar. Any failure returns the deterministic fallback
 * with `source: 'fallback'`; this function never throws.
 *
 * The client-safe mention helpers live in `./mentions` (import that file directly from the browser).
 */
import { blueprintShape, blueprintShots, isBlueprint } from './blueprint';
import { composeFallbackPrompt } from './fallback';
import { callGeminiJson, inlinePart, studioGeminiConfig, type GeminiPart } from './gemini';
import { effectiveSeconds, keepPhrase, planShots, type PlannedShot } from './lines';
import { buildSystemInstruction } from './profiles';
import { bindReferences, mapCustomerMentions, type Binding } from './references';
import { checkEnhancedPrompt, cleanNotes, ENHANCER_RESPONSE_SCHEMA, EnhancerOutputSchema } from './schema';
import type { EnhanceDeps, EnhanceInput, EnhanceResult } from './types';

export type { EnhanceDeps, EnhanceInput, EnhanceKind, EnhanceReference, EnhanceResult, EnhanceVideo } from './types';
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

const THUMBS_MAX = 4;
const THUMB_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ENHANCE_TIMEOUT_MS = 25_000;

const MODEL_NOTES = {
  ko: '장면과 참조 설명을 모델이 알아듣기 쉽게 구체적으로 다듬었어요.',
  en: 'Made the scene and the references more specific for the model.',
} as const;

function payload(input: EnhanceInput, binding: Binding, seconds: number | null, shots: PlannedShot[]) {
  const video = input.video;
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
          change: video.change?.trim() ? mapCustomerMentions(video.change.trim(), binding.bound) : null,
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
  };
}

function thumbParts(binding: Binding): GeminiPart[] {
  const parts: GeminiPart[] = [];
  for (const b of binding.bound) {
    if (parts.length / 2 >= THUMBS_MAX) break;
    const thumb = b.ref.thumb;
    if (!thumb || b.ref.kind !== 'image' || !THUMB_MIMES.has(thumb.mime)) continue;
    const name = b.token ?? b.name;
    parts.push({ text: `Picture of ${name} (the customer's "${b.ref.label}"${b.ref.role ? `, ${b.ref.role}` : ''}):` });
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
      return { prompt: input.prompt.trim(), notes: '', source: 'fallback' };
    }
  };
  try {
    const config = studioGeminiConfig(deps.env);
    if (!config) return fallback('no_key');
    // A blueprint with nothing to change is still a remake to write: the blueprint is the request.
    const blueprint = isBlueprint(input);
    if (!input.prompt.trim() && !input.video?.change?.trim() && !blueprint) return fallback('empty_prompt');
    const binding = bindReferences(input);
    const seconds = effectiveSeconds(input.kind, input.video);
    const shots = blueprint
      ? blueprintShots(seconds, input.video)
      : input.kind === 'video_remix' && input.video?.method !== 'edit'
        ? planShots(seconds, input.video)
        : [];
    const raw = await callGeminiJson(config, deps.fetch, {
      system: buildSystemInstruction(input, binding, seconds, shots),
      parts: [{ text: JSON.stringify(payload(input, binding, seconds, shots)) }, ...thumbParts(binding)],
      schema: ENHANCER_RESPONSE_SCHEMA,
      thinking: 'LOW',
      timeoutMs: ENHANCE_TIMEOUT_MS,
    });
    const parsed = EnhancerOutputSchema.safeParse(raw);
    if (!parsed.success) return fallback('bad_shape');
    const checked = checkEnhancedPrompt(parsed.data.prompt, input, binding);
    if (!checked.ok) return fallback(checked.reason);
    if (blueprint && !blueprintShape(checked.prompt, seconds, input.video?.keep)) return fallback('blueprint_shape');
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
