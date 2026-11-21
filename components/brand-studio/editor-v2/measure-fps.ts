'use client';

import { measureWithRetry, rateFromMediaTimes, sourceFramesOf } from '@/lib/brand-studio/editor-v2/fps';
import type { MeasuredSource } from '@/lib/brand-studio/editor-v2/stored';

/**
 * The footage's own frame rate, measured on this device (docs/BRAND-EDITING-STUDIO-V2.md §5.1.1).
 *
 * No view the editor gets carries a rate, so a hidden, muted video plays a dozen frames and
 * `requestVideoFrameCallback` reports each frame's media time; the arithmetic is in
 * lib/brand-studio/editor-v2/fps.ts. The length is the view's exact one when given, else the video's.
 *
 * A hidden tab presents no frames, so measuring waits until the page is visible, and its time limit
 * counts only visible time; a failed try is followed by one longer try (`measureWithRetry`, review
 * round 1, item 3). Each piece of footage is measured once per visit; a failure answers `null` and the
 * editor stores nothing frame-based for it, so the next visit measures it again. Frames that are not
 * evenly spaced are reported (`variable`), not corrected.
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
      : measureWithRetry<MeasuredSource>({
          visible: () => document.visibilityState === 'visible',
          untilVisible,
          attempt: (limitMs) => measureOnce(src, durationSec, limitMs),
        });
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

/** A time limit that runs only while the page is visible. */
function visibleTimer(limitMs: number, onExpire: () => void): () => void {
  let spent = 0;
  let last = performance.now();
  const id = window.setInterval(() => {
    const now = performance.now();
    if (document.visibilityState === 'visible') spent += now - last;
    last = now;
    if (spent > limitMs) {
      window.clearInterval(id);
      onExpire();
    }
  }, 100);
  return () => window.clearInterval(id);
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
    const result = (): MeasuredSource | null => {
      const { fps, variable } = rateFromMediaTimes(times);
      const seconds = durationSec ?? (Number.isFinite(video.duration) ? video.duration : null);
      return fps && seconds && seconds > 0 ? { fps, frames: sourceFramesOf(seconds, fps), ...(variable ? { variable: true } : {}) } : null;
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
    const stopTimer = visibleTimer(limitMs, () => finish(result()));
    const onFrame: FrameCallback = (_now, metadata) => {
      if (done) return;
      times.push(metadata.mediaTime);
      if (times.length >= FRAMES) return finish(result());
      video.requestVideoFrameCallback?.(onFrame);
    };
    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener('ended', () => finish(result()), { once: true });
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
