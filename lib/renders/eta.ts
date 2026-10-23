import type { SqlRunner } from '@/lib/db/sql-runner';
import type { TemplateMedium } from '@/lib/prompts/schemas';

/**
 * docs/PLATFORM-2.0.md §3.2-3·4 — "보통 N분 걸려요", measured.
 *
 * N is the median wait (order → finished) of the most recent successful jobs on the same engine
 * and the same template length (`prompt_items.runtime_seconds`; a 15-second film and a 30-second
 * one are different waits). Below ten such jobs the number is the engine default — 2 minutes for
 * an image, 5 for a film — because a median of three is an anecdote.
 *
 * The estimate decorates a page; it must never break one. Any failure reads as the default.
 */
export const ETA_MIN_SAMPLES = 10;
export const ETA_SAMPLE_LIMIT = 50;
export const ETA_DEFAULT_SECONDS: Record<TemplateMedium, number> = { image: 120, video: 300 };

export interface RenderEta {
  minutes: number;
  source: 'measured' | 'default';
  samples: number;
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const toMinutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

export function etaFromSamples(seconds: readonly number[], medium: TemplateMedium): RenderEta {
  const median = seconds.length >= ETA_MIN_SAMPLES ? medianOf(seconds) : null;
  if (median === null) return { minutes: toMinutes(ETA_DEFAULT_SECONDS[medium]), source: 'default', samples: seconds.length };
  return { minutes: toMinutes(median), source: 'measured', samples: seconds.length };
}

export async function estimateRenderMinutes(
  sql: SqlRunner,
  input: { engine: string; templateId: string; medium: TemplateMedium },
): Promise<RenderEta> {
  try {
    const { rows } = await sql.query<{ seconds: number | string }>(
      `select extract(epoch from (j.finished_at - j.created_at)) as seconds
         from render_jobs j
         join prompt_items p on p.id = j.template_id
        where j.status = 'succeeded'
          and j.engine = $1
          and j.finished_at is not null
          and j.finished_at >= j.created_at
          and p.runtime_seconds is not distinct from (select runtime_seconds from prompt_items where id = $2::uuid)
        order by j.finished_at desc
        limit ${ETA_SAMPLE_LIMIT}`,
      [input.engine, input.templateId],
    );
    const seconds = rows.map((row) => Number(row.seconds)).filter((value) => Number.isFinite(value));
    return etaFromSamples(seconds, input.medium);
  } catch (error) {
    console.error('[renders] eta query failed', error);
    return etaFromSamples([], input.medium);
  }
}
