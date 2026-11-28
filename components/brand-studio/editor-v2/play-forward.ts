'use client';

import { filmFrames, frameStateAt, spansOf, totalFrames, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { frameGaps, previewSound, soundLeftSec, soundMarginSec, type PreviewSound } from '@/lib/brand-studio/editor-v2/preview-sound';
import { curveSpeedAt, curveStartMedia, curveTimeAt, curveTotalSpanMedia } from '@/lib/brand-studio/editor-v2/speed-curve';

export function disablePitchPreservation(video: HTMLVideoElement): void {
  const media = video as HTMLVideoElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  if ('preservesPitch' in media) media.preservesPitch = false;
  if ('mozPreservesPitch' in media) media.mozPreservesPitch = false;
  if ('webkitPreservesPitch' in media) media.webkitPreservesPitch = false;
}

/** What the play loop reads on every frame (the preview keeps it current). */
export interface PlayState {
  sequence: FrameSequence;
  playhead: number;
  seek: (frame: number) => void;
  setRate: (rate: number) => void;
  /** Whether a cut's file has a sound track; `null` when not known. */
  soundTrack: (srcUrl: string) => boolean | null;
  /** A cut's stored sound offset in seconds, as the export moves it (`soundShiftSec`); 0 when none. */
  soundShift: (cutId: string) => number;
}

export interface PlayForwardOptions {
  /**
   * The film was already playing forward at another speed (the shuttle's speed changed): the loop starts
   * from the playhead, which lags the element, so it may step back over sound just heard.
   */
  resumed?: boolean;
}

/** How far back a resumed loop's first seek may go and still be kept silent until it is past what was heard. */
const REPLAY_HOLD_SEC = 0.5;

/** Whether the person has used this page; where the browser cannot say, the refusal path covers it. */
function personUsedPage(): boolean {
  const activation = (globalThis.navigator as (Navigator & { userActivation?: { hasBeenActive: boolean } }) | undefined)?.userActivation;
  return activation ? activation.hasBeenActive : true;
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Writes only what changed: silent first when muting, the volume first when unmuting. */
export function setElementSound(video: HTMLMediaElement, sound: PreviewSound): void {
  if (sound.muted && !video.muted) video.muted = true;
  if (Math.abs(video.volume - sound.volume) > 1e-6) video.volume = sound.volume;
  if (!sound.muted && video.muted) video.muted = false;
}

/**
 * Playing forward (1×, or 2× and 4× on the shuttle): the video element is the clock and the playhead
 * follows it, one whole frame at a time, cut by cut. Started by the preview when the rate turns positive;
 * the returned function stops it (the preview's effect cleanup).
 *
 * The cut on screen is heard (audit A1): lib/brand-studio/editor-v2/preview-sound.ts decides on every frame,
 * before the element is told to seek or play, from what the element and the cut say; the sound never moves
 * the picture. The element starts muted (preview.tsx) and is muted again before it stops.
 */
export function playForward(video: HTMLVideoElement, latest: { readonly current: PlayState }, rate: number, options: PlayForwardOptions = {}): () => void {
  let raf = 0;
  let lastPush = 0;
  let expectedId: string | null = null;
  let seekTo: number | null = null;
  // Sound only (audit A1): the gaps between frames, a gap the page was hidden for, the browser's refusal,
  // and where the sound stopped when a running film changed speed.
  const gaps = frameGaps();
  let lastFrameAt: number | null = null;
  let wasHidden = false;
  let refused = false;
  let hold: { src: string; until: number } | null = options.resumed ? { src: video.dataset.src ?? '', until: video.currentTime } : null;
  const startHasOverlays = Boolean(latest.current.sequence.overlayTracks?.length);
  const startTotal = startHasOverlays ? filmFrames(latest.current.sequence) : totalFrames(latest.current.sequence);
  let cursor = latest.current.playhead >= startTotal - 1 ? 0 : latest.current.playhead;
  let trailingAccFrames = 0;
  const play = () => {
    const withSound = !video.muted;
    void video.play().catch((error: unknown) => {
      // A browser that will not play this element with sound: the next frame plays it silent, so the
      // picture never stops.
      if (withSound && (error as { name?: unknown } | null)?.name === 'NotAllowedError') refused = true;
    });
  };
  const tick = (now: number) => {
    // A gap the page spent hidden is not a long frame: the margin does not grow from it.
    const frameDeltaMs = lastFrameAt !== null && !wasHidden ? Math.max(0, now - lastFrameAt) : 0;
    if (lastFrameAt !== null && !wasHidden) gaps.add(now, frameDeltaMs);
    lastFrameAt = now;
    wasHidden = false;
    const current = latest.current.sequence;
    const hasOverlays = Boolean(current.overlayTracks?.length);
    const mainEnd = totalFrames(current);
    const end = hasOverlays ? filmFrames(current) : mainEnd;
    const active = cursor < mainEnd ? frameStateAt(current, cursor).active : null;
    if (!active) {
      if (hasOverlays && cursor < end) {
        // Past the main track into a trailing overlay clip: keep main silent/paused and advance playhead at film fps.
        video.muted = true;
        if (!video.paused) video.pause();
        trailingAccFrames += (frameDeltaMs / 1000) * current.fps * rate;
        const step = Math.floor(trailingAccFrames);
        if (step >= 1) {
          trailingAccFrames -= step;
          cursor = Math.min(end, cursor + step);
        }
        if (cursor >= end) {
          latest.current.seek(Math.max(0, end - 1));
          latest.current.setRate(0);
          return;
        }
        if (now - lastPush > 40) {
          lastPush = now;
          latest.current.seek(cursor);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!video.muted) video.muted = true;
      if (!video.paused) video.pause();
      latest.current.seek(end - 1);
      latest.current.setRate(0);
      return;
    }
    trailingAccFrames = 0;
    const { clip: playing } = active;
    const span = spansOf(current)[active.index]!;
    const hear = () => {
      const shift = latest.current.soundShift;
      // Silent until the element is past where the sound stopped (another file, or far back: not a replay).
      if (hold && (video.dataset.src !== hold.src || video.currentTime > hold.until + 1e-4 || video.currentTime < hold.until - REPLAY_HOLD_SEC)) hold = null;
      setElementSound(
        video,
        previewSound({
          playing: true,
          gesture: personUsedPage(),
          refused,
          hidden: pageHidden(),
          seeking: seekTo !== null || video.seeking,
          replay: hold !== null,
          cutChange: soundLeftSec(current.clips, active.index, video.currentTime * current.fps + 1e-6, current.fps, rate, shift) < soundMarginSec(gaps.longestSec()),
          volume: playing.volume,
          muted: playing.muted,
          shifted: Math.abs(shift(playing.id)) > 1e-9,
          rate: video.playbackRate,
          soundTrack: latest.current.soundTrack(playing.srcUrl),
        }),
      );
    };
    if (video.dataset.src !== playing.srcUrl) {
      video.dataset.src = playing.srcUrl;
      video.src = playing.srcUrl;
      seekTo = active.seekSec;
    } else if (expectedId !== playing.id && (video.ended || Math.abs(video.currentTime - active.seekSec) > 0.5 / playing.sourceFps)) {
      seekTo = active.seekSec;
    }
    expectedId = playing.id;
    if (seekTo !== null) {
      hear();
      if (video.readyState >= 1) {
        video.currentTime = seekTo;
        seekTo = null;
      }
    } else if (playing.speedCurve) {
      const mediaPos = video.currentTime * current.fps + 1e-6;
      const startMedia = curveStartMedia(playing.speedCurve);
      const totalSpan = curveTotalSpanMedia(playing.speedCurve);
      const u = (mediaPos - startMedia) / Math.max(1e-6, totalSpan);
      const clampedU = Math.max(0, u);
      const offset = u >= 1 ? playing.frames : Math.floor(curveTimeAt(playing.speedCurve, clampedU));
      if (u >= 1 || offset >= playing.frames || video.ended) {
        hear();
        cursor = span.end;
      } else {
        const instSpeed = curveSpeedAt(playing.speedCurve, clampedU);
        disablePitchPreservation(video);
        video.playbackRate = Math.max(0.0625, Math.min(16, instSpeed * rate));
        hear();
        if (video.paused) play();
        if (offset >= 0) cursor = Math.max(cursor, span.start + offset);
      }
    } else {
      // The film-grid frame the video is on, then back through the cut's speed to a timeline frame.
      const mediaFrame = Math.floor(video.currentTime * current.fps + 1e-6);
      const offset = Math.floor(((mediaFrame - playing.inFrame) * playing.speedDen - playing.phase) / playing.speedNum);
      if (offset >= playing.frames || video.ended) {
        hear();
        cursor = span.end;
      } else {
        disablePitchPreservation(video);
        video.playbackRate = Math.max(0.0625, Math.min(16, (playing.speedNum / playing.speedDen) * rate));
        hear();
        if (video.paused) play();
        if (offset >= 0) cursor = Math.max(cursor, span.start + offset);
      }
    }
    if (now - lastPush > 40 && cursor < end) {
      lastPush = now;
      latest.current.seek(cursor);
    }
    raf = requestAnimationFrame(tick);
  };
  // A hidden page runs no animation frames while the element plays on: silent at once.
  const onVisibility = () => {
    if (!pageHidden()) return;
    video.muted = true;
    wasHidden = true;
  };
  document.addEventListener('visibilitychange', onVisibility);
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
    video.muted = true;
    video.pause();
  };
}
