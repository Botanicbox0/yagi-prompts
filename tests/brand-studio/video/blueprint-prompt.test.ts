import { describe, expect, it } from 'vitest';
import type { FilmSheet } from '@/lib/brand-studio/contracts';
import { composeFallbackPrompt, enhancePrompt, seedanceReferenceMode, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { blueprintShape, blueprintShots, cameraLine, handover, subjectsLine } from '@/lib/brand-studio/enhancer/blueprint';
import { ENV, mockGemini, sentBody, sentPayload } from '../intel/helpers';

/**
 * docs/BRAND-STUDIO-V3.md §6 — the blueprint prompt. The reference video is never attached, so the
 * prompt must carry everything in the house form: a visual-style block, the subjects with their counts,
 * and a timeline from 0 to the full length with the camera split into travel / pan-tilt / zoom and a
 * handover at every boundary. Without the text model the shot table is written out deterministically.
 */
const SHEET: FilmSheet = {
  seconds: 6,
  aspect: '9:16',
  shots: [
    { start: 0, end: 2, framing: 'close-up of a hand on a bottle', camera: 'slow push in', action: 'A lifts B', transition: 'hard cut on the lift', move: { travel: 'slow push in from waist height to the label', turn: 'none', zoom: 'none' } },
    { start: 2, end: 4, framing: 'medium shot', camera: 'handheld follow', action: 'A walks to the window', transition: 'continuous, no cut', move: { travel: 'handheld follow behind her', turn: 'pan right to the window', zoom: 'none' } },
    { start: 4, end: 6, framing: 'wide shot', camera: 'locked-off', action: 'A sprays and turns away', transition: 'end', move: { travel: 'none', turn: 'none', zoom: 'none' } },
  ],
  look: { lighting: 'soft daylight from the left', palette: 'white walls, pale blue towels', texture: 'clean, fine grain' },
  audio: { music: true, speech: false, effects: 'footsteps' },
  summary: '6초, 컷 두 개.',
  subjects: [
    { id: 'A', what: 'woman in a white shirt', count: 1 },
    { id: 'B', what: 'glass perfume bottles', count: 2 },
  ],
  setting: 'a bright bathroom',
};

function input(overrides: Partial<EnhanceInput> = {}, video: Partial<NonNullable<EnhanceInput['video']>> = {}): EnhanceInput {
  return {
    kind: 'video_remix',
    profile: 'seedance',
    locale: 'ko',
    prompt: '',
    references: [{ index: 2, kind: 'image', label: '이미지 1', role: 'product' }],
    brand: { name: 'Fixture' },
    video: { seconds: 9, aspect: '9:16', audio: 'native', method: 'blueprint', keep: ['camera', 'timing', 'composition', 'motion', 'look'], change: '제품: 우리 세럼 병 (이미지 1)', sheet: SHEET, ...video },
    ...overrides,
  };
}

const RANGE = /^(\d+\.\d)–(\d+\.\d)s: /gm;

describe('the deterministic blueprint (no text model)', () => {
  it('writes the house form: references, visual style, subjects, a contiguous timeline with handovers, last frame, sound', () => {
    const { prompt, source } = composeFallbackPrompt(input());
    expect(source).toBe('fallback');
    const lines = prompt.split('\n');
    expect(lines[0]).toMatch(/^@Image1 supplies only the product/);
    expect(prompt).toContain('Visual style: A bright bathroom. Soft daylight from the left. White walls, pale blue towels. Clean, fine grain.');
    expect(prompt).toContain('On screen: A — one woman in a white shirt; B — two glass perfume bottles. Keep these counts in every range.');
    expect(prompt).toContain('Change: 제품: 우리 세럼 병 (@Image1). Apply it wherever it appears below');
    // One line per changed thing reads as one sentence.
    expect(composeFallbackPrompt(input({}, { change: '제품: 병 (이미지 1)\n장소: 흰 욕실' })).prompt).toContain('Change: 제품: 병 (@Image1); 장소: 흰 욕실.');
    // 6 s of reference laid on 9 s of output, end to end.
    const ranges = [...prompt.matchAll(RANGE)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(ranges).toEqual([[0, 3], [3, 6], [6, 9]]);
    expect(prompt).toContain('0.0–3.0s: Close-up of a hand on a bottle. A lifts B. Camera — travel: slow push in from waist height to the label; pan/tilt: none; zoom: none. Hard cut on the lift.');
    expect(prompt).toContain('3.0–6.0s: Medium shot. A walks to the window. Camera — travel: handheld follow behind her; pan/tilt: pan right to the window; zoom: none. Continuous into the next range, no cut.');
    expect(prompt).toContain('6.0–9.0s: Wide shot. A sprays and turns away. Camera: locked off, no travel, pan, tilt or zoom.');
    expect(lines.find((l) => l.startsWith('6.0–9.0s'))).not.toMatch(/cut\.|Continuous/);
    expect(prompt).toContain('Last frame: Wide shot, A sprays and turns away.');
    expect(lines[lines.length - 1]).toMatch(/^Audio: /);
    // The video is never attached, so it is never named.
    expect(prompt).not.toMatch(/@Video|reference video/i);
    expect(blueprintShape(prompt, 9, input().video!.keep)).toBe(true);
  });

  it('writes only what is kept, and still closes every boundary', () => {
    const { prompt } = composeFallbackPrompt(input({}, { keep: ['timing'] }));
    expect(prompt).not.toContain('Visual style:');
    expect(prompt).not.toContain('Camera');
    expect(prompt).toContain('0.0–3.0s: Continue the scene. Hard cut on the lift.');
    expect(blueprintShape(prompt, 9, ['timing'])).toBe(true);
  });

  it('remakes with nothing to change, and writes no tokens when nothing is attached', () => {
    const { prompt } = composeFallbackPrompt(input({ references: [] }, { change: '' }));
    expect(prompt).not.toMatch(/@Image|Change:/);
    expect([...prompt.matchAll(RANGE)]).toHaveLength(3);
  });

  it('with an opening frame only, starts from it without tokens', () => {
    const { prompt } = composeFallbackPrompt(input({ references: [{ index: 2, kind: 'image', label: '이미지 1', frame: 'start' }] }));
    expect(prompt).toContain('Start from the opening frame and move on from it.');
    expect(prompt).not.toMatch(/@Image/);
  });
});

describe('blueprint pieces', () => {
  it('lays the table on the output length and keeps each handover and split camera', () => {
    const shots = blueprintShots(9, { sheet: SHEET });
    expect(shots.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 6], [6, 9]]);
    expect(shots[1]).toMatchObject({ transition: 'continuous, no cut', move: { turn: 'pan right to the window' } });
    expect(blueprintShots(null, { sheet: SHEET })).toEqual([]);
    expect(blueprintShots(9, { sheet: null })).toEqual([]);
  });

  it('says the handover, the camera and the cast plainly', () => {
    expect(handover({ transition: '' }, false)).toBe('Hard cut.');
    expect(handover({ transition: 'dissolve' }, false)).toBe('Dissolve.');
    expect(handover({ transition: 'one take' }, false)).toBe('Continuous into the next range, no cut.');
    expect(handover({ transition: 'hard cut' }, true)).toBe('');
    expect(cameraLine({ camera: 'slow orbit right' })).toBe('Camera: Slow orbit right.');
    expect(cameraLine({ camera: 'x', move: { travel: 'orbit left around the table', turn: '', zoom: 'zoom in on the label' } })).toBe(
      'Camera — travel: orbit left around the table; pan/tilt: none; zoom: zoom in on the label.',
    );
    expect(subjectsLine([{ id: 'A', what: 'dancers', count: 3 }])).toBe('On screen: A — three dancers. Keep these counts in every range.');
    expect(subjectsLine(undefined)).toBe('');
  });

  it('refuses a written blueprint with a gap, a missing handover, a short end or no style block', () => {
    const good = 'Visual style: x.\n0.0–2.0s: a. Hard cut.\n2.0–4.0s: b.';
    expect(blueprintShape(good, 4, ['look'])).toBe(true);
    expect(blueprintShape(good, 4, ['timing'])).toBe(true);
    expect(blueprintShape('0.0–2.0s: a. Hard cut.\n2.0–4.0s: b.', 4, ['look'])).toBe(false);
    expect(blueprintShape('0.0–2.0s: a. Hard cut.\n2.5–4.0s: b.', 4)).toBe(false);
    expect(blueprintShape('0.0–2.0s: a.\n2.0–4.0s: b.', 4)).toBe(false);
    expect(blueprintShape('0.0–2.0s: a. Hard cut.\n2.0–3.0s: b.', 4)).toBe(false);
    expect(blueprintShape('A woman walks.', 4)).toBe(false);
  });

  it('decides the endpoint like a plain video once the video is not among the references', () => {
    expect(seedanceReferenceMode('video_remix', [])).toBe('text');
    expect(seedanceReferenceMode('video_remix', [{ kind: 'image', frame: 'start' }])).toBe('frames');
    expect(seedanceReferenceMode('video_remix', [{ kind: 'image' }])).toBe('reference');
    expect(seedanceReferenceMode('video_remix', [{ kind: 'video' }])).toBe('reference');
  });
});

describe('the blueprint through the text model', () => {
  const answer = (prompt: string) => ({ prompt, notes: '설계도대로 다시 썼어요.' });
  const good = [
    '@Image1 supplies only the product: its exact shape, label and colours.',
    'Visual style: a bright bathroom, soft daylight from the left, white walls and pale blue towels.',
    'On screen: one woman in a white shirt; two serum bottles.',
    '0.0–3.0s: Close-up, she lifts @Image1. Camera — travel: slow push in to the label; pan/tilt: none; zoom: none. Hard cut.',
    '3.0–6.0s: Medium shot, she walks to the window. Camera — travel: handheld follow; pan/tilt: pan right; zoom: none. Continuous into the next range, no cut.',
    '6.0–9.0s: Wide shot, she sprays and turns away. Camera: locked off.',
    'Last frame: she stands by the window.',
    'Audio: footsteps, a soft spray, music that fits the mood.',
  ].join('\n');

  it('asks for the house form, hands over the blueprint in the user turn, and keeps a good answer', async () => {
    const fetchMock = mockGemini(answer(good));
    const result = await enhancePrompt(input(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('model');
    expect(result.prompt).toContain('0.0–3.0s');
    const system = sentBody(fetchMock).systemInstruction.parts[0]!.text;
    expect(system).toMatch(/remake a reference video from its blueprint alone/);
    expect(system).toMatch(/travel .* pan\/tilt .* zoom/s);
    expect(system).toMatch(/End every line except the last with its handover/);
    // The task names no video token (the shared profile lists token spellings in general).
    expect(system.slice(system.indexOf('Task:'))).not.toMatch(/@Video1/);
    const payload = sentPayload(fetchMock);
    expect(payload.video?.shots).toHaveLength(3);
    expect((payload.video?.shots?.[0] as { transition?: string }).transition).toBe('hard cut on the lift');
    expect(JSON.stringify(payload)).toContain('glass perfume bottles');
    expect(payload.references.every((r) => r.token !== '@Video1')).toBe(true);
  });

  it('falls back to the written-out table when the answer has no proper timeline', async () => {
    const fetchMock = mockGemini(answer('@Image1 supplies the bottle. Visual style: bright. She walks to the window and sprays. Audio: footsteps.'));
    const result = await enhancePrompt(input(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('fallback');
    expect([...result.prompt.matchAll(RANGE)]).toHaveLength(3);
  });

  it('still writes a remake when nothing is to change', async () => {
    const fetchMock = mockGemini(answer(good));
    const result = await enhancePrompt(input({ references: [] }, { change: '' }), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The answer used a token that was not attached, so the deterministic form is sent instead.
    expect(result.source).toBe('fallback');
    expect(result.prompt).not.toMatch(/@Image/);
  });
});
