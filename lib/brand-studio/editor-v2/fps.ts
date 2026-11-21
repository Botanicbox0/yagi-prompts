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
  const window = windowReading(times, minGaps);
  return window ? { fps: snapSourceFps(window.raw), variable: window.variable } : { fps: null, variable: false };
}

/**
 * What a window of presented frames says: the rate as measured (`raw`, not brought onto a standard one)
 * and whether its frames are evenly spaced. `null` when there are too few gaps.
 */
function windowReading(times: readonly number[], minGaps = MIN_FRAME_GAPS): { raw: number; variable: boolean } | null {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i]! - times[i - 1]!;
    if (Number.isFinite(gap) && gap > 1e-4 && gap < 0.5) gaps.push(gap);
  }
  if (gaps.length < minGaps) return null;
  const middle = median(gaps);
  if (!middle) return null;
  const uneven = gaps.filter((gap) => {
    const whole = Math.max(1, Math.round(gap / middle));
    return Math.abs(gap - whole * middle) / middle > VARIABLE_GAP_TOLERANCE;
  }).length;
  // The median gap says how long one frame is; the rate is the frames over the time they span (a skipped
  // frame counts as two). One gap alone is as coarse as the container's clock: a WebM keeps times to the
  // millisecond (41, 42 ms), and 1 / 0.042 = 23.81 would miss 24 (review round 1 of part E, item 4).
  const steps = gaps.reduce((sum, gap) => sum + Math.max(1, Math.round(gap / middle)), 0);
  const span = gaps.reduce((sum, gap) => sum + gap, 0);
  const raw = steps / span;
  return Number.isFinite(raw) && raw > 0 ? { raw, variable: uneven / gaps.length > VARIABLE_SHARE } : null;
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
 * not in the file is a picture the export would ask for and never get. Two known roundings are allowed
 * for, so a real last picture is not lost either: a length written from a rounded rate (5.005 s at 23.976
 * is 119.9999 frames: 120) and a length written to the millisecond, as WebM does (119 pictures at 24 fps
 * last 4.958333 s, written 4.958 s: 118.992 frames of time). 0.6 ms of time is the most that adds.
 */
export function sourceFramesOf(durationSec: number, fps: number): number {
  return Math.max(1, Math.floor(durationSec * fps + 1e-3 + 0.0006 * fps));
}

/** The standard rates as the exact fractions they are (SOURCE_RATES: 23.976 is 24000/1001). */
const STANDARD_RATES: ReadonlyArray<number> = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];

/**
 * How far from a whole number of steps a span may be and still be that many steps at rate R: the ends'
 * times come from the container, and the coarsest clock the editor meets keeps them to the millisecond
 * (WebM). Each end is then off by less than 1 ms (truncated) or 0.5 ms (rounded), so the span is off by
 * less than 1 ms and its steps by less than 0.001 × R. Twice that is allowed, plus a hair for floating
 * point: 0.048 steps at 24 fps, 0.12 at 60.
 */
const spanAllowance = (rate: number) => 0.002 * rate + 1e-6;

/**
 * Footage measured by playback (review round 2 of part E, N1): its rate and its number of pictures, from
 * the window of frames it played (`windowTimes`), the first and last pictures it was shown when asked for
 * them (`firstSec`, `lastSec`) and its stated length (`durationSec`). Pure; the browser part only gathers
 * these (components/brand-studio/editor-v2/measure-fps.ts).
 *
 * 1. The window gives a first estimate f0: its frames over the time they span. A dozen frames cannot tell
 *    24 from 23.976 (0.1 % apart), and one skipped picture in a window on a millisecond clock reads 24 as
 *    23.976.
 * 2. The rate is decided on the whole span S = lastSec − firstSec. Candidates are the standard rates within
 *    0.5 % of f0, as exact fractions; one fits when S × R is within `spanAllowance(R)` of a whole number of
 *    steps. When one fits, it is the rate. When more than one fits, they are equally near a whole number as
 *    far as the clock can tell (both within the allowance), and the one nearest f0 is taken. For 24 against
 *    23.976 that is so for spans under about 2 s (the two
 *    differ by S × 24/1001 steps, under 0.048) and for spans within about 2 s of every multiple of 1001/24 s
 *    (41.7 s: there 24 fps and 23.976 fps put exactly one step apart, both whole). There the window decides,
 *    and a window misread is one picture and 0.1 % off; anywhere else the span decides.
 *    If no candidate fits, the candidate nearest f0. If no standard rate is within 0.5 % of f0 at all
 *    (15 fps, 12 fps footage), the window's own rate as `snapSourceFps` keeps it: frames over the time they
 *    span, to three decimals (before review round 1 of part E it was one over the median gap).
 * 3. The count is round(S × R) + 1 with that rate, and never more than the length gives at that same rate
 *    (`sourceFramesOf(durationSec, R)`): a container whose sound runs past the last picture adds nothing.
 *    Only the count is capped; the rate is never derived from a count.
 *
 * Without both ends (they could not be read) there is no answer (`null`: not known yet, measured again on
 * the next visit), never a count from the length alone (review round 2 of part E, item 4).
 */
export function playbackFacts(input: { windowTimes: readonly number[]; firstSec: number | null; lastSec: number | null; durationSec: number | null }): { fps: number; frames: number; variable: boolean } | null {
  const { windowTimes, firstSec, lastSec, durationSec } = input;
  if (firstSec === null || lastSec === null || !Number.isFinite(firstSec) || !Number.isFinite(lastSec) || lastSec < firstSec) return null;
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  const window = windowReading(windowTimes);
  if (!window) return null;
  const f0 = window.raw;
  const span = lastSec - firstSec;
  const near = STANDARD_RATES.filter((rate) => Math.abs(f0 - rate) / rate <= SNAP_TOLERANCE);
  let rate: number;
  if (near.length === 0) {
    rate = snapSourceFps(f0)!;
  } else {
    const off = (candidate: number) => Math.abs(span * candidate - Math.round(span * candidate));
    const fitting = near.filter((candidate) => off(candidate) <= spanAllowance(candidate));
    const byWindow = (a: number, b: number) => Math.abs(a - f0) - Math.abs(b - f0);
    rate = fitting.length === 1 ? fitting[0]! : [...(fitting.length > 1 ? fitting : near)].sort(byWindow)[0]!;
  }
  const frames = Math.max(1, Math.min(sourceFramesOf(durationSec, rate), Math.round(span * rate) + 1));
  return { fps: rate, frames, variable: window.variable };
}

/**
 * Runs `work` over `items` with at most `limit` at a time, answers in their order (opening a film reads
 * at most four files at once: review round 1 of part E, item 10).
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, runner));
  return out;
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
