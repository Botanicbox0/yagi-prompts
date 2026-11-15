/**
 * "빈 곳 채우기": filling the empty canvas around the picture with ordinary partial edits
 * (`region_edit`). Pure planning (no DOM): which strips to send, the picture that is sent, and where a
 * finished strip lands. Behind `BRAND_STUDIO_OUTPAINT` (lib/flags.ts); the editor offers it only when
 * the empty area lies on one axis (left/right or top/bottom). A corner needs the strip next to it filled
 * first, so margins on both axes are not offered in this version.
 *
 * How it rides on the partial edit (lib/brand-studio/region-edit): the picture sent is the whole canvas
 * with the picture at its place and each empty margin filled by stretching the picture's nearest row or
 * column, so the edit model and the server's tone match see real colours. Each strip is a box in
 * fractions of that canvas covering the whole margin plus an overlap into the picture. The composite
 * blends with a feather that lies entirely inside the box: at least max(4 px, 3 % of the box's short
 * side), widened up to 12 % of the short side where strong contours cross the box edge (align.ts
 * `computeDiffMask`). The overlap is 25 % of the margin and at least 32 px, which is about twice that
 * widest feather, so the blend toward the picture happens over real picture pixels.
 */
import type { RegionBox } from "@/lib/brand-studio/contracts";
import { baseRect, emptyMargins } from "./canvas";
import type { Box, LayerDoc } from "./model";

export type FillSide = "left" | "right" | "top" | "bottom";

export interface FillStrip {
  side: FillSide;
  /** Fractions of the canvas (the picture that is sent), a valid `RegionBox`. */
  box: RegionBox;
}

/** Overlap into the picture: this share of the margin, at least `FILL_OVERLAP_MIN` pixels. */
export const FILL_OVERLAP_SHARE = 0.25;
export const FILL_OVERLAP_MIN = 32;
/** `RegionBoxSchema`: at least 2 % per side. */
const BOX_MIN = 0.02;

/**
 * The strips that fill the empty area, or none: none when nothing is empty, when the empty area lies on
 * both axes, or when the picture is too small for a valid box. Opposite strips each take at most half
 * of the picture, so they never cross.
 */
export function fillStrips(doc: LayerDoc): FillStrip[] {
  const m = emptyMargins(doc);
  const across = m.left > 0 || m.right > 0;
  const down = m.top > 0 || m.bottom > 0;
  if (across === down) return [];
  const total = across ? doc.width : doc.height;
  const [startSide, endSide]: [FillSide, FillSide] = across ? ["left", "right"] : ["top", "bottom"];
  const start = across ? m.left : m.top;
  const end = across ? m.right : m.bottom;
  // The picture covers everything between the two margins on this axis.
  const span = total - start - end;
  const count = (start > 0 ? 1 : 0) + (end > 0 ? 1 : 0);
  const room = Math.floor(span / count);
  const minSize = Math.ceil(BOX_MIN * total);

  const strips: FillStrip[] = [];
  for (const [side, margin] of [
    [startSide, start],
    [endSide, end],
  ] as const) {
    if (margin <= 0) continue;
    const overlap = Math.min(room, Math.max(FILL_OVERLAP_MIN, Math.ceil(margin * FILL_OVERLAP_SHARE)));
    const size = Math.min(margin + room, Math.max(margin + overlap, minSize));
    if (size < minSize || size > total) return [];
    const at = side === startSide ? 0 : (total - size) / total;
    const share = size / total;
    strips.push({ side, box: across ? { x: at, y: 0, w: share, h: 1 } : { x: 0, y: at, w: 1, h: share } });
  }
  return strips;
}

/** What a finished strip needs to land: the canvas and the picture's place when it was sent. */
export interface FillSent {
  width: number;
  height: number;
  base: Box;
}

export function fillSentOf(doc: LayerDoc): FillSent {
  return { width: doc.width, height: doc.height, base: { ...baseRect(doc) } };
}

/**
 * A finished strip in canvas pixels now. Its box is in fractions of the canvas as it was sent; it keeps
 * its place relative to the picture, wherever the picture sits after any resize while waiting.
 */
export function placeFillPatch(doc: LayerDoc, sent: FillSent, box: RegionBox | Box): Box {
  const now = baseRect(doc);
  return {
    x: now.x + box.x * sent.width - sent.base.x,
    y: now.y + box.y * sent.height - sent.base.y,
    w: box.w * sent.width,
    h: box.h * sent.height,
  };
}

/** One `drawImage(picture, sx, sy, sw, sh, dx, dy, dw, dh)`: source in the picture's natural pixels. */
export interface FillDrawOp {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * The picture that is sent: the canvas at its size, the picture at `baseRect` (no layers), and each
 * empty margin covered by stretching the picture's nearest edge column or row across it.
 */
export function planFillSource(doc: LayerDoc, natural: { width: number; height: number }): { width: number; height: number; ops: FillDrawOp[] } {
  const b = baseRect(doc);
  const m = emptyMargins(doc);
  const pw = natural.width;
  const ph = natural.height;
  const ops: FillDrawOp[] = [{ sx: 0, sy: 0, sw: pw, sh: ph, dx: b.x, dy: b.y, dw: b.w, dh: b.h }];
  if (m.left > 0) ops.push({ sx: 0, sy: 0, sw: 1, sh: ph, dx: 0, dy: b.y, dw: m.left, dh: b.h });
  if (m.right > 0) ops.push({ sx: pw - 1, sy: 0, sw: 1, sh: ph, dx: b.x + b.w, dy: b.y, dw: m.right, dh: b.h });
  if (m.top > 0) ops.push({ sx: 0, sy: 0, sw: pw, sh: 1, dx: b.x, dy: 0, dw: b.w, dh: m.top });
  if (m.bottom > 0) ops.push({ sx: 0, sy: ph - 1, sw: pw, sh: 1, dx: b.x, dy: b.y + b.h, dw: b.w, dh: m.bottom });
  return { width: doc.width, height: doc.height, ops };
}

/** The edit model's instruction per strip. Fixed English, never customer text. */
export function fillInstruction(side: FillSide): string {
  return (
    `Fill the stretched band along the ${side.toUpperCase()} edge with a natural continuation of the scene: ` +
    "continue the background, surfaces, light and shadows. Add no new objects, people or text. " +
    "Keep everything else exactly as it is."
  );
}
