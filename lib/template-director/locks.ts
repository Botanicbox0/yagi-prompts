/**
 * docs/PERSONAL-STUDIO.md §3.3 — template locks (C1: the model and compile-time enforcement).
 *
 * A campaign template can forbid changing the product, the brand logo, the sound, certain shots, or any of the six
 * director slots. The compiler is never told which template it compiles (it receives the base prompt and the
 * customer's untrusted spec), so a template declares its locks as a canonical block INSIDE its prompt text:
 *
 *   Template locks:
 *   - Keep exactly as in the template: the product — its shape, colour, label and logo placement, …
 *   - Keep exactly as in the template: shots 2–3 — action, framing, timing and what is shown, as written.
 *   - Keep exactly as in the template: the hairstyle — a bright pink chin-length bob.
 *
 * The block is safe to send to the provider as written and carries no reference handle, so the raw template text
 * and the text after `buildRenderPrompt` parse the same. Anything after a line's key (the "tail") is data: the
 * parser never reads meaning from it, `notes` exposes it, and the block travels exactly as the template wrote it.
 *
 * FAIL CLOSED: a header with no lock line, a line that does not match the closed key list, or too many lines locks
 * everything (`malformed`). A prompt without the header parses to `NO_LOCKS`, and every caller checks `locks.any`
 * before doing anything new, so such a prompt compiles exactly as before.
 *
 * Client-safe: plain functions over the types in `./schema`; no node-only imports.
 */
import {
  CUSTOM_DIRECTOR_REF_SLOTS,
  DIRECTOR_EDITABLE_SLOTS,
  PERSONAL_SHEET_LIMITS,
  type CustomDirectorRefSlot,
  type DirectorChatTurnResult,
  type DirectorEditableSlot,
  type DirectorEditIntent,
  type DirectorSummaryChip,
  type PersonalDirectorSpec,
  type PersonalEditSheet,
} from './schema';

// --- Shared wording and mappings ------------------------------------------------------------------------------------

/** The keep-line prefix of the customer's `Locks:` list (sheet compile) and of every template lock line. */
export const TEMPLATE_KEEP_LINE_PREFIX = '- Keep exactly as in the template: ' as const;

/** The header line of a template's lock block (distinct from the customer's `Locks:` list). */
export const TEMPLATE_LOCKS_HEADER = 'Template locks:' as const;

/** The reference photo that fills a slot: a locked slot closes it, an attached photo binds it. */
export const REF_OF_SLOT: Partial<Record<DirectorEditableSlot, CustomDirectorRefSlot>> = {
  outfit: 'look_ref',
  prop: 'prop_ref',
  lighting_mood: 'scene_ref',
};

/**
 * The heuristic's keyword lists, in the order it tries them. `shot_action` has no list: it is what a text with no
 * keyword falls to, never a positive match.
 */
const SLOT_KEYWORDS: ReadonlyArray<readonly [DirectorEditableSlot, RegExp]> = [
  ['outfit', /드레스|자켓|재킷|코트|셔츠|옷|의상|착장|outfit|dress|jacket/i],
  ['makeup', /화장|메이크업|블러셔|립|피부|makeup|lip/i],
  ['hair', /머리|헤어|앞머리|로우번|단발|생머리|안경|선글라스|hair|bangs/i],
  ['prop', /소품|가방|가지고|들고|제품|컵|prop|product/i],
  ['lighting_mood', /조명|배경|분위기|색감|lighting|mood|background/i],
];

/** The slot a text is about by the keyword lists (first match wins), or null when no keyword matched. */
export function heuristicSlotMatch(text: string): DirectorEditableSlot | null {
  const value = String(text ?? '');
  return SLOT_KEYWORDS.find(([, re]) => re.test(value))?.[0] ?? null;
}

/** The slot a typed request is about, by the heuristic's keyword lists (first match wins; none = `shot_action`). */
export function heuristicSlotOf(text: string): DirectorEditableSlot {
  return heuristicSlotMatch(text) ?? 'shot_action';
}

/** Every slot whose keyword list the text matches (positive matches only, in list order). */
export function keywordSlotsOf(text: string): DirectorEditableSlot[] {
  const value = String(text ?? '');
  return SLOT_KEYWORDS.filter(([, re]) => re.test(value)).map(([slot]) => slot);
}

// --- Model ----------------------------------------------------------------------------------------------------------

export const TEMPLATE_LOCK_NAMED = ['product', 'logo', 'sound'] as const;
export type TemplateLockName = (typeof TEMPLATE_LOCK_NAMED)[number];

/** One lock line. `note` is the template author's own tail text (rendered in place of the default wording). */
export type TemplateLock =
  | { kind: TemplateLockName; note?: string }
  | { kind: 'slot'; slot: DirectorEditableSlot; note?: string }
  | { kind: 'shots'; from: number; to: number; note?: string };

/** `max` lock lines per block; `shotRangesMax` shot lines. More = malformed (everything locked). */
export const TEMPLATE_LOCK_LIMITS = { max: 12, shotRangesMax: 4 } as const;

/** A lock line's tail text, keyed by its lock: 'product' | 'logo' | 'sound' | <slot> | 'shots-<from>-<to>'. */
export interface TemplateLockNote {
  key: string;
  note: string;
}

export interface TemplateLocks {
  /** A header was found (even a malformed block). Every new compile branch sits behind this. */
  any: boolean;
  /** The block did not parse: everything is locked. */
  malformed: boolean;
  named: readonly TemplateLockName[];
  /** Slots closed for the whole video, implied ones included (the product closes `prop`). */
  slots: readonly DirectorEditableSlot[];
  /** Locked shot ranges, merged and sorted. */
  shots: ReadonlyArray<{ from: number; to: number }>;
  /** Reference photos that are closed. */
  refs: readonly CustomDirectorRefSlot[];
  /** The block exactly as written in the prompt (header and lock lines, no trailing blank line); '' without one. */
  block: string;
  /** Each valid line's own tail text (not the default wording), in block order. */
  notes: readonly TemplateLockNote[];
}

const freezeLocks = (locks: TemplateLocks): TemplateLocks =>
  Object.freeze({
    ...locks,
    named: Object.freeze([...locks.named]),
    slots: Object.freeze([...locks.slots]),
    shots: Object.freeze(locks.shots.map((r) => Object.freeze({ from: r.from, to: r.to }))),
    refs: Object.freeze([...locks.refs]),
    notes: Object.freeze(locks.notes.map((n) => Object.freeze({ key: n.key, note: n.note }))),
  });

export const NO_LOCKS: TemplateLocks = freezeLocks({
  any: false,
  malformed: false,
  named: [],
  slots: [],
  shots: [],
  refs: [],
  block: '',
  notes: [],
});

const NAMED_PHRASE: Readonly<Record<TemplateLockName, string>> = {
  product: 'the product',
  logo: 'the brand logo',
  sound: 'the sound',
};

const SLOT_PHRASE: Readonly<Record<DirectorEditableSlot, string>> = {
  outfit: 'the wardrobe',
  makeup: 'the makeup',
  hair: 'the hairstyle',
  prop: 'the prop',
  shot_action: 'the direction',
  lighting_mood: 'the look and light',
};

/** The default explanatory tail per lock kind (slots have none: "the wardrobe."). */
const DEFAULT_TAIL: Readonly<Record<TemplateLockName | 'shots', string>> = {
  product:
    'its shape, colour, label and logo placement, in every shot where it appears. Never replace, restyle, cover or remove it, and take it from no uploaded reference image.',
  logo: 'its wording, colour and placement wherever it appears. Never alter, replace, blur or remove it.',
  sound: 'voice, music and effects as written. Add no music and replace nothing.',
  shots: 'action, framing, timing and what is shown, as written.',
};

/** "shot 2" or "shots 2–3" (en dash). */
export function shotsPhrase(range: { from: number; to: number }): string {
  return range.from === range.to ? `shot ${range.from}` : `shots ${range.from}–${range.to}`;
}

/** "shot 2", "shots 2–3 and 5", "shots 1–2, 4 and 6–7". */
export function shotListPhrase(ranges: ReadonlyArray<{ from: number; to: number }>): string {
  const parts = ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`));
  const single = ranges.length === 1 && ranges[0]!.from === ranges[0]!.to;
  const listed = parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
  return `${single ? 'shot' : 'shots'} ${listed}`;
}

function lockKey(lock: TemplateLock): string {
  if (lock.kind === 'slot') return lock.slot;
  if (lock.kind === 'shots') return `shots-${lock.from}-${lock.to}`;
  return lock.kind;
}

function lockPhrase(lock: TemplateLock): string {
  if (lock.kind === 'slot') return SLOT_PHRASE[lock.slot];
  if (lock.kind === 'shots') return shotsPhrase(lock);
  return NAMED_PHRASE[lock.kind];
}

function defaultTail(lock: TemplateLock): string {
  return lock.kind === 'slot' ? '' : DEFAULT_TAIL[lock.kind];
}

/** A note is one line of text: whitespace collapsed, trimmed. */
const cleanNote = (note: unknown): string => (typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '');

// --- Render ---------------------------------------------------------------------------------------------------------

/**
 * The canonical block for new templates: one line per lock, in the given order. A lock's `note` replaces the default
 * wording after the key ("the hairstyle — a bright pink chin-length bob."); without one the default is used.
 * An empty list renders nothing (a header with no line would lock everything).
 */
export function renderLockBlock(locks: readonly TemplateLock[]): string {
  if (locks.length === 0) return '';
  const lines = locks.map((lock) => {
    const tail = cleanNote(lock.note) || defaultTail(lock);
    return `${TEMPLATE_KEEP_LINE_PREFIX}${lockPhrase(lock)}${tail ? ` — ${tail}` : '.'}`;
  });
  return [TEMPLATE_LOCKS_HEADER, ...lines].join('\n');
}

// --- Parse ----------------------------------------------------------------------------------------------------------

/** A `Template locks:` header line (any case, surrounding spaces allowed). */
export const TEMPLATE_LOCKS_HEADER_LINE = /^[ \t]*template locks:[ \t]*\r?$/i;
const KEEP_PREFIX_SOURCE = TEMPLATE_KEEP_LINE_PREFIX.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ \\t]+');
const LOCK_LINE = new RegExp(`^[ \\t]*${KEEP_PREFIX_SOURCE}[ \\t]*(.*?)[ \\t\\r]*$`);
/** A key ends where no letter or digit follows ("the prop" is not "the product"). */
const KEY_END = '(?![\\p{L}\\p{N}_])';

const PHRASE_KEYS: ReadonlyArray<{ re: RegExp; lock: TemplateLock }> = [
  ...TEMPLATE_LOCK_NAMED.map((kind) => ({ phrase: NAMED_PHRASE[kind], lock: { kind } as TemplateLock })),
  ...DIRECTOR_EDITABLE_SLOTS.map((slot) => ({ phrase: SLOT_PHRASE[slot], lock: { kind: 'slot', slot } as TemplateLock })),
].map(({ phrase, lock }) => ({ re: new RegExp(`^${phrase.replace(/ /g, '[ \\t]+')}${KEY_END}`, 'iu'), lock }));

const SHOTS_KEY = new RegExp(`^shots?[ \\t]+(\\d{1,3})(?:[ \\t]*[-–][ \\t]*(\\d{1,3}))?${KEY_END}`, 'iu');
const TAIL_LEAD = /^[\s—–\-:;,.]+/u;

/** The lock a line's text (after the prefix) names, and the tail after its key; null = not on the closed list. */
function readLockKey(rest: string): { lock: TemplateLock; tail: string } | null {
  for (const { re, lock } of PHRASE_KEYS) {
    const m = re.exec(rest);
    if (m) return { lock, tail: rest.slice(m[0].length) };
  }
  const m = SHOTS_KEY.exec(rest);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (!(from >= 1 && to <= PERSONAL_SHEET_LIMITS.shotMax && from <= to)) return null;
  return { lock: { kind: 'shots', from, to }, tail: rest.slice(m[0].length) };
}

function mergeRanges(ranges: ReadonlyArray<{ from: number; to: number }>): Array<{ from: number; to: number }> {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Array<{ from: number; to: number }> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out;
}

function everythingLocked(block: string, notes: TemplateLockNote[]): TemplateLocks {
  return freezeLocks({
    any: true,
    malformed: true,
    named: [...TEMPLATE_LOCK_NAMED],
    slots: [...DIRECTOR_EDITABLE_SLOTS],
    shots: [],
    refs: [...CUSTOM_DIRECTOR_REF_SLOTS],
    block,
    notes,
  });
}

/**
 * Reads the `Template locks:` block from a prompt: the header line, then every line up to the next blank line (or
 * the end), each a keep line naming one key from the closed list. No header = `NO_LOCKS` (the same frozen object).
 */
export function parseTemplateLocks(promptText: string): TemplateLocks {
  if (typeof promptText !== 'string' || !/template locks:/i.test(promptText)) return NO_LOCKS;
  const lines = promptText.split('\n');
  const headers = lines.flatMap((l, i) => (TEMPLATE_LOCKS_HEADER_LINE.test(l) ? [i] : []));
  if (headers.length === 0) return NO_LOCKS;

  const at = headers[0]!;
  let end = at + 1;
  while (end < lines.length && lines[end]!.trim() !== '') end += 1;
  const block = lines.slice(at, end).join('\n').trimEnd();
  const body = lines.slice(at + 1, end);

  const entries: TemplateLock[] = [];
  const notes: TemplateLockNote[] = [];
  let malformed = headers.length > 1 || body.length === 0 || body.length > TEMPLATE_LOCK_LIMITS.max;
  let shotLines = 0;
  for (const raw of body) {
    const line = LOCK_LINE.exec(raw);
    const read = line ? readLockKey(line[1]!) : null;
    if (!read) {
      malformed = true;
      continue;
    }
    if (read.lock.kind === 'shots') shotLines += 1;
    entries.push(read.lock);
    const note = read.tail.replace(TAIL_LEAD, '').trimEnd();
    if (note && note !== defaultTail(read.lock)) notes.push({ key: lockKey(read.lock), note });
  }
  if (shotLines > TEMPLATE_LOCK_LIMITS.shotRangesMax) malformed = true;
  if (malformed) return everythingLocked(block, notes);

  const named = TEMPLATE_LOCK_NAMED.filter((kind) => entries.some((e) => e.kind === kind));
  const explicit = new Set(entries.flatMap((e) => (e.kind === 'slot' ? [e.slot] : [])));
  const product = named.includes('product');
  const slots = DIRECTOR_EDITABLE_SLOTS.filter((slot) => explicit.has(slot) || (slot === 'prop' && product));
  // The product closes every reference photo: on templates with fixed product references a customer photo would
  // get a wrong reference number, so customer photos are refused until the render service passes the real order.
  const refs = CUSTOM_DIRECTOR_REF_SLOTS.filter((ref) => product || slots.some((slot) => REF_OF_SLOT[slot] === ref));
  const shots = mergeRanges(entries.flatMap((e) => (e.kind === 'shots' ? [{ from: e.from, to: e.to }] : [])));
  return freezeLocks({ any: true, malformed: false, named, slots, shots, refs, block, notes });
}

// --- The public projection (C2) -------------------------------------------------------------------------------------

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C2) — the only lock shape that leaves the server: WHICH parts a template fixes, never
 * the words. `block` and `notes` are part of the template's prompt text, which can be hidden from customers, so they
 * never reach the browser, the cached public catalogue or an API answer. Built by naming every field (no spread).
 */
export interface PublicTemplateLocks {
  named: readonly TemplateLockName[];
  slots: readonly DirectorEditableSlot[];
  shots: ReadonlyArray<{ from: number; to: number }>;
  refs: readonly CustomDirectorRefSlot[];
  /** The block did not parse: everything is locked. */
  all: boolean;
}

/** The public projection of a template's locks; null when it has none. */
export function publicLocks(locks: TemplateLocks): PublicTemplateLocks | null {
  if (!locks.any) return null;
  return {
    named: [...locks.named],
    slots: [...locks.slots],
    shots: locks.shots.map((r) => ({ from: r.from, to: r.to })),
    refs: [...locks.refs],
    all: locks.malformed,
  };
}

/**
 * The browser's side of the projection: the verdict functions in this file over a `PublicTemplateLocks`, with no
 * block and no notes (the browser never has them). Unknown values are dropped. Null or absent = `NO_LOCKS`.
 */
export function locksFromPublic(locks: PublicTemplateLocks | null | undefined): TemplateLocks {
  if (!locks) return NO_LOCKS;
  const known = <T extends string>(list: readonly T[], values: unknown): T[] =>
    Array.isArray(values) ? list.filter((value) => values.includes(value)) : [];
  const shots = Array.isArray(locks.shots)
    ? locks.shots.filter(
        (r) => Number.isInteger(r?.from) && Number.isInteger(r?.to) && r.from >= 1 && r.from <= r.to && r.to <= PERSONAL_SHEET_LIMITS.shotMax,
      )
    : [];
  return freezeLocks({
    any: true,
    malformed: locks.all === true,
    named: known(TEMPLATE_LOCK_NAMED, locks.named),
    slots: known(DIRECTOR_EDITABLE_SLOTS, locks.slots),
    shots: mergeRanges(shots),
    refs: known(CUSTOM_DIRECTOR_REF_SLOTS, locks.refs),
    block: '',
    notes: [],
  });
}

/** The parts that are locked, as short English phrases ("the product", "the wardrobe", "shots 2–3"). */
export function lockPhrases(locks: TemplateLocks): string[] {
  if (!locks.any) return [];
  return [
    ...locks.named.map((kind) => NAMED_PHRASE[kind]),
    ...locks.slots.map((slot) => SLOT_PHRASE[slot]),
    ...locks.shots.map(shotsPhrase),
  ];
}

/** The block's lock lines as the template wrote them (header left out). */
export function lockLines(locks: TemplateLocks): string[] {
  if (!locks.any) return [];
  return locks.block
    .split('\n')
    .slice(1)
    .map((l) => l.trimEnd());
}

/** The slots a customer may still change. */
export function editableSlotsFor(locks: TemplateLocks): DirectorEditableSlot[] {
  return DIRECTOR_EDITABLE_SLOTS.filter((slot) => !locks.slots.includes(slot));
}

// --- Verdicts -------------------------------------------------------------------------------------------------------

/**
 * Words that name a locked part, in Korean and English. Over-blocking is acceptable here, under-blocking is not:
 * a line or exclusion that mentions a locked part never reaches the prompt.
 */
const NAMED_TEXT: Readonly<Record<TemplateLockName, RegExp>> = {
  product:
    /제품|상품|패키지|포장|용기|보틀|병|캔|라벨|굿즈|\b(?:products?|packag(?:e|es|ing)|bottles?|labels?|merch(?:andise)?|goods)\b/iu,
  logo: /로고|상표|브랜드|마크|엠블럼|워터마크|\b(?:logos?|logotypes?|brand(?:s|ing|ed)?|trademarks?|wordmarks?|emblems?|watermarks?)\b/iu,
  sound:
    /소리|음악|배경음|브금|목소리|음성|효과음|사운드|노래|대사|내레이션|나레이션|오디오|음향|멜로디|비트|\b(?:sounds?|music(?:al)?|bgm|voices?|voice-?overs?|audio|songs?|soundtracks?|score|melod(?:y|ies)|beats?|narrat(?:ion|or)|dialog(?:ue)?s?|sfx|foley|lyrics?|vocals?|sing(?:ing)?|hum(?:ming)?|whistl(?:e|ing))\b/iu,
};

/**
 * Whether a text mentions a part that is locked by name (product, logo, sound). Only the named locks that are
 * active are screened. A malformed block locks everything, so every text hits.
 */
export function lockTextHit(text: string, locks: TemplateLocks): boolean {
  if (!locks.any) return false;
  if (locks.malformed) return true;
  const normalized = String(text ?? '').normalize('NFKC');
  return locks.named.some((kind) => NAMED_TEXT[kind].test(normalized));
}

/**
 * Whether a text is about a closed slot by the keyword lists, whatever slot it is filed under ("빨간 드레스로" filed
 * as an action on a wardrobe-locked template). Only a POSITIVE keyword match counts: a text no list matches is never
 * read as `shot_action`, so a direction-locked template judges such a line by its own slot alone. Every list that
 * matches counts, not only the first (over-blocking is acceptable here, under-blocking is not).
 */
export function lockedSlotText(text: string, locks: TemplateLocks): boolean {
  if (!locks.any || locks.slots.length === 0) return false;
  return keywordSlotsOf(String(text ?? '').normalize('NFKC')).some((slot) => locks.slots.includes(slot));
}

/**
 * Whether a free text (an exclusion, a chip summary, an override, a shot edit) touches a locked part: it names one
 * (`lockTextHit`) or is about a closed slot (`lockedSlotText`). `keep` lines are never screened with this.
 */
export function lockedPartText(text: string, locks: TemplateLocks): boolean {
  return lockTextHit(text, locks) || lockedSlotText(text, locks);
}

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }): boolean => a.from <= b.to && b.from <= a.to;

/**
 * Why a change line may not land: its slot is closed, or its text is about a closed slot by the keyword lists
 * ('slot'), its shots overlap a locked range ('shots'; an unranged line is not caught here), or its text names a
 * locked part ('named'). 'ok' otherwise. Every caller (the turn, the sheet guard, the compile, the screen's fold of
 * unsent text) reads locks through this, so a line filed under an open slot cannot carry a closed one.
 */
export function lockVerdict(
  line: { slot: DirectorEditableSlot; text: string; shots?: { from: number; to: number } },
  locks: TemplateLocks,
): 'ok' | 'slot' | 'shots' | 'named' {
  if (!locks.any) return 'ok';
  if (locks.slots.includes(line.slot)) return 'slot';
  if (lockedSlotText(line.text, locks)) return 'slot';
  if (line.shots && locks.shots.some((r) => overlaps(r, line.shots!))) return 'shots';
  if (lockTextHit(line.text, locks)) return 'named';
  return 'ok';
}

const inLockedShot = (shot: number, locks: TemplateLocks): boolean => locks.shots.some((r) => shot >= r.from && shot <= r.to);

// --- Applying locks -------------------------------------------------------------------------------------------------

/**
 * A (cleaned) sheet without its locked change lines and the exclusions that touch a locked part (named, or about a
 * closed slot: "no hairpins" on a hair-locked template). `keep` lines are never dropped.
 */
export function lockSheet(sheet: PersonalEditSheet, locks: TemplateLocks): { sheet: PersonalEditSheet; dropped: number } {
  if (!locks.any) return { sheet, dropped: 0 };
  const change = sheet.change.filter((l) => lockVerdict(l, locks) === 'ok');
  const exclude = sheet.exclude.filter((t) => !lockedPartText(t, locks));
  const dropped = sheet.change.length - change.length + (sheet.exclude.length - exclude.length);
  return dropped === 0 ? { sheet, dropped } : { sheet: { ...sheet, change, exclude }, dropped };
}

/** Summary chips without those in a closed slot, about a closed slot, or naming a locked part (`lockVerdict`). */
export function lockChips(chips: readonly DirectorSummaryChip[], locks: TemplateLocks): DirectorSummaryChip[] {
  if (!locks.any) return [...chips];
  return chips.filter((c) => lockVerdict({ slot: c.slot, text: c.summaryKo }, locks) === 'ok');
}

/**
 * The intent with every locked override nulled, and locked shot edits and exclusions dropped: an override in a
 * closed slot, or any of them touching a locked part (named, or about a closed slot).
 */
export function lockIntent<T extends DirectorEditIntent>(intent: T, locks: TemplateLocks): T {
  if (!locks.any) return intent;
  const keep = (slot: DirectorEditableSlot, value: string | null | undefined): string | null | undefined =>
    value == null || (!locks.slots.includes(slot) && !lockedPartText(value, locks)) ? value : null;
  return {
    ...intent,
    hairOverrideEn: keep('hair', intent.hairOverrideEn) ?? null,
    makeupOverrideEn: keep('makeup', intent.makeupOverrideEn),
    outfitOverrideEn: keep('outfit', intent.outfitOverrideEn) ?? null,
    propOverrideEn: keep('prop', intent.propOverrideEn) ?? null,
    shotEdits: locks.slots.includes('shot_action')
      ? []
      : intent.shotEdits.filter((e) => !inLockedShot(e.shotIndex, locks) && !lockedPartText(e.actionEn, locks)),
    strictExclusionsEn: intent.strictExclusionsEn.filter((t) => !lockedPartText(t, locks)),
  } as T;
}

/** Whether an intent asks for anything. */
export function intentHasContent(intent: DirectorEditIntent | null | undefined): boolean {
  if (!intent) return false;
  return Boolean(
    intent.hairOverrideEn ||
      intent.makeupOverrideEn ||
      intent.outfitOverrideEn ||
      intent.propOverrideEn ||
      intent.shotEdits.length ||
      intent.strictExclusionsEn.length,
  );
}

/**
 * The customer's spec with everything a lock forbids taken out: chips in closed slots, locked intent overrides and
 * shot edits, note lines that name a locked part or whose slot (by the heuristic classifier) is closed, closed
 * reference photos, background music (a sound lock keeps the template's audio as written), and locked sheet lines
 * and exclusions (the same filter `guardPersonalSheet(sheet, locks)` applies; the compiler guards the sheet's text
 * again before reading it). With `NO_LOCKS` it returns the same object.
 *
 * A note line is filed under the classifier's slot (no keyword = `shot_action`, as before) and judged by
 * `lockVerdict`, so it gets the same keyword rule as a sheet line on top of what it already had.
 */
export function lockSpec(spec: PersonalDirectorSpec | null, locks: TemplateLocks): PersonalDirectorSpec | null {
  if (!spec || !locks.any) return spec;
  const next: PersonalDirectorSpec = { ...spec };
  if (spec.summaryChips) next.summaryChips = lockChips(spec.summaryChips, locks);
  if (spec.structuredIntent) next.structuredIntent = lockIntent(spec.structuredIntent, locks);
  if (typeof spec.userMessage === 'string') {
    const kept = spec.userMessage
      .split('\n')
      .filter((l) => l.trim() !== '' && lockVerdict({ slot: heuristicSlotOf(l), text: l }, locks) === 'ok');
    next.userMessage = kept.length > 0 ? kept.join('\n') : null;
  }
  if (spec.slotOverrides) next.slotOverrides = spec.slotOverrides.filter((ref) => !locks.refs.includes(ref));
  if (locks.named.includes('sound')) {
    next.audioMode = 'ambient';
    next.bgmMood = null;
  }
  if (spec.sheet) next.sheet = lockSheet(spec.sheet, locks).sheet;
  return next;
}

/**
 * A legacy chips turn (no sheet) with the locked chips and intent overrides taken out. When something was taken
 * out and nothing is left, the turn is refused as `unsupported` (the reply text stays; C2 supplies the copy).
 * Called by the route in C2; nothing calls it in C1.
 */
export function lockChipsTurn(result: DirectorChatTurnResult, locks: TemplateLocks): DirectorChatTurnResult {
  if (!locks.any || !result.approved || result.refusal !== 'none') return result;
  const summaryChips = lockChips(result.summaryChips, locks);
  const structuredIntent = result.structuredIntent ? lockIntent(result.structuredIntent, locks) : null;
  const touched =
    summaryChips.length !== result.summaryChips.length || JSON.stringify(structuredIntent) !== JSON.stringify(result.structuredIntent);
  if (!touched) return result;
  if (summaryChips.length === 0 && !intentHasContent(structuredIntent)) {
    return { ...result, approved: false, refusal: 'unsupported', readyToRender: false, summaryChips: [], structuredIntent: null, lockedHit: true };
  }
  return { ...result, summaryChips, structuredIntent, lockedHit: true };
}

// --- The block in a compiled prompt ---------------------------------------------------------------------------------

/** Line ranges [start, end) of every header-led block of lock lines (header plus the `-` lines right after it). */
function lockBlockRanges(lines: readonly string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!TEMPLATE_LOCKS_HEADER_LINE.test(lines[i]!)) continue;
    let end = i + 1;
    while (end < lines.length && /^[ \t]*-/.test(lines[end]!)) end += 1;
    ranges.push([i, end]);
    i = end - 1;
  }
  return ranges;
}

/** Removes the given line ranges and closes the gap they leave. */
function withoutRanges(text: string, lines: readonly string[], ranges: ReadonlyArray<[number, number]>): string {
  if (ranges.length === 0) return text;
  const drop = new Set(ranges.flatMap(([s, e]) => Array.from({ length: e - s }, (_, k) => s + k)));
  return lines
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The text with every `Template locks:` block taken out (used to check a rewrite without the template's own words). */
export function stripTemplateLockBlocks(text: string): string {
  if (!/template locks:/i.test(text)) return text;
  const lines = text.split('\n');
  return withoutRanges(text, lines, lockBlockRanges(lines));
}

/**
 * Makes sure the template's own block (`locks.block`, exactly as the template wrote it, notes included) is in the
 * prompt: any other `Template locks:` block (a rewrite's altered copy) is taken out, and the original is appended
 * when the prompt no longer contains it verbatim. Idempotent; with `NO_LOCKS` it returns the prompt as is.
 */
export function ensureTemplateLocks(prompt: string, locks: TemplateLocks): string {
  if (!locks.any || !locks.block) return prompt;
  const at = prompt.indexOf(locks.block);
  const lines = prompt.split('\n');
  let offset = 0;
  const starts = lines.map((l) => {
    const s = offset;
    offset += l.length + 1;
    return s;
  });
  const foreign = lockBlockRanges(lines).filter(([s]) => at < 0 || starts[s]! < at || starts[s]! >= at + locks.block.length);
  const cleaned = withoutRanges(prompt, lines, foreign);
  return cleaned.includes(locks.block) ? cleaned : `${cleaned.trimEnd()}\n\n${locks.block}`;
}
