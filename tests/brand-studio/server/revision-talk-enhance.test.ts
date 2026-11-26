import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { prepareJob } from '@/lib/brand-studio/prepare';
import type { JobRow } from '@/lib/brand-studio/types';
import { ENV, input, mockGemini, sentBody, writerJson, writerParts } from '../intel/helpers';
import { fakeIntel, requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRun } from './revision-helpers';

/**
 * A version made from the revise conversation: the prompt writer works from the settled sheet and is told
 * the run's exact length, so it can never claim another one. A version made the older way is untouched.
 */
const MADE_WITH = '0.0s–5.0s: a blue perfume bottle on white petals, slow push-in.\nAudio: soft room tone.';

const reshoot = (over: Partial<NonNullable<EnhanceInput['revision']>> = {}): EnhanceInput =>
  input({
    kind: 'video',
    profile: 'seedance',
    prompt: '배경을 바다로\n10초로 늘리기',
    references: [],
    video: { seconds: 10, aspect: '16:9', audio: 'native', change: '', sheet: null },
    revision: { mode: 'reshoot', version: 2, madeWith: MADE_WITH, history: [], ...over },
  });

describe('the prompt writer on a version from the conversation', () => {
  it('works from the sheet and states only the run\'s length', async () => {
    const fetchMock = mockGemini({ prompt: '0.0s–10.0s: a blue bottle on petals by the sea.', notes: '배경을 바다로 바꿨어요.' });
    await enhancePrompt(reshoot({ sheet: { change: ['배경을 바다로', '10초로 늘리기'], keep: ['병'], exclude: ['사람'] }, seconds: 10 }), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const body = sentBody(fetchMock);
    const system = body.systemInstruction.parts[0]!.text;
    expect(system).toContain('"revision.sheet" is the request');
    expect(system).toContain('The new clip is exactly 10 seconds long');
    expect(system).toContain('never say in "notes" that it has any other length');
    const payload = writerJson(writerParts(body)[0]!.text as string);
    expect(payload.revision).toMatchObject({ sheet: { change: ['배경을 바다로', '10초로 늘리기'], keep: ['병'], exclude: ['사람'] }, seconds: 10 });
  });

  it('an edit keeps the video\'s length and says no length', async () => {
    const fetchMock = mockGemini({ prompt: 'In @Video1, change only the background to the sea; everything else stays as it is.', notes: '' });
    const edit = input({
      kind: 'video_remix',
      profile: 'seedance',
      prompt: '배경을 바다로',
      references: [{ index: 1, kind: 'video', label: '영상 1' }],
      video: { seconds: null, aspect: 'adaptive', audio: 'native', method: 'edit', keep: [], change: '', sheet: null },
      revision: { mode: 'edit', version: 2, madeWith: MADE_WITH, history: [], sheet: { change: ['배경을 바다로'], keep: [], exclude: [] }, seconds: null },
    });
    await enhancePrompt(edit, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(sentBody(fetchMock).systemInstruction.parts[0]!.text).toContain('The new clip keeps the length of the video exactly');
  });

  it('a version made the older way gets exactly the instruction it got before', async () => {
    const fetchMock = mockGemini({ prompt: 'p', notes: '' });
    await enhancePrompt(reshoot(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0]!.text).not.toContain('revision.sheet');
    const payload = writerJson(writerParts(body)[0]!.text as string);
    expect(payload.revision).not.toHaveProperty('sheet');
    expect(payload.revision).not.toHaveProperty('seconds');
  });
});

describe('prepareJob hands the sheet over', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  it('with the remake\'s new length', async () => {
    const seen: EnhanceInput[] = [];
    const intel = fakeIntel();
    const deps = studioDeps(f.sql, {
      env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_STUDIO_REVISE_V2: 'on' }),
      intel: {
        ...intel,
        async enhancePrompt(i) {
          seen.push(i as EnhanceInput);
          return intel.enhancePrompt(i, { fetch, env: {} });
        },
      },
    });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: MADE_WITH, params: { seconds: 5, resolution: '720p' }, seconds: 5 });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), {
      kind: 'video_revise',
      organizationId: f.orgId,
      requestId: requestId(),
      outputId: root.outputId,
      mode: 'reshoot',
      prompt: 'ignored',
      references: [],
      dialogue: {
        sheet: { change: [{ text: '배경을 바다로', kind: 'look' }, { text: '10초로 늘리기', kind: 'length', seconds: 10 }], keep: ['병'], exclude: [] },
        questions: [],
        transcript: [{ role: 'customer', text: '배경을 바다로 하고 10초로 늘려줘' }],
      },
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    expect(job.prompt).toBe('배경을 바다로\n10초로 늘리기');
    expect(job.params.seconds).toBe(10);
    await prepareJob(deps, job);
    expect(seen[0]!.revision).toMatchObject({ mode: 'reshoot', sheet: { change: ['배경을 바다로', '10초로 늘리기'], keep: ['병'], exclude: [] }, seconds: 10 });
  });
});
