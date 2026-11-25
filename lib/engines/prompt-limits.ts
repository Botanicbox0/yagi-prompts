import { isEngineId, type EngineId } from '@/lib/images/engines';
import { videoModelForEngine } from '@/lib/video/models';

/**
 * How long one prompt may be, per engine — the single source for the recipe rules, the editor's counter, the admin
 * warning, the supplier guide and the personal compile. Pure and browser-safe (the recipe editor imports it).
 *
 * Counted the way every check here counts: JavaScript string length (UTF-16 code units), after trimming. A Korean
 * syllable is one character here and three bytes in the stored JSON (the recipe byte caps account for that).
 */

/**
 * Seedance 2.5 takes a prompt of up to 15,000 characters PER CLIP — one generation. A film made of two clips has
 * 15,000 for each clip, not 15,000 in total. Founder, 2026-11-25: "seedance2.5의 최대 글자 수 제한은 15000자야",
 * "한 클립당 … 15000자라서 클립 2개면 각각 클립당 15000자씩임".
 */
export const SEEDANCE_25_PROMPT_CHARS = 15_000;

/**
 * Every other engine: the product's step cap since 2026-10-29 (a creative's published Seedance film prompt then ran
 * ~7,900). Not a verified provider limit — kept at the previous product cap until a provider limit is documented.
 */
export const DEFAULT_PROMPT_CHARS = 8_000;

/** Provider limits we have verified, per engine id. Add a row only with a source (provider docs or a founder decision). */
const VERIFIED_PROMPT_CHARS: Partial<Record<EngineId, number>> = {
  'seedance-2.5': SEEDANCE_25_PROMPT_CHARS,
};

/** The longest prompt any engine accepts: what a step may hold before its own engine's rule is applied. */
export const MAX_ENGINE_PROMPT_CHARS = Math.max(DEFAULT_PROMPT_CHARS, ...Object.values(VERIFIED_PROMPT_CHARS));

/** The verified provider limit for this engine (or video model key), or null when none is documented. */
export function verifiedPromptCharLimit(engine: string | null | undefined): number | null {
  return typeof engine === 'string' && isEngineId(engine) ? (VERIFIED_PROMPT_CHARS[engine] ?? null) : null;
}

/** How long one step's prompt may be on this engine: its verified limit, else the previous product cap. */
export function promptCharLimit(engine: string | null | undefined): number {
  return verifiedPromptCharLimit(engine) ?? DEFAULT_PROMPT_CHARS;
}

/**
 * A catalogue template's prompt goes to the model its engine renders on for its runtime (a Seedance 2.0 template longer
 * than 15 s renders on 2.5 — lib/video/models.ts `videoModelForEngine`). The verified limit of THAT model, or null.
 */
export function templatePromptCharLimit(template: { medium: string; engine: string | null; runtimeSeconds: number | null }): number | null {
  if (template.medium !== 'video') return null;
  return verifiedPromptCharLimit(videoModelForEngine(template.engine, template.runtimeSeconds ?? 0).model);
}

/** "15,000" — how the limits are written in guides and messages, so a quoted number is always the constant. */
export function formatPromptChars(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * The characters a clip's compiled text leaves for a buyer's edits on this engine (its verified limit less the length
 * of the text the personal compile receives), or null when the engine has no verified limit.
 */
export function editHeadroom(engine: string | null | undefined, compiledSourceLength: number): number | null {
  const limit = verifiedPromptCharLimit(engine);
  return limit === null ? null : limit - compiledSourceLength;
}

/**
 * Below this headroom nothing useful fits, so a template takes no change requests at all (founder 2026-11-25). Above
 * it every edit is checked one by one before payment (lib/prompts/prompt-length.ts `editFit`), so this floor is only
 * the smallest useful edit: ONE styled part switched to "내 사진 그대로". Measured on the deterministic compile of a
 * short base whose styling block styles hair, makeup and outfit with 120-character lines (the tail cap): hair 896,
 * makeup 814 — the part's rule line, its exclusion with the template's 120-character description, and the skin and
 * audio contracts the sanitizer appends to any edited prompt. Solo, because that is how the render compiles: a couple
 * or pet template always runs as a recipe, and the recipe pass hands the compile no cast. Rounded up to 1,000
 * (tests/template-director/edit-headroom.test.ts re-measures it).
 */
export const EDIT_HEADROOM_MIN_CHARS = 1_000;

/** One clip's room for edits (lib/prompts/prompt-length.ts `templateEditHeadroom`). */
export interface ClipHeadroom {
  clip: number;
  stepId: string | null;
  /** The length of the text the personal compile receives for this clip (the render's identity line included). */
  compiledChars: number;
  headroom: number;
}

/** One clip of a template (a prompt the compile reads) and how long it is against its limit (lib/prompts/prompt-length.ts). */
export interface ClipLength {
  /** 1-based, in the order the compile reads them. */
  clip: number;
  /** The recipe step, or null for a plain template's main text. */
  stepId: string | null;
  chars: number;
  limit: number;
}

const REFUSAL = /prompt length: clip (\d+)(?: \(step [a-z][a-z0-9_]*\))? is ([\d,]+) characters; Seedance 2\.5 takes up to ([\d,]+) per clip/;

/** A refusal a person can read as is; the admin screens read it back into their own sentence (`readPromptLengthRefusal`). */
export function promptLengthRefusalDetail(field: string, clip: ClipLength): string {
  const step = clip.stepId ? ` (step ${clip.stepId})` : '';
  return `${field}: prompt length: clip ${clip.clip}${step} is ${formatPromptChars(clip.chars)} characters; Seedance 2.5 takes up to ${formatPromptChars(clip.limit)} per clip`;
}

export function readPromptLengthRefusal(detail: unknown): { clip: number; chars: number; limit: number } | null {
  const match = typeof detail === 'string' ? REFUSAL.exec(detail) : null;
  if (!match) return null;
  const n = (s: string) => Number(s.replace(/,/g, ''));
  return { clip: n(match[1]!), chars: n(match[2]!), limit: n(match[3]!) };
}
