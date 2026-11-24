import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportSheet, exportBlockOf, exportBlockSentence } from '@/components/brand-studio/editor-v2/export-sheet';
import { ActionPanel } from '@/components/brand-studio/editor-v2/panels';
import { Preview } from '@/components/brand-studio/editor-v2/preview';
import { Timeline } from '@/components/brand-studio/editor-v2/timeline';
import { useEditor, type RealFilmOptions } from '@/components/brand-studio/editor-v2/use-editor';
import { spansOf, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { RangeRefused, readFailureOf } from '@/lib/brand-studio/editor-v2/ranged-source';
import { studioEditorEn, studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';

/**
 * Audit A4 (2026-11-24): a cut whose footage file is gone was told "the frame rate has not been read yet, open
 * the film again" in the panel and in the export sheet, for ever. A file is missing only when it answered
 * not-found (404/410) AND the organization's complete record does not hold the asset (./missing-record.test.ts):
 * the footage route also answers 404 when a storage read fails. A missing cut is marked on the timeline, the panel
 * and the sheet say the file cannot be found and what to do, and the export is blocked with its own reason.
 * Anything else keeps the behaviour from before (stored frame data used, playback tried, "not read yet").
 */

describe('what a failed read answered', () => {
  it('404 and 410: the server said not found (which alone does not prove the file is gone)', () => {
    expect(readFailureOf(new RangeRefused(404))).toBe('not-found');
    expect(readFailureOf(new RangeRefused(410))).toBe('not-found');
  });

  it('every other failure is one that may pass: refused, server errors, no network, anything else', () => {
    for (const status of [401, 403, 429, 500, 502, 503, 206]) expect(readFailureOf(new RangeRefused(status)), String(status)).toBe('broken');
    expect(readFailureOf(new TypeError('Failed to fetch'))).toBe('broken');
    expect(readFailureOf(new Error('boom'))).toBe('broken');
    expect(readFailureOf(null)).toBe('broken');
  });
});

describe('reading the file’s facts tells a not-found answer apart', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/components/brand-studio/editor-v2/footage-facts');
  });

  it('404: answered as not found, never kept for the visit: the next read asks again and its answer counts', async () => {
    let status = 404;
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('performance', { now: () => 0 });
    const { readFootage, footageNotFound } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect((await readFootage('/media/gone.mp4')).answer).toEqual({ ok: false, reason: 'not-found' });
    expect(footageNotFound('/media/gone.mp4')).toBe(true);
    status = 503;
    expect((await readFootage('/media/gone.mp4')).answer).toEqual({ ok: false, reason: 'broken' });
    expect(footageNotFound('/media/gone.mp4')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a refused request (403) or no network is not a not-found answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    vi.stubGlobal('performance', { now: () => 0 });
    const { readFootage, footageNotFound } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect((await readFootage('/media/refused.mp4')).answer).toEqual({ ok: false, reason: 'broken' });
    expect(footageNotFound('/media/refused.mp4')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect((await readFootage('/media/offline.mp4')).answer).toEqual({ ok: false, reason: 'broken' });
    expect(footageNotFound('/media/offline.mp4')).toBe(false);
  });

  it('a never-measured clip whose file answered 404 is still measured by playback, as before (the asset may be there)', async () => {
    const created: string[] = [];
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      createElement: (tag: string) => (created.push(tag), {}),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.doMock('@/components/brand-studio/editor-v2/footage-facts', () => ({
      readFootage: async () => ({ answer: { ok: false, reason: 'not-found' }, requests: 1, received: 0, mode: null, ms: 1 }),
    }));
    const { measureSource } = await import('@/components/brand-studio/editor-v2/measure-fps');
    expect(await measureSource('/media/hiccup.mp4', 10)).toBeNull();
    expect(created).toContain('video');
  });
});

const ORG = '00000000-0000-4000-8000-0000000000aa';
const real: RealFilmOptions = { organizationId: ORG, canEdit: true, sources: [], sampleBase: `/brand/studio/editor?sample=1&organizationId=${ORG}` };
const GONE = '/api/brand-studio/compose?organizationId=org&source=asset&id=gone';
const UNREAD = '/api/brand-studio/compose?organizationId=org&source=asset&id=unread';
const FINE = '/api/brand-studio/compose?organizationId=org&source=asset&id=fine';

const clip = (id: string, srcUrl: string, extra: Partial<FrameClip> = {}): FrameClip => ({
  id,
  label: `${id} clip`,
  srcUrl,
  thumbUrl: null,
  sourceFps: 24,
  sourceFrames: 48,
  inFrame: 0,
  phase: 0,
  frames: 48,
  speedNum: 1,
  speedDen: 1,
  volume: 1,
  muted: false,
  ...extra,
});
const film = (clips: FrameClip[]): FrameSequence => ({ fps: 24, aspect: '9:16', captions: [], clips });

/** The editor on the organization's film, with these cuts and these read results (what opening the film found). */
function editor(copy: StudioEditorCopy, sequence: FrameSequence, found: { missing?: string[]; unknown?: string[]; tentative?: boolean }, selected?: string) {
  let api: ReturnType<typeof useEditor> | null = null;
  function Probe() {
    api = useEditor(copy, { real, initialWorkspace: 'cut' });
    return null;
  }
  renderToStaticMarkup(h(Probe));
  const seen = api as unknown as ReturnType<typeof useEditor>;
  const flags = (srcs: string[] = []) => Object.fromEntries(srcs.map((src) => [src, true as const]));
  return {
    ...seen,
    status: 'ready' as const,
    sequence,
    fps: sequence.fps,
    spans: spansOf(sequence),
    total: sequence.clips.reduce((sum, entry) => sum + entry.frames, 0),
    missingSources: flags(found.missing),
    unknownRates: flags([...(found.missing ?? []), ...(found.unknown ?? [])]),
    selection: selected ? [selected] : [],
    tentative: found.tentative ?? false,
  };
}

/** Text as React writes it into markup. */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const COPIES: ReadonlyArray<[string, StudioEditorCopy]> = [
  ['ko', studioEditorKo],
  ['en', studioEditorEn],
];

describe('the export is blocked for its own reason', () => {
  const sequence = film([clip('fine', FINE), clip('gone', GONE), clip('unread', UNREAD)]);

  it('a missing file comes before "rate not read", and names the cut', () => {
    const block = exportBlockOf({ real: true, readOnly: false, empty: false, supported: true, sequence, unknownRates: { [GONE]: true, [UNREAD]: true }, missingSources: { [GONE]: true } });
    expect(block).toEqual({ as: 'missing', clip: sequence.clips[1] });
  });

  it('only a rate not read yet: today’s block and line, unchanged', () => {
    const block = exportBlockOf({ real: true, readOnly: false, empty: false, supported: true, sequence, unknownRates: { [UNREAD]: true }, missingSources: {} });
    expect(block).toEqual({ as: 'rate', clip: sequence.clips[2] });
    expect(exportBlockSentence(studioEditorKo, block!)).toBe(studioEditorKo.export.rateUnknown.replace('{clip}', 'unread clip'));
  });

  it('nothing wrong: not blocked; the sample film never looks at the reads', () => {
    expect(exportBlockOf({ real: true, readOnly: false, empty: false, supported: true, sequence, unknownRates: {}, missingSources: {} })).toBeNull();
    expect(exportBlockOf({ real: false, readOnly: false, empty: false, supported: true, sequence, unknownRates: { [GONE]: true }, missingSources: { [GONE]: true } })).toBeNull();
  });

  it('read-only, empty and an unsupported browser keep their order before both', () => {
    const both = { unknownRates: { [GONE]: true as const }, missingSources: { [GONE]: true as const } };
    expect(exportBlockOf({ real: true, readOnly: true, empty: false, supported: true, sequence, ...both })?.as).toBe('read-only');
    expect(exportBlockOf({ real: true, readOnly: false, empty: true, supported: true, sequence, ...both })?.as).toBe('empty');
    expect(exportBlockOf({ real: true, readOnly: false, empty: false, supported: false, sequence, ...both })?.as).toBe('unsupported');
  });

  for (const [lang, copy] of COPIES) {
    it(`${lang}: the sheet says the file cannot be found, names the cut, and the button is off`, () => {
      const html = renderToStaticMarkup(h(ExportSheet, { api: editor(copy, sequence, { missing: [GONE], unknown: [UNREAD] }) }));
      expect(html).toContain('data-editor-export-blocked="missing"');
      expect(html).toContain(esc(copy.export.sourceMissing.replace('{clip}', 'gone clip')));
      expect(html).not.toContain(esc(copy.export.rateUnknown.replace('{clip}', 'gone clip')));
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-editor-export-start/);
    });
  }
});

describe('the cut panel and the timeline show the missing file', () => {
  const sequence = film([clip('fine', FINE), clip('gone', GONE), clip('unread', UNREAD)]);

  for (const [lang, copy] of COPIES) {
    it(`${lang}: the missing cut’s panel says the file cannot be found and what to do, not "read next time"`, () => {
      const html = renderToStaticMarkup(h(ActionPanel, { api: editor(copy, sequence, { missing: [GONE], unknown: [UNREAD] }, 'gone') }));
      expect(html).toContain('data-editor-source-missing');
      expect(html).toContain(esc(copy.real.sourceMissing));
      expect(html).not.toContain('data-editor-rate-unknown');
    });

    it(`${lang}: a cut whose rate was simply not read keeps today’s line`, () => {
      const html = renderToStaticMarkup(h(ActionPanel, { api: editor(copy, sequence, { missing: [GONE], unknown: [UNREAD] }, 'unread') }));
      expect(html).toContain('data-editor-rate-unknown');
      expect(html).not.toContain('data-editor-source-missing');
    });

    it(`${lang}: the missing cut carries a mark on the timeline; the others do not`, () => {
      const html = renderToStaticMarkup(h(Timeline, { api: editor(copy, sequence, { missing: [GONE], unknown: [UNREAD] }) }));
      expect(html.split('data-editor-clip-missing').length - 1).toBe(1);
      expect(html).toMatch(/data-editor-clip="2"[^>]*data-editor-clip-missing/);
      expect(html).toContain(`>${esc(copy.timeline.missing)}<`);
    });
  }

  it('the lines say what to do, in plain words, and differ from "not read yet"', () => {
    for (const [, copy] of COPIES) {
      for (const line of [copy.real.sourceMissing, copy.export.sourceMissing, copy.timeline.missing]) {
        expect(line.length).toBeGreaterThan(2);
        expect(line).not.toMatch(/404|HTTP|asset id|blob|seek|decod|encod|codec|디코더|인코더|코덱/i);
      }
      expect(copy.real.sourceMissing).not.toBe(copy.real.rateUnknown);
      expect(copy.export.sourceMissing).not.toBe(copy.export.rateUnknown);
      expect(copy.export.sourceMissing).toContain('{clip}');
    }
  });
});

describe('a film never measured whose cuts are all missing does not promise a reading next time', () => {
  const allGone = film([clip('gone', GONE), clip('again', GONE)]);
  const someLeft = film([clip('gone', GONE), clip('unread', UNREAD)]);

  for (const [lang, copy] of COPIES) {
    const missingLine = esc(copy.export.sourceMissing.replace('{clip}', 'gone clip'));
    const promise = esc(copy.real.rateTentative.replace('{fps}', '24'));

    it(`${lang}: the film panel says the clip’s file cannot be found, not that the rate is read next time`, () => {
      const html = renderToStaticMarkup(h(ActionPanel, { api: editor(copy, allGone, { missing: [GONE], tentative: true }) }));
      expect(html).toContain('data-editor-film-missing');
      expect(html).toContain(missingLine);
      expect(html).not.toContain('data-editor-rate-tentative');
      expect(html).not.toContain(promise);
    });

    it(`${lang}: the preview’s “for now” mark keeps its word but not the promise`, () => {
      const html = renderToStaticMarkup(h(Preview, { api: editor(copy, allGone, { missing: [GONE], tentative: true }) }));
      expect(html).toContain('data-editor-fps-tentative');
      expect(html).toContain(`title="${missingLine}"`);
      expect(html).not.toContain(promise);
    });

    it(`${lang}: one cut that may still be read keeps today’s line in both places`, () => {
      const panel = renderToStaticMarkup(h(ActionPanel, { api: editor(copy, someLeft, { missing: [GONE], unknown: [UNREAD], tentative: true }) }));
      expect(panel).toContain('data-editor-rate-tentative');
      expect(panel).not.toContain('data-editor-film-missing');
      const preview = renderToStaticMarkup(h(Preview, { api: editor(copy, someLeft, { missing: [GONE], unknown: [UNREAD], tentative: true }) }));
      expect(preview).toContain(`title="${promise}"`);
    });
  }
});
