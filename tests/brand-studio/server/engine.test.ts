import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { advanceStudioJobsWith, sweepStudio } from '@/lib/brand-studio/engine';
import { cancelStudioJob, createStudioJob } from '@/lib/brand-studio/jobs';
import { laneClaim, laneComplete, laneFail } from '@/lib/brand-studio/lane-api';
import { recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import { loadAllowance } from '@/lib/brand-studio/usage';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** The state machine end to end with the fake provider (docs/BRAND-STUDIO-V2.md §7). */
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
async function create(input: Record<string, unknown>): Promise<StudioJobView> {
  const result = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.job;
}
async function view(id: string): Promise<StudioJobView> {
  const poll = await pollStudioJobs(deps, owner(), f.orgId, [id]);
  if (!poll.ok) throw new Error(poll.code);
  return poll.jobs[0]!;
}
const image = { kind: 'image', model: 'seedream-5-pro', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K' };

describe('image jobs', () => {
  it('runs held -> queued -> running -> finishing -> succeeded in one advance and stores N results with thumbnails', async () => {
    const job = await create({ ...image, count: 3 });
    expect(await advanceStudioJobsWith(deps, { jobIds: [job.id] })).toEqual({ advanced: 1 });
    const done = await view(job.id);
    expect(done).toMatchObject({ status: 'succeeded', finalPrompt: 'ENHANCED(seedream): a glass bottle on wet stone', errorCode: null });
    expect(done.outputs).toHaveLength(3);
    for (const o of done.outputs) {
      expect(o).toMatchObject({ kind: 'image', width: 512, height: 288, draft: false, savedAssetId: null });
      expect(o.url).toMatch(/^\/api\/brand-studio\/media\/st\/[0-9a-f]{64}\.png$/);
      expect(o.thumbUrl).toMatch(/\.webp$/);
    }
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ endpoint: 'bytedance/seedream-5.0-pro/text-to-image', body: { aspect_ratio: '16:9', enable_safety_checker: true } });
    const row = (await f.sql.query<{ usage_krw: number; cost_usd: string; claimed_at: unknown }>('select usage_krw, cost_usd, claimed_at from brand_studio_jobs where id = $1', [job.id])).rows[0]!;
    expect(row.claimed_at).toBeNull();
    expect(row.usage_krw).toBe(done.estimateKrw);
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(row.usage_krw);
    expect(deps.media.objects.size).toBe(6);
  });

  it('sends the customer words untouched when enhancement is off', async () => {
    const job = await create({ ...image, enhance: false, count: 1 });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(sent[0]!.body.prompt).toBe('a glass bottle on wet stone');
    expect((await view(job.id)).finalPrompt).toBeNull();
    expect(deps.intel.calls.enhance).toBe(0);
  });

  it('turns a provider safety refusal into provider_rejected and counts nothing', async () => {
    const job = await create({ ...image, prompt: 'something [[fake:reject]]', enhance: false, count: 2 });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await view(job.id)).toMatchObject({ status: 'failed', errorCode: 'provider_rejected', outputs: [], estimateKrw: 0 });
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(0);
    const detail = (await f.sql.query<{ error_detail: string }>('select error_detail from brand_studio_jobs where id = $1', [job.id])).rows[0]!.error_detail;
    expect(detail).toContain('fake rejection');
  });

  it('waits while the provider is still working, and finishes on a later poll', async () => {
    deps = studioDeps(f.sql, { provider: (await import('@/lib/brand-studio/provider/fake')).createFakeStudioProvider({ pollsBeforeDone: 3 }) as never });
    const job = await create({ ...image, count: 1 });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await view(job.id)).status).toBe('running');
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await view(job.id)).status).toBe('running');
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await view(job.id)).status).toBe('succeeded');
  });
});

describe('the lease', () => {
  it('never lets two invocations move the same job; an expired lease is taken over', async () => {
    const job = await create({ ...image, count: 1 });
    await f.sql.query('update brand_studio_jobs set claimed_at = now() where id = $1', [job.id]);
    expect(await advanceStudioJobsWith(deps, { jobIds: [job.id] })).toEqual({ advanced: 0 });
    expect((await view(job.id)).status).toBe('queued');
    await f.sql.query("update brand_studio_jobs set claimed_at = now() - interval '10 minutes' where id = $1", [job.id]);
    expect(await advanceStudioJobsWith(deps, { jobIds: [job.id] })).toEqual({ advanced: 1 });
    expect((await view(job.id)).status).toBe('succeeded');
  });

  it('two concurrent advances submit each slot exactly once', async () => {
    const job = await create({ ...image, count: 2 });
    await Promise.all([advanceStudioJobsWith(deps, { jobIds: [job.id] }), advanceStudioJobsWith(deps, { jobIds: [job.id] })]);
    expect(sent).toHaveLength(2);
    expect((await view(job.id)).outputs).toHaveLength(2);
  });

  it('a cancel wins over a later advance', async () => {
    const job = await create({ ...image, count: 1 });
    expect(await cancelStudioJob(deps, owner(), { organizationId: f.orgId, jobId: job.id })).toEqual({ ok: true });
    expect(await advanceStudioJobsWith(deps, { jobIds: [job.id] })).toEqual({ advanced: 0 });
    expect(await view(job.id)).toMatchObject({ status: 'canceled', estimateKrw: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe('region edit', () => {
  it('cuts the crop, sends it first, composites the result into the original and drops the crop', async () => {
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 64, height: 48 });
    const logo = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'logo' });
    const job = await create({
      kind: 'region_edit', model: 'seedream-5-pro', prompt: '라벨 글자만 바꿔 주세요',
      source: { assetId: source }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, references: [{ assetId: logo }],
    });
    // A model without a region-edit default gives way to Nano Banana Pro.
    expect(job.model).toBe('nano-banana-pro');
    const before = deps.media.objects.size;
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const done = await view(job.id);
    expect(done.status).toBe('succeeded');
    expect(sent[0]!.endpoint).toBe('google/gemini-3-pro-image/image-editing');
    const images = sent[0]!.body.images as string[];
    expect(images).toHaveLength(2);
    expect(images[1]).toContain('/api/brand-studio/media/st/');
    expect(deps.intel.calls.composite).toHaveLength(1);
    expect(deps.intel.calls.composite[0]!.plan.box).toEqual({ left: 16, top: 12, width: 32, height: 24 });
    expect(done.outputs[0]).toMatchObject({ width: 64, height: 48 });
    const stored = deps.media.objects.get(done.outputs[0]!.url.replace('/api/brand-studio/media/', ''))!;
    const meta = await sharp(stored.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 64, 48]);
    // Result + thumbnail added; the crop came and went.
    expect(deps.media.objects.size).toBe(before + 2);
  });
});

describe('video', () => {
  const video = { kind: 'video', model: 'seedance-2.5', prompt: 'slow push in on the bottle', aspect: '9:16', seconds: 5, audio: 'native' };

  it('makes a 480p draft, then finishes it at 1080p on the same lane with the draft id', async () => {
    const draftJob = await create({ ...video, resolution: 'draft' });
    await advanceStudioJobsWith(deps, { jobIds: [draftJob.id] });
    const draft = await view(draftJob.id);
    expect(draft).toMatchObject({ status: 'succeeded', resolution: 'draft' });
    expect(draft.outputs[0]).toMatchObject({ kind: 'video', draft: true, width: 160, height: 90, seconds: 1 });
    expect(sent[0]!.body).toMatchObject({ draft: true, resolution: '480p', generate_audio: true });

    const finalJob = await create({ kind: 'video_final', draftOutputId: draft.outputs[0]!.id });
    expect(finalJob).toMatchObject({ kind: 'video_final', parentOutputId: draft.outputs[0]!.id, resolution: '1080p' });
    expect(await createStudioJob(deps, owner(), { kind: 'video_final', organizationId: f.orgId, requestId: requestId(), draftOutputId: draft.outputs[0]!.id })).toEqual({ ok: false, code: 'conflict' });
    await advanceStudioJobsWith(deps, { jobIds: [finalJob.id] });
    const final = await view(finalJob.id);
    expect(final.status).toBe('succeeded');
    expect(final.outputs[0]!.draft).toBe(false);
    expect(sent[1]).toEqual({ endpoint: 'bytedance/seedance-2.5/draft-to-video', body: { draft_task_id: expect.stringMatching(/^fake-draft-/), output_format: 'mp4' } });
    const lanes = (await f.sql.query<{ lane: string }>('select lane from brand_studio_jobs where id = any($1::uuid[]) order by created_at', [[draftJob.id, finalJob.id]])).rows;
    expect(lanes.map((l) => l.lane)).toEqual(['sunra_api', 'sunra_api']);
  });

  it('a final of a result that is not a draft is not found', async () => {
    const job = await create({ ...video, resolution: '720p' });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const done = await view(job.id);
    expect(await createStudioJob(deps, owner(), { kind: 'video_final', organizationId: f.orgId, requestId: requestId(), draftOutputId: done.outputs[0]!.id })).toEqual({ ok: false, code: 'not_found' });
  });

  it('a remix reads the film, sends the reference video and pins the edit task', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create({ kind: 'video_remix', model: 'seedance-2.5', prompt: '', change: '병을 파란 병으로', method: 'edit', keep: ['camera', 'timing'], aspect: '9:16', resolution: 'draft', audio: 'ambient', references: [{ assetId: film }] });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await view(job.id)).status).toBe('succeeded');
    expect(deps.intel.calls.film).toBe(1);
    expect(sent[0]!.body).toMatchObject({ omni_reference_task_type: 'edit', duration: -1, ratio: 'adaptive', draft: true });
    expect((sent[0]!.body.reference_videos as string[])[0]).toContain('.mp4');
  });
});

describe('the account lane', () => {
  it('routes to the preferred account lane while its worker is alive, hands the worker everything, and finishes on complete', async () => {
    await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
    await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});
    const job = await create({ ...image, count: 2 });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await f.sql.query('select status, lane from brand_studio_jobs where id = $1', [job.id])).rows[0]).toEqual({ status: 'queued', lane: 'sunra_mcp' });
    expect(sent).toHaveLength(0);
    const claimed = await laneClaim(deps, { limit: 4 });
    if (!claimed.ok) throw new Error();
    expect(claimed.jobs).toHaveLength(1);
    expect(claimed.jobs[0]).toMatchObject({ jobId: job.id, model: 'seedream-5-pro', prompt: 'ENHANCED(seedream): a glass bottle on wet stone', params: { aspect: '16:9', count: 2, draft: false } });
    expect(claimed.jobs[0]!.outputs.map((o) => o.idx)).toEqual([0, 1]);
    expect(claimed.jobs[0]!.apiRequest?.endpoint).toBe('bytedance/seedream-5.0-pro/text-to-image');
    expect(await laneClaim(deps, {})).toEqual({ ok: true, jobs: [] });
    // The engine leaves a worker's running job alone.
    expect(await advanceStudioJobsWith(deps, { jobIds: [job.id] })).toEqual({ advanced: 0 });
    expect(await laneComplete(deps, { jobId: job.id, outputs: [{ idx: 0, url: 'fake://image/320x180/a' }, { idx: 1, url: 'fake://image/320x180/b' }], costUsd: 0.18 })).toEqual({ ok: true, jobId: job.id });
    expect(await laneComplete(deps, { jobId: job.id, outputs: [{ idx: 0, url: 'fake://image/320x180/a' }] })).toEqual({ ok: false, code: 'conflict' });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const done = await view(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs.map((o) => [o.width, o.height])).toEqual([[320, 180], [320, 180]]);
  });

  it('a silent worker loses the jobs it has not started to the API lane; a lane failure fails the job', async () => {
    await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
    const fresh = await create({ ...image, count: 1 });
    await advanceStudioJobsWith(deps, { jobIds: [fresh.id] });
    // No heartbeat at all: straight to the API lane.
    expect((await f.sql.query('select lane from brand_studio_jobs where id = $1', [fresh.id])).rows[0]).toEqual({ lane: 'sunra_api' });

    await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});
    const queued = await create({ ...image, count: 1 });
    await advanceStudioJobsWith(deps, { jobIds: [queued.id] });
    expect((await f.sql.query('select lane from brand_studio_jobs where id = $1', [queued.id])).rows[0]).toEqual({ lane: 'sunra_mcp' });
    await f.sql.query("update brand_studio_lanes set seen_at = now() - interval '5 minutes'");
    expect((await sweepStudio(deps)).rerouted).toBe(1);
    expect((await view(queued.id)).status).toBe('succeeded');

    await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});
    const failing = await create({ ...image, count: 1 });
    await advanceStudioJobsWith(deps, { jobIds: [failing.id] });
    await laneClaim(deps, {});
    expect(await laneFail(deps, { jobId: failing.id, code: 'provider_rejected', detail: 'moderation' })).toEqual({ ok: true, jobId: failing.id });
    expect(await view(failing.id)).toMatchObject({ status: 'failed', errorCode: 'provider_rejected' });
  });

  it('R-06: counts multi-output slots in laneLoad/laneClaim and expires stuck sunra_mcp running jobs after 30 minutes', async () => {
    const { laneLoad } = await import('@/lib/brand-studio/lanes');
    await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
    await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});

    const j1 = await create({ ...image, count: 2, enhance: false });
    const j2 = await create({ ...image, count: 2, enhance: false });
    expect((await laneLoad(f.sql)).sunra_mcp).toBe(4);
    await advanceStudioJobsWith(deps, { jobIds: [j1.id, j2.id] });

    // A slot budget of 2 claims j1 (2 output slots) and leaves j2 queued instead of overflowing concurrency.
    const claimed = await laneClaim(deps, { limit: 2 });
    if (!claimed.ok) throw new Error('expected claim');
    expect(claimed.jobs.map((j) => j.jobId)).toEqual([j1.id]);
    expect((await view(j1.id)).status).toBe('running');
    expect((await view(j2.id)).status).toBe('queued');

    // If the worker dies while j1 is running, sweepStudio fails it after 30 minutes (releasing reserved budget).
    await f.sql.query("update brand_studio_lanes set seen_at = now() - interval '10 minutes'");
    await f.sql.query("update brand_studio_jobs set started_at = now() - interval '31 minutes' where id = $1", [j1.id]);
    const swept = await sweepStudio(deps);
    expect(swept.expired).toBe(1);
    expect(await view(j1.id)).toMatchObject({ status: 'failed', errorCode: 'provider_unavailable', estimateKrw: 0 });
  });
});
