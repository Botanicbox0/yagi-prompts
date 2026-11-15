/**
 * Marks in a revision request (docs/BRAND-STUDIO-V6-PLAN.md §4.5). The customer points at spots on the
 * clip and writes them ①, ② and ③ in the request. The video model never sees those signs: the prompt
 * writer, the fallback and the classifier all read them as words (the mark's `what`, else its chip
 * `label`, else "the marked spot"). Pure text helpers, no I/O.
 */

/** ① .. ⑳ (U+2460..U+2473). Only ①②③ can be sent; the rest only ever count as "points past the marks". */
const CIRCLED = /[①-⑳]/g;

export const MARKED_SPOT = 'the marked spot';

export interface MarkWords {
  label?: string | null;
  what?: string | null;
}

/** The mark numbers a text uses (1 for ①), in order of first use, without repeats. */
export function markNumbersIn(text: string): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(CIRCLED)) {
    const n = m[0].charCodeAt(0) - 0x2460 + 1;
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** True when the text points at a mark that was not sent (② with one mark, ④ ever). */
export function pointsPastMarks(text: string, markCount: number): boolean {
  return markNumbersIn(text).some((n) => n > markCount);
}

export function hasMarkSign(text: string): boolean {
  return new RegExp(CIRCLED.source).test(text);
}

/** The words a mark stands for. */
export function markPhrase(mark: MarkWords | undefined): string {
  return mark?.what?.trim() || mark?.label?.trim() || MARKED_SPOT;
}

/**
 * The text with every ①②③ written out as what the mark is on. A sign with no mark behind it becomes
 * "the marked spot", so the result never holds a circled digit.
 */
export function replaceMarks(text: string, marks: readonly MarkWords[]): string {
  return text
    .replace(CIRCLED, (sign) => {
      const n = sign.charCodeAt(0) - 0x2460;
      return ` ${markPhrase(marks[n])} `;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/^ +| +$/gm, '');
}
