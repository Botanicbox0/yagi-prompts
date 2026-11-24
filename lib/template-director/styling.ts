/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — template styling (S1: the model, the save check and the compile; no screen).
 *
 * A template can style the person itself (a sleek low bun, 1990s smoky makeup) without locking it. Founder decision
 * 2026-11-24: when a template has set the hair or makeup, the buyer chooses at make time between the template's style
 * and their own. The compiler is never told which template it compiles, so the template declares its styling as a
 * second canonical block INSIDE its prompt text, next to `Template locks:`:
 *
 *   Template styling:
 *   - Styled by the template: the hairstyle — a sleek low bun.
 *   - Styled by the template: the makeup — 1990s smoky plum eyes and lips.
 *   - Taken from the photo: the wardrobe.
 *
 * Three states per part: locked (`Template locks:`, never changes), styled by the template (the buyer may keep their
 * own instead: `own` in the spec, hair and makeup only), taken from the photo. The default is the template's style:
 * nothing changes for a buyer who leaves it alone.
 *
 * FAIL QUIET: unlike locks, a malformed styling block parses to `NO_STYLING` (nothing is shown, nothing is claimed and
 * the prompt compiles as if the block were plain text). The admin save refuses it (`checkStylingBlock`), and refuses a
 * part that is both locked and declared here. At read time the lock wins.
 *
 * A prompt without the header parses to `NO_STYLING`, and every caller checks `styling.any` before doing anything new,
 * so such a prompt compiles exactly as before.
 *
 * Client-safe: plain functions over the types in `./schema`; no node-only imports.
 */
import {
  TEMPLATE_LOCKS_HEADER_LINE,
  TEMPLATE_STYLING_HEADER_LINE,
  TEMPLATE_STYLING_KEY_PHRASES,
  TEMPLATE_STYLING_LIMITS,
  dashBlockRanges,
  ensureHeaderBlock,
  headerBlockRefusalDetail,
  headerLineIndexes,
  readHeaderBlock,
  withoutLineRanges,
} from './header-block';
import { parseTemplateLocks, type TemplateLocks } from './locks';
import { OWN_STYLE_RULE_EN } from './morphic-production-playbook';
import {
  PERSONAL_OWN_STYLE_PARTS,
  type DirectorCast,
  type DirectorEditIntent,
  type PersonalDirectorSpec,
  type PersonalEditSheet,
  type PersonalOwnStylePart,
  type SheetCompilePlan,
  type TemplateStylingUse,
} from './schema';

export { TEMPLATE_STYLING_HEADER_LINE, TEMPLATE_STYLING_KEY_PHRASES, TEMPLATE_STYLING_LIMITS };

// --- Grammar --------------------------------------------------------------------------------------------------------

export const TEMPLATE_STYLING_HEADER = 'Template styling:' as const;
/** A part the template styles; the tail after the key says how (English prompt words, never shown to customers). */
export const TEMPLATE_STYLED_LINE_PREFIX = '- Styled by the template: ' as const;
/** A part the template takes from the customer's photo; no tail. */
export const TEMPLATE_PHOTO_LINE_PREFIX = '- Taken from the photo: ' as const;

/** The parts a styling line may name (the director slots of the same name). */
export const STYLE_PARTS = ['hair', 'makeup', 'outfit'] as const;
export type StylePart = (typeof STYLE_PARTS)[number];

/** The parts a buyer may keep as their own ("내 것 그대로"). Their own outfit is the outfit-photo slot, not this. */
export const OWN_STYLE_PARTS = PERSONAL_OWN_STYLE_PARTS;
export type OwnStylePart = PersonalOwnStylePart;

/** The key phrase per part: the lock block's phrase for the same slot. */
const PART_PHRASE: Readonly<Record<StylePart, string>> = {
  hair: TEMPLATE_STYLING_KEY_PHRASES[0],
  makeup: TEMPLATE_STYLING_KEY_PHRASES[1],
  outfit: TEMPLATE_STYLING_KEY_PHRASES[2],
};

/** The noun a compiled line uses for a part. */
const PART_NOUN: Readonly<Record<StylePart, string>> = { hair: 'hairstyle', makeup: 'makeup', outfit: 'wardrobe' };

// --- Model ----------------------------------------------------------------------------------------------------------

/** A part the template styles: `note` is the tail as the template wrote it, `line` the whole line (trimmed). */
export interface TemplateStyledPart {
  part: StylePart;
  note: string;
  line: string;
}

export interface TemplateStyling {
  /** A valid block was found. Every new compile branch sits behind this. */
  any: boolean;
  /** Parts the template styles, in block order. */
  styled: readonly TemplateStyledPart[];
  /** Parts the template takes from the photo, in block order. */
  photo: readonly StylePart[];
  /** The block exactly as written in the prompt (header and lines, no trailing blank line); '' without one. */
  block: string;
}

const freezeStyling = (styling: TemplateStyling): TemplateStyling =>
  Object.freeze({
    ...styling,
    styled: Object.freeze(styling.styled.map((s) => Object.freeze({ part: s.part, note: s.note, line: s.line }))),
    photo: Object.freeze([...styling.photo]),
  });

export const NO_STYLING: TemplateStyling = freezeStyling({ any: false, styled: [], photo: [], block: '' });

// --- Parse ----------------------------------------------------------------------------------------------------------

const prefixSource = (prefix: string): string =>
  prefix
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '[ \\t]+');
const STYLED_LINE = new RegExp(`^[ \\t]*${prefixSource(TEMPLATE_STYLED_LINE_PREFIX)}[ \\t]*(.*?)[ \\t\\r]*$`);
const PHOTO_LINE = new RegExp(`^[ \\t]*${prefixSource(TEMPLATE_PHOTO_LINE_PREFIX)}[ \\t]*(.*?)[ \\t\\r]*$`);
/** A key ends where no letter or digit follows. */
const KEY_END = '(?![\\p{L}\\p{N}_])';
const PART_KEYS: ReadonlyArray<{ part: StylePart; re: RegExp }> = STYLE_PARTS.map((part) => ({
  part,
  re: new RegExp(`^${PART_PHRASE[part].replace(/ /g, '[ \\t]+')}${KEY_END}`, 'iu'),
}));
const TAIL_LEAD = /^[\s—–\-:;,.]+/u;
/** After a photo line's key: nothing, or one full stop. */
const PHOTO_REST = /^[ \t]*\.?[ \t]*$/;

type StylingLine = { kind: 'styled'; part: StylePart; note: string; line: string } | { kind: 'photo'; part: StylePart; line: string };

/**
 * One styling line, or null when it is not on the grammar: an unknown prefix or key, a styled line with no tail, a
 * tail over the limit or carrying an `@` handle, a photo line with anything after its key.
 */
function readStylingLine(raw: string): StylingLine | null {
  const styled = STYLED_LINE.exec(raw);
  const photo = styled ? null : PHOTO_LINE.exec(raw);
  const rest = (styled ?? photo)?.[1];
  if (rest === undefined) return null;
  const key = PART_KEYS.find(({ re }) => re.test(rest));
  if (!key) return null;
  const after = rest.replace(key.re, '');
  const line = raw.trim();
  if (photo) return PHOTO_REST.test(after) ? { kind: 'photo', part: key.part, line } : null;
  const note = after.replace(TAIL_LEAD, '').trimEnd();
  if (!note || note.length > TEMPLATE_STYLING_LIMITS.tailMax || note.includes('@')) return null;
  return { kind: 'styled', part: key.part, note, line };
}

/**
 * One thing wrong with a prompt's styling block, with its 1-based line in the prompt where it has one. `text` is the
 * offending line, trimmed and cut to 120 characters.
 */
export type StylingBlockProblem =
  | { kind: 'unknown_line'; line: number; text: string }
  | { kind: 'empty_block'; line: number }
  | { kind: 'second_header'; line: number }
  | { kind: 'duplicate_part'; line: number; text: string }
  | { kind: 'locked_part'; line: number; text: string }
  | { kind: 'photo_clause'; line: number; text: string }
  | { kind: 'too_many_lines'; count: number; max: number };

const problemText = (line: string): string => line.trim().slice(0, 120);

/**
 * The block that starts at the first header (through the shared reader: a `Template locks:` header ends it). Any
 * problem makes it malformed. `parseTemplateStyling` and `checkStylingBlock` both read it here.
 */
function readBlock(lines: readonly string[], headers: readonly number[]) {
  const at = headers[0]!;
  const { block, body } = readHeaderBlock(lines, at, TEMPLATE_LOCKS_HEADER_LINE);
  const entries: Array<StylingLine & { at: number }> = [];
  const lined: Array<Extract<StylingBlockProblem, { line: number }>> = headers.slice(1).map((i) => ({ kind: 'second_header', line: i + 1 }));
  if (body.length === 0) lined.push({ kind: 'empty_block', line: at + 1 });
  body.forEach((raw, k) => {
    const lineNo = at + 2 + k;
    // A second header inside the block is reported once, as itself.
    if (TEMPLATE_STYLING_HEADER_LINE.test(raw)) return;
    const read = readStylingLine(raw);
    if (!read) {
      lined.push({ kind: 'unknown_line', line: lineNo, text: problemText(raw) });
      return;
    }
    if (entries.some((e) => e.part === read.part)) {
      lined.push({ kind: 'duplicate_part', line: lineNo, text: problemText(raw) });
      return;
    }
    entries.push({ ...read, at: lineNo });
  });
  const problems: StylingBlockProblem[] = lined.sort((x, y) => x.line - y.line);
  if (body.length > TEMPLATE_STYLING_LIMITS.max) problems.push({ kind: 'too_many_lines', count: body.length, max: TEMPLATE_STYLING_LIMITS.max });
  return { block, entries, problems };
}

function stylingOf(block: string, entries: ReadonlyArray<StylingLine>): TemplateStyling {
  return freezeStyling({
    any: true,
    styled: entries.flatMap((e) => (e.kind === 'styled' ? [{ part: e.part, note: e.note, line: e.line }] : [])),
    photo: entries.flatMap((e) => (e.kind === 'photo' ? [e.part] : [])),
    block,
  });
}

/**
 * Reads the `Template styling:` block from a prompt. No header, or a block with any problem, = `NO_STYLING` (the same
 * frozen object): a malformed block claims nothing.
 */
export function parseTemplateStyling(promptText: string): TemplateStyling {
  if (typeof promptText !== 'string' || !/template styling:/i.test(promptText)) return NO_STYLING;
  const lines = promptText.split('\n');
  const headers = headerLineIndexes(lines, TEMPLATE_STYLING_HEADER_LINE);
  if (headers.length === 0) return NO_STYLING;
  const { block, entries, problems } = readBlock(lines, headers);
  return problems.length > 0 ? NO_STYLING : stylingOf(block, entries);
}

// --- Render ---------------------------------------------------------------------------------------------------------

/** One declaration: styled by the template (with how), or taken from the photo. */
export type StylingEntry = { part: StylePart; from: 'template'; note: string } | { part: StylePart; from: 'photo' };

/** A note is one line of text: whitespace collapsed, trimmed. */
const cleanNote = (note: unknown): string => (typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '');

const photoLine = (part: StylePart): string => `${TEMPLATE_PHOTO_LINE_PREFIX}${PART_PHRASE[part]}.`;

/** The canonical block, one line per entry in the given order; an empty list renders nothing. */
export function renderStylingBlock(entries: readonly StylingEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) => (e.from === 'photo' ? photoLine(e.part) : `${TEMPLATE_STYLED_LINE_PREFIX}${PART_PHRASE[e.part]} — ${cleanNote(e.note)}`));
  return [TEMPLATE_STYLING_HEADER, ...lines].join('\n');
}

// --- The public projection (names only; S2 puts it on the catalogue card) -------------------------------------------

/** WHICH parts the template styles or takes from the photo, never the words. Locked parts are left out (the lock wins). */
export interface PublicTemplateStyling {
  styled: StylePart[];
  photo: StylePart[];
}

/** The public projection of a template's styling; null when it has none. Built by naming every field. */
export function publicStyling(styling: TemplateStyling, locks: TemplateLocks): PublicTemplateStyling | null {
  if (!styling.any) return null;
  const open = (part: StylePart): boolean => !locks.malformed && !locks.slots.includes(part);
  return {
    styled: styling.styled.filter((s) => open(s.part)).map((s) => s.part),
    photo: styling.photo.filter(open),
  };
}

// --- The save-time check --------------------------------------------------------------------------------------------

/**
 * A styled description that talks about following the buyer's photo ("colour and length stay as in the photo", "as
 * in the reference", "Image 1"). A styled line names only the template's style: when the buyer keeps their own hair or
 * makeup, its whole description becomes an `[Exclusions]` line ("the template's hairstyle (…)"), so a clause about the
 * photo would tell the model to avoid the photo. A part (or the rest of a part) that follows the photo is its own
 * "Taken from the photo" line, or no line at all (rule 3). Save-time only, like a locked part: the parse still reads such
 * a line, so nothing a stored template compiles changes.
 */
const PHOTO_CLAUSE = /\b(?:photo(?:graph)?s?|references?|image[ \t_]*1)\b|사진/iu;

export function stylingNoteFollowsPhoto(note: string): boolean {
  return PHOTO_CLAUSE.test(note);
}

/**
 * What the admin save makes of a prompt's styling block. Refused (`malformed`): a block that does not parse (it would
 * claim nothing), a part the lock block also names (`locked_part`; at read time the lock wins) and a styled description
 * that says to follow the photo (`photo_clause`, see `stylingNoteFollowsPhoto`).
 *
 * Agreement with `parseTemplateStyling`, by construction (both read through `readBlock`): `ok` only when the parse is
 * `any`, with the same public projection; `none` exactly when there is no header (the parse is `NO_STYLING`);
 * `malformed` with a problem other than `locked_part` and `photo_clause` exactly when a header is there and the parse
 * is `NO_STYLING`.
 */
export type StylingBlockCheck =
  | { state: 'none' }
  | { state: 'ok'; styling: PublicTemplateStyling }
  | { state: 'malformed'; problems: StylingBlockProblem[] };

export function checkStylingBlock(promptText: string): StylingBlockCheck {
  const lines = typeof promptText === 'string' ? promptText.split('\n') : [];
  const headers = headerLineIndexes(lines, TEMPLATE_STYLING_HEADER_LINE);
  if (headers.length === 0) return { state: 'none' };
  const { block, entries, problems } = readBlock(lines, headers);
  // A malformed lock block is refused by the lock check; only a readable one is held against the styling lines.
  const locks = parseTemplateLocks(promptText);
  const locked = locks.any && !locks.malformed ? entries.filter((e) => locks.slots.includes(e.part)) : [];
  const clauses = entries.filter((e) => e.kind === 'styled' && stylingNoteFollowsPhoto(e.note));
  const lined = [
    ...problems.flatMap((p) => ('line' in p ? [p] : [])),
    ...locked.map((e) => ({ kind: 'locked_part' as const, line: e.at, text: problemText(e.line) })),
    ...clauses.map((e) => ({ kind: 'photo_clause' as const, line: e.at, text: problemText(e.line) })),
  ].sort((x, y) => x.line - y.line);
  const all: StylingBlockProblem[] = [...lined, ...problems.filter((p) => !('line' in p))];
  if (all.length > 0) return { state: 'malformed', problems: all };
  return { state: 'ok', styling: publicStyling(stylingOf(block, entries), locks)! };
}

/** The detail an admin save returns when it refuses a styling block: `<field>: template styling: line 4 unknown_line …`. */
export function stylingBlockRefusalDetail(field: string, problems: readonly StylingBlockProblem[]): string {
  return headerBlockRefusalDetail(field, 'template styling', problems);
}

/** A block an author can copy and trim. */
export const TEMPLATE_STYLING_EXAMPLE = renderStylingBlock([
  { part: 'hair', from: 'template', note: 'a sleek low bun.' },
  { part: 'makeup', from: 'template', note: '1990s smoky plum eyes and lips.' },
  { part: 'outfit', from: 'photo' },
]);

// --- The buyer's choice ---------------------------------------------------------------------------------------------

/**
 * The style parts the customer changes by an explicit request: on the sheet path a change line's slot; otherwise an
 * intent override or a chip's slot; and an attached outfit photo. An explicit request wins over `own`, and a part it
 * changes is no longer kept "as the template styles it".
 */
export function explicitStyleParts(
  spec: PersonalDirectorSpec | null,
  ctx: { sheet?: PersonalEditSheet | null; hasOutfitRef?: boolean } = {},
): StylePart[] {
  const parts = new Set<string>();
  if (ctx.sheet) {
    for (const line of ctx.sheet.change) parts.add(line.slot);
  } else {
    const intent = spec?.structuredIntent;
    if (intent?.hairOverrideEn) parts.add('hair');
    if (intent?.makeupOverrideEn) parts.add('makeup');
    if (intent?.outfitOverrideEn) parts.add('outfit');
    for (const chip of spec?.summaryChips ?? []) parts.add(chip.slot);
  }
  if (ctx.hasOutfitRef) parts.add('outfit');
  return STYLE_PARTS.filter((part) => parts.has(part));
}

/**
 * The parts the buyer keeps as their own: the spec's `own`, limited to parts the template styles, minus locked parts
 * (the lock wins), minus parts the customer changes explicitly (the explicit request wins). Nothing for a pet, for a
 * template without a person, or without a valid block.
 */
export function ownChoiceFor(
  spec: PersonalDirectorSpec | null,
  styling: TemplateStyling,
  locks: TemplateLocks,
  ctx: { sheet?: PersonalEditSheet | null; cast?: DirectorCast; hasPersonSlot?: boolean; hasOutfitRef?: boolean } = {},
): OwnStylePart[] {
  const asked = spec?.own;
  if (!styling.any || !asked?.length || locks.malformed) return [];
  if ((ctx.cast ?? 'solo') === 'pet' || ctx.hasPersonSlot === false) return [];
  const explicit = explicitStyleParts(spec, ctx);
  return OWN_STYLE_PARTS.filter(
    (part) => asked.includes(part) && styling.styled.some((s) => s.part === part) && !locks.slots.includes(part) && !explicit.includes(part),
  );
}

/**
 * The base prompt with each own part's styled line switched to the photo form, everything else exactly as written.
 * Without a valid block or with nothing own, the same string.
 */
export function applyOwnChoice(basePrompt: string, styling: TemplateStyling, own: readonly OwnStylePart[]): string {
  if (!styling.any || own.length === 0 || !basePrompt.includes(styling.block)) return basePrompt;
  const next = styling.block
    .split('\n')
    .map((raw, i) => {
      if (i === 0) return raw;
      const read = readStylingLine(raw);
      return read?.kind === 'styled' && (own as readonly string[]).includes(read.part) ? photoLine(read.part) : raw;
    })
    .join('\n');
  return basePrompt.replace(styling.block, () => next);
}

/** One own part as the compiler writes it: the canonical rule (server text) and the exclusion with the template's tail. */
export interface OwnStylePlan {
  part: OwnStylePart;
  rule: string;
  exclusion: string;
}

/** The canonical rule for an own part (`OWN_STYLE_RULE_EN`), in the words the medium and the cast need. */
export function ownStyleRuleEn(part: OwnStylePart, ctx: { medium: 'image' | 'video'; cast?: DirectorCast }): string {
  const couple = ctx.cast === 'couple';
  const subject = couple ? 'each person' : 'the person';
  const photo = couple ? (ctx.medium === 'image' ? 'their own reference photo' : 'their own photo') : ctx.medium === 'image' ? 'the reference photo' : '@Image 1';
  return OWN_STYLE_RULE_EN[part].split('{subject}').join(subject).split('{photo}').join(photo);
}

/** The template's own styling of a part, named for `[Exclusions]` ("the template's hairstyle (a sleek low bun)"). */
function ownStyleExclusionEn(part: OwnStylePart, note: string): string {
  return `the template's ${PART_NOUN[part]} (${note.replace(/[\s.。!?;:,]+$/u, '')})`;
}

/** The compile plan for the own parts (in `OWN_STYLE_PARTS` order). */
export function ownStylePlan(
  styling: TemplateStyling,
  own: readonly OwnStylePart[],
  ctx: { medium: 'image' | 'video'; cast?: DirectorCast },
): OwnStylePlan[] {
  return OWN_STYLE_PARTS.flatMap((part) => {
    const styled = own.includes(part) ? styling.styled.find((s) => s.part === part) : undefined;
    return styled ? [{ part, rule: ownStyleRuleEn(part, ctx), exclusion: ownStyleExclusionEn(part, styled.note) }] : [];
  });
}

/** The chips path: an own part fills its override (an explicit one never reaches here) and adds its exclusion. */
export function withOwnStyleIntent<T extends DirectorEditIntent>(intent: T, plans: readonly OwnStylePlan[]): T {
  if (plans.length === 0) return intent;
  const rule = (part: OwnStylePart): string | null => plans.find((p) => p.part === part)?.rule ?? null;
  return {
    ...intent,
    hairOverrideEn: intent.hairOverrideEn ?? rule('hair'),
    makeupOverrideEn: intent.makeupOverrideEn ?? rule('makeup'),
    strictExclusionsEn: [...intent.strictExclusionsEn, ...plans.map((p) => p.exclusion)],
  };
}

/**
 * The sheet path: an own part becomes an element line (restated in every shot) and an exclusion. `replaced` also names
 * it among the replaced elements (the rewrite's doctrine reads it; the offline compile writes the tailed exclusion only).
 */
export function withOwnStyleSheetPlan(plan: SheetCompilePlan, plans: readonly OwnStylePlan[], opts: { replaced: boolean }): SheetCompilePlan {
  if (plans.length === 0) return plan;
  return {
    ...plan,
    elements: [...plan.elements, ...plans.map((p) => ({ slot: p.part, text: p.rule, ref: null }))],
    replaced: opts.replaced ? [...plan.replaced, ...plans.map((p) => p.part).filter((part) => !plan.replaced.includes(part))] : plan.replaced,
    exclude: [...plan.exclude, ...plans.map((p) => p.exclusion)],
  };
}

/**
 * What the rewrite is told about each styled part that is neither locked nor changed by the customer: kept as the
 * template styles it, or taken from the photo (`rule` carries the own part's canonical text; it never goes on the wire
 * as its own field).
 */
export function templateStylingUses(
  styling: TemplateStyling,
  locks: TemplateLocks,
  own: readonly OwnStylePart[],
  explicit: readonly StylePart[],
  plans: readonly OwnStylePlan[] = [],
): TemplateStylingUse[] {
  if (!styling.any || locks.malformed) return [];
  return styling.styled
    .filter((s) => !locks.slots.includes(s.part) && !explicit.includes(s.part))
    .map((s) => {
      const plan = (own as readonly string[]).includes(s.part) ? plans.find((p) => p.part === s.part) : undefined;
      return plan ? { part: s.part, use: 'own' as const, line: s.line, rule: plan.rule } : { part: s.part, use: 'template' as const, line: s.line };
    });
}

// --- The block in a compiled prompt ---------------------------------------------------------------------------------

/** The text with every `Template styling:` block taken out (used to check a rewrite without the template's own words). */
export function stripTemplateStylingBlocks(text: string): string {
  if (!/template styling:/i.test(text)) return text;
  const lines = text.split('\n');
  return withoutLineRanges(text, lines, dashBlockRanges(lines, TEMPLATE_STYLING_HEADER_LINE));
}

/**
 * Makes sure the expected block (`styling.block`: the template's, with own parts already in the photo form) is in the
 * prompt verbatim: any other `Template styling:` block is taken out and the expected one appended when missing.
 * Idempotent; with `NO_STYLING` it returns the prompt as is.
 */
export function ensureTemplateStyling(prompt: string, styling: TemplateStyling): string {
  if (!styling.any || !styling.block) return prompt;
  return ensureHeaderBlock(prompt, styling.block, TEMPLATE_STYLING_HEADER_LINE);
}

const OWN_LINE_LABEL: Readonly<Record<OwnStylePart, string>> = { hair: 'Hair from the photo', makeup: 'Makeup from the photo' };

/**
 * After a rewrite, for each own part: a leftover "Styled by the template" line for it goes, and its canonical rule is
 * added (before the template's blocks) when the rewrite did not keep it word for word. With nothing own, the prompt as is.
 */
export function ensureOwnStyle(prompt: string, own: ReadonlyArray<{ part: OwnStylePart; rule: string }>): string {
  if (own.length === 0) return prompt;
  const parts: readonly string[] = own.map((o) => o.part);
  const lines = prompt.split('\n').filter((raw) => {
    const read = readStylingLine(raw);
    return !(read?.kind === 'styled' && parts.includes(read.part));
  });
  const text = lines.join('\n');
  const added = own.filter((o) => !text.includes(o.rule)).map((o) => `${OWN_LINE_LABEL[o.part]}: ${o.rule}.`);
  if (added.length > 0) {
    const at = lines.findIndex((l) => TEMPLATE_STYLING_HEADER_LINE.test(l) || TEMPLATE_LOCKS_HEADER_LINE.test(l));
    if (at < 0) lines.push('', ...added);
    else lines.splice(at, 0, '', ...added, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
