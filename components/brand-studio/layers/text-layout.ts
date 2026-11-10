/**
 * Line breaking for text layers. The stage and the export both draw the lines this function returns,
 * so what is saved wraps exactly as it looked on screen. Breaks fall on spaces (Korean words stay
 * whole, like `word-break: keep-all`); a single word wider than the box breaks between characters.
 * `measure` returns the width of a string at the layer's font without letter spacing; spacing is added
 * here, one step after every character, the way CSS `letter-spacing` does.
 */
import type { TextAlign, TextLayer } from "./model";
import { fontChoice } from "./model";

export type Measure = (text: string) => number;

export interface TextLine {
  text: string;
  /** Offset from the left of the text box (content area). */
  x: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  lineHeightPx: number;
  /** Plate padding in pixels (0 without a plate). */
  pad: number;
  /** Content width the lines were broken to. */
  contentWidth: number;
  /** Full layer height including the plate padding. */
  height: number;
}

let segmenter: Intl.Segmenter | null | undefined;
/** Grapheme clusters: what CSS letter-spacing counts. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

export function lineWidth(text: string, measure: Measure, spacingPx: number): number {
  if (!text) return 0;
  return measure(text) + spacingPx * graphemes(text).length;
}

function breakWord(word: string, width: number, measure: Measure, spacingPx: number): string[] {
  const parts: string[] = [];
  let line = "";
  for (const g of graphemes(word)) {
    const candidate = line + g;
    if (line && lineWidth(candidate, measure, spacingPx) > width + 0.01) {
      parts.push(line);
      line = g;
    } else line = candidate;
  }
  if (line) parts.push(line);
  return parts;
}

export function breakLines(text: string, width: number, measure: Measure, spacingPx: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let line: string | null = null;
    // Starts a new line with `word`, splitting the word itself when it cannot fit on any line.
    const start = (word: string) => {
      if (word && lineWidth(word, measure, spacingPx) > width + 0.01) {
        const pieces = breakWord(word, width, measure, spacingPx);
        out.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? "";
      } else line = word;
    };
    for (const word of paragraph.split(" ")) {
      if (line === null) {
        start(word);
        continue;
      }
      const candidate: string = `${line} ${word}`;
      if (lineWidth(candidate, measure, spacingPx) <= width + 0.01) line = candidate;
      else {
        out.push(line);
        start(word);
      }
    }
    out.push(line ?? "");
  }
  return out;
}

export function alignOffset(align: TextAlign, box: number, line: number): number {
  if (align === "center") return (box - line) / 2;
  if (align === "right") return box - line;
  return 0;
}

export type TextStyle = Pick<TextLayer, "text" | "w" | "size" | "lineHeight" | "letterSpacing" | "align" | "plate">;

export function platePad(style: Pick<TextLayer, "size" | "plate">): number {
  return style.plate ? Math.max(0, style.plate.padding) * style.size : 0;
}

export function layoutText(style: TextStyle, measure: Measure): TextLayout {
  const pad = platePad(style);
  const contentWidth = Math.max(1, style.w - pad * 2);
  const spacingPx = style.letterSpacing * style.size;
  const lineHeightPx = style.size * style.lineHeight;
  const lines = breakLines(style.text, contentWidth, measure, spacingPx).map((text) => {
    const width = lineWidth(text, measure, spacingPx);
    return { text, width, x: alignOffset(style.align, contentWidth, width) };
  });
  return { lines, lineHeightPx, pad, contentWidth, height: Math.max(1, lines.length) * lineHeightPx + pad * 2 };
}

/** The canvas/CSS font shorthand for a layer, with the family already resolved to real names. */
export function fontShorthand(layer: Pick<TextLayer, "weight" | "size">, family: string): string {
  return `${layer.weight} ${layer.size}px ${family}`;
}

/** The CSS stack for the stage (may contain var()); the canvas needs `resolveFamily` in the browser. */
export const fontStack = (layer: Pick<TextLayer, "font">) => fontChoice(layer.font).stack;
