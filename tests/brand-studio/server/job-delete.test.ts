import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { cancelStudioJob, createStudioJob } from '@/lib/brand-studio/jobs';
import { resetJobSoftDeleteProbe } from '@/lib/brand-studio/repo';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { loadAllowance } from '@/lib/brand-studio/usage';
import type { StudioJobView, StudioState } from '@/lib/brand-studio/contracts';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * docs/BRAND-STUDIO-V6-PLAN.md §7 row B. Two things the prompt bar and the wall rely on:
 *  - `job.delete` takes a run that ended with no result off the wall by setting `deleted_at` (0090). The row
 *    is never removed, and until the column exists the studio behaves exactly as before.
 *  - a sentence the customer read before sending is stored as `final_prompt` while `prompt` stays their words.
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let sent: StudioProviderRequest[];
beforeEach(async () => {
  resetJobSoftDeleteProbe();
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
const image = { kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 1 };
async function create(input: Record<string, unknown>): Promise<StudioJobView> {
  const result = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.job;
}
async function failed(): Promise<StudioJobView> {
  const job = await create({ ...image, prompt: 'something [[fake:reject]]', enhance: false });
  await advanceStudioJobsWith(deps, { jobIds: [job.id] });
  return job;
}
async function state(): Promise<StudioState> {
  const loaded = await loadStudioState(deps, owner(), f.orgId);
  if (!loaded.ok) throw new Error(loaded.code);
  return loaded;
}
const remove = (jobId: string, viewer = owner()) => runStudioOperation(deps, viewer, 'job.delete', { organizationId: f.orgId, jobId });
const row = async (jobId: string) =>
  (await f.sql.query<{ status: string; deleted_at: unknown; error_code: string | null }>('select status, deleted_at, error_code from brand_studio_jobs where id = $1', [jobId])).rows[0];

describe('job.delete', () => {
  it('takes a failed run off the wall and keeps its row', async () => {
    const job = await failed();
    const before = await state();
    expect(before.canRemoveRuns).toBe(true);
    expect(before.jobs.map((j) => j.id)).toContain(job.id);

    expect(await remove(job.id)).toEqual({ ok: true });
    expect((await state()).jobs.map((j) => j.id)).not.toContain(job.id);
    // Never a hard delete: the run, its status and its reason are still on record.
    const kept = await row(job.id);
    expect(kept).toMatchObject({ status: 'failed', error_code: 'provider_rejected' });
    expect(kept!.deleted_at).not.toBeNull();
    expect((await f.sql.query('select count(*)::int as n from brand_studio_outputs where job_id = $1', [job.id])).rows[0]).toEqual({ n: 1 });
    // Pressing it twice is the same answer.
    expect(await remove(job.id)).toEqual({ ok: true });
  });

  it('removes a stopped run too', async () => {
    const job = await create(image);
    expect(await cancelStudioJob(deps, owner(), { organizationId: f.orgId, jobId: job.id })).toEqual({ ok: true });
    expect(await remove(job.id)).toEqual({ ok: true });
    expect((await row(job.id))!.deleted_at).not.toBeNull();
    expect((await state()).jobs).toHaveLength(0);
  });

  it('refuses a run that is still open or has results: those go through their results', async () => {
    const open = await create(image);
    expect(await remove(open.id)).toMatchObject({ ok: false, code: 'conflict' });
    await advanceStudioJobsWith(deps, { jobIds: [open.id] });
    expect(await remove(open.id)).toMatchObject({ ok: false, code: 'conflict' });
    expect((await row(open.id))!.deleted_at).toBeNull();
    // What it used stays counted, whatever is removed from the wall.
    const used = (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;
    expect(used).toBeGreaterThan(0);
    const gone = await failed();
    await remove(gone.id);
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(used);
  });

  it('is for owners and editors of that organization only', async () => {
    const job = await failed();
    expect(await remove(job.id, viewerOf(f.ids.viewer))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await remove(job.id, viewerOf(f.ids.outsider))).toMatchObject({ ok: false });
    expect((await row(job.id))!.deleted_at).toBeNull();
    const other = await studioFixture();
    try {
      const theirs = studioDeps(other.sql);
      expect(await runStudioOperation(theirs, viewerOf(other.ids.owner), 'job.delete', { organizationId: other.orgId, jobId: job.id })).toMatchObject({ ok: false, code: 'not_found' });
    } finally {
      await other.db.close();
    }
    expect(await remove(job.id, viewerOf(f.ids.editor))).toEqual({ ok: true });
  });

  it('behaves as before until the migration is applied: nothing is filtered and removal is not offered', async () => {
    const job = await failed();
    await f.sql.query('alter table brand_studio_jobs drop column deleted_at');
    resetJobSoftDeleteProbe();
    const loaded = await state();
    expect(loaded.canRemoveRuns).toBe(false);
    expect(loaded.jobs.map((j) => j.id)).toContain(job.id);
    expect(await remove(job.id)).toMatchObject({ ok: false, code: 'feature_unavailable' });
    const poll = await pollStudioJobs(deps, owner(), f.orgId, [job.id]);
    expect(poll.ok && poll.jobs[0]).toMatchObject({ id: job.id, status: 'failed' });
    // Once the column is there the same process picks it up (the "absent" answer is not kept for long).
    await f.sql.query('alter table brand_studio_jobs add column deleted_at timestamptz');
    resetJobSoftDeleteProbe();
    expect((await state()).canRemoveRuns).toBe(true);
    expect(await remove(job.id)).toEqual({ ok: true });
  });
});

describe('a sentence the customer read before sending', () => {
  async function view(id: string): Promise<StudioJobView> {
    const poll = await pollStudioJobs(deps, owner(), f.orgId, [id]);
    if (!poll.ok) throw new Error(poll.code);
    return poll.jobs[0]!;
  }

  it('is sent as it is: prompt stays the customer words, final_prompt is the sentence, nothing is rewritten again', async () => {
    const job = await create({ ...image, enhance: false, reviewedPrompt: 'A clear glass bottle on wet black stone, soft morning light' });
    expect(job).toMatchObject({ prompt: 'a glass bottle on wet stone', reviewed: true });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(sent[0]!.body.prompt).toBe('A clear glass bottle on wet black stone, soft morning light');
    expect(deps.intel.calls.enhance).toBe(0);
    const done = await view(job.id);
    expect(done).toMatchObject({
      status: 'succeeded',
      prompt: 'a glass bottle on wet stone',
      finalPrompt: 'A clear glass bottle on wet black stone, soft morning light',
      reviewed: true,
    });
    const stored = (await f.sql.query<{ prompt: string; final_prompt: string; enhance: boolean }>('select prompt, final_prompt, enhance from brand_studio_jobs where id = $1', [job.id])).rows[0];
    expect(stored).toEqual({ prompt: 'a glass bottle on wet stone', final_prompt: 'A clear glass bottle on wet black stone, soft morning light', enhance: false });
  });

  it('wins over the rewrite switch, and works for a plain video', async () => {
    const still = await create({ ...image, enhance: true, reviewedPrompt: 'A clear glass bottle, studio light' });
    const film = await create({ kind: 'video', model: 'seedance-2.5', prompt: '병이 천천히 돈다', aspect: '9:16', resolution: '480p', seconds: 5, reviewedPrompt: 'The bottle turns slowly on a turntable.' });
    await advanceStudioJobsWith(deps, { jobIds: [still.id, film.id] });
    expect(deps.intel.calls.enhance).toBe(0);
    expect(await view(still.id)).toMatchObject({ prompt: 'a glass bottle on wet stone', finalPrompt: 'A clear glass bottle, studio light', reviewed: true });
    expect(await view(film.id)).toMatchObject({ prompt: '병이 천천히 돈다', finalPrompt: 'The bottle turns slowly on a turntable.', reviewed: true });
  });

  it('is an ordinary run when the sentence is the customer words, and refuses an empty one', async () => {
    const same = await create({ ...image, enhance: false, reviewedPrompt: 'a glass bottle on wet stone' });
    expect(same.reviewed).toBeUndefined();
    await advanceStudioJobsWith(deps, { jobIds: [same.id] });
    expect((await view(same.id)).finalPrompt).toBeNull();
    const stored = (await f.sql.query<{ params: Record<string, unknown> }>('select params from brand_studio_jobs where id = $1', [same.id])).rows[0]!;
    expect(stored.params).not.toHaveProperty('reviewedPrompt');
    const empty = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...image, reviewedPrompt: '   ' });
    expect(empty).toMatchObject({ ok: false, code: 'invalid' });
  });
});
