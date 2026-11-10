import { describe, expect, it } from 'vitest';
import { readFilm } from '@/lib/brand-studio/film-sheet';
import { samplingFps } from '@/lib/brand-studio/film-sheet/index';
import { normalizeFilmSheet } from '@/lib/brand-studio/film-sheet/schema';
import { ENV, mockGemini, sentBody } from '../intel/helpers';

/**
 * docs/BRAND-STUDIO-V3.md §6 — the blueprint reading: closer sampling, each cut's handover, the camera
 * split into travel / turn / zoom, the subjects with their counts and the setting. The basic reading the
 * existing callers get is unchanged.
 */
const NO_BOXES = { seconds: null, width: null, height: null };
const RAW = {
  seconds: 6,
  aspect: '9:16',
  shots: [
    { start: 0, end: 2.5, framing: 'close-up', camera: 'slow push in', action: 'A lifts B', transition: 'hard cut on the lift', move: { travel: 'push in from waist to label', turn: 'none', zoom: 'none' } },
    { start: 2.5, end: 6, framing: 'wide', camera: 'locked-off', action: 'A turns away', transition: 'end', move: { travel: 'none', turn: 'none', zoom: 'none' } },
  ],
  look: { lighting: 'soft daylight', palette: 'white and blue', texture: 'clean' },
  audio: { music: true, speech: false, effects: 'footsteps' },
  summary: '6초 길이에 컷은 두 개예요. 카메라가 천천히 다가가요.',
  subjects: [
    { id: 'A', what: 'woman in a white shirt', count: 1 },
    { id: 'B', what: 'glass bottles', count: 2.4 },
    { id: 'C', what: 'Sunra logo', count: 1 },
    { id: '', what: '', count: 1 },
  ],
  setting: 'a bright bathroom',
};

describe('normalizing a blueprint reading', () => {
  it('keeps handovers, the split camera, subjects with whole counts and the setting', () => {
    const sheet = normalizeFilmSheet(RAW, NO_BOXES, 'ko')!;
    expect(sheet.shots[0]).toMatchObject({ transition: 'hard cut on the lift', move: { travel: 'push in from waist to label', turn: 'none', zoom: 'none' } });
    expect(sheet.subjects).toEqual([
      { id: 'A', what: 'woman in a white shirt', count: 1 },
      { id: 'B', what: 'glass bottles', count: 2 },
    ]);
    expect(sheet.setting).toBe('a bright bathroom');
  });

  it('gives the basic reading exactly the old shape', () => {
    const { subjects: _s, setting: _t, ...basic } = RAW;
    const sheet = normalizeFilmSheet({ ...basic, shots: basic.shots.map(({ transition: _a, move: _b, ...shot }) => shot) }, NO_BOXES, 'ko')!;
    expect(Object.keys(sheet).sort()).toEqual(['aspect', 'audio', 'look', 'seconds', 'shots', 'summary']);
    expect(Object.keys(sheet.shots[0]!).sort()).toEqual(['action', 'camera', 'end', 'framing', 'start']);
  });
});

describe('asking for a blueprint reading', () => {
  it('sends the blueprint rules and schema, thinks harder, and samples twice as densely', async () => {
    const fetchMock = mockGemini(RAW);
    const sheet = await readFilm({ video: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'video/mp4' }, locale: 'ko', depth: 'blueprint' }, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(sheet?.subjects).toHaveLength(2);
    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0]!.text).toMatch(/This reading is a blueprint/);
    expect(body.systemInstruction.parts[0]!.text).toMatch(/parallax/);
    const config = body.generationConfig as { responseJsonSchema: { required: string[] }; thinkingConfig: { thinkingLevel: string } };
    expect(config.responseJsonSchema.required).toEqual(expect.arrayContaining(['subjects', 'setting', 'shots']));
    // Gemini refused this richer schema with item caps (400, 2026-11-11); the caps live in the normalizer.
    expect(JSON.stringify(config.responseJsonSchema)).not.toMatch(/maxItems|minItems/);
    expect(config.thinkingConfig.thinkingLevel).toBe('HIGH');
    expect(samplingFps(8, 'blueprint')).toBe(8);
    expect(samplingFps(30, 'blueprint')).toBe(4);
    expect(samplingFps(50, 'blueprint')).toBe(1);
  });

  it('leaves the basic reading as it was', async () => {
    const fetchMock = mockGemini(RAW);
    await readFilm({ video: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'video/mp4' }, locale: 'ko' }, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0]!.text).not.toMatch(/blueprint/);
    const config = body.generationConfig as { responseJsonSchema: { required: string[] }; thinkingConfig: { thinkingLevel: string } };
    expect(config.responseJsonSchema.required).not.toContain('subjects');
    expect(config.thinkingConfig.thinkingLevel).toBe('MEDIUM');
    expect([samplingFps(8), samplingFps(30), samplingFps(50)]).toEqual([4, 2, null]);
  });
});
