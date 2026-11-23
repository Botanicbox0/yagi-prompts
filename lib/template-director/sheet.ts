/**
 * docs/PERSONAL-STUDIO.md §2.3 — the personal edit sheet's pure functions (P1a, flag `TWINGS_PERSONAL_EDIT_SHEET`).
 *
 * The customer's words become three blocks: `change` (one line per editable slot, optionally limited to some shots
 * and bound to an attached reference photo), `keep` and `exclude`. A new request that collides with a line replaces
 * that line in place (its old text goes to `was`, newest last, two at most); "revert" takes the last `was` back, or
 * removes the line when there is none. The studio may ask one question per conversation, never two.
 *
 * Every sheet that reaches the server is untrusted: `cleanPersonalSheet` + `guardPersonalSheet` run before anything
 * reads it, on every turn and again when the prompt is compiled. Texts stay in the customer's language; Stage 2
 * translates them.
 *
 * Client-safe: plain functions over the types in `./schema` and `lib/revision/sheet-core`; no node-only imports.
 */
import { normSheetText, sheetTextKey, uniqueSheetTexts } from '@/lib/revision/sheet-core';
import {
  CUSTOM_DIRECTOR_REF_SLOTS,
  DIRECTOR_EDITABLE_SLOTS,
  PERSONAL_SHEET_ELEMENT_SLOTS,
  PERSONAL_SHEET_LIMITS,
  type CustomDirectorRefSlot,
  type DirectorEditableSlot,
  type DirectorSummaryChip,
  type PersonalEditSheet,
  type PersonalSheetBlock,
  type PersonalSheetChange,
  type PersonalSheetElementSlot,
  type PersonalSheetQuestion,
  type PersonalSheetState,
  type PersonalSheetTurn,
  type SheetCompileLine,
  type SheetCompilePlan,
} from './schema';

const L = PERSONAL_SHEET_LIMITS;

// --- Text guard ---------------------------------------------------------------------------------------------------

/** Stage-1 pre-model refusal: attempts to extract or override the private prompt and instructions. */
export const PROMPT_INJECTION_REGEX =
  /(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions|system\s*prompt|base\s*recipe|print\s+(?:the\s+)?(?:exact\s+)?(?:system|seedance|master)\s*prompt|reveal\s+(?:the\s+)?prompt|이전\s*지시.*무시|원본\s*(?:영어\s*)?프롬프트.*출력|시스템\s*프롬프트.*출력|스킬\s*규칙.*출력)/iu;

/** Stage-1 pre-model refusal: another person's face. Only the customer's own face is used (terms §5.3). */
export const IDENTITY_SWAP_REGEX =
  /(?:swap\s+face|replace\s+(?:the\s+)?(?:face|identity)|(?:다른|남의|타인|연예인)\s*(?:사람\s*)?(?:얼굴|사진).*바꿔)/iu;

/** Reference handles are numbered by the server in fill order (§2.2); a customer line never carries one. */
const REFERENCE_HANDLE_REGEX = /@\s*(?:image|video|audio)\s*\d/i;

export type SheetTextVerdict = 'ok' | 'identity' | 'unsafe';

/** Whether a sheet text may reach a model or a prompt. */
export function guardSheetText(text: string): SheetTextVerdict {
  const normalized = String(text).normalize('NFKC');
  if (IDENTITY_SWAP_REGEX.test(normalized)) return 'identity';
  if (PROMPT_INJECTION_REGEX.test(normalized) || REFERENCE_HANDLE_REGEX.test(normalized)) return 'unsafe';
  return 'ok';
}

const passes = (text: unknown): text is string => typeof text === 'string' && guardSheetText(text) === 'ok';

// --- Small helpers ------------------------------------------------------------------------------------------------

export const emptyPersonalSheet = (): PersonalEditSheet => ({ change: [], keep: [], exclude: [] });
export const emptyPersonalSheetState = (): PersonalSheetState => ({ sheet: emptyPersonalSheet(), turns: [], question: null, asked: false });

const isSlot = (value: unknown): value is DirectorEditableSlot =>
  typeof value === 'string' && (DIRECTOR_EDITABLE_SLOTS as readonly string[]).includes(value);
const isRef = (value: unknown): value is CustomDirectorRefSlot =>
  typeof value === 'string' && (CUSTOM_DIRECTOR_REF_SLOTS as readonly string[]).includes(value);
const isElementSlot = (slot: DirectorEditableSlot): slot is PersonalSheetElementSlot =>
  (PERSONAL_SHEET_ELEMENT_SLOTS as readonly string[]).includes(slot);

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = normSheetText(value).slice(0, max).trim();
  return text || null;
}

type Shots = NonNullable<PersonalSheetChange['shots']>;

/** undefined = no shots given; null = shots given but unusable (the line is dropped rather than widened to all shots). */
function cleanShots(value: unknown): Shots | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return null;
  const { from, to } = value as { from?: unknown; to?: unknown };
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= L.shotMax;
  if (!ok(from) || !ok(to) || from > to) return null;
  return { from, to };
}

const sameShots = (a?: Shots, b?: Shots): boolean => (!a && !b) || (!!a && !!b && a.from === b.from && a.to === b.to);

/** Same slot, photo and shots: an earlier value of one is an earlier value of the other. */
const sameScope = (a: PersonalSheetChange, b: PersonalSheetChange): boolean =>
  a.slot === b.slot && (a.ref ?? null) === (b.ref ?? null) && sameShots(a.shots, b.shots);

const sameRequest = (a: PersonalSheetChange, b: PersonalSheetChange): boolean =>
  sameScope(a, b) && sheetTextKey(a.text) === sheetTextKey(b.text);

function line(
  text: string,
  slot: DirectorEditableSlot,
  ref?: CustomDirectorRefSlot,
  shots?: Shots,
  was?: readonly string[],
): PersonalSheetChange {
  return {
    text,
    slot,
    ...(ref ? { ref } : {}),
    ...(shots ? { shots: { from: shots.from, to: shots.to } } : {}),
    ...(was && was.length ? { was: [...was] } : {}),
  };
}

const withWas = (l: PersonalSheetChange, was: readonly string[] | undefined): PersonalSheetChange =>
  line(l.text, l.slot, l.ref, l.shots, was);

function sameLine(a: PersonalSheetChange, b: PersonalSheetChange): boolean {
  const wa = a.was ?? [];
  const wb = b.was ?? [];
  return a.text === b.text && sameScope(a, b) && wa.length === wb.length && wa.every((t, i) => t === wb[i]);
}

function sameSheet(a: PersonalEditSheet, b: PersonalEditSheet): boolean {
  const sameTexts = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((t, i) => t === y[i]);
  return (
    a.change.length === b.change.length &&
    a.change.every((l, i) => sameLine(l, b.change[i]!)) &&
    sameTexts(a.keep, b.keep) &&
    sameTexts(a.exclude, b.exclude)
  );
}

// --- Cleaning and guarding ----------------------------------------------------------------------------------------

function cleanLine(raw: unknown): PersonalSheetChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = clip(r.text, L.itemMax);
  if (!text || !isSlot(r.slot)) return null;
  const shots = cleanShots(r.shots);
  if (shots === null) return null;
  const was = Array.isArray(r.was)
    ? r.was
        .map((t) => clip(t, L.itemMax))
        .filter((t): t is string => t !== null && sheetTextKey(t) !== sheetTextKey(text))
        .slice(-L.wasMax)
    : [];
  return line(text, r.slot, isRef(r.ref) ? r.ref : undefined, shots, was);
}

const lineKey = (l: PersonalSheetChange): string =>
  `${l.slot}|${l.shots ? `${l.shots.from}-${l.shots.to}` : ''}|${sheetTextKey(l.text)}`;

/** Any sheet-shaped value as a valid sheet: trimmed, de-duplicated, clamped; bad lines dropped. Never throws. */
export function cleanPersonalSheet(raw: unknown): PersonalEditSheet {
  try {
    const r = (raw && typeof raw === 'object' ? raw : {}) as { change?: unknown; keep?: unknown; exclude?: unknown };
    const change: PersonalSheetChange[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(r.change) ? r.change : []) {
      const l = cleanLine(item);
      if (!l || seen.has(lineKey(l))) continue;
      seen.add(lineKey(l));
      change.push(l);
      if (change.length >= L.changeMax) break;
    }
    return {
      change,
      keep: uniqueSheetTexts(Array.isArray(r.keep) ? r.keep : [], L.keepMax),
      exclude: uniqueSheetTexts(Array.isArray(r.exclude) ? r.exclude : [], L.excludeMax),
    };
  } catch {
    return emptyPersonalSheet();
  }
}

/** Drops every text that fails `guardSheetText`, in every block and in `was`; `dropped` counts them. */
export function guardPersonalSheet(sheet: PersonalEditSheet): { sheet: PersonalEditSheet; dropped: number } {
  let dropped = 0;
  const keepIt = (text: string): boolean => {
    if (passes(text)) return true;
    dropped += 1;
    return false;
  };
  const change = sheet.change.flatMap((l) => {
    if (!keepIt(l.text)) return [];
    if (!l.was) return [l];
    const was = l.was.filter(keepIt);
    return [was.length === l.was.length ? l : withWas(l, was)];
  });
  const keep = sheet.keep.filter(keepIt);
  const exclude = sheet.exclude.filter(keepIt);
  return { sheet: dropped === 0 ? sheet : { change, keep, exclude }, dropped };
}

function cleanQuestion(raw: unknown): PersonalSheetQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as { point?: unknown; text?: unknown; options?: unknown };
  const point = clip(q.point, L.pointMax);
  const text = clip(q.text, L.questionMax);
  if (!point || !text || !passes(point) || !passes(text)) return null;
  const options = uniqueSheetTexts(
    (Array.isArray(q.options) ? q.options : []).map((o) => clip(o, L.optionMax)).filter((o): o is string => o !== null && passes(o)),
    L.optionsMax,
  );
  return { point, text, options };
}

/** The state the screen sent (the `sheet` form field), cleaned and guarded. Never throws. */
export function cleanPersonalSheetState(raw: unknown): PersonalSheetState {
  try {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const sheet = guardPersonalSheet(cleanPersonalSheet(r.sheet)).sheet;
    const turns: PersonalSheetTurn[] = [];
    for (const item of Array.isArray(r.turns) ? r.turns : []) {
      if (!item || typeof item !== 'object') continue;
      const { role, text } = item as { role?: unknown; text?: unknown };
      if (role !== 'customer' && role !== 'studio') continue;
      const clipped = typeof text === 'string' ? text.trim().slice(0, L.turnTextMax).trim() : '';
      if (!clipped || !passes(clipped)) continue;
      turns.push({ role, text: clipped });
    }
    const question = cleanQuestion(r.question);
    return { sheet, turns: turns.slice(-L.turnsMax), question, asked: r.asked === true || question !== null };
  } catch {
    return emptyPersonalSheetState();
  }
}

// --- Editing ------------------------------------------------------------------------------------------------------

/**
 * Two lines collide when they name the same slot and either both are ranged with overlapping shots, or both are
 * unranged and the slot is not `shot_action` (several whole-video actions may stand side by side). A ranged and an
 * unranged line never collide.
 */
export function conflictsWith(a: Pick<PersonalSheetChange, 'slot' | 'shots'>, b: Pick<PersonalSheetChange, 'slot' | 'shots'>): boolean {
  if (a.slot !== b.slot) return false;
  if (a.shots && b.shots) return a.shots.from <= b.shots.to && b.shots.from <= a.shots.to;
  if (!a.shots && !b.shots) return a.slot !== 'shot_action';
  return false;
}

type Entry = { id: number; line: PersonalSheetChange };

/** `incoming` in place of `old`; the old text joins `was` only when it was the same scope (slot, photo, shots). */
function replacement(old: PersonalSheetChange, incoming: PersonalSheetChange): PersonalSheetChange {
  if (!sameScope(old, incoming)) return line(incoming.text, incoming.slot, incoming.ref, incoming.shots);
  const was = [...(old.was ?? []), old.text].filter((t) => sheetTextKey(t) !== sheetTextKey(incoming.text)).slice(-L.wasMax);
  return line(incoming.text, incoming.slot, incoming.ref, incoming.shots, was);
}

/**
 * Applies one change to a list of lines that carry a stable id (the index in the sheet a reading saw). Every
 * colliding line is replaced: the first in place, the rest removed. `replacesId` names a line of the same slot to
 * replace even without a collision (two whole-video actions). A list at the cap takes no new line.
 */
function applyToEntries(entries: Entry[], incoming: PersonalSheetChange, replacesId: number | null, newId: number): Entry[] {
  const targets: number[] = [];
  entries.forEach((e, i) => {
    const named = replacesId !== null && e.id === replacesId && e.line.slot === incoming.slot;
    if (named || conflictsWith(e.line, incoming)) targets.push(i);
  });
  if (targets.length === 0) {
    if (entries.some((e) => sameRequest(e.line, incoming))) return entries;
    if (entries.length >= L.changeMax) return entries;
    return [...entries, { id: newId, line: line(incoming.text, incoming.slot, incoming.ref, incoming.shots) }];
  }
  const first = targets[0]!;
  const old = entries[first]!.line;
  if (targets.length === 1 && sameRequest(old, incoming)) return entries;
  const next = replacement(old, incoming);
  return entries.flatMap((e, i) => (i === first ? [{ id: e.id, line: next }] : targets.includes(i) ? [] : [e]));
}

const toSheet = (sheet: PersonalEditSheet, entries: Entry[]): PersonalEditSheet => ({ ...sheet, change: entries.map((e) => e.line) });

/** Adds a change line, replacing every line it collides with (or the line `opts.replaces` names, same slot). */
export function applyChange(sheet: PersonalEditSheet, incoming: PersonalSheetChange, opts: { replaces?: number } = {}): PersonalEditSheet {
  const text = clip(incoming.text, L.itemMax);
  if (!text || !isSlot(incoming.slot)) return sheet;
  const entries = sheet.change.map((l, id) => ({ id, line: l }));
  const replaces = typeof opts.replaces === 'number' && Number.isInteger(opts.replaces) ? opts.replaces : null;
  const next = applyToEntries(entries, { ...incoming, text }, replaces, entries.length);
  return next === entries ? sheet : toSheet(sheet, next);
}

export function removeLine(sheet: PersonalEditSheet, block: PersonalSheetBlock, index: number): PersonalEditSheet {
  const list = sheet[block] as readonly unknown[];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return sheet;
  if (block === 'change') return { ...sheet, change: sheet.change.filter((_, i) => i !== index) };
  if (block === 'keep') return { ...sheet, keep: sheet.keep.filter((_, i) => i !== index) };
  return { ...sheet, exclude: sheet.exclude.filter((_, i) => i !== index) };
}

/** The line back to its previous text, or null when it has none (back to the template's default). */
function revertedLine(l: PersonalSheetChange): PersonalSheetChange | null {
  const was = l.was ?? [];
  if (was.length === 0) return null;
  return line(was[was.length - 1]!, l.slot, l.ref, l.shots, was.slice(0, -1));
}

export function revertChange(sheet: PersonalEditSheet, index: number): PersonalEditSheet {
  const target = Number.isInteger(index) ? sheet.change[index] : undefined;
  if (!target) return sheet;
  const back = revertedLine(target);
  return {
    ...sheet,
    change: back ? sheet.change.map((l, i) => (i === index ? back : l)) : sheet.change.filter((_, i) => i !== index),
  };
}

/** Every line of one slot removed (the slot back to the template's default). */
export function removeSlot(sheet: PersonalEditSheet, slot: DirectorEditableSlot): PersonalEditSheet {
  return { ...sheet, change: sheet.change.filter((l) => l.slot !== slot) };
}

const withoutRef = (l: PersonalSheetChange): PersonalSheetChange => line(l.text, l.slot, undefined, l.shots, l.was);

/** The photo taken away: lines that took from it keep their words but no longer bind it. */
export function dropRef(sheet: PersonalEditSheet, ref: CustomDirectorRefSlot): PersonalEditSheet {
  return { ...sheet, change: sheet.change.map((l) => (l.ref === ref ? withoutRef(l) : l)) };
}

export function addKeep(sheet: PersonalEditSheet, text: string): PersonalEditSheet {
  const keep = uniqueSheetTexts([...sheet.keep, text], L.keepMax);
  return keep.length === sheet.keep.length ? sheet : { ...sheet, keep };
}

export function addExclude(sheet: PersonalEditSheet, text: string): PersonalEditSheet {
  const exclude = uniqueSheetTexts([...sheet.exclude, text], L.excludeMax);
  return exclude.length === sheet.exclude.length ? sheet : { ...sheet, exclude };
}

// --- One turn -----------------------------------------------------------------------------------------------------

/** What a Stage-1 reading (or the heuristic) proposes for a turn. Every field is untrusted and checked here. */
export interface PersonalSheetDelta {
  set?: readonly unknown[];
  remove?: readonly unknown[];
  revert?: readonly unknown[];
  keep?: readonly unknown[];
  exclude?: readonly unknown[];
  question?: unknown;
}

const asList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const indexIn = (value: unknown, length: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length ? value : null;

/**
 * Settles one turn deterministically: removals and reverts (by the index the reading saw), then the new lines in
 * order, then keep and exclude items. Lines with a slot outside `editableSlots` are dropped and references that are
 * not attached are unbound, on the earlier lines too. Texts that fail the guard never land. A question is kept only
 * when none was asked yet in this conversation. `turns` is returned as given (the caller appends the turn).
 */
export function settleSheetTurn(input: {
  prior: PersonalSheetState;
  reading: PersonalSheetDelta;
  attachedRefs: readonly CustomDirectorRefSlot[];
  editableSlots: readonly DirectorEditableSlot[];
}): PersonalSheetState & { changed: boolean } {
  const { prior, reading } = input;
  const allowed = new Set<string>(input.editableSlots);
  const attached = new Set<string>(input.attachedRefs);

  const removed: Record<PersonalSheetBlock, Set<number>> = { change: new Set(), keep: new Set(), exclude: new Set() };
  for (const item of asList(reading.remove).slice(0, L.removeMax)) {
    if (!item || typeof item !== 'object') continue;
    const { block, index } = item as { block?: unknown; index?: unknown };
    if (block !== 'change' && block !== 'keep' && block !== 'exclude') continue;
    const i = indexIn(index, prior.sheet[block].length);
    if (i !== null) removed[block].add(i);
  }
  const reverted = new Set<number>();
  for (const value of asList(reading.revert).slice(0, L.revertMax)) {
    const i = indexIn(value, prior.sheet.change.length);
    if (i !== null) reverted.add(i);
  }

  let entries: Entry[] = prior.sheet.change.flatMap((l, id) => {
    if (removed.change.has(id)) return [];
    const kept = reverted.has(id) ? revertedLine(l) : l;
    return kept ? [{ id, line: kept }] : [];
  });
  entries = entries
    .filter((e) => allowed.has(e.line.slot))
    .map((e) => (e.line.ref && !attached.has(e.line.ref) ? { id: e.id, line: withoutRef(e.line) } : e));

  let nextId = prior.sheet.change.length;
  for (const raw of asList(reading.set).slice(0, L.setMax)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const text = clip(r.text, L.itemMax);
    if (!text || !passes(text) || !isSlot(r.slot) || !allowed.has(r.slot)) continue;
    const shots = cleanShots(r.shots);
    if (shots === null) continue;
    const ref = isRef(r.ref) && attached.has(r.ref) ? r.ref : undefined;
    const replaces = typeof r.replaces === 'number' && Number.isInteger(r.replaces) ? r.replaces : null;
    entries = applyToEntries(entries, line(text, r.slot, ref, shots), replaces, nextId);
    nextId += 1;
  }

  const added = (list: unknown, max: number) => asList(list).slice(0, max).filter(passes);
  const keep = uniqueSheetTexts([...prior.sheet.keep.filter((_, i) => !removed.keep.has(i)), ...added(reading.keep, L.keepAddMax)], L.keepMax);
  const exclude = uniqueSheetTexts(
    [...prior.sheet.exclude.filter((_, i) => !removed.exclude.has(i)), ...added(reading.exclude, L.excludeAddMax)],
    L.excludeMax,
  );
  const sheet: PersonalEditSheet = { change: entries.map((e) => e.line), keep, exclude };

  const question = prior.asked ? null : cleanQuestion(reading.question);
  return {
    sheet,
    turns: prior.turns,
    question,
    asked: prior.asked || question !== null,
    changed: !sameSheet(prior.sheet, sheet),
  };
}

/** The turn's two lines appended to the kept conversation (the most recent `turnsMax`). */
export function appendSheetTurns(turns: readonly PersonalSheetTurn[], customer: string, studio: string): PersonalSheetTurn[] {
  const next = [...turns];
  const c = customer.trim().slice(0, L.turnTextMax).trim();
  const s = studio.trim().slice(0, L.turnTextMax).trim();
  if (c) next.push({ role: 'customer', text: c });
  if (s) next.push({ role: 'studio', text: s });
  return next.slice(-L.turnsMax);
}

// --- Chips, orders, compile ---------------------------------------------------------------------------------------

/** Korean chip labels per slot (the same words the chips path has always used). */
export const SHEET_SLOT_LABEL_KO: Readonly<Record<DirectorEditableSlot, string>> = {
  outfit: '의상',
  makeup: '메이크업',
  hair: '헤어',
  prop: '소품',
  shot_action: '연출',
  lighting_mood: '분위기',
};

/** One summary chip per change line, written next to the sheet so a compile with the flag off still has them. */
export function chipsFromSheet(sheet: PersonalEditSheet): DirectorSummaryChip[] {
  return sheet.change.map((l) => {
    const label = SHEET_SLOT_LABEL_KO[l.slot];
    const range = l.shots ? (l.shots.from === l.shots.to ? `${l.shots.from}컷` : `${l.shots.from}~${l.shots.to}컷`) : null;
    return { slot: l.slot, labelKo: range ? `${label} · ${range}` : label, summaryKo: l.text.slice(0, 200) };
  });
}

/** The sheet an order carries: no history. */
export function sheetForOrder(sheet: PersonalEditSheet): PersonalEditSheet {
  return { change: sheet.change.map((l) => line(l.text, l.slot, l.ref, l.shots)), keep: [...sheet.keep], exclude: [...sheet.exclude] };
}

export function hasSheetContent(sheet: unknown): boolean {
  if (!sheet || typeof sheet !== 'object') return false;
  const s = sheet as { change?: unknown; keep?: unknown; exclude?: unknown };
  const some = (v: unknown) => Array.isArray(v) && v.length > 0;
  return some(s.change) || some(s.keep) || some(s.exclude);
}

/**
 * A request the customer typed but did not send before ordering becomes one unranged `shot_action` line. With the
 * change block full it joins the last unranged `shot_action` line instead. Text that fails the guard is not added.
 */
export function foldPendingNote(sheet: PersonalEditSheet, note: string): PersonalEditSheet {
  const text = clip(note, L.itemMax);
  if (!text || !passes(text)) return sheet;
  const incoming = line(text, 'shot_action');
  if (sheet.change.some((l) => sameRequest(l, incoming))) return sheet;
  if (sheet.change.length < L.changeMax) return { ...sheet, change: [...sheet.change, incoming] };
  let at = -1;
  sheet.change.forEach((l, i) => {
    if (l.slot === 'shot_action' && !l.shots) at = i;
  });
  if (at < 0) return sheet;
  const target = sheet.change[at]!;
  const joined = clip(`${target.text} · ${text}`, L.itemMax) ?? target.text;
  return { ...sheet, change: sheet.change.map((l, i) => (i === at ? line(joined, l.slot, l.ref, l.shots) : l)) };
}

/**
 * Sorts a (guarded) sheet by where each line goes in the prompt. A line's photo counts only when that photo is on
 * the job; attached photos no line names are listed so each still gets its default role. `was` never travels.
 */
export function planSheetCompile(sheet: PersonalEditSheet, refs: { look: boolean; prop: boolean; scene: boolean }): SheetCompilePlan {
  const present = new Set<CustomDirectorRefSlot>([
    ...(refs.look ? (['look_ref'] as const) : []),
    ...(refs.prop ? (['prop_ref'] as const) : []),
    ...(refs.scene ? (['scene_ref'] as const) : []),
  ]);
  const plan: SheetCompilePlan = {
    elements: [],
    style: [],
    actions: [],
    ranged: [],
    unboundRefs: [],
    replaced: [],
    keep: [...sheet.keep],
    exclude: [...sheet.exclude],
  };
  const bound = new Set<CustomDirectorRefSlot>();
  for (const l of sheet.change) {
    const ref = l.ref && present.has(l.ref) ? l.ref : null;
    if (ref) bound.add(ref);
    const entry: SheetCompileLine = { slot: l.slot, text: l.text, ref };
    if (l.shots) {
      plan.ranged.push({ ...entry, from: l.shots.from, to: l.shots.to });
    } else if (isElementSlot(l.slot)) {
      plan.elements.push(entry);
      if (!plan.replaced.includes(l.slot)) plan.replaced.push(l.slot);
    } else if (l.slot === 'lighting_mood') {
      plan.style.push(entry);
    } else {
      plan.actions.push(entry);
    }
  }
  plan.unboundRefs = CUSTOM_DIRECTOR_REF_SLOTS.filter((r) => present.has(r) && !bound.has(r));
  return plan;
}
