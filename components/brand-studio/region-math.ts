/**
 * The partial-edit box in fractions of the picture (contracts.ts `RegionBox`): drawing, moving and
 * resizing always land inside the picture and never smaller than the contract's 2% side.
 */
import type { RegionBox } from "@/lib/brand-studio/contracts";

export const MIN_SIDE = 0.02;
export interface Point {
  x: number;
  y: number;
}
export type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const r4 = (value: number) => Math.round(value * 10_000) / 10_000;

function settle(x: number, y: number, w: number, h: number): RegionBox {
  const width = clamp(w, MIN_SIDE, 1);
  const height = clamp(h, MIN_SIDE, 1);
  const box = { x: r4(clamp(x, 0, 1 - width)), y: r4(clamp(y, 0, 1 - height)), w: r4(width), h: r4(height) };
  // Rounding must never push the far edge past the picture.
  if (box.x + box.w > 1) box.w = r4(1 - box.x);
  if (box.y + box.h > 1) box.h = r4(1 - box.y);
  return box;
}

export function pointIn(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): Point {
  return {
    x: rect.width ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0,
    y: rect.height ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0,
  };
}

export function drawBox(from: Point, to: Point): RegionBox {
  const a = { x: clamp(from.x, 0, 1), y: clamp(from.y, 0, 1) };
  const b = { x: clamp(to.x, 0, 1), y: clamp(to.y, 0, 1) };
  return settle(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}

export function moveBox(box: RegionBox, dx: number, dy: number): RegionBox {
  return settle(box.x + dx, box.y + dy, box.w, box.h);
}

/** The corner opposite the one being dragged stays where it is. */
export function resizeBox(box: RegionBox, corner: Corner, to: Point): RegionBox {
  const fixed = { x: corner.includes("w") ? box.x + box.w : box.x, y: corner.includes("n") ? box.y + box.h : box.y };
  return drawBox(fixed, to);
}

export function containsPoint(box: RegionBox, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

/** Arrow keys move the box by 1%; with Shift they grow or shrink its width and height instead. */
export function nudgeBox(box: RegionBox, key: string, resize: boolean, step = 0.01): RegionBox | null {
  const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const d = delta[key];
  if (!d) return null;
  return resize ? settle(box.x, box.y, box.w + d[0], box.h + d[1]) : moveBox(box, d[0], d[1]);
}

/** The keyboard start: a box in the middle of the picture. */
export function centeredBox(): RegionBox {
  return { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
}
