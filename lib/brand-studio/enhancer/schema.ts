/**
 * The enhancer's answer and the checks it must pass before it replaces the customer's words.
 * A failed check means the deterministic fallback is sent instead (never an error to the caller).
 */
import { z } from 'zod';
import { enforceAudio } from './lines';
import { listReferenceMentions } from './mentions';
import { hasToken, resolveMention, tokensIn, type Binding } from './references';
import type { EnhanceInput } from './types';

export const ENHANCED_PROMPT_MAX = 6000;
const PROMPT_MIN = 12;
export const NOTES_MAX = 160;
export const REGION_EDIT_NO_MOVE_LINE = 'Do not move or resize anything else.';

export function videoEditStayLine(ref: string): string {
  return `Everything else in ${ref} stays as it is.`;
}

export const EnhancerOutputSchema = z.object({
  prompt: z.string(),
  notes: z.string(),
});

/** Sent as `responseJsonSchema`. */
export const ENHANCER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: 'The complete text sent to the model.' },
    notes: { type: 'string', description: "One short sentence in the customer's language." },
  },
  required: ['prompt', 'notes'],
  additionalProperties: false,
} as const;

/**
 * Words that must never reach a model prompt the customer can read under "보낸 프롬프트 보기":
 * provider and tool names, system identifiers, template slots, talk about these instructions.
 * Exempt when the customer wrote the word themselves.
 */
export const INTERNAL_TERMS: readonly RegExp[] = [
  /\bsunra\b/i,
  /\bhiggsfield\b/i,
  /\bmorphic\b/i,
  /모픽/,
  /\bmcp\b/i,
  /\bsunra_(?:api|mcp)\b/i,
  /\b(?:draft|provider)_task_id\b/i,
  /\brequest_id\b/i,
  /\bendpoint\b/i,
  /\bwebhook\b/i,
  /\bapi[ _-]?key\b/i,
  /\bsystem (?:prompt|instruction)s?\b/i,
  /\bgemini\b/i,
  /\bbrand (?:kit|notes)\b/i,
  /브랜드 ?키트/,
  /\{\{[^}]*\}\}/,
];

/** Camera, lens and film brands: "other brands" the customer did not name. */
const GEAR_BRANDS =
  /\b(?:kodak|fujifilm|fuji|ilford|portra|cinestill|panavision|arri|alexa|red komodo|canon|nikon|sony|leica|hasselblad|zeiss|cooke|sigma art|profoto|godox|aputure)\b/i;

/** Filler praise and banned plastic-skin / shortcut tokens the model may not add. Removed when the customer did not write them. */
const FILLER: readonly RegExp[] = [
  /\b(?:stunning|breathtaking|masterpiece|award[- ]winning|best quality|high quality|ultra[- ]detailed|highly detailed|hyper[- ]?realistic|photorealistic masterpiece|trending on artstation|octane render|unreal engine)\b/gi,
  /\b(?:4k|8k|16k|uhd)\b/gi,
  /\b(?:poreless porcelain(?:\s+glass[- ]skin)?|glass[- ]skin|dewy highlighter(?:\s+glow)?|silky[- ]smooth poreless skin|beauty[- ]diffused xenon flash)\b/gi,
  /\bsame as (?:the )?original video\b/gi,
];

/** Lighting equipment, rewritten as what the light looks like. */
const EQUIPMENT: ReadonlyArray<[RegExp, string]> = [
  [/\bsoft ?box(?:es)?\b/gi, 'broad soft light'],
  [/\bring ?lights?\b/gi, 'even frontal light'],
  [/\bbeauty dish(?:es)?\b/gi, 'soft frontal light'],
  [/\bstrobes?\b/gi, 'flash'],
  [/\bLED panels?\b/gi, 'soft light'],
  [/\bumbrella lights?\b/gi, 'broad soft light'],
];

export function exemptText(input: EnhanceInput): string {
  const refs = input.references.map((r) => `${r.label} ${r.use ?? ''} ${r.avoid ?? ''}`).join(' ');
  // A revision carries the earlier prompt and requests over: words they already had are not "introduced".
  // The marks' descriptions came from the customer's own pointing (revise.mark): they count as given.
  const revision = input.revision
    ? [input.revision.madeWith, ...input.revision.history, ...(input.revision.marks ?? []).map((m) => m.what ?? '')].join('\n')
    : '';
  return [input.prompt, input.video?.change ?? '', input.brand?.name ?? '', refs, revision].join('\n');
}

function introduces(re: RegExp, text: string, exempt: string): boolean {
  const flags = re.flags.replace('g', '');
  return new RegExp(re.source, flags).test(text) && !new RegExp(re.source, flags).test(exempt);
}

/** Removes filler and equipment names the customer did not write; tidies spacing. */
export function tidyPrompt(raw: string, exempt: string): string {
  let text = raw.replace(/\r\n?/g, '\n').trim();
  for (const re of FILLER) {
    text = text.replace(re, (word) => (new RegExp(`\\b${word}\\b`, 'i').test(exempt) ? word : ''));
  }
  for (const [re, plain] of EQUIPMENT) {
    text = text.replace(re, (word) => (new RegExp(`\\b${word}\\b`, 'i').test(exempt) ? word : plain));
  }
  return text
    .replace(/[ \t]+([,.;:])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

export function containsInternalTerm(text: string, exempt = ''): boolean {
  return INTERNAL_TERMS.some((re) => introduces(re, text, exempt));
}

export type PromptCheck = { ok: true; prompt: string } | { ok: false; reason: string };

/** One spelling per token: "@image 1" → "@Image1"; Seedream "figure 2" / "image 2" → "Image 2" (2026-11-19). */
export function canonicalTokens(profile: EnhanceInput['profile'], prompt: string): string {
  if (profile === 'seedance') {
    return prompt.replace(/@(image|video|audio)\s?(\d{1,2})\b/gi, (_m, word: string, n: string) => `@${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}${n}`);
  }
  if (profile === 'seedream') return prompt.replace(/\b(?:figure|image)\s*(\d{1,2})\b/gi, 'Image $1');
  return prompt.replace(/\bimage\s*(\d{1,2})\b/g, 'image $1');
}

/** Everything a model answer must satisfy; returns the tidied prompt with required lines in place. */
export function checkEnhancedPrompt(raw: string, input: EnhanceInput, binding: Binding): PromptCheck {
  const exempt = exemptText(input);
  let prompt = tidyPrompt(raw, exempt);
  // Seedream: an answer in the old "Figure N" form is the same reference; it is checked and sent as "Image N".
  if (input.profile === 'seedream') prompt = canonicalTokens('seedream', prompt);
  if (prompt.length < PROMPT_MIN) return { ok: false, reason: 'too_short' };
  if (prompt.length > ENHANCED_PROMPT_MAX) return { ok: false, reason: 'too_long' };
  if (containsInternalTerm(prompt, exempt)) return { ok: false, reason: 'internal_term' };
  if (introduces(GEAR_BRANDS, prompt, exempt)) return { ok: false, reason: 'brand_name' };

  // Tokens: only ones that exist, at least one of the attached, every one the customer named.
  const counts = { image: 0, video: 0, audio: 0 };
  for (const b of binding.bound) if (b.token) counts[b.ref.kind] += 1;
  const offset = binding.editTarget ? 1 : 0;
  const used = tokensIn(input.profile, prompt);
  if (input.profile === 'seedance' && binding.seedanceMode !== 'reference' && used.length > 0) {
    return { ok: false, reason: 'token_without_reference' };
  }
  for (const t of used) {
    const limit = counts[t.kind] + (t.kind === 'image' ? offset : 0);
    if (t.number < 1 || t.number > limit) return { ok: false, reason: 'unknown_token' };
  }
  if (binding.editTarget && !hasToken(prompt, binding.editTarget)) return { ok: false, reason: 'lost_edit_target' };
  const tokens = binding.bound.map((b) => b.token).filter((t): t is string => t !== null);
  if (tokens.length > 0 && !tokens.some((t) => hasToken(prompt, t))) return { ok: false, reason: 'lost_references' };
  const sourceVideo = input.kind === 'video_remix' ? binding.bound.find((b) => b.ref.kind === 'video')?.token : null;
  if (sourceVideo && !hasToken(prompt, sourceVideo)) return { ok: false, reason: 'lost_reference_video' };
  for (const m of listReferenceMentions(`${input.prompt}\n${input.video?.change ?? ''}`)) {
    const token = resolveMention(binding.bound, m.kind, m.number)?.token;
    if (token && !hasToken(prompt, token)) return { ok: false, reason: 'lost_mentioned_reference' };
  }
  prompt = canonicalTokens(input.profile, prompt);

  // Lines a kind cannot go without.
  if (input.kind === 'region_edit' && !/do not move or resize anything else/i.test(prompt)) {
    prompt = `${prompt}\n${REGION_EDIT_NO_MOVE_LINE}`;
  }
  if (input.profile === 'seedance' && input.video) {
    if (input.kind === 'video_remix' && input.video.method === 'edit' && !/everything else stays as it is/i.test(prompt)) {
      const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
      prompt = `${prompt}\n${videoEditStayLine(ref)}`;
    }
    const withAudio = enforceAudio(prompt, input.video.audio);
    if (withAudio === null) return { ok: false, reason: 'music_in_ambient' };
    prompt = withAudio;
  }
  if (prompt.length > ENHANCED_PROMPT_MAX) return { ok: false, reason: 'too_long' };
  return { ok: true, prompt };
}

const HANGUL = /[가-힣]/;

/** One short sentence in the customer's language, or the given default. */
export function cleanNotes(raw: string, locale: 'ko' | 'en', fallback: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  const first = (/^(.+?[.!?。])(?:\s|$)/.exec(flat)?.[1] ?? flat).trim();
  if (!first || first.length > NOTES_MAX) return fallback;
  if (locale === 'ko' && !HANGUL.test(first)) return fallback;
  if (locale === 'en' && HANGUL.test(first)) return fallback;
  if (containsInternalTerm(first)) return fallback;
  return first;
}
