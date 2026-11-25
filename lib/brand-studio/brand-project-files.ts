/**
 * The assets page's reads, by project (docs/BRAND-PROJECT-SPINE.md §7, slice 2a). Reads only; nothing here writes,
 * sends or counts usage.
 *
 *   project.overview  the 프로젝트별 tab in one answer: per selectable project (the same set and order as
 *                     `project.list`), then 미분류 and 브랜드 자료, the counts by kind and a few cover tiles;
 *   project.files     one scope's files (a project, `unfiled` or `brand_materials`), optionally one kind, newest
 *                     first, page by page with a keyset cursor on (created_at, id).
 *
 * Who: workspace members (owner, editor, viewer) through the spine's own gate (`spineSeat`: membership → sandbox
 * hardline → feature policy → not a project guest), exactly as `project.list`. While the spine is closed for the
 * organization both answer what an unknown operation answers (`invalid`), before anything is judged
 * (`spineOrganization`). Only lib/brand-studio/service.ts dispatches them (tests/brand-studio/spine/assets-page.test.ts).
 *
 * What is counted and listed is exactly what a member can open, by the rules the studio state already uses,
 * imported and never copied: runs by medium (`IMAGE_RUNS`, `VIDEO_RUNS`, and the sound studio's `SOUND_RUNS`), live
 * runs (`liveRunsFilter`), results a screen shows (`VISIBLE_OUTPUT`), library entries (`LIBRARY_ASSETS`), listed films
 * (`LISTED_FILMS`). Where a file is filed is its SHOWN project (`SHOWN_PROJECT_JOIN` / `UNFILED_ROWS`,
 * ./brand-projects.ts): its project while that project can take new work, else none (§4.2 rule 6). This module
 * reads brand_projects only through those spine fragments and `selectableProjects`; it is a spine file
 * (tests/brand-studio/spine/team-guard.test.ts) and nothing on the team side reaches it.
 *
 * The overview asks a fixed number of statements whatever the number of projects (grouped counts, one windowed
 * cover query); `project.files` asks one keyset statement for the page, then the page's views by id.
 */
import type { Viewer } from '@/lib/auth/identity';
import { StudioDenied } from './access';
import {
  SHOWN_PROJECT_JOIN,
  UNFILED_ROWS,
  selectableProjects,
  spineOrganization,
  spineSeat,
  stateScopeFilter,
  withAssetBrandProjects,
  withBrandProjects,
  withFilmBrandProjects,
} from './brand-projects';
import {
  BRAND_MATERIAL_ROLES,
  BRAND_PROJECT_FILE_KINDS,
  BRAND_PROJECT_LIMITS,
  BRAND_PROJECT_READS,
  BrandProjectFilesSchema,
  BrandProjectOverviewSchema,
  type BrandMaterialRole,
  type BrandProjectFileItem,
  type BrandProjectFileKind,
  type BrandProjectRead,
  type StudioBrandProjectCounts,
  type StudioBrandProjectCover,
  type StudioBrandProjectFiles,
  type StudioBrandProjectOverview,
  type StudioFailure,
} from './contracts';
import { keepLiveProjectIds, liveProjectsOf, studioProjectsReady } from './job-projects';
import type { StudioMediaStore } from './media-store';
import { failure, guarded } from './outcome';
import { IMAGE_RUNS, LIBRARY_ASSETS, SOUND_RUNS, VIDEO_RUNS, VISIBLE_OUTPUT, assetView, jobsByIds, liveRunsFilter, viewsOf } from './repo';
import type { AssetRow, StudioDeps } from './types';
import { LISTED_FILMS, filmSummariesByIds } from './video-projects/service';

export function isBrandProjectRead(value: unknown): value is BrandProjectRead {
  return typeof value === 'string' && (BRAND_PROJECT_READS as readonly string[]).includes(value);
}

export type BrandProjectReadResult = StudioBrandProjectOverview | StudioBrandProjectFiles | StudioFailure;

/** `project.overview` / `project.files` through `POST /api/brand-studio`; closed for the organization: `invalid`. */
export async function runBrandProjectRead(deps: StudioDeps, viewer: Viewer, operation: BrandProjectRead, input: unknown): Promise<BrandProjectReadResult> {
  if (!(await spineOrganization(deps.sql, input))) return failure('invalid');
  return operation === 'project.overview' ? loadBrandProjectOverview(deps, viewer, input) : loadBrandProjectFiles(deps, viewer, input);
}

/* ---------------------------------------------------------------- the rules */

type ResultKind = 'image' | 'video' | 'sound';
const RESULT_KINDS: readonly ResultKind[] = ['image', 'video', 'sound'];
/** Which runs' results count as which kind: the studio state's two lists and the sound studio's runs. */
const RUNS_OF: Record<ResultKind, (alias: string) => string> = { image: IMAGE_RUNS, video: VIDEO_RUNS, sound: SOUND_RUNS };
const anyOf = (kinds: readonly ResultKind[], alias: string): string => `(${kinds.map((kind) => `(${RUNS_OF[kind](alias)})`).join(' or ')})`;
const kindOf = (alias: string): string => `case ${RESULT_KINDS.map((kind) => `when ${RUNS_OF[kind](alias)} then '${kind}'`).join(' ')} end`;

const ROLE_LIST = BRAND_MATERIAL_ROLES.map((role) => `'${role}'`).join(', ');
/** A library entry with no shown project is 브랜드 자료 by its role, else 미분류 (one rule, here and in `isBrandMaterial`). */
const BRAND_MATERIAL = (alias: string): string => `${alias}.role in (${ROLE_LIST})`;
const NOT_BRAND_MATERIAL = (alias: string): string => `(${alias}.role is null or ${alias}.role not in (${ROLE_LIST}))`;
const isBrandMaterial = (role: string | null): role is BrandMaterialRole => role !== null && (BRAND_MATERIAL_ROLES as readonly string[]).includes(role);

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

/**
 * `project.overview`. After the seat: the project list, three grouped counts (results, library entries, films), one
 * windowed cover statement, 브랜드 자료's newest entries and their shown project: seven statements whatever the number
 * of projects (the column probes are remembered).
 */
export async function loadBrandProjectOverview(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectOverview | StudioFailure> {
  const parsed = BrandProjectOverviewSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const organizationId = parsed.data.organizationId;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      await spineSeat(sql, viewer, organizationId, false);
      const projects = await selectableProjects(sql, deps.media, organizationId);
      const live = await liveRunsFilter(sql, 'j');
      const covers = BRAND_PROJECT_LIMITS.overviewCovers;
      // Results by shown project and kind (indexes: idx_brand_studio_jobs_org, brand_studio_outputs_slot (job_id, idx)).
      const results = (
        await sql.query<{ bucket: string | null; kind: ResultKind; n: number }>(
          `select sp.id::text as bucket, ${kindOf('j')} as kind, count(*)::int as n
             from brand_studio_jobs j
             join brand_studio_outputs o on o.job_id = j.id
             ${SHOWN_PROJECT_JOIN('sp', 'j')}
            where j.organization_id = $1 and ${anyOf(RESULT_KINDS, 'j')} ${live} and ${VISIBLE_OUTPUT('o')}
            group by 1, 2`,
          [organizationId],
        )
      ).rows;
      // Library entries by shown project and role (idx_brand_studio_assets_org).
      const uploads = (
        await sql.query<{ bucket: string | null; role: string | null; n: number }>(
          `select sp.id::text as bucket, a.role, count(*)::int as n
             from brand_studio_assets a
             ${SHOWN_PROJECT_JOIN('sp', 'a')}
            where a.organization_id = $1 and ${LIBRARY_ASSETS('a')}
            group by 1, 2`,
          [organizationId],
        )
      ).rows;
      // Films by shown project (idx_brand_studio_video_projects_org).
      const films = (
        await sql.query<{ bucket: string | null; n: number }>(
          `select sp.id::text as bucket, count(*)::int as n
             from brand_studio_video_projects f
             ${SHOWN_PROJECT_JOIN('sp', 'f')}
            where f.organization_id = $1 and ${LISTED_FILMS('f')}
            group by 1`,
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
      // 브랜드 자료's newest entries: the same statement as its first page, cut to the cover count.
      const materialRows = (
        await sql.query<AssetRow>(
          `select a.* from brand_studio_assets a
            where a.organization_id = $1 and ${LIBRARY_ASSETS('a')} and ${UNFILED_ROWS('a')} and ${BRAND_MATERIAL('a')}
            order by a.created_at desc, a.id desc
            limit $2`,
          [organizationId, covers],
        )
      ).rows;

      const counts = new Map<string, StudioBrandProjectCounts>();
      const countsOf = (bucket: string | null): StudioBrandProjectCounts => {
        const key = bucket ? bucket.toLowerCase() : '';
        let found = counts.get(key);
        if (!found) counts.set(key, (found = emptyCounts()));
        return found;
      };
      for (const row of results) if (row.kind) countsOf(row.bucket)[row.kind] += Number(row.n);
      const byRole = Object.fromEntries(BRAND_MATERIAL_ROLES.map((role) => [role, 0])) as Record<BrandMaterialRole, number>;
      for (const row of uploads) {
        if (row.bucket) countsOf(row.bucket).upload += Number(row.n);
        else if (isBrandMaterial(row.role)) byRole[row.role] += Number(row.n);
        else countsOf(null).upload += Number(row.n);
      }
      for (const row of films) countsOf(row.bucket).film += Number(row.n);
      const coversOf = new Map<string, StudioBrandProjectCover[]>();
      for (const row of coverRows) {
        const key = row.bucket ? row.bucket.toLowerCase() : '';
        const list = coversOf.get(key) ?? [];
        list.push(coverView(row, deps.media));
        coversOf.set(key, list);
      }
      const materials = await withAssetBrandProjects(sql, organizationId, materialRows.map((row) => assetView(row, deps.media)));
      return {
        ok: true as const,
        projects: projects.map((project) => ({
          project,
          counts: { ...(counts.get(project.id.toLowerCase()) ?? emptyCounts()) },
          covers: coversOf.get(project.id.toLowerCase()) ?? [],
        })),
        unfiled: { counts: { ...countsOf(null) }, covers: coversOf.get('') ?? [] },
        brandMaterials: { count: Object.values(byRole).reduce((sum, n) => sum + n, 0), byRole, covers: materials },
      };
    }),
  );
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

type Scope = { project: string } | { unfiled: true } | { materials: true };

/** `project.files`. The scope is judged after the seat, by the scoped state read's own rule (`stateScopeFilter`). */
export async function loadBrandProjectFiles(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioBrandProjectFiles | StudioFailure> {
  const parsed = BrandProjectFilesSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await spineSeat(sql, viewer, v.organizationId, false);
      const organizationId = v.organizationId;
      let scope: Scope;
      if (v.scope.kind === 'brand_materials') scope = { materials: true };
      else {
        // A malformed id is `invalid`; a project that cannot take new work, of another organization or made up, `not_found`.
        const judged = await stateScopeFilter(sql, seat, v.scope);
        if (!judged) throw new StudioDenied('invalid');
        scope = judged.brandProjectId ? { project: judged.brandProjectId } : { unfiled: true };
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
      if (runKinds.length && !('materials' in scope)) {
        const live = await liveRunsFilter(sql, 'j');
        branches.push(
          `(select 'job'::text as type, j.id, j.created_at, ${keyText('j')} as k
              from brand_studio_jobs j
             where j.organization_id = $1 and ${anyOf(runKinds, 'j')} ${live} and ${filedRows('j')}
               and exists (select 1 from brand_studio_outputs o where o.job_id = j.id and ${VISIBLE_OUTPUT('o')})
               ${before('j')}
             order by j.created_at desc, j.id desc
             limit $2)`,
        );
      }
      if (kinds.includes('upload')) {
        const which = 'project' in scope ? filedRows('a') : `${UNFILED_ROWS('a')} and ${'materials' in scope ? BRAND_MATERIAL('a') : NOT_BRAND_MATERIAL('a')}`;
        branches.push(
          `(select 'asset'::text as type, a.id, a.created_at, ${keyText('a')} as k
              from brand_studio_assets a
             where a.organization_id = $1 and ${LIBRARY_ASSETS('a')} and ${which}
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
        jobs = await withBrandProjects(sql, organizationId, keepLiveProjectIds(jobs, old));
      }
      const assetIds = idsOf('asset');
      const assetRows = assetIds.length
        ? (await sql.query<AssetRow>('select * from brand_studio_assets where organization_id = $1 and id = any($2::uuid[])', [organizationId, assetIds])).rows
        : [];
      const assets = await withAssetBrandProjects(sql, organizationId, assetRows.map((row) => assetView(row, deps.media)));
      const films = await withFilmBrandProjects(sql, organizationId, await filmSummariesByIds(sql, deps.media, organizationId, idsOf('film')));

      const inOrder = <T extends { id: string }>(type: BrandProjectFileItem['type'], views: T[]): T[] => {
        const byId = new Map(views.map((view) => [view.id.toLowerCase(), view]));
        return idsOf(type).flatMap((id) => byId.get(id.toLowerCase()) ?? []);
      };
      const ordered = { jobs: inOrder('job', jobs), assets: inOrder('asset', assets), films: inOrder('film', films) };
      const present = new Set([...ordered.jobs, ...ordered.assets, ...ordered.films].map((view) => view.id.toLowerCase()));
      return {
        ok: true as const,
        items: page.filter((row) => present.has(String(row.id).toLowerCase())).map((row) => ({ type: row.type, id: String(row.id) })),
        ...ordered,
        next,
      };
    }),
  );
}
