import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportStatus } from '@/components/brand-studio/editor-v2/export-sheet';
import type { ExportJob } from '@/components/brand-studio/editor-v2/export-job';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

/**
 * Spec G, A2: the browser takes back the encoder of a hidden page that sat idle about 90 s (measured, A1);
 * the export starts again from frame 0 once the page is visible again. The sheet's count goes back to 0, it
 * says why in one line, and the proof reads how many times (`data-editor-export-restarts`).
 */

// The restart rules are tested on the loop (frame-loop.test.ts) and the restarter (export-run.test.ts) themselves.

describe('the sheet after a restart', () => {
  const running = (restarts: number, restartedPhase: 'video' | 'audio' | null = restarts > 0 ? 'video' : null): ExportJob => ({
    status: 'running',
    progress: restartedPhase === 'audio' ? { phase: 'audio', done: 0, total: 1 } : { phase: 'video', done: 0, total: 315 },
    frames: 315,
    fps: 24,
    slow: false,
    restarts,
    restartedPhase,
  });

  it('one line saying why, the count from 0, and the number of restarts as data', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: running(1), copy: studioEditorKo.export }));
    expect(html).toContain('data-editor-export-restarted');
    expect(html).toContain(studioEditorKo.export.restarted);
    expect(html).toContain('data-editor-export-restarts="1"');
    expect(html).toContain('data-editor-export-progress="0/315"');
  });

  it('spec H, F3: the sound written again says so, not "from the beginning"', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: running(1, 'audio'), copy: studioEditorKo.export }));
    expect(html).toContain('data-editor-export-restarted="audio"');
    expect(html).toContain(studioEditorKo.export.restartedSound);
    expect(html).not.toContain(studioEditorKo.export.restarted);
  });

  it('spec H, F3: given up after the restarts: its own line, what happened and what to do', () => {
    const failed: ExportJob = { status: 'failed', reason: 'hidden', frame: null, clip: null, bytes: null, message: 'reclaimed 4 times', fps: 24 };
    for (const copy of [studioEditorKo.export, studioEditorEn.export]) {
      const html = renderToStaticMarkup(h(ExportStatus, { job: failed, copy }));
      expect(html).toContain('data-editor-export-failed="hidden"');
      expect(html).toContain(copy.failed.hidden);
      expect(copy.failed.hidden).not.toBe(copy.failed.encode);
    }
  });

  it('no restart: no line', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: running(0), copy: studioEditorKo.export }));
    expect(html).not.toContain('data-editor-export-restarted');
    expect(html).toContain('data-editor-export-restarts="0"');
  });

  it('the finished file says how many times it started again (for the proof)', () => {
    const done: ExportJob = { status: 'done', url: 'blob:x', filename: 'f.mp4', bytes: 1, frames: 24, fps: 24, elapsedMs: 1, captionFile: null, warnings: [], paths: [], restarts: 2 };
    expect(renderToStaticMarkup(h(ExportStatus, { job: done, copy: studioEditorKo.export }))).toContain('data-editor-export-restarts="2"');
  });

  it('both languages have the lines, with no internal words, true for a covered, minimised or background window', () => {
    for (const line of [
      studioEditorKo.export.restarted,
      studioEditorEn.export.restarted,
      studioEditorKo.export.restartedSound,
      studioEditorEn.export.restartedSound,
      studioEditorKo.export.failed.hidden,
      studioEditorEn.export.failed.hidden,
    ]) {
      expect(line).not.toMatch(/가려져|covered/i);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/codec|encod|decod|webcodecs|코덱|인코더|디코더/i);
    }
  });
});

describe('the job shows a restart at once', () => {
  afterEach(() => {
    vi.doUnmock('@/components/brand-studio/editor-v2/export-film');
    vi.resetModules();
  });

  it('progress 200/315, then a restart: the sheet shows 0/315 and the restart right away', async () => {
    vi.resetModules();
    let report: ((progress: { phase: 'video'; done: number; total: number; restarts?: number }) => void) | null = null;
    vi.doMock('@/components/brand-studio/editor-v2/export-film', async (original) => ({
      ...(await original<object>()),
      exportFilm: (options: { onProgress: typeof report }) => {
        report = options.onProgress;
        return new Promise(() => undefined);
      },
    }));
    vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => undefined, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
    const job = await import('@/components/brand-studio/editor-v2/export-job');
    job.startExport({ sequence: { fps: 24, aspect: '16:9', clips: [], captions: [] } as never, reframe: {}, framing: 'reframe', extras: null, burnCaptions: false, captionText: null, notify: () => undefined });
    report!({ phase: 'video', done: 200, total: 315 });
    report!({ phase: 'video', done: 0, total: 315, restarts: 1 });
    const now = job.exportJobSnapshot();
    expect(now.status).toBe('running');
    if (now.status !== 'running') return;
    expect(now.progress.done).toBe(0);
    expect(now.restarts).toBe(1);
    expect(now.restartedPhase).toBe('video');
    // The sound written again later: the line says so.
    report!({ phase: 'audio', done: 0, total: 1, restarts: 2 } as never);
    const later = job.exportJobSnapshot();
    expect(later.status === 'running' && later.restartedPhase).toBe('audio');
    job.cancelExport();
    vi.unstubAllGlobals();
  });
});

describe('spec H, F3: the export gives up with its own reason', () => {
  it('ReclaimedTooOften becomes ExportStop("hidden"), for pictures and sound alike', async () => {
    const { givenUp, ExportStop } = await import('@/components/brand-studio/editor-v2/export-film');
    const { ReclaimedTooOften } = await import('@/lib/brand-studio/editor-v2/export-run');
    for (const codec of ['video', 'audio'] as const) {
      let thrown: unknown = null;
      try {
        givenUp(new ReclaimedTooOften(4, codec));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ExportStop);
      expect((thrown as InstanceType<typeof ExportStop>).reason).toBe('hidden');
    }
    const other = new Error('something else');
    expect(() => givenUp(other)).toThrow(other);
  });
});
