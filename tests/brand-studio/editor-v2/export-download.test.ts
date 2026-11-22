import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportAutoDownload } from '@/lib/brand-studio/editor-v2/decode-plan';

/**
 * Spec H, F9: a finished export downloads by itself. For the checks, `?exportDownload=off` on the editor page
 * skips only that automatic download; the job still ends `done` with its file, so the sheet, its data and
 * "download again" are unchanged. Without the parameter nothing changes.
 */
describe('the switch', () => {
  it('only "off" turns the automatic download off', () => {
    expect(exportAutoDownload('off')).toBe(false);
    expect(exportAutoDownload(['off', 'on'])).toBe(false);
    for (const value of [undefined, null, '', 'on', 'OFF', '0', ['on']]) expect(exportAutoDownload(value)).toBe(true);
  });
});

describe('the finished export', () => {
  afterEach(() => {
    vi.doUnmock('@/components/brand-studio/editor-v2/export-film');
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function finish(download: boolean | undefined) {
    vi.resetModules();
    vi.doMock('@/components/brand-studio/editor-v2/export-film', async (original) => ({
      ...(await original<object>()),
      exportFilm: async () => ({ blob: new Blob([new Uint8Array(8)]), filename: 'film.mp4', frames: 24, fps: 24, elapsedMs: 1, warnings: [], paths: [], restarts: 0 }),
    }));
    vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => undefined, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
    const clicks: string[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const link = { href: '', download: '', rel: '', style: {}, click: () => clicks.push(link.download), remove: () => undefined };
        return link;
      },
      body: { appendChild: () => undefined },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:film');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const job = await import('@/components/brand-studio/editor-v2/export-job');
    const notified: string[] = [];
    job.startExport({
      sequence: { fps: 24, aspect: '16:9', clips: [], captions: [] } as never,
      reframe: {},
      framing: 'reframe',
      extras: null,
      burnCaptions: false,
      captionText: null,
      notify: (outcome) => notified.push(outcome),
      ...(download === undefined ? {} : { download }),
    });
    await vi.waitFor(() => expect(job.exportJobSnapshot().status).toBe('done'));
    return { now: job.exportJobSnapshot(), clicks, notified };
  }

  it('without the switch: done, and the file downloads once', async () => {
    const { now, clicks } = await finish(undefined);
    expect(now.status === 'done' && now.url).toBe('blob:film');
    expect(clicks).toEqual(['film.mp4']);
  });

  it('with the switch: done with the same file and notice, and nothing downloads', async () => {
    const { now, clicks, notified } = await finish(false);
    expect(now.status === 'done' && now.url).toBe('blob:film');
    expect(now.status === 'done' && now.filename).toBe('film.mp4');
    expect(clicks).toEqual([]);
    expect(notified).toEqual(['done']);
  });
});
