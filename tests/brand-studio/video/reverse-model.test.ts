import { describe, expect, it } from 'vitest';
import { FilmAnalyzeSchema, STUDIO_REMIX_METHODS, VideoRemixJobSchema, type FilmSheet, type StudioAssetView, type StudioJobView } from '@/lib/brand-studio/contracts';
import { studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import { blueprintFit, normalizeShots, remakeSeconds } from '@/lib/brand-studio/reference-video';
import { creditsOf } from '@/lib/brand-studio/credits';
import { usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import {
  aspectFor,
  buildReverseJob,
  changeText,
  clipNotice,
  draftCredits,
  draftFromJob,
  editShot,
  emptyDraft,
  methodsFor,
  pickMethod,
  removeShot,
  setShotEnd,
  tableOf,
  type ReverseDraft,
} from '@/components/brand-studio/video/reverse-model';

/** docs/BRAND-STUDIO-V3.md §6 — the reverse panel's rules and the contract they send. */
const model = studioModel('seedance-2.5') as StudioVideoModel;
const ORG = '7a1f0000-0000-4000-8000-000000000001';
const VIDEO = '7a1f0000-0000-4000-8000-0000000000a1';
const IMG1 = '7a1f0000-0000-4000-8000-0000000000b1';
const IMG2 = '7a1f0000-0000-4000-8000-0000000000b2';
const clip = { id: VIDEO, seconds: 6.2, width: 1080, height: 1920 };
const words = { product: '제품', person: '인물', place: '장소', imageWord: '이미지' };
const SHEET: FilmSheet = {
  seconds: 6.2,
  aspect: '9:16',
  shots: [
    { start: 0, end: 2, framing: 'close-up', camera: 'push in', action: 'lifts', move: { travel: 'push in', turn: 'none', zoom: 'none' } },
    { start: 2, end: 4, framing: 'medium', camera: 'follow', action: 'walks' },
    { start: 4, end: 6.2, framing: 'wide', camera: 'locked-off', action: 'turns' },
  ],
  look: { lighting: 'soft', palette: 'blue', texture: 'clean' },
  audio: { music: false, speech: false, effects: '' },
  summary: '6초',
};
const draft = (patch: Partial<ReverseDraft> = {}): ReverseDraft => ({ ...emptyDraft(model), videoId: VIDEO, seconds: 6, ...patch });

describe('the contract', () => {
  it('knows the blueprint method, a bounded shot table and a reading depth', () => {
    expect(STUDIO_REMIX_METHODS).toContain('blueprint');
    const base = { kind: 'video_remix', organizationId: ORG, requestId: 'req_12345678', model: 'seedance-2.5', prompt: '', aspect: '9:16', resolution: 'draft', method: 'blueprint', references: [{ assetId: VIDEO }] };
    expect(VideoRemixJobSchema.safeParse({ ...base, shots: SHEET.shots }).success).toBe(true);
    expect(VideoRemixJobSchema.safeParse({ ...base, shots: [] }).success).toBe(false);
    expect(VideoRemixJobSchema.safeParse({ ...base, shots: [{ ...SHEET.shots[0]!, action: 'x'.repeat(201) }] }).success).toBe(false);
    expect(VideoRemixJobSchema.safeParse({ ...base, shots: [{ ...SHEET.shots[0]!, end: 0.05 }] }).success).toBe(false);
    expect(VideoRemixJobSchema.safeParse({ ...base, shots: [{ ...SHEET.shots[0]!, move: { travel: 'x', turn: 'y' } }] }).success).toBe(false);
    expect(FilmAnalyzeSchema.safeParse({ organizationId: ORG, assetId: VIDEO, depth: 'blueprint' }).success).toBe(true);
    expect(FilmAnalyzeSchema.safeParse({ organizationId: ORG, assetId: VIDEO }).success).toBe(true);
    expect(FilmAnalyzeSchema.safeParse({ organizationId: ORG, assetId: VIDEO, depth: 'deep' }).success).toBe(false);
  });

  it('cleans a table: sorted, clamped to the clip, short rows dropped, text flattened', () => {
    expect(
      normalizeShots(
        [
          { start: 4, end: 99, framing: ' wide\n shot ', camera: '', action: '' },
          { start: 0, end: 0.04, framing: '', camera: '', action: '' },
          { start: 0, end: 4, framing: 'close', camera: 'c', action: 'a', transition: '  ' },
        ],
        6.2,
      ),
    ).toEqual([
      { start: 0, end: 4, framing: 'close', camera: 'c', action: 'a' },
      { start: 4, end: 6.2, framing: 'wide shot', camera: '', action: '' },
    ]);
  });
});

describe('what a clip allows', () => {
  it('reads any picture size but only the lengths a remake works with', () => {
    expect(blueprintFit(model, { seconds: 6 })).toEqual({ readable: true, problem: null });
    expect(blueprintFit(model, { seconds: model.referenceVideoSeconds.max + 1 }).readable).toBe(false);
    expect(blueprintFit(model, { seconds: null }).readable).toBe(true);
    expect(clipNotice(model, { ...clip, width: 200, height: 300 })).toBe('small');
    expect(clipNotice(model, { ...clip, seconds: 1 })).toBe('tooShort');
    expect(clipNotice(model, { ...clip, seconds: 40 })).toBe('tooLong');
    expect(clipNotice(model, { ...clip, seconds: 3 })).toBe('editShort');
    expect(clipNotice(model, clip)).toBeNull();
  });

  it('offers the blueprint once there is a table, and steps down to what the clip allows', () => {
    expect(methodsFor(model, clip, [])).toEqual({ blueprint: false, reference: true, edit: true });
    expect(methodsFor(model, clip, SHEET.shots)).toEqual({ blueprint: true, reference: true, edit: true });
    const small = methodsFor(model, { ...clip, width: 200, height: 300 }, SHEET.shots);
    expect(small).toEqual({ blueprint: true, reference: false, edit: false });
    expect(pickMethod('reference', small)).toBe('blueprint');
    expect(pickMethod('blueprint', methodsFor(model, clip, []))).toBe('reference');
    expect(methodsFor(model, null, SHEET.shots)).toEqual({ blueprint: false, reference: false, edit: false });
  });

  it('starts from the clip shape and length', () => {
    expect(aspectFor(model, { width: 1080, height: 1920 })).toBe('9:16');
    expect(aspectFor(model, { width: 1920, height: 1080 })).toBe('16:9');
    expect(aspectFor(model, { width: 1000, height: 1000 })).toBe('1:1');
    expect(aspectFor(model, null)).toBe('9:16');
    expect(remakeSeconds(model, 6.45)).toBe(7);
    expect(remakeSeconds(model, 40)).toBe(model.maxSeconds);
  });
});

describe('the shot table', () => {
  it('edits text, drops the read camera split once the camera is rewritten, moves cuts and merges removed rows', () => {
    const table = tableOf(draft(), SHEET);
    expect(table).toHaveLength(3);
    const edited = editShot(table, 0, { camera: 'orbit left' });
    expect(edited[0]).toMatchObject({ camera: 'orbit left' });
    expect(edited[0]).not.toHaveProperty('move');
    expect(editShot(table, 0, { action: 'lifts slowly' })[0]).toHaveProperty('move');
    const moved = setShotEnd(table, 0, 2.6, 6.2);
    expect([moved[0]!.end, moved[1]!.start]).toEqual([2.6, 2.6]);
    expect(setShotEnd(table, 0, 9, 6.2)[0]!.end).toBe(3.9);
    expect(setShotEnd(table, 0, -1, 6.2)[0]!.end).toBe(0.1);
    expect(removeShot(table, 1).map((s) => [s.start, s.end])).toEqual([[0, 4], [4, 6.2]]);
    expect(removeShot(table, 0).map((s) => [s.start, s.end])).toEqual([[0, 4], [4, 6.2]]);
    expect(removeShot([table[0]!], 0)).toHaveLength(1);
    expect(tableOf(draft({ shots: [table[2]!] }), SHEET)).toEqual([table[2]]);
  });
});

describe('the request', () => {
  const images = [
    { assetId: IMG1, url: '/a', thumbUrl: null, name: 'bottle', slot: 'product' as const },
    { assetId: IMG2, url: '/b', thumbUrl: null, name: 'room', slot: 'place' as const },
  ];

  it('writes what changes in the customer\'s words, numbering pictures the way the server maps them', () => {
    const change = changeText({ change: { product: '우리 세럼 병', person: '', place: '흰 욕실' }, images }, words);
    expect(change).toBe('제품: 우리 세럼 병 (이미지 1)\n장소: 흰 욕실 (이미지 2)');
    expect(changeText({ change: { product: '', person: '', place: '' }, images: [] }, words)).toBe('');
  });

  it('builds one blueprint job: video first, pictures with roles, the edited table, a 480p draft', () => {
    const built = buildReverseJob(
      draft({ images, change: { product: '우리 병', person: '', place: '' }, shots: SHEET.shots.slice(0, 2) }),
      { video: clip, sheet: SHEET, words },
      { organizationId: ORG, requestId: 'req_12345678' },
      model,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toMatchObject({
      kind: 'video_remix',
      method: 'blueprint',
      resolution: 'draft',
      enhance: true,
      seconds: 6,
      aspect: '9:16',
      references: [{ assetId: VIDEO }, { assetId: IMG1, role: 'product' }, { assetId: IMG2, role: 'place' }],
      shots: SHEET.shots.slice(0, 2),
      keep: ['camera', 'timing', 'composition', 'motion', 'look'],
    });
    expect(VideoRemixJobSchema.safeParse(built.input).success).toBe(true);
  });

  it('leaves the table to the server when it was not edited, and drops length and keep for an edit', () => {
    const remake = buildReverseJob(draft(), { video: clip, sheet: SHEET, words }, { organizationId: ORG, requestId: 'req_12345678' }, model);
    expect(remake.ok && 'shots' in remake.input).toBe(false);
    const edit = buildReverseJob(draft({ method: 'edit', note: '라벨만 파랗게' }), { video: clip, sheet: SHEET, words }, { organizationId: ORG, requestId: 'req_12345678' }, model);
    expect(edit.ok && edit.input).toMatchObject({ method: 'edit', keep: [], prompt: '라벨만 파랗게' });
    expect(edit.ok && 'seconds' in edit.input).toBe(false);
  });

  it('names the one thing that stops it', () => {
    const ctx = { video: clip, sheet: SHEET, words };
    const ids = { organizationId: ORG, requestId: 'req_12345678' };
    expect(buildReverseJob(draft({ videoId: null }), ctx, ids, model)).toEqual({ ok: false, problem: 'video' });
    expect(buildReverseJob(draft(), { ...ctx, sheet: null }, ids, model)).toEqual({ ok: false, problem: 'reading' });
    expect(buildReverseJob(draft({ method: 'reference' }), ctx, ids, model)).toEqual({ ok: false, problem: 'change' });
    expect(buildReverseJob(draft({ method: 'edit', note: 'x' }), { ...ctx, video: { ...clip, seconds: 3 } }, ids, model)).toEqual({ ok: false, problem: 'method' });
    const many = Array.from({ length: model.maxReferenceImages + 1 }, (_, i) => ({ ...images[0]!, assetId: `${IMG1.slice(0, -2)}${String(i).padStart(2, '0')}` }));
    expect(buildReverseJob(draft({ images: many }), ctx, ids, model)).toEqual({ ok: false, problem: 'images' });
  });

  it('quotes the draft in credits with the server arithmetic', () => {
    expect(draftCredits(draft(), clip, model)).toBe(creditsOf(usageKrw(videoRunUsd({ resolution: 'draft', seconds: 6 }), 'video')));
    expect(draftCredits(draft({ method: 'reference' }), clip, model)).toBeGreaterThan(draftCredits(draft(), clip, model));
    expect(draftCredits(draft(), null, model)).toBe(0);
  });

  it('sets the panel up again from a sent remix', () => {
    const job = {
      id: 'j', kind: 'video_remix', status: 'succeeded', model: 'seedance-2.5', prompt: '로고 또렷하게', finalPrompt: null, expected: 1,
      aspect: '9:16', resolution: 'draft', seconds: 8, audio: 'ambient', references: [{ assetId: VIDEO }, { assetId: IMG1, role: 'place' }],
      parentOutputId: null, parentAssetId: null, box: null, method: 'blueprint', keep: ['camera'], change: '제품: 우리 병', shots: SHEET.shots,
      outputs: [], estimateKrw: 0, errorCode: null, createdAt: '2026-11-11T00:00:00Z', finishedAt: null,
    } as StudioJobView;
    const assets: StudioAssetView[] = [
      { id: VIDEO, kind: 'video', role: null, name: 'clip', tags: [], url: '/v', thumbUrl: null, width: 1080, height: 1920, seconds: 6, source: 'upload', createdAt: '' },
      { id: IMG1, kind: 'image', role: null, name: 'room', tags: [], url: '/i', thumbUrl: '/t', width: 10, height: 10, seconds: null, source: 'upload', createdAt: '' },
    ];
    const back = draftFromJob(job, assets, model);
    expect(back).toMatchObject({ videoId: VIDEO, method: 'blueprint', seconds: 8, audio: 'ambient', keep: ['camera'], shots: SHEET.shots, note: '제품: 우리 병\n로고 또렷하게' });
    expect(back?.images).toEqual([{ assetId: IMG1, url: '/i', thumbUrl: '/t', name: 'room', slot: 'place' }]);
    expect(draftFromJob({ ...job, kind: 'video' }, assets, model)).toBeNull();
  });
});
