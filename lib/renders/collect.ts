import type { SqlRunner } from '@/lib/db/sql-runner';
import { markRenderFailed } from './repo';

/**
 * Collecting a finished film: the provider says the task succeeded, and a pass copies the film into
 * our bucket and marks the job. The owner's open page (every 6 s), the provider callback and the tick
 * all poll the same task, so several passes do this at once, each with its own download.
 *
 * `markRenderSucceeded` / `markRenderFailed` already keep the first ending. That is not enough on its
 * own: the copy takes seconds, and during them the job is still `running`. A second pass whose
 * download is refused (an expired link, a 403) would write `failed` first — and the pass holding the
 * film is then turned away, so a film we have is shown as failed and refunded.
 *
 * So a pass says it is collecting before it downloads (`render_jobs.collecting`, 0091), and a pass
 * that could not fetch or store the film ends the job only when no other pass is collecting it. A
 * delivery is never held back by this — any pass that has the film may mark it; only a failure waits.
 * A pass that died mid-copy stops counting after the lease, so a film nobody can fetch still fails.
 *
 * `collecting` is kept out of `repo.ts`'s column list for the reason `extras.ts` gives: a deploy that
 * reaches a database without 0091 must not break the queue. There `beginCollect` answers `untracked`
 * and the pass collects as it did before.
 */

/** How long a pass counts as collecting. Longer than any function can run (300 s), like the dispatch lease. */
export const COLLECT_LEASE_MINUTES = 10;

function code(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === 'string' ? value : error instanceof Error ? error.name : 'unknown';
}

/** The pass ids in a `collecting` value whose stamp is still inside the lease. */
export function liveCollectors(collecting: unknown, now: Date): string[] {
  let value = collecting;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const cutoff = now.getTime() - COLLECT_LEASE_MINUTES * 60_000;
  return Object.entries(value as Record<string, unknown>)
    .filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && at > cutoff)
    .map(([passId]) => passId);
}

/**
 * This pass is about to download the job's finished film. `collecting`: it is listed. `gone`: the job
 * is no longer running on this task (another pass ended it), so whatever this pass does next is not
 * the job's. `untracked`: the column could not be written (0091 not applied) — collect as before.
 * Never throws, and never runs inside a transaction (a failed statement would abort it).
 */
export async function beginCollect(sql: SqlRunner, job: { id: string; providerTaskId: string | null }, passId: string, now: Date): Promise<'collecting' | 'gone' | 'untracked'> {
  try {
    const { rows } = await sql.query<{ id: string }>(
      `update render_jobs
          set collecting = coalesce(collecting, '{}'::jsonb) || jsonb_build_object($2::text, $3::bigint)
        where id = $1 and status = 'running' and provider_task_id = $4
        returning id`,
      [job.id, passId, now.getTime(), job.providerTaskId],
    );
    return rows.length > 0 ? 'collecting' : 'gone';
  } catch (error) {
    console.warn(`[renders] collecting not recorded for ${job.id} (${code(error)})`);
    return 'untracked';
  }
}

/** This pass has stopped collecting without an ending (the download can be tried again). Never throws. */
export async function endCollect(sql: SqlRunner, id: string, passId: string): Promise<void> {
  try {
    await sql.query(`update render_jobs set collecting = collecting - $2::text where id = $1 and collecting is not null`, [id, passId]);
  } catch (error) {
    console.warn(`[renders] collecting not cleared for ${id} (${code(error)})`);
  }
}

/**
 * A pass that was collecting could not fetch or store the film. One step, under the job's row lock
 * (call it inside a transaction): the pass leaves the list, and the job fails only if nobody else is
 * still on it. Because leaving and judging are one step, two passes that fail together cannot both
 * defer — the second one finds the list empty and ends the job.
 *
 * `failed`: this call ended the job. `deferred`: another pass is collecting; the job stays running.
 * `ended`: the job had already ended or left the running state; nothing was written.
 */
export async function failUnlessCollected(
  tx: SqlRunner,
  id: string,
  passId: string,
  args: { code: string; message: string; finishedAt: Date; now: Date },
): Promise<'failed' | 'deferred' | 'ended'> {
  const { rows } = await tx.query<{ status: string; collecting: unknown }>(`select status, collecting from render_jobs where id = $1 for update`, [id]);
  const row = rows[0];
  if (!row || row.status !== 'running') return 'ended';
  if (liveCollectors(row.collecting, args.now).some((other) => other !== passId)) {
    await tx.query(`update render_jobs set collecting = collecting - $2::text where id = $1`, [id, passId]);
    return 'deferred';
  }
  return (await markRenderFailed(tx, id, { code: args.code, message: args.message, finishedAt: args.finishedAt, onlyRunning: true })) ? 'failed' : 'ended';
}
