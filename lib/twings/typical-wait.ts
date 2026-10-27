import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * "보통 N분" — the honest answer to "how long will I wait?" (docs/PLATFORM-2.0.md §3.2-3).
 *
 * The median of the most recent successful renders for the same engine and the same length,
 * measured from the order (`created_at`) to the finished film (`finished_at`): queue time is part
 * of what the reader waits for. A median of fewer than ten renders is an anecdote, so below that the
 * engine's default stands in. Read-only; nothing here touches the render pipeline.
 */

export const TYPICAL_WAIT_DEFAULT_MINUTES = { image: 2, video: 5 } as const;
export const TYPICAL_WAIT_MIN_SAMPLES = 10;
/** The window the median is taken over: recent enough to follow a provider getting faster or slower. */
export const TYPICAL_WAIT_WINDOW = 200;

export interface TypicalWaitInput {
  engine: string;
  medium: 'video' | 'image';
  /** The template's length; null for an image. Only renders of the same length count. */
  seconds: number | null;
}

export async function typicalWaitMinutes(sql: SqlRunner | null, input: TypicalWaitInput): Promise<number> {
  const fallback = TYPICAL_WAIT_DEFAULT_MINUTES[input.medium];
  if (sql === null) return fallback;
  try {
    const { rows } = await sql.query<{ samples: number; median_seconds: number | string | null }>(
      `select count(*)::int as samples,
              percentile_cont(0.5) within group (order by waited) as median_seconds
         from (
           select extract(epoch from (j.finished_at - j.created_at)) as waited
             from render_jobs j
             join prompt_items p on p.id = j.template_id
            where j.status = 'succeeded'
              and j.finished_at is not null
              and j.engine = $1
              and j.medium = $2
              and coalesce(p.runtime_seconds, 0) = $3
            order by j.finished_at desc
            limit ${TYPICAL_WAIT_WINDOW}
         ) recent`,
      [input.engine, input.medium, input.seconds ?? 0],
    );
    const row = rows[0];
    const median = row?.median_seconds === null || row?.median_seconds === undefined ? NaN : Number(row.median_seconds);
    if (!row || row.samples < TYPICAL_WAIT_MIN_SAMPLES || !Number.isFinite(median)) return fallback;
    return Math.max(1, Math.round(median / 60));
  } catch {
    // A number on a sales page is never worth an error page: the default is still true enough.
    return fallback;
  }
}
