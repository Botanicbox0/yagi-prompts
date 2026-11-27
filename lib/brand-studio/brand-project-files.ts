/**
 * The spine's member reads by project: the assets page's (docs/BRAND-PROJECT-SPINE.md §7, slice 2a) and the 직접 만들기
 * home's (§5, slice 3a). Reads only; nothing here writes, sends, marks read or counts usage.
 *
 *   project.overview  the 프로젝트별 tab in one answer: per listed project (`filter` absent or `active`: the same set and
 *                     order as `project.list`; `all`: every project a member may see, finished ones too), then 미분류
 *                     and 브랜드 자료, the counts by kind and a few cover tiles;
 *   project.files     one scope's files (a project a member may see, `unfiled` or `brand_materials`), optionally one
 *                     kind, newest first, page by page with a keyset cursor on (created_at, id);
 *   project.cards     the home's project cards: the overview's projects with the overview's own counts, up to three
 *                     pictures, the newest file (what `project.files` lists first) and who added it, and for a team
 *                     project its room's unread count and stage line; then the overview's 미분류.
 *
 * Spine rules R-A: a finished project keeps its files (`VISIBLE_PROJECTS`; a role-tagged upload of a finished project
 * stays 브랜드 자료, as before), and a saved result shows once, as its result (`LISTED_LIBRARY_ASSETS`). The views of these
 * reads pass `'assets'` to the `with…BrandProjects` helpers; every studio answer keeps origin/main's rule (`'studio'`).
 *
 * Who: workspace members (owner, editor, viewer) through the spine's own gate (`spineSeat`: membership → sandbox
 * hardline → feature policy → not a project guest), exactly as `project.list`. While the spine is closed for the
 * organization both answer what an unknown operation answers (`invalid`), before anything is judged
 * (`spineOrganization`). Only lib/brand-studio/service.ts dispatches them (tests/brand-studio/spine/assets-page.test.ts).
 *
 * What is counted and listed is exactly what a member can open, by the rules the studio state already uses,
 * imported and never copied: runs by medium (`IMAGE_RUNS`, `VIDEO_RUNS`, and the sound studio's `SOUND_RUNS`), live
 * runs (`liveRunsFilter`), results a screen shows (`VISIBLE_OUTPUT`), library entries (`LIBRARY_ASSETS`), listed films
 * (`LISTED_FILMS`). Where a file is filed is its SHOWN project (`SHOWN_PROJECT_JOIN` / `UNFILED_ROWS`, for library
 * entries `SHOWN_ASSET_PROJECT_JOIN` / `UNFILED_ASSETS`, ./brand-projects.ts): its project while members may see it,
 * else none. This module reads brand_projects only through those spine fragments, `selectableProjects`, `visibleBrandProjects`,
 * `visibleProjectOf` and `brandProjectTotals`; it is a spine file (tests/brand-studio/spine/team-guard.test.ts) and
 * nothing on the team side reaches it.
 *
 * The overview and the cards ask a fixed number of statements whatever the number of projects (grouped counts, windowed
 * covers, one statement per kind of fact); `project.files` asks one keyset statement for the page, then the page's views
 * by id. The cards read room facts (lib/brand-rooms/overview.ts) for team projects only, and only those projects the
 * brand is shown (`VISIBLE_PROJECTS`: a team project the staff hid has no card and nothing of it is read).
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRoomsOpen } from '@/lib/flags';
import { loadRoomStages, roomUnreadCounts, type RoomProjectStatus } from '@/lib/brand-rooms/overview';
import { StudioDenied, type StudioSeat } from './access';
import {
  BRAND_MATERIAL,
  LISTED_LIBRARY_ASSETS,
  NOT_BRAND_MATERIAL,
  SHOWN_ASSET_PROJECT_JOIN,
  SELECTABLE_PROJECTS,
  SHOWN_PROJECT_JOIN,
  UNFILED_ASSETS,
  UNFILED_ROWS,
  VISIBLE_PROJECTS,
  type ArchiveProjectRow,
  type VisibleBrandProjectInfo,
  archiveBrandProjectsPage,
  brandProjectTotals,
  countVisibleBrandProjects,
  isBrandMaterial,
  normalizeProjectQuery,
  selectableProjects,
  spineOrganization,
  spineSeat,
  visibleProjectOf,
  visibleBrandProjects,
  withAssetBrandProjects,
  withBrandProjects,
  withFilmBrandProjects,
  type ListedBrandProject,
} from './brand-projects';
import {
  BRAND_MATERIAL_ROLES,
  BRAND_PROJECT_CARD_LIMITS,
  BRAND_PROJECT_FILE_KINDS,
  BRAND_PROJECT_LIMITS,
  BRAND_PROJECT_READS,
  BrandProjectArchiveSchema,
  BrandProjectCardsSchema,
  BrandProjectFilesSchema,
  BrandProjectOverviewSchema,
  BrandProjectViewFilterSchema,
  type BrandMaterialRole,
  type BrandProjectFileItem,
  type BrandProjectFileKind,
  type BrandProjectRead,
  type BrandProjectViewFilter,
  type StudioBrandProject,
  type StudioBrandProjectActivity,
  type StudioBrandProjectArchive,
  type StudioBrandProjectArchiveCard,
  type StudioBrandProjectCard,
  type StudioBrandProjectCardCover,
  type StudioBrandProjectCards,
  type StudioBrandProjectCounts,
  type StudioBrandProjectCover,
  type StudioBrandProjectFiles,
  type StudioBrandProjectGroup,
  type StudioBrandProjectOverview,
  type StudioBrandProjectStage,
  type StudioBrandProjectSummary,
  type StudioBrandProjectTotals,
  type StudioFailure,
} from './contracts';
import { keepLiveProjectIds, liveProjectsOf, studioProjectsReady } from './job-projects';
import type { StudioMediaStore } from './media-store';
import { failure, guarded } from './outcome';
import { IMAGE_RUNS, SOUND_RUNS, VIDEO_RUNS, VISIBLE_OUTPUT, assetView, jobsByIds, liveRunsFilter, viewsOf } from './repo';
import type { AssetRow, StudioDeps } from './types';
import { LISTED_FILMS, filmSummariesByIds } from './video-projects/service';

export function isBrandProjectRead(value: unknown): value is BrandProjectRead {
  return typeof value === 'string' && (BRAND_PROJECT_READS as readonly string[]).includes(value);
}

export type BrandProjectReadResult =
  | StudioBrandProjectOverview
  | StudioBrandProjectFiles
  | StudioBrandProjectCards
  | StudioBrandProjectArchive
  | StudioFailure;

/** `project.overview` / `project.files` / `project.cards` / `project.archive` through `POST /api/brand-studio`; closed for the organization: `invalid`. */
export async function runBrandProjectRead(deps: StudioDeps, viewer: Viewer, operation: BrandProjectRead, input: unknown): Promise<BrandProjectReadResult> {
  if (!(await spineOrganization(deps.sql, input))) return failure('invalid');
  switch (operation) {
    case 'project.overview':
      return loadBrandProjectOverview(deps, viewer, input);
    case 'project.files':
      return loadBrandProjectFiles(deps, viewer, input);
    case 'project.cards':
      return loadBrandProjectCards(deps, viewer, input);
    case 'project.archive':
      return loadBrandProjectArchive(deps, viewer, input);
  }
}

/* ---------------------------------------------------------------- the rules */

type ResultKind = 'image' | 'video' | 'sound';
const RESULT_KINDS: readonly ResultKind[] = ['image', 'video', 'sound'];
/** Which runs' results count as which kind: the studio state's two lists and the sound studio's runs. */
const RUNS_OF: Record<ResultKind, (alias: string) => string> = { image: IMAGE_RUNS, video: VIDEO_RUNS, sound: SOUND_RUNS };
const anyOf = (kinds: readonly ResultKind[], alias: string): string => `(${kinds.map((kind) => `(${RUNS_OF[kind](alias)})`).join(' or ')})`;
const kindOf = (alias: string): string => `case ${RESULT_KINDS.map((kind) => `when ${RUNS_OF[kind](alias)} then '${kind}'`).join(' ')} end`;
/** A run is a file (a page item) once it has a result a screen shows. */
const RUN_HAS_FILE = (alias: string): string => `exists (select 1 from brand_studio_outputs o where o.job_id = ${alias}.id and ${VISIBLE_OUTPUT('o')})`;

// A library entry with no shown project is 브랜드 자료 by its role, else 미분류: `BRAND_MATERIAL` / `NOT_BRAND_MATERIAL` /
// `isBrandMaterial` (./brand-projects.ts, one rule for the shown-project join and here).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const emptyCounts = (): StudioBrandProjectCounts => ({ image: 0, video: 0, sound: 0, upload: 0, film: 0 });

/* ------------------------------------------------------------------ overview */

interface CoverRow {
  bucket: string | null;
  id: string;
  job_id: string;
  kind: string;
  storage_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  created_at: Date | string;
}

function coverView(row: CoverRow, media: StudioMediaStore): StudioBrandProjectCover {
  return {
    outputId: String(row.id),
    jobId: String(row.job_id),
    kind: row.kind === 'video' ? 'video' : 'image',
    url: media.url(row.storage_key),
    thumbUrl: row.thumb_key ? media.url(row.thumb_key) : null,
    width: row.width ?? null,
    height: row.height ?? null,
    createdAt: iso(row.created_at),
  };
}

/** The groups both the assets page's overview and the home's cards are drawn from: one computation, never two. */
interface ProjectGroups {
  /** The listed projects: `project.list`'s answer (`active`), or every visible project (`all`), with their status. */
  listed: ListedBrandProject[];
  /** A copy of the counts of a project (null = 미분류). */
  countsOf(projectId: string | null): StudioBrandProjectCounts;
  /** The cover tiles of a project (null = 미분류): at most `overviewCovers`, newest first. */
  coversOf(projectId: string | null): StudioBrandProjectCover[];
  /** 브랜드 자료 by role. */
  byRole: Record<BrandMaterialRole, number>;
  /** The files shown in finished projects (visible, not selectable), every one of them (uncut by `listMax`). */
  finished: StudioBrandProjectCounts;
  /** The live-runs filter on `j`, as read once for this transaction. */
  live: string;
}

/**
 * After the seat: the project list, three grouped counts (results, library entries, films) and one windowed cover
 * statement, whatever the number of projects (the column probes are remembered). Each count is grouped by the shown
 * project and whether that project can still take work, so the files of finished projects are known apart.
 */
async function projectGroups(sql: SqlRunner, media: StudioMediaStore, seat: StudioSeat, filter: BrandProjectViewFilter): Promise<ProjectGroups> {
  const organizationId = seat.organizationId;
  const listed: ListedBrandProject[] =
    filter === 'all'
      ? await visibleBrandProjects(sql, media, seat)
      : (await selectableProjects(sql, media, seat)).map((project) => ({ project, status: 'open' as const, selectable: true }));
  const live = await liveRunsFilter(sql, 'j');
  const covers = BRAND_PROJECT_LIMITS.overviewCovers;
  const selectable = `coalesce(${SELECTABLE_PROJECTS('sp')}, false) as selectable`;
  // Results by shown project and kind (indexes: idx_brand_studio_jobs_org, brand_studio_outputs_slot (job_id, idx)).
  const results = (
    await sql.query<{ bucket: string | null; selectable: boolean; kind: ResultKind; n: number }>(
      `select sp.id::text as bucket, ${selectable}, ${kindOf('j')} as kind, count(*)::int as n
         from brand_studio_jobs j
         join brand_studio_outputs o on o.job_id = j.id
         ${SHOWN_PROJECT_JOIN('sp', 'j')}
        where j.organization_id = $1 and ${anyOf(RESULT_KINDS, 'j')} ${live} and ${VISIBLE_OUTPUT('o')}
        group by 1, 2, 3`,
      [organizationId],
    )
  ).rows;
  // Library entries by shown project and role (idx_brand_studio_assets_org; a saved result shown as its result is left out).
  const uploads = (
    await sql.query<{ bucket: string | null; selectable: boolean; role: string | null; n: number }>(
      `select sp.id::text as bucket, ${selectable}, a.role, count(*)::int as n
         from brand_studio_assets a
         ${SHOWN_ASSET_PROJECT_JOIN('sp', 'a')}
        where a.organization_id = $1 and ${LISTED_LIBRARY_ASSETS('a')}
        group by 1, 2, 3`,
      [organizationId],
    )
  ).rows;
  // Films by shown project (idx_brand_studio_video_projects_org).
  const films = (
    await sql.query<{ bucket: string | null; selectable: boolean; n: number }>(
      `select sp.id::text as bucket, ${selectable}, count(*)::int as n
         from brand_studio_video_projects f
         ${SHOWN_PROJECT_JOIN('sp', 'f')}
        where f.organization_id = $1 and ${LISTED_FILMS('f')}
        group by 1, 2`,
      [organizationId],
    )
  ).rows;
  // The newest image and video results of every group at once.
  const coverRows = (
    await sql.query<CoverRow & { rn: number }>(
      `select c.* from (
         select sp.id::text as bucket, o.id, o.job_id, o.kind, o.storage_key, o.thumb_key, o.width, o.height, o.created_at,
                row_number() over (partition by sp.id order by o.created_at desc, o.id desc) as rn
           from brand_studio_jobs j
           join brand_studio_outputs o on o.job_id = j.id
           ${SHOWN_PROJECT_JOIN('sp', 'j')}
          where j.organization_id = $1 and ${anyOf(['image', 'video'], 'j')} ${live} and ${VISIBLE_OUTPUT('o')} and o.kind in ('image', 'video')
       ) c
       where c.rn <= $2
       order by c.rn`,
      [organizationId, covers],
    )
  ).rows;

  const counts = new Map<string, StudioBrandProjectCounts>();
  const finished = emptyCounts();
  const bucketOf = (bucket: string | null): StudioBrandProjectCounts => {
    const key = bucket ? bucket.toLowerCase() : '';
    let found = counts.get(key);
    if (!found) counts.set(key, (found = emptyCounts()));
    return found;
  };
  /** A finished project's bucket: shown, but no longer taking work. */
  const isFinished = (row: { bucket: string | null; selectable: boolean }) => Boolean(row.bucket) && row.selectable !== true;
  for (const row of results) {
    if (!row.kind) continue;
    bucketOf(row.bucket)[row.kind] += Number(row.n);
    if (isFinished(row)) finished[row.kind] += Number(row.n);
  }
  const byRole = Object.fromEntries(BRAND_MATERIAL_ROLES.map((role) => [role, 0])) as Record<BrandMaterialRole, number>;
  for (const row of uploads) {
    if (row.bucket) bucketOf(row.bucket).upload += Number(row.n);
    else if (isBrandMaterial(row.role)) byRole[row.role] += Number(row.n);
    else bucketOf(null).upload += Number(row.n);
    if (isFinished(row)) finished.upload += Number(row.n);
  }
  for (const row of films) {
    bucketOf(row.bucket).film += Number(row.n);
    if (isFinished(row)) finished.film += Number(row.n);
  }
  const coverLists = new Map<string, StudioBrandProjectCover[]>();
  for (const row of coverRows) {
    const key = row.bucket ? row.bucket.toLowerCase() : '';
    const list = coverLists.get(key) ?? [];
    list.push(coverView(row, media));
    coverLists.set(key, list);
  }
  return {
    listed,
    countsOf: (projectId) => ({ ...(projectId === null ? bucketOf(null) : (counts.get(projectId.toLowerCase()) ?? emptyCounts())) }),
    coversOf: (projectId) => coverLists.get(projectId === null ? '' : projectId.toLowerCase()) ?? [],
    byRole,
    finished,
    live,
  };
}

/**
 * The view a request names (spine rules R-A), judged after the seat: none (today's answer shape, `project.list`'s set),
 * `active` or `all`. Malformed: `invalid`.
 */
function viewFilterOf(raw: unknown): { named: boolean; filter: BrandProjectViewFilter } {
  const parsed = BrandProjectViewFilterSchema.safeParse(raw);
  if (!parsed.success) throw new StudioDenied('invalid');
  return parsed.data.filter ? { named: true, filter: parsed.data.filter } : { named: false, filter: 'active' };
}

/** What a group or a card carries for its project in the R-A shape (only when the request named a filter). */
const markOf = (named: boolean, item: ListedBrandProject): Pick<StudioBrandProjectGroup, 'status' | 'selectable'> =>
  named ? { status: item.status, selectable: item.selectable } : {};

/** How many projects each view (`active` / `all`) actually lists (capped at `listMax`), computed from `totals` with no extra query. */
const listedOf = (totals: StudioBrandProjectTotals): StudioBrandProjectTotals => ({
  active: Math.min(totals.active, BRAND_PROJECT_LIMITS.listMax),
  all: Math.min(totals.all, BRAND_PROJECT_LIMITS.listMax),
});

/**
 * `project.overview`. After the seat: the groups (`projectGroups`: five statements), then 브랜드 자료's newest entries
 * and their shown project: seven statements whatever the number of projects (the column probes are remembered); with a
 * `filter` named, one more (the two views' sizes and listed counts).
 */
export async function loadBrandProjectOverview(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectOverview | StudioFailure> {
  const parsed = BrandProjectOverviewSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const organizationId = parsed.data.organizationId;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await spineSeat(sql, viewer, organizationId, false);
      const view = viewFilterOf(raw);
      const groups = await projectGroups(sql, deps.media, seat, view.filter);
      // 브랜드 자료's newest entries: the same statement as its first page, cut to the cover count.
      const materialRows = (
        await sql.query<AssetRow>(
          `select a.* from brand_studio_assets a
            where a.organization_id = $1 and ${LISTED_LIBRARY_ASSETS('a')} and ${UNFILED_ASSETS('a')} and ${BRAND_MATERIAL('a')}
            order by a.created_at desc, a.id desc
            limit $2`,
          [organizationId, BRAND_PROJECT_LIMITS.overviewCovers],
        )
      ).rows;
      const materials = await withAssetBrandProjects(sql, organizationId, materialRows.map((row) => assetView(row, deps.media)), process.env, 'assets');
      const answer: StudioBrandProjectOverview = {
        ok: true as const,
        projects: groups.listed.map((item) => ({
          project: item.project,
          counts: groups.countsOf(item.project.id),
          covers: groups.coversOf(item.project.id),
          ...markOf(view.named, item),
        })),
        unfiled: { counts: groups.countsOf(null), covers: groups.coversOf(null) },
        brandMaterials: { count: Object.values(groups.byRole).reduce((sum, n) => sum + n, 0), byRole: groups.byRole, covers: materials },
        // Always (spine rules R-A, B.6): the files that left 미분류 for their finished project, so a screen can say where.
        finished: { counts: { ...groups.finished } },
      };
      if (!view.named) return answer;
      const totals = await brandProjectTotals(sql, seat);
      return { ...answer, totals, listed: listedOf(totals) };
    }),
  );
}

/* --------------------------------------------------------------------- cards */

/** Workspace attachments are read through this route, which checks the reader again (as the project list links them). */
const WORKSPACE_ATTACHMENT = (id: string): string => `/api/brand-workspace/attachments/${id}`;

interface TeamFacts {
  id: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  cover_attachment_id: string | null;
}

/** Whether a library entry filed in `p` (with `p.selectable`) is shown in that project vs 브랜드 자료. */
const shownAssetHere = (alias: string): string => `(p.selectable or ${NOT_BRAND_MATERIAL(alias)})`;

/**
 * Counts by kind for a specific set of visible project ids (`$2::uuid[]`, with matching `selectable` flags `$3::boolean[]`),
 * using the exact predicates of `projectGroups` and `project.files` without scanning any other project in the organization.
 */
async function projectCountsByIds(
  sql: SqlRunner,
  organizationId: string,
  ids: readonly string[],
  open: readonly boolean[],
  live: string,
): Promise<Map<string, StudioBrandProjectCounts>> {
  const counts = new Map<string, StudioBrandProjectCounts>();
  if (ids.length === 0) return counts;
  const bucketOf = (id: string): StudioBrandProjectCounts => {
    const key = id.toLowerCase();
    let found = counts.get(key);
    if (!found) counts.set(key, (found = emptyCounts()));
    return found;
  };
  const [results, uploads, films] = [
    (
      await sql.query<{ bucket: string; kind: ResultKind; n: number }>(
        `select j.brand_project_id::text as bucket, ${kindOf('j')} as kind, count(*)::int as n
           from brand_studio_jobs j
           join brand_studio_outputs o on o.job_id = j.id
          where j.organization_id = $1 and j.brand_project_id = any($2::uuid[])
            and ${anyOf(RESULT_KINDS, 'j')} ${live} and ${VISIBLE_OUTPUT('o')}
          group by 1, 2`,
        [organizationId, ids],
      )
    ).rows,
    (
      await sql.query<{ bucket: string; n: number }>(
        `select p.id::text as bucket, count(*)::int as n
           from unnest($2::uuid[], $3::boolean[]) as p(id, selectable)
           join brand_studio_assets a on a.organization_id = $1 and a.brand_project_id = p.id
          where ${shownAssetHere('a')} and ${LISTED_LIBRARY_ASSETS('a')}
          group by 1`,
        [organizationId, ids, open],
      )
    ).rows,
    (
      await sql.query<{ bucket: string; n: number }>(
        `select f.brand_project_id::text as bucket, count(*)::int as n
           from brand_studio_video_projects f
          where f.organization_id = $1 and f.brand_project_id = any($2::uuid[])
            and ${LISTED_FILMS('f')}
          group by 1`,
        [organizationId, ids],
      )
    ).rows,
  ];
  for (const row of results) if (row.kind) bucketOf(row.bucket)[row.kind] += Number(row.n);
  for (const row of uploads) bucketOf(row.bucket).upload += Number(row.n);
  for (const row of films) bucketOf(row.bucket).film += Number(row.n);
  return counts;
}

/** Result cover tiles (up to `BRAND_PROJECT_CARD_LIMITS.covers` per project) for a single page of project ids only. */
async function projectResultCoversByIds(
  sql: SqlRunner,
  media: StudioMediaStore,
  organizationId: string,
  ids: readonly string[],
  live: string,
): Promise<Map<string, StudioBrandProjectCover[]>> {
  const map = new Map<string, StudioBrandProjectCover[]>();
  if (ids.length === 0) return map;
  const rows = (
    await sql.query<CoverRow>(
      `select p.id::text as bucket, x.id, x.job_id, x.kind, x.storage_key, x.thumb_key, x.width, x.height, x.created_at
         from unnest($2::uuid[]) as p(id)
         cross join lateral (
           select o.id, o.job_id, o.kind, o.storage_key, o.thumb_key, o.width, o.height, o.created_at
             from brand_studio_jobs j
             join brand_studio_outputs o on o.job_id = j.id
            where j.organization_id = $1 and j.brand_project_id = p.id
              and ${anyOf(['image', 'video'], 'j')} ${live} and ${VISIBLE_OUTPUT('o')} and o.kind in ('image', 'video')
            order by o.created_at desc, o.id desc
            limit $3
         ) x`,
      [organizationId, ids, BRAND_PROJECT_CARD_LIMITS.covers],
    )
  ).rows;
  for (const row of rows) {
    const key = String(row.bucket).toLowerCase();
    const list = map.get(key) ?? [];
    list.push(coverView(row, media));
    map.set(key, list);
  }
  return map;
}

/** Build `StudioBrandProjectCard[]` for a list of visible projects (`project.cards` and `project.archive`). */
async function buildProjectCards(
  sql: SqlRunner,
  media: StudioMediaStore,
  seat: StudioSeat,
  items: readonly ListedBrandProject[],
  countsOf: (projectId: string) => StudioBrandProjectCounts,
  resultCoversOf: (projectId: string) => StudioBrandProjectCover[],
  live: string,
  includeMarks: boolean,
): Promise<StudioBrandProjectCard[]> {
  if (items.length === 0) return [];
  const organizationId = seat.organizationId;
  const ids = items.map((item) => item.project.id);
  // Whether each card's project can still take work: a finished project's role-tagged uploads are 브랜드 자료, not its
  // files (`SHOWN_ASSET_PROJECT_JOIN`), so they are neither its pictures nor its newest file.
  const open = items.map((item) => item.selectable);
  const teamIds = items.filter((item) => item.project.origin === 'team').map((item) => item.project.id);
  const limit = BRAND_PROJECT_CARD_LIMITS.covers;
  const shownHere = shownAssetHere;

  // The newest library entries with a picture filed in each card's project (the cover when it has no result): per
  // project, a few rows off idx_brand_studio_assets_brand_project (organization_id, brand_project_id, created_at desc).
  const libraryRows = (
    await sql.query<AssetRow & { bucket: string }>(
      `select x.*, p.id::text as bucket
         from unnest($2::uuid[], $4::boolean[]) as p(id, selectable)
         cross join lateral (
           select a.* from brand_studio_assets a
            where a.organization_id = $1 and a.brand_project_id = p.id and ${shownHere('a')} and ${LISTED_LIBRARY_ASSETS('a')} and a.kind in ('image', 'video')
            order by a.created_at desc, a.id desc
            limit $3
         ) x`,
      [organizationId, ids, limit, open],
    )
  ).rows;
  // A team project's own facts: what its stage line starts from, and its cover image as the project list shows it.
  const team = new Map(
    teamIds.length
      ? (
          await sql.query<TeamFacts>(
            `select p.id::text as id, p.status, p.created_at, p.updated_at, p.cover_attachment_id::text as cover_attachment_id
               from brand_projects p
              where p.organization_id = $1 and p.id = any($2::uuid[]) and p.origin = 'team' and ${VISIBLE_PROJECTS('p')}`,
            [organizationId, teamIds],
          )
        ).rows.map((row) => [String(row.id).toLowerCase(), row] as const)
      : [],
  );
  // The newest file of each card: the first item `project.files` lists for it, by the same rules and the same order
  // (created_at, then id, across runs, library entries and films). Per project, the newest of each kind off the
  // 0194 indexes, then the newest of the three. The name: only an active member of this organization's display name.
  const newest = (
    await sql.query<{ bucket: string; type: BrandProjectFileItem['type']; kind: BrandProjectFileKind; id: string; created_at: Date | string; display_name: string | null }>(
      `select p.id::text as bucket, x.type, x.kind, x.id::text as id, x.created_at, pr.display_name
         from unnest($2::uuid[], $3::boolean[]) as p(id, selectable)
         cross join lateral (
           select u.* from (
             (select 'job'::text as type, ${kindOf('j')} as kind, j.id, j.created_at, j.created_by
                from brand_studio_jobs j
               where j.organization_id = $1 and j.brand_project_id = p.id and ${anyOf(RESULT_KINDS, 'j')} ${live} and ${RUN_HAS_FILE('j')}
               order by j.created_at desc, j.id desc limit 1)
             union all
             (select 'asset'::text, 'upload'::text, a.id, a.created_at, a.created_by
                from brand_studio_assets a
               where a.organization_id = $1 and a.brand_project_id = p.id and ${shownHere('a')} and ${LISTED_LIBRARY_ASSETS('a')}
               order by a.created_at desc, a.id desc limit 1)
             union all
             (select 'film'::text, 'film'::text, f.id, f.created_at, f.created_by
                from brand_studio_video_projects f
               where f.organization_id = $1 and f.brand_project_id = p.id and ${LISTED_FILMS('f')}
               order by f.created_at desc, f.id desc limit 1)
           ) u
           order by u.created_at desc, u.id desc
           limit 1
         ) x
         left join brand_memberships m on m.organization_id = $1 and m.user_id = x.created_by and m.status = 'active'
         left join profiles pr on pr.id = m.user_id`,
      [organizationId, ids, open],
    )
  ).rows;
  const rooms = teamIds.length && brandRoomsOpen() ? await roomFacts(sql, organizationId, seat.userId, [...team.values()]) : null;

  const libraryOf = new Map<string, StudioBrandProjectCardCover[]>();
  for (const row of libraryRows) {
    const key = String(row.bucket).toLowerCase();
    const view = assetView(row, media);
    const list = libraryOf.get(key) ?? [];
    list.push({ source: 'library', id: view.id, kind: view.kind === 'video' ? 'video' : 'image', url: view.url, thumbUrl: view.thumbUrl, width: view.width, height: view.height });
    libraryOf.set(key, list);
  }
  const newestOf = new Map(newest.map((row) => [String(row.bucket).toLowerCase(), row] as const));
  const coversFor = (project: StudioBrandProject): StudioBrandProjectCardCover[] => {
    const results = resultCoversOf(project.id).slice(0, limit);
    if (results.length) return results.map((c) => ({ source: 'result' as const, id: c.outputId, kind: c.kind, url: c.url, thumbUrl: c.thumbUrl, width: c.width, height: c.height }));
    const library = libraryOf.get(project.id.toLowerCase()) ?? [];
    if (library.length) return library;
    const cover = project.origin === 'team' ? team.get(project.id.toLowerCase())?.cover_attachment_id : null;
    return cover ? [{ source: 'team_cover', id: cover, kind: 'image', url: WORKSPACE_ATTACHMENT(cover), thumbUrl: null, width: null, height: null }] : [];
  };
  const activityOf = (project: StudioBrandProject): StudioBrandProjectActivity | null => {
    const row = newestOf.get(project.id.toLowerCase());
    if (!row || !row.kind) return null;
    return { at: iso(row.created_at), kind: row.kind, item: { type: row.type, id: String(row.id) }, actorName: row.display_name?.trim() || null };
  };
  return items.map(
    (item): StudioBrandProjectCard => ({
      project: item.project,
      counts: countsOf(item.project.id),
      covers: coversFor(item.project),
      lastActivity: activityOf(item.project),
      unread: item.project.origin === 'team' ? (rooms?.unread[item.project.id.toLowerCase()] ?? 0) : 0,
      stage: item.project.origin === 'team' ? (rooms?.stages.get(item.project.id.toLowerCase()) ?? null) : null,
      ...markOf(includeMarks, item),
    }),
  );
}

/**
 * `project.cards`: the 직접 만들기 home (docs/BRAND-PROJECT-SPINE.md §5, slice 3a). After the seat, a fixed number of
 * statements whatever the number of projects: the groups (`projectGroups`, five), the library pictures of every card
 * (one), the team projects' own facts (one), the newest file of every card (one) and, while project rooms are open,
 * the team projects' stage lines (two) and room unread counts (one) under one savepoint (two). Nothing is read per card.
 * With a `filter` named (spine rules R-A), one more: the two views' sizes and listed counts. With `all`, finished projects
 * get cards too (a cancelled or completed team project keeps its room's unread count and its stage line as the room computes it).
 */
export async function loadBrandProjectCards(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectCards | StudioFailure> {
  const parsed = BrandProjectCardsSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const organizationId = parsed.data.organizationId;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await spineSeat(sql, viewer, organizationId, false);
      const view = viewFilterOf(raw);
      const groups = await projectGroups(sql, deps.media, seat, view.filter);
      const unfiled = { counts: groups.countsOf(null), covers: groups.coversOf(null) };
      const totals = view.named ? await brandProjectTotals(sql, seat) : null;
      const filterFields = totals ? { totals, listed: listedOf(totals) } : {};
      if (groups.listed.length === 0) return { ok: true as const, projects: [], unfiled, ...filterFields };
      const projects = await buildProjectCards(sql, deps.media, seat, groups.listed, groups.countsOf, groups.coversOf, groups.live, view.named);
      return { ok: true as const, projects, unfiled, ...filterFields };
    }),
  );
}

/**
 * `project.archive` (spine rules R-B): every project a member may see (`VISIBLE_PROJECTS`: open and finished), most
 * recent activity first, keyset-paged past `listMax` with optional title search (`query`) and page size (`limit`).
 * Only `organizationId` is read before `spineSeat`; counts and covers are computed ONLY for the returned page's ids,
 * keeping statement count fixed regardless of how many projects the organization holds.
 */
export async function loadBrandProjectArchive(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectArchive | StudioFailure> {
  const named = BrandProjectOverviewSchema.safeParse(raw);
  if (!named.success) return failure('invalid');
  const organizationId = named.data.organizationId;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await spineSeat(sql, viewer, organizationId, false);
      const parsed = BrandProjectArchiveSchema.safeParse(raw);
      if (!parsed.success) throw new StudioDenied('invalid');
      const v = parsed.data;
      const after = v.cursor === undefined ? null : decodeCursor(v.cursor);
      if (v.cursor !== undefined && !after) throw new StudioDenied('invalid');
      const query = normalizeProjectQuery(raw);
      const pageSize = v.limit ?? BRAND_PROJECT_LIMITS.archivePage;

      const total = await countVisibleBrandProjects(sql, seat, query);
      const rows: ArchiveProjectRow[] = await archiveBrandProjectsPage(sql, deps.media, seat, {
        limit: pageSize + 1,
        query,
        after,
      });
      const page = rows.slice(0, pageSize);
      const last = page[page.length - 1];
      const next = rows.length > pageSize && last ? encodeCursor({ k: last.k, i: last.project.id }) : null;
      if (page.length === 0) return { ok: true as const, projects: [], next: null, total };

      const live = await liveRunsFilter(sql, 'j');
      const ids = page.map((item) => item.project.id);
      const open = page.map((item) => item.selectable);
      const countsMap = await projectCountsByIds(sql, organizationId, ids, open, live);
      const coversMap = await projectResultCoversByIds(sql, deps.media, organizationId, ids, live);
      const cards = await buildProjectCards(
        sql,
        deps.media,
        seat,
        page,
        (id) => ({ ...(countsMap.get(id.toLowerCase()) ?? emptyCounts()) }),
        (id) => coversMap.get(id.toLowerCase()) ?? [],
        live,
        true,
      );
      return { ok: true as const, projects: cards as StudioBrandProjectArchiveCard[], next, total };
    }),
  );
}

/**
 * The room facts of the team cards (project rooms open): the stage line (`loadRoomStages`, the rule of the room
 * overview) and this person's unread count (`roomUnreadCounts`, the rule of the room and the team home), keyed by
 * lower-case project id. Under one savepoint, so a room table that is missing (or any other failure there) leaves
 * every card without a stage line and with 0 unread instead of failing the home.
 */
async function roomFacts(sql: SqlRunner, organizationId: string, userId: string, team: readonly TeamFacts[]): Promise<{ stages: Map<string, StudioBrandProjectStage>; unread: Record<string, number> } | null> {
  const projects = team.map((row) => ({ id: String(row.id).toLowerCase(), status: String(row.status) as RoomProjectStatus, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }));
  await sql.query('savepoint brand_project_cards_rooms');
  try {
    const stages = await loadRoomStages(sql, organizationId, projects);
    const counts = await roomUnreadCounts(sql, { organizationId, userId, projectIds: projects.map((project) => project.id) });
    await sql.query('release savepoint brand_project_cards_rooms');
    const unread = Object.fromEntries(Object.entries(counts).map(([id, n]) => [id.toLowerCase(), Number(n)]));
    return { stages: new Map([...stages].map(([id, stage]) => [id.toLowerCase(), stage])), unread };
  } catch {
    await sql.query('rollback to savepoint brand_project_cards_rooms');
    return null;
  }
}

/* --------------------------------------------------------------------- pages */

/** The page key of a row: its creation to the microsecond (UTC) and its id. */
interface PageKey {
  k: string;
  i: string;
}
const KEY_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})$/;
const keyText = (alias: string): string => `to_char(${alias}.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

function encodeCursor(key: PageKey): string {
  return Buffer.from(JSON.stringify([key.k, key.i]), 'utf8').toString('base64url');
}

/** A cursor this module wrote, or null (anything else is `invalid`). */
function decodeCursor(raw: string): PageKey | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [k, i] = value as unknown[];
  if (typeof k !== 'string' || typeof i !== 'string' || !UUID.test(i)) return null;
  const m = KEY_TIME.exec(k);
  if (!m) return null;
  // A real instant: the calendar must not roll it over (no 30 February).
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 19) !== k.slice(0, 19)) return null;
  return { k, i: i.toLowerCase() };
}

type Scope = { project: string; selectable: boolean; info: VisibleBrandProjectInfo } | { unfiled: true } | { materials: true };

/**
 * `project.files`. Only the organization is read before the seat (as `project.list`); everything else in the request
 * (scope, kind, cursor) is judged after it, so nobody who is not seated learns anything from how their input is answered.
 * A project scope opens any project a member may see (`visibleProjectOf`, spine rules R-A: a finished project's files can
 * be browsed), including projects beyond the listed 100, and page 1 carries `project` summary metadata and counts
 * (spine rules R-B); a hidden team project, another organization's or a made-up one is `not_found`, a malformed id `invalid`.
 */
export async function loadBrandProjectFiles(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectFiles | StudioFailure> {
  const named = BrandProjectOverviewSchema.safeParse(raw);
  if (!named.success) return failure('invalid');
  const organizationId = named.data.organizationId;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      await spineSeat(sql, viewer, organizationId, false);
      const parsed = BrandProjectFilesSchema.safeParse(raw);
      if (!parsed.success) throw new StudioDenied('invalid');
      const v = parsed.data;
      let scope: Scope;
      if (v.scope.kind === 'brand_materials') scope = { materials: true };
      else if (v.scope.kind === 'unfiled') scope = { unfiled: true };
      else {
        // A malformed id is `invalid`; a hidden team project, another organization's or a made-up one, `not_found`.
        if (!UUID.test(v.scope.brandProjectId)) throw new StudioDenied('invalid');
        const judged = await visibleProjectOf(sql, organizationId, v.scope.brandProjectId);
        if (!judged) throw new StudioDenied('not_found');
        scope = { project: judged.id.toLowerCase(), selectable: judged.selectable, info: judged };
      }
      const after = v.cursor === undefined ? null : decodeCursor(v.cursor);
      if (v.cursor !== undefined && !after) throw new StudioDenied('invalid');

      const pageSize = BRAND_PROJECT_LIMITS.filesPage;
      const params: unknown[] = [organizationId, pageSize + 1];
      const param = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };
      const projectParam = 'project' in scope ? param(scope.project) : '';
      const cursor = after ? { k: param(after.k), i: param(after.i) } : null;
      const before = (alias: string): string => (cursor ? `and (${alias}.created_at, ${alias}.id) < ((${cursor.k})::timestamp at time zone 'UTC', (${cursor.i})::uuid)` : '');
      // `$1` is the organization (`UNFILED_ROWS` needs it so).
      const filedRows = (alias: string): string => ('project' in scope ? `${alias}.brand_project_id = ${projectParam}` : UNFILED_ROWS(alias));
      const kinds: readonly BrandProjectFileKind[] = v.kind ? [v.kind] : BRAND_PROJECT_FILE_KINDS;
      const runKinds = RESULT_KINDS.filter((kind) => kinds.includes(kind));
      const branches: string[] = [];
      let live: string | null = null;
      if (runKinds.length && !('materials' in scope)) {
        live = await liveRunsFilter(sql, 'j');
        branches.push(
          `(select 'job'::text as type, j.id, j.created_at, ${keyText('j')} as k
              from brand_studio_jobs j
             where j.organization_id = $1 and ${anyOf(runKinds, 'j')} ${live} and ${filedRows('j')}
               and ${RUN_HAS_FILE('j')}
               ${before('j')}
             order by j.created_at desc, j.id desc
             limit $2)`,
        );
      }
      if (kinds.includes('upload')) {
        // A project's entries: all of them while it takes work; in a finished project, those without a brand-material role
        // (a role-tagged one is 브랜드 자료). Elsewhere the entries with no shown project, by role. Never a saved result shown
        // as its result.
        const which =
          'project' in scope
            ? `${filedRows('a')}${scope.selectable ? '' : ` and ${NOT_BRAND_MATERIAL('a')}`}`
            : `${UNFILED_ASSETS('a')} and ${'materials' in scope ? BRAND_MATERIAL('a') : NOT_BRAND_MATERIAL('a')}`;
        branches.push(
          `(select 'asset'::text as type, a.id, a.created_at, ${keyText('a')} as k
              from brand_studio_assets a
             where a.organization_id = $1 and ${LISTED_LIBRARY_ASSETS('a')} and ${which}
               ${before('a')}
             order by a.created_at desc, a.id desc
             limit $2)`,
        );
      }
      if (kinds.includes('film') && !('materials' in scope)) {
        branches.push(
          `(select 'film'::text as type, f.id, f.created_at, ${keyText('f')} as k
              from brand_studio_video_projects f
             where f.organization_id = $1 and ${LISTED_FILMS('f')} and ${filedRows('f')}
               ${before('f')}
             order by f.created_at desc, f.id desc
             limit $2)`,
        );
      }
      if (branches.length === 0) return { ok: true as const, items: [], jobs: [], assets: [], films: [], next: null };

      const rows = (
        await sql.query<{ type: BrandProjectFileItem['type']; id: string; k: string }>(
          `select u.type, u.id::text as id, u.k from (${branches.join(' union all ')}) u order by u.created_at desc, u.id desc limit $2`,
          params,
        )
      ).rows;
      const page = rows.slice(0, pageSize);
      const last = page[page.length - 1];
      const next = rows.length > pageSize && last ? encodeCursor({ k: last.k, i: String(last.id) }) : null;
      const idsOf = (type: BrandProjectFileItem['type']) => page.filter((row) => row.type === type).map((row) => String(row.id));

      // The page's views, built as the screens already build them.
      const jobIds = idsOf('job');
      let jobs = jobIds.length ? await viewsOf(sql, await jobsByIds(sql, organizationId, jobIds), deps.media) : [];
      if (jobs.length) {
        const old = (await studioProjectsReady(deps, sql)) ? await liveProjectsOf(sql, organizationId) : null;
        jobs = await withBrandProjects(sql, organizationId, keepLiveProjectIds(jobs, old), process.env, 'assets');
      }
      const assetIds = idsOf('asset');
      const assetRows = assetIds.length
        ? (await sql.query<AssetRow>('select * from brand_studio_assets where organization_id = $1 and id = any($2::uuid[])', [organizationId, assetIds])).rows
        : [];
      const assets = await withAssetBrandProjects(sql, organizationId, assetRows.map((row) => assetView(row, deps.media)), process.env, 'assets');
      const films = await withFilmBrandProjects(sql, organizationId, await filmSummariesByIds(sql, deps.media, organizationId, idsOf('film')), process.env, 'assets');

      const inOrder = <T extends { id: string }>(type: BrandProjectFileItem['type'], views: T[]): T[] => {
        const byId = new Map(views.map((view) => [view.id.toLowerCase(), view]));
        return idsOf(type).flatMap((id) => byId.get(id.toLowerCase()) ?? []);
      };
      const ordered = { jobs: inOrder('job', jobs), assets: inOrder('asset', assets), films: inOrder('film', films) };
      const present = new Set([...ordered.jobs, ...ordered.assets, ...ordered.films].map((view) => view.id.toLowerCase()));
      let project: StudioBrandProjectSummary | undefined;
      if ('project' in scope && !after) {
        const liveForCounts = live ?? (await liveRunsFilter(sql, 'j'));
        const countsMap = await projectCountsByIds(sql, organizationId, [scope.project], [scope.selectable], liveForCounts);
        project = {
          id: scope.info.id,
          title: scope.info.title,
          origin: scope.info.origin,
          status: scope.info.status,
          selectable: scope.info.selectable,
          counts: { ...(countsMap.get(scope.project) ?? emptyCounts()) },
        };
      }
      return {
        ok: true as const,
        items: page.filter((row) => present.has(String(row.id).toLowerCase())).map((row) => ({ type: row.type, id: String(row.id) })),
        ...ordered,
        next,
        ...(project ? { project } : {}),
      };
    }),
  );
}
