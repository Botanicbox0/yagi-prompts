'use client';

import { useEffect } from 'react';
import { captureFrame, uploadFrame, type FrameCanvas, type FrameSource } from './frame-capture';

/**
 * Renders nothing. On the owner's result page, once, it loads the film into a detached muted
 * `<video>` (so the one on screen keeps playing undisturbed), draws a frame and sends it to
 * `POST /api/renders/{id}/poster`. The page mounts it only while the film has no frame yet.
 * `crossOrigin="anonymous"`: in the cloud the gateway redirects to a signed storage URL on another
 * origin, and without CORS the canvas would be tainted. Data saver on: skipped.
 */
export function PosterCapture({ renderId, src }: { renderId: string; src: string }) {
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    let cancelled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = src;
    void (async () => {
      const blob = await captureFrame(video as unknown as FrameSource, () => document.createElement('canvas') as unknown as FrameCanvas);
      if (!cancelled && blob !== null) await uploadFrame(renderId, blob);
    })().finally(() => {
      video.removeAttribute('src');
      video.load();
    });
    return () => {
      cancelled = true;
    };
  }, [renderId, src]);
  return null;
}
