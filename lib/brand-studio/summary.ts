/**
 * The workspace rail's view of the studio (docs/BRAND-STUDIO-V3.md §3, slice A):
 * `GET /api/brand-studio/summary?organizationId=…`.
 *
 * The credits meter (the monthly allowance), the jobs this person still has running (count badges, and
 * the ids the rail hands to the board's poll so they keep moving on any screen) and the jobs of theirs
 * that finished in the last ten minutes (the "이미지가 완성됐어요" toast).
 *
 * Same gate as every studio read (./access.ts): seat (membership) -> Morphic hardline + feature policy
 * -> role. The flag and sign-in are checked by the route first. Jobs are the viewer's own: a teammate's
 * finished image is not "your image is ready".
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  STUDIO_JOB_KINDS,
  STUDIO_JOB_OPEN_STATUSES,
  type StudioAllowanceView,
  type StudioFailure,
  type StudioJobKind,
} from './contracts';
import { studioSeat } from './access';
import type { StudioEnv } from './env';
import { guarded } from './outcome';
import { allowanceView, loadAllowance } from './usage';

/** How long a finished job stays in `settled` (long enough for a 20-second poll to see it twice). */
export const STUDIO_SETTLED_WINDOW_MS = 10 * 60_000;
const OPEN_LIMIT = 50;
const SETTLED_LIMIT = 20;

export type StudioSettledStatus = 'succeeded' | 'failed' | 'canceled';

export interface StudioSummary {
  ok: true;
  allowance: StudioAllowanceView;
  /** This person's jobs that are still held, queued, running or finishing; newest first. */
  open: Array<{ id: string; kind: StudioJobKind }>;
  /** This person's jobs that finished in the last ten minutes; most recent first. */
  settled: Array<{ id: string; kind: StudioJobKind; status: StudioSettledStatus; finishedAt: string }>;
}

export interface StudioSummaryDeps {
  sql: SqlRunner;
  env: Pick<StudioEnv, 'defaultMonthlyKrw'>;
  now?: () => Date;
}

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(String(value))).toISOString();
const isKind = (value: string): value is StudioJobKind => (STUDIO_JOB_KINDS as readonly string[]).includes(value);

export async function loadStudioSummary(deps: StudioSummaryDeps, viewer: Viewer, organizationId: string): Promise<StudioSummary | StudioFailure> {
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      // The gate before anything about the organization is read. A sandboxed or project-only client stops here.
      const seat = await studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true });
      const now = deps.now?.() ?? new Date();
      const allowance = await loadAllowance(sql, organizationId, deps.env, now);
      const open = (
        await sql.query<{ id: string; kind: string }>(
          `select id, kind from brand_studio_jobs
            where organization_id = $1 and created_by = $2 and status = any($3::text[])
            order by created_at desc, id limit ${OPEN_LIMIT}`,
          [organizationId, seat.userId, [...STUDIO_JOB_OPEN_STATUSES]],
        )
      ).rows;
      const settled = (
        await sql.query<{ id: string; kind: string; status: string; finished_at: Date | string }>(
          `select id, kind, status, finished_at from brand_studio_jobs
            where organization_id = $1 and created_by = $2 and status in ('succeeded','failed','canceled')
              and finished_at >= $3 and finished_at <= $4
            order by finished_at desc, id limit ${SETTLED_LIMIT}`,
          [organizationId, seat.userId, new Date(now.getTime() - STUDIO_SETTLED_WINDOW_MS).toISOString(), now.toISOString()],
        )
      ).rows;
      return {
        ok: true as const,
        allowance: allowanceView(allowance),
        open: open.filter((j) => isKind(String(j.kind))).map((j) => ({ id: String(j.id), kind: j.kind as StudioJobKind })),
        settled: settled
          .filter((j) => isKind(String(j.kind)))
          .map((j) => ({
            id: String(j.id),
            kind: j.kind as StudioJobKind,
            status: j.status as StudioSettledStatus,
            finishedAt: iso(j.finished_at),
          })),
      };
    }),
  );
}
