'use client';

import { framesFromPlayback, measureWithRetry, measuredFromTiming, rateFromMediaTimes } from '@/lib/brand-studio/editor-v2/fps';
import type { MeasuredSource } from '@/lib/brand-studio/editor-v2/stored';
import { readFootage } from './footage-facts';
import { refreshReduced, screenTimer } from './screen-refresh';

/**
 * The footage's own frame rate and number of frames (docs/BRAND-EDITING-STUDIO-V2.md §5.1.1).
 *
 * First from the file itself: its sample table, read with Range requests (./footage-facts.ts, spec E
 * addendum C1). That takes a moment and does not depend on the screen: measuring by playback failed on
 * production in a window covered by another window, which stays "visible" but draws about once a second.
 *
 * Only a file the reader cannot read (WebM, a broken file) is measured by playback: a hidden, muted video
 * plays a dozen frames and `requestVideoFrameCallback` reports each frame's media time; the arithmetic is
 * in lib/brand-studio/editor-v2/fps.ts. The length is the view's exact one when given, else the video's.
 * It waits until the page is visible; its time limit counts screen time (./screen-refresh.ts), and frames
 * reported while the screen refreshes slowly are not used (one a second would read as 1 fps). A failed
 * try is followed by one longer try (`measureWithRetry`, review round 1, item 3). Each piece of footage
 * is measured once per visit; a failure answers `null` and the editor stores nothing frame-based for it,
 * so the next visit measures it again. Frames that are not evenly spaced are reported (`variable`). The
 * number of pictures is never rounded up (spec E addendum C3): after the rate, the first and the last
 * picture are shown and their times give the count, capped by the length (`framesFromPlayback`).
 */
const FRAMES = 13;
const cache = new Map<string, Promise<MeasuredSource | null>>();

type FrameCallback = (now: number, metadata: { mediaTime: number }) => void;
type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (callback: FrameCallback) => number };

export function measureSource(src: string, durationSec: number | null): Promise<MeasuredSource | null> {
  const hit = cache.get(src);
  if (hit) return hit;
  const run =
    typeof document === 'undefined' || !src
      ? Promise.resolve(null)
      : readFootage(src).then(
          (read) =>
            measuredFromTiming(read.answer) ??
            measureWithRetry<MeasuredSource>({
              visible: () => document.visibilityState === 'visible',
              untilVisible,
              attempt: (limitMs) => measureOnce(src, durationSec, limitMs),
            }),
        );
  cache.set(src, run);
  return run;
}

function untilVisible(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', check);
      resolve();
    };
    document.addEventListener('visibilitychange', check);
    check();
  });
}

function measureOnce(src: string, durationSec: number | null, limitMs: number): Promise<MeasuredSource | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video') as FrameVideo;
    if (typeof video.requestVideoFrameCallback !== 'function') return resolve(null);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    // On screen but invisible: a video that is not painted reports no frames.
    Object.assign(video.style, { position: 'fixed', right: '0', bottom: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
    const times: number[] = [];
    let done = false;
    let firstSec: number | null = null;
    let lastSec: number | null = null;
    /** The ends are being read: an `ended` now is the seek to the last picture, not the end of playing. */
    let readingEnds = false;
    const result = (): MeasuredSource | null => {
      const { fps, variable } = rateFromMediaTimes(times);
      const seconds = durationSec ?? (Number.isFinite(video.duration) ? video.duration : null);
      if (!fps || !seconds || seconds <= 0) return null;
      return { fps, frames: framesFromPlayback({ fps, durationSec: seconds, firstSec, lastSec }), ...(variable ? { variable: true } : {}) };
    };
    /** Seeks to `at` and resolves with the media time of the picture then shown. */
    const shownAt = (at: number) =>
      new Promise<number>((resolve) => {
        let seeked = false;
        let seen: number | null = null;
        const settle = () => {
          if (seeked && seen !== null) resolve(seen);
        };
        video.requestVideoFrameCallback?.((_now, metadata) => {
          seen = metadata.mediaTime;
          settle();
        });
        video.addEventListener('seeked', () => {
          seeked = true;
          settle();
        }, { once: true });
        video.currentTime = at;
      });
    /**
     * The rate is known: the first and the last picture give the count (the time limit still applies).
     * Measured in Chromium (full build, 2026-11-21) on a WebM of 97 pictures whose container runs to
     * 4.308 s (its sound is longer): a paused seek to `duration` fires `seeked` (currentTime 4.308) and
     * then the frame callback with mediaTime 4.000 in the same task, and no `ended` at all; a seek to
     * `duration − 0.5/fps` gives the same picture. The last picture is asked for there (inside the
     * picture's time, never past the end), and an `ended` while the ends are read is ignored, so a browser
     * that does fire it cannot cut the count short (review round 1 of part E, item 4).
     */
    const readEnds = () => {
      readingEnds = true;
      video.pause();
      const fps = rateFromMediaTimes(times).fps ?? 30;
      void shownAt(0)
        .then((first) => {
          firstSec = first;
          return shownAt(Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.5 / fps) : 1e9);
        })
        .then((last) => {
          lastSec = last;
          finish(result());
        });
    };
    const finish = (value: MeasuredSource | null) => {
      if (done) return;
      done = true;
      stopTimer();
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      resolve(value);
    };
    const stopTimer = screenTimer(limitMs, () => finish(result()));
    const onFrame: FrameCallback = (_now, metadata) => {
      if (done) return;
      // A frame reported while the screen draws slowly is a frame skipped by the screen, not by the file.
      if (refreshReduced()) times.length = 0;
      else times.push(metadata.mediaTime);
      if (times.length >= FRAMES) return readEnds();
      video.requestVideoFrameCallback?.(onFrame);
    };
    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener('ended', () => {
      if (!readingEnds) finish(result());
    });
    video.addEventListener(
      'loadeddata',
      () => {
        video.requestVideoFrameCallback?.(onFrame);
        video.play().catch(() => finish(null));
      },
      { once: true },
    );
    document.body.appendChild(video);
    video.src = src;
  });
}
