import { clipMediaPosAt, type FrameClip } from './frames';
import { curveStartMedia, curveTimeAt, curveTotalSpanMedia } from './speed-curve';

/**
 * Editing studio v2 — what the preview lets the person hear of a cut's own sound (audit A1, 2026-11-24).
 *
 * The preview has one <video>, and it is the clock: the picture follows the element frame by frame
 * (components/brand-studio/editor-v2/play-forward.ts). The sound comes from the same element and follows
 * it; it never drives it, and nothing here moves the picture. The cut on screen is heard while the film
 * plays forward (the play button, Space or the shuttle, all started by the person), at the cut's own
 * volume from the panel, with the pitch following the speed as in the exported file (`preservesPitch` off:
 * the export plays a cut at a speed through `AudioBufferSourceNode.playbackRate` and resamples a curve).
 * It is silent while stopped (paused, scrubbing, stepping frames, shuttling backwards), during the seeks the
 * preview makes to stay in step, for a margin before the sound must change (`soundMarginSec`), and for a cut
 * whose stored sound offset moves its sound in the file (the element cannot). The preview never plays what
 * the file will not have. Music and sound effects are not played here (the film contents list and the
 * export sheet say so).
 */

/**
 * The rates the preview gives its element (play-forward.ts clamps to these; Chromium refuses others). Measured
 * 2026-11-24 in headless Chromium 149 with a 440 Hz tone through a separate measuring page: the element sounds
 * at every rate in this range (0.0625, 0.1, 0.25, 4, 10, 16 …), `preservesPitch` on or off, so a cut at 0.10×
 * or 10.00× is heard. Gecko mutes outside 0.25–4 on its own (MDN, not measured here).
 */
export const PREVIEW_RATE_RANGE = { min: 0.0625, max: 16 } as const;

/**
 * How long before the sound must change (a cut's end, unless the next cut continues the same sound; the film's
 * end) the preview goes quiet: at least this, so one long animation frame cannot carry the element past the
 * end unheard by the loop (review 2026-11-24: one 60 ms frame among 17 ms ones let 31 ms of a cut's cut-away
 * tail be heard with the old "1.5 × the last gap"). What still leaks is a lone stall longer than this that
 * starts just before an end, by its excess (a 200 ms stall: at most 80 ms).
 */
export const SOUND_MARGIN_FLOOR_SEC = 0.12;
/** …and at least this many times the longest gap between animation frames remembered (`frameGaps`). */
export const SOUND_MARGIN_GAPS = 1.5;
/** How long a gap between animation frames is remembered. */
export const FRAME_GAP_MEMORY_MS = 2000;

export type PreviewSoundWhy =
  /** Not playing forward: paused, scrubbing, stepping frames, shuttling backwards. */
  | 'stopped'
  /** The person has not used the page yet: the browser would not play it with sound. */
  | 'no-gesture'
  /** The browser refused to play this element with sound once in this playback. */
  | 'refused'
  /** The page is hidden: no animation frames run there, so the loop cannot keep the sound on its cut. */
  | 'hidden'
  /** A seek is on its way or waiting (a new file, a jump to the next cut, a correction). */
  | 'seeking'
  /** The element is behind where the sound stopped when the shuttle's speed changed: it would be heard twice. */
  | 'replay'
  /** The sound must change within the margin (`soundMarginSec`): a cut's end, the film's end. */
  | 'cut-change'
  /** The cut's sound is off, or at 0, in the panel. */
  | 'cut-muted'
  /**
   * The stored film moves the cut's sound (the current editor's `audioOffsetSec`, `soundShiftSec` in
   * export-plan.ts): the file has it earlier or later than the picture, the element has it under the picture.
   */
  | 'shifted'
  /** The cut's file has no sound track. */
  | 'no-track'
  /** A rate outside what the element sounds at. */
  | 'rate';

export interface PreviewSoundInput {
  /** The film plays forward and the element is its clock. */
  playing: boolean;
  /** The person has used the page (`navigator.userActivation.hasBeenActive`, true where the browser cannot say). */
  gesture: boolean;
  refused: boolean;
  hidden: boolean;
  seeking: boolean;
  replay: boolean;
  cutChange: boolean;
  /** The cut's volume, `0..1`. */
  volume: number;
  /** The cut's own mute. */
  muted: boolean;
  /** The stored film moves the cut's sound (an offset other than 0). */
  shifted: boolean;
  /** The element's playback rate. */
  rate: number;
  /** Whether the cut's file has a sound track; `null` when not known (heard if it has one). */
  soundTrack: boolean | null;
}

export interface PreviewSound {
  muted: boolean;
  /** Always a valid element volume (`0..1`), also while muted: unmuting needs no second write. */
  volume: number;
  /** Why it is silent; `null` when heard. */
  why: PreviewSoundWhy | null;
}

export function previewSound(input: PreviewSoundInput): PreviewSound {
  const volume = Number.isFinite(input.volume) ? Math.min(1, Math.max(0, input.volume)) : 0;
  const inRange = Number.isFinite(input.rate) && input.rate >= PREVIEW_RATE_RANGE.min && input.rate <= PREVIEW_RATE_RANGE.max;
  const why: PreviewSoundWhy | null = !input.playing
    ? 'stopped'
    : !input.gesture
      ? 'no-gesture'
      : input.refused
        ? 'refused'
        : input.hidden
          ? 'hidden'
          : input.seeking
            ? 'seeking'
            : input.replay
              ? 'replay'
              : input.cutChange
                ? 'cut-change'
                : input.muted || volume <= 0
                  ? 'cut-muted'
                  : input.shifted
                    ? 'shifted'
                    : input.soundTrack === false
                      ? 'no-track'
                      : !inRange
                        ? 'rate'
                        : null;
  return { muted: why !== null, volume, why };
}

/** How loud a cut is in the preview and in the file. */
function gainOf(cut: FrameClip): number {
  return cut.muted ? 0 : Math.min(1, Math.max(0, cut.volume));
}

/** A cut's stored sound offset in seconds (0 when none); the preview passes the stored film's. */
export type SoundShift = (cutId: string) => number;

const noShift: SoundShift = () => 0;

/**
 * Whether the element runs from the end of `from` into `to` with no seek and nothing to change in what is
 * heard: the same file, `to` starting where `from` ends (a cut split in two), at the same loudness and the
 * same stored sound offset. The speed may differ (the rate changes on the next frame, as the picture's does).
 */
export function soundRunsOn(from: FrameClip, to: FrameClip | undefined, shift: SoundShift = noShift): boolean {
  if (!to || to.srcUrl !== from.srcUrl) return false;
  if (Math.abs(gainOf(from) - gainOf(to)) > 1e-9) return false;
  if (Math.abs(shift(from.id) - shift(to.id)) > 1e-9) return false;
  return Math.abs(clipMediaPosAt(from, from.frames) - clipMediaPosAt(to, 0)) < 1e-3;
}

/**
 * The cut's timeline offset (fractional film frames from its start) at media position `pos` (film-grid frames
 * of its file, `currentTime × fps`): the play loop's own mapping, unrounded. Past a curve's end it keeps
 * growing, so "past the end" stays past.
 */
export function cutOffsetAt(cut: FrameClip, pos: number): number {
  if (cut.speedCurve) {
    const startMedia = curveStartMedia(cut.speedCurve);
    const totalSpan = curveTotalSpanMedia(cut.speedCurve);
    const u = (pos - startMedia) / Math.max(1e-6, totalSpan);
    if (u >= 1) return cut.frames + (pos - (startMedia + totalSpan));
    return curveTimeAt(cut.speedCurve, Math.max(0, u));
  }
  return ((pos - cut.inFrame) * cut.speedDen - cut.phase) / cut.speedNum;
}

/**
 * Seconds the sound heard now may go on, from the element at media position `pos` with cut `index` on screen
 * (the film at `fps`, the shuttle at `rate`): to the end of that cut, or on through every following cut the
 * sound runs on into (`soundRunsOn`), to the end of the last one. When the element is already past the cut
 * on screen but inside one it runs on into (the loop notices on its next frame), it counts from there. 0 or
 * less: past it (back from a hidden tab, after a long frame).
 */
export function soundLeftSec(clips: readonly FrameClip[], index: number, pos: number, fps: number, rate: number, shift: SoundShift = noShift): number {
  let at = index;
  while (clips[at + 1] && pos >= clipMediaPosAt(clips[at]!, clips[at]!.frames) && soundRunsOn(clips[at]!, clips[at + 1], shift)) at += 1;
  let frames = clips[at]!.frames - cutOffsetAt(clips[at]!, pos);
  for (let next = at + 1; clips[next] && soundRunsOn(clips[next - 1]!, clips[next], shift); next += 1) frames += clips[next]!.frames;
  return frames / (fps * rate);
}

/** The quiet margin before the sound must change: the floor, or 1.5 × the longest recent frame gap (seconds). */
export function soundMarginSec(longestGapSec: number): number {
  return Math.max(SOUND_MARGIN_FLOOR_SEC, SOUND_MARGIN_GAPS * longestGapSec);
}

/** The gaps between the play loop's animation frames over the last `FRAME_GAP_MEMORY_MS`. */
export function frameGaps(memoryMs = FRAME_GAP_MEMORY_MS) {
  const gaps: Array<{ at: number; gap: number }> = [];
  return {
    /** A gap of `gapMs` that ended at `at` (ms, the animation frame's time). */
    add(at: number, gapMs: number) {
      gaps.push({ at, gap: gapMs });
      while (gaps.length > 0 && gaps[0]!.at < at - memoryMs) gaps.shift();
    },
    longestSec(): number {
      let longest = 0;
      for (const entry of gaps) longest = Math.max(longest, entry.gap);
      return longest / 1000;
    },
  };
}
