/**
 * Geometry of the layer editor: rotated boxes, hit tests, resizing from a handle with the opposite
 * side pinned, rotation with 15° steps, smart-guide snapping and the zoom/pan view. Pure functions in
 * base-picture pixels; the stage converts pointer positions before calling them.
 */
import { MIN_SIDE, clamp, normalizeAngle, type Box, type Frame, type Layer, type LayerPatch } from "./model";

export interface Point {
  x: number;
  y: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const CORNERS: readonly Handle[] = ["nw", "ne", "se", "sw"];
export const EDGES: readonly Handle[] = ["n", "e", "s", "w"];

const RAD = Math.PI / 180;

export const centerOf = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const a = deg * RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** The four corners in world space, clockwise from top-left. */
export function cornersOf(f: Frame): Point[] {
  const c = centerOf(f);
  return [
    { x: f.x, y: f.y },
    { x: f.x + f.w, y: f.y },
    { x: f.x + f.w, y: f.y + f.h },
    { x: f.x, y: f.y + f.h },
  ].map((p) => rotatePoint(p, c, f.rotation));
}

/** Axis-aligned bounds of a (possibly rotated) frame. */
export function boundsOf(f: Frame): Box {
  if (!f.rotation) return { x: f.x, y: f.y, w: f.w, h: f.h };
  const pts = cornersOf(f);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function containsPoint(f: Frame, p: Point): boolean {
  const local = rotatePoint(p, centerOf(f), -f.rotation);
  return local.x >= f.x && local.x <= f.x + f.w && local.y >= f.y && local.y <= f.y + f.h;
}

/** The topmost visible frame under the point (frames in drawing order, bottom first). */
export function hitTest<T extends Frame & { id: string; hidden: boolean }>(frames: readonly T[], p: Point): T | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    if (!f.hidden && containsPoint(f, p)) return f;
  }
  return null;
}

/* ---------------------------------------------------------------- resizing */

const dirOf = (handle: Handle): { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } => ({
  dx: handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
  dy: handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0,
});

/**
 * Resizes from a handle to the pointer (world space). The opposite corner (or edge) stays where it is,
 * also when the box is rotated. With `keepRatio`, the box keeps its width:height ratio; an edge handle
 * then grows the other side around the centre line.
 */
export function resizeFrame(f: Frame, handle: Handle, pointer: Point, opts: { keepRatio: boolean; min?: number }): Frame {
  const min = opts.min ?? MIN_SIDE;
  const { dx, dy } = dirOf(handle);
  const c = centerOf(f);
  // Pointer and anchor in the box's own frame, origin at the centre.
  const p = rotatePoint(pointer, c, -f.rotation);
  const local = { x: p.x - c.x, y: p.y - c.y };
  const anchor = { x: -dx * (f.w / 2), y: -dy * (f.h / 2) };
  let w = dx ? Math.max(min, dx * (local.x - anchor.x)) : f.w;
  let h = dy ? Math.max(min, dy * (local.y - anchor.y)) : f.h;
  if (opts.keepRatio && f.w > 0 && f.h > 0) {
    const ratio = f.w / f.h;
    if (dx && dy) {
      // Follow whichever side the pointer pulls further.
      const s = Math.max(w / f.w, h / f.h);
      w = f.w * s;
      h = f.h * s;
    } else if (dx) h = w / ratio;
    else w = h * ratio;
    if (w < min || h < min) {
      const s = Math.max(min / w, min / h);
      w *= s;
      h *= s;
    }
  }
  // New centre in the local frame: pinned anchor plus half the new size in the handle's direction.
  const nc = { x: dx ? anchor.x + dx * (w / 2) : 0, y: dy ? anchor.y + dy * (h / 2) : 0 };
  const world = rotatePoint({ x: c.x + nc.x, y: c.y + nc.y }, c, f.rotation);
  return { x: world.x - w / 2, y: world.y - h / 2, w, h, rotation: f.rotation };
}

/** Handles a layer offers: text resizes from its corners (scales the type) and its sides (rewraps). */
export function handlesFor(kind: Layer["kind"]): readonly Handle[] {
  return kind === "text" ? ["nw", "ne", "se", "sw", "e", "w"] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
}

/**
 * The patch a resize drag makes. Images keep their ratio unless Shift is held; shapes keep it only
 * with Shift; text corners scale the font with the box, text sides change the wrapping width.
 * `frame` is the layer's frame when the drag started (text height already laid out).
 */
export function resizeLayerPatch(layer: Layer, frame: Frame, handle: Handle, pointer: Point, shift: boolean): LayerPatch {
  if (layer.kind === "text") {
    const corner = handle.length === 2;
    const r = resizeFrame(frame, handle, pointer, { keepRatio: corner });
    if (!corner) return { x: r.x, y: r.y, w: r.w };
    const scale = frame.w > 0 ? r.w / frame.w : 1;
    return { x: r.x, y: r.y, w: r.w, size: layer.size * scale };
  }
  const keepRatio = layer.kind === "image" ? !shift : shift;
  const r = resizeFrame(frame, handle, pointer, { keepRatio });
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/** Where a handle sits on the unrotated box, as fractions (0, 0.5, 1). */
export function handleAnchor(handle: Handle): Point {
  const { dx, dy } = dirOf(handle);
  return { x: (dx + 1) / 2, y: (dy + 1) / 2 };
}

/** The resize cursor for a handle on a box turned by `rotation` degrees. */
export function handleCursor(handle: Handle, rotation: number): string {
  const order = ["ns", "nesw", "ew", "nwse"] as const;
  const base: Record<Handle, number> = { n: 0, s: 0, ne: 1, sw: 1, e: 2, w: 2, nw: 3, se: 3 };
  const steps = Math.round(normalizeAngle(rotation) / 45);
  const index = (((base[handle] + steps) % 4) + 4) % 4;
  return `${order[index]}-resize`;
}

/* ---------------------------------------------------------------- rotation */

/** The rotation that points the top handle at the pointer; with `snap`, the nearest 15°. */
export function rotationFromPointer(center: Point, pointer: Point, snap: boolean): number {
  const deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  return normalizeAngle(snap ? Math.round(deg / 15) * 15 : deg);
}

/* --------------------------------------------------------------- snapping */

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

export interface Guides {
  x: number[];
  y: number[];
}

/** The picture's edges and centre lines, then every other visible layer's edges and centre lines. */
export function snapTargets(canvas: { width: number; height: number }, others: readonly Box[]): SnapTargets {
  const xs = [0, canvas.width / 2, canvas.width];
  const ys = [0, canvas.height / 2, canvas.height];
  for (const b of others) {
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function snapAxis(features: number[], targets: number[], threshold: number): { delta: number; lines: number[] } {
  let best: number | null = null;
  for (const f of features) {
    for (const t of targets) {
      const d = t - f;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return { delta: 0, lines: [] };
  const lines = new Set<number>();
  for (const f of features) for (const t of targets) if (Math.abs(f + best - t) < 0.5) lines.add(Math.round(t * 100) / 100);
  return { delta: best, lines: [...lines].sort((a, b) => a - b) };
}

/**
 * Snaps a moving box (its axis-aligned bounds after the raw move) to the nearest target within
 * `threshold` on each axis. Returns the correction and the guide lines to draw.
 */
export function snapMove(box: Box, targets: SnapTargets, threshold: number): { dx: number; dy: number; guides: Guides } {
  const x = snapAxis([box.x, box.x + box.w / 2, box.x + box.w], targets.xs, threshold);
  const y = snapAxis([box.y, box.y + box.h / 2, box.y + box.h], targets.ys, threshold);
  return { dx: x.delta, dy: y.delta, guides: { x: x.lines, y: y.lines } };
}

/* ------------------------------------------------------------------- view */

export interface View {
  zoom: number;
  /** Screen offset of the picture's top-left corner inside the stage element. */
  panX: number;
  panY: number;
}

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 8;
export const clampZoom = (zoom: number) => clamp(zoom, ZOOM_MIN, ZOOM_MAX);

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The view that shows the whole picture inside the free part of the stage, never above `maxZoom`. */
export function fitView(stage: { width: number; height: number }, content: { width: number; height: number }, insets: Insets, margin = 24, maxZoom = 1): View {
  const freeW = Math.max(40, stage.width - insets.left - insets.right - margin * 2);
  const freeH = Math.max(40, stage.height - insets.top - insets.bottom - margin * 2);
  const zoom = clampZoom(Math.min(freeW / content.width, freeH / content.height, maxZoom));
  return {
    zoom,
    panX: insets.left + margin + (freeW - content.width * zoom) / 2,
    panY: insets.top + margin + (freeH - content.height * zoom) / 2,
  };
}

/** Zooms so the world point under `anchor` (stage coordinates) stays under it. */
export function zoomAround(view: View, anchor: Point, zoom: number): View {
  const next = clampZoom(zoom);
  const wx = (anchor.x - view.panX) / view.zoom;
  const wy = (anchor.y - view.panY) / view.zoom;
  return { zoom: next, panX: anchor.x - wx * next, panY: anchor.y - wy * next };
}

/** Same centre, new zoom (100% button). */
export function zoomCentered(view: View, stage: { width: number; height: number }, zoom: number): View {
  return zoomAround(view, { x: stage.width / 2, y: stage.height / 2 }, zoom);
}

export const ZOOM_STEP = 1.25;

export const toWorld = (view: View, p: Point): Point => ({ x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom });
export const toScreen = (view: View, p: Point): Point => ({ x: view.panX + p.x * view.zoom, y: view.panY + p.y * view.zoom });

/** Arrow-key nudge: 1 px, 10 px with Shift. Null for other keys. */
export function nudgeDelta(key: string, big: boolean): Point | null {
  const step = big ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}
