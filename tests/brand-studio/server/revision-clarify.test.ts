import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeFallbackPrompt, enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { prepareJob } from '@/lib/brand-studio/prepare';
import { cleanClarify } from '@/lib/brand-studio/revision/advise';
import { withClarified } from '@/lib/brand-studio/revision/clarify';
import { runStudioOperation } from '@/lib/brand-studio/service';
import type { JobRow } from '@/lib/brand-studio/types';
import { ENV, input, mockGemini, requestPayload, sentBody } from '../intel/helpers';
import { fakeIntel, requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRevision, seedRun } from './revision-helpers';

/** docs/BRAND-STUDIO-V6-PLAN.md §4.6 — one question back when a revision request reads two ways. */
let f: StudioFixture;
beforeEach(async () => {
  resetFreeIntelRateLimits();
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const ASKS = { reason: 'surface', ambiguity: 'which_thing', question: '어느 병을 바꿀까요?', options: ['왼쪽 병', '오른쪽 병'] };
const CLARIFIED = { question: '어느 병을 바꿀까요?', answer: '왼쪽 병' };

function withGemini(answer: unknown | (() => Response)) {
  const fetchMock = mockGemini(answer);
  return { fetchMock, deps: studioDeps(f.sql, { intelDeps: { fetch: fetchMock as unknown as typeof fetch, env: { GEMINI_API_KEY: 'test-key' } } }) };
}

const ask = (deps: ReturnType<typeof studioDeps>, payload: Record<string, unknown>) =>
  runStudioOperation(deps, viewerOf(f.ids.owner), 'revise.plan', { organizationId: f.orgId, ...payload });

const sentPayload = (fetchMock: ReturnType<typeof mockGemini>) => requestPayload(fetchMock);
const sentSystem = (fetchMock: ReturnType<typeof mockGemini>) => sentBody(fetchMock).systemInstruction.parts[0]!.text as string;

describe('revise.plan asks one question when the request reads two ways', () => {
  it('passes the question and its choices on, from the same reading that picks the way', async () => {
    const { deps, fetchMock } = withGemini(ASKS);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'two bottles', finalPrompt: 'Two perfume bottles, one pink and one clear, on stone.' });
    const result = await ask(deps, { outputId: root.outputId, prompt: '병 색을 바꿔 줘', references: [], materials: 1 });
    expect(result).toMatchObject({ ok: true, recommended: 'edit', reason: 'surface', clarify: { question: '어느 병을 바꿀까요?', options: ['왼쪽 병', '오른쪽 병'] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentPayload(fetchMock)).toEqual({ request: '병 색을 바꿔 줘', madeWith: 'Two perfume bottles, one pink and one clear, on stone.', history: [], references: 0, materials: 1 });
    expect(sentSystem(fetchMock)).toContain('When in doubt, answer "none".');
    expect((sentBody(fetchMock).generationConfig as { responseJsonSchema: { properties: object } }).responseJsonSchema.properties).toHaveProperty('ambiguity');
  });

  it('never asks once the customer answered or had it made as written; the answer is read with the request', async () => {
    const root = await seedRun(studioDeps(f.sql), f.orgId, f.ids.owner, { prompt: 'two bottles', finalPrompt: 'Two bottles.' });
    const answered = withGemini(ASKS);
    const result = await ask(answered.deps, { outputId: root.outputId, prompt: '병 색을 바꿔 줘', clarified: CLARIFIED });
    expect(result).toMatchObject({ ok: true, reason: 'surface' });
    expect(result).not.toHaveProperty('clarify');
    expect(sentPayload(answered.fetchMock)).toEqual({ request: '병 색을 바꿔 줘', madeWith: 'Two bottles.', history: [], customerMeant: '왼쪽 병' });
    expect(sentSystem(answered.fetchMock)).not.toContain('ambiguous');
    expect((sentBody(answered.fetchMock).generationConfig as { responseJsonSchema: { properties: object } }).responseJsonSchema.properties).not.toHaveProperty('ambiguity');

    const asWritten = withGemini(ASKS);
    const second = await ask(asWritten.deps, { outputId: root.outputId, prompt: '병 색을 바꿔 줘', clarified: { question: CLARIFIED.question, answer: null } });
    expect(second).not.toHaveProperty('clarify');
    expect(sentPayload(asWritten.fetchMock)).not.toHaveProperty('customerMeant');
  });

  it('asks nothing when there is no request, the reading fails, or the question is not a shape the screen can show', async () => {
    const root = await seedRun(studioDeps(f.sql), f.orgId, f.ids.owner, { prompt: 'a bottle' });
    const empty = withGemini(ASKS);
    expect(await ask(empty.deps, { outputId: root.outputId })).not.toHaveProperty('clarify');
    expect(empty.fetchMock).not.toHaveBeenCalled();
    for (const answer of [
      () => new Response('nope', { status: 500 }),
      { ...ASKS, ambiguity: 'none' },
      { ...ASKS, ambiguity: 'taste' },
      { ...ASKS, options: ['왼쪽 병'] },
      { ...ASKS, options: ['왼쪽 병', '왼쪽 병'] },
      { ...ASKS, question: 'q'.repeat(141) },
      { ...ASKS, options: ['왼쪽 병', 'x'.repeat(61)] },
      { reason: 'surface', ambiguity: 'which_thing' },
    ]) {
      const { deps } = withGemini(answer);
      const result = await ask(deps, { outputId: root.outputId, prompt: '병 색을 바꿔 줘' });
      expect(result).toMatchObject({ ok: true });
      expect(result).not.toHaveProperty('clarify');
    }
  });

  it('tells the reading which words came from a mark, and counts the pictures attached', async () => {
    const { deps, fetchMock } = withGemini({ reason: 'surface', ambiguity: 'none' });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'two bottles', finalPrompt: 'Two bottles.' });
    const picture = await runStudioOperation(deps, viewerOf(f.ids.owner), 'revise.plan', {
      organizationId: f.orgId, outputId: root.outputId, prompt: '①을 초록색으로', marks: [{ time: 1, x: 0.3, y: 0.4, what: 'the pink bottle on the left' }],
    });
    expect(picture).not.toHaveProperty('clarify');
    expect(sentPayload(fetchMock).request).toBe('[marked on the clip: the pink bottle on the left] 을 초록색으로');
  });

  it('keeps a clean question: one line, distinct choices, at most three', () => {
    expect(cleanClarify({ ambiguity: 'direction_or_amount', question: '  어느 쪽으로\n옮길까요? ', options: ['왼쪽', '오른쪽', '왼쪽', ' 위쪽 ', '아래쪽'] })).toEqual({
      question: '어느 쪽으로 옮길까요?',
      options: ['왼쪽', '오른쪽', '위쪽'],
    });
    expect(cleanClarify(null)).toBeNull();
    expect(cleanClarify({ ambiguity: 'which_thing', question: '', options: ['a', 'b'] })).toBeNull();
  });
});

describe('the answer travels with the version', () => {
  const revise = (outputId: string, over: Record<string, unknown> = {}) => ({
    kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId, mode: 'edit', prompt: '병 색을 초록색으로', references: [], ...over,
  });

  it('is stored as params.revision.clarified, shown on the job, and absent when nothing was asked', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'two bottles' });
    for (const mode of ['edit', 'reshoot'] as const) {
      const made = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { mode, clarified: CLARIFIED }));
      if (!made.ok) throw new Error(JSON.stringify(made));
      const stored = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
      expect(stored.params.revision?.clarified).toEqual(CLARIFIED);
      expect(stored.prompt).toBe('병 색을 초록색으로');
      expect(made.job.revision?.clarified).toEqual(CLARIFIED);
    }
    const plain = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId));
    if (!plain.ok) throw new Error(JSON.stringify(plain));
    expect(plain.job.revision).not.toHaveProperty('clarified');
    // An empty or oversized answer is refused like any other bad field.
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { clarified: { question: 'q', answer: '' } }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { clarified: { question: 'q', answer: 'a'.repeat(61) } }))).toEqual({ ok: false, code: 'invalid' });
  });

  it('reaches the prompt writer beside the request, and follows its request in the history of later versions', async () => {
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
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'two bottles', finalPrompt: 'Two bottles turn.' });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, {
      base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: '그거 빼 줘',
      params: { revision: { rootJobId: root.jobId, version: 2, baseJobId: root.jobId, baseOutputId: root.outputId, mode: 'edit', added: 0, clarified: { question: '무엇을 뺄까요?', answer: '뒤쪽 꽃병' } } },
    });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), revise(v2.outputId, { clarified: CLARIFIED }));
    if (!made.ok) throw new Error(JSON.stringify(made));
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    await prepareJob(deps, job);
    expect(seen[0]!.prompt).toBe('병 색을 초록색으로');
    expect(seen[0]!.revision).toEqual({ mode: 'edit', version: 3, madeWith: 'Two bottles turn.', history: ['그거 빼 줘 (뒤쪽 꽃병)'], clarified: CLARIFIED });
  });

  it('goes into the request itself when the clip\'s history is gone', async () => {
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
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'two bottles', finalPrompt: 'Two bottles turn.' });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { clarified: CLARIFIED }));
    if (!made.ok) throw new Error(JSON.stringify(made));
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    // The base run is gone from the history walk (its id no longer matches).
    const lost = { ...job, params: { ...job.params, revision: { ...job.params.revision!, baseJobId: '00000000-0000-4000-8000-000000000000' } } };
    await prepareJob(deps, lost);
    expect(seen[0]!.revision ?? null).toBeNull();
    expect(seen[0]!.prompt).toBe('병 색을 초록색으로 (왼쪽 병)');
  });
});

const MADE_WITH = 'Two perfume bottles, one pink on the left and one clear on the right, turn slowly on white stone.';

function editInput(over: Partial<EnhanceInput> = {}): EnhanceInput {
  return input({
    kind: 'video_remix',
    profile: 'seedance',
    prompt: '병 색을 초록색으로',
    references: [{ index: 1, kind: 'video', label: '영상 1' }],
    video: { seconds: null, aspect: 'adaptive', audio: 'native', method: 'edit', keep: [], change: '', sheet: null },
    revision: { mode: 'edit', version: 2, madeWith: MADE_WITH, history: [], clarified: CLARIFIED },
    ...over,
  });
}

describe('the prompt writer follows the answer', () => {
  it('sends revision.clarified with the rule that it outranks the wording and never shows in the prompt', async () => {
    const fetchMock = mockGemini({ prompt: 'In @Video1, change only the pink bottle on the left to green; everything else stays as it is.', notes: '바꿨어요.' });
    await enhancePrompt(editInput(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const system = sentSystem(fetchMock);
    expect(system).toContain('"revision.clarified" is a question the customer was asked');
    expect(system).toContain('Never mention a question, an answer or a choice in the prompt.');
    expect(sentPayload(fetchMock).revision.clarified).toEqual(CLARIFIED);

    const plain = mockGemini({ prompt: 'In @Video1, change only the bottles to green; everything else stays as it is.', notes: '바꿨어요.' });
    await enhancePrompt(editInput({ revision: { mode: 'edit', version: 2, madeWith: MADE_WITH, history: [] } }), { fetch: plain as unknown as typeof fetch, env: ENV });
    expect(sentSystem(plain)).not.toContain('revision.clarified');
    expect(sentPayload(plain).revision).not.toHaveProperty('clarified');
  });

  it('fallback writes the answer after the request', () => {
    expect(composeFallbackPrompt(editInput()).prompt.split('\n')[0]).toBe('In @Video1, change only the following: 병 색을 초록색으로 (왼쪽 병)');
    expect(withClarified('그거 빼 줘', null)).toBe('그거 빼 줘');
  });
});
