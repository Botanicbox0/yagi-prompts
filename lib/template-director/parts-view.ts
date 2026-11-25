import { interpolate } from '@/lib/i18n/format';
import { MARKS_PER_PART_MAX, isMark, type VideoKeyframe, type VideoMark } from '@/lib/prompts/keyframes';
import { parseTemplateLocks, publicLocks, type PublicTemplateLocks, type TemplateLockName } from './locks';
import { OWN_STYLE_PARTS, parseTemplateStyling, publicStyling, type OwnStylePart } from './styling';
import type { DirectorEditableSlot, PersonalDirectorSpec } from './schema';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — the parts a template declares, and the view the template page shows for
 * them ("what this template decides"): the part's name, its state, and — from the template's marks — a short
 * description and the range of the example video where it shows.
 *
 * The RULE (which parts are declared) lives in `declaredPartKeys` alone; the page (drop a mark on read) and the admin
 * save (`prompt.marks`, refuse a mark) both call it. A declaration is the `Template locks:` block and the
 * `Template styling:` block (§3.4.9), each read through its public projection (names only — never a line's tail or the
 * block text). A part both locked and styled is locked (the lock wins).
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

/**
 * The declared parts of a stored template (the admin save reads the template it is about to attach marks to): the lock
 * block of its prompt and its styling. `styling` is what the template's card shows (the server reads it from the
 * prompts the compile reads, lib/template-director/compile-prompts.ts `templateCardStyling`); absent, the prompt's own
 * `Template styling:` block is read — the same thing for every template without a recipe.
 */
export function declaredPartKeysOfPrompt(promptText: string, styling?: DeclaredStyling | null): string[] {
  const locks = parseTemplateLocks(promptText);
  const own = styling === undefined ? publicStyling(parseTemplateStyling(promptText), locks) : styling;
  return declaredPartKeys({ locks: publicLocks(locks), styling: own });
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
  /**
   * The buyer chooses this part at make time (§3.4.9, S2): a hair or makeup part the template styles and does not lock
   * ("템플릿 스타일" or "내 사진 그대로"). The wardrobe has no such choice: a buyer's own outfit is the outfit photo.
   */
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
    const choice = state === 'styled' && (OWN_STYLE_PARTS as readonly string[]).includes(key);
    const marks = byPart.get(key) ?? [];
    if (marks.length === 0) {
      rows.push({ id: key, key, state, label, desc: null, from: null, to: null, choice });
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
        choice,
      });
    });
  }
  return rows;
}

// --- The make card (§3.4.9, S2) --------------------------------------------------------------------------------------

/** The buyer's pick for a styled hair or makeup part: the template's style (the default) or their own. */
export type StyleChoice = 'template' | 'mine';
export type StyleChoices = Partial<Record<OwnStylePart, StyleChoice>>;

/** The make card's words for the parts (templates.fixed and editSheet.style…, composed by the template page). */
export interface TemplatePartsCopy {
  heading: string;
  lockedAll: string;
  /** State words (templates.fixed). */
  locked: string;
  styled: string;
  photo: string;
  /** The choice (editSheet.style…). */
  choiceLabel: string;
  template: string;
  mine: string;
  templateNote: string;
  mineHair: string;
  mineMakeup: string;
  overridden: string;
  outfitPhoto: string;
  outfitPhotoCta: string;
  outfitAttached: string;
  /** Founder 2026-11-25 — under a "내 사진 그대로" option that would not fit the template's clip. */
  tooLong?: string;
}

/** One row of the make card's parts card: a part, its state, the admin's descriptions, and whether the buyer chooses it. */
export interface TemplatePartRow {
  key: string;
  state: PartState;
  label: string;
  desc: string | null;
  choice: boolean;
}

/** Folds the page's view (one row per mark) to one row per part, the descriptions joined. */
export function partRows(view: readonly TemplatePartView[]): TemplatePartRow[] {
  const rows: TemplatePartRow[] = [];
  for (const part of view) {
    const row = rows.find((r) => r.key === part.key);
    if (!row) {
      rows.push({ key: part.key, state: part.state, label: part.label, desc: part.desc, choice: part.choice });
      continue;
    }
    if (part.desc && !(row.desc ?? '').split(' · ').includes(part.desc)) row.desc = row.desc ? `${row.desc} · ${part.desc}` : part.desc;
  }
  return rows;
}

/** The parts the order keeps as the buyer's own: chosen, offered as a choice, and not changed by an explicit edit. */
export function ownForOrder(rows: readonly TemplatePartRow[], choices: StyleChoices, overridden: readonly string[]): OwnStylePart[] {
  return OWN_STYLE_PARTS.filter(
    (part) => choices[part] === 'mine' && rows.some((row) => row.key === part && row.choice) && !overridden.includes(part),
  );
}

/**
 * The spec the order posts: exactly `spec` (the same value) with nothing own; otherwise `spec` (or the panel's
 * no-change defaults) with `own`.
 */
export function withOwnChoice(spec: PersonalDirectorSpec | null, own: readonly OwnStylePart[]): PersonalDirectorSpec | null {
  if (own.length === 0) return spec;
  return { ...(spec ?? { audioMode: 'ambient' }), own: [...own] };
}

/**
 * The `directorSpec` value an order posts (null = no field at all): with nothing own, exactly what was posted before
 * this choice existed (`JSON.stringify` of the panel's spec, or nothing); otherwise that spec with `own`.
 */
export function orderSpecField(
  spec: PersonalDirectorSpec | null,
  rows: readonly TemplatePartRow[],
  choices: StyleChoices,
  overridden: readonly string[],
): string | null {
  const next = withOwnChoice(spec, ownForOrder(rows, choices, overridden));
  return next ? JSON.stringify(next) : null;
}
