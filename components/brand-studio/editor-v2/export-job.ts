/**
 * Editing studio v2 — the one export that may be running, kept outside React so that closing the
 * export sheet does not stop it and opening it again shows where it is. The person can keep editing:
 * the export works on the film as it was when it started (the sequence is an immutable snapshot).
 */
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { totalFrames, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import type { Reframe } from '@/lib/brand-studio/editor-v2/model';
import { ExportStop, exportFilm, type ExportProgress, type ExportStopReason, type ExportWarning } from './export-film';
import { watchRefresh } from './screen-refresh';

export type ExportJob =
  | { status: 'idle' }
  | {
      status: 'running';
      progress: ExportProgress;
      frames: number;
      fps: number;
      /** The screen refreshes slowly (a covered or background window): the export runs, slower (spec E addendum, C2). */
      slow: boolean;
    }
  | {
      status: 'done';
      url: string;
      filename: string;
      bytes: number;
      frames: number;
      fps: number;
      elapsedMs: number;
      captionFile: { url: string; filename: string } | null;
      /** What the file lacks that the person should hear about (a clip's unreadable sound). */
      warnings: ExportWarning[];
    }
  | { status: 'failed'; reason: ExportStopReason; frame: number | null; clip: string | null; bytes: number | null; message: string; fps: number };

export interface ExportRequest {
  sequence: FrameSequence;
  reframe: Readonly<Record<string, Reframe>>;
  /** `current` on a real film: the current exporter's framing rule (lib/brand-studio/editor-v2/framing.ts). */
  framing: 'reframe' | 'current';
  extras: ComposerProject | null;
  burnCaptions: boolean;
  /** SubRip text to hand over beside the video, or `null`. */
  captionText: string | null;
  /** Called when the export ends while no sheet is open to show it. */
  notify: (outcome: 'done' | 'failed') => void;
}

const IDLE: ExportJob = { status: 'idle' };
let job: ExportJob = IDLE;
let controller: AbortController | null = null;
let openSheets = 0;
const listeners = new Set<() => void>();

function set(next: ExportJob) {
  job = next;
  for (const listener of listeners) listener();
}

export function subscribeExportJob(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const exportJobSnapshot = (): ExportJob => job;
export const idleExportJob = (): ExportJob => IDLE;

/** A mounted sheet registers itself, so a finished export only raises a notice when nobody is looking. */
export function watchExportJob(): () => void {
  openSheets += 1;
  return () => {
    openSheets -= 1;
  };
}

export function downloadFile(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function release(previous: ExportJob) {
  if (previous.status !== 'done') return;
  URL.revokeObjectURL(previous.url);
  if (previous.captionFile) URL.revokeObjectURL(previous.captionFile.url);
}

export function startExport(request: ExportRequest): void {
  if (job.status === 'running') return;
  release(job);
  const own = new AbortController();
  controller = own;
  const { sequence } = request;
  const frames = totalFrames(sequence);
  const fps = sequence.fps;
  let lastEmit = 0;
  let lastPhase: ExportProgress['phase'] = 'video';
  let progressNow: ExportProgress = { phase: 'video', done: 0, total: frames };
  let slow = false;
  set({ status: 'running', progress: progressNow, frames, fps, slow });
  // While it runs, whether the screen refreshes live: the sheet says so when it does not, and stops saying
  // it when it does again.
  const stopWatching = watchRefresh((reduced) => {
    if (controller !== own || slow === reduced) return;
    slow = reduced;
    set({ status: 'running', progress: progressNow, frames, fps, slow });
  });

  const onProgress = (progress: ExportProgress) => {
    const now = performance.now();
    const finished = progress.done >= progress.total;
    if (progress.phase === lastPhase && !finished && now - lastEmit < 80) return;
    lastEmit = now;
    lastPhase = progress.phase;
    progressNow = progress;
    set({ status: 'running', progress, frames, fps, slow });
  };

  exportFilm({ sequence, extras: request.extras, reframe: request.reframe, framing: request.framing, burnCaptions: request.burnCaptions, onProgress, signal: own.signal }).then(
    (result) => {
      stopWatching();
      if (controller !== own) return;
      controller = null;
      const url = URL.createObjectURL(result.blob);
      const captionFile = request.captionText
        ? { url: URL.createObjectURL(new Blob([request.captionText], { type: 'application/x-subrip' })), filename: result.filename.replace(/\.mp4$/, '.srt') }
        : null;
      set({ status: 'done', url, filename: result.filename, bytes: result.blob.size, frames: result.frames, fps: result.fps, elapsedMs: result.elapsedMs, captionFile, warnings: result.warnings });
      downloadFile(url, result.filename);
      if (openSheets === 0) request.notify('done');
    },
    (error: unknown) => {
      stopWatching();
      if (controller !== own) return;
      controller = null;
      const stop = error instanceof ExportStop ? error : new ExportStop('encode', error instanceof Error ? error.message : String(error));
      // The plain sentence goes on screen; the exact frame, clip and cause stay in the console for us.
      if (stop.reason !== 'cancelled') console.warn('[editor export]', stop.message);
      set({ status: 'failed', reason: stop.reason, frame: stop.frame, clip: stop.clip, bytes: stop.bytes, message: stop.message, fps });
      if (stop.reason !== 'cancelled' && openSheets === 0) request.notify('failed');
    },
  );
}

export function cancelExport(): void {
  controller?.abort();
}
