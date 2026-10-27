'use client';

import { useRef, useState, type MouseEvent } from 'react';
import type { RenderFrame } from '@/lib/renders/frames';

/**
 * "{n}장 모두 저장" for a set. It is a link to the first picture's download, so it works with no
 * script; with one it saves every picture — on a phone through the share sheet (iOS and Android both
 * offer "save N images" there, the only way a page can put several pictures into the photo library at
 * once), elsewhere as one download per picture, a beat apart.
 *
 * Nothing is fetched until the tap: a page view costs no extra downloads. The share sheet must open
 * while the tap still counts as the reader's gesture; when fetching the pictures outlasts it, the
 * browser refuses the sheet (`NotAllowedError`), the fetched files are kept and the button asks for one
 * more tap, which opens the sheet at once. Any other failure falls back to the downloads.
 */

export type SaveOutcome = 'shared' | 'cancelled' | 'tap-again' | 'downloaded';

export interface SaveDeps {
  /** A touch device whose browser can hand files to the share sheet. */
  sharesFiles: boolean;
  /** The pictures as files — memoized by the caller, so a second tap does not fetch again. */
  files(): Promise<File[]>;
  /** Drop the memoized files (after a failed fetch). */
  forget(): void;
  canShare(files: File[]): boolean;
  share(files: File[]): Promise<void>;
  download(frame: RenderFrame): void;
  wait(ms: number): Promise<void>;
  /** The previous tap ended in 'tap-again': a second refusal is not the gesture's timing. */
  retried: boolean;
}

export async function saveAll(frames: readonly RenderFrame[], deps: SaveDeps): Promise<SaveOutcome> {
  if (deps.sharesFiles) {
    try {
      const files = await deps.files();
      if (deps.canShare(files)) {
        await deps.share(files);
        return 'shared';
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      // Closing the sheet is a choice, not a failure.
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError' && !deps.retried) return 'tap-again';
      if (name !== 'NotAllowedError') deps.forget();
    }
  }
  for (const [index, frame] of frames.entries()) {
    if (index > 0) await deps.wait(400);
    deps.download(frame);
  }
  return 'downloaded';
}

export function SaveFrames({ frames, label, againLabel, className }: { frames: RenderFrame[]; label: string; againLabel: string; className?: string }) {
  const files = useRef<Promise<File[]> | null>(null);
  const [again, setAgain] = useState(false);

  async function save(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const outcome = await saveAll(frames, {
      sharesFiles: sharesFiles(),
      files: () => (files.current ??= fetchFiles(frames)),
      forget: () => {
        files.current = null;
      },
      canShare: (list) => navigator.canShare({ files: list }),
      share: (list) => navigator.share({ files: list }),
      download,
      wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      retried: again,
    });
    setAgain(outcome === 'tap-again');
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
      {again ? againLabel : label} ↓
    </a>
  );
}

function sharesFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
  if (!window.matchMedia('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array([0xff, 0xd8])], 'probe.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

function download(frame: RenderFrame): void {
  const link = document.createElement('a');
  link.href = frame.download;
  link.download = frame.filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function fetchFiles(frames: readonly RenderFrame[]): Promise<File[]> {
  return Promise.all(
    frames.map(async (frame) => {
      const response = await fetch(frame.view, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`frame ${frame.frame} answered ${response.status}`);
      const blob = await response.blob();
      return new File([blob], frame.filename, { type: blob.type || 'image/jpeg' });
    }),
  );
}
