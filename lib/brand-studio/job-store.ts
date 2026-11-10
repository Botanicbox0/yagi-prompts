/**
 * Writes the engine makes while it holds a job's lease. Every update is conditioned on the lease
 * token (`claimed_at`, millisecond-truncated so it survives the round trip to JavaScript) AND on the
 * status the engine last saw: a cancel, a lane-worker callback or a second advancer that changed the
 * row makes the write miss, and the engine stops instead of overwriting.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioErrorCode } from './contracts';
import type { StudioMediaStore } from './media-store';
import type { JobRow, StudioJobWork } from './types';

const COLUMNS = {
  status: 'text',
  lane: 'text',
  final_prompt: 'text',
  work: 'jsonb',
  cost_usd: 'numeric',
  usage_krw: 'integer',
  error_code: 'text',
  error_detail: 'text',
  attempts: 'integer',
  started_at: 'timestamptz',
  finished_at: 'timestamptz',
} as const;

export type JobPatch = Partial<{
  status: JobRow['status'];
  lane: JobRow['lane'];
  final_prompt: string | null;
  work: StudioJobWork;
  cost_usd: number | null;
  usage_krw: number | null;
  error_code: StudioErrorCode | null;
  error_detail: string | null;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
}>;

export function tokenOf(row: Pick<JobRow, 'claimed_at'>): string {
  return (row.claimed_at instanceof Date ? row.claimed_at : new Date(String(row.claimed_at))).toISOString();
}

export async function saveJob(sql: SqlRunner, job: JobRow, token: string, patch: JobPatch): Promise<JobRow | null> {
  const params: unknown[] = [job.id, token, job.status];
  const sets: string[] = [];
  for (const [key, value] of Object.entries(patch) as Array<[keyof typeof COLUMNS, unknown]>) {
    if (!(key in COLUMNS) || value === undefined) continue;
    params.push(key === 'work' ? JSON.stringify(value) : value);
    sets.push(`${key} = $${params.length}::${COLUMNS[key]}`);
  }
  if (sets.length === 0) return job;
  const row = (
    await sql.query<JobRow>(
      `update brand_studio_jobs set ${sets.join(', ')}
        where id = $1 and claimed_at = $2::timestamptz and status = $3 returning *`,
      params,
    )
  ).rows[0];
  return row ?? null;
}

const OPEN = "('held','queued','running','finishing')";
export const LEASE_SECONDS = 180;

/**
 * Take up to `limit` open jobs (oldest first) that nobody holds, or whose lease expired. Running jobs
 * on the account lane belong to the worker and are left alone. `for update skip locked` keeps two
 * advancers from taking the same row.
 */
export async function claimJobs(sql: SqlRunner, ids: readonly string[] | null, limit: number): Promise<JobRow[]> {
  return (
    await sql.query<JobRow>(
      `update brand_studio_jobs set claimed_at = date_trunc('milliseconds', clock_timestamp())
        where id in (
          select id from brand_studio_jobs
           where status in ${OPEN}
             and not (lane = 'sunra_mcp' and status = 'running')
             and (claimed_at is null or claimed_at < now() - interval '${LEASE_SECONDS} seconds')
             and ($1::uuid[] is null or id = any($1::uuid[]))
           order by created_at, id
           limit $2
           for update skip locked)
        returning *`,
      [ids === null ? null : [...ids], limit],
    )
  ).rows.sort((a, b) => msOf(a.created_at) - msOf(b.created_at));
}

export function msOf(value: Date | string | null | undefined): number {
  return value instanceof Date ? value.getTime() : value ? new Date(value).getTime() : 0;
}

export async function releaseJob(sql: SqlRunner, jobId: string, token: string): Promise<void> {
  await sql.query('update brand_studio_jobs set claimed_at = null where id = $1 and claimed_at = $2::timestamptz', [jobId, token]);
}

/** Best effort: the region-edit crop is a working file, not a result. */
export async function dropWorkingFiles(media: StudioMediaStore, work: StudioJobWork | null | undefined): Promise<void> {
  const crop = work?.region?.cropKey;
  if (!crop) return;
  try {
    await media.delete(crop);
  } catch {
    /* A leftover crop is harmless: an unlisted random key. */
  }
}

export async function failPendingOutputs(sql: SqlRunner, jobId: string): Promise<void> {
  await sql.query("update brand_studio_outputs set status = 'failed' where job_id = $1 and status = 'pending'", [jobId]);
}
