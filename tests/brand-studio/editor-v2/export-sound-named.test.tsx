import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportStatus } from '@/components/brand-studio/editor-v2/export-sheet';
import type { ExportJob } from '@/components/brand-studio/editor-v2/export-job';
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { studioEditorEn, studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';
import { clip as harnessClip, film, loadExport, settle, unloadExport } from './export-harness';

/**
 * Audit A5 (2026-11-24): when the music (or an effect, or a cut's own sound) could not be read, the export
 * stopped with "the sound could not be put together" and nothing else. The stop now carries what could not
 * be read, and the sheet names it and says what to do: try again, and if it stays, take it out or change it
 * in the earlier editor (music and effects are edited there today), or for a cut, turn its sound off or
 * delete it.
 */
const URL_A = '/media/a.mp4';
const MUSIC = '/media/tone.mp3';
const EFFECT = '/media/whoosh.mp3';

const extras = (with_: { music?: boolean; effect?: boolean }) =>
  ({
    bgm: with_.music ? { label: 'audit tone', sourceKind: 'asset', srcUrl: MUSIC, durationSec: 30, trimStartSec: 0, volume: 0.5 } : null,
    sfxClips: with_.effect ? [{ id: 'f1', label: 'whoosh', sourceKind: 'asset', srcUrl: EFFECT, startSec: 0, durationSec: 1, volume: 1 }] : [],
    clips: [],
    captions: [],
  }) as unknown as ComposerProject;

describe('the stop says which sound could not be read', () => {
  afterEach(() => unloadExport());

  it('the music file answers 404: stopped as sound, naming the music', async () => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({ clips: { [URL_A]: { facts: { fps: 24, frames: 24 }, index: 'refused' } }, getStatus: (url) => (url === MUSIC ? 404 : 200) });
    const outcome = await settle(exportFilm({ sequence: film([harnessClip('a', URL_A, 12)]), extras: extras({ music: true }) }));
    expect(outcome.error).toMatchObject({ reason: 'sound', sound: 'music', clip: 'audit tone' });
  });

  it('an effect answers 404: stopped as sound, naming the effect', async () => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({ clips: { [URL_A]: { facts: { fps: 24, frames: 24 }, index: 'refused' } }, getStatus: (url) => (url === EFFECT ? 404 : 200) });
    const outcome = await settle(exportFilm({ sequence: film([harnessClip('a', URL_A, 12)]), extras: extras({ effect: true }) }));
    expect(outcome.error).toMatchObject({ reason: 'sound', sound: 'effect', clip: 'whoosh' });
  });

  it('two cuts of one clip, the first muted: the stop names the clip by a cut whose sound is heard (review item 2)', async () => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({ clips: { [URL_A]: { facts: { fps: 24, frames: 24 }, index: 'refused' } }, getStatus: (url) => (url === URL_A ? 503 : 200) });
    const muted = { ...harnessClip('first piece', URL_A, 12), muted: true };
    const heard = harnessClip('second piece', URL_A, 12);
    const outcome = await settle(exportFilm({ sequence: film([muted, heard]) }));
    expect(outcome.error).toMatchObject({ reason: 'sound', sound: 'cut', clip: 'second piece' });
  });

  it('a cut’s own file cannot be read for its sound: stopped as sound, naming the cut', async () => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({ clips: { [URL_A]: { facts: { fps: 24, frames: 24 }, index: 'refused' } }, getStatus: (url) => (url === URL_A ? 503 : 200) });
    const outcome = await settle(exportFilm({ sequence: film([harnessClip('a', URL_A, 12)]) }));
    expect(outcome.error).toMatchObject({ reason: 'sound', sound: 'cut', clip: 'a' });
  });
});

describe('the job keeps what the stop named', () => {
  afterEach(() => {
    vi.doUnmock('@/components/brand-studio/editor-v2/export-film');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('a stop naming the music becomes a failed job naming the music', async () => {
    vi.resetModules();
    vi.doMock('@/components/brand-studio/editor-v2/export-film', async (original) => {
      const actual = await original<typeof import('@/components/brand-studio/editor-v2/export-film')>();
      return { ...actual, exportFilm: () => Promise.reject(new actual.ExportStop('sound', 'could not read /media/tone.mp3: HTTP 404', { clip: 'audit tone', sound: 'music' })) };
    });
    vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => undefined, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = await import('@/components/brand-studio/editor-v2/export-job');
    job.startExport({ sequence: { fps: 24, aspect: '16:9', clips: [], captions: [] } as never, reframe: {}, framing: 'reframe', extras: null, burnCaptions: false, captionText: null, notify: () => undefined });
    await vi.waitFor(() => expect(job.exportJobSnapshot().status).toBe('failed'));
    expect(job.exportJobSnapshot()).toMatchObject({ status: 'failed', reason: 'sound', clip: 'audit tone', sound: 'music' });
  });
});

/** Text as React writes it into markup. */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

describe('the sheet names it and says what to do', () => {
  const failed = (sound: 'music' | 'effect' | 'cut' | null, clip: string | null): ExportJob => ({ status: 'failed', reason: 'sound', frame: null, clip, bytes: null, message: 'x', fps: 24, sound });
  const COPIES: ReadonlyArray<[string, StudioEditorCopy]> = [
    ['ko', studioEditorKo],
    ['en', studioEditorEn],
  ];

  for (const [lang, copy] of COPIES) {
    const e = copy.export;
    it(`${lang}: music, effect and cut each have their own line with the name in it`, () => {
      const cases = [
        ['music', 'audit tone', e.failed.soundMusic],
        ['effect', 'whoosh', e.failed.soundEffect],
        ['cut', 'runway walk', e.failed.soundCut],
      ] as const;
      for (const [sound, name, line] of cases) {
        const html = renderToStaticMarkup(h(ExportStatus, { job: failed(sound, name), copy: e }));
        expect(html).toContain('data-editor-export-failed="sound"');
        expect(html).toContain(`data-editor-export-sound="${sound}"`);
        expect(line).toContain('{name}');
        expect(html).toContain(esc(line.replace('{name}', name)));
        expect(html).not.toContain(esc(e.failed.sound));
      }
      expect(new Set([e.failed.soundMusic, e.failed.soundEffect, e.failed.soundCut]).size).toBe(3);
    });

    it(`${lang}: a sound stop that names nothing (writing the sound track failed) keeps the general line`, () => {
      const html = renderToStaticMarkup(h(ExportStatus, { job: failed(null, null), copy: e }));
      expect(html).toContain(esc(e.failed.sound));
      expect(html).not.toContain('data-editor-export-sound=');
    });
  }

  it('music points to the earlier editor, where it is changed today; an effect has no such place, so its line sends nobody there (review item 3)', () => {
    expect(studioEditorKo.export.failed.soundMusic).toContain('예전 편집기');
    expect(studioEditorEn.export.failed.soundMusic).toMatch(/earlier editor/);
    expect(studioEditorKo.export.failed.soundEffect).not.toContain('편집기');
    expect(studioEditorEn.export.failed.soundEffect).not.toMatch(/editor/);
    expect(studioEditorKo.export.failed.soundEffect).toContain('다시 시도');
    expect(studioEditorEn.export.failed.soundEffect).toMatch(/try again/i);
  });

  it('a cut’s sound: the advice covers every cut of that clip, not one cut (review item 2)', () => {
    expect(studioEditorKo.export.failed.soundCut).toContain('클립');
    expect(studioEditorKo.export.failed.soundCut).toContain('모두');
    expect(studioEditorEn.export.failed.soundCut).toMatch(/clip/);
    expect(studioEditorEn.export.failed.soundCut).toMatch(/every cut/);
  });
});
