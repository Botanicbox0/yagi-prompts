/**
 * docs/PERSONAL-STUDIO.md §3.3, §3.4.9 — the one reader of a template's header-led blocks: `Template locks:` (./locks)
 * and `Template styling:` (./styling). A block is its header line, then every line up to the next blank line, the
 * OTHER block's header line, or the end. Both parsers and both save checks read through here, so a save check can never
 * call "valid" a block its parser reads differently.
 *
 * The other block's header ends a block, so a lock block followed directly by a styling block (no blank line) reads as
 * two blocks. A prompt with no `Template styling:` line reads its lock block exactly as before.
 *
 * Client-safe: no node-only imports.
 */

/** A `Template locks:` header line (any case, surrounding spaces allowed). */
export const TEMPLATE_LOCKS_HEADER_LINE = /^[ \t]*template locks:[ \t]*\r?$/i;

/** A `Template styling:` header line (any case, surrounding spaces allowed). */
export const TEMPLATE_STYLING_HEADER_LINE = /^[ \t]*template styling:[ \t]*\r?$/i;

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — a `Template styling:` block's limits and the key phrases its lines may name (the
 * lock block's phrases for the same parts). Here so that ./styling (which reads the block) and ./locks (which says an
 * admin refusal of either block) share one value without importing each other.
 */
export const TEMPLATE_STYLING_LIMITS = { max: 4, tailMax: 120 } as const;
export const TEMPLATE_STYLING_KEY_PHRASES = ['the hairstyle', 'the makeup', 'the wardrobe'] as const;

/** The 0-based indexes of the lines a header matches. */
export function headerLineIndexes(lines: readonly string[], header: RegExp): number[] {
  return lines.flatMap((line, i) => (header.test(line) ? [i] : []));
}

export interface HeaderBlock {
  /** The header's 0-based line. */
  at: number;
  /** One past the block's last line. */
  end: number;
  /** The header and its lines exactly as written (no trailing blank line). */
  block: string;
  /** The lines under the header. */
  body: string[];
}

/** The block whose header is at line `at`; a line `stop` matches (the other block's header) ends it. */
export function readHeaderBlock(lines: readonly string[], at: number, stop: RegExp): HeaderBlock {
  let end = at + 1;
  while (end < lines.length && lines[end]!.trim() !== '' && !stop.test(lines[end]!)) end += 1;
  return { at, end, block: lines.slice(at, end).join('\n').trimEnd(), body: lines.slice(at + 1, end) };
}

// --- A block in a compiled prompt -----------------------------------------------------------------------------------

/** Line ranges [start, end) of every header-led block in a compiled prompt: the header plus the `-` lines right after it. */
export function dashBlockRanges(lines: readonly string[], header: RegExp): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!header.test(lines[i]!)) continue;
    let end = i + 1;
    while (end < lines.length && /^[ \t]*-/.test(lines[end]!)) end += 1;
    ranges.push([i, end]);
    i = end - 1;
  }
  return ranges;
}

/** Removes the given line ranges and closes the gap they leave. */
export function withoutLineRanges(text: string, lines: readonly string[], ranges: ReadonlyArray<[number, number]>): string {
  if (ranges.length === 0) return text;
  const drop = new Set(ranges.flatMap(([s, e]) => Array.from({ length: e - s }, (_, k) => s + k)));
  return lines
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Makes sure `block` (a template's own block, exactly as written) is in the prompt: any other block under the same
 * header (a rewrite's altered copy) is taken out, and `block` is appended when the prompt no longer contains it verbatim.
 */
export function ensureHeaderBlock(prompt: string, block: string, header: RegExp): string {
  const at = prompt.indexOf(block);
  const lines = prompt.split('\n');
  let offset = 0;
  const starts = lines.map((l) => {
    const s = offset;
    offset += l.length + 1;
    return s;
  });
  const foreign = dashBlockRanges(lines, header).filter(([s]) => at < 0 || starts[s]! < at || starts[s]! >= at + block.length);
  const cleaned = withoutLineRanges(prompt, lines, foreign);
  return cleaned.includes(block) ? cleaned : `${cleaned.trimEnd()}\n\n${block}`;
}

/** A block problem as a refusal names it: one on a line (with or without its text), or a count over a limit. */
export type HeaderBlockProblem = { kind: string; line: number; text?: string } | { kind: string; count: number; max: number };

/** Problems named in a refusal; the rest are counted. */
const REFUSAL_SHOWN = 3;
/** The admin keeps 200 characters of a refusal's detail in the address it returns to (`outcomeUrl`). */
const REFUSAL_MAX = 200;

/**
 * The detail an admin save returns when it refuses a block: `<field>: <label>: line 4 unknown_line, too_many_lines
 * 13/12, +2 — "<the first problem's line>"`. Always within 200 characters.
 */
export function headerBlockRefusalDetail(field: string, label: string, problems: readonly HeaderBlockProblem[]): string {
  const tokens = problems.slice(0, REFUSAL_SHOWN).map((p) => ('line' in p ? `line ${p.line} ${p.kind}` : `${p.kind} ${p.count}/${p.max}`));
  if (problems.length > REFUSAL_SHOWN) tokens.push(`+${problems.length - REFUSAL_SHOWN}`);
  const head = `${field}: ${label}: ${tokens.join(', ')}`;
  const first = problems[0];
  const said = first && 'text' in first && typeof first.text === 'string' ? first.text.replace(/"/g, "'").replace(/\s+/g, ' ').trim() : '';
  const room = Math.min(60, REFUSAL_MAX - head.length - 5);
  if (!said || room < 12) return head;
  return `${head} — "${said.length > room ? `${said.slice(0, room - 1)}…` : said}"`;
}
