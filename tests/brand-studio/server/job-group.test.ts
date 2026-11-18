import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { groupModelProblem, createStudioJobGroup } from '@/lib/brand-studio/job-group';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { profileVersionOf } from '@/lib/brand-studio/enhancer';
import { STUDIO_MODELS, studioModel } from '@/lib/brand-studio/models';
import { pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { imageRunKrw } from '@/lib/brand-studio/usage-rate';
import { ImageJobGroupSchema, STUDIO_LIMITS, groupRunRequestId, type StudioJobView } from '@/lib/brand-studio/contracts';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import type { JobRow } from '@/lib/brand-studio/types';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * `job.create_group` (founder 2026-11-19: "이미지 모델을 2개 이상을 동시 선택해서 … 각 프롬프트별 로직이 따로
 * 들어가서 이미지가 2장이 나오게"): N ordinary image jobs in one transaction, all or nothing, each with its own
 * model, request id, prompt design and settlement.
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let sent: StudioProviderRequest[];
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
  sent = [];
  const submit = deps.provider.submit.bind(deps.provider);
  deps.provider.submit = (request, options) => {
    sent.push(request);
    return submit(request, options);
  };
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const group = (patch: Record<string, unknown> = {}) => ({
  kind: 'image',
  organizationId: f.orgId,
  requestId: requestId(),
  prompt: 'a glass bottle on wet stone',
  aspect: '4:3',
  resolution: '2K',
  count: 1,
  runs: [{ model: 'seedream-5.5' }, { model: 'nano-banana-pro' }],
  ...patch,
});
async function createGroup(input: Record<string, unknown>) {
  const result = await createStudioJobGroup(deps, owner(), input);
  if (!result.ok) throw new Error(`group failed: ${result.code}`);
  return result;
}
async function view(ids: string[]): Promise<StudioJobView[]> {
  const poll = await pollStudioJobs(deps, owner(), f.orgId, ids);
  if (!poll.ok) throw new Error(poll.code);
  return ids.map((id) => poll.jobs.find((job) => job.id === id)!);
}
const jobCount = async () => Number((await f.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_jobs where organization_id = $1', [f.orgId])).rows[0]!.n);
const used = async () => (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;
const row = async (id: string) => (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;

describe('the contract', () => {
  it('takes two or three different image models, and a key short enough for each run to keep its own', () => {
    const base = group();
    expect(ImageJobGroupSchema.safeParse(base).success).toBe(true);
    expect(ImageJobGroupSchema.safeParse({ ...base, runs: [{ model: 'seedream-5.5' }] }).success).toBe(false);
    expect(ImageJobGroupSchema.safeParse({ ...base, runs: [{ model: 'seedream-5.5' }, { model: 'seedream-5.5' }] }).success).toBe(false);
    const four = ['seedream-5.5', 'nano-banana-pro', 'nano-banana-2.1', 'gpt-image-2.6-flare'].map((model) => ({ model }));
    expect(ImageJobGroupSchema.safeParse({ ...base, runs: four }).success).toBe(false);
    expect(ImageJobGroupSchema.safeParse({ ...base, requestId: 'x'.repeat(57) }).success).toBe(false);
    expect(ImageJobGroupSchema.safeParse({ ...base, prompt: '' }).success).toBe(false);
    // Every run's derived key fits the 80-character key of a single job and its alphabet.
    const key = 'k'.repeat(56);
    for (const model of STUDIO_MODELS.map((m) => m.id)) expect(groupRunRequestId(key, model)).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(groupRunRequestId('abcdefgh', 'seedream-5.5')).toBe('abcdefgh-seedream-5_5');
  });

  it('names a model no screen offers any more apart from a name that is not an image model', () => {
    expect(groupModelProblem('seedream-5.5')).toBeNull();
    expect(groupModelProblem('seedream-5-flash')).toBe('model_unavailable');
    expect(groupModelProblem('seedance-2.5')).toBe('invalid');
    expect(groupModelProblem('no-such-model')).toBe('invalid');
  });
});

describe('one transaction, one run per model', () => {
  it('creates a run per model with its own key, model and price, all sharing one group', async () => {
    const ref = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const input = group({ requestId: 'grp_0123456789', references: [{ assetId: ref }], count: 2, runs: [{ model: 'nano-banana-pro' }, { model: 'gpt-image-2.6-flare', quality: 'high' }, { model: 'seedream-5.5' }] });
    const result = await createGroup(input);
    expect(result.jobs.map((job) => job.model)).toEqual(['nano-banana-pro', 'gpt-image-2.6-flare', 'seedream-5.5']);
    for (const job of result.jobs) {
      expect(job.group).toEqual({ id: result.groupId, models: ['nano-banana-pro', 'gpt-image-2.6-flare', 'seedream-5.5'] });
      expect(job).toMatchObject({ kind: 'image', prompt: 'a glass bottle on wet stone', aspect: '4:3', resolution: '2K', expected: 2, references: [{ assetId: ref }] });
    }
    const keys = await Promise.all(result.jobs.map(async (job) => (await row(job.id)).request_id));
    expect(keys).toEqual(['grp_0123456789-nano-banana-pro', 'grp_0123456789-gpt-image-2_6-flare', 'grp_0123456789-seedream-5_5']);
    // The GPT run keeps its quality; the others have none.
    expect(result.jobs.map((job) => job.quality ?? null)).toEqual([null, 'high', null]);
    // Each run is priced exactly as a single run with the same settings, and the month takes the sum.
    const expected = [
      imageRunKrw({ model: 'nano-banana-pro', resolution: '2K', references: 1, count: 2, aspect: '4:3' }),
      imageRunKrw({ model: 'gpt-image-2.6-flare', resolution: '2K', references: 1, count: 2, quality: 'high', aspect: '4:3' }),
      imageRunKrw({ model: 'seedream-5.5', resolution: '2K', references: 1, count: 2, aspect: '4:3' }),
    ];
    expect(result.jobs.map((job) => job.estimateKrw)).toEqual(expected);
    expect(await used()).toBe(expected.reduce((a, b) => a + b, 0));
  });

  it('prices each run like the same run sent alone', async () => {
    const result = await createGroup(group({ runs: [{ model: 'seedream-5.5' }, { model: 'gpt-image-2.6-sunburst', quality: 'low' }] }));
    for (const job of result.jobs) {
      const single = await createStudioJob(deps, owner(), {
        kind: 'image', organizationId: f.orgId, requestId: requestId(), model: job.model, prompt: 'a glass bottle on wet stone',
        aspect: '4:3', resolution: '2K', count: 1, ...(job.quality ? { quality: job.quality } : {}),
      });
      if (!single.ok) throw new Error(single.code);
      expect(job.estimateKrw).toBe(single.job.estimateKrw);
    }
  });

  it('answers a repeated request with the same runs and creates nothing new', async () => {
    const input = group();
    const first = await createGroup(input);
    const before = await jobCount();
    const again = await createGroup(input);
    expect(again.groupId).toBe(first.groupId);
    expect(again.jobs.map((job) => job.id)).toEqual(first.jobs.map((job) => job.id));
    expect(await jobCount()).toBe(before);
    expect(await used()).toBe(first.jobs.reduce((sum, job) => sum + job.estimateKrw, 0));
  });

  it('refuses a key already used by a run outside a group', async () => {
    const key = requestId();
    const lone = await createStudioJob(deps, owner(), { kind: 'image', organizationId: f.orgId, requestId: groupRunRequestId(key, 'seedream-5.5'), model: 'seedream-5.5', prompt: 'x', aspect: '4:3', resolution: '2K', count: 1 });
    expect(lone.ok).toBe(true);
    expect(await createStudioJobGroup(deps, owner(), group({ requestId: key }))).toEqual({ ok: false, code: 'conflict' });
    expect(await jobCount()).toBe(1);
  });
});

describe('all or nothing', () => {
  it('checks the allowance for the sum: one run would fit, the group does not, nothing is created', async () => {
    const seedream = imageRunKrw({ model: 'seedream-5.5', resolution: '2K', references: 0, count: 1, aspect: '4:3' });
    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = $2 where organization_id = $1', [f.orgId, seedream + 10]);
    expect(await createStudioJobGroup(deps, owner(), group())).toEqual({ ok: false, code: 'allowance_exhausted' });
    expect(await jobCount()).toBe(0);
    expect(await used()).toBe(0);
  });

  it('refuses the whole group when it does not fit under the open-run ceiling', async () => {
    const lone = { kind: 'image', organizationId: f.orgId, model: 'seedream-5.5', prompt: 'x', aspect: '4:3', resolution: '2K', count: 1 };
    for (let i = 0; i < STUDIO_LIMITS.openJobsPerOrganization - 1; i++) {
      const made = await createStudioJob(deps, owner(), { ...lone, requestId: requestId() });
      expect(made.ok).toBe(true);
    }
    // Five open: a single run still fits, a group of two does not.
    expect(await createStudioJobGroup(deps, owner(), group())).toEqual({ ok: false, code: 'too_many_running' });
    expect(await jobCount()).toBe(STUDIO_LIMITS.openJobsPerOrganization - 1);
    await f.sql.query("update brand_studio_jobs set status = 'succeeded', finished_at = now() where id = (select id from brand_studio_jobs where organization_id = $1 limit 1)", [f.orgId]);
    expect((await createStudioJobGroup(deps, owner(), group())).ok).toBe(true);
    expect(await jobCount()).toBe(STUDIO_LIMITS.openJobsPerOrganization + 1);
  });

  it('refuses the whole group when a picked model stopped being offered after the page loaded', async () => {
    const entry = STUDIO_MODELS.find((m) => m.id === 'nano-banana-pro')! as { availability: string };
    const was = entry.availability;
    entry.availability = 'retired';
    try {
      expect(await createStudioJobGroup(deps, owner(), group())).toEqual({ ok: false, code: 'model_unavailable' });
    } finally {
      entry.availability = was;
    }
    expect(await createStudioJobGroup(deps, owner(), group({ runs: [{ model: 'seedream-5.5' }, { model: 'seedream-5-flash' }] }))).toEqual({ ok: false, code: 'model_unavailable' });
    expect(await createStudioJobGroup(deps, owner(), group({ runs: [{ model: 'seedream-5.5' }, { model: 'seedance-2.5' }] }))).toEqual({ ok: false, code: 'invalid' });
    expect(await jobCount()).toBe(0);
  });

  it('refuses the whole group when one run is not valid on its model (a ratio, a quality)', async () => {
    // 21:9 is not a GPT Image ratio; quality on a model without one is refused like a single run.
    expect(await createStudioJobGroup(deps, owner(), group({ aspect: '21:9', runs: [{ model: 'seedream-5.5' }, { model: 'gpt-image-2.6-flare' }] }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJobGroup(deps, owner(), group({ runs: [{ model: 'seedream-5.5', quality: 'high' }, { model: 'nano-banana-pro' }] }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJobGroup(deps, owner(), group({ prompt: 'like image 2', references: [] }))).toEqual({ ok: false, code: 'reference_missing' });
    expect(await jobCount()).toBe(0);
  });

  it('lets a viewer create nothing, and goes through the same gate as every operation', async () => {
    expect(await createStudioJobGroup(deps, viewerOf(f.ids.viewer), group())).toEqual({ ok: false, code: 'forbidden' });
    expect(await runStudioOperation(deps, viewerOf(f.ids.outsider), 'job.create_group', group())).toMatchObject({ ok: false });
    const made = await runStudioOperation(deps, owner(), 'job.create_group', group());
    expect(made).toMatchObject({ ok: true });
    expect(await jobCount()).toBe(2);
  });
});

describe('each run on its own', () => {
  it('designs each run with its own model profile and records it', async () => {
    const result = await createGroup(group({ runs: [{ model: 'seedream-5.5' }, { model: 'nano-banana-2.1' }, { model: 'gpt-image-2.6-flare' }] }));
    await advanceStudioJobsWith(deps, { jobIds: result.jobs.map((job) => job.id) });
    const done = await view(result.jobs.map((job) => job.id));
    expect(done.map((job) => job.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    for (const job of done) {
      const profile = studioModel(job.model)!.promptProfile;
      expect(job.finalPrompt).toBe(`ENHANCED(${profile}): a glass bottle on wet stone`);
      const work = (await row(job.id)).work;
      expect(work.enhancer).toMatchObject({ profile, profileVersion: profileVersionOf(profile, job.model) });
    }
    expect(deps.intel.calls.enhance).toBe(3);
  });

  it('sends a model its own reviewed sentence untouched while another is designed at send', async () => {
    const result = await createGroup(group({ runs: [{ model: 'seedream-5.5', reviewedPrompt: 'Image-free product shot of a glass bottle, Seedream wording' }, { model: 'nano-banana-pro' }] }));
    await advanceStudioJobsWith(deps, { jobIds: result.jobs.map((job) => job.id) });
    const [seedream, nano] = await view(result.jobs.map((job) => job.id));
    expect(seedream).toMatchObject({ reviewed: true, finalPrompt: 'Image-free product shot of a glass bottle, Seedream wording', prompt: 'a glass bottle on wet stone' });
    expect(nano).toMatchObject({ finalPrompt: 'ENHANCED(nano-banana): a glass bottle on wet stone' });
    expect(nano!.reviewed).toBeUndefined();
    expect(sent.find((r) => r.endpoint.startsWith('bytedance/seedream-5.5'))!.body.prompt).toBe('Image-free product shot of a glass bottle, Seedream wording');
    expect(deps.intel.calls.enhance).toBe(1);
  });

  it('settles and refunds each run on its own: one model failing never touches the other', async () => {
    const result = await createGroup(group({ enhance: false, runs: [{ model: 'seedream-5.5' }, { model: 'nano-banana-pro', reviewedPrompt: 'the bottle [[fake:reject]]' }] }));
    const total = result.jobs.reduce((sum, job) => sum + job.estimateKrw, 0);
    expect(await used()).toBe(total);
    await advanceStudioJobsWith(deps, { jobIds: result.jobs.map((job) => job.id) });
    const [ok, rejected] = await view(result.jobs.map((job) => job.id));
    expect(ok).toMatchObject({ status: 'succeeded', estimateKrw: result.jobs[0]!.estimateKrw });
    expect(ok!.outputs).toHaveLength(1);
    expect(rejected).toMatchObject({ status: 'failed', errorCode: 'provider_rejected', estimateKrw: 0, outputs: [] });
    // Only what came out is taken.
    expect(await used()).toBe(result.jobs[0]!.estimateKrw);
  });
});
