import 'server-only';
/**
 * Server loader for the brand project spine prop (`StudioSpineProps`) shared by the four studios
 * (docs/BRAND-PROJECT-SPINE.md §4, slice 1b).
 *
 * Returns `null` unless EVERY condition holds:
 *  1. The viewer's seat is a workspace member (`memberSeesBrandProjects`: owner, editor or viewer; never staff
 *     browsing another brand or a project guest).
 *  2. `brandProjectSpineOpen(sql, organizationId)` is true (flag on + org allowed + migration 0194 applied).
 *     Because env is checked first, nothing touches the database or request cookies while the flag is off.
 *  3. `listBrandProjects` answers `{ ok: true }`.
 */
import { cookies } from 'next/headers';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  brandProjectSpineOpen,
  listSelectableProjectsForStudio,
  memberSeesBrandProjects,
  selectableProjectById,
} from './brand-projects';
import { BRAND_PROJECT_LIMITS, type StudioBrandProject, type StudioBrandProjectList, type StudioFailure } from './contracts';
import {
  OPEN_PROJECT_COOKIE,
  openProjectCandidateId,
  parseOpenProjectCookie,
  rememberedOpenProject,
  resolveOpenProject,
  type StudioSpineProps,
} from './open-project';
import { studioRuntimeDeps } from './runtime';
import type { StudioDeps } from './types';

const first = (value: string | string[] | null | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

async function readOpenProjectCookieFromHeaders(): Promise<string | null> {
  try {
    return (await cookies()).get(OPEN_PROJECT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

export interface LoadStudioSpineInput {
  sql: SqlRunner;
  viewer: Viewer;
  organizationId: string;
  seat: { staff?: boolean; role: string };
  /** Raw `?project=` query param from the server page. */
  queryProject?: string | string[] | null | undefined;
  /** Optional override for tests; defaults to reading `twings_brand_project` from `next/headers`. */
  cookieRaw?: string | null;
  /** Optional override for tests; defaults to `await studioRuntimeDeps(sql)`. */
  deps?: StudioDeps;
  /** Optional override for tests; defaults to the spine's studio list loader (with beyond-100 fallback). */
  listProjects?: (deps: StudioDeps, viewer: Viewer, input: { organizationId: string }) => Promise<StudioBrandProjectList | StudioFailure>;
  /** Optional override for tests that pass `listProjects` and also exercise beyond-100 lookup. */
  findProject?: (deps: StudioDeps, viewer: Viewer, input: { organizationId: string; projectId: string }) => Promise<StudioBrandProject | null>;
  /** Optional override for tests; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export async function loadStudioSpine(input: LoadStudioSpineInput): Promise<StudioSpineProps | null> {
  if (!memberSeesBrandProjects(input.seat)) return null;
  if (!(await brandProjectSpineOpen(input.sql, input.organizationId, input.env))) return null;

  const deps = input.deps ?? (await studioRuntimeDeps(input.sql));
  const queryProject = first(input.queryProject);
  const cookieRaw = input.cookieRaw !== undefined ? input.cookieRaw : await readOpenProjectCookieFromHeaders();
  const remembered = rememberedOpenProject(parseOpenProjectCookie(cookieRaw), input.organizationId);
  const candidateId = openProjectCandidateId({ queryProject, remembered });

  let projects: StudioBrandProject[];
  if (input.listProjects) {
    const listed = await input.listProjects(deps, input.viewer, { organizationId: input.organizationId });
    if (!listed.ok) return null;
    projects = listed.projects;
    if (
      candidateId &&
      projects.length >= BRAND_PROJECT_LIMITS.listMax &&
      !projects.some((p) => p.id.toLowerCase() === candidateId)
    ) {
      const lookup = input.findProject ?? selectableProjectById;
      const extra = await lookup(deps, input.viewer, { organizationId: input.organizationId, projectId: candidateId });
      if (extra) projects = [extra, ...projects];
    }
  } else {
    const listed = await listSelectableProjectsForStudio(deps, input.viewer, {
      organizationId: input.organizationId,
      candidateId,
    });
    if (!listed.ok) return null;
    projects = listed.projects;
  }

  const { open, notice, noticeSource } = resolveOpenProject({
    projects,
    queryProject,
    remembered,
  });

  const canCreate = !input.seat.staff && (input.seat.role === 'owner' || input.seat.role === 'editor');
  return {
    projects,
    open,
    canCreate,
    notice,
    noticeSource,
  };
}

export interface IncludeSelectableProjectInput {
  sql: SqlRunner;
  viewer: Viewer;
  organizationId: string;
  seat: { staff?: boolean; role: string };
  spine: StudioSpineProps;
  projectId: string | null | undefined;
  deps?: StudioDeps;
  findProject?: (deps: StudioDeps, viewer: Viewer, input: { organizationId: string; projectId: string }) => Promise<StudioBrandProject | null>;
  env?: Record<string, string | undefined>;
}

/**
 * Resolve one beyond-100 selectable project when `/brand/studio/video` opens a film (`?film=<id>`) whose
 * `brandProjectId` fell outside the top `listMax` (100) loaded by `loadStudioSpine` (spine rules R-B).
 * Skips the database whenever the list has `< listMax` rows or already contains the project.
 */
export async function includeSelectableProjectForFilm(input: IncludeSelectableProjectInput): Promise<StudioSpineProps> {
  const projectId = openProjectCandidateId({ queryProject: input.projectId });
  if (!projectId) return input.spine;
  if (input.spine.projects.length < BRAND_PROJECT_LIMITS.listMax) return input.spine;
  if (input.spine.projects.some((p) => p.id.toLowerCase() === projectId)) return input.spine;
  if (!memberSeesBrandProjects(input.seat)) return input.spine;
  if (!(await brandProjectSpineOpen(input.sql, input.organizationId, input.env))) return input.spine;

  const deps = input.deps ?? (await studioRuntimeDeps(input.sql));
  const lookup = input.findProject ?? selectableProjectById;
  const extra = await lookup(deps, input.viewer, { organizationId: input.organizationId, projectId });
  if (!extra) return input.spine;
  return { ...input.spine, projects: [extra, ...input.spine.projects] };
}
