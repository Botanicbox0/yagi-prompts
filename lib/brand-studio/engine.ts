/**
 * The job state machine (docs/BRAND-STUDIO-V2.md §7):
 *
 *   (created) -> queued     a lane had a free slot at creation (./jobs.ts), else the job starts `held`
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
import { hasTables } from '@/lib/brands/billing/schema-guard';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { planBlockRetry } from './block-retry';
import { failJob, finishJob } from './finish';
import { claimJobs, releaseJob, saveJob, tokenOf, failPendingOutputs } from './job-store';
import { closeLane, failoverLane, heartbeatFresh, lanesUp, loadLaneClosures, loadLaneHeartbeats, routeJob } from './lanes';
import { studioModel, type StudioLane, type StudioModel } from './models';
import { MUSIC_WAIT_CEILING_MS, musicEngineOfModel } from './sound/engine';
import { isV2MusicJob } from './sound/v2-job';
import { minimaxLyricsFailureReason } from './sound/prepare-music';
import { PrepareFailure, prepareJob, providerUrl, sendPrompt } from './prepare';
import { buildStudioRequest, StudioRequestError, type StudioRequestInput } from './provider/requests';
import { StudioProviderError } from './provider/types';
import type { JobRow, OutputRow, StudioDeps } from './types';

const MAX_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowOf = (deps: StudioDeps) => deps.now?.() ?? new Date();

function waitedPast(job: JobRow, now: Date, ms: number): boolean {
  const since = job.started_at ?? job.created_at;
  const at = since instanceof Date ? since.getTime() : Date.parse(String(since));
  return Number.isFinite(at) && now.getTime() - at > ms;
}

/** What the lane router needs of a job's model: a studio model, or a music engine (API lane only, `mcp: null`). */
function laneModelOf(id: string): Pick<StudioModel, 'mcp'> | null {
  return studioModel(id) ?? musicEngineOfModel(id)?.model ?? null;
}

function musicV2RequestInputOf(deps: Pick<StudioDeps, 'media' | 'env'>, job: JobRow): StudioRequestInput {
  const inputs = job.work.inputs ?? [];
  const region = job.work.region;
  const draftedLyrics =
    job.work.enhancer && 'lyrics' in job.work.enhancer && job.work.enhancer.lyrics !== undefined
      ? job.work.enhancer.lyrics
      : job.work.minimaxDraft?.lyrics;
  return {
    kind: job.kind,
    model: job.model,
    prompt: sendPrompt(job),
    customerPrompt: job.prompt,
    params: job.params,
    images: inputs.filter((i) => i.kind === 'image').map((i) => ({ url: i.url, ...(i.frame ? { frame: i.frame } : {}) })),
    videos: inputs.filter((i) => i.kind === 'video').map((i) => ({ url: i.url })),
    audios: inputs.filter((i) => i.kind === 'audio').map((i) => ({ url: i.url })),
    regionCrop: region ? { url: providerUrl(deps, deps.media.url(region.cropKey)), aspect: region.plan.aspect } : null,
    draftTaskId: job.work.draftTaskId ?? null,
    ...(job.work.enhancer && 'title' in job.work.enhancer ? { designedTitle: job.work.enhancer.title ?? null } : {}),
    ...(draftedLyrics !== undefined ? { draftedLyrics: draftedLyrics ?? null } : {}),
  };
}

export function requestInputOf(deps: Pick<StudioDeps, 'media' | 'env'>, job: JobRow): StudioRequestInput {
  if (isV2MusicJob(job)) return musicV2RequestInputOf(deps, job);
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
    ...(job.kind === 'music' && job.work.enhancer && 'title' in job.work.enhancer ? { designedTitle: job.work.enhancer.title ?? null } : {}),
  };
}

async function laneUpNow(deps: StudioDeps): Promise<Record<StudioLane, boolean>> {
  return lanesUp({
    apiConfigured: deps.env.apiConfigured && deps.provider !== null,
    heartbeats: await loadLaneHeartbeats(deps.sql),
    now: nowOf(deps),
    closedUntil: await loadLaneClosures(deps.sql),
  });
}

/**
 * The API lane's account could not pay: close the lane for a while and move the job, prepared as it is,
 * to the account lane (or hold it there), unless it is a final or has nowhere left to go (./lanes.ts
 * `failoverLane`). The customer only ever sees the usual progress line.
 */
async function failover(deps: StudioDeps, job: JobRow, token: string, detail: string): Promise<JobRow | null> {
  const now = nowOf(deps);
  await closeLane(deps.sql, 'sunra_api', now);
  deps.log?.('studio_lane_closed', { lane: 'sunra_api', jobId: job.id });
  const model = laneModelOf(job.model);
  const next = model
    ? await failoverLane(deps.sql, {
        from: 'sunra_api',
        kind: job.kind,
        tried: job.work.triedLanes ?? [],
        organizationId: job.organization_id,
        model,
        defaultLane: deps.env.defaultLane,
        caps: deps.env.caps,
        apiUp: deps.env.apiConfigured && deps.provider !== null,
        now,
        createdAt: job.created_at instanceof Date ? job.created_at.toISOString() : String(job.created_at),
        id: job.id,
      })
    : ({ action: 'fail' } as const);
  if (next.action === 'fail') return failJob(deps, job, token, 'provider_unavailable', detail);
  deps.log?.('studio_lane_rerouted', { jobId: job.id, from: 'sunra_api', to: next.lane });
  return saveJob(deps.sql, job, token, { status: next.lane ? 'queued' : 'held', lane: next.lane, attempts: 0, work: { ...job.work, triedLanes: next.tried } });
}

async function route(deps: StudioDeps, job: JobRow, token: string): Promise<JobRow | null> {
  const model = laneModelOf(job.model);
  if (!model) return failJob(deps, job, token, 'failed', `unknown model ${job.model}`);
  const lane = await routeJob(deps.sql, {
    organizationId: job.organization_id,
    model,
    defaultLane: deps.env.defaultLane,
    caps: deps.env.caps,
    apiUp: deps.env.apiConfigured && deps.provider !== null,
    now: nowOf(deps),
    stick: job.kind === 'video_final' ? (job.work.stickLane ?? 'sunra_api') : null,
    place: { createdAt: job.created_at instanceof Date ? job.created_at.toISOString() : String(job.created_at), id: job.id },
    exclude: job.work.triedLanes ?? [],
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
    if (failure.reason === 'balance' && inFlight === 0) return failover(deps, job, token, failure.detail);
    if (failure.retryable && job.attempts + 1 < MAX_ATTEMPTS) {
      await saveJob(deps.sql, job, token, { attempts: job.attempts + 1 });
      return null;
    }
    if (inFlight === 0 && failure.code === 'provider_rejected') {
      const retry = await planBlockRetry(deps, job);
      if (retry) return saveJob(deps.sql, job, token, { final_prompt: retry.finalPrompt, attempts: 0, work: retry.work });
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
      // One music request answers with one or more versions: keep them all (finishing gives each a row).
      if (job.kind === 'music') {
        if (first.meta) results[key]!.meta = first.meta;
        results[key]!.versions = status.outputs.map((o) => ({ url: o.url, mime: o.mime, seconds: o.seconds ?? null, ...(o.meta ? { meta: o.meta } : {}) }));
      }
    }
  }
  let done = outputs.every((o) => results[String(o.idx)] || failures[String(o.idx)]);
  // Music has a ceiling of its own (sound/engine.ts): an answer still missing after it fails the run, which then
  // settles at nothing. An answer already there when we look was taken above.
  if (!done && job.kind === 'music' && waitedPast(job, nowOf(deps), MUSIC_WAIT_CEILING_MS)) {
    for (const o of outputs) {
      const key = String(o.idx);
      if (results[key] || failures[key]) continue;
      failures[key] = { code: 'failed', detail: 'no answer within the music ceiling (10 minutes)' };
      if (o.provider_task_id) await provider.cancel?.(o.provider_task_id).catch(() => undefined);
    }
    deps.log?.('studio_music_ceiling', { jobId: job.id });
    changed = true;
    done = true;
  }
  if (!changed && !done) return null;
  // Every result was stopped by the safety review and nothing came back: one retry with the wording
  // looked over (lib/brand-studio/block-retry.ts). The retry is reviewed again like any other run.
  if (done && outputs.length > 0 && Object.keys(results).length === 0 && outputs.every((o) => failures[String(o.idx)]?.code === 'provider_rejected')) {
    const retry = await planBlockRetry(deps, job);
    if (retry) {
      await deps.sql.query("update brand_studio_outputs set provider_task_id = null where job_id = $1 and status = 'pending'", [job.id]);
      return saveJob(deps.sql, job, token, { status: 'queued', final_prompt: retry.finalPrompt, attempts: 0, work: retry.work });
    }
  }
  const saved = await saveJob(deps.sql, job, token, { work: { ...job.work, results, failures }, ...(done ? { status: 'finishing' as const } : {}) });
  return done ? saved : null;
}

async function failMinimaxLyricsPrepare(deps: StudioDeps, job: JobRow, token: string, error: PrepareFailure): Promise<JobRow | null> {
  const reason = minimaxLyricsFailureReason(error.detail);
  if (!reason) return failJob(deps, job, token, error.code, error.detail);
  const marked = await saveJob(deps.sql, job, token, { work: { ...job.work, lyricsDraftFailed: reason } });
  if (!marked) return null;
  return failJob(deps, marked, token, error.code, error.detail);
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
          if (error instanceof PrepareFailure && minimaxLyricsFailureReason(error.detail)) return failMinimaxLyricsPrepare(deps, job, token, error);
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
      const finished = await finishJob(deps, job, token);
      return finished?.status === 'queued' ? finished : null;
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

async function releaseStaleStudioLeases(sql: SqlRunner, nowIso: string): Promise<number> {
  return (
    await sql.query(
      "update brand_studio_jobs set claimed_at = null where claimed_at < $1::timestamptz - interval '10 minutes' returning id",
      [nowIso],
    )
  ).rows.length;
}

async function expireStaleJobRows(
  sql: SqlRunner,
  options: { nowIso: string; includeAccountLaneIdle: boolean; mcpUp: boolean; errorDetail: string },
): Promise<number> {
  const expiredRows = (
    await sql.query<{ id: string }>(
      `update brand_studio_jobs set status = 'failed', error_code = 'provider_unavailable', error_detail = $3,
              usage_krw = 0, finished_at = $2::timestamptz
        where claimed_at is null and (
              (status in ('held','queued') and created_at < $2::timestamptz - interval '24 hours')
           or (status in ('running','finishing') and coalesce(started_at, created_at) < $2::timestamptz - interval '6 hours')
           or ($4::boolean = true and status = 'running' and lane = 'sunra_mcp' and $1::boolean = false and coalesce(started_at, created_at) < $2::timestamptz - interval '30 minutes'))
        returning id`,
      [options.mcpUp, options.nowIso, options.errorDetail, options.includeAccountLaneIdle],
    )
  ).rows;
  for (const row of expiredRows) await failPendingOutputs(sql, row.id);
  return expiredRows.length;
}

/**
 * Idempotent reservation expiry pass for the 10-minute notices cron (deploy-order safe):
 * frees leases older than 10 minutes and expires ONLY queued jobs > 24 h and running/finishing
 * jobs > 6 h (releasing reserved allowance with `usage_krw = 0`). The 30-minute idle account-lane
 * heuristic stays strictly in the daily sweep (`sweepStudio`) so transient heartbeat gaps never kill
 * a healthy running account-lane video job.
 */
export async function expireStaleStudioReservations(
  sql: SqlRunner,
  now: Date = new Date(),
): Promise<{ released: number; expired: number }> {
  if (!(await hasTables(sql, ['brand_studio_jobs', 'brand_studio_outputs']))) {
    return { released: 0, expired: 0 };
  }
  const nowIso = now.toISOString();
  const released = await releaseStaleStudioLeases(sql, nowIso);
  const expired = await expireStaleJobRows(sql, {
    nowIso,
    includeAccountLaneIdle: false,
    mcpUp: true,
    errorDetail: 'expired by the 10-minute reservation sweep',
  });
  return { released, expired };
}

/**
 * The daily sweep (brand-side cron): free leases left by a crashed invocation, move work off a
 * silent account lane, expire what can no longer finish, then advance what is left.
 */
export async function sweepStudio(deps: StudioDeps): Promise<{ released: number; rerouted: number; expired: number; advanced: number }> {
  const sql = deps.sql;
  const now = nowOf(deps);
  const nowIso = now.toISOString();
  const released = await releaseStaleStudioLeases(sql, nowIso);
  const mcpUp = heartbeatFresh((await loadLaneHeartbeats(sql)).sunra_mcp, now);
  const rerouted = mcpUp
    ? 0
    : (
        await sql.query(
          `update brand_studio_jobs set status = 'held', lane = null
            where lane = 'sunra_mcp' and status = 'queued' and kind <> 'video_final' and claimed_at is null returning id`,
        )
      ).rows.length;
  const expired = await expireStaleJobRows(sql, {
    nowIso,
    includeAccountLaneIdle: true,
    mcpUp,
    errorDetail: 'expired by the daily sweep',
  });
  // Uploads reserved but never completed hold a library slot; after a day they let it go.
  await sql.query("delete from brand_studio_assets where status = 'pending' and deleted_at is null and created_at < now() - interval '1 day'");
  // Kept small: this rides the brand-side daily cron (60 s); polls and the webhook do the real work.
  const { advanced } = await advanceStudioJobsWith(deps, { limit: 5 });
  return { released, rerouted, expired, advanced };
}
