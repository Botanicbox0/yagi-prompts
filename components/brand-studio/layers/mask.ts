/**
 * Non-destructive alpha mask brush math and canvas painting for `ImageLayer`s
 * (docs/BRAND-STUDIO-REGION-LAYERS.md §1–§3).
 *
 * Pure helpers (`brushAlphaAt`, `dabPoints`, `stampMaskBuffer`, `worldPointToMask`) run anywhere
 * (including Node unit tests); `paintMaskStrokeOnContext` drives real-time 60fps strokes on a 2D
 * offscreen mask canvas (`(255, 255, 255, alpha)`).
 */
import type { Point } from "./geometry";
import { clamp, type Frame } from "./model";

export const BRUSH_SIZE_MIN = 8;
export const BRUSH_SIZE_MAX = 300;
export const DEFAULT_BRUSH_SIZE = 48;

export const BRUSH_HARDNESS_MIN = 0;
export const BRUSH_HARDNESS_MAX = 100;
/** Oplux reference default: 30% hardness gives a soft feathered outer falloff without halos. */
export const DEFAULT_BRUSH_HARDNESS = 30;

export type MaskBrushMode = "erase" | "restore";

export interface MaskBrushStroke {
  from: Point;
  to: Point;
  /** Brush radius in mask pixel space (`> 0`). */
  radius: number;
  /** `0..100` (`0` = fully feathered from centre, `100` = crisp edge). */
  hardness: number;
  mode: MaskBrushMode;
}

/** Normalized dab strength (`0..1`) at `distance` from dab centre. */
export function brushAlphaAt(distance: number, radius: number, hardness: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  const h = clamp(hardness, BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX) / 100;
  const inner = h * radius;
  if (distance <= inner) return 1;
  const span = Math.max(1e-6, radius - inner);
  const t = clamp((distance - inner) / span, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/** Evenly spaced dab centres along `from -> to` so fast pointer movement leaves a continuous stroke. */
export function dabPoints(from: Point, to: Point, radius: number): Point[] {
  const step = Math.max(1, radius * 0.22);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist < 1e-3) return [to];
  const count = Math.max(1, Math.ceil(dist / step));
  const out: Point[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return out;
}

/**
 * Applies a brush stroke onto a single-channel `width × height` alpha buffer (`0..255`).
 * Deterministic CPU reference matching `paintMaskStrokeOnContext` (`destination-out` / `source-over`).
 */
export function stampMaskBuffer(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  stroke: MaskBrushStroke,
): void {
  const r = Math.max(0.5, stroke.radius);
  const points =
    Math.hypot(stroke.to.x - stroke.from.x, stroke.to.y - stroke.from.y) < 1e-3
      ? [stroke.to]
      : [stroke.from, ...dabPoints(stroke.from, stroke.to, r)];
  for (const pt of points) {
    const x0 = Math.max(0, Math.floor(pt.x - r));
    const x1 = Math.min(width - 1, Math.ceil(pt.x + r));
    const y0 = Math.max(0, Math.floor(pt.y - r));
    const y1 = Math.min(height - 1, Math.ceil(pt.y + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - pt.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - pt.x;
        const w = brushAlphaAt(Math.hypot(dx, dy), r, stroke.hardness);
        if (w <= 0) continue;
        const idx = y * width + x;
        const cur = alpha[idx] ?? 255;
        alpha[idx] =
          stroke.mode === "erase"
            ? Math.round(cur * (1 - w))
            : Math.round(cur + (255 - cur) * w);
      }
    }
  }
}

/** Hardware-accelerated 2D canvas brush stroke onto an RGBA mask canvas (`rgb = 255, a = mask`). */
export function paintMaskStrokeOnContext(ctx: CanvasRenderingContext2D, stroke: MaskBrushStroke): void {
  const r = Math.max(0.5, stroke.radius);
  const h = clamp(stroke.hardness, BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX) / 100;
  const innerStop = clamp(h, 0, 0.98);
  const midStop = innerStop + (1 - innerStop) * 0.5;
  const points =
    Math.hypot(stroke.to.x - stroke.from.x, stroke.to.y - stroke.from.y) < 1e-3
      ? [stroke.to]
      : dabPoints(stroke.from, stroke.to, r);

  ctx.save();
  ctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
  for (const pt of points) {
    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    if (innerStop > 0.01) grad.addColorStop(innerStop, "rgba(255,255,255,1)");
    grad.addColorStop(midStop, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Maps a document/world point into a layer's local mask pixel coordinates (handling rotation & scaling). */
export function worldPointToMask(
  world: Point,
  frame: Frame,
  maskSize: { width: number; height: number },
): { x: number; y: number; scale: number } {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  let dx = world.x - cx;
  let dy = world.y - cy;
  if (frame.rotation) {
    const rad = (-frame.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }
  const localX = dx + frame.w / 2;
  const localY = dy + frame.h / 2;
  const sx = maskSize.width / Math.max(1, frame.w);
  const sy = maskSize.height / Math.max(1, frame.h);
  return {
    x: localX * sx,
    y: localY * sy,
    scale: (sx + sy) * 0.5,
  };
}
