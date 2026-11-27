/**
 * The open brand project in the four studios (docs/BRAND-PROJECT-SPINE.md §4, slice 1b).
 *
 * Pure, client-safe rules (no env, no db, no server imports):
 *  - Cookie `twings_brand_project`: `<organizationId>:<projectId|unfiled>` pairs joined by `|`, most recent
 *    first, capped at 12 organizations (same shape, attributes and cap as `twings_brand_mode`,
 *    components/brand-workspace/rail-mode.ts). "미분류" is stored explicitly as `unfiled` so the last project
 *    does not come back on the next visit.
 *  - Resolution order: `?project=<id>` when in `projects`; else the cookie's value for this organization when
 *    in `projects` (or `unfiled`); else `unfiled`. `notice: 'gone'` whenever the address or the cookie named
 *    a project that is no longer selectable.
 *  - Video studio address transition (§4.5): `?project=<id>` that is a brand project opens it; one that is a
 *    film of this organization redirects to `?film=<id>` preserving all other parameters in order; neither
 *    falls back to `unfiled` with `notice: 'gone'`.
 */
import type { StudioBrandProject, StudioStateScope } from './contracts';

export type OpenProject = { kind: 'project'; id: string } | { kind: 'unfiled' };
export type GoneNoticeSource = 'address' | 'cookie' | null;

export interface StudioSpineProps {
  projects: StudioBrandProject[];
  open: OpenProject;
  canCreate: boolean;
  notice: 'gone' | null;
  noticeSource: GoneNoticeSource;
}

/** `<organizationId>:<projectId|unfiled>` pairs joined by `|`, most recent first. */
export const OPEN_PROJECT_COOKIE = 'twings_brand_project';
/** Organizations remembered per browser; older entries fall off (matches `RAIL_MODE_MAX`). */
export const OPEN_PROJECT_MAX = 12;

const ORG_ID = /^[0-9a-f-]{8,64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeOpenValue(open: OpenProject): string | null {
  if (open.kind === 'unfiled') return 'unfiled';
  const id = open.id.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

function decodeOpenValue(raw: string | undefined): OpenProject | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();
  if (clean === 'unfiled') return { kind: 'unfiled' };
  return UUID.test(clean) ? { kind: 'project', id: clean } : null;
}

/** The cookie's pairs, most recent first. Anything malformed is skipped; an unreadable cookie is empty. */
export function parseOpenProjectCookie(raw: string | null | undefined): Record<string, OpenProject> {
  const out: Record<string, OpenProject> = {};
  if (!raw) return out;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // keep raw text
  }
  for (const pair of text.split('|')) {
    if (Object.keys(out).length >= OPEN_PROJECT_MAX) break;
    const colon = pair.indexOf(':');
    if (colon <= 0) continue;
    const orgId = pair.slice(0, colon);
    const val = decodeOpenValue(pair.slice(colon + 1));
    if (!ORG_ID.test(orgId) || !val) continue;
    const key = orgId.toLowerCase();
    if (!(key in out)) out[key] = val;
  }
  return out;
}

/** Serialize an organization -> OpenProject map back into the cookie value, capped at `OPEN_PROJECT_MAX`. */
export function serializeOpenProjectCookie(memory: Readonly<Record<string, OpenProject>>): string {
  const parts: string[] = [];
  for (const [orgId, open] of Object.entries(memory)) {
    if (parts.length >= OPEN_PROJECT_MAX) break;
    const key = orgId.toLowerCase();
    const encoded = encodeOpenValue(open);
    if (!ORG_ID.test(key) || !encoded) continue;
    parts.push(`${key}:${encoded}`);
  }
  return parts.join('|');
}

/** The cookie value after remembering `open` for `organizationId` (moved to the front, capped). */
export function rememberOpenProject(memory: Readonly<Record<string, OpenProject>>, organizationId: string, open: OpenProject): string {
  const key = organizationId.toLowerCase();
  const encoded = encodeOpenValue(open);
  if (!ORG_ID.test(key) || !encoded) return serializeOpenProjectCookie(memory);
  const next: Record<string, OpenProject> = { [key]: open };
  for (const [id, value] of Object.entries(memory)) {
    const k = id.toLowerCase();
    if (k !== key) next[k] = value;
  }
  return serializeOpenProjectCookie(next);
}

/** The remembered open project for one organization, or null. */
export function rememberedOpenProject(memory: Readonly<Record<string, OpenProject>>, organizationId: string | null | undefined): OpenProject | null {
  if (!organizationId) return null;
  return memory[organizationId.toLowerCase()] ?? null;
}

/** Full `document.cookie` assignment string, with the same attributes as `twings_brand_mode`. */
export function openProjectCookieString(value: string, secure: boolean): string {
  return `${OPEN_PROJECT_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Write the open project into the browser cookie for `organizationId`. Silently no-ops when blocked or outside DOM. */
export function writeOpenProjectCookie(organizationId: string, open: OpenProject): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  try {
    const current = document.cookie
      .split('; ')
      .find((part) => part.startsWith(`${OPEN_PROJECT_COOKIE}=`))
      ?.slice(OPEN_PROJECT_COOKIE.length + 1);
    const value = rememberOpenProject(parseOpenProjectCookie(current), organizationId, open);
    document.cookie = openProjectCookieString(value, window.location.protocol === 'https:');
  } catch {
    // Cookies blocked: the studio still works for this visit.
  }
}

export interface ResolveOpenProjectInput {
  projects: readonly Pick<StudioBrandProject, 'id'>[];
  queryProject?: string | null;
  remembered?: OpenProject | null;
}

/**
 * Resolve which project opens and whether a gone-project notice should be shown (§4.1):
 *  1. `?project=<id>` when in `projects` -> that project, notice null.
 *  2. `?project=<id>` when present but not in `projects` -> `unfiled`, notice `'gone'`.
 *  3. Cookie value for this organization: `unfiled` -> `unfiled`, notice null; project id in `projects` -> that
 *     project, notice null; project id not in `projects` -> `unfiled`, notice `'gone'`.
 *  4. Otherwise -> `unfiled`, notice null.
 */
export function resolveOpenProject(input: ResolveOpenProjectInput): {
  open: OpenProject;
  notice: 'gone' | null;
  noticeSource: GoneNoticeSource;
} {
  const byLower = new Map<string, string>();
  for (const project of input.projects) byLower.set(project.id.toLowerCase(), project.id);

  const query = input.queryProject?.trim();
  if (query) {
    if (query.toLowerCase() === 'unfiled') return { open: { kind: 'unfiled' }, notice: null, noticeSource: null };
    const matched = byLower.get(query.toLowerCase());
    if (matched) return { open: { kind: 'project', id: matched }, notice: null, noticeSource: null };
    return { open: { kind: 'unfiled' }, notice: 'gone', noticeSource: 'address' };
  }

  const remembered = input.remembered;
  if (remembered) {
    if (remembered.kind === 'unfiled') return { open: { kind: 'unfiled' }, notice: null, noticeSource: null };
    const matched = byLower.get(remembered.id.toLowerCase());
    if (matched) return { open: { kind: 'project', id: matched }, notice: null, noticeSource: null };
    return { open: { kind: 'unfiled' }, notice: 'gone', noticeSource: 'cookie' };
  }

  return { open: { kind: 'unfiled' }, notice: null, noticeSource: null };
}

/**
 * The single project UUID the address (`?project=`) or remembered cookie asks to open, or null (`unfiled`,
 * malformed, or absent). Used by `loadStudioSpine` to look up a selectable project beyond `listMax` (100).
 */
export function openProjectCandidateId(input: { queryProject?: string | null; remembered?: OpenProject | null }): string | null {
  const query = input.queryProject?.trim();
  if (query) {
    if (query.toLowerCase() === 'unfiled') return null;
    return UUID.test(query) ? query.toLowerCase() : null;
  }
  if (input.remembered?.kind === 'project') {
    const id = input.remembered.id.trim().toLowerCase();
    return UUID.test(id) ? id : null;
  }
  return null;
}

export type VideoStudioAddressDecision =
  | { kind: 'project'; id: string }
  | { kind: 'redirect_film'; href: string; filmId: string }
  | { kind: 'gone' }
  | { kind: 'none' };

/** Convert Next.js `searchParams` object into ordered `[key, value]` entries. */
export function searchParamEntries(raw: Record<string, string | string[] | undefined>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out.push([key, value]);
    else if (Array.isArray(value)) for (const item of value) out.push([key, item]);
  }
  return out;
}

export type VideoStudioFilmLookup = 'found' | 'not_found' | 'error';

/**
 * Video studio `?project=` disambiguation while the spine is open (§4.5, G1, G2):
 *  - `?project=<id>` in `projectIds` -> open that brand project.
 *  - `?project=<id>` not in `projectIds`, but in `filmIds` (or found via beyond-100 single-id lookup)
 *    -> redirect to the same address with `film=<id>` in place of `project=<id>`, preserving all other
 *    query parameters in order.
 *  - If the film list load or single-id lookup threw (`filmListFailed` or `filmLookup === 'error'`) -> `none`
 *    (a database error must never be shown as "the project is gone").
 *  - Otherwise -> `gone` (falls back to 미분류 with `notice: 'gone'`).
 *  - No `?project=` -> `none`.
 */
export function resolveVideoStudioAddress(input: {
  pathname: string;
  searchParams: ReadonlyArray<readonly [string, string]>;
  projectIds: ReadonlySet<string> | readonly string[];
  filmIds: ReadonlySet<string> | readonly string[];
  /** Result of a single-id film lookup when `?project=` is a UUID beyond the first 100 films (G2). */
  filmLookup?: VideoStudioFilmLookup;
  /** True when loading the film list threw/failed with a non-not_found error (G1). */
  filmListFailed?: boolean;
}): VideoStudioAddressDecision {
  const projectMap = new Map<string, string>();
  for (const id of input.projectIds) projectMap.set(id.toLowerCase(), id);
  const filmMap = new Map<string, string>();
  for (const id of input.filmIds) filmMap.set(id.toLowerCase(), id);

  let rawProject: string | null = null;
  for (const [key, value] of input.searchParams) {
    if (key === 'project' && value.trim()) {
      rawProject = value.trim();
      break;
    }
  }
  if (!rawProject) return { kind: 'none' };

  const matchedProject = projectMap.get(rawProject.toLowerCase());
  if (matchedProject) return { kind: 'project', id: matchedProject };

  const buildFilmRedirect = (filmId: string): VideoStudioAddressDecision => {
    const hasFilmAlready = input.searchParams.some(([k, v]) => k === 'film' && v.trim().length > 0);
    const nextParams = new URLSearchParams();
    let replaced = false;
    for (const [key, value] of input.searchParams) {
      if (key === 'project') {
        if (!replaced && !hasFilmAlready) {
          nextParams.append('film', filmId);
          replaced = true;
        }
        continue;
      }
      nextParams.append(key, value);
    }
    const qs = nextParams.toString();
    return { kind: 'redirect_film', filmId, href: qs ? `${input.pathname}?${qs}` : input.pathname };
  };

  const matchedFilm = filmMap.get(rawProject.toLowerCase());
  if (matchedFilm) return buildFilmRedirect(matchedFilm);

  if (input.filmListFailed || input.filmLookup === 'error') return { kind: 'none' };
  if (input.filmLookup === 'found') return buildFilmRedirect(rawProject);

  return { kind: 'gone' };
}

/**
 * Combine `loadStudioSpine`, `resolveVideoStudioAddress`, and an opened `?film=` into the final
 * `StudioSpineProps` for `/brand/studio/video` (G1, G2, §4.5):
 * - If `decision.kind === 'none'` while `hadQueryProject` is true (film list/lookup DB error), clears any
 *   preliminary `gone` notice so a DB error is never shown as "project is gone" and never rewrites the cookie.
 */
export function resolveVideoPageSpine(input: {
  spine: StudioSpineProps;
  decision: Exclude<VideoStudioAddressDecision, { kind: 'redirect_film' }>;
  openedFilm: { brandProjectId?: string | null } | null;
  hadQueryProject: boolean;
}): StudioSpineProps {
  let effective = input.spine;
  if (input.decision.kind === 'project') {
    effective = { ...effective, open: { kind: 'project', id: input.decision.id }, notice: null, noticeSource: null };
  } else if (input.decision.kind === 'gone') {
    effective = { ...effective, open: { kind: 'unfiled' }, notice: 'gone', noticeSource: 'address' };
  } else if (input.hadQueryProject && effective.notice === 'gone' && effective.noticeSource === 'address') {
    effective = { ...effective, notice: null, noticeSource: null };
  }
  if (input.openedFilm) {
    effective = resolveOpenForFilm(effective, input.openedFilm);
  }
  return effective;
}

/** Scope argument for server `loadStudioState(..., { scope })`. */
export function scopeOfOpenProject(open: OpenProject): StudioStateScope {
  return open.kind === 'project' ? { kind: 'project', brandProjectId: open.id } : { kind: 'unfiled' };
}

/** Value for `GET /api/brand-studio?organizationId=…&brandProject=<id|unfiled>`. */
export function queryParamOfOpenProject(open: OpenProject): string {
  return open.kind === 'project' ? open.id : 'unfiled';
}

/** The brand project id to send on creation requests, or null for 미분류 (caller omits the key). */
export function brandProjectIdOf(open: OpenProject | null | undefined): string | null {
  return open?.kind === 'project' ? open.id : null;
}

/** Whether a run or film's `brandProjectId` belongs to the open scope. */
export function belongsToOpenProject(brandProjectId: string | null | undefined, open: OpenProject): boolean {
  const value = brandProjectId ? brandProjectId.toLowerCase() : null;
  const target = open.kind === 'project' ? open.id.toLowerCase() : null;
  return value === target;
}

/** Update `?project=` in a URL string for `history.replaceState` (`unfiled` removes the parameter). */
export function replaceProjectUrlParam(href: string, open: OpenProject): string {
  const url = new URL(href);
  if (open.kind === 'project') url.searchParams.set('project', open.id);
  else url.searchParams.delete('project');
  return url.toString();
}

export interface GoneNoticeSideEffects {
  writeUnfiledCookie: boolean;
  nextUrl: string | null;
}

/**
 * A project the page opened without a notice is remembered for this browser and organization, however it was
 * named: by the address (a shared link, a bookmark) or by the cookie itself. Without this, a member who arrives by
 * `?project=<id>` and then moves to another studio through the rail (whose links carry no `project`) would fall
 * back to whatever was remembered before. 미분류 with no notice is already what the cookie says or its default.
 */
export function rememberOpenedProject(initial: { open: OpenProject; notice: 'gone' | null }): OpenProject | null {
  return initial.notice === null && initial.open.kind === 'project' ? initial.open : null;
}

/**
 * Pure cleanup decision on mount when `notice === 'gone'` (F3):
 * - From the address (`?project=<gone>`): strip `project` from the URL (keeping other params) so a reload
 *   does not repeat the notice, and NEVER wipe a valid remembered cookie.
 * - From the cookie: rewrite the cookie to `unfiled`; leave the URL untouched.
 */
export function planGoneNoticeCleanup(input: {
  notice: 'gone' | null;
  noticeSource: GoneNoticeSource;
  href: string | null;
}): GoneNoticeSideEffects {
  if (input.notice !== 'gone') return { writeUnfiledCookie: false, nextUrl: null };
  if (input.noticeSource === 'address') {
    const nextUrl = input.href ? replaceProjectUrlParam(input.href, { kind: 'unfiled' }) : null;
    return { writeUnfiledCookie: false, nextUrl: nextUrl && nextUrl !== input.href ? nextUrl : null };
  }
  if (input.noticeSource === 'cookie') {
    return { writeUnfiledCookie: true, nextUrl: null };
  }
  return { writeUnfiledCookie: false, nextUrl: null };
}

/** Pure cookie + URL plan when the member selects a project or 미분류 (F8.5). */
export function planProjectSelection(input: {
  memory: Readonly<Record<string, OpenProject>>;
  organizationId: string;
  next: OpenProject;
  href: string | null;
  syncUrl?: boolean;
}): { cookieValue: string; nextUrl: string | null } {
  const cookieValue = rememberOpenProject(input.memory, input.organizationId, input.next);
  const nextUrl = input.syncUrl !== false && input.href ? replaceProjectUrlParam(input.href, input.next) : null;
  return { cookieValue, nextUrl };
}

/**
 * Opening a film by address (`?film=`) whose `brandProjectId` differs from the open scope switches the open
 * scope to the film's (the film wins, §4.5). Returns `spine` unchanged when the film already matches `open`.
 */
export function resolveOpenForFilm(
  spine: StudioSpineProps,
  film: { brandProjectId?: string | null },
): StudioSpineProps {
  if (belongsToOpenProject(film.brandProjectId, spine.open)) return spine;
  const rawId = film.brandProjectId?.trim();
  if (rawId) {
    const matched = spine.projects.find((p) => p.id.toLowerCase() === rawId.toLowerCase());
    if (matched) return { ...spine, open: { kind: 'project', id: matched.id }, notice: null, noticeSource: null };
  }
  return { ...spine, open: { kind: 'unfiled' }, notice: null, noticeSource: null };
}
