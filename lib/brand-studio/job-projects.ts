/**
 * A studio run can belong to a project (migration 0091, behind `BRAND_STUDIO_PROJECTS`).
 *
 * The project is the studio's own `brand_studio_video_projects` row (docs/BRAND-STUDIO-V6-PLAN.md §3).
 * Membership is per run, never per file: a run that made four pictures moves as four pictures. A run and
 * everything made from it (its later versions, its 1080p finish, its partial edits) is one family and
 * always moves together, so a version chain can never straddle two projects.
 *
 * Everything here is closed unless the flag is on AND the column exists (`studioProjectsReady`), so the
 * code can ship before the migration is applied.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { requireCreate, studioSeat, StudioDenied } from './access';
import { JobAssignProjectSchema, type StudioFailure, type StudioJobProjectAssigned, type StudioProjectRef } from './contracts';
import { failure, guarded } from './outcome';
import { NOT_FILL } from './repo';
import type { StudioDeps } from './types';

const RECHECK_MS = 60_000;
let probe: { ready: boolean; at: number } | null = null;

/** True once `brand_studio_jobs.project_id` exists. A miss is looked up again after a minute; a hit is kept. */
export async function jobProjectColumnReady(sql: SqlRunner, now = Date.now()): Promise<boolean> {
  if (probe && (probe.ready || now - probe.at < RECHECK_MS)) return probe.ready;
  const found = await sql.query(
    `select 1 from information_schema.columns
      where table_schema = current_schema() and table_name = 'brand_studio_jobs' and column_name = 'project_id'`,
  );
  probe = { ready: found.rows.length > 0, at: now };
  return probe.ready;
}

/** Forget the lookup (tests change the schema under one process). */
export function resetJobProjectProbe(): void {
  probe = null;
}

/** The flag and the column, both. */
export async function studioProjectsReady(deps: Pick<StudioDeps, 'env'>, sql: SqlRunner): Promise<boolean> {
  return Boolean(deps.env.projects) && (await jobProjectColumnReady(sql));
}

const LIVE = "deleted_at is null and status in ('active', 'completed')";

/** The projects a run can be put in: this organization's, not deleted, not archived. Newest first. */
export async function liveProjectsOf(sql: SqlRunner, organizationId: string): Promise<StudioProjectRef[]> {
  try {
    return (
      await sql.query<StudioProjectRef>(
        `select id, title from brand_studio_video_projects where organization_id = $1 and ${LIVE} order by updated_at desc, id desc limit 100`,
        [organizationId],
      )
    ).rows.map((row) => ({ id: row.id, title: row.title }));
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '42P01') return [];
    throw error;
  }
}

async function liveProject(sql: SqlRunner, organizationId: string, projectId: string): Promise<boolean> {
  return (await sql.query(`select 1 from brand_studio_video_projects where id = $1 and organization_id = $2 and ${LIVE}`, [projectId, organizationId])).rows.length > 0;
}

/**
 * The project a new run is stored with.
 *
 * - An internal fill run never has one.
 * - A run made from an earlier result (a new version, a 1080p finish, a partial edit of a result) takes
 *   the project of the run that made that result, whatever the request says: the family stays together.
 * - Otherwise the project the member chose, which must be a live project of this organization
 *   (`not_found` if it is not, exactly as for a project that does not exist).
 */
export async function projectForNewJob(
  sql: SqlRunner,
  organizationId: string,
  input: { requested: string | null | undefined; parentOutputId: string | null; fill: boolean },
): Promise<string | null> {
  if (input.fill) return null;
  if (input.parentOutputId) {
    const parent = (
      await sql.query<{ project_id: string | null }>(
        `select j.project_id from brand_studio_outputs o join brand_studio_jobs j on j.id = o.job_id
          where o.id = $1 and j.organization_id = $2`,
        [input.parentOutputId, organizationId],
      )
    ).rows[0];
    if (parent) return parent.project_id;
  }
  if (!input.requested) return null;
  if (!(await liveProject(sql, organizationId, input.requested))) throw new StudioDenied('not_found');
  return input.requested;
}

/**
 * `job.assign_project`: put a run in a project, or take it out (`projectId: null`). The whole family moves:
 * up to the first run of the chain, then down through everything made from its results.
 */
export async function assignStudioJobProject(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioJobProjectAssigned | StudioFailure> {
  const parsed = JobAssignProjectSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  if (!deps.env.projects) return failure('feature_unavailable');
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      if (!(await jobProjectColumnReady(sql))) throw new StudioDenied('feature_unavailable');
      const job = (
        await sql.query(`select 1 from brand_studio_jobs where id = $1 and organization_id = $2 and deleted_at is null and ${NOT_FILL}`, [v.jobId, v.organizationId])
      ).rows[0];
      if (!job) throw new StudioDenied('not_found');
      if (v.projectId && !(await liveProject(sql, v.organizationId, v.projectId))) throw new StudioDenied('not_found');
      const moved = (
        await sql.query<{ id: string }>(
          `with recursive up(id, parent_output_id, depth) as (
               select j.id, j.parent_output_id, 0 from brand_studio_jobs j where j.id = $1 and j.organization_id = $2
             union all
               select pj.id, pj.parent_output_id, up.depth + 1
                 from up
                 join brand_studio_outputs o on o.id = up.parent_output_id
                 join brand_studio_jobs pj on pj.id = o.job_id and pj.organization_id = $2
                where up.depth < 64
           ), top as (
             select id from up order by depth desc limit 1
           ), family(id, depth) as (
               select id, 0 from top
             union all
               select cj.id, family.depth + 1
                 from family
                 join brand_studio_outputs o on o.job_id = family.id
                 join brand_studio_jobs cj on cj.parent_output_id = o.id and cj.organization_id = $2
                where family.depth < 64
           )
           update brand_studio_jobs
              set project_id = $3
            where organization_id = $2 and id in (select id from family) and ${NOT_FILL}
           returning id`,
          [v.jobId, v.organizationId, v.projectId],
        )
      ).rows.map((row) => row.id);
      return { ok: true as const, jobIds: moved, projectId: v.projectId };
    }),
  );
}
