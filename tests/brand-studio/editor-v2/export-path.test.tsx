import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportStatus, unevenClipOnSeek } from '@/components/brand-studio/editor-v2/export-sheet';
import type { ExportJob } from '@/components/brand-studio/editor-v2/export-job';
import { soundReads } from '@/lib/brand-studio/editor-v2/export-plan';
import type { FrameClip, FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { studioEditorKo } from '@/messages/studio-editor';

/**
 * Spec F, F4 / F5: with the decoder path the export no longer waits for the screen, so the sheet must not
 * say "the window is covered, so it is slow" there; on the seek path (fallback) it says it as before.
 * The finished job records which path made each source's pictures, for the proof (not customer copy).
 */
const clip = (id: string, srcUrl: string, extra: Partial<FrameClip> = {}): FrameClip => ({
  id,
  label: id,
  srcUrl,
  thumbUrl: null,
  sourceFps: 24,
  sourceFrames: 48,
  inFrame: 0,
  phase: 0,
  frames: 24,
  speedNum: 1,
  speedDen: 1,
  volume: 1,
  muted: false,
  ...extra,
});
const sequence: FrameSequence = { fps: 24, aspect: '16:9', clips: [clip('a', '/a.mp4'), clip('b', '/b.mp4')], captions: [] };

describe('the export job: the slow line only while the seek path makes the picture', () => {
  let progress: ((p: { phase: 'video' | 'audio' | 'writing'; done: number; total: number; path?: 'decoder' | 'seek' }) => void) | null = null;
  let refresh: ((reduced: boolean) => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('performance', { now: () => 1e9 + Math.random() * 1e6 });
    vi.doMock('@/components/brand-studio/editor-v2/screen-refresh', () => ({
      watchRefresh: (listener: (reduced: boolean) => void) => {
        refresh = listener;
        listener(false);
        return () => undefined;
      },
    }));
    vi.doMock('@/components/brand-studio/editor-v2/export-film', async (importOriginal) => ({
      ...(await importOriginal<object>()),
      exportFilm: (options: { onProgress: typeof progress }) => {
        progress = options.onProgress;
        return new Promise(() => undefined);
      },
    }));
  });
  afterEach(() => {
    vi.doUnmock('@/components/brand-studio/editor-v2/screen-refresh');
    vi.doUnmock('@/components/brand-studio/editor-v2/export-film');
    vi.unstubAllGlobals();
  });

  it('covered while the decoder path runs: no line; covered while the seek path runs: the line', async () => {
    const job = await import('@/components/brand-studio/editor-v2/export-job');
    job.startExport({ sequence, reframe: {}, framing: 'reframe', extras: null, burnCaptions: true, captionText: null, notify: () => undefined, path: null });
    const slow = () => {
      const now = job.exportJobSnapshot();
      return now.status === 'running' && now.slow;
    };
    progress!({ phase: 'video', done: 1, total: 48, path: 'decoder' });
    refresh!(true);
    expect(slow()).toBe(false);
    progress!({ phase: 'video', done: 30, total: 48, path: 'seek' });
    expect(slow()).toBe(true);
    refresh!(false);
    expect(slow()).toBe(false);
    refresh!(true);
    progress!({ phase: 'video', done: 31, total: 48, path: 'decoder' });
    expect(slow()).toBe(false);
    job.cancelExport();
  });
});

describe('the finished file says which path made its pictures (for the proof)', () => {
  const done = (paths: Array<{ clip: string; path: 'decoder' | 'seek'; reason: string | null }>): ExportJob => ({
    status: 'done',
    url: 'blob:x',
    filename: 'f.mp4',
    bytes: 1000,
    frames: 48,
    fps: 24,
    elapsedMs: 1200,
    captionFile: null,
    warnings: [],
    restarts: 0,
    paths: paths.map((entry) => ({
      ...entry,
      srcUrl: `/${entry.clip}.mp4`,
      decoded: entry.path === 'decoder' ? 24 : 0,
      seeked: entry.path === 'seek' ? 24 : 0,
      bytesRead: 10,
      fileBytes: 20,
      requests: 1,
    })),
  });

  it('all by decoder, all by seeking, or mixed; the detail as data, not as words on the sheet', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: done([{ clip: 'a', path: 'decoder', reason: null }]), copy: studioEditorKo.export }));
    expect(html).toContain('data-editor-export-path="decoder"');
    expect(html).toContain('data-editor-export-paths=');
    expect(renderToStaticMarkup(h(ExportStatus, { job: done([{ clip: 'a', path: 'seek', reason: 'forced' }]), copy: studioEditorKo.export }))).toContain('data-editor-export-path="seek"');
    const mixed = renderToStaticMarkup(h(ExportStatus, { job: done([{ clip: 'a', path: 'decoder', reason: null }, { clip: 'b', path: 'seek', reason: 'container:not-mp4' }]), copy: studioEditorKo.export }));
    expect(mixed).toContain('data-editor-export-path="mixed"');
    // No path, codec or vendor word reaches the customer's text.
    const text = mixed.replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/decoder|seek|codec|WebCodecs|VideoDecoder/i);
  });
});

describe('the uneven-footage line before export', () => {
  it('names footage that will be seeked; footage the decoder takes follows its own timestamps', () => {
    const variable = { '/a.mp4': true as const, '/b.mp4': true as const };
    expect(unevenClipOnSeek(sequence, variable, {})?.id).toBe('a');
    expect(unevenClipOnSeek(sequence, variable, { '/a.mp4': 'decoder' })?.id).toBe('b');
    expect(unevenClipOnSeek(sequence, variable, { '/a.mp4': 'decoder', '/b.mp4': 'decoder' })).toBeUndefined();
    expect(unevenClipOnSeek(sequence, variable, { '/a.mp4': 'seek', '/b.mp4': 'decoder' })?.id).toBe('a');
    expect(unevenClipOnSeek(sequence, {}, {})).toBeUndefined();
  });
});

describe('sound: a file with no sound track is not read whole', () => {
  it('cuts whose file has no sound track are left out of what is read for sound (and of the size check)', () => {
    expect(soundReads(sequence, null)).toEqual(['/a.mp4', '/b.mp4']);
    expect(soundReads(sequence, null, new Set(['/a.mp4']))).toEqual(['/b.mp4']);
  });
});
