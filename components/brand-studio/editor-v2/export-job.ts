/**
 * Editing studio v2 — the one export that may be running, kept outside React so that closing the
 * export sheet does not stop it and opening it again shows where it is. The person can keep editing:
 * the export works on the film as it was when it started (the sequence is an immutable snapshot).
 */
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { slowNotice, type ExportPath, type ExportPathOverride } from '@/lib/brand-studio/editor-v2/decode-plan';
import { totalFrames, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import type { Reframe } from '@/lib/brand-studio/editor-v2/model';
import { ExportStop, exportFilm, type ExportProgress, type ExportSoundSource, type ExportStopReason, type ExportWarning, type SourcePath } from './export-film';
import { recordExport } from './export-record';
import { watchRefresh } from './screen-refresh';

export type ExportJob =
  | { status: 'idle' }
  | {
      status: 'running';
      progress: ExportProgress;
      frames: number;
      fps: number;
      /**
       * The screen refreshes slowly (a covered or background window) and the picture is being made by the seek
       * path, which waits for it: the export runs, slower (spec E addendum, C2). The decoder path does not wait
       * for the screen, so there it stays false (spec F, F4).
       */
      slow: boolean;
      /** Times it started again because the browser took its encoder back while the page was hidden (spec G, A2). */
      restarts: number;
      /** What the last restart made again: the pictures from the first frame, or only the sound (spec H, F3). */
      restartedPhase: 'video' | 'audio' | null;
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
      /** Which path made each source's pictures (for the proof; data on the sheet, never words). */
      paths: SourcePath[];
      restarts: number;
    }
  | {
      status: 'failed';
      reason: ExportStopReason;
      frame: number | null;
      clip: string | null;
      bytes: number | null;
      message: string;
      fps: number;
      /** For `sound`: which sound could not be read (`clip` is its name), when the stop knows (audit A5). */
      sound?: ExportSoundSource | null;
    };

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
  /** The developer's path override for the proof (`?exportPath=` on the editor page); `null` normally. */
  path?: ExportPathOverride;
  /** `false` (`?exportDownload=off`, checks only): the finished file is not downloaded by itself. */
  download?: boolean;
  /**
   * The organization whose own film this is: the export leaves the current editor's 0-credit record for it
   * (export-record.ts), once, when it starts making pictures (its first progress report of the picture phase).
   * `null` or absent on the sample film, which records nothing.
   */
  recordFor?: string | null;
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
  let reduced = false;
  /** The path making the pictures now: the slow line is only true for the seek path (`slowNotice`). */
  let path: ExportPath | null = null;
  let slow = false;
  let restarts = 0;
  let restartedPhase: 'video' | 'audio' | null = null;
  set({ status: 'running', progress: progressNow, frames, fps, slow, restarts, restartedPhase });
  /** Whether this export has asked for its record (at most once). */
  let recorded = false;
  const update = (force: boolean) => {
    const next = slowNotice(reduced, path);
    if (!force && next === slow) return;
    slow = next;
    set({ status: 'running', progress: progressNow, frames, fps, slow, restarts, restartedPhase });
  };
  // While it runs, whether the screen refreshes live: the sheet says so when it does not and the seek path
  // is waiting for it, and stops saying it when either is no longer so.
  const stopWatching = watchRefresh((now) => {
    if (controller !== own) return;
    reduced = now;
    update(false);
  });

  const onProgress = (progress: ExportProgress) => {
    // The record, once per export that really makes pictures: `exportFilm` reports the picture phase only after
    // its own checks before the first frame (empty film, no encoder for that size and rate, no sound encoder,
    // sound sources over the limit, footage or overlays that do not load). An export refused there, or cancelled
    // before it, leaves no record. A restart after the browser took the encoder back is the same export, and a
    // cancel or failure after this point keeps the record. Never waited for: it never stops the export.
    if (!recorded && request.recordFor && progress.phase === 'video' && !own.signal.aborted) {
      recorded = true;
      recordExport(request.recordFor, frames, fps);
    }
    const now = performance.now();
    const finished = progress.done >= progress.total;
    const pathChanged = progress.path !== undefined && progress.path !== path;
    if (progress.path !== undefined) path = progress.path;
    // A restart is shown at once: the count went back to 0 and the sheet says why (spec G, A2).
    const restarted = (progress.restarts ?? 0) > restarts;
    if (restarted) {
      restarts = progress.restarts!;
      restartedPhase = progress.phase === 'audio' ? 'audio' : 'video';
    }
    if (!pathChanged && !restarted && progress.phase === lastPhase && !finished && now - lastEmit < 80) return;
    lastEmit = now;
    lastPhase = progress.phase;
    progressNow = progress;
    update(true);
  };

  exportFilm({ sequence, extras: request.extras, reframe: request.reframe, framing: request.framing, burnCaptions: request.burnCaptions, path: request.path ?? null, onProgress, signal: own.signal }).then(
    (result) => {
      stopWatching();
      if (controller !== own) return;
      controller = null;
      const url = URL.createObjectURL(result.blob);
      const captionFile = request.captionText
        ? { url: URL.createObjectURL(new Blob([request.captionText], { type: 'application/x-subrip' })), filename: result.filename.replace(/\.mp4$/, '.srt') }
        : null;
      set({
        status: 'done',
        url,
        filename: result.filename,
        bytes: result.blob.size,
        frames: result.frames,
        fps: result.fps,
        elapsedMs: result.elapsedMs,
        captionFile,
        warnings: result.warnings,
        paths: result.paths,
        restarts: result.restarts,
      });
      if (request.download !== false) downloadFile(url, result.filename);
      if (openSheets === 0) request.notify('done');
    },
    (error: unknown) => {
      stopWatching();
      if (controller !== own) return;
      controller = null;
      const stop = error instanceof ExportStop ? error : new ExportStop('encode', error instanceof Error ? error.message : String(error));
      // The plain sentence goes on screen; the exact frame, clip and cause stay in the console for us.
      if (stop.reason !== 'cancelled') console.warn('[editor export]', stop.message);
      set({ status: 'failed', reason: stop.reason, frame: stop.frame, clip: stop.clip, bytes: stop.bytes, message: stop.message, fps, sound: stop.sound });
      if (stop.reason !== 'cancelled' && openSheets === 0) request.notify('failed');
    },
  );
}

export function cancelExport(): void {
  controller?.abort();
}
