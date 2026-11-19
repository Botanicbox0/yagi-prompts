/**
 * The change sheet of the revise conversation (docs/BRAND-STUDIO-VIDEO-REMIX.md §3, `BRAND_STUDIO_REVISE_V2`):
 * the one current request for the next version of a clip, as the studio understood it. `change` is what
 * will change (each item tagged with what kind of change it is, which decides how the version is made),
 * `keep` what must stay, `exclude` what must not appear. Every studio turn returns the whole sheet; a
 * correction replaces the item it corrects, a withdrawal removes one.
 *
 * Client-safe: zod and plain functions only (the screen keeps the sheet between turns, the server
 * re-checks it on every turn and when the version is made).
 */
import { z } from 'zod';

/** What kind of change an item is. `look` is painted into the clip; anything else makes the clip again. */
export const SHEET_ITEM_KINDS = ['look', 'motion', 'framing', 'length'] as const;
export type SheetItemKind = (typeof SHEET_ITEM_KINDS)[number];

export const SHEET_LIMITS = {
  itemMax: 120,
  changeMax: 6,
  keepMax: 6,
  excludeMax: 4,
  /** Questions one conversation may ask in all (contract §3: at most three). */
  questionsMax: 3,
  questionMax: 160,
  optionMax: 60,
  optionsMin: 2,
  optionsMax: 3,
  pointMax: 60,
  replyMax: 600,
  turnMax: 4000,
  /** Turns kept with a version (customer and studio together). */
  transcriptMax: 40,
} as const;

const Item = z.string().trim().min(1).max(SHEET_LIMITS.itemMax);

export const SheetChangeSchema = z.object({
  text: Item,
  kind: z.enum(SHEET_ITEM_KINDS),
  /** A `length` item only: the new total length in whole seconds. */
  seconds: z.number().int().min(1).max(120).optional(),
});
export type SheetChange = z.infer<typeof SheetChangeSchema>;

export const ReviseSheetSchema = z.object({
  change: z.array(SheetChangeSchema).max(SHEET_LIMITS.changeMax).default([]),
  keep: z.array(Item).max(SHEET_LIMITS.keepMax).default([]),
  exclude: z.array(Item).max(SHEET_LIMITS.excludeMax).default([]),
});
export type ReviseSheet = z.infer<typeof ReviseSheetSchema>;

/** A question the studio asked in this conversation, and what the customer answered (null: not answered). */
export const ReviseQuestionSchema = z.object({
  /** A few words naming what the question settles; the same point is never asked twice. */
  point: z.string().trim().min(1).max(SHEET_LIMITS.pointMax),
  question: z.string().trim().min(1).max(SHEET_LIMITS.questionMax),
  options: z.array(z.string().trim().min(1).max(SHEET_LIMITS.optionMax)).max(SHEET_LIMITS.optionsMax).default([]),
  answer: z.string().trim().min(1).max(SHEET_LIMITS.turnMax).nullable().default(null),
  /** The customer asked the studio to choose ("알아서 정해 주세요"). */
  decided: z.boolean().optional(),
  /** The customer went on without answering; the point is not asked again. */
  skipped: z.boolean().optional(),
});
export type ReviseQuestion = z.infer<typeof ReviseQuestionSchema>;

export const ReviseTurnSchema = z.object({
  role: z.enum(['customer', 'studio']),
  text: z.string().trim().min(1).max(SHEET_LIMITS.turnMax),
});
export type ReviseTurn = z.infer<typeof ReviseTurnSchema>;

/** What a version made from the conversation carries (`params.revision.dialogue`). */
export const ReviseDialogueRecordSchema = z.object({
  sheet: ReviseSheetSchema,
  questions: z.array(ReviseQuestionSchema).max(SHEET_LIMITS.questionsMax).default([]),
  transcript: z.array(ReviseTurnSchema).max(SHEET_LIMITS.transcriptMax).default([]),
});
export type ReviseDialogueRecord = z.infer<typeof ReviseDialogueRecordSchema>;

export const emptySheet = (): ReviseSheet => ({ change: [], keep: [], exclude: [] });

export const hasChange = (sheet: Pick<ReviseSheet, 'change'> | null | undefined): boolean => Boolean(sheet?.change.length);

/**
 * How a sheet is made: only `look` changes are painted into the clip (`edit`); a change of motion,
 * framing or length makes it again (`reshoot`). Null when there is nothing to change.
 */
export function wayOfSheet(sheet: Pick<ReviseSheet, 'change'>): 'edit' | 'reshoot' | null {
  if (!sheet.change.length) return null;
  return sheet.change.every((c) => c.kind === 'look') ? 'edit' : 'reshoot';
}

/** The new total length a sheet asks for (its `length` item), or null. */
export function lengthOfSheet(sheet: Pick<ReviseSheet, 'change'>): number | null {
  const item = [...sheet.change].reverse().find((c) => c.kind === 'length' && typeof c.seconds === 'number');
  return item?.seconds ?? null;
}

/** The request a version is stored with (`job.prompt`, shown on the version card): the changes, one per line. */
export function sheetRequest(sheet: Pick<ReviseSheet, 'change'>): string {
  return sheet.change.map((c) => c.text).join('\n');
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const key = (s: string) => norm(s).toLowerCase();

function uniqueTexts(items: readonly unknown[], max: number): string[] {
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const text = norm(raw).slice(0, SHEET_LIMITS.itemMax).trim();
    if (!text || out.some((o) => key(o) === key(text))) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Any sheet-shaped value as a valid sheet: trimmed, de-duplicated, within the limits; bad items are dropped. */
export function cleanSheet(raw: unknown): ReviseSheet {
  const r = (raw ?? {}) as { change?: unknown; keep?: unknown; exclude?: unknown };
  const change: SheetChange[] = [];
  for (const item of Array.isArray(r.change) ? r.change : []) {
    const c = item as { text?: unknown; kind?: unknown; seconds?: unknown };
    if (typeof c?.text !== 'string' || !(SHEET_ITEM_KINDS as readonly string[]).includes(c.kind as string)) continue;
    const text = norm(c.text).slice(0, SHEET_LIMITS.itemMax).trim();
    if (!text || change.some((x) => key(x.text) === key(text))) continue;
    const kind = c.kind as SheetItemKind;
    const seconds = kind === 'length' && typeof c.seconds === 'number' && Number.isFinite(c.seconds) ? Math.round(c.seconds) : undefined;
    // A length item without a length says nothing the studio can make.
    if (kind === 'length' && seconds === undefined) continue;
    change.push({ text, kind, ...(seconds !== undefined ? { seconds } : {}) });
    if (change.length >= SHEET_LIMITS.changeMax) break;
  }
  return {
    change,
    keep: uniqueTexts(Array.isArray(r.keep) ? r.keep : [], SHEET_LIMITS.keepMax),
    exclude: uniqueTexts(Array.isArray(r.exclude) ? r.exclude : [], SHEET_LIMITS.excludeMax),
  };
}

/** Whether every change of `next` is one of `standing`'s (by text): a sheet that only lost items. */
export function onlyRemoved(standing: ReviseSheet, next: ReviseSheet): boolean {
  const had = new Set(standing.change.map((c) => key(c.text)));
  return next.change.length < standing.change.length && next.change.every((c) => had.has(key(c.text)));
}

/** The sheet without its last change (a withdrawal the reading did not express as a smaller sheet). */
export function withoutLast(sheet: ReviseSheet): ReviseSheet {
  return { ...sheet, change: sheet.change.slice(0, -1) };
}

/** The question still waiting for an answer: the last one asked, when it was neither answered nor skipped. */
export function openQuestion(questions: readonly ReviseQuestion[]): number | null {
  const last = questions.length - 1;
  if (last < 0) return null;
  const q = questions[last]!;
  return q.answer === null && !q.skipped ? last : null;
}

/** Whether two question points are the same point (case, spacing and punctuation aside). */
export function samePoint(a: string, b: string): boolean {
  const k = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return k(a) === k(b);
}
