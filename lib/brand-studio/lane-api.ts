/**
 * The account lane's side of the wire (docs/BRAND-STUDIO-V2.md §7): the workstation worker
 * (scripts/brand-studio-lane-worker.mjs, slice S4) calls POST /api/brand-studio/lane with
 * `Authorization: Bearer $BRAND_STUDIO_LANE_SECRET` and one of:
 *
 *   { op: 'heartbeat', info? }                          -> { ok, now }
 *   { op: 'claim', limit? }                             -> { ok, jobs: LaneJob[] }  (also a heartbeat)
 *   { op: 'complete', jobId, outputs: [{ idx, url, mime?, seconds?, draftTaskId? }], costUsd? }
 *   { op: 'fail', jobId, code?, detail? }
 *
 * A claimed job is `running` on `sunra_mcp`; the engine leaves it alone until `complete` (results go
 * to `finishing`, the engine stores them) or `fail`. Job ids are the only handles the worker holds.
 */
import { z } from 'zod';
import { closeLane, failoverLane, recordLaneHeartbeat } from './lanes';
import { dropWorkingFiles } from './job-store';
import { studioModel } from './models';
import { requestInputOf } from './engine';
import { buildStudioRequest, type StudioRequestInput } from './provider/requests';
import { sendPrompt } from './prepare';
import type { JobRow, OutputRow, StudioDeps } from './types';

export interface LaneJob {
  jobId: string;
  kind: JobRow['kind'];
  /** The account lane's model id (models.ts `mcp.model`). */
  model: string;
  prompt: string;
  params: {
    aspect: string | null;
    resolution: string | null;
    seconds: number | null;
    audio: string | null;
    count: number;
    draft: boolean;
    method: string | null;
    keep: string[];
  };
  /** Reference files in tray order; a region edit's crop comes first. */
  inputs: Array<{ kind: 'image' | 'video' | 'audio'; url: string; frame?: 'start' | 'end'; regionCrop?: true }>;
  draftTaskId: string | null;
  /** Slots to fill, one result each. */
  outputs: Array<{ outputId: string; idx: number }>;
  /** The same run as an API-lane request body, for reference when mapping parameters. */
  apiRequest: { endpoint: string; body: Record<string, unknown> } | null;
}

const ClaimInput = z.object({ limit: z.number().int().min(1).max(20).default(4), info: z.record(z.string(), z.unknown()).optional() });
const CompleteInput = z.object({
  jobId: z.uuid(),
  outputs: z
    .array(
      z.object({
        idx: z.number().int().min(0).max(15),
        url: z.string().min(8).max(2048),
        mime: z.string().max(60).nullable().optional(),
        seconds: z.number().positive().max(600).nullable().optional(),
        draftTaskId: z.string().min(1).max(128).nullable().optional(),
      }),
    )
    .min(1)
    .max(16),
  costUsd: z.number().min(0).max(1000).optional(),
});
const FailInput = z.object({
  jobId: z.uuid(),
  code: z.enum(['provider_rejected', 'provider_unavailable', 'failed']).default('failed'),
  detail: z.string().max(1000).default(''),
});

export type LaneOutcome<T extends object = object> = ({ ok: true } & T) | { ok: false; code: 'invalid' | 'not_found' | 'conflict' };

function laneJob(deps: Pick<StudioDeps, 'media' | 'env'>, job: JobRow, outputs: OutputRow[]): LaneJob {
  const p = job.params;
  const request: StudioRequestInput = requestInputOf(deps, job);
  let apiRequest: LaneJob['apiRequest'] = null;
  try {
    apiRequest = buildStudioRequest(request);
  } catch {
    apiRequest = null;
  }
  return {
    jobId: job.id,
    kind: job.kind,
    model: studioModel(job.model)?.mcp?.model ?? job.model,
    prompt: sendPrompt(job),
    params: {
      aspect: p.aspect ?? null,
      resolution: p.resolution === 'draft' ? '480p' : (p.resolution ?? null),
      seconds: p.seconds ?? null,
      audio: p.audio ?? null,
      count: outputs.length,
      draft: p.resolution === 'draft',
      method: p.method ?? null,
      keep: p.keep ?? [],
    },
    inputs: [
      ...(request.regionCrop ? [{ kind: 'image' as const, url: request.regionCrop.url, regionCrop: true as const }] : []),
      ...(job.work.inputs ?? []).map((i) => ({ kind: i.kind, url: i.url, ...(i.frame ? { frame: i.frame } : {}) })),
    ],
    draftTaskId: job.work.draftTaskId ?? null,
    outputs: outputs.map((o) => ({ outputId: o.id, idx: o.idx })),
    apiRequest,
  };
}

export async function laneHeartbeat(deps: StudioDeps, info: unknown): Promise<LaneOutcome<{ now: string }>> {
  const now = deps.now?.() ?? new Date();
  const safe = info && typeof info === 'object' && !Array.isArray(info) ? (info as Record<string, unknown>) : {};
  await recordLaneHeartbeat(deps.sql, 'sunra_mcp', safe, now);
  return { ok: true, now: now.toISOString() };
}

export async function laneClaim(deps: StudioDeps, raw: unknown): Promise<LaneOutcome<{ jobs: LaneJob[] }>> {
  const parsed = ClaimInput.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, code: 'invalid' };
  await laneHeartbeat(deps, parsed.data.info);
  const claimed = await deps.sql.transaction(async (sql) => {
    const jobs = (
      await sql.query<JobRow>(
        `select * from brand_studio_jobs where lane = 'sunra_mcp' and status = 'queued' and (work ->> 'prepared') = 'true'
          order by created_at, id limit $1 for update skip locked`,
        [parsed.data.limit],
      )
    ).rows;
    if (jobs.length === 0) return [];
    const ids = jobs.map((j) => j.id);
    await sql.query("update brand_studio_jobs set status = 'running', started_at = now() where id = any($1::uuid[])", [ids]);
    const outputs = (await sql.query<OutputRow>("select * from brand_studio_outputs where job_id = any($1::uuid[]) and status = 'pending' order by idx", [ids])).rows;
    return jobs.map((job) => laneJob(deps, job, outputs.filter((o) => o.job_id === job.id)));
  });
  return { ok: true, jobs: claimed };
}

export async function laneComplete(deps: StudioDeps, raw: unknown): Promise<LaneOutcome<{ jobId: string }>> {
  const parsed = CompleteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  return deps.sql.transaction(async (sql) => {
    const job = (await sql.query<JobRow>('select * from brand_studio_jobs where id = $1 for update', [v.jobId])).rows[0];
    if (!job || job.lane !== 'sunra_mcp') return { ok: false as const, code: 'not_found' as const };
    if (job.status !== 'running') return { ok: false as const, code: 'conflict' as const };
    const slots = (await sql.query<OutputRow>("select idx from brand_studio_outputs where job_id = $1 and status = 'pending'", [job.id])).rows.map((o) => o.idx);
    const results = { ...(job.work.results ?? {}) };
    const share = v.costUsd !== undefined ? v.costUsd / Math.max(1, v.outputs.length) : null;
    for (const o of v.outputs) {
      if (!slots.includes(o.idx)) continue;
      results[String(o.idx)] = { url: o.url, mime: o.mime ?? null, seconds: o.seconds ?? null, costUsd: share, draftTaskId: o.draftTaskId ?? null };
    }
    await sql.query("update brand_studio_jobs set status = 'finishing', work = $2::jsonb, claimed_at = null where id = $1", [job.id, JSON.stringify({ ...job.work, results })]);
    return { ok: true as const, jobId: job.id };
  });
}

export async function laneFail(deps: StudioDeps, raw: unknown): Promise<LaneOutcome<{ jobId: string }>> {
  const parsed = FailInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  const outcome = await deps.sql.transaction(async (sql) => {
    const job = (await sql.query<JobRow>('select * from brand_studio_jobs where id = $1 for update', [v.jobId])).rows[0];
    if (!job || job.lane !== 'sunra_mcp') return { ok: false as const, code: 'not_found' as const };
    if (job.status !== 'running' && job.status !== 'queued') return { ok: false as const, code: 'conflict' as const };
    if (v.code === 'provider_unavailable') {
      // The account could not take it (no credits, account trouble): close the lane for a while and
      // hand the job to the API lane when it can run there; a final, or nowhere left to go, fails.
      const now = deps.now?.() ?? new Date();
      await closeLane(sql, 'sunra_mcp', now);
      deps.log?.('studio_lane_closed', { lane: 'sunra_mcp', jobId: job.id });
      const model = studioModel(job.model);
      const next = model
        ? await failoverLane(sql, {
            from: 'sunra_mcp', kind: job.kind, tried: job.work.triedLanes ?? [], organizationId: job.organization_id, model,
            defaultLane: deps.env.defaultLane, caps: deps.env.caps, apiUp: deps.env.apiConfigured && deps.provider !== null, now,
            createdAt: job.created_at instanceof Date ? job.created_at.toISOString() : String(job.created_at), id: job.id,
          })
        : ({ action: 'fail' } as const);
      if (next.action === 'route') {
        deps.log?.('studio_lane_rerouted', { jobId: job.id, from: 'sunra_mcp', to: next.lane });
        await sql.query(
          `update brand_studio_jobs set status = $2, lane = $3, started_at = null, claimed_at = null, attempts = 0, work = $4::jsonb where id = $1`,
          [job.id, next.lane ? 'queued' : 'held', next.lane, JSON.stringify({ ...job.work, triedLanes: next.tried })],
        );
        return { ok: true as const, jobId: job.id, work: null };
      }
    }
    await sql.query(
      "update brand_studio_jobs set status = 'failed', error_code = $2, error_detail = $3, usage_krw = 0, finished_at = now() where id = $1",
      [job.id, v.code, `lane: ${v.detail}`.slice(0, 1000)],
    );
    await sql.query("update brand_studio_outputs set status = 'failed' where job_id = $1 and status = 'pending'", [job.id]);
    if (v.code === 'provider_unavailable' && /credit|balance|insufficient/i.test(v.detail)) deps.log?.('studio_provider_balance', { lane: 'sunra_mcp' });
    return { ok: true as const, jobId: job.id, work: job.work };
  });
  if (!outcome.ok) return outcome;
  await dropWorkingFiles(deps.media, outcome.work);
  return { ok: true, jobId: outcome.jobId };
}
