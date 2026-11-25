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
import { brandProjectSpineOpen, listBrandProjects, memberSeesBrandProjects } from './brand-projects';
import type { StudioBrandProjectList, StudioFailure } from './contracts';
import {
  OPEN_PROJECT_COOKIE,
  parseOpenProjectCookie,
  rememberedOpenProject,
  resolveOpenProject,
  type StudioSpineProps,
} from './open-project';
import { studioRuntimeDeps } from './runtime';
import type { StudioDeps } from './types';

const first = (value: string | string[] | undefined): string | null => {
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
  queryProject?: string | string[] | undefined;
  /** Optional override for tests; defaults to reading `twings_brand_project` from `next/headers`. */
  cookieRaw?: string | null;
  /** Optional override for tests; defaults to `await studioRuntimeDeps(sql)`. */
  deps?: StudioDeps;
  /** Optional override for tests; defaults to `listBrandProjects`. */
  listProjects?: (deps: StudioDeps, viewer: Viewer, input: { organizationId: string }) => Promise<StudioBrandProjectList | StudioFailure>;
  /** Optional override for tests; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export async function loadStudioSpine(input: LoadStudioSpineInput): Promise<StudioSpineProps | null> {
  if (!memberSeesBrandProjects(input.seat)) return null;
  if (!(await brandProjectSpineOpen(input.sql, input.organizationId, input.env))) return null;

  const deps = input.deps ?? (await studioRuntimeDeps(input.sql));
  const list = input.listProjects ?? listBrandProjects;
  const listed = await list(deps, input.viewer, { organizationId: input.organizationId });
  if (!listed.ok) return null;

  const cookieRaw = input.cookieRaw !== undefined ? input.cookieRaw : await readOpenProjectCookieFromHeaders();
  const remembered = rememberedOpenProject(parseOpenProjectCookie(cookieRaw), input.organizationId);
  const { open, notice, noticeSource } = resolveOpenProject({
    projects: listed.projects,
    queryProject: first(input.queryProject),
    remembered,
  });

  const canCreate = !input.seat.staff && (input.seat.role === 'owner' || input.seat.role === 'editor');
  return {
    projects: listed.projects,
    open,
    canCreate,
    notice,
    noticeSource,
  };
}
