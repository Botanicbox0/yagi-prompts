/**
 * Editing studio v2 — frame-rate arithmetic (docs/BRAND-EDITING-STUDIO-V2.md §5.1.1).
 *
 * No view the editor receives carries a frame rate, so the browser measures it: a hidden, muted video
 * plays a few frames and `requestVideoFrameCallback` reports each frame's media time
 * (components/brand-studio/editor-v2/measure-fps.ts). The arithmetic on those times lives here so it
 * can be tested without a browser. Pure.
 */
import type { TimingAnswer } from './container';
import type { MeasuredSource } from './stored';

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
  return rateFromMediaTimes(times, minGaps).fps;
}

/** A gap further than this share of a frame from a whole number of frames is not a constant rate. */
const VARIABLE_GAP_TOLERANCE = 0.06;
/** More than this share of such gaps means the footage's frames are not evenly spaced. */
const VARIABLE_SHARE = 0.2;

/**
 * The footage's rate, and whether its frames are evenly spaced. A skipped frame is a gap of two (or
 * three) frames and still constant; gaps that are not a whole number of frames (1/24 s next to 1/30 s,
 * as in phone footage that changes its rate while recording) mean a variable rate. The editor does not
 * support variable-rate footage; it says so (review round 1, item 10).
 */
export function rateFromMediaTimes(times: readonly number[], minGaps = MIN_FRAME_GAPS): { fps: number | null; variable: boolean } {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i]! - times[i - 1]!;
    if (Number.isFinite(gap) && gap > 1e-4 && gap < 0.5) gaps.push(gap);
  }
  if (gaps.length < minGaps) return { fps: null, variable: false };
  const middle = median(gaps);
  if (!middle) return { fps: null, variable: false };
  const uneven = gaps.filter((gap) => {
    const whole = Math.max(1, Math.round(gap / middle));
    return Math.abs(gap - whole * middle) / middle > VARIABLE_GAP_TOLERANCE;
  }).length;
  return { fps: snapSourceFps(1 / middle), variable: uneven / gaps.length > VARIABLE_SHARE };
}

/**
 * How long one try at measuring may take, counted only while the page is visible: a first try, then
 * one longer try before the editor gives up for this visit (the clip is then measured again next visit).
 */
export const MEASURE_LIMITS_MS = [8000, 20000] as const;

export interface MeasureSteps<T> {
  visible(): boolean;
  /** Resolves when the page is visible again. */
  untilVisible(): Promise<void>;
  /** One try, limited to `limitMs` of visible time; `null` when it could not tell. */
  attempt(limitMs: number): Promise<T | null>;
}

/**
 * Measures only while the page is visible (a hidden tab presents no frames, so waiting there would only
 * burn the limit), and tries once more with a longer limit before giving up. Review round 1, item 3.
 */
export async function measureWithRetry<T>(steps: MeasureSteps<T>, limits: readonly number[] = MEASURE_LIMITS_MS): Promise<T | null> {
  for (const limit of limits) {
    if (!steps.visible()) await steps.untilVisible();
    const result = await steps.attempt(limit);
    if (result !== null) return result;
  }
  return null;
}

/**
 * The footage's length in its own frames, from its length in seconds: never rounded up (spec E addendum
 * C3). A 4.06 s file at 24 fps holds 97 pictures (97.44 frames of time), not 98: a frame counted that is
 * not in the file is a picture the export would ask for and never get. A thousandth of a frame is allowed
 * for lengths written from a rounded rate (5.005 s at 23.976 is 119.9999 frames: 120).
 */
export function sourceFramesOf(durationSec: number, fps: number): number {
  return Math.max(1, Math.floor(durationSec * fps + 1e-3));
}

/**
 * How many pictures footage measured by playback has, never more than it shows (spec E addendum C3):
 * from the first and the last picture the browser presented when both are known, and never more than
 * its length gives (`sourceFramesOf`). A container (or its sound) that runs past the last picture does
 * not add one: 4.1 s of file whose last picture is shown at 4.000 s holds 97 pictures at 24 fps.
 */
export function framesFromPlayback(input: { fps: number; durationSec: number; firstSec?: number | null; lastSec?: number | null }): number {
  const { fps, durationSec, firstSec, lastSec } = input;
  const byLength = sourceFramesOf(durationSec, fps);
  if (typeof firstSec !== 'number' || typeof lastSec !== 'number' || !Number.isFinite(firstSec) || !Number.isFinite(lastSec) || lastSec < firstSec) return byLength;
  return Math.max(1, Math.min(byLength, Math.round((lastSec - firstSec) * fps) + 1));
}

/**
 * The footage's facts from its own file (lib/brand-studio/editor-v2/container.ts), in the shape the
 * editor keeps for measured footage; `null` when the file could not be read or has no picture, and the
 * editor measures it by playback instead (spec E addendum, C1). The rate stays exact (24000/1001).
 */
export function measuredFromTiming(answer: TimingAnswer): MeasuredSource | null {
  if (!answer.ok || !answer.timing.video) return null;
  const { fps, frames, variable } = answer.timing.video;
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isInteger(frames) || frames < 1) return null;
  return { fps, frames, ...(variable ? { variable: true } : {}), counted: true };
}
