/**
 * Editing studio v2 — frame-rate arithmetic (docs/BRAND-EDITING-STUDIO-V2.md §5.1.1).
 *
 * No view the editor receives carries a frame rate, so the browser measures it: a hidden, muted video
 * plays a few frames and `requestVideoFrameCallback` reports each frame's media time
 * (components/brand-studio/editor-v2/measure-fps.ts). The arithmetic on those times lives here so it
 * can be tested without a browser. Pure.
 */

/** Rates footage is made at. A measurement within 0.5% of one of these is that rate. */
export const SOURCE_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

/** Whole-number rates a film runs at: frames.ts counts in whole frames of the film. */
export const FILM_RATES = [24, 25, 30, 50, 60] as const;

/** The rate a film falls back to when nothing could be measured. */
export const DEFAULT_FILM_FPS = 30;

const SNAP_TOLERANCE = 0.005;

/** A measured rate brought onto the rate it almost certainly is; anything else kept to three decimals. */
export function snapSourceFps(fps: number): number | null {
  if (!Number.isFinite(fps) || fps <= 0) return null;
  let best: number | null = null;
  let bestGap = SNAP_TOLERANCE;
  for (const rate of SOURCE_RATES) {
    const gap = Math.abs(fps - rate) / rate;
    if (gap <= bestGap) {
      best = rate;
      bestGap = gap;
    }
  }
  return best ?? Math.round(fps * 1000) / 1000;
}

/** The film rate for footage at `fps`: the nearest whole rate (23.976 → 24, 29.97 → 30, 59.94 → 60). */
export function snapFilmFps(fps: number | null | undefined): number {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) return DEFAULT_FILM_FPS;
  let best: number = FILM_RATES[0];
  for (const rate of FILM_RATES) if (Math.abs(fps - rate) < Math.abs(fps - best)) best = rate;
  return best;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** How many frame-to-frame gaps a measurement needs before it is believed. */
export const MIN_FRAME_GAPS = 6;

/**
 * The footage's rate from the media times of consecutive presented frames. The median gap is used, so
 * a frame the browser skipped while busy does not halve the answer. `null` when there are too few.
 */
export function fpsFromMediaTimes(times: readonly number[], minGaps = MIN_FRAME_GAPS): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i]! - times[i - 1]!;
    if (Number.isFinite(gap) && gap > 1e-4 && gap < 0.5) gaps.push(gap);
  }
  if (gaps.length < minGaps) return null;
  const middle = median(gaps);
  return middle ? snapSourceFps(1 / middle) : null;
}

/** The footage's length in its own frames. */
export function sourceFramesOf(durationSec: number, fps: number): number {
  return Math.max(1, Math.round(durationSec * fps));
}
