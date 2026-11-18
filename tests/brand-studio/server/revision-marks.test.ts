import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { composeFallbackPrompt, enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { prepareJob } from '@/lib/brand-studio/prepare';
import { MARK_FRAME_MAX_BYTES, markFrameBytes } from '@/lib/brand-studio/revision/mark';
import { runStudioOperation } from '@/lib/brand-studio/service';
import type { JobRow } from '@/lib/brand-studio/types';
import { ENV, input, mockGemini, sentBody } from '../intel/helpers';
import { fakeIntel, pngBytes, requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRevision, seedRun } from './revision-helpers';

let f: StudioFixture;
beforeEach(async () => {
  resetFreeIntelRateLimits();
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const CIRCLED = /[①-⑳]/;

/** A JPEG-looking frame (the magic bytes are all the server checks before the model reads it). */
function jpegDataUrl(size = 2048): string {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}

function withGemini(answer: unknown | (() => Response)) {
  const fetchMock = mockGemini(answer);
  return { fetchMock, deps: studioDeps(f.sql, { intelDeps: { fetch: fetchMock as unknown as typeof fetch, env: { GEMINI_API_KEY: 'test-key' } } }) };
}

const mark = (deps: ReturnType<typeof studioDeps>, over: Record<string, unknown>, who = f.ids.owner, locale: 'ko' | 'en' = 'ko') =>
  runStudioOperation(deps, viewerOf(who, locale), 'revise.mark', { organizationId: f.orgId, time: 2.5, x: 0.4, y: 0.3, frame: jpegDataUrl(), ...over });

describe('revise.mark', () => {
  it('reads what the spot is on, from the frame and the prompt the clip was made from, and cleans the answer', async () => {
    const { deps, fetchMock } = withGemini({ label: '  분홍 향수병.\n', what: `the translucent pink glass perfume bottle held in the woman's hand ${'x'.repeat(400)}` });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: 'A woman holds a pink perfume bottle.' });
    const result = await mark(deps, { outputId: root.outputId, w: 0.2, h: 0.25 });
    expect(result).toMatchObject({ ok: true, label: '분홍 향수병' });
    if (!result.ok || !('what' in result)) throw new Error(JSON.stringify(result));
    expect(result.what!.length).toBe(240);
    expect(result.what!.startsWith('the translucent pink glass perfume bottle')).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['label', 'ok', 'what']);

    const body = sentBody(fetchMock);
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'LOW' } });
    expect(body.systemInstruction.parts[0]!.text).toContain('Never mention the ring, the rectangle');
    const [image, text] = body.contents[0]!.parts as [{ inlineData: { mimeType: string } }, { text: string }];
    expect(image.inlineData.mimeType).toBe('image/jpeg');
    expect(JSON.parse(text.text)).toEqual({
      mark: { x: 0.4, y: 0.3, w: 0.2, h: 0.25, time: 2.5 },
      kind: 'box',
      madeWith: 'A woman holds a pink perfume bottle.',
      locale: 'ko',
    });
  });

  it('a pin is a pin, in the screen language; an empty field is dropped', async () => {
    const { deps, fetchMock } = withGemini({ label: '   ', what: 'the grey stone floor under the bottle' });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    expect(await mark(deps, { outputId: root.outputId }, f.ids.owner, 'en')).toEqual({ ok: true, label: null, what: 'the grey stone floor under the bottle' });
    const payload = JSON.parse((sentBody(fetchMock).contents[0]!.parts[1] as { text: string }).text);
    expect(payload).toMatchObject({ kind: 'pin', locale: 'en', mark: { x: 0.4, y: 0.3, time: 2.5 } });
    expect(payload.mark).not.toHaveProperty('w');
  });

  it('answers nulls when the reading fails: no key, an error, bad JSON', async () => {
    const root = await seedRun(studioDeps(f.sql), f.orgId, f.ids.owner, { prompt: 'a bottle' });
    expect(await mark(studioDeps(f.sql), { outputId: root.outputId })).toEqual({ ok: true, label: null, what: null });
    for (const answer of [() => new Response('nope', { status: 500 }), 'not json at all', { label: 42, what: null }]) {
      const { deps } = withGemini(answer);
      expect(await mark(deps, { outputId: root.outputId })).toEqual({ ok: true, label: null, what: null });
    }
  });

  it('refuses a frame that is not a JPEG or is too large, and anything but this organization\'s video', async () => {
    const { deps, fetchMock } = withGemini({ label: 'x', what: 'y' });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    const png = `data:image/jpeg;base64,${Buffer.from(await pngBytes()).toString('base64')}`;
    expect(await mark(deps, { outputId: root.outputId, frame: png })).toEqual({ ok: false, code: 'invalid' });
    expect(await mark(deps, { outputId: root.outputId, frame: 'data:image/png;base64,AAAA' })).toEqual({ ok: false, code: 'invalid' });
    expect(await mark(deps, { outputId: root.outputId, frame: jpegDataUrl(310_000) })).toEqual({ ok: false, code: 'invalid' });
    expect(markFrameBytes(jpegDataUrl(MARK_FRAME_MAX_BYTES + 1))).toBeNull();
    expect(markFrameBytes(jpegDataUrl(MARK_FRAME_MAX_BYTES))).not.toBeNull();
    expect(await mark(deps, { outputId: root.outputId, x: 0.9, w: 0.2, h: 0.2 })).toEqual({ ok: false, code: 'invalid' });

    const image = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', prompt: 'a still' });
    expect(await mark(deps, { outputId: image.outputId })).toEqual({ ok: false, code: 'not_found' });
    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Another brand', f.ids.outsider, randomUUID()]);
    const theirs = await seedRun(deps, otherOrg, f.ids.outsider, { prompt: 'their bottle' });
    expect(await mark(deps, { outputId: theirs.outputId })).toEqual({ ok: false, code: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is guarded like revise.plan: role, allowance, its own rate cap of 30 a minute', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    expect(await mark(deps, { outputId: root.outputId }, f.ids.viewer)).toEqual({ ok: false, code: 'forbidden' });
    expect(await mark(deps, { outputId: root.outputId }, f.ids.outsider)).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = 0 where organization_id = $1', [f.orgId]);
    expect(await mark(deps, { outputId: root.outputId })).toEqual({ ok: false, code: 'allowance_closed' });
    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = 500000 where organization_id = $1', [f.orgId]);
    for (let i = 0; i < 30; i++) expect((await mark(deps, { outputId: root.outputId })).ok).toBe(true);
    expect(await mark(deps, { outputId: root.outputId })).toEqual({ ok: false, code: 'too_many_running' });
    // revise.plan keeps its own budget.
    expect(await runStudioOperation(deps, viewerOf(f.ids.owner), 'revise.plan', { organizationId: f.orgId, outputId: root.outputId })).toMatchObject({ ok: true });
  });
});

const MARKS = [
  { time: 1.2, x: 0.3, y: 0.4, w: 0.2, h: 0.3, label: '분홍 향수병', what: "the translucent pink glass perfume bottle held in the woman's hand" },
  { time: 3, x: 0.7, y: 0.2, label: '창문' },
];

describe('job.create video_revise with marks', () => {
  const revise = (outputId: string, over: Record<string, unknown> = {}) => ({
    kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId, mode: 'edit', prompt: '①을 초록색으로, ②는 닫아줘', references: [], marks: MARKS, ...over,
  });

  it('stores the marks as sent in params.revision.marks and shows them on the job', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    for (const mode of ['edit', 'reshoot'] as const) {
      const made = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { mode }));
      if (!made.ok) throw new Error(JSON.stringify(made));
      const stored = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
      expect(stored.params.revision?.marks).toEqual(MARKS);
      expect(stored.prompt).toBe('①을 초록색으로, ②는 닫아줘');
      expect(made.job.revision?.marks).toEqual(MARKS);
    }
    const plain = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { prompt: 'blue', marks: [] }));
    if (!plain.ok) throw new Error(JSON.stringify(plain));
    expect(plain.job.revision).not.toHaveProperty('marks');
  });

  it('refuses a request that points at a mark that was not sent; marks without signs are fine', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { prompt: '③을 지워줘' }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { prompt: '①을 지워줘', marks: [] }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { prompt: '병을 지워줘' }))).toMatchObject({ ok: true });
    expect(
      await runStudioOperation(deps, viewerOf(f.ids.owner), 'revise.plan', { organizationId: f.orgId, outputId: root.outputId, prompt: '③을 지워줘', marks: MARKS }),
    ).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('revise.plan with marks', () => {
  it('classifies the request with each mark written out, its own and the earlier ones', async () => {
    const { deps, fetchMock } = withGemini({ reason: 'surface' });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: 'A bottle turns.' });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, {
      base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: '①을 빨갛게',
      params: { revision: { rootJobId: root.jobId, version: 2, baseJobId: root.jobId, baseOutputId: root.outputId, mode: 'edit', added: 0, marks: [{ time: 1, x: 0.5, y: 0.5, label: '모자' }] } },
    });
    const result = await runStudioOperation(deps, viewerOf(f.ids.owner), 'revise.plan', {
      organizationId: f.orgId, outputId: v2.outputId, prompt: '①을 초록색으로, ②는 닫아줘', marks: [MARKS[0], { time: 3, x: 0.7, y: 0.2 }],
    });
    expect(result).toMatchObject({ ok: true, recommended: 'edit', reason: 'surface' });
    const sent = JSON.parse((sentBody(fetchMock).contents[0]!.parts[0] as { text: string }).text);
    expect(sent.request).toBe("[marked on the clip: the translucent pink glass perfume bottle held in the woman's hand] 을 초록색으로, [marked on the clip: the marked spot] 는 닫아줘");
    expect(sent.history).toEqual(['모자 을 빨갛게']);
  });
});

const MADE_WITH = '@Image1 a perfume bottle turns slowly on white stone.\nAudio: soft room tone.';
const ENHANCE_MARKS: NonNullable<NonNullable<EnhanceInput['revision']>['marks']> = [
  { n: 1, time: 1.2, what: 'the pink perfume bottle', x: 0.3, y: 0.4, w: 0.2, h: 0.3, label: '분홍 향수병' },
  { n: 2, time: 3, what: null, x: 0.7, y: 0.2, label: '창문' },
];

function editInput(over: Partial<EnhanceInput> = {}): EnhanceInput {
  return input({
    kind: 'video_remix',
    profile: 'seedance',
    prompt: '①을 초록색으로, ②는 닫아줘',
    references: [{ index: 1, kind: 'video', label: '영상 1' }],
    video: { seconds: null, aspect: 'adaptive', audio: 'native', method: 'edit', keep: [], change: '', sheet: null },
    revision: { mode: 'edit', version: 3, madeWith: MADE_WITH, history: [], marks: ENHANCE_MARKS },
    ...over,
  });
}

describe('the prompt writer reads marks as words', () => {
  it('carries revision.marks (without the chip label) and adds the marks rules only when there are marks', async () => {
    const fetchMock = mockGemini({ prompt: 'In @Video1, change only the pink perfume bottle to green; everything else stays as it is.', notes: '바꿨어요.' });
    const result = await enhancePrompt(editInput(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('model');
    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0]!.text).toContain('①, ② and ③ in the request are marks the customer placed on the clip');
    expect(body.systemInstruction.parts[0]!.text).toContain('in the words that find it in the video');
    const payload = JSON.parse((body.contents[0]!.parts[0] as { text: string }).text);
    expect(payload.revision.marks).toEqual([
      { n: 1, time: 1.2, what: 'the pink perfume bottle', x: 0.3, y: 0.4, w: 0.2, h: 0.3 },
      { n: 2, time: 3, what: null, x: 0.7, y: 0.2 },
    ]);

    const plain = mockGemini({ prompt: 'In @Video1, change only the bottle to green; everything else stays as it is.', notes: '바꿨어요.' });
    await enhancePrompt(editInput({ prompt: '병을 초록색으로', revision: { mode: 'reshoot', version: 3, madeWith: MADE_WITH, history: [] } }), { fetch: plain as unknown as typeof fetch, env: ENV });
    const plainBody = sentBody(plain);
    expect(plainBody.systemInstruction.parts[0]!.text).not.toContain('are marks the customer placed');
    expect(JSON.parse((plainBody.contents[0]!.parts[0] as { text: string }).text).revision).not.toHaveProperty('marks');

    const reshoot = mockGemini({ prompt: '@Image1 a green perfume bottle turns slowly on white stone.\nAudio: soft room tone.', notes: '바꿨어요.' });
    await enhancePrompt(editInput({ kind: 'video', revision: { mode: 'reshoot', version: 3, madeWith: MADE_WITH, history: [], marks: ENHANCE_MARKS } }), { fetch: reshoot as unknown as typeof fetch, env: ENV });
    expect(sentBody(reshoot).systemInstruction.parts[0]!.text).toContain('Never write ①②③, the word mark, coordinates or a ring in the prompt.');
  });

  it('falls back when the model keeps a circled digit', async () => {
    const fetchMock = mockGemini({ prompt: 'In @Video1, change only ① to green; everything else stays as it is.', notes: '바꿨어요.' });
    const result = await enhancePrompt(editInput(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('fallback');
    expect(result.prompt).not.toMatch(CIRCLED);
  });

  it('fallback writes each mark out: what, else the label, else "the marked spot"; never a circled digit', () => {
    const edit = composeFallbackPrompt(editInput()).prompt;
    expect(edit.split('\n')[0]).toBe('In @Video1, change only the following: the pink perfume bottle 을 초록색으로, 창문 는 닫아줘.');
    const bare = composeFallbackPrompt(editInput({ prompt: '①②③ 정리', revision: { mode: 'edit', version: 3, madeWith: MADE_WITH, history: [], marks: [{ n: 1, time: 0, what: null, x: 0, y: 0 }] } })).prompt;
    expect(bare).toContain('the marked spot');
    expect(bare).not.toMatch(CIRCLED);
    const reshoot = composeFallbackPrompt(
      editInput({ kind: 'video', revision: { mode: 'reshoot', version: 4, madeWith: MADE_WITH, history: ['①을 빨갛게'], marks: ENHANCE_MARKS } }),
    ).prompt;
    expect(reshoot).toBe(`${MADE_WITH}\n\nthe marked spot 을 빨갛게.\nthe pink perfume bottle 을 초록색으로, 창문 는 닫아줘.`);
    expect(reshoot).not.toMatch(CIRCLED);
  });
});

describe('prepareJob hands the marks to the prompt writer', () => {
  it('numbers the job\'s marks and writes earlier requests\' marks out', async () => {
    const seen: EnhanceInput[] = [];
    const intel = fakeIntel();
    const deps = studioDeps(f.sql, {
      intel: {
        ...intel,
        async enhancePrompt(i) {
          seen.push(i as EnhanceInput);
          return intel.enhancePrompt(i, { fetch, env: {} });
        },
      },
    });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: 'A bottle turns.' });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, {
      base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: '①을 빨갛게',
      params: { revision: { rootJobId: root.jobId, version: 2, baseJobId: root.jobId, baseOutputId: root.outputId, mode: 'edit', added: 0, marks: [{ time: 1, x: 0.5, y: 0.5, what: 'the red hat' }] } },
    });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), {
      kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId: v2.outputId, mode: 'edit', prompt: '①을 초록색으로, ②는 닫아줘', references: [], marks: MARKS,
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    await prepareJob(deps, job);
    expect(seen[0]!.prompt).toBe('①을 초록색으로, ②는 닫아줘');
    expect(seen[0]!.revision).toEqual({
      mode: 'edit',
      version: 3,
      madeWith: 'A bottle turns.',
      history: ['the red hat 을 빨갛게'],
      marks: [
        { n: 1, time: 1.2, what: "the translucent pink glass perfume bottle held in the woman's hand", x: 0.3, y: 0.4, w: 0.2, h: 0.3, label: '분홍 향수병' },
        { n: 2, time: 3, what: null, x: 0.7, y: 0.2, label: '창문' },
      ],
    });
  });
});
