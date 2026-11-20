'use client';

import { fpsFromMediaTimes, sourceFramesOf } from '@/lib/brand-studio/editor-v2/fps';
import type { MeasuredSource } from '@/lib/brand-studio/editor-v2/stored';

/**
 * The footage's own frame rate, measured on this device (docs/BRAND-EDITING-STUDIO-V2.md §5.1.1).
 *
 * No view the editor gets carries a rate, so a hidden, muted video plays a dozen frames and
 * `requestVideoFrameCallback` reports each frame's media time; the arithmetic is in
 * lib/brand-studio/editor-v2/fps.ts. The length is the view's exact one when given, else the video's.
 * Each piece of footage is measured once per visit. A failure answers `null`: the editor then assumes the
 * film's rate, marks the clip, and never waits on it.
 */
const FRAMES = 13;
const TIMEOUT_MS = 8000;
const cache = new Map<string, Promise<MeasuredSource | null>>();

type FrameCallback = (now: number, metadata: { mediaTime: number }) => void;
type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (callback: FrameCallback) => number };

export function measureSource(src: string, durationSec: number | null): Promise<MeasuredSource | null> {
  const hit = cache.get(src);
  if (hit) return hit;
  const run = measureOnce(src, durationSec);
  cache.set(src, run);
  return run;
}

function measureOnce(src: string, durationSec: number | null): Promise<MeasuredSource | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !src) return resolve(null);
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
      const fps = fpsFromMediaTimes(times);
      const seconds = durationSec ?? (Number.isFinite(video.duration) ? video.duration : null);
      return fps && seconds && seconds > 0 ? { fps, frames: sourceFramesOf(seconds, fps) } : null;
    };
    const finish = (value: MeasuredSource | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      resolve(value);
    };
    const timer = setTimeout(() => finish(result()), TIMEOUT_MS);
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
