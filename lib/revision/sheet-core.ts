/**
 * The kind-agnostic part of a change sheet (`{ change, keep, exclude }`): the block limits, the text item,
 * and the helpers that only read a change line's `text`. The brand revise conversation
 * (`lib/brand-studio/revision/sheet.ts`) and the personal template edit sheet
 * (`lib/template-director/sheet.ts`, docs/PERSONAL-STUDIO.md §2.3) each add their own change item on top.
 *
 * Client-safe: zod and plain functions only.
 */
import { z } from 'zod';

/** The three blocks' limits, shared by every sheet. */
export const SHEET_BLOCK_LIMITS = {
  itemMax: 120,
  changeMax: 6,
  keepMax: 6,
  excludeMax: 4,
} as const;

/** One line of text in any block. */
export const SheetTextItemSchema = z.string().trim().min(1).max(SHEET_BLOCK_LIMITS.itemMax);

/** The part of a sheet the text helpers read. */
export interface TextChangeSheet {
  change: ReadonlyArray<{ text: string }>;
}

/** Collapses runs of whitespace into one space and trims. */
export const normSheetText = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** What two texts are compared by: normalised and lower-cased. */
export const sheetTextKey = (s: string): string => normSheetText(s).toLowerCase();

/** The string items of `items` as sheet texts: normalised, clipped to the item limit, once each, at most `max`. */
export function uniqueSheetTexts(items: readonly unknown[], max: number): string[] {
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const text = normSheetText(raw).slice(0, SHEET_BLOCK_LIMITS.itemMax).trim();
    if (!text || out.some((o) => sheetTextKey(o) === sheetTextKey(text))) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export const emptySheet = <C>(): { change: C[]; keep: string[]; exclude: string[] } => ({ change: [], keep: [], exclude: [] });

export const hasChange = (sheet: TextChangeSheet | null | undefined): boolean => Boolean(sheet?.change.length);

/** The request a version is stored with: the changes, one per line. */
export function sheetRequest(sheet: TextChangeSheet): string {
  return sheet.change.map((c) => c.text).join('\n');
}

/** Whether every change of `next` is one of `standing`'s (by text): a sheet that only lost items. */
export function onlyRemoved(standing: TextChangeSheet, next: TextChangeSheet): boolean {
  const had = new Set(standing.change.map((c) => sheetTextKey(c.text)));
  return next.change.length < standing.change.length && next.change.every((c) => had.has(sheetTextKey(c.text)));
}

/** The sheet without its last change (a withdrawal the reading did not express as a smaller sheet). */
export function withoutLast<S extends { change: ReadonlyArray<unknown> }>(sheet: S): S {
  return { ...sheet, change: sheet.change.slice(0, -1) } as S;
}

/** Whether the change list differs between two sheets (by text, order aside). */
export function changesDiffer(a: TextChangeSheet, b: TextChangeSheet): boolean {
  const ka = new Set(a.change.map((c) => sheetTextKey(c.text)));
  const kb = new Set(b.change.map((c) => sheetTextKey(c.text)));
  return ka.size !== kb.size || [...ka].some((k) => !kb.has(k));
}

/** Whether two question points are the same point (case, spacing and punctuation aside). */
export function samePoint(a: string, b: string): boolean {
  const k = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return k(a) === k(b);
}
