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
 *    project the staff hid, answers `not_found` to a write, exactly like a project that does not exist;
 *  - which projects a member may see, with what is filed in them (`VISIBLE_PROJECTS`, spine rules R-A): its own
 *    projects in any status, and its team projects that are shown to it in any status. A finished project keeps its
 *    files; a team project the staff hid is never visible to members and its files read as 미분류;
 *  - where new work is filed (`brandProjectForNew`);
 *  - the three operations `project.list`, `project.create`, `project.move`;
 *  - where a filed run, upload or film is SHOWN (`SHOWN_PROJECT_JOIN`, `SHOWN_ASSET_PROJECT_JOIN`, `UNFILED_ROWS`,
 *    `UNFILED_ASSETS`, the `with…BrandProjects` helpers), which the assets page's reads (./brand-project-files.ts) build on;
 *  - which library entries are a saved result shown as its result instead (`SHADOWED_SAVED_COPY`, spine rules R-A).
 * Every project, run, upload and film id is checked against the organization inside the transaction that writes.
 * The old `brand_studio_jobs.project_id` (`BRAND_STUDIO_PROJECTS`, ./job-projects.ts) is neither read nor written.
 * Nothing here sends an event, a team notice, a mail or a Slack message.
 */
import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { resetSpineProbe, spineColumnsReady } from '@/lib/brands/project-origin';
import { moveFileThreads } from '@/lib/brand-rooms/members-schema';
import { brandProjectSpineFor } from '@/lib/flags';
import { lockOrganization, requireCreate, StudioDenied, studioSeat, type StudioSeat } from './access';
import {
  BRAND_MATERIAL_ROLES,
  BRAND_PROJECT_LIMITS,
  BRAND_PROJECT_OPERATIONS,
  BrandProjectCreateSchema,
  BrandProjectListSchema,
  BrandProjectMoveSchema,
  type BrandMaterialRole,
  type BrandProjectOperation,
  type StudioBrandProject,
  type StudioBrandProjectCreated,
  type StudioBrandProjectList,
  type StudioBrandProjectMoved,
  type StudioBrandProjectStatus,
  type StudioFailure,
  type StudioStateScope,
} from './contracts';
import { IMAGE_RUNS, LIBRARY_ASSETS, SOUND_RUNS, VIDEO_RUNS, VISIBLE_OUTPUT } from './list-rules';
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

/* ---------------------------------------------------------------- visible */

/**
 * "A member may see this project, and what is filed in it stays filed there" (spine rules R-A, the founder's decision 1),
 * for the `brand_projects` row named `alias` (needs migration 0194, spine code only): the brand's own project in any
 * status (active, or completed = 보관), and a team project while it is shown to the brand (`client_visible`) in any status
 * (requested, active, completed, cancelled). A team project the staff hid is never visible, whatever its status: its
 * files read as 미분류, exactly as before (docs/BRAND-PROJECT-SPINE.md §3.4). Reads use this; writes keep
 * `SELECTABLE_PROJECTS` (a finished project takes no new work). Every selectable project is visible.
 */
export const VISIBLE_PROJECTS = (alias: string): string => `(${alias}.origin = 'self' or (${alias}.origin = 'team' and ${alias}.client_visible))`;

/**
 * A project a member may open on the assets page (`project.files`): visible, of this organization. Null when not (hidden,
 * another organization's, made up, malformed); otherwise whether it can still take new work, which decides where its
 * role-tagged uploads show (`SHOWN_ASSET_PROJECT_JOIN`). One statement on the primary key.
 */
export async function visibleProjectOf(sql: SqlRunner, organizationId: string, projectId: string): Promise<{ selectable: boolean } | null> {
  if (!UUID.test(projectId)) return null;
  const row = (
    await sql.query<{ selectable: boolean }>(
      `select ${SELECTABLE_PROJECTS('p')} as selectable from brand_projects p where p.id = $1 and p.organization_id = $2 and ${VISIBLE_PROJECTS('p')}`,
      [projectId, organizationId],
    )
  ).rows[0];
  return row ? { selectable: row.selectable === true } : null;
}

const ROLE_LIST = BRAND_MATERIAL_ROLES.map((role) => `'${role}'`).join(', ');
/** A library entry with a brand-material role (`BRAND_MATERIAL_ROLES`); one rule, here and in `isBrandMaterial`. */
export const BRAND_MATERIAL = (alias: string): string => `${alias}.role in (${ROLE_LIST})`;
export const NOT_BRAND_MATERIAL = (alias: string): string => `(${alias}.role is null or ${alias}.role not in (${ROLE_LIST}))`;
export const isBrandMaterial = (role: string | null | undefined): role is BrandMaterialRole =>
  typeof role === 'string' && (BRAND_MATERIAL_ROLES as readonly string[]).includes(role);

/**
 * Where a library entry (`asset`) is shown, on the project row `project`: a project that can take new work shows every
 * entry filed in it; a finished visible project shows its entries WITHOUT a brand-material role. A role-tagged entry of a
 * finished project stays under 브랜드 자료, exactly as before R-A (the founder kept that); a hidden project shows none.
 */
const ASSET_SHOWN_IN = (project: string, asset: string): string =>
  `(${SELECTABLE_PROJECTS(project)} or (${VISIBLE_PROJECTS(project)} and ${NOT_BRAND_MATERIAL(asset)}))`;

/* ----------------------------------------------------------- saved results */

/**
 * A SAVED RESULT shown as its result instead (spine rules R-A, the founder's decision 4: a saved result shows once), for
 * the `brand_studio_assets` row named `alias`: a library copy the studio made from a result (`source = 'generation'`,
 * linked both ways: its `source_output_id` and that result's `saved_asset_id`) while the result is one a screen shows
 * (`VISIBLE_OUTPUT`) of a run the lists list (an image, video or sound run, never a fill strip or the editor's export,
 * not removed). The result is then the one tile, in its run's project; once the result or its run is gone, the copy
 * shows on its own again. A genuine upload (`source = 'upload'`, even with a result's very bytes) and a post-production
 * file with no result behind it (`source = 'generation'`, `source_output_id` null: an upscale, a track, an effect) are
 * never shadowed. Two primary-key lookups per entry (brand_studio_outputs_pkey, brand_studio_jobs_pkey): no scan. It is a
 * correlated SCALAR subquery on purpose: Postgres may turn an `exists` into a hashed subplan that reads the whole results and
 * runs tables (it did on the local database); a scalar one is always probed by key. Spine code only: the spine needs 0194,
 * so 0090's `deleted_at` on runs exists (as `FAMILY_SQL` assumes).
 */
export const SHADOWED_SAVED_COPY = (alias: string): string =>
  `(${alias}.source = 'generation' and ${alias}.source_output_id is not null and coalesce((
     select true from brand_studio_outputs so
       join brand_studio_jobs sr on sr.id = so.job_id and sr.organization_id = so.organization_id
      where so.id = ${alias}.source_output_id and so.organization_id = ${alias}.organization_id and so.saved_asset_id = ${alias}.id
        and ${VISIBLE_OUTPUT('so')} and ((${IMAGE_RUNS('sr')}) or (${VIDEO_RUNS('sr')}) or (${SOUND_RUNS('sr')})) and sr.deleted_at is null
      limit 1), false))`;

/**
 * The library entries the assets surfaces list and count (the by-project groups, 미분류, 브랜드 자료, the cards, `project.files`):
 * the panel's own rule (`LIBRARY_ASSETS`) less the saved results shown as their result. The studio's reference rail (the
 * studio state's `assets`) keeps `LIBRARY_ASSETS` alone: a saved copy stays there.
 */
export const LISTED_LIBRARY_ASSETS = (alias: string): string => `${LIBRARY_ASSETS(alias)} and not ${SHADOWED_SAVED_COPY(alias)}`;

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
 * The SHOWN project of a filed run or film (`row`, with `organization_id` and `brand_project_id`), as a left join naming
 * it `alias`: the row's project while members may see it (`VISIBLE_PROJECTS`: a finished project keeps its files), else
 * no project row (= 미분류: not filed, or filed in a team project the staff hid). Every answer and every count of the ASSETS
 * surfaces (./brand-project-files.ts) that says where something is filed uses this join or its complement `UNFILED_ROWS`
 * (library entries: `SHOWN_ASSET_PROJECT_JOIN` / `UNFILED_ASSETS`), never a copy of the rule; the studio's answers use
 * `STUDIO_PROJECT_JOIN` / `UNFILED_RUNS` (origin/main's rule). Needs migration 0194 (spine code only).
 */
export const SHOWN_PROJECT_JOIN = (alias: string, row: string): string =>
  `left join brand_projects ${alias} on ${alias}.id = ${row}.brand_project_id and ${alias}.organization_id = ${row}.organization_id and ${VISIBLE_PROJECTS(alias)}`;

/**
 * The SHOWN project of a library entry (`row`), as a left join naming it `alias`: its project while that project can take
 * new work; in a finished visible project only when the entry has no brand-material role (a role-tagged entry of a
 * finished project is 브랜드 자료, as before R-A); none for a hidden project (= 미분류 or 브랜드 자료 by its role).
 */
export const SHOWN_ASSET_PROJECT_JOIN = (alias: string, row: string): string =>
  `left join brand_projects ${alias} on ${alias}.id = ${row}.brand_project_id and ${alias}.organization_id = ${row}.organization_id and ${ASSET_SHOWN_IN(alias, row)}`;

/**
 * The STUDIO's project of a filed row (spine rules R-A follow-up: the studio keeps origin/main's rule): the row's project
 * while it can take new work, else none. The studio screens put a run on the wall whose open project equals its
 * `brandProjectId` (components/brand-studio/use-studio.ts, sound/sound-studio.tsx, video/session-runs.ts, the films of
 * video/workspace.tsx), and a finished project does not open in a studio, so a run of a finished project (and every run
 * made from one of its results, which keeps the family's project) must read as 미분류 there or it would leave every wall.
 * The assets surfaces (./brand-project-files.ts) use `SHOWN_PROJECT_JOIN` instead.
 */
const STUDIO_PROJECT_JOIN = (alias: string, row: string): string =>
  `left join brand_projects ${alias} on ${alias}.id = ${row}.brand_project_id and ${alias}.organization_id = ${row}.organization_id and ${SELECTABLE_PROJECTS(alias)}`;

type FiledTable = 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects';

/**
 * Which rule an answer's `brandProjectId` follows: `studio` (the studio state, poll, create and library answers, the sound
 * page, the films: origin/main's rule, a finished project reads as 미분류) or `assets` (the assets page's reads, spine rules
 * R-A: a finished project keeps its files).
 */
export type BrandProjectViewRule = 'studio' | 'assets';

/**
 * Adds the shown `brandProjectId` to `views` of `table` (one query, never one per row); unchanged while the spine
 * is closed for the organization (the key is then absent, not null). A library entry that is a saved result also gets
 * `sourceOutputId` (the result it was saved from; spine rules R-A), so a screen can show the pair once by the server's
 * own rule (components/brand-studio/asset-hub-model.ts `buildHubEntries`).
 */
async function withShownProjects<T extends { id: string }>(
  sql: SqlRunner,
  table: FiledTable,
  organizationId: string,
  views: T[],
  env: Env,
  rule: BrandProjectViewRule,
): Promise<Array<T & { brandProjectId?: string | null; sourceOutputId?: string }>> {
  if (views.length === 0 || !(await brandProjectSpineOpen(sql, organizationId, env))) return views;
  const assets = table === 'brand_studio_assets';
  const join = rule === 'studio' ? STUDIO_PROJECT_JOIN('p', 't') : assets ? SHOWN_ASSET_PROJECT_JOIN('p', 't') : SHOWN_PROJECT_JOIN('p', 't');
  const shown = new Map(
    (
      await sql.query<{ id: string; brand_project_id: string | null; source_output_id?: string | null }>(
        `select t.id::text as id, p.id::text as brand_project_id${assets ? ", case when t.source = 'generation' then t.source_output_id::text end as source_output_id" : ''}
           from ${table} t
           ${join}
          where t.organization_id = $1 and t.id = any($2::uuid[])`,
        [organizationId, views.map((view) => view.id)],
      )
    ).rows.map((row) => [String(row.id).toLowerCase(), row] as const),
  );
  return views.map((view) => {
    const row = shown.get(view.id.toLowerCase());
    if (!row) return view;
    return {
      ...view,
      brandProjectId: row.brand_project_id ? String(row.brand_project_id) : null,
      ...(row.source_output_id ? { sourceOutputId: String(row.source_output_id).toLowerCase() } : {}),
    };
  });
}

/**
 * `brandProjectId` is OPT-IN (default deny): no shared view builder adds it (`jobView`, `assetView` and the films'
 * `toSummary` never do). Only an answer given to a workspace member adds it, through these three helpers: the studio
 * state and poll (members, not project guests), the create and library answers of `POST /api/brand-studio`, the
 * films' list, read and mutation answers, the member branch of the sound studio page, and the assets page's reads
 * (./brand-project-files.ts). Staff who are not members, project guests, MCP and workflows never receive it.
 *
 * What the customer sees (§4.2): the stored filing is kept (a family is never split). By default (`rule: 'studio'`, every
 * studio answer) a project that can no longer take new work (hidden, completed, cancelled, archived) reads as 미분류:
 * `brandProjectId: null`, exactly as on origin/main, so the studio walls keep those runs. The assets page's reads pass
 * `'assets'` (spine rules R-A): a project members may see keeps its files, finished or not; a hidden one reads null; a
 * role-tagged library entry of a finished project reads null too (브랜드 자료). One query per answer, never one per row.
 */
export async function withBrandProjects<T extends { id: string }>(
  sql: SqlRunner,
  organizationId: string,
  views: T[],
  env: Env = process.env,
  rule: BrandProjectViewRule = 'studio',
): Promise<Array<T & { brandProjectId?: string | null }>> {
  return withShownProjects(sql, 'brand_studio_jobs', organizationId, views, env, rule);
}

/** The same for films (`brand_studio_video_projects`): members' answers only. */
export async function withFilmBrandProjects<T extends { id: string }>(
  sql: SqlRunner,
  organizationId: string,
  films: T[],
  env: Env = process.env,
  rule: BrandProjectViewRule = 'studio',
): Promise<Array<T & { brandProjectId?: string | null }>> {
  return withShownProjects(sql, 'brand_studio_video_projects', organizationId, films, env, rule);
}

/**
 * The same for library entries (`brand_studio_assets`, slice 2a): members' answers only (the studio state, the
 * answers of `asset.complete`, `asset.update` and `asset.from_output`, the assets page's reads), by the same two rules
 * (studio by default; `'assets'`: `SHOWN_ASSET_PROJECT_JOIN`). Whether a null entry is 브랜드 자료 or 미분류 is its `role`
 * (`BRAND_MATERIAL_ROLES`). A saved result also carries `sourceOutputId` (either rule).
 */
export async function withAssetBrandProjects<T extends { id: string }>(
  sql: SqlRunner,
  organizationId: string,
  assets: T[],
  env: Env = process.env,
  rule: BrandProjectViewRule = 'studio',
): Promise<Array<T & { brandProjectId?: string | null }>> {
  return withShownProjects(sql, 'brand_studio_assets', organizationId, assets, env, rule);
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
 * "미분류" for filed runs and films (`alias` = a run's or a film's table): not filed, or filed in a project members may not
 * see (a team project the staff hid): the complement of `SHOWN_PROJECT_JOIN`. Needs migration 0194 (spine code only). `$1`
 * must be the organization.
 */
export const UNFILED_ROWS = (alias: string): string =>
  `(${alias}.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = ${alias}.brand_project_id and sp.organization_id = $1 and ${VISIBLE_PROJECTS('sp')}))`;

/**
 * Library entries with no shown project (`alias` = the entries' table): the complement of `SHOWN_ASSET_PROJECT_JOIN`.
 * With a brand-material role they are 브랜드 자료 (not filed, filed in a finished project, or in a hidden one: as before R-A);
 * without one they are 미분류 (not filed, or in a hidden project). `$1` must be the organization.
 */
export const UNFILED_ASSETS = (alias: string): string =>
  `(${alias}.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = ${alias}.brand_project_id and sp.organization_id = $1 and ${ASSET_SHOWN_IN('sp', alias)}))`;

/**
 * The studio state's 미분류 runs (`scope: unfiled`; spine rules R-A follow-up: the studio keeps origin/main's rule): not
 * filed, or filed in a project that can no longer take new work (hidden, completed, cancelled, archived). A finished
 * project does not open in a studio, so its runs, and the runs made from its results, stay on this wall. Exactly
 * origin/main's text. The assets page's 미분류 is `UNFILED_ROWS`. `$1` must be the organization.
 */
export const UNFILED_RUNS = (alias: string): string =>
  `(${alias}.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = ${alias}.brand_project_id and sp.organization_id = $1 and ${SELECTABLE_PROJECTS('sp')}))`;

/**
 * The runs' filter for a scoped studio state load, or null for today's query: no scope, a project guest (the
 * scope is ignored, as everything else of the spine), or the spine closed. A project must be selectable
 * (`not_found` otherwise: a studio is where new work is made, so a finished project does not open there, spine rules
 * R-A kept this); `unfiled` is `UNFILED_RUNS` (origin/main's rule: a finished project's runs are on this wall). Runs
 * inside the reading transaction.
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
  /** Only in `visibleBrandProjects`' statement. */
  status?: string;
  selectable?: boolean;
}

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/**
 * Projects with their latest activity (the later of the row's own `updated_at` and its newest run that is not a
 * fill strip) and, in one lateral join, the newest ready image or video result filed in each.
 */
function projectsQuery(where: string, extra = ''): string {
  return `select p.id, p.title, p.origin,${extra}
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
 * Every spine operation seats with this (the assets page's reads too, ./brand-project-files.ts).
 */
export async function spineSeat(sql: SqlRunner, viewer: Viewer, organizationId: string, write: boolean): Promise<StudioSeat> {
  const seat = await studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true });
  if (seat.role === 'guest') throw new StudioDenied('not_found');
  if (write) requireCreate(seat);
  return seat;
}

/**
 * The organization a spine operation names, if the spine is open for it; otherwise null, and the caller answers
 * exactly what an unknown operation answers (`invalid`) before anything else is judged.
 */
export async function spineOrganization(sql: SqlRunner, input: unknown): Promise<string | null> {
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || !(await brandProjectSpineOpen(sql, organizationId))) return null;
  return organizationId;
}

export type BrandProjectOperationResult = StudioBrandProjectList | StudioBrandProjectCreated | StudioBrandProjectMoved | StudioFailure;

/**
 * `project.list` / `project.create` / `project.move` through `POST /api/brand-studio`. While the spine is closed for
 * the organization (or the request names none) the answer is exactly what an unknown operation answers
 * (`invalid`), before anything else is judged.
 */
export async function runBrandProjectOperation(deps: StudioDeps, viewer: Viewer, operation: BrandProjectOperation, input: unknown): Promise<BrandProjectOperationResult> {
  if (!(await spineOrganization(deps.sql, input))) return failure('invalid');
  switch (operation) {
    case 'project.list':
      return listBrandProjects(deps, viewer, input);
    case 'project.create':
      return createSelfBrandProject(deps, viewer, input);
    case 'project.move':
      return moveToBrandProject(deps, viewer, input);
  }
}

/**
 * The projects new work can be filed in, most recent activity first, at most `listMax`: what `project.list` answers
 * (the assets page's overview lists the very same, ./brand-project-files.ts). It takes the member's seat from
 * `spineSeat`, not an organization id, so it cannot be called for an organization nobody seated; its importers are
 * pinned to the spine files (tests/brand-studio/spine/assets-page.test.ts).
 */
export async function selectableProjects(sql: SqlRunner, media: StudioMediaStore, seat: StudioSeat): Promise<StudioBrandProject[]> {
  const rows = (
    await sql.query<ProjectRow>(`${projectsQuery(`p.organization_id = $1 and ${SELECTABLE_PROJECTS('p')}`)} order by last_activity_at desc, p.id desc limit $2`, [
      seat.organizationId,
      BRAND_PROJECT_LIMITS.listMax,
    ])
  ).rows;
  return rows.map((row) => projectView(row, media));
}

/** A listed project with what the 전체 view marks it by (spine rules R-A). */
export interface ListedBrandProject {
  project: StudioBrandProject;
  status: StudioBrandProjectStatus;
  selectable: boolean;
}

/**
 * The status a screen marks a project by: `open` while it can take new work (an own project while active, a shown team
 * project while requested or active); else a team project's `completed` or `cancelled`, and an own project's `archived`
 * (보관: `status = 'completed'`, or any other status an own project could be put in).
 */
export function brandProjectStatusOf(origin: string, status: string, selectable: boolean): StudioBrandProjectStatus {
  if (selectable) return 'open';
  if (origin === 'self') return 'archived';
  return status === 'cancelled' ? 'cancelled' : 'completed';
}

/**
 * Every project a member may see (`VISIBLE_PROJECTS`: finished ones too), most recent activity first, at most `listMax`,
 * with its status (spine rules R-A, the 전체 view of `project.cards` and `project.overview`). Seated like
 * `selectableProjects`; its importers are pinned to the spine files.
 */
export async function visibleBrandProjects(sql: SqlRunner, media: StudioMediaStore, seat: StudioSeat): Promise<ListedBrandProject[]> {
  const rows = (
    await sql.query<ProjectRow>(
      `${projectsQuery(`p.organization_id = $1 and ${VISIBLE_PROJECTS('p')}`, ` p.status, ${SELECTABLE_PROJECTS('p')} as selectable,`)} order by last_activity_at desc, p.id desc limit $2`,
      [seat.organizationId, BRAND_PROJECT_LIMITS.listMax],
    )
  ).rows;
  return rows.map((row) => ({
    project: projectView(row, media),
    status: brandProjectStatusOf(String(row.origin), String(row.status ?? ''), row.selectable === true),
    selectable: row.selectable === true,
  }));
}

/**
 * How many projects the two views hold, uncut (the 진행 중 / 전체 switch draws these): `active` = can take new work,
 * `all` = visible. One statement (idx_brand_projects_origin).
 */
export async function brandProjectTotals(sql: SqlRunner, seat: StudioSeat): Promise<{ active: number; all: number }> {
  const row = (
    await sql.query<{ active: number; visible: number }>(
      `select (count(*) filter (where ${SELECTABLE_PROJECTS('p')}))::int as active, count(*)::int as visible
         from brand_projects p
        where p.organization_id = $1 and ${VISIBLE_PROJECTS('p')}`,
      [seat.organizationId],
    )
  ).rows[0];
  return { active: Number(row?.active ?? 0), all: Number(row?.visible ?? 0) };
}

/** `project.list`: the projects new work can be filed in, most recent activity first, at most 100. */
export async function listBrandProjects(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectList | StudioFailure> {
  const parsed = BrandProjectListSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await spineSeat(sql, viewer, v.organizationId, false);
      return { ok: true as const, projects: await selectableProjects(sql, deps.media, seat) };
    }),
  );
}

/**
 * `project.create`: a project of the brand's own, by name only (§4.5). Its own insert, never the team request's
 * `createProject` (that one validates the commission form and tells the YAGI team): no event, no team notice, no
 * outbox row, no mail. The same organization lock as a team request, and a daily count of its own: 20 of the
 * organization's own projects (`origin = 'self'`) per rolling day, team projects not counted. A team request counts
 * team projects only (`TEAM_PROJECTS` in `createProject`), so neither side can use up the other's. Refused with the
 * studio's rate code `too_many_running`, as `handoff.campaign` answers for the team limit. Idempotent on
 * `requestId` per member.
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
        (
          await sql.query<{ n: number }>(
            "select count(*)::int as n from brand_projects where organization_id = $1 and origin = 'self' and created_at > now() - interval '1 day'",
            [v.organizationId],
          )
        ).rows[0]?.n ?? 0,
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
 * The saved results of `family`'s results that are shown as those results (`SHADOWED_SAVED_COPY`): they move with the run
 * (spine rules R-A), so the one tile never leaves a hidden copy behind in another project. Through each result's
 * `saved_asset_id` (brand_studio_outputs_slot, then brand_studio_assets_pkey), and only a copy saved from THAT result
 * (`source_output_id`): a result linked by equal bytes to another result's copy does not carry that copy.
 */
const CARRIED_COPIES_SQL = `
  select a.id::text as id from brand_studio_outputs o
    join brand_studio_assets a on a.id = o.saved_asset_id and a.organization_id = o.organization_id and a.source_output_id = o.id
   where o.organization_id = $2 and o.job_id = any($1::uuid[]) and ${LIBRARY_ASSETS('a')} and ${SHADOWED_SAVED_COPY('a')}
   order by a.id`;

/**
 * `project.move` (§4.3): file runs (with their families), uploads and films in a selectable project, or take them
 * out (`projectId: null`). One transaction under the organization lock; if any id is not this organization's,
 * is deleted, or is a fill strip, the whole call is `not_found` and nothing moves. Moving out of a hidden or
 * archived project is allowed: only the target is judged. `preview` writes nothing and answers the same.
 * A run's saved results that are shown as its results move with it (spine rules R-A), with their threads; the answer
 * names them in `savedCopyIds` (only when there are any). An upload moves alone, as before.
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
      const requested = new Set(assetIds);
      const copies = family.length
        ? (await sql.query<{ id: string }>(CARRIED_COPIES_SQL, [family, v.organizationId])).rows.map((row) => String(row.id).toLowerCase()).filter((id) => !requested.has(id))
        : [];
      const moving = [...assetIds, ...copies];
      if (!v.preview) {
        if (family.length) await sql.query('update brand_studio_jobs set brand_project_id = $3 where organization_id = $2 and id = any($1::uuid[])', [family, v.organizationId, v.projectId]);
        if (moving.length) await sql.query('update brand_studio_assets set brand_project_id = $3 where organization_id = $2 and id = any($1::uuid[])', [moving, v.organizationId, v.projectId]);
        if (filmIds.length) await sql.query('update brand_studio_video_projects set brand_project_id = $3 where organization_id = $2 and id = any($1::uuid[])', [filmIds, v.organizationId, v.projectId]);
        // The members threads about the moved files follow them (보내기, §8.3), in this same transaction: a failed move
        // leaves the files and their threads where they were. Nothing is sent.
        await moveFileThreads(sql, v.organizationId, { jobIds: family, assetIds: moving, projectId: v.projectId });
      }
      return { ok: true as const, projectId: v.projectId, jobIds: family, assetIds, filmIds, ...(copies.length ? { savedCopyIds: copies } : {}) };
    }),
  );
}
