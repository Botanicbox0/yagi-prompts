import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * The two 0055 columns on `render_jobs` — `finishing_at` and `poster_key` — kept out of
 * `repo.ts`'s column list on purpose: every render statement selects that list, so a deploy that
 * reaches a database without 0055 would break the whole queue. Here a missing column costs one log
 * line and reads as "not recorded", which is exactly what the page showed before 0055.
 *
 * None of these run inside a transaction: on Postgres a failed statement would abort it.
 */

export interface RenderExtras {
  finishingAt: string | null;
  posterKey: string | null;
  /** false = the columns could not be read (0055 not applied): nothing should try to write them. */
  ready: boolean;
}

const NONE: RenderExtras = { finishingAt: null, posterKey: null, ready: false };

export function posterKeyFor(renderId: string): string {
  return `${renderId}/poster.jpg`;
}

function code(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === 'string' ? value : error instanceof Error ? error.name : 'unknown';
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * The provider said "done": record when, once, while the job is still `running` — the wait page's
 * "마무리" stage. Never throws; the pass goes on to copy the result either way.
 */
export async function markRenderFinishing(sql: SqlRunner, id: string, at: Date): Promise<void> {
  try {
    await sql.query(`update render_jobs set finishing_at = $2::timestamptz where id = $1 and status = 'running' and finishing_at is null`, [id, at]);
  } catch (error) {
    console.warn(`[renders] finishing_at not recorded for ${id} (${code(error)})`);
  }
}

export async function loadRenderExtras(sql: SqlRunner, id: string): Promise<RenderExtras> {
  try {
    const { rows } = await sql.query<{ finishing_at: Date | string | null; poster_key: string | null }>(
      'select finishing_at, poster_key from render_jobs where id = $1',
      [id],
    );
    const row = rows[0];
    return row ? { finishingAt: iso(row.finishing_at), posterKey: row.poster_key, ready: true } : NONE;
  } catch (error) {
    console.warn(`[renders] render extras unavailable for ${id} (${code(error)})`);
    return NONE;
  }
}

/** First frame wins: `true` when this call stored the key, `false` when one was already there. */
export async function recordRenderPoster(sql: SqlRunner, id: string, key: string): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update render_jobs set poster_key = $2 where id = $1 and status = 'succeeded' and poster_key is null returning id`,
    [id, key],
  );
  return rows.length === 1;
}
