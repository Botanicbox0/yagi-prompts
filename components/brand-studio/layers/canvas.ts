/**
 * The canvas of the "꾸미기" editor: its size and where the base picture sits on it. Pure edits on
 * the layer document (no DOM, no React). The canvas is `doc.width × doc.height`; the picture sits at
 * `baseRect(doc)` and keeps its stored size. Changing the canvas never moves anything relative to the
 * picture: the picture and every layer shift together.
 */
import type { RegionBox } from "@/lib/brand-studio/contracts";
import type { Point, View } from "./geometry";
import { clamp, type Box, type LayerDoc } from "./model";

export const CANVAS_RATIOS = ["1:1", "4:5", "3:4", "9:16", "16:9", "21:9"] as const;
export type CanvasRatio = (typeof CANVAS_RATIOS)[number];

export const CANVAS_MIN = 64;
/**
 * Per side. The export is stored through the studio upload, whose decoder accepts at most
 * 12,000 × 12,000 pixels (lib/brand-studio/files.ts `limitInputPixels`), so no canvas within this
 * limit can produce a file the upload refuses.
 */
export const CANVAS_MAX = 12_000;

export type CanvasHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export const CANVAS_HANDLES: readonly CanvasHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export type CanvasAnchor = { x: 0 | 0.5 | 1; y: 0 | 0.5 | 1 };

export interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the picture sits on the canvas, in canvas pixels. */
export function baseRect(doc: LayerDoc): Box {
  return doc.base ?? { x: 0, y: 0, w: doc.width, h: doc.height };
}

const covers = (b: Box, width: number, height: number) => b.x === 0 && b.y === 0 && b.w === width && b.h === height;

export function isCanvasResized(doc: LayerDoc): boolean {
  return Boolean(doc.base) && !covers(doc.base!, doc.width, doc.height);
}

/** A whole number of pixels within the limits. */
export function clampCanvasSide(value: number): number {
  return clamp(Math.round(Number.isFinite(value) ? value : CANVAS_MIN), CANVAS_MIN, CANVAS_MAX);
}

/**
 * The canvas at `width × height` with its content (picture and layers) moved by `dx, dy`. The same
 * object when nothing changes; `base` is left out when the picture covers the canvas exactly.
 */
function placeCanvas(doc: LayerDoc, width: number, height: number, dx: number, dy: number): LayerDoc {
  if (width === doc.width && height === doc.height && !dx && !dy) return doc;
  const b = baseRect(doc);
  const base = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
  const { base: _old, ...rest } = doc;
  const layers = dx || dy ? doc.layers.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })) : doc.layers;
  return { ...rest, width, height, layers, ...(covers(base, width, height) ? {} : { base }) };
}

/** Sets the canvas size; `anchor` is the point of the old canvas that stays where it is. */
export function resizeCanvas(doc: LayerDoc, size: { width: number; height: number }, anchor: CanvasAnchor): LayerDoc {
  const width = clampCanvasSide(size.width);
  const height = clampCanvasSide(size.height);
  return placeCanvas(doc, width, height, Math.round((width - doc.width) * anchor.x), Math.round((height - doc.height) * anchor.y));
}

/**
 * The canvas after dragging `handle` by `dx, dy` document pixels, always from `doc` (the document the
 * drag started with). The edge opposite the handle stays where it is, also when the size is clamped.
 */
export function resizeFromHandle(doc: LayerDoc, handle: CanvasHandle, dx: number, dy: number): LayerDoc {
  let width = doc.width;
  let height = doc.height;
  let shiftX = 0;
  let shiftY = 0;
  if (handle.includes("e")) width = clampCanvasSide(doc.width + Math.round(dx));
  if (handle.includes("w")) {
    width = clampCanvasSide(doc.width - Math.round(dx));
    shiftX = width - doc.width;
  }
  if (handle.includes("s")) height = clampCanvasSide(doc.height + Math.round(dy));
  if (handle.includes("n")) {
    height = clampCanvasSide(doc.height - Math.round(dy));
    shiftY = height - doc.height;
  }
  return placeCanvas(doc, width, height, shiftX, shiftY);
}

function ratioParts(ratio: CanvasRatio): [number, number] {
  const [w, h] = ratio.split(":").map(Number);
  return [w!, h!];
}

/**
 * The smallest canvas of `ratio` that holds the whole picture, picture centred. Only ever adds space;
 * computed from the picture, so applying it twice changes nothing. Past `CANVAS_MAX` the canvas keeps
 * the ratio at the limit (the picture is then cropped; only for pictures near the limit already).
 */
export function canvasForRatio(doc: LayerDoc, ratio: CanvasRatio): LayerDoc {
  const b = baseRect(doc);
  const [rw, rh] = ratioParts(ratio);
  const r = rw / rh;
  let width = b.w;
  let height = b.h;
  if (b.w / b.h > r) height = Math.max(b.h, Math.round(b.w / r));
  else width = Math.max(b.w, Math.round(b.h * r));
  const over = Math.min(1, CANVAS_MAX / width, CANVAS_MAX / height);
  const under = Math.max(1, CANVAS_MIN / width, CANVAS_MIN / height);
  const scale = over < 1 ? over : under;
  if (scale !== 1) {
    width = clampCanvasSide(width * scale);
    height = clampCanvasSide(height * scale);
  }
  const x = Math.round((width - b.w) / 2);
  const y = Math.round((height - b.h) / 2);
  return placeCanvas(doc, width, height, x - b.x, y - b.y);
}

/** Back to the picture's own size; the layers move with the picture. */
export function resetCanvas(doc: LayerDoc): LayerDoc {
  const b = baseRect(doc);
  return placeCanvas(doc, b.w, b.h, -b.x, -b.y);
}

/** The preset the canvas matches (within a pixel of rounding), or null. */
export function activeCanvasRatio(doc: LayerDoc): CanvasRatio | null {
  for (const ratio of CANVAS_RATIOS) {
    const [rw, rh] = ratioParts(ratio);
    if (Math.abs(Math.round((doc.height * rw) / rh) - doc.width) <= 1 || Math.abs(Math.round((doc.width * rh) / rw) - doc.height) <= 1) return ratio;
  }
  return null;
}

/**
 * The view after the document changed from `from` to `to` (undo or redo of a canvas change): the pan
 * moves by the opposite of the picture's move, times the zoom, so the picture stays where it is on
 * screen (the handle drag in stage.tsx does the same). The same view object when the picture did not move.
 */
export function holdPictureView(view: View, from: LayerDoc, to: LayerDoc): View {
  const a = baseRect(from);
  const b = baseRect(to);
  if (a.x === b.x && a.y === b.y) return view;
  return { ...view, panX: view.panX - (b.x - a.x) * view.zoom, panY: view.panY - (b.y - a.y) * view.zoom };
}

/** Canvas pixels the picture does not cover on each side (0 where it reaches or passes the edge). */
export function emptyMargins(doc: LayerDoc): Margins {
  const b = baseRect(doc);
  return {
    left: Math.max(0, b.x),
    top: Math.max(0, b.y),
    right: Math.max(0, doc.width - (b.x + b.w)),
    bottom: Math.max(0, doc.height - (b.y + b.h)),
  };
}

/* ------------------------------------------------- partial edit (RegionBox) */

/** A canvas point as fractions of the picture (what a `RegionBox` is made of), clamped to it. */
export function worldToPicture(doc: LayerDoc, world: Point): Point {
  const b = baseRect(doc);
  return {
    x: b.w > 0 ? clamp((world.x - b.x) / b.w, 0, 1) : 0,
    y: b.h > 0 ? clamp((world.y - b.y) / b.h, 0, 1) : 0,
  };
}

/** A `RegionBox` (fractions of the picture) in canvas pixels. */
export function pictureBoxToWorld(doc: LayerDoc, box: RegionBox | Box): Box {
  const b = baseRect(doc);
  return { x: b.x + box.x * b.w, y: b.y + box.y * b.h, w: box.w * b.w, h: box.h * b.h };
}
