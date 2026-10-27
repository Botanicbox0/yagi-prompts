'use client';

import { useEffect, useRef, type MouseEvent } from 'react';
import type { RenderFrame } from '@/lib/renders/frames';

/**
 * "{n}장 모두 저장" for a set. It is a link to the first picture's download, so it works with no
 * script; with one it saves every picture — on a phone through the share sheet (iOS and Android both
 * offer "save N images" there, the only way a page can put several pictures into the photo library at
 * once), elsewhere as one download per picture, a beat apart.
 *
 * The share sheet must open while the tap still counts as the reader's gesture, which a slow fetch
 * after the tap would outlast, so on a phone the pictures are fetched once, shortly after the page
 * settles. Any failure on that path (no share sheet, a refused fetch) falls back to the downloads.
 */
export function SaveFrames({ frames, label, className }: { frames: RenderFrame[]; label: string; className?: string }) {
  const files = useRef<Promise<File[]> | null>(null);

  useEffect(() => {
    if (!sharesFiles()) return;
    const timer = window.setTimeout(() => {
      files.current ??= quiet(fetchFiles(frames));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [frames]);

  async function save(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (sharesFiles()) {
      try {
        const ready = await (files.current ??= quiet(fetchFiles(frames)));
        if (navigator.canShare({ files: ready })) {
          await navigator.share({ files: ready });
          return;
        }
      } catch (error) {
        // Closing the sheet is a choice, not a failure.
        if (error instanceof Error && error.name === 'AbortError') return;
        files.current = null;
      }
    }
    for (const [index, frame] of frames.entries()) {
      if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, 400));
      const link = document.createElement('a');
      link.href = frame.download;
      link.download = frame.filename;
      document.body.append(link);
      link.click();
      link.remove();
    }
  }

  const first = frames[0];
  return (
    <a
      href={first?.download}
      download={first?.filename}
      onClick={save}
      data-result-action="download"
      data-render-download
      data-save-frames={frames.length}
      className={className}
    >
      {label} ↓
    </a>
  );
}

/** A touch device whose browser can hand files to the share sheet. */
function sharesFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
  if (!window.matchMedia('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array([0xff, 0xd8])], 'probe.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

async function fetchFiles(frames: RenderFrame[]): Promise<File[]> {
  return Promise.all(
    frames.map(async (frame) => {
      const response = await fetch(frame.view, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`frame ${frame.frame} answered ${response.status}`);
      const blob = await response.blob();
      return new File([blob], frame.filename, { type: blob.type || 'image/jpeg' });
    }),
  );
}

/** The early fetch may fail unseen; the tap that awaits it then takes the download path. */
function quiet(promise: Promise<File[]>): Promise<File[]> {
  promise.catch(() => undefined);
  return promise;
}
