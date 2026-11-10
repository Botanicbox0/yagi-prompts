/**
 * The job state machine (docs/BRAND-STUDIO-V2.md §7):
 *
 *   held      -> queued     a lane has a free slot (preferred, else the other; a final keeps its draft's lane)
 *   queued    -> queued     prepared: references re-resolved, film read, crop cut, prompt enhanced
 *   queued    -> running    API lane: every slot submitted (the account-lane worker claims instead)
 *   running   -> finishing  every slot has a provider result or a failure
 *   finishing -> succeeded | failed   results stored, usage settled
 *
 * `advanceStudioJobsWith` takes a lease on each job it moves (`claimed_at`, `for update skip locked`),
 * so two invocations (after(), a poll, the webhook, the daily sweep) never advance the same job.
 * Everything that can wait returns: nothing here sleeps.
 */
import { STUDIO_JOB_OPEN_STATUSES } from './contracts';
import { failJob, finishJob } from './finish';
import { claimJobs, releaseJob, saveJob, tokenOf, failPendingOutputs } from './job-store';
import { heartbeatFresh, laneLoad, lanesUp, loadLaneHeartbeats, pickLane } from './lanes';
import { studioModel, type StudioLane } from './models';
import { PrepareFailure, prepareJob, providerUrl, sendPrompt } from './prepare';
import { buildStudioRequest, StudioRequestError, type StudioRequestInput } from './provider/requests';
import { StudioProviderError } from './provider/types';
import type { JobRow, OutputRow, StudioDeps } from './types';

const MAX_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowOf = (deps: StudioDeps) => deps.now?.() ?? new Date();

export function requestInputOf(deps: Pick<StudioDeps, 'media' | 'env'>, job: JobRow): StudioRequestInput {
  const inputs = job.work.inputs ?? [];
  const region = job.work.region;
  return {
    kind: job.kind,
    model: job.model,
    prompt: sendPrompt(job),
    params: job.params,
    images: inputs.filter((i) => i.kind === 'image').map((i) => ({ url: i.url, ...(i.frame ? { frame: i.frame } : {}) })),
    videos: inputs.filter((i) => i.kind === 'video').map((i) => ({ url: i.url })),
    audios: inputs.filter((i) => i.kind === 'audio').map((i) => ({ url: i.url })),
    regionCrop: region ? { url: providerUrl(deps, deps.media.url(region.cropKey)), aspect: region.plan.aspect } : null,
    draftTaskId: job.work.draftTaskId ?? null,
  };
}

async function laneUpNow(deps: StudioDeps): Promise<Record<StudioLane, boolean>> {
  return lanesUp({
    apiConfigured: deps.env.apiConfigured && deps.provider !== null,
    heartbeats: await loadLaneHeartbeats(deps.sql),
    now: nowOf(deps),
  });
}

async function route(deps: StudioDeps, job: JobRow, token: string): Promise<JobRow | null> {
  const model = studioModel(job.model);
  if (!model) return failJob(deps, job, token, 'failed', `unknown model ${job.model}`);
  const pref = (await deps.sql.query<{ preferred_lane: StudioLane | null }>('select preferred_lane from brand_studio_allowances where organization_id = $1', [job.organization_id])).rows[0]?.preferred_lane;
  const counts = await laneLoad(deps.sql);
  // First come, first served: older held jobs are ahead in the line on whichever lane frees up.
  const ahead = Number(
    (
      await deps.sql.query<{ n: number }>(
        "select count(*)::int as n from brand_studio_jobs where status = 'held' and (created_at, id) < ($1::timestamptz, $2::uuid)",
        [job.created_at instanceof Date ? job.created_at.toISOString() : job.created_at, job.id],
      )
    ).rows[0]?.n ?? 0,
  );
  const lane = pickLane({
    preferred: pref ?? deps.env.defaultLane,
    model,
    counts: { sunra_api: counts.sunra_api + ahead, sunra_mcp: counts.sunra_mcp + ahead },
    caps: deps.env.caps,
    laneUp: await laneUpNow(deps),
    stick: job.kind === 'video_final' ? (job.work.stickLane ?? 'sunra_api') : null,
  });
  if (!lane) return null;
  return saveJob(deps.sql, job, token, { status: 'queued', lane });
}

async function submit(deps: StudioDeps, job: JobRow, token: string): Promise<JobRow | null> {
  const provider = deps.provider;
  if (!provider) return saveJob(deps.sql, job, token, { status: 'held', lane: null }).then(() => null);
  let request;
  try {
    request = buildStudioRequest(requestInputOf(deps, job));
  } catch (error) {
    if (error instanceof StudioRequestError) return failJob(deps, job, token, 'failed', error.reason);
    throw error;
  }
  const outputs = (await deps.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [job.id])).rows;
  let failure: StudioProviderError | null = null;
  for (const output of outputs.filter((o) => o.status === 'pending' && !o.provider_task_id)) {
    try {
      const { taskId } = await provider.submit(request, { webhookUrl: deps.env.webhookUrl });
      await deps.sql.query('update brand_studio_outputs set provider_task_id = $2 where id = $1 and provider_task_id is null', [output.id, taskId]);
      output.provider_task_id = taskId;
    } catch (error) {
      if (!(error instanceof StudioProviderError)) throw error;
      failure = error;
      break;
    }
  }
  const inFlight = outputs.filter((o) => o.status === 'pending' && o.provider_task_id).length;
  if (failure) {
    deps.log?.('studio_submit_failed', { jobId: job.id, code: failure.code, retryable: failure.retryable, detail: failure.detail });
    if (failure.retryable && job.attempts + 1 < MAX_ATTEMPTS) {
      await saveJob(deps.sql, job, token, { attempts: job.attempts + 1 });
      return null;
    }
    if (inFlight === 0) return failJob(deps, job, token, failure.code, failure.detail);
    // Some slots are already with the provider: keep them, give up on the rest.
    const failures = { ...(job.work.failures ?? {}) };
    for (const o of outputs.filter((o) => o.status === 'pending' && !o.provider_task_id)) failures[String(o.idx)] = { code: failure.code, detail: failure.detail };
    return saveJob(deps.sql, job, token, { status: 'running', started_at: nowOf(deps).toISOString(), work: { ...job.work, failures } });
  }
  return saveJob(deps.sql, job, token, { status: 'running', started_at: nowOf(deps).toISOString(), attempts: 0 });
}

async function poll(deps: StudioDeps, job: JobRow, token: string): Promise<JobRow | null> {
  const provider = deps.provider;
  if (!provider) return null;
  const outputs = (await deps.sql.query<OutputRow>("select * from brand_studio_outputs where job_id = $1 and status = 'pending' order by idx", [job.id])).rows;
  const results = { ...(job.work.results ?? {}) };
  const failures = { ...(job.work.failures ?? {}) };
  let changed = false;
  for (const output of outputs) {
    const key = String(output.idx);
    if (results[key] || failures[key] || !output.provider_task_id) continue;
    const status = await provider.status(output.provider_task_id);
    if (status.state === 'pending') continue;
    changed = true;
    if (status.state === 'failed') failures[key] = { code: status.code, detail: status.detail };
    else {
      const first = status.outputs[0]!;
      results[key] = { url: first.url, mime: first.mime, seconds: first.seconds ?? null, costUsd: status.costUsd ?? null, draftTaskId: status.draftTaskId ?? null };
    }
  }
  const done = outputs.every((o) => results[String(o.idx)] || failures[String(o.idx)]);
  if (!changed && !done) return null;
  const saved = await saveJob(deps.sql, job, token, { work: { ...job.work, results, failures }, ...(done ? { status: 'finishing' as const } : {}) });
  return done ? saved : null;
}

/** One transition. Returns the updated row when another step may follow now, null when the job must wait. */
async function step(deps: StudioDeps, job: JobRow, token: string): Promise<JobRow | null> {
  switch (job.status) {
    case 'held':
      return route(deps, job, token);
    case 'queued': {
      if (!job.work?.prepared) {
        try {
          const prepared = await prepareJob(deps, job);
          return await saveJob(deps.sql, job, token, { final_prompt: prepared.finalPrompt, work: prepared.work });
        } catch (error) {
          if (error instanceof PrepareFailure) return failJob(deps, job, token, error.code, error.detail);
          throw error;
        }
      }
      if (job.lane === 'sunra_mcp') {
        // The worker went quiet: anything it has not started may move (a final may not: its draft lives there).
        if (job.kind !== 'video_final' && !(await laneUpNow(deps)).sunra_mcp) return saveJob(deps.sql, job, token, { status: 'held', lane: null });
        return null;
      }
      return submit(deps, job, token);
    }
    case 'running':
      return job.lane === 'sunra_api' ? poll(deps, job, token) : null;
    case 'finishing': {
      await finishJob(deps, job, token);
      return null;
    }
    default:
      return null;
  }
}

async function runLeased(deps: StudioDeps, claimed: JobRow): Promise<void> {
  const token = tokenOf(claimed);
  let job: JobRow = claimed;
  try {
    for (let i = 0; i < 8; i++) {
      const next = await step(deps, job, token);
      if (!next || !STUDIO_JOB_OPEN_STATUSES.includes(next.status)) break;
      job = next;
    }
  } catch (error) {
    deps.log?.('studio_advance_error', { jobId: job.id, status: job.status, message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    const attempts = job.attempts + 1;
    const saved = await saveJob(deps.sql, job, token, { attempts });
    if (saved && attempts >= MAX_ATTEMPTS) await failJob(deps, saved, token, 'failed', error instanceof Error ? error.message : 'advance failed');
  } finally {
    await releaseJob(deps.sql, claimed.id, token);
  }
}

export async function advanceStudioJobsWith(deps: StudioDeps, options: { jobIds?: readonly string[]; limit?: number } = {}): Promise<{ advanced: number }> {
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit ?? 10)));
  const ids = options.jobIds ? options.jobIds.filter((id) => UUID.test(id)).slice(0, 50) : null;
  if (ids && ids.length === 0) return { advanced: 0 };
  const jobs = await claimJobs(deps.sql, ids, limit);
  for (const job of jobs) await runLeased(deps, job);
  return { advanced: jobs.length };
}

/**
 * The daily sweep (brand-side cron): free leases left by a crashed invocation, move work off a
 * silent account lane, expire what can no longer finish, then advance what is left.
 */
export async function sweepStudio(deps: StudioDeps): Promise<{ released: number; rerouted: number; expired: number; advanced: number }> {
  const sql = deps.sql;
  const released = (await sql.query("update brand_studio_jobs set claimed_at = null where claimed_at < now() - interval '10 minutes' returning id")).rows.length;
  const mcpUp = heartbeatFresh((await loadLaneHeartbeats(sql)).sunra_mcp, nowOf(deps));
  const rerouted = mcpUp
    ? 0
    : (
        await sql.query(
          `update brand_studio_jobs set status = 'held', lane = null
            where lane = 'sunra_mcp' and status = 'queued' and kind <> 'video_final' and claimed_at is null returning id`,
        )
      ).rows.length;
  const expiredRows = (
    await sql.query<{ id: string; work: JobRow['work'] }>(
      `update brand_studio_jobs set status = 'failed', error_code = 'provider_unavailable', error_detail = 'expired by the daily sweep',
              usage_krw = 0, finished_at = now()
        where claimed_at is null and (
              (status in ('held','queued') and created_at < now() - interval '24 hours')
           or (status in ('running','finishing') and coalesce(started_at, created_at) < now() - interval '6 hours')
           or (status = 'running' and lane = 'sunra_mcp' and $1::boolean = false and coalesce(started_at, created_at) < now() - interval '60 minutes'))
        returning id, work`,
      [mcpUp],
    )
  ).rows;
  for (const row of expiredRows) await failPendingOutputs(sql, row.id);
  // Uploads reserved but never completed hold a library slot; after a day they let it go.
  await sql.query("delete from brand_studio_assets where status = 'pending' and deleted_at is null and created_at < now() - interval '1 day'");
  // Kept small: this rides the brand-side daily cron (60 s); polls and the webhook do the real work.
  const { advanced } = await advanceStudioJobsWith(deps, { limit: 5 });
  return { released, rerouted, expired: expiredRows.length, advanced };
}
