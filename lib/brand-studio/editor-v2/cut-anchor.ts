/**
 * Editing studio v2 — reading the stored film's timed things on v2's frames, anchored on cuts (spec E,
 * item A).
 *
 * Captions (`captions[].startSec/endSec`), sound effects (`sfxClips[].startSec`) and still overlays
 * (`overlays[].startSec/endSec`) are stored in the CURRENT editor's timeline seconds. It lays the cuts out
 * with `timelineSpans` (lib/brand-studio/compose/timeline.ts:484-494): each cut lasts
 * `max(0.3, roundTenths((trimEnd − trimStart) / rate))` (`clipPlayDuration`, :458-461), its start and end
 * rounded to tenths, one after the other. v2 lays the same cuts out on exact frames, so the two layouts
 * drift apart cut by cut; a stored second read straight onto v2's timeline lands on another moment of the
 * picture (83 ms after six cuts at 24 fps, up to 250 ms).
 *
 * So a stored time is read as "this cut, this far into it": the cut it falls in on the current editor's
 * layout of the cuts as they are now (`timelineSpans` itself is called, never re-implemented), the same
 * offset into the same cut on v2's frames, never past that cut's end. Past the last cut it stays past the
 * end (hidden), at its distance. Stored values never change; v2 only reads them through this mapping:
 * the preview, the export and the lists all do. Pure.
 */
import {
  MAX_COMPOSE_CAPTIONS,
  emptyComposerProject,
  timelineSpans,
  type CaptionPosition,
  type CaptionSize,
  type ComposeCaption,
  type ComposeOverlayClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import type { FrameCaption, FrameSequence } from './frames';

export interface CutAnchor {
  fps: number;
  /** The current editor's layout of the cuts, in its own seconds: `[start, end)` per cut. */
  stored: ReadonlyArray<{ start: number; end: number }>;
  /** v2's layout of the same cuts, in frames. */
  frames: ReadonlyArray<{ start: number; length: number }>;
  storedTotal: number;
  total: number;
}

/**
 * The anchor for the cuts on screen. `film` is the film as v2 would store it now (`toStored` of these
 * cuts: the seconds the current editor would read); `sequence` the same cuts on frames. Cuts pair up in
 * order; a cut the stored film cannot hold (past its clip limit) has no stored place and is not paired.
 */
export function cutAnchor(film: Pick<ComposerProject, 'clips'>, sequence: Pick<FrameSequence, 'fps' | 'clips'>): CutAnchor {
  const count = Math.min(film.clips.length, sequence.clips.length);
  const spans = timelineSpans({ ...emptyComposerProject(), clips: film.clips.slice(0, count) });
  const frames: Array<{ start: number; length: number }> = [];
  let at = 0;
  for (const clip of sequence.clips.slice(0, count)) {
    frames.push({ start: at, length: clip.frames });
    at += clip.frames;
  }
  return {
    fps: sequence.fps,
    stored: spans.map((span) => ({ start: span.timelineStartSec, end: span.timelineEndSec })),
    frames,
    storedTotal: spans.length > 0 ? spans[spans.length - 1]!.timelineEndSec : 0,
    total: at,
  };
}

/** The cut a stored time falls in (a time on a boundary belongs to the cut that starts there), or -1 past the end. */
function cutAt(anchor: CutAnchor, sec: number): number {
  for (let i = 0; i < anchor.stored.length; i += 1) if (sec < anchor.stored[i]!.end) return i;
  return -1;
}

const clean = (sec: number) => (Number.isFinite(sec) ? Math.max(0, sec) : 0);

/** A stored time on v2's frames: the same cut, the same offset into it (rounded to a frame), never past its end. */
export function storedSecToFrame(anchor: CutAnchor, sec: number): number {
  const t = clean(sec);
  if (anchor.stored.length === 0) return Math.round(t * anchor.fps);
  const i = cutAt(anchor, t);
  if (i < 0) return anchor.total + Math.round((t - anchor.storedTotal) * anchor.fps);
  const cut = anchor.frames[i]!;
  return cut.start + Math.min(Math.round((t - anchor.stored[i]!.start) * anchor.fps), cut.length);
}

/**
 * The same mapping without rounding to a frame, in v2's film seconds: where a sound effect starts. A
 * sound is placed to the sample, so it keeps its exact offset into its cut (never past the cut's end).
 */
export function storedSecToFilmSec(anchor: CutAnchor, sec: number): number {
  const t = clean(sec);
  if (anchor.stored.length === 0) return t;
  const i = cutAt(anchor, t);
  if (i < 0) return anchor.total / anchor.fps + (t - anchor.storedTotal);
  const cut = anchor.frames[i]!;
  return cut.start / anchor.fps + Math.min(t - anchor.stored[i]!.start, cut.length / anchor.fps);
}

/** A stored span on frames, start and end mapped apart: `[start, end)`, at least one frame long. */
export function storedSpanToFrames(anchor: CutAnchor, startSec: number, endSec: number): { start: number; end: number } {
  const start = storedSecToFrame(anchor, startSec);
  return { start, end: Math.max(start + 1, storedSecToFrame(anchor, endSec)) };
}

const POSITIONS: readonly CaptionPosition[] = ['bottom', 'center', 'top'];
const SIZES: readonly CaptionSize[] = ['sm', 'md', 'lg'];

/**
 * The stored film's captions on v2's frames, all of them: one past the end of a film that got shorter is
 * kept here and simply not shown (frames.ts `visibleCaptions`, `frameStateAt`), so it shows again when the
 * film is long enough. v2 does not own captions in V1; this is a view of them.
 */
export function captionsOnFrames(captions: readonly ComposeCaption[], anchor: CutAnchor): FrameCaption[] {
  return captions.slice(0, MAX_COMPOSE_CAPTIONS).map((caption) => {
    const { start, end } = storedSpanToFrames(anchor, caption.startSec, caption.endSec);
    return {
      id: caption.id,
      text: caption.text,
      start,
      end,
      position: POSITIONS.includes(caption.position) ? caption.position : 'bottom',
      size: SIZES.includes(caption.size) ? caption.size : 'md',
    };
  });
}

/**
 * The frames a still overlay shows on: from its mapped start to its mapped end, both included (the current
 * exporter draws it while `start ≤ t ≤ end`), at least one frame.
 */
export function overlayFrames(anchor: CutAnchor, overlay: Pick<ComposeOverlayClip, 'startSec' | 'endSec'>): { first: number; last: number } {
  const first = storedSecToFrame(anchor, overlay.startSec);
  return { first, last: Math.max(first, storedSecToFrame(anchor, overlay.endSec)) };
}

/** Where a stored sound effect starts in v2's film, in seconds. */
export function effectStartSec(anchor: CutAnchor, effect: { startSec: number }): number {
  return storedSecToFilmSec(anchor, effect.startSec);
}
