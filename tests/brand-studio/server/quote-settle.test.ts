import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creditsLeft, creditsOf } from '@/lib/brand-studio/credits';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { laneClaim, laneComplete } from '@/lib/brand-studio/lane-api';
import { recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import { memberUsage } from '@/lib/brand-studio/member-usage';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import { loadAllowance } from '@/lib/brand-studio/usage';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * What a run is quoted is what it takes once the account lane's worker reports the provider's credits
 * (scripts/brand-studio-lane-worker.mjs sends `credits / 100` as `costUsd`). The credits below are the
 * ones the provider charged for these settings on 2026-11-18.
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
  await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
  await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
async function create(input: Record<string, unknown>): Promise<StudioJobView> {
  const result = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), enhance: false, ...input });
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.job;
}
async function view(id: string): Promise<StudioJobView> {
  const poll = await pollStudioJobs(deps, owner(), f.orgId, [id]);
  if (!poll.ok) throw new Error(poll.code);
  return poll.jobs[0]!;
}
/** The worker's part: claim the job, then report the results and the provider's credits. */
async function finishOnAccountLane(job: StudioJobView, urls: string[], accountCredits: number): Promise<StudioJobView> {
  await advanceStudioJobsWith(deps, { jobIds: [job.id] });
  const claimed = await laneClaim(deps, { limit: 4 });
  if (!claimed.ok || claimed.jobs.length !== 1) throw new Error('not claimed');
  const done = await laneComplete(deps, { jobId: job.id, outputs: urls.map((url, idx) => ({ idx, url })), costUsd: Math.round(accountCredits) / 100 });
  if (!done.ok) throw new Error(done.code);
  await advanceStudioJobsWith(deps, { jobIds: [job.id] });
  return view(job.id);
}
const used = async () => (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;

describe('a run takes what it was quoted', () => {
  it('two pictures at 2K: 4 account credits each, 7 studio credits each, before and after', async () => {
    const job = await create({ kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 2 });
    expect(creditsOf(job.estimateKrw)).toBe(14);
    const done = await finishOnAccountLane(job, ['fake://image/320x180/a', 'fake://image/320x180/b'], 8);
    expect(done.status).toBe('succeeded');
    expect(done.estimateKrw).toBe(job.estimateKrw);
    expect(done.countedOutputs).toBe(2);
    expect(await used()).toBe(job.estimateKrw);
    const row = (await f.sql.query<{ usage_krw: number; estimate_krw: number; cost_usd: string }>('select usage_krw, estimate_krw, cost_usd from brand_studio_jobs where id = $1', [job.id])).rows[0]!;
    expect(Number(row.usage_krw)).toBe(Number(row.estimate_krw));
    expect(Number(row.cost_usd)).toBe(0.08);
  });

  it('a 4 s draft: 42 account credits, the production run of 2026-11-15', async () => {
    const job = await create({ kind: 'video', model: 'seedance-2.5', prompt: 'slow push in on the bottle', aspect: '9:16', seconds: 4, audio: 'native', resolution: 'draft' });
    const done = await finishOnAccountLane(job, ['fake://video/854x480/4'], 42);
    expect(done.status).toBe('succeeded');
    expect(done.estimateKrw).toBe(job.estimateKrw);
    expect(await used()).toBe(job.estimateKrw);
  });

  it('a 10 s film at 720p and at 1080p: 233 and 571 account credits', async () => {
    for (const [resolution, accountCredits] of [['720p', 233], ['1080p', 571]] as const) {
      const before = await used();
      const job = await create({ kind: 'video', model: 'seedance-2.5', prompt: 'slow push in on the bottle', aspect: '16:9', seconds: 10, audio: 'native', resolution });
      const done = await finishOnAccountLane(job, ['fake://video/1280x720/10'], accountCredits);
      expect(done.estimateKrw, resolution).toBe(job.estimateKrw);
      expect((await used()) - before, resolution).toBe(job.estimateKrw);
    }
  });
});

describe('the balance moves by the amounts on the results', () => {
  it('counts a row settled before the whole-credit rule the way its result reads', async () => {
    const job = await create({ kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle', aspect: '1:1', resolution: '2K', count: 1 });
    await finishOnAccountLane(job, ['fake://image/320x320/a'], 4);
    // 79 KRW is what the 2026-11-17 partial edit was settled at: it reads as 8 credits on its result.
    await f.sql.query('update brand_studio_jobs set usage_krw = 79 where id = $1', [job.id]);
    const allowance = await loadAllowance(f.sql, f.orgId, deps.env);
    expect(allowance.usedKrw).toBe(80);
    expect(creditsLeft(allowance.capKrw, 0) - creditsLeft(allowance.capKrw, allowance.usedKrw)).toBe(creditsOf((await view(job.id)).estimateKrw));
    const mine = (await memberUsage(f.sql, f.orgId)).find((row) => row.userId === f.ids.owner);
    expect(mine?.usedKrw).toBe(80);
  });

  it('keeps the amount per result when one of them is deleted afterwards', async () => {
    const job = await create({ kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle', aspect: '1:1', resolution: '2K', count: 2 });
    const done = await finishOnAccountLane(job, ['fake://image/320x320/a', 'fake://image/320x320/b'], 8);
    await f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [done.outputs[0]!.id]);
    const after = await view(job.id);
    expect(after.outputs).toHaveLength(1);
    expect(after.countedOutputs).toBe(2);
    expect(creditsOf(after.estimateKrw) / after.countedOutputs!).toBe(7);
  });
});
