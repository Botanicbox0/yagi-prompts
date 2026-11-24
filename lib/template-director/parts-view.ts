import { interpolate } from '@/lib/i18n/format';
import { MARKS_PER_PART_MAX, isMark, type VideoKeyframe, type VideoMark } from '@/lib/prompts/keyframes';
import { parseTemplateLocks, publicLocks, type PublicTemplateLocks, type TemplateLockName } from './locks';
import type { DirectorEditableSlot } from './schema';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — the parts a template declares, and the view the template page shows for
 * them ("what this template decides"): the part's name, its state, and — from the template's marks — a short
 * description and the range of the example video where it shows.
 *
 * The RULE (which parts are declared) lives in `declaredPartKeys` alone; the page (drop a mark on read) and the admin
 * save (`prompt.marks`, refuse a mark) both call it. Today a declaration is the `Template locks:` block, read through
 * its public projection (names only — never a lock line's tail or the block text). The `Template styling:` block
 * (slice S1) adds its parts through the `styling` input.
 *
 * Part keys are the lock keys (locks.ts `lockKey`, and `LockedPart.key` on the make card): 'product' | 'logo' |
 * 'sound' | a director slot ('outfit', 'makeup', 'hair', 'prop', 'shot_action', 'lighting_mood') | 'shots-<from>-<to>'.
 * The styling parts (hair, makeup, outfit) are slot keys too, so one mapping serves both.
 *
 * Client-safe.
 */

export type PartState = 'locked' | 'styled' | 'photo';

/** The styling declaration's public shape (slice S1/S2): parts styled by the template, parts taken from the photo. */
export interface DeclaredStyling {
  styled: readonly string[];
  photo: readonly string[];
}

export interface DeclaredPartsInput {
  locks: PublicTemplateLocks | null | undefined;
  styling?: DeclaredStyling | null;
}

const shotsKey = (range: { from: number; to: number }): string => `shots-${range.from}-${range.to}`;

/** The locked parts, in the make card's order: named, then slots (the product covers the prop), then shot ranges. */
function lockedPartKeys(locks: PublicTemplateLocks | null | undefined): string[] {
  // A block that did not parse locks everything; it names no part a mark could point at.
  if (!locks || locks.all) return [];
  const product = locks.named.includes('product');
  return [...locks.named, ...locks.slots.filter((slot) => !(slot === 'prop' && product)), ...locks.shots.map(shotsKey)];
}

/** Every part the template's prompt declares, in display order, each once (a part both locked and styled is locked). */
export function declaredPartKeys(input: DeclaredPartsInput): string[] {
  const keys = [...lockedPartKeys(input.locks), ...(input.styling?.styled ?? []), ...(input.styling?.photo ?? [])];
  return keys.filter((key, i) => keys.indexOf(key) === i);
}

/** The declared parts of a stored prompt (the admin save reads the prompt it is about to attach marks to). */
export function declaredPartKeysOfPrompt(promptText: string): string[] {
  return declaredPartKeys({ locks: publicLocks(parseTemplateLocks(promptText)), styling: null });
}

/** The words a part is named with: the make card's (`editSheet`). */
export interface PartNameCopy {
  locks: Record<TemplateLockName, string>;
  slots: Record<DirectorEditableSlot, string>;
  shotOne: string;
  shotRange: string;
}

/** A part's name in the screen's words; null for a key the copy does not know. */
export function partLabel(key: string, copy: PartNameCopy): string | null {
  if (Object.hasOwn(copy.locks, key)) return copy.locks[key as TemplateLockName];
  if (Object.hasOwn(copy.slots, key)) return copy.slots[key as DirectorEditableSlot];
  const shots = /^shots-(\d{1,3})-(\d{1,3})$/.exec(key);
  if (!shots) return null;
  const from = Number(shots[1]);
  const to = Number(shots[2]);
  return from === to ? interpolate(copy.shotOne, { n: from }) : interpolate(copy.shotRange, { from, to });
}

/** One row of "what this template decides". `id` is unique per row (a part can have two ranges). */
export interface TemplatePartView {
  id: string;
  key: string;
  state: PartState;
  label: string;
  /** The mark's description in the page's language; null without one. */
  desc: string | null;
  /** The range in the example video (seconds); null = no mark (the whole video, or a shot range). */
  from: number | null;
  /** null = no end (a mark without a valid end time). */
  to: number | null;
  /** The buyer chooses this part at make time (slice S2); always false here. */
  choice: boolean;
}

export interface TemplatePartsViewInput extends DeclaredPartsInput {
  /** The template's marks; beats and marks for undeclared parts are ignored. */
  marks: readonly VideoKeyframe[];
  copy: PartNameCopy;
  locale: 'ko' | 'en';
}

const text = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** The page's view: one row per mark (at most two per part), one row for a declared part without one. Empty = nothing declared. */
export function templatePartsView(input: TemplatePartsViewInput): TemplatePartView[] {
  const keys = declaredPartKeys(input);
  if (keys.length === 0) return [];
  const locked = new Set(lockedPartKeys(input.locks));
  const styled = new Set(input.styling?.styled ?? []);
  const byPart = new Map<string, VideoMark[]>();
  for (const mark of [...input.marks].filter(isMark).sort((a, b) => a.timeSeconds - b.timeSeconds)) {
    if (!keys.includes(mark.part)) continue;
    const list = byPart.get(mark.part) ?? [];
    if (list.length < MARKS_PER_PART_MAX) list.push(mark);
    byPart.set(mark.part, list);
  }

  const rows: TemplatePartView[] = [];
  for (const key of keys) {
    const label = partLabel(key, input.copy);
    if (label === null) continue;
    const state: PartState = locked.has(key) ? 'locked' : styled.has(key) ? 'styled' : 'photo';
    const marks = byPart.get(key) ?? [];
    if (marks.length === 0) {
      rows.push({ id: key, key, state, label, desc: null, from: null, to: null, choice: false });
      continue;
    }
    marks.forEach((mark, i) => {
      const end = mark.endSeconds;
      rows.push({
        id: i === 0 ? key : `${key}~${i + 1}`,
        key,
        state,
        label,
        desc: text(input.locale === 'en' ? mark.labelEn : mark.labelKo),
        from: mark.timeSeconds,
        to: typeof end === 'number' && end > mark.timeSeconds ? end : null,
        choice: false,
      });
    });
  }
  return rows;
}
