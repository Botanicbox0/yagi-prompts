/**
 * Where a region edit happens (docs/BRAND-STUDIO-V2.md §8.3, IDENTITY §6-4-3): the customer's box,
 * widened to an aspect the edit model accepts with some surrounding context, and the size the crop
 * is enlarged to so the model has a full canvas for a small part. Pure.
 */
import type { RegionBox } from '@/lib/brand-studio/contracts';

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RegionPlan {
  /** The area cut out and sent to the edit model, in pixels of the (upright) picture. */
  roi: PixelRect;
  /** The customer's box in pixels. Only these pixels may change. */
  box: PixelRect;
  /** The edit model's aspect for the crop ("4:3"). */
  aspect: string;
  /** The size the crop is enlarged to before it is sent. */
  work: { width: number; height: number };
  /**
   * Window plans only (region edit v2, ./window.ts): the customer's box. `box` is then the paste zone
   * around it and `roi` the window the model sees. Absent on crop plans (`planRegion`).
   */
  select?: PixelRect;
  /** Window plans: `work` width over `roi` width (1 = the customer's pixels went 1:1). */
  downscale?: number;
  /** Window plans: the size the model returns for `aspect`, when known. */
  output?: { width: number; height: number };
  /** Window plans: no supported shape held the zone, so the whole picture went at the nearest shape. */
  stretched?: boolean;
}

/** Context kept around the box on each side when the picture allows it. */
export const REGION_PADDING = 0.15;
/** A crop shorter than this on its long side is enlarged to `WORK_TARGET_LONG`. */
export const WORK_MIN_LONG = 1536;
export const WORK_TARGET_LONG = 2048;
/** Edit models take up to 4K; a larger crop is sent at this size (and scaled back when pasted). */
export const WORK_MAX_LONG = 4096;

const EPS = 1e-6;

export function parseAspect(aspect: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/.exec(aspect);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/** The fractional box in whole pixels, always at least 1×1 and inside the picture. */
export function boxToPixels(image: { width: number; height: number }, box: RegionBox): PixelRect {
  const W = Math.max(1, Math.round(image.width));
  const H = Math.max(1, Math.round(image.height));
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const left = clamp(Math.floor(box.x * W + EPS), 0, W - 1);
  const top = clamp(Math.floor(box.y * H + EPS), 0, H - 1);
  const right = clamp(Math.ceil((box.x + box.w) * W - EPS), left + 1, W);
  const bottom = clamp(Math.ceil((box.y + box.h) * H - EPS), top + 1, H);
  return { left, top, width: right - left, height: bottom - top };
}

function reduced(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height) || 1;
  return `${width / g}:${height / g}`;
}

function workSize(ratio: number, roi: PixelRect): { width: number; height: number } {
  const roiLong = Math.max(roi.width, roi.height);
  const long = Math.min(WORK_MAX_LONG, roiLong < WORK_MIN_LONG ? WORK_TARGET_LONG : roiLong);
  return ratio >= 1
    ? { width: long, height: Math.max(1, Math.round(long / ratio)) }
    : { width: Math.max(1, Math.round(long * ratio)), height: long };
}

export function planRegion(
  image: { width: number; height: number },
  region: RegionBox,
  aspects: readonly string[],
): RegionPlan {
  const W = Math.max(1, Math.round(image.width));
  const H = Math.max(1, Math.round(image.height));
  const box = boxToPixels({ width: W, height: H }, region);
  const options = aspects
    .map((label) => ({ label, ratio: parseAspect(label) }))
    .filter((a): a is { label: string; ratio: number } => a.ratio !== null);

  // The aspect whose smallest rectangle around the box wastes the least area and still fits.
  let best: { label: string; ratio: number; cw: number; ch: number } | null = null;
  for (const { label, ratio } of options) {
    const cw = box.width / box.height >= ratio ? box.width : box.height * ratio;
    const ch = box.width / box.height >= ratio ? box.width / ratio : box.height;
    if (cw > W + EPS || ch > H + EPS) continue;
    if (!best || cw * ch < best.cw * best.ch - EPS) best = { label, ratio, cw, ch };
  }

  if (!best) {
    const pictureRatio = W / H;
    const nearest = options.reduce<{ label: string; ratio: number } | null>(
      (acc, a) => (!acc || Math.abs(Math.log(a.ratio / pictureRatio)) < Math.abs(Math.log(acc.ratio / pictureRatio)) ? a : acc),
      null,
    );
    const roi = { left: 0, top: 0, width: W, height: H };
    const ratio = nearest?.ratio ?? pictureRatio;
    return { roi, box, aspect: nearest?.label ?? reduced(W, H), work: workSize(ratio, roi) };
  }

  // Grow for context: aim for REGION_PADDING on every side, shrink the margin where the picture ends.
  const want = Math.max(
    (box.width * (1 + 2 * REGION_PADDING)) / best.cw,
    (box.height * (1 + 2 * REGION_PADDING)) / best.ch,
  );
  const scale = Math.max(1, Math.min(want, W / best.cw, H / best.ch));
  const width = Math.min(W, Math.max(box.width, Math.round(best.cw * scale)));
  const height = Math.min(H, Math.max(box.height, Math.round(best.ch * scale)));

  const place = (start: number, size: number, span: number, total: number) => {
    let at = Math.round(start + size / 2 - span / 2);
    at = Math.min(at, start);
    at = Math.max(at, start + size - span);
    return Math.min(Math.max(at, 0), total - span);
  };
  const roi = {
    left: place(box.left, box.width, width, W),
    top: place(box.top, box.height, height, H),
    width,
    height,
  };
  return { roi, box, aspect: best.label, work: workSize(best.ratio, roi) };
}
