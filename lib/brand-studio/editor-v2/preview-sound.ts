import { clipMediaPosAt, type FrameClip } from './frames';

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
 * preview makes to stay in step, and around a cut change the loop cannot follow in time. Music and sound
 * effects are not played here (the film contents list and the export sheet say so).
 */

/**
 * The rates the preview gives its element (play-forward.ts clamps to these; Chromium refuses others). Measured
 * 2026-11-24 in headless Chromium 149 with a 440 Hz tone through a separate measuring page: the element sounds
 * at every rate in this range (0.0625, 0.1, 0.25, 4, 10, 16 …), `preservesPitch` on or off, so a cut at 0.10×
 * or 10.00× is heard. Gecko mutes outside 0.25–4 on its own (MDN, not measured here).
 */
export const PREVIEW_RATE_RANGE = { min: 0.0625, max: 16 } as const;

/** How many animation frames before a cut change the sound goes quiet, unless it runs on into the next cut. */
export const CUT_CHANGE_GUARD_FRAMES = 1.5;

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
  /** The cut ends before the next animation frame is likely to come, and the sound changes there. */
  | 'cut-change'
  /** The cut's sound is off, or at 0, in the panel. */
  | 'cut-muted'
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
  cutChange: boolean;
  /** The cut's volume, `0..1`. */
  volume: number;
  /** The cut's own mute. */
  muted: boolean;
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
            : input.cutChange
              ? 'cut-change'
              : input.muted || volume <= 0
                ? 'cut-muted'
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

/**
 * Whether the element runs from the end of `from` into `to` with no seek and nothing to change in what is
 * heard: the same file, `to` starting where `from` ends (a cut split in two), at the same loudness. The
 * speed may differ (the rate changes on the next frame, as the picture's does).
 */
export function soundRunsOn(from: FrameClip, to: FrameClip | undefined): boolean {
  if (!to || to.srcUrl !== from.srcUrl) return false;
  if (Math.abs(gainOf(from) - gainOf(to)) > 1e-9) return false;
  return Math.abs(clipMediaPosAt(from, from.frames) - clipMediaPosAt(to, 0)) < 1e-3;
}

/** Seconds of the cut left from timeline offset `offset` (fractional), with the film at `fps` and the shuttle at `rate`. */
export function cutRemainingSec(cut: Pick<FrameClip, 'frames'>, offset: number, fps: number, rate: number): number {
  return (cut.frames - offset) / (fps * rate);
}

/**
 * Whether to go quiet now: the cut ends within about one and a half animation frames (`frameSec`, the last
 * gap between frames, so a covered window that draws once a second goes quiet a second and a half ahead)
 * and the sound does not run on into the next cut. Without it the element plays on past the cut's end until
 * the next frame notices: the cut's cut-away material, or the next cut at this cut's volume.
 */
export function nearCutChange(remainingSec: number, frameSec: number, runsOn: boolean): boolean {
  return !runsOn && remainingSec <= CUT_CHANGE_GUARD_FRAMES * frameSec;
}
