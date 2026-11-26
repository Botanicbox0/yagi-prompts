/**
 * How a sent video prompt is cut into picture pages (the video prompt shield). One rule, used by the job view to
 * say how many pages there are (no rendering, no font file: ./glyph-widths.ts holds the font's advances) and by
 * the renderer (./render.ts) to draw them, so the count always matches the pictures.
 *
 * The text is drawn exactly: line breaks kept, long lines wrapped at spaces (a word wider than a line is cut by
 * characters), every character the font cannot draw shown as a box. Nothing is ever asked of the network.
 */
import { GLYPH_RUNS, GLYPH_UNITS_PER_EM } from './glyph-widths';

export const PROMPT_PAGE = {
  /** Pixels of the picture (2x: shown at up to 360 CSS px wide). */
  width: 720,
  padX: 36,
  padY: 40,
  fontSize: 30,
  lineHeight: 48,
  linesPerPage: 24,
  /** Cap so a 15,000-character Korean or mixed prompt fits without truncation; past this the last line says it goes on. */
  maxPages: 32,
  /** Lines are filled to this share of the text width, a margin for kerning. */
  fill: 0.97,
} as const;

/** What a character the font does not have is drawn as. */
export const PROMPT_BOX = '□';
/** The last line of the last page when the text goes on past `maxPages`. */
export const PROMPT_MORE = '…';

const TAB = '    ';
/** Invisible marks and format characters are dropped (a variation selector must not become a box). */
const DROPPED = /[\p{Mn}\p{Me}\p{Cf}]/u;

let bmp: Int32Array | null = null;
let astral: Array<[number, number, number]> | null = null;

function load(): void {
  if (bmp) return;
  bmp = new Int32Array(0x10000);
  astral = [];
  for (const run of GLYPH_RUNS.split(';')) {
    const [start, end, advance] = run.split(',').map((n) => parseInt(n, 36)) as [number, number, number];
    for (let cp = start; cp <= end && cp < 0x10000; cp += 1) bmp[cp] = advance;
    if (end >= 0x10000) astral.push([Math.max(start, 0x10000), end, advance]);
  }
}

/** The advance of one code point in font units; 0 when the font cannot draw it. */
export function glyphAdvance(cp: number): number {
  load();
  if (cp < 0x10000) return bmp![cp]!;
  const hit = astral!.find(([a, b]) => cp >= a && cp <= b);
  return hit ? hit[2] : 0;
}

/**
 * The text as it will be drawn: one kind of line break, tabs as spaces, invisible marks dropped, and every
 * character the font lacks replaced by the box. After this every character has a glyph in the font, so the
 * renderer never looks for another one.
 */
export function drawableText(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC').replace(/\r\n?/g, '\n')) {
    if (ch === '\n') out += ch;
    else if (ch === '\t') out += TAB;
    else if (DROPPED.test(ch)) continue;
    else out += glyphAdvance(ch.codePointAt(0)!) > 0 ? ch : PROMPT_BOX;
  }
  return out;
}

const budget = (): number =>
  Math.floor(((PROMPT_PAGE.width - 2 * PROMPT_PAGE.padX) / PROMPT_PAGE.fontSize) * GLYPH_UNITS_PER_EM * PROMPT_PAGE.fill);

function widthOf(s: string): number {
  let w = 0;
  for (const ch of s) w += glyphAdvance(ch.codePointAt(0)!);
  return w;
}

/** One logical line wrapped to the text width (greedy, at spaces; a too-wide word is cut by characters). */
function wrapLine(line: string, max: number): string[] {
  if (line === '') return [''];
  const out: string[] = [];
  let current = '';
  let width = 0;
  for (const token of line.split(/( +)/).filter((t) => t !== '')) {
    const w = widthOf(token);
    if (width + w <= max) {
      current += token;
      width += w;
      continue;
    }
    if (token.startsWith(' ')) {
      // The spaces at a break are not carried to the next line.
      if (current !== '') out.push(current);
      current = '';
      width = 0;
      continue;
    }
    if (current !== '' && w <= max) {
      out.push(current);
      current = token;
      width = w;
      continue;
    }
    for (const ch of token) {
      const cw = glyphAdvance(ch.codePointAt(0)!);
      if (width + cw > max && current !== '') {
        out.push(current);
        current = '';
        width = 0;
      }
      current += ch;
      width += cw;
    }
  }
  out.push(current);
  return out;
}

/** The pages of a sent prompt: each a list of lines drawn as they are. Always at least one page. */
export function promptPages(text: string): string[][] {
  const max = budget();
  const lines = drawableText(text).split('\n').flatMap((line) => wrapLine(line, max));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += PROMPT_PAGE.linesPerPage) pages.push(lines.slice(i, i + PROMPT_PAGE.linesPerPage));
  if (pages.length > PROMPT_PAGE.maxPages) {
    const kept = pages.slice(0, PROMPT_PAGE.maxPages);
    kept[kept.length - 1]![PROMPT_PAGE.linesPerPage - 1] = PROMPT_MORE;
    return kept;
  }
  return pages.length ? pages : [['']];
}

export function promptPageCount(text: string): number {
  return promptPages(text).length;
}

/** The picture's height for a page of `lines` lines. */
export function promptPageHeight(lines: number): number {
  return PROMPT_PAGE.padY * 2 + Math.max(1, lines) * PROMPT_PAGE.lineHeight;
}
