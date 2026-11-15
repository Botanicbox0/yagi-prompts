import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeFallbackPrompt, enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { prepareJob } from '@/lib/brand-studio/prepare';
import type { JobRow } from '@/lib/brand-studio/types';
import { ENV, input, mockGemini, sentBody } from '../intel/helpers';
import { fakeIntel, requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRevision, seedRun } from './revision-helpers';

const MADE_WITH = '@Image1 a perfume bottle turns slowly on white stone.\nAudio: soft room tone.';

function editInput(over: Partial<EnhanceInput> = {}): EnhanceInput {
  return input({
    kind: 'video_remix',
    profile: 'seedance',
    prompt: '병을 파란색으로',
    references: [{ index: 1, kind: 'video', label: '영상 1' }],
    video: { seconds: null, aspect: 'adaptive', audio: 'native', method: 'edit', keep: [], change: '', sheet: null },
    revision: { mode: 'edit', version: 3, madeWith: MADE_WITH, history: ['배경을 회색으로'] },
    ...over,
  });
}

function reshootInput(over: Partial<EnhanceInput> = {}): EnhanceInput {
  return input({
    kind: 'video',
    profile: 'seedance',
    prompt: '이미지 2의 라벨을 붙여',
    references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }, { index: 2, kind: 'image', label: '이미지 2' }],
    video: { seconds: 6, aspect: '9:16', audio: 'native', change: 'old change note', sheet: null },
    revision: { mode: 'reshoot', version: 4, madeWith: MADE_WITH, history: ['배경을 회색으로', '병을 파란색으로'] },
    ...over,
  });
}

describe('the enhancer on a new version', () => {
  it('edit: tells the model the video is the previous version and to change only the request', async () => {
    const fetchMock = mockGemini({ prompt: 'In @Video1, change only the perfume bottle to deep blue; everything else stays as it is.', notes: '병 색만 바꿨어요.' });
    const result = await enhancePrompt(editInput(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('model');
    const body = sentBody(fetchMock);
    const system = body.systemInstruction.parts[0]!.text;
    expect(system).toContain('@Video1 is version 2 of the clip');
    expect(system).toContain('"revision.history"');
    expect(system).toContain('stay exactly as they are in @Video1');
    const payload = JSON.parse((body.contents[0]!.parts[0] as { text: string }).text);
    expect(payload.revision).toEqual({ mode: 'edit', version: 3, madeWith: MADE_WITH, history: ['배경을 회색으로'] });
    expect(payload.request).toBe('병을 파란색으로');
  });

  it('reshoot: asks for the earlier prompt rewritten with every request, without the change note twice', async () => {
    const fetchMock = mockGemini({ prompt: '@Image1 a blue perfume bottle with the @Image2 label turns slowly on grey stone.\nAudio: soft room tone.', notes: '요청을 반영했어요.' });
    const result = await enhancePrompt(reshootInput(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('model');
    const body = sentBody(fetchMock);
    const system = body.systemInstruction.parts[0]!.text;
    expect(system).toContain('each request in "revision.history" in order (oldest first), and then the request');
    expect(system).toContain('keep every other sentence, their order, the timing marks and the reference tokens word for word');
    const payload = JSON.parse((body.contents[0]!.parts[0] as { text: string }).text);
    expect(payload.revision).toMatchObject({ mode: 'reshoot', version: 4, history: ['배경을 회색으로', '병을 파란색으로'] });
    expect(payload.video.change).toBeNull();
    expect(payload.request).toBe('@Image2의 라벨을 붙여');
  });

  it('a plain run carries no revision block', async () => {
    const fetchMock = mockGemini({ prompt: '@Image1 a bottle turns.', notes: '다듬었어요.' });
    await enhancePrompt(reshootInput({ revision: null }), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const payload = JSON.parse((sentBody(fetchMock).contents[0]!.parts[0] as { text: string }).text);
    expect(payload.revision).toBeNull();
    expect(payload.video.change).toBe('old change note');
  });

  it('falls back without a model: reshoot = earlier prompt, blank line, the requests; edit = the edit lines', () => {
    expect(composeFallbackPrompt(reshootInput()).prompt).toBe(`${MADE_WITH}\n\n배경을 회색으로.\n병을 파란색으로.\n@Image2의 라벨을 붙여.`);
    expect(composeFallbackPrompt(reshootInput({ revision: { mode: 'reshoot', version: 2, madeWith: '', history: [] } })).prompt).toBe('@Image2의 라벨을 붙여.');
    const edit = composeFallbackPrompt(editInput()).prompt;
    expect(edit.split('\n').slice(0, 2)).toEqual(['In @Video1, change only the following: 병을 파란색으로.', 'Everything else stays as it is.']);
  });
});

describe('prepareJob hands the clip\'s history to the enhancer', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  function recording() {
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
    return { deps, seen };
  }

  it('edit: madeWith and the edits already in the clip', async () => {
    const { deps, seen } = recording();
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: 'A bottle turns.' });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: 'grey background' });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), { kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId: v2.outputId, mode: 'edit', prompt: 'blue bottle', references: [] });
    if (!made.ok) throw new Error(JSON.stringify(made));
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    const prepared = await prepareJob(deps, job);
    expect(prepared.finalPrompt).toBe('ENHANCED(seedance): blue bottle');
    expect(seen[0]!.revision).toEqual({ mode: 'edit', version: 3, madeWith: 'A bottle turns.', history: ['grey background'] });
    expect(seen[0]!.video?.method).toBe('edit');
  });

  it('reshoot: renumbers the request\'s pictures to their place in the tray', async () => {
    const { deps, seen } = recording();
    const product = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const logo = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const label = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: '@Image1 turns.', refs: [{ assetId: product }] });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: '이미지 1의 로고를 병에', added: [{ assetId: logo }] });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), {
      kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId: v2.outputId, mode: 'reshoot', prompt: '이미지 1의 라벨도', references: [{ assetId: label }],
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    expect(job.prompt).toBe('이미지 1의 라벨도');
    await prepareJob(deps, job);
    expect(seen[0]!.prompt).toBe('이미지 3의 라벨도');
    expect(seen[0]!.revision).toEqual({ mode: 'reshoot', version: 3, madeWith: '@Image1 turns.', history: ['이미지 2의 로고를 병에'] });
  });

  it('goes on without the history when the earlier runs are gone', async () => {
    const { deps, seen } = recording();
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), { kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId: root.outputId, mode: 'edit', prompt: 'blue', references: [] });
    if (!made.ok) throw new Error();
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    await f.sql.query('update brand_studio_jobs set params = jsonb_set(params, $2, to_jsonb($3::text)) where id = $1', [job.id, '{revision,baseJobId}', '00000000-0000-4000-8000-000000000000']);
    const moved = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [job.id])).rows[0]!;
    await prepareJob(deps, moved);
    expect(seen[0]!.revision).toBeUndefined();
  });
});
