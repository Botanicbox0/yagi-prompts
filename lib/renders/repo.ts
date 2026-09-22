import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Locale } from '@/lib/i18n/config';
import type { TemplateMedium } from '@/lib/prompts/schemas';

/**
 * Every `render_jobs` statement, in one driver-agnostic module (the same seam as
 * `lib/campaigns/repo.ts`): the acceptance tests drive these against PGlite, the app against
 * Supabase Postgres through `pg`. No viewer here — the service decides who may see what.
 */

/** `held` = stored and waiting behind the person's face check (0020); released to `queued` by the identity callback. */
export type RenderStatus = 'held' | 'queued' | 'running' | 'succeeded' | 'failed';
export type NotifyStatus = 'pending' | 'sent' | 'skipped' | 'failed';
export type RenderProvider = 'openai' | 'modelark';

export interface RenderJob {
  id: string;
  userId: string;
  templateId: string;
  templateSlug: string;
  medium: TemplateMedium;
  engine: string;
  aspect: string;
  locale: Locale;
  status: RenderStatus;
  inputKey: string | null;
  inputMime: string | null;
  resultKey: string | null;
  resultMime: string | null;
  resultBytes: number | null;
  provider: RenderProvider | null;
  providerTaskId: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  costUsd: number | null;
  shareToken: string | null;
  shareExpiresAt: string | null;
  notifyStatus: NotifyStatus;
  notifyChannel: string;
  notifyAttempts: number;
  notifiedAt: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawRow {
  id: string;
  user_id: string;
  template_id: string;
  template_slug: string;
  medium: TemplateMedium;
  engine: string;
  aspect: string;
  locale: Locale;
  status: RenderStatus;
  input_key: string | null;
  input_mime: string | null;
  result_key: string | null;
  result_mime: string | null;
  result_bytes: number | string | null;
  provider: RenderProvider | null;
  provider_task_id: string | null;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  cost_usd: number | string | null;
  share_token: string | null;
  share_expires_at: Date | string | null;
  notify_status: NotifyStatus;
  notify_channel: string;
  notify_attempts: number;
  notified_at: Date | string | null;
  claimed_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMN_NAMES = [
  'id', 'user_id', 'template_id', 'template_slug', 'medium', 'engine', 'aspect', 'locale', 'status',
  'input_key', 'input_mime', 'result_key', 'result_mime', 'result_bytes', 'provider', 'provider_task_id',
  'attempts', 'error_code', 'error_message', 'cost_usd', 'share_token', 'share_expires_at',
  'notify_status', 'notify_channel', 'notify_attempts', 'notified_at',
  'claimed_at', 'started_at', 'finished_at', 'created_at', 'updated_at',
] as const;
const COLUMNS = COLUMN_NAMES.join(', ');
/** The same list qualified for the claim's UPDATE … FROM, where the CTE also carries an `id`. */
const J_COLUMNS = COLUMN_NAMES.map((name) => `j.${name}`).join(', ');

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toJob(raw: RawRow): RenderJob {
  return {
    id: raw.id,
    userId: raw.user_id,
    templateId: raw.template_id,
    templateSlug: raw.template_slug,
    medium: raw.medium,
    engine: raw.engine,
    aspect: raw.aspect,
    locale: raw.locale,
    status: raw.status,
    inputKey: raw.input_key,
    inputMime: raw.input_mime,
    resultKey: raw.result_key,
    resultMime: raw.result_mime,
    resultBytes: num(raw.result_bytes),
    provider: raw.provider,
    providerTaskId: raw.provider_task_id,
    attempts: raw.attempts,
    errorCode: raw.error_code,
    errorMessage: raw.error_message,
    costUsd: num(raw.cost_usd),
    shareToken: raw.share_token,
    shareExpiresAt: iso(raw.share_expires_at),
    notifyStatus: raw.notify_status,
    notifyChannel: raw.notify_channel,
    notifyAttempts: raw.notify_attempts,
    notifiedAt: iso(raw.notified_at),
    claimedAt: iso(raw.claimed_at),
    startedAt: iso(raw.started_at),
    finishedAt: iso(raw.finished_at),
    createdAt: iso(raw.created_at) ?? '',
    updatedAt: iso(raw.updated_at) ?? '',
  };
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

export interface InsertRenderJobArgs {
  id: string;
  userId: string;
  templateId: string;
  templateSlug: string;
  medium: TemplateMedium;
  engine: string;
  aspect: string;
  locale: Locale;
  inputKey: string | null;
  inputMime: string | null;
  /** `held` when the person still has to verify their face (docs §8.2); default `queued`. */
  status?: 'queued' | 'held';
}

export async function insertRenderJob(sql: SqlRunner, args: InsertRenderJobArgs): Promise<void> {
  await sql.query(
    `insert into render_jobs (id, user_id, template_id, template_slug, medium, engine, aspect, locale, input_key, input_mime, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [args.id, args.userId, args.templateId, args.templateSlug, args.medium, args.engine, args.aspect, args.locale, args.inputKey, args.inputMime, args.status ?? 'queued'],
  );
}

/**
 * queued → running for up to `limit` jobs (or the one named), oldest first. `FOR UPDATE SKIP
 * LOCKED` makes two overlapping passes take disjoint batches — the request that enqueued a job
 * runs it at once, and the scheduled tick that arrives a moment later takes something else.
 * The attempt is spent at claim time (the outbox's rule, `lib/notify/worker.ts`).
 */
export async function claimRenderJobs(sql: SqlRunner, args: { now: Date; limit: number; jobId?: string | null }): Promise<RenderJob[]> {
  const { rows } = await sql.query<RawRow>(
    `with claimable as (
       select id from render_jobs
        where status = 'queued'
          and ($2::uuid is null or id = $2::uuid)
        order by created_at asc
        limit $3::int
        for update skip locked
     )
     update render_jobs j
        set status = 'running',
            claimed_at = $1::timestamptz,
            started_at = coalesce(j.started_at, $1::timestamptz),
            attempts = j.attempts + 1
       from claimable c
      where j.id = c.id
      returning ${J_COLUMNS}`,
    [args.now.toISOString(), args.jobId ?? null, args.limit],
  );
  return rows.map(toJob);
}

/** The person is now verified: everything they had waiting goes to the queue, oldest first. */
export async function releaseHeldRenderJobs(sql: SqlRunner, userId: string): Promise<string[]> {
  const { rows } = await sql.query<{ id: string }>(`update render_jobs set status = 'queued' where user_id = $1 and status = 'held' returning id`, [userId]);
  return rows.map((row) => row.id);
}

/** A job waiting on the bank's photo comparison (docs §8.2) carries the asset id here, under this prefix. */
export const ASSET_TASK_PREFIX = 'asset:';

export async function markRenderWaitingForAsset(sql: SqlRunner, id: string, assetId: string): Promise<void> {
  await sql.query(`update render_jobs set provider = 'modelark', provider_task_id = $2 where id = $1`, [id, `${ASSET_TASK_PREFIX}${assetId}`]);
}

/** Films: the task is created and the job waits on the provider; the poll finishes it later. */
export async function markRenderRunningWithTask(sql: SqlRunner, id: string, args: { provider: RenderProvider; taskId: string }): Promise<void> {
  await sql.query(`update render_jobs set provider = $2, provider_task_id = $3 where id = $1`, [id, args.provider, args.taskId]);
}

export interface MarkSucceededArgs {
  resultKey: string;
  resultMime: string;
  resultBytes: number;
  provider: RenderProvider;
  costUsd: number | null;
  shareToken: string;
  shareExpiresAt: Date;
  finishedAt: Date;
}

export async function markRenderSucceeded(sql: SqlRunner, id: string, args: MarkSucceededArgs): Promise<void> {
  await sql.query(
    `update render_jobs
        set status = 'succeeded', result_key = $2, result_mime = $3, result_bytes = $4, provider = $5, cost_usd = $6,
            share_token = $7, share_expires_at = $8::timestamptz, finished_at = $9::timestamptz,
            error_code = null, error_message = null
      where id = $1`,
    [id, args.resultKey, args.resultMime, args.resultBytes, args.provider, args.costUsd, args.shareToken, args.shareExpiresAt.toISOString(), args.finishedAt.toISOString()],
  );
}

export async function markRenderFailed(sql: SqlRunner, id: string, args: { code: string; message: string; finishedAt: Date }): Promise<void> {
  await sql.query(
    `update render_jobs set status = 'failed', error_code = $2, error_message = $3, finished_at = $4::timestamptz where id = $1`,
    [id, args.code, args.message.slice(0, 1000), args.finishedAt.toISOString()],
  );
}

/** A retryable failure: back to the queue with the reason kept, so the next pass tries again. */
export async function requeueRenderJob(sql: SqlRunner, id: string, args: { code: string; message: string }): Promise<void> {
  await sql.query(
    `update render_jobs set status = 'queued', claimed_at = null, provider_task_id = null, error_code = $2, error_message = $3 where id = $1`,
    [id, args.code, args.message.slice(0, 1000)],
  );
}

/**
 * A job claimed for a synchronous engine that never finished (the process died mid-render):
 * back to the queue, or failed once the attempt budget is spent. Film jobs waiting on a provider
 * task are not stale — the poll owns them.
 */
export async function recoverStaleRenderJobs(sql: SqlRunner, args: { now: Date; leaseMinutes: number; maxAttempts: number }): Promise<{ requeued: number; failed: number }> {
  const { rows } = await sql.query<{ status: string }>(
    `update render_jobs
        set status = case when attempts >= $2::int then 'failed' else 'queued' end,
            error_code = case when attempts >= $2::int then 'stalled' else error_code end,
            error_message = case when attempts >= $2::int then 'the render did not finish in time' else error_message end,
            finished_at = case when attempts >= $2::int then $1::timestamptz else finished_at end,
            claimed_at = null
      where status = 'running'
        and provider_task_id is null
        and claimed_at is not null
        and claimed_at <= $1::timestamptz - make_interval(mins => $3::int)
      returning status`,
    [args.now.toISOString(), args.maxAttempts, args.leaseMinutes],
  );
  let requeued = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'failed') failed += 1;
    else requeued += 1;
  }
  return { requeued, failed };
}

export async function markRenderNotified(sql: SqlRunner, id: string, args: { status: NotifyStatus; at: Date; spendAttempt: boolean }): Promise<void> {
  await sql.query(
    `update render_jobs
        set notify_status = $2,
            notified_at = case when $2 = 'sent' then $3::timestamptz else notified_at end,
            notify_attempts = notify_attempts + case when $4::boolean then 1 else 0 end
      where id = $1`,
    [id, args.status, args.at.toISOString(), args.spendAttempt],
  );
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export async function loadRenderJob(sql: SqlRunner, id: string): Promise<RenderJob | null> {
  const { rows } = await sql.query<RawRow>(`select ${COLUMNS} from render_jobs where id = $1`, [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function loadRenderJobByTask(sql: SqlRunner, providerTaskId: string): Promise<RenderJob | null> {
  const { rows } = await sql.query<RawRow>(`select ${COLUMNS} from render_jobs where provider_task_id = $1 order by created_at desc limit 1`, [providerTaskId]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function listRenderJobsForUser(sql: SqlRunner, userId: string, limit = 50): Promise<RenderJob[]> {
  const { rows } = await sql.query<RawRow>(`select ${COLUMNS} from render_jobs where user_id = $1 and not exists (select 1 from brand_production_reservations b where b.render_id=render_jobs.id) order by created_at desc limit $2::int`, [userId, limit]);
  return rows.map(toJob);
}

/** Film jobs waiting on the provider, oldest first — the poll's worklist. */
export async function listRenderJobsAwaitingProvider(sql: SqlRunner, limit: number): Promise<RenderJob[]> {
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from render_jobs where status = 'running' and provider_task_id is not null order by claimed_at asc nulls first limit $1::int`,
    [limit],
  );
  return rows.map(toJob);
}

/** Finished jobs whose message has not gone out, oldest first. */
export async function listRenderJobsToNotify(sql: SqlRunner, args: { limit: number; maxAttempts: number }): Promise<RenderJob[]> {
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from render_jobs
      where status in ('succeeded', 'failed') and notify_status = 'pending' and notify_attempts < $2::int
      order by finished_at asc nulls last limit $1::int`,
    [args.limit, args.maxAttempts],
  );
  return rows.map(toJob);
}

/** The admin dashboard's four numbers (2026-09-11): recent volume, recent failures, and what is waiting. */
export interface RenderSummary {
  recent: number;
  failed: number;
  held: number;
  running: number;
}

export async function summarizeRenderJobs(sql: SqlRunner, since: Date): Promise<RenderSummary> {
  const { rows } = await sql.query<{ recent: number | string; failed: number | string; held: number | string; running: number | string }>(
    `select
       count(*) filter (where created_at >= $1::timestamptz)::int as recent,
       count(*) filter (where status = 'failed' and created_at >= $1::timestamptz)::int as failed,
       count(*) filter (where status = 'held')::int as held,
       count(*) filter (where status in ('queued', 'running'))::int as running
     from render_jobs`,
    [since.toISOString()],
  );
  const row = rows[0];
  return { recent: Number(row?.recent ?? 0), failed: Number(row?.failed ?? 0), held: Number(row?.held ?? 0), running: Number(row?.running ?? 0) };
}

export async function countRenderJobsSince(sql: SqlRunner, userId: string, since: Date): Promise<number> {
  const { rows } = await sql.query<{ n: number | string }>(`select count(*)::int as n from render_jobs where user_id = $1 and created_at >= $2::timestamptz`, [
    userId,
    since.toISOString(),
  ]);
  return Number(rows[0]?.n ?? 0);
}
