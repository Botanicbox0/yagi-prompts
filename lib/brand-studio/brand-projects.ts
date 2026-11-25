/**
 * The brand project spine, server side (docs/BRAND-PROJECT-SPINE.md §3–§4, slice 1a; migration 0194).
 *
 * A project is a `brand_projects` row: one the YAGI team runs with the brand (`origin = 'team'`, every row that
 * existed before 0194) or one the brand made for its own filing in the studio (`origin = 'self'`, always
 * hidden from the team side: `client_visible = false`, a table check). Studio runs, uploads and films are filed
 * in a project through `brand_project_id` (null = 미분류). This module is the only place that decides:
 *  - whether the spine is open for an organization (`brandProjectSpineOpen`: the switch AND the columns), so
 *    the code can ship before the migration and every new read and write asks the same question;
 *  - which projects can take new work (`SELECTABLE_PROJECTS`): this organization's own active projects, and
 *    its team projects that are shown to it and still requested or active. Anything else, including a team
 *    project the staff hid, answers `not_found`, exactly like a project that does not exist;
 *  - where new work is filed (`brandProjectForNew`);
 *  - the three operations `project.list`, `project.create`, `project.move`.
 * Every project, run, upload and film id is checked against the organization inside the transaction that writes.
 * The old `brand_studio_jobs.project_id` (`BRAND_STUDIO_PROJECTS`, ./job-projects.ts) is neither read nor written.
 * Nothing here sends an event, a team notice, a mail or a Slack message.
 */
import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { resetSpineProbe, spineColumnsReady } from '@/lib/brands/project-origin';
import { brandProjectSpineFor } from '@/lib/flags';
import { lockOrganization, requireCreate, StudioDenied, studioSeat, type StudioSeat } from './access';
import {
  BRAND_PROJECT_LIMITS,
  BRAND_PROJECT_OPERATIONS,
  BrandProjectCreateSchema,
  BrandProjectListSchema,
  BrandProjectMoveSchema,
  type BrandProjectOperation,
  type StudioBrandProject,
  type StudioBrandProjectCreated,
  type StudioBrandProjectList,
  type StudioBrandProjectMoved,
  type StudioFailure,
  type StudioStateScope,
} from './contracts';
import type { StudioMediaStore } from './media-store';
import { derivedUuid, failure, guarded } from './outcome';
import type { StudioDeps } from './types';

type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The internal strips of "빈 곳 채우기" (`params.purpose = 'fill'`) are never filed and never moved. */
const NOT_FILL_RUN = (alias: string) => `coalesce(${alias}.params ->> 'purpose', '') <> 'fill'`;

/* --------------------------------------------------------------- readiness */

// The column probe lives in the leaf module lib/brands/project-origin.ts (the upload gate uses it too).
export { resetSpineProbe, spineColumnsReady };

/**
 * Is the spine open for this organization: `BRAND_PROJECT_SPINE=on`, the organization in
 * `BRAND_PROJECT_SPINE_ORGS` (lib/flags.ts `brandProjectSpineFor`), AND migration 0194 applied. The environment
 * is read first: while it says closed the database is not asked anything. Server only; a page asks this before
 * drawing anything of the spine.
 */
export async function brandProjectSpineOpen(sql: SqlRunner, organizationId: string, env: Env = process.env): Promise<boolean> {
  if (!brandProjectSpineFor(organizationId, env)) return false;
  return spineColumnsReady(sql);
}

/* ------------------------------------------------------------- selectable */

/**
 * "New work may be filed here", for the `brand_projects` row named `alias` (needs migration 0194, so only spine
 * code uses it). A brand's own project while active (completed = 보관); a team project while shown to the brand
 * (`client_visible`) and requested or active.
 */
export const SELECTABLE_PROJECTS = (alias: string): string =>
  `((${alias}.origin = 'self' and ${alias}.status = 'active') or (${alias}.origin = 'team' and ${alias}.client_visible and ${alias}.status in ('requested', 'active')))`;

export async function isSelectableProject(sql: SqlRunner, organizationId: string, projectId: string): Promise<boolean> {
  if (!UUID.test(projectId)) return false;
  return (
    (await sql.query(`select 1 from brand_projects p where p.id = $1 and p.organization_id = $2 and ${SELECTABLE_PROJECTS('p')}`, [projectId, organizationId])).rows
      .length > 0
  );
}

/* ----------------------------------------------------------------- filing */

/**
 * What a request says about filing: closed (the field is not read), or open with the request's raw value. The
 * value is judged only by `brandProjectForNew`, inside the writing transaction AFTER the seat, so nobody who is not
 * seated learns anything from it (format included).
 */
export type BrandProjectFiling = { open: false } | { open: true; requested: unknown };

/**
 * Read `brandProjectId` from a raw request. Closed for the organization: `{ open: false }` and the field is never
 * looked at (a request carrying it is answered exactly as before the spine). Open: the raw value, not judged here.
 */
export async function brandProjectFiling(sql: SqlRunner, organizationId: unknown, raw: unknown, env: Env = process.env): Promise<BrandProjectFiling> {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return { open: false };
  if (!(await brandProjectSpineOpen(sql, organizationId, env))) return { open: false };
  return { open: true, requested: raw && typeof raw === 'object' ? (raw as { brandProjectId?: unknown }).brandProjectId : undefined };
}

/** Whether a raw request carries the field at all (the strict music request needs to know). */
export function hasBrandProjectField(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && 'brandProjectId' in raw);
}

/** The request without `brandProjectId`, for a strict request schema while the spine is open. */
export function withoutBrandProjectField(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('brandProjectId' in raw)) return raw;
  const { brandProjectId: _taken, ...rest } = raw as Record<string, unknown>;
  return rest;
}

/**
 * The project a new run is filed in (docs/BRAND-PROJECT-SPINE.md §4.2; callers ask only while the spine is open,
 * inside the writing transaction, after the seat). First the request's value itself: absent or null is nothing
 * chosen, a uuid is a choice, anything else is `invalid`. Then:
 *  - an internal fill run: none;
 *  - a run made from an earlier result (a new version, a 1080p finish, a partial edit of a result, an upscale of
 *    a result): the project of the run that made that result, whatever the request says, so a family is never
 *    split (even when that project could not be chosen any more);
 *  - otherwise the chosen project, which must be selectable for this organization (`not_found` if not);
 *  - nothing chosen: none (미분류).
 */
export async function brandProjectForNew(
  sql: SqlRunner,
  organizationId: string,
  input: { requested: unknown; parentOutputId: string | null; fill: boolean },
): Promise<string | null> {
  const requested = input.requested;
  if (requested !== undefined && requested !== null && !(typeof requested === 'string' && UUID.test(requested))) throw new StudioDenied('invalid');
  if (input.fill) return null;
  if (input.parentOutputId) {
    const parent = (
      await sql.query<{ brand_project_id: string | null }>(
        `select j.brand_project_id from brand_studio_outputs o
           join brand_studio_jobs j on j.id = o.job_id and j.organization_id = o.organization_id
          where o.id = $1 and o.organization_id = $2`,
        [input.parentOutputId, organizationId],
      )
    ).rows[0];
    if (parent) return parent.brand_project_id ?? null;
  }
  if (typeof requested !== 'string') return null;
  const chosen = requested.toLowerCase();
  if (!(await isSelectableProject(sql, organizationId, chosen))) throw new StudioDenied('not_found');
  return chosen;
}

/** The new run's project, written apart from its insert (so every insert statement stays exactly as it was). */
export async function fileStudioJob(sql: SqlRunner, organizationId: string, jobId: string, brandProjectId: string | null): Promise<void> {
  if (!brandProjectId) return;
  await sql.query('update brand_studio_jobs set brand_project_id = $3 where id = $1 and organization_id = $2', [jobId, organizationId, brandProjectId]);
}

/** A new upload's project, written apart from its insert. */
export async function fileStudioAsset(sql: SqlRunner, organizationId: string, assetId: string, brandProjectId: string | null): Promise<void> {
  if (!brandProjectId) return;
  await sql.query('update brand_studio_assets set brand_project_id = $3 where id = $1 and organization_id = $2', [assetId, organizationId, brandProjectId]);
}

/**
 * A result stored as a NEW library entry takes the project of the run that made it (spine open only; an entry
 * that already existed keeps what it has). Both rows are matched on the organization.
 */
export async function fileAssetWithRun(sql: SqlRunner, organizationId: string, assetId: string, jobId: string, env: Env = process.env): Promise<void> {
  if (!(await brandProjectSpineOpen(sql, organizationId, env))) return;
  await sql.query(
    `update brand_studio_assets a set brand_project_id = j.brand_project_id
       from brand_studio_jobs j
      where a.id = $1 and a.organization_id = $2 and a.brand_project_id is null
        and j.id = $3 and j.organization_id = $2 and j.brand_project_id is not null`,
    [assetId, organizationId, jobId],
  );
}

/* ---------------------------------------------------------------- answers */

/**
 * `brandProjectId` is OPT-IN (default deny): no shared view builder adds it (`jobView` and the films' `toSummary`
 * never do). Only an answer given to a workspace member adds it, through these two helpers: the studio state and
 * poll (members, not project guests), the create answers of `POST /api/brand-studio`, the films' list, read and
 * mutation answers, and the member branch of the sound studio page. Staff who are not members, project guests,
 * MCP and workflows never receive it.
 *
 * What the customer sees (§4.2): the stored filing is kept (a family is never split), but a project that can no
 * longer take new work (hidden by the staff, completed, cancelled) reads as 미분류: `brandProjectId: null`. One
 * query per answer (the stored ids joined to this organization's selectable projects), never one per row.
 */
export async function withBrandProjects<T extends { id: string }>(sql: SqlRunner, organizationId: string, views: T[], env: Env = process.env): Promise<Array<T & { brandProjectId?: string | null }>> {
  if (views.length === 0 || !(await brandProjectSpineOpen(sql, organizationId, env))) return views;
  const shown = new Map(
    (
      await sql.query<{ id: string; brand_project_id: string | null }>(
        `select j.id::text as id, p.id::text as brand_project_id
           from brand_studio_jobs j
           left join brand_projects p on p.id = j.brand_project_id and p.organization_id = j.organization_id and ${SELECTABLE_PROJECTS('p')}
          where j.organization_id = $1 and j.id = any($2::uuid[])`,
        [organizationId, views.map((view) => view.id)],
      )
    ).rows.map((row) => [String(row.id).toLowerCase(), row.brand_project_id ? String(row.brand_project_id) : null] as const),
  );
  return views.map((view) => (shown.has(view.id.toLowerCase()) ? { ...view, brandProjectId: shown.get(view.id.toLowerCase()) ?? null } : view));
}

/** The same for films (`brand_studio_video_projects`): members' answers only, null when not selectable. */
export async function withFilmBrandProjects<T extends { id: string }>(sql: SqlRunner, organizationId: string, films: T[], env: Env = process.env): Promise<Array<T & { brandProjectId?: string | null }>> {
  if (films.length === 0 || !(await brandProjectSpineOpen(sql, organizationId, env))) return films;
  const shown = new Map(
    (
      await sql.query<{ id: string; brand_project_id: string | null }>(
        `select f.id::text as id, p.id::text as brand_project_id
           from brand_studio_video_projects f
           left join brand_projects p on p.id = f.brand_project_id and p.organization_id = f.organization_id and ${SELECTABLE_PROJECTS('p')}
          where f.organization_id = $1 and f.id = any($2::uuid[])`,
        [organizationId, films.map((film) => film.id)],
      )
    ).rows.map((row) => [String(row.id).toLowerCase(), row.brand_project_id ? String(row.brand_project_id) : null] as const),
  );
  return films.map((film) => (shown.has(film.id.toLowerCase()) ? { ...film, brandProjectId: shown.get(film.id.toLowerCase()) ?? null } : film));
}

/**
 * Whether a studio page's seat may receive `brandProjectId`: a workspace member (owner, editor, viewer) seen as
 * themselves. Staff opening a brand they are not a member of (`staff: true`, role `studio`) and project guests
 * do not.
 */
export function memberSeesBrandProjects(seat: { staff?: boolean; role: string }): boolean {
  return seat.staff !== true && (seat.role === 'owner' || seat.role === 'editor' || seat.role === 'viewer');
}

/**
 * "미분류" for the runs of the studio state (`alias` = the runs' table): not filed, or filed in a project that can
 * no longer take new work. Needs migration 0194 (spine code only). `$1` must be the organization.
 */
export const UNFILED_RUNS = (alias: string): string =>
  `(${alias}.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = ${alias}.brand_project_id and sp.organization_id = $1 and ${SELECTABLE_PROJECTS('sp')}))`;

/**
 * The runs' filter for a scoped studio state load, or null for today's query: no scope, a project guest (the
 * scope is ignored, as everything else of the spine), or the spine closed. A project must be selectable
 * (`not_found` otherwise); `unfiled` is `UNFILED_RUNS`. Runs inside the reading transaction.
 */
export async function stateScopeFilter(sql: SqlRunner, seat: StudioSeat, scope: StudioStateScope | undefined, env: Env = process.env): Promise<{ brandProjectId: string | null } | null> {
  if (!scope || seat.role === 'guest') return null;
  if (!(await brandProjectSpineOpen(sql, seat.organizationId, env))) return null;
  if (scope.kind === 'unfiled') return { brandProjectId: null };
  if (scope.kind !== 'project' || typeof scope.brandProjectId !== 'string' || !UUID.test(scope.brandProjectId)) throw new StudioDenied('invalid');
  if (!(await isSelectableProject(sql, seat.organizationId, scope.brandProjectId))) throw new StudioDenied('not_found');
  return { brandProjectId: scope.brandProjectId.toLowerCase() };
}

/** `?brandProject=<id>|unfiled` on `GET /api/brand-studio`; absent: no scope. */
export function studioStateScopeOf(param: string | null | undefined): StudioStateScope | undefined {
  if (param === null || param === undefined || param === '') return undefined;
  return param === 'unfiled' ? { kind: 'unfiled' } : { kind: 'project', brandProjectId: param };
}

interface ProjectRow {
  id: string;
  title: string;
  origin: string;
  last_activity_at: Date | string;
  cover_kind: string | null;
  cover_key: string | null;
  cover_thumb_key: string | null;
}

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/**
 * Projects with their latest activity (the later of the row's own `updated_at` and its newest run that is not a
 * fill strip) and, in one lateral join, the newest ready image or video result filed in each.
 */
function projectsQuery(where: string): string {
  return `select p.id, p.title, p.origin,
                 greatest(p.updated_at, coalesce(r.newest, p.updated_at)) as last_activity_at,
                 c.kind as cover_kind, c.storage_key as cover_key, c.thumb_key as cover_thumb_key
            from brand_projects p
            left join lateral (
              select max(j.created_at) as newest from brand_studio_jobs j
               where j.organization_id = p.organization_id and j.brand_project_id = p.id and ${NOT_FILL_RUN('j')}
            ) r on true
            left join lateral (
              select o.kind, o.storage_key, o.thumb_key
                from brand_studio_jobs j
                join brand_studio_outputs o on o.job_id = j.id and o.organization_id = j.organization_id
               where j.organization_id = p.organization_id and j.brand_project_id = p.id and ${NOT_FILL_RUN('j')}
                 and o.status = 'ready' and o.deleted_at is null and o.storage_key is not null and o.kind in ('image', 'video')
               order by o.created_at desc, o.id desc
               limit 1
            ) c on true
           where ${where}`;
}

function projectView(row: ProjectRow, media: StudioMediaStore): StudioBrandProject {
  const kind = row.cover_kind === 'image' || row.cover_kind === 'video' ? row.cover_kind : null;
  return {
    id: String(row.id),
    title: String(row.title),
    origin: row.origin === 'self' ? 'self' : 'team',
    lastActivityAt: iso(row.last_activity_at),
    ...(kind && row.cover_key ? { cover: { kind, url: media.url(row.cover_key), thumbUrl: row.cover_thumb_key ? media.url(row.cover_thumb_key) : null } } : {}),
  };
}

async function oneProject(sql: SqlRunner, media: StudioMediaStore, organizationId: string, id: string): Promise<StudioBrandProject> {
  const row = (await sql.query<ProjectRow>(projectsQuery('p.id = $1 and p.organization_id = $2'), [id, organizationId])).rows[0];
  if (!row) throw new StudioDenied('not_found');
  return projectView(row, media);
}

/* ------------------------------------------------------------- operations */

export function isBrandProjectOperation(value: unknown): value is BrandProjectOperation {
  return typeof value === 'string' && (BRAND_PROJECT_OPERATIONS as readonly string[]).includes(value);
}

/**
 * Members of the workspace only, through the studio's gate (membership → sandbox hardline → feature policy →
 * role). A project guest (only a `brand_project_members` row) is not a member: for them none of this exists.
 */
async function spineSeat(sql: SqlRunner, viewer: Viewer, organizationId: string, write: boolean): Promise<StudioSeat> {
  const seat = await studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true });
  if (seat.role === 'guest') throw new StudioDenied('not_found');
  if (write) requireCreate(seat);
  return seat;
}

export type BrandProjectOperationResult = StudioBrandProjectList | StudioBrandProjectCreated | StudioBrandProjectMoved | StudioFailure;

/**
 * `project.list` / `project.create` / `project.move` through `POST /api/brand-studio`. While the spine is closed for
 * the organization (or the request names none) the answer is exactly what an unknown operation answers
 * (`invalid`), before anything else is judged.
 */
export async function runBrandProjectOperation(deps: StudioDeps, viewer: Viewer, operation: BrandProjectOperation, input: unknown): Promise<BrandProjectOperationResult> {
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || !(await brandProjectSpineOpen(deps.sql, organizationId))) return failure('invalid');
  switch (operation) {
    case 'project.list':
      return listBrandProjects(deps, viewer, input);
    case 'project.create':
      return createSelfBrandProject(deps, viewer, input);
    case 'project.move':
      return moveToBrandProject(deps, viewer, input);
  }
}

/** `project.list`: the projects new work can be filed in, most recent activity first, at most 100. */
export async function listBrandProjects(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectList | StudioFailure> {
  const parsed = BrandProjectListSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      await spineSeat(sql, viewer, v.organizationId, false);
      const rows = (
        await sql.query<ProjectRow>(`${projectsQuery(`p.organization_id = $1 and ${SELECTABLE_PROJECTS('p')}`)} order by last_activity_at desc, p.id desc limit $2`, [
          v.organizationId,
          BRAND_PROJECT_LIMITS.listMax,
        ])
      ).rows;
      return { ok: true as const, projects: rows.map((row) => projectView(row, deps.media)) };
    }),
  );
}

/**
 * `project.create`: a project of the brand's own, by name only (§4.5). Its own insert, never the team request's
 * `createProject` (that one validates the commission form and tells the YAGI team): no event, no team notice, no
 * outbox row, no mail. The same organization lock and the same daily rule as a team request (20 project rows per
 * organization per rolling day, counted over every row; the studio's rate code `too_many_running`, as
 * `handoff.campaign` answers for the same limit). Idempotent on `requestId` per member.
 */
export async function createSelfBrandProject(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectCreated | StudioFailure> {
  const parsed = BrandProjectCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await spineSeat(sql, viewer, v.organizationId, true);
      await lockOrganization(sql, v.organizationId);
      // `brand_projects.request_id` is a uuid; the studio's keys are free strings (as ./handoff.ts does).
      const key = derivedUuid('brand-project-spine', v.organizationId, seat.userId, v.requestId);
      const prior = (
        await sql.query<{ id: string; origin: string }>('select id, origin from brand_projects where organization_id = $1 and created_by = $2 and request_id = $3', [
          v.organizationId,
          seat.userId,
          key,
        ])
      ).rows[0];
      if (prior) {
        if (prior.origin !== 'self') throw new StudioDenied('conflict');
        return { ok: true as const, project: await oneProject(sql, deps.media, v.organizationId, prior.id) };
      }
      const today = Number(
        (await sql.query<{ n: number }>("select count(*)::int as n from brand_projects where organization_id = $1 and created_at > now() - interval '1 day'", [v.organizationId]))
          .rows[0]?.n ?? 0,
      );
      if (today >= BRAND_PROJECT_LIMITS.createPerDay) throw new StudioDenied('too_many_running');
      const id = randomUUID();
      await sql.query(
        `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
          values ($1, $2, $3, '', 'studio', 'active', false, 'self', $4, $5)`,
        [id, v.organizationId, v.title, seat.userId, key],
      );
      return { ok: true as const, project: await oneProject(sql, deps.media, v.organizationId, id) };
    }),
  );
}

/**
 * A run's whole family, from several handles at once: up to the first run of each chain, then down through
 * everything made from those runs' results (the rule of `job.assign_project`, ./job-projects.ts). Fill strips
 * and runs a member removed from the wall (`deleted_at`) are walked through but never returned, so never moved
 * (they are in no list; their filing is not touched). Every step stays in the organization: a `parent_output_id`
 * that points at another organization's result ends the walk there, and another organization's run made from one
 * of ours is never reached.
 */
const FAMILY_SQL = `
  with recursive up(id, parent_output_id, depth) as (
      select j.id, j.parent_output_id, 0 from brand_studio_jobs j where j.id = any($1::uuid[]) and j.organization_id = $2
    union all
      select pj.id, pj.parent_output_id, up.depth + 1
        from up
        join brand_studio_outputs o on o.id = up.parent_output_id
        join brand_studio_jobs pj on pj.id = o.job_id and pj.organization_id = $2
       where up.depth < 64
  ), tops as (
    select distinct u.id from up u
     where not exists (select 1 from brand_studio_outputs o join up p on p.id = o.job_id where o.id = u.parent_output_id)
  ), family(id, depth) as (
      select id, 0 from tops
    union all
      select cj.id, family.depth + 1
        from family
        join brand_studio_outputs o on o.job_id = family.id
        join brand_studio_jobs cj on cj.parent_output_id = o.id and cj.organization_id = $2
       where family.depth < 64
  )
  select distinct j.id from family f join brand_studio_jobs j on j.id = f.id
   where j.organization_id = $2 and ${NOT_FILL_RUN('j')} and j.deleted_at is null
   order by j.id`;

const unique = (ids: readonly string[] | undefined): string[] => [...new Set((ids ?? []).map((id) => id.toLowerCase()))];

async function countLive(sql: SqlRunner, table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects', ids: string[], organizationId: string, extra = ''): Promise<number> {
  if (ids.length === 0) return 0;
  return Number(
    (await sql.query<{ n: number }>(`select count(*)::int as n from ${table} t where t.id = any($1::uuid[]) and t.organization_id = $2 and t.deleted_at is null ${extra}`, [ids, organizationId]))
      .rows[0]?.n ?? 0,
  );
}

/**
 * `project.move` (§4.3): file runs (with their families), uploads and films in a selectable project, or take them
 * out (`projectId: null`). One transaction under the organization lock; if any id is not this organization's,
 * is deleted, or is a fill strip, the whole call is `not_found` and nothing moves. Moving out of a hidden or
 * archived project is allowed: only the target is judged. `preview` writes nothing and answers the same.
 */
export async function moveToBrandProject(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectMoved | StudioFailure> {
  const parsed = BrandProjectMoveSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const jobIds = unique(v.jobIds);
  const assetIds = unique(v.assetIds);
  const filmIds = unique(v.filmIds);
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      await spineSeat(sql, viewer, v.organizationId, true);
      await lockOrganization(sql, v.organizationId);
      if (v.projectId && !(await isSelectableProject(sql, v.organizationId, v.projectId))) throw new StudioDenied('not_found');
      if ((await countLive(sql, 'brand_studio_jobs', jobIds, v.organizationId, `and ${NOT_FILL_RUN('t')}`)) !== jobIds.length) throw new StudioDenied('not_found');
      if ((await countLive(sql, 'brand_studio_assets', assetIds, v.organizationId)) !== assetIds.length) throw new StudioDenied('not_found');
      if ((await countLive(sql, 'brand_studio_video_projects', filmIds, v.organizationId)) !== filmIds.length) throw new StudioDenied('not_found');
      const family = jobIds.length ? (await sql.query<{ id: string }>(FAMILY_SQL, [jobIds, v.organizationId])).rows.map((row) => String(row.id)) : [];
      if (!v.preview) {
        if (family.length) await sql.query('update brand_studio_jobs set brand_project_id = $3 where organization_id = $2 and id = any($1::uuid[])', [family, v.organizationId, v.projectId]);
        if (assetIds.length) await sql.query('update brand_studio_assets set brand_project_id = $3 where organization_id = $2 and id = any($1::uuid[])', [assetIds, v.organizationId, v.projectId]);
        if (filmIds.length) await sql.query('update brand_studio_video_projects set brand_project_id = $3 where organization_id = $2 and id = any($1::uuid[])', [filmIds, v.organizationId, v.projectId]);
      }
      return { ok: true as const, projectId: v.projectId, jobIds: family, assetIds, filmIds };
    }),
  );
}
