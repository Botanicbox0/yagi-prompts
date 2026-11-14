import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { laneClaim, laneComplete, laneFail } from '@/lib/brand-studio/lane-api';
import { closeLane, LANE_CLOSE_MS, loadLaneClosures, recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import { StudioProviderError } from '@/lib/brand-studio/provider/types';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** docs/BRAND-STUDIO-V2.md §7: a lane that cannot pay hands its jobs to the other one, once. */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let submits: number;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
  submits = 0;
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const image = { kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 1 };
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
const row = async (id: string) =>
  (await f.sql.query<{ status: string; lane: string | null; tried: string[] | null; error_code: string | null }>(
    "select status, lane, work -> 'triedLanes' as tried, error_code from brand_studio_jobs where id = $1", [id],
  )).rows[0]!;
/** The API account is out of money: every submit answers like Sunra's 412 INSUFFICIENT_CREDIT. */
function apiCannotPay() {
  deps.provider.submit = async () => {
    submits += 1;
    throw new StudioProviderError('provider_unavailable', 'INSUFFICIENT_CREDIT (412)', false, 'balance');
  };
}
const workerAlive = () => recordLaneHeartbeat(f.sql, 'sunra_mcp', { host: 'test' });
const preferAccountLane = () => f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);

describe('the API lane cannot pay', () => {
  it('moves the job to the account lane, closes the API lane for a while, and the job finishes there', async () => {
    await workerAlive();
    apiCannotPay();
    const job = await create(image);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await row(job.id)).toMatchObject({ status: 'queued', lane: 'sunra_mcp', tried: ['sunra_api'], error_code: null });
    // The customer sees an ordinary waiting run, nothing about lanes.
    expect(await view(job.id)).toMatchObject({ status: 'queued', errorCode: null });
    const closed = (await loadLaneClosures(f.sql)).sunra_api!;
    expect(closed.getTime() - Date.now()).toBeGreaterThan(LANE_CLOSE_MS - 60_000);
    // A new run goes straight to the open lane while the API lane is closed.
    const next = await create(image);
    expect(await row(next.id)).toMatchObject({ lane: 'sunra_mcp' });

    const claimed = await laneClaim(deps, { limit: 1 });
    if (!claimed.ok) throw new Error();
    expect(claimed.jobs.map((j) => j.jobId)).toEqual([job.id]);
    expect(await laneComplete(deps, { jobId: job.id, outputs: [{ idx: 0, url: 'fake://image/320x180/a' }] })).toEqual({ ok: true, jobId: job.id });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await view(job.id)).status).toBe('succeeded');
    expect(submits).toBe(1);
  });

  it('holds the job while the account lane has no worker, rather than failing it', async () => {
    apiCannotPay();
    const job = await create(image);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await row(job.id)).toMatchObject({ status: 'held', lane: null, tried: ['sunra_api'] });
  });
});

describe('the account lane cannot pay', () => {
  it('moves the job to the API lane and closes the account lane for a while', async () => {
    await preferAccountLane();
    await workerAlive();
    const job = await create(image);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await row(job.id)).toMatchObject({ status: 'queued', lane: 'sunra_mcp' });
    await laneClaim(deps, {});
    expect(await laneFail(deps, { jobId: job.id, code: 'provider_unavailable', detail: 'no credits left' })).toEqual({ ok: true, jobId: job.id });
    expect(await row(job.id)).toMatchObject({ status: 'queued', lane: 'sunra_api', tried: ['sunra_mcp'] });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await view(job.id)).toMatchObject({ status: 'succeeded', errorCode: null });
    // The worker's next heartbeat does not reopen it.
    await workerAlive();
    expect((await loadLaneClosures(f.sql)).sunra_mcp).not.toBeNull();
    const next = await create(image);
    expect(await row(next.id)).toMatchObject({ lane: 'sunra_api' });
  });
});

describe('where failover stops', () => {
  it('fails with provider_unavailable when both lanes are closed', async () => {
    await workerAlive();
    await closeLane(f.sql, 'sunra_mcp', new Date());
    apiCannotPay();
    const job = await create(image);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await view(job.id)).toMatchObject({ status: 'failed', errorCode: 'provider_unavailable', estimateKrw: 0 });
  });

  it('never sends a job back to a lane it already left (no ping-pong)', async () => {
    await preferAccountLane();
    await workerAlive();
    const job = await create(image);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    await laneClaim(deps, {});
    await laneFail(deps, { jobId: job.id, code: 'provider_unavailable', detail: 'no credits left' });
    // The account lane comes back, but this job already left it.
    await f.sql.query("update brand_studio_lanes set info = '{}'::jsonb where lane = 'sunra_mcp'");
    apiCannotPay();
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await row(job.id)).toMatchObject({ status: 'failed', error_code: 'provider_unavailable', lane: 'sunra_api' });
    expect(submits).toBe(1);
  });

  it('keeps a 1080p final on its draft lane and fails it there', async () => {
    const draftJob = await create({ kind: 'video', model: 'seedance-2.5', prompt: 'slow push in', aspect: '9:16', seconds: 5, audio: 'native', resolution: 'draft' });
    await advanceStudioJobsWith(deps, { jobIds: [draftJob.id] });
    const draft = await view(draftJob.id);
    expect(draft.status).toBe('succeeded');
    await workerAlive();
    apiCannotPay();
    const final = await create({ kind: 'video_final', draftOutputId: draft.outputs[0]!.id });
    await advanceStudioJobsWith(deps, { jobIds: [final.id] });
    expect(await row(final.id)).toMatchObject({ status: 'failed', error_code: 'provider_unavailable', lane: 'sunra_api' });
  });

  it('fails a final on the account lane instead of moving it', async () => {
    await preferAccountLane();
    await workerAlive();
    const draftJob = await create({ kind: 'video', model: 'seedance-2.5', prompt: 'slow push in', aspect: '9:16', seconds: 5, audio: 'native', resolution: 'draft' });
    await advanceStudioJobsWith(deps, { jobIds: [draftJob.id] });
    await laneClaim(deps, {});
    await laneComplete(deps, { jobId: draftJob.id, outputs: [{ idx: 0, url: 'fake://video/a', draftTaskId: 'draft-1' }] });
    await advanceStudioJobsWith(deps, { jobIds: [draftJob.id] });
    const draft = await view(draftJob.id);
    expect(draft.status).toBe('succeeded');
    const final = await create({ kind: 'video_final', draftOutputId: draft.outputs[0]!.id });
    await advanceStudioJobsWith(deps, { jobIds: [final.id] });
    await laneClaim(deps, {});
    expect(await laneFail(deps, { jobId: final.id, code: 'provider_unavailable', detail: 'no credits left' })).toEqual({ ok: true, jobId: final.id });
    expect(await row(final.id)).toMatchObject({ status: 'failed', error_code: 'provider_unavailable', lane: 'sunra_mcp' });
  });
});
