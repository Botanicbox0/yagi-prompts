import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { laneClaim, laneComplete } from '@/lib/brand-studio/lane-api';
import { recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import { estimateVideoUsd, studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { followsReferenceLength, isDraftRun } from '@/lib/brand-studio/reference-video';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import type { JobRow } from '@/lib/brand-studio/types';
import { remixRunUsd, usageKrw } from '@/lib/brand-studio/usage-rate';
import { requestId, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * A 480p draft is the only run a 1080p final can be made from (docs.sunra.ai, "Draft mode"). A run that
 * follows its reference video's length (`duration: -1`: an edit, or a new take whose length was not picked)
 * is never one, on either lane: the account lane's CLI refuses it as a preview, and the API lane's behaviour
 * is undocumented and untested. Such a run is the standard 480p run at the draft's price, and its result
 * never offers "finish at 1080p". A result is a draft only when its run was planned as one and a draft id
 * came back for it.
 */
const model = studioModel('seedance-2.5') as StudioVideoModel;
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let sent: StudioProviderRequest[];

beforeEach(async () => {
  f = await studioFixture({ capKrw: 5_000_000 });
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
const stored = async (id: string) => (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;
const draftColumns = async (jobId: string) =>
  (await f.sql.query<{ is_draft: boolean; draft_task_id: string | null }>('select is_draft, draft_task_id from brand_studio_outputs where job_id = $1', [jobId])).rows[0]!;
const finish = (draftOutputId: string) => createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), kind: 'video_final', draftOutputId });
const accountLane = async () => {
  await recordLaneHeartbeat(f.sql, 'sunra_mcp', { host: 'test' });
  await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
};
const edit = (film: string) => ({
  kind: 'video_remix', model: 'seedance-2.5', prompt: '병을 파란색으로', change: '병 색', method: 'edit', keep: [],
  aspect: '9:16', resolution: 'draft', audio: 'native', references: [{ assetId: film }],
});
const plainDraft = { kind: 'video', model: 'seedance-2.5', prompt: 'slow push in on a bottle', aspect: '9:16', seconds: 5, audio: 'native', resolution: 'draft' };

describe('the rule', () => {
  it('a draft is asked for as one and has a length of its own', () => {
    expect(isDraftRun('video', { resolution: 'draft', seconds: 5 })).toBe(true);
    expect(isDraftRun('video', { resolution: '480p', seconds: 5 })).toBe(false);
    expect(isDraftRun('video_remix', { resolution: 'draft', method: 'reference', seconds: 8 })).toBe(true);
    expect(isDraftRun('video_remix', { resolution: 'draft', method: 'blueprint', seconds: 6 })).toBe(true);
    // Following the reference's length: an edit, or a new take whose length was not picked.
    expect(followsReferenceLength('video_remix', { method: 'edit', seconds: null })).toBe(true);
    expect(followsReferenceLength('video_remix', { method: 'reference', seconds: null })).toBe(true);
    expect(isDraftRun('video_remix', { resolution: 'draft', method: 'edit', seconds: null })).toBe(false);
    expect(isDraftRun('video_remix', { resolution: 'draft', method: 'reference', seconds: null })).toBe(false);
    expect(isDraftRun('video_final', { resolution: 'draft', seconds: 5 })).toBe(false);
    expect(isDraftRun('image', { resolution: 'draft' })).toBe(false);
  });
});

describe('an edit asked for as a draft', () => {
  it('is planned and sent (API lane) as the standard 480p run, at the draft price, and offers no final', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(edit(film));
    expect(job.estimateKrw).toBe(usageKrw(remixRunUsd({ model, resolution: 'draft', method: 'edit', seconds: null, referenceSeconds: 6 }).usd, 'video'));
    expect((await stored(job.id)).params).toMatchObject({ method: 'edit', resolution: '480p', seconds: null });
    expect(await draftColumns(job.id)).toEqual({ is_draft: false, draft_task_id: null });

    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(sent.at(-1)!.body).toMatchObject({ resolution: '480p', duration: -1, draft: false, omni_reference_task_type: 'edit' });
    const done = await view(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs[0]!.draft).toBe(false);
    expect(await finish(done.outputs[0]!.id)).toEqual({ ok: false, code: 'not_found' });
  });

  it('is handed to the account lane as no draft, and a draft id the worker reports for it anyway is dropped', async () => {
    await accountLane();
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(edit(film));
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const claimed = await laneClaim(deps, { limit: 1 });
    if (!claimed.ok) throw new Error(claimed.code);
    const lane = claimed.jobs[0]!;
    expect(lane).toMatchObject({ jobId: job.id, kind: 'video_remix', params: { resolution: '480p', draft: false, method: 'edit', seconds: null } });
    // The worker needs the video's type to upload it where the account lane accepts it.
    expect(lane.inputs.filter((i) => i.kind === 'video')).toEqual([{ kind: 'video', url: expect.any(String), mime: 'video/mp4' }]);

    // Worker version 1 reported the task id as a draft id whenever the job had been asked for as a draft.
    expect(await laneComplete(deps, { jobId: job.id, outputs: [{ idx: 0, url: 'fake://video/a', draftTaskId: 'task-not-a-preview' }] })).toEqual({ ok: true, jobId: job.id });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const done = await view(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs[0]!.draft).toBe(false);
    expect(await draftColumns(job.id)).toEqual({ is_draft: false, draft_task_id: null });
    expect(await finish(done.outputs[0]!.id)).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('a new take with a reference video', () => {
  it('is a draft with a length of its own, and not one when it follows the reference', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const take = (extra: Record<string, unknown>) => create({ ...edit(film), method: 'reference', keep: ['camera'], ...extra });
    const own = await take({ seconds: 8 });
    expect((await stored(own.id)).params).toMatchObject({ resolution: 'draft', seconds: 8 });
    expect((await draftColumns(own.id)).is_draft).toBe(true);
    const follows = await take({});
    expect((await stored(follows.id)).params).toMatchObject({ resolution: '480p', seconds: null });
    expect((await draftColumns(follows.id)).is_draft).toBe(false);
  });
});

describe('a real draft', () => {
  it('keeps the draft id the account lane reports and can be finished', async () => {
    await accountLane();
    const job = await create(plainDraft);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const claimed = await laneClaim(deps, { limit: 1 });
    if (!claimed.ok) throw new Error(claimed.code);
    expect(claimed.jobs[0]).toMatchObject({ params: { resolution: '480p', draft: true, seconds: 5 } });
    await laneComplete(deps, { jobId: job.id, outputs: [{ idx: 0, url: 'fake://video/a', draftTaskId: 'preview-1' }] });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const done = await view(job.id);
    expect(done.outputs[0]!.draft).toBe(true);
    expect(await draftColumns(job.id)).toEqual({ is_draft: true, draft_task_id: 'preview-1' });
    expect(await finish(done.outputs[0]!.id)).toMatchObject({ ok: true, job: { kind: 'video_final' } });
  });

  it('is finished at 1080p with its source counted for its exact length (15,042 ms, not the 15.0 shown)', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    await f.sql.query('update brand_studio_assets set duration_ms = 15042 where id = $1', [film]);
    const draft = await create({ ...edit(film), method: 'reference', keep: ['camera'], seconds: 8 });
    expect((await stored(draft.id)).params).toMatchObject({ resolution: 'draft', referenceVideoSeconds: 15.042 });
    await advanceStudioJobsWith(deps, { jobIds: [draft.id] });
    const done = await view(draft.id);
    expect(done.outputs[0]!.draft).toBe(true);
    const final = await finish(done.outputs[0]!.id);
    if (!final.ok) throw new Error(final.code);
    expect(final.job.estimateKrw).toBe(usageKrw(estimateVideoUsd({ resolution: '1080p', seconds: 8, referenceVideoSeconds: 15.042 }), 'video'));
  });

  it('is the only result that stores a draft id, whatever a provider reports', async () => {
    // A provider that names a draft id for every video it finishes: a 720p run still is no draft.
    const status = deps.provider.status.bind(deps.provider);
    deps.provider.status = async (taskId) => {
      const answer = await status(taskId);
      return answer.state === 'succeeded' ? { ...answer, draftTaskId: `odd-${taskId}` } : answer;
    };
    const job = await create({ ...plainDraft, resolution: '720p' });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const done = await view(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs[0]!.draft).toBe(false);
    expect(await draftColumns(job.id)).toEqual({ is_draft: false, draft_task_id: null });
  });
});
