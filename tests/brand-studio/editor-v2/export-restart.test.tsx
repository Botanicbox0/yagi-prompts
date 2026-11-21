import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const film = readFileSync(join(process.cwd(), 'components/brand-studio/editor-v2/export-film.ts'), 'utf8');

describe('the export asks its encoder after the picture arrives and before encode()', () => {
  const pass = film.slice(film.indexOf('async function videoPass('));
  it('a taken-back encoder is checked after each picture and before encode(); encode() throwing is turned into that answer', () => {
    const picture = pass.indexOf('await paths.picture(entry, label, signal)');
    const check = pass.indexOf('const after = stopped(entry.frame);');
    const encode = pass.indexOf('made.encode(frame');
    expect(picture).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(picture);
    expect(encode).toBeGreaterThan(check);
    expect(pass).toMatch(/catch \(error\) \{\s*throw stopped\(entry\.frame\) \?\? new ExportStop\('encode'/);
    expect(pass).toMatch(/isReclaim\(failure\) \? new CodecReclaimed\('video'\)/);
  });

  it('the whole pass is run again on a reclaim (from frame 0, after the page is visible); the sound encode alone again on its own', () => {
    const run = film.slice(film.indexOf('export async function exportFilm('));
    expect(run).toMatch(/runWithRestarts\(\(\) => videoPass\(pass\), waitVisible/);
    expect(run).toMatch(/runWithRestarts\(\(\) => encodeAac\(rendered, signal\), waitVisible/);
    expect(run).toMatch(/whenVisible\(document, signal, cancelled\)/);
    expect(film).toMatch(/isReclaim\(failure\) \? new CodecReclaimed\('audio'\)/);
  });
});

describe('the sheet after a restart', () => {
  const running = (restarts: number): ExportJob => ({ status: 'running', progress: { phase: 'video', done: 0, total: 315 }, frames: 315, fps: 24, slow: false, restarts });

  it('one line saying why, the count from 0, and the number of restarts as data', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: running(1), copy: studioEditorKo.export }));
    expect(html).toContain('data-editor-export-restarted');
    expect(html).toContain(studioEditorKo.export.restarted);
    expect(html).toContain('data-editor-export-restarts="1"');
    expect(html).toContain('data-editor-export-progress="0/315"');
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

  it('both languages have the line, with no internal words', () => {
    for (const line of [studioEditorKo.export.restarted, studioEditorEn.export.restarted]) {
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
    job.cancelExport();
    vi.unstubAllGlobals();
  });
});
