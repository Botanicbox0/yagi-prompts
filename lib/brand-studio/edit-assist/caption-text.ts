/**
 * Caption text stays exactly as the user wrote it (docs/BRAND-EDITING-STUDIO.md §4.3).
 *
 * Live answers of gemini-4-hydrogen to "영상 내내 위쪽에 '#광고' 작게 넣어줘" (2026-11-18) came back as
 * `"#광고"` (quote marks inside the text) and as `%23광고` (URL-encoded) in two of three runs. Two layers,
 * both run on the server before a plan is accepted:
 * - `restoreCaptionTexts` (before validation): a caption text the user did not write, which becomes what
 *   the user wrote once one pair of wrapping quote marks is taken off or once it is percent-decoded, is
 *   replaced by that form. No model call.
 * - `captionTextProblems` (with the dry run): when the instruction quotes new text, every step that writes
 *   caption text must write one of the quoted texts exactly; otherwise a problem line for the one
 *   corrective call. With nothing quoted, or only the text of captions already there (a quote that picks
 *   a caption), there is nothing to compare: the words may be the model's.
 *
 * Pure, no server imports.
 */

/** The problem code for caption text that is not one of the instruction's quoted texts. */
export const CAPTION_TEXT_NOT_VERBATIM = 'caption_text_not_verbatim';

/** Quote pairs, opening and closing mark. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
];

/**
 * One quoted text per match, left to right. A straight single quote right after a Latin letter or digit, or
 * one closing right before a Latin letter, is an apostrophe ("Don't", "users'"), not a quote mark; Korean
 * particles after a closing quote ("'오늘만 30% 할인'으로") are fine.
 */
const QUOTED = /"([^"]+)"|(?<![A-Za-z0-9])'([^']+)'(?![A-Za-z])|“([^”]+)”|‘([^’]+)’|「([^」]+)」|『([^』]+)』/g;

/** The texts the instruction puts in quote marks, trimmed, in order. */
export function quotedSegments(instruction: string): string[] {
  const out: string[] = [];
  for (const match of instruction.matchAll(QUOTED)) {
    const text = match.slice(1).find((group) => group !== undefined)?.trim();
    if (text) out.push(text);
  }
  return out;
}

type Loose = Record<string, unknown>;

const isRecord = (value: unknown): value is Loose => !!value && typeof value === 'object' && !Array.isArray(value);

/** A step that writes caption text, with that text. */
function captionText(step: unknown): string | null {
  if (!isRecord(step) || (step.do !== 'caption_add' && step.do !== 'caption_edit')) return null;
  return typeof step.text === 'string' ? step.text : null;
}

/** The text inside one pair of wrapping quote marks, or null. */
function unwrapped(text: string): string | null {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim() || null;
    }
  }
  return null;
}

/** The percent-decoded text, or null when there is nothing to decode or the encoding is broken. */
function decoded(text: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return null;
  try {
    return decodeURIComponent(text).trim() || null;
  } catch {
    return null;
  }
}

/**
 * What the model's text may have been before it was wrapped or encoded: unwrapped, decoded, both.
 * Only a form that is what the user wrote is ever used.
 */
function restoredForms(text: string): string[] {
  const inner = unwrapped(text);
  const forms = [inner, decoded(text), inner === null ? null : decoded(inner)];
  return forms.filter((form): form is string => form !== null && form !== text);
}

function restoredText(text: string, instruction: string, quoted: readonly string[]): string {
  const trimmed = text.trim();
  if (quoted.includes(trimmed)) return text;
  const forms = restoredForms(trimmed);
  // One of the quoted texts, even when the model copied the user's own quote marks along with it
  // ("'#광고'" from "… '#광고' …", which occurs in the instruction quote marks and all).
  const quotedForm = forms.find((form) => quoted.includes(form));
  if (quotedForm !== undefined) return quotedForm;
  if (instruction.includes(trimmed)) return text;
  return forms.find((form) => instruction.includes(form)) ?? text;
}

/**
 * The model's reply (wire shape) with the text of each `caption_add` / `caption_edit` step restored to what
 * the user wrote, where taking off one pair of wrapping quote marks or percent-decoding gives exactly that.
 * Everything else, and every text no form of which the user wrote, passes unchanged. Never mutates `raw`.
 */
export function restoreCaptionTexts(raw: unknown, instruction: string): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return raw;
  const quoted = quotedSegments(instruction);
  let changed = false;
  const steps = raw.steps.map((step) => {
    const text = captionText(step);
    if (text === null) return step;
    const restored = restoredText(text, instruction, quoted);
    if (restored === text) return step;
    changed = true;
    return { ...(step as Loose), text: restored };
  });
  return changed ? { ...raw, steps } : raw;
}

/**
 * Problem lines (`step N: caption_text_not_verbatim`, the format of the other problem codes) for every step
 * that writes caption text other than one of the instruction's quoted texts. Steps that only move, resize or
 * retime a caption are never compared. Empty when nothing is quoted, and when every quoted text is the text
 * of a caption already on the timeline (`existing`): such a quote only says WHICH caption ("'봄 신상 출시'
 * 지우고 마지막에 브랜드 문구 넣어줘", "'봄 신상 출시' 자막을 더 짧게 고쳐줘"), so new text is the model's to write.
 */
export function captionTextProblems(steps: readonly unknown[], instruction: string, existing: readonly string[]): string[] {
  const quoted = quotedSegments(instruction);
  const onTimeline = new Set(existing.map((text) => text.trim()));
  if (quoted.every((text) => onTimeline.has(text))) return [];
  const problems: string[] = [];
  steps.forEach((step, index) => {
    const text = captionText(step);
    if (text !== null && !quoted.includes(text.trim())) problems.push(`step ${index + 1}: ${CAPTION_TEXT_NOT_VERBATIM}`);
  });
  return problems;
}
