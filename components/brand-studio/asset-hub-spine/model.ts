/**
 * Pure decisions for the regrouped assets page (`BrandAssetHub` with `spine`, slice 2b).
 * No React or DOM imports, no module-level mutable state. Every exported helper is called
 * by the components under `./`.
 */
import {
  BRAND_PROJECT_LIMITS,
  type BrandMaterialRole,
  type BrandProjectFileItem,
  type BrandProjectFileKind,
  type BrandProjectFilesScope,
  type BrandProjectViewFilter,
  type StudioAssetView,
  type StudioBrandProject,
  type StudioBrandProjectCounts,
  type StudioBrandProjectFiles,
  type StudioBrandProjectGroup,
  type StudioBrandProjectOverview,
  type StudioBrandProjectSummary,
  type StudioBrandProjectTotals,
  type StudioJobView,
  type StudioOutputView,
} from "@/lib/brand-studio/contracts";
import type { VideoProjectSummary } from "@/lib/brand-studio/video-projects/contracts";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { buildHubEntries, filterHubEntries, type HubDeliverable, type HubEntry, type HubSection } from "../asset-hub-model";
import { errorLine, type StudioCopy } from "../copy";
import type { MoveDialogScope } from "../project-chip/model";

export type SpineHubTab = "by_project" | "brand_materials" | "unfiled" | "all";

export interface SpineTabLabels {
  byProject: string;
  brandMaterials: string;
  unfiled: string;
  all: string;
}

export interface SpineHubTabItem {
  id: SpineHubTab;
  label: string;
  count?: number;
}

export const BRAND_MATERIALS_ROLE_ORDER = ["logo", "product", "person", "style", "place"] as const satisfies readonly BrandMaterialRole[];

export const BRAND_MATERIALS_LINE_LIMIT = 8;

const BRAND_MATERIAL_ROLE_SET: ReadonlySet<string> = new Set(BRAND_MATERIALS_ROLE_ORDER);

function isBrandMaterialRole(role: StudioAssetView["role"]): role is BrandMaterialRole {
  return role !== null && BRAND_MATERIAL_ROLE_SET.has(role);
}

export interface SpineOrgLogo {
  url: string;
  editHref: string | null;
}

/** Total tiles counted inside one `StudioBrandProjectCounts` record. */
export function sumProjectCounts(counts: StudioBrandProjectCounts): number {
  return counts.image + counts.video + counts.sound + counts.upload + counts.film;
}

/**
 * Adds the organization's own logo (`+1` total and `+1` `logo` role) when `orgLogo` is present (Batch D).
 * Shared by the `브랜드 자료` tab count, the `프로젝트별` line count, and the `로고` role chip.
 */
export function brandMaterialsCountsWithLogo(
  brandMaterials: StudioBrandProjectOverview["brandMaterials"],
  hasOrgLogo: boolean,
): StudioBrandProjectOverview["brandMaterials"] {
  if (!hasOrgLogo) return brandMaterials;
  return {
    ...brandMaterials,
    count: brandMaterials.count + 1,
    byRole: {
      ...brandMaterials.byRole,
      logo: brandMaterials.byRole.logo + 1,
    },
  };
}

/** The four tabs of the regrouped assets page in fixed order (§5.2). `모든 파일` carries no number. */
export function buildSpineTabs(
  overview: StudioBrandProjectOverview,
  labels: SpineTabLabels,
  hasOrgLogo = false,
): SpineHubTabItem[] {
  const materials = brandMaterialsCountsWithLogo(overview.brandMaterials, hasOrgLogo);
  return [
    { id: "by_project", label: labels.byProject, count: overview.projects.length },
    { id: "brand_materials", label: labels.brandMaterials, count: materials.count },
    { id: "unfiled", label: labels.unfiled, count: sumProjectCounts(overview.unfiled.counts) },
    { id: "all", label: labels.all },
  ];
}

/** Opens on 프로젝트별 whenever there is at least one visible/finished project or 브랜드 자료 (including `orgLogo`), else 모든 파일 (§5.2, Batch D, R-A). */
export function initialSpineTab(overview: StudioBrandProjectOverview, hasOrgLogo = false): SpineHubTab {
  if (
    overview.projects.length > 0 ||
    brandMaterialsCountsWithLogo(overview.brandMaterials, hasOrgLogo).count > 0 ||
    (overview.totals !== undefined && overview.totals.all > 0) ||
    (overview.finished !== undefined && sumProjectCounts(overview.finished.counts) > 0)
  ) {
    return "by_project";
  }
  return "all";
}

export type LibraryEntryPlace =
  | { scope: "unknown" }
  | { scope: "project"; brandProjectId: string }
  | { scope: "brand_materials"; role: BrandMaterialRole }
  | { scope: "unfiled" };

/**
 * Classifies one library entry according to the view contract (§3):
 * missing `brandProjectId` -> unknown (shown in no group);
 * non-empty string -> that project;
 * `null` + brand-material role -> brand_materials; `null` otherwise -> unfiled.
 */
export function classifyLibraryEntry(entry: Pick<StudioAssetView, "brandProjectId" | "role">): LibraryEntryPlace {
  if (entry.brandProjectId === undefined) return { scope: "unknown" };
  if (typeof entry.brandProjectId === "string" && entry.brandProjectId.length > 0) {
    return { scope: "project", brandProjectId: entry.brandProjectId };
  }
  if (entry.brandProjectId === null) {
    if (isBrandMaterialRole(entry.role)) return { scope: "brand_materials", role: entry.role };
    return { scope: "unfiled" };
  }
  return { scope: "unknown" };
}

export interface BrandMaterialRoleGroup {
  role: BrandMaterialRole;
  assets: StudioAssetView[];
}

/**
 * Builds the single-line 브랜드 자료 strip ordered logo -> product -> person -> style -> place (§5.3),
 * capped at `limit` (default 8) with round-robin allocation across non-empty roles so later roles are not starved.
 */
export function groupBrandMaterialsLine(
  assets: readonly StudioAssetView[],
  limit = BRAND_MATERIALS_LINE_LIMIT,
): BrandMaterialRoleGroup[] {
  if (limit <= 0) return [];
  const buckets = new Map<BrandMaterialRole, StudioAssetView[]>();
  for (const role of BRAND_MATERIALS_ROLE_ORDER) buckets.set(role, []);

  for (const entry of assets) {
    const place = classifyLibraryEntry(entry);
    if (place.scope !== "brand_materials") continue;
    buckets.get(place.role)!.push(entry);
  }

  const picked = new Map<BrandMaterialRole, StudioAssetView[]>();
  for (const role of BRAND_MATERIALS_ROLE_ORDER) picked.set(role, []);

  let remaining = limit;
  let index = 0;
  while (remaining > 0) {
    let addedInRound = false;
    for (const role of BRAND_MATERIALS_ROLE_ORDER) {
      if (remaining <= 0) break;
      const list = buckets.get(role)!;
      if (index < list.length) {
        picked.get(role)!.push(list[index]!);
        remaining -= 1;
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    index += 1;
  }

  const result: BrandMaterialRoleGroup[] = [];
  for (const role of BRAND_MATERIALS_ROLE_ORDER) {
    const list = picked.get(role)!;
    if (list.length > 0) result.push({ role, assets: list });
  }
  return result;
}

export interface GroupCountLabels {
  image: string;
  video: string;
  sound: string;
  upload: string;
  film: string;
  deliverables: string;
}

const COUNT_KIND_ORDER = ["image", "video", "sound", "upload", "film"] as const;

/**
 * Formats non-zero kind counts in fixed order (image, video, sound, upload, film),
 * appending `deliverables` for team projects when `deliverableCount > 0` (§5.3).
 */
export function formatGroupCounts(
  counts: StudioBrandProjectCounts,
  origin: "self" | "team",
  labels: GroupCountLabels,
  deliverableCount = 0,
): string {
  const parts: string[] = [];
  for (const kind of COUNT_KIND_ORDER) {
    const n = counts[kind];
    if (n > 0) parts.push(`${labels[kind]} ${n}`);
  }
  if (origin === "team" && deliverableCount > 0) {
    parts.push(`${labels.deliverables} ${deliverableCount}`);
  }
  return parts.join(" · ");
}

/** Filters overview project groups by title substring (trimmed, case-insensitive) while keeping server order. */
export function filterOverviewProjects(
  projects: readonly StudioBrandProjectGroup[],
  query: string,
): StudioBrandProjectGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...projects];
  return projects.filter((group) => group.project.title.toLowerCase().includes(needle));
}

/** Counts campaign deliverables per project id for team project counts lines. */
export function deliverableCountsByProject(
  deliverables: readonly Pick<HubDeliverable, "projectId">[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of deliverables) {
    map.set(item.projectId, (map.get(item.projectId) ?? 0) + 1);
  }
  return map;
}

export type ScopeKindFilter = "all" | BrandProjectFileKind;
export type ScopeRoleFilter = "all" | BrandMaterialRole;

export interface KindChipLabels {
  all: string;
  image: string;
  video: string;
  sound: string;
  upload: string;
  film: string;
}

export interface KindChip {
  id: ScopeKindFilter;
  label: string;
  count: number;
}

const SCOPE_KIND_ORDER = ["image", "video", "sound", "upload", "film"] as const satisfies readonly BrandProjectFileKind[];

/** DOM marker value for an opened scope section (`project:<id>`, `unfiled`, or `brand_materials`). */
export function scopeMarker(scope: BrandProjectFilesScope): string {
  return scope.kind === "project" ? `project:${scope.brandProjectId}` : scope.kind;
}

/**
 * Kind filter chips in fixed order (`모두 · 이미지 · 영상 · 사운드 · 올린 파일 · 편집본`, §5.4).
 * Hides zero-count kinds (unless currently active) and returns an empty list when total is 0.
 */
export function buildKindChips(
  counts: StudioBrandProjectCounts,
  labels: KindChipLabels,
  activeKind: ScopeKindFilter = "all",
): KindChip[] {
  const total = sumProjectCounts(counts);
  if (total === 0 && activeKind === "all") return [];
  const chips: KindChip[] = [{ id: "all", label: labels.all, count: total }];
  for (const kind of SCOPE_KIND_ORDER) {
    const count = counts[kind];
    if (count > 0 || kind === activeKind) {
      chips.push({ id: kind, label: labels[kind], count });
    }
  }
  return chips;
}

export type RoleChipLabels = { all: string } & Record<BrandMaterialRole, string>;

export interface RoleChip {
  id: ScopeRoleFilter;
  label: string;
  count: number;
}

/**
 * Role filter chips for `브랜드 자료` in fixed order (`역할 모두 · 로고 · 제품 · 인물 · 스타일 · 장소`, §5.4).
 * Hides zero-count roles (unless currently active) and returns an empty list when total is 0.
 */
export function buildRoleChips(
  byRole: Record<BrandMaterialRole, number>,
  labels: RoleChipLabels,
  activeRole: ScopeRoleFilter = "all",
): RoleChip[] {
  const total = BRAND_MATERIALS_ROLE_ORDER.reduce((sum, role) => sum + byRole[role], 0);
  if (total === 0 && activeRole === "all") return [];
  const chips: RoleChip[] = [{ id: "all", label: labels.all, count: total }];
  for (const role of BRAND_MATERIALS_ROLE_ORDER) {
    const count = byRole[role];
    if (count > 0 || role === activeRole) {
      chips.push({ id: role, label: labels[role], count });
    }
  }
  return chips;
}

export interface ScopeEmptyLabels {
  groupEmpty: string;
  unfiledEmpty: string;
  materialsEmpty: string;
}

/** Selects the empty-state line for a scope (`noMatch` takes precedence when filtering/searching). */
export function scopeEmptyMessage(
  scope: BrandProjectFilesScope,
  labels: ScopeEmptyLabels,
  hasActiveFilterOrSearch: boolean,
  noMatchText: string,
): string {
  if (hasActiveFilterOrSearch) return noMatchText;
  if (scope.kind === "project") return labels.groupEmpty;
  if (scope.kind === "brand_materials") return labels.materialsEmpty;
  return labels.unfiledEmpty;
}

export type ScopeLoadPhase = "loading" | "loading_more" | "ready" | "failed" | "not_found";

export interface ScopePageState {
  phase: ScopeLoadPhase;
  items: BrandProjectFileItem[];
  jobs: StudioJobView[];
  assets: StudioAssetView[];
  films: VideoProjectSummary[];
  next: string | null;
  projectSummary?: StudioBrandProjectSummary | null;
}

export type ScopePageAction =
  | { type: "restart" }
  | { type: "start_first" }
  | { type: "start_more" }
  | { type: "loaded"; mode: "replace" | "append"; page: StudioBrandProjectFiles }
  | { type: "failed"; code?: string };

function appendUnique<T>(existing: readonly T[], incoming: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of existing) {
    const key = keyOf(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  for (const item of incoming) {
    const key = keyOf(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function applyLoadedPage(state: ScopePageState, mode: "replace" | "append", page: StudioBrandProjectFiles): ScopePageState {
  const baseItems = mode === "append" ? state.items : [];
  const baseJobs = mode === "append" ? state.jobs : [];
  const baseAssets = mode === "append" ? state.assets : [];
  const baseFilms = mode === "append" ? state.films : [];
  const projectSummary = mode === "append" ? (state.projectSummary ?? null) : (page.project ?? null);
  return {
    phase: "ready",
    items: appendUnique(baseItems, page.items, (item) => `${item.type}:${item.id}`),
    jobs: appendUnique(baseJobs, page.jobs, (j) => j.id),
    assets: appendUnique(baseAssets, page.assets, (a) => a.id),
    films: appendUnique(baseFilms, page.films, (f) => f.id),
    next: page.next,
    ...(projectSummary ? { projectSummary } : {}),
  };
}

/** Initial state for `ScopeView`; optionally seeded synchronously with a fetched page for deterministic SSR tests. */
export function initialScopePageState(seed?: StudioBrandProjectFiles | null): ScopePageState {
  const empty: ScopePageState = {
    phase: "loading",
    items: [],
    jobs: [],
    assets: [],
    films: [],
    next: null,
  };
  return seed ? applyLoadedPage(empty, "replace", seed) : empty;
}

/** Pure transition reducer for paged `project.files` reads inside an opened scope. */
export function scopePageReducer(state: ScopePageState, action: ScopePageAction): ScopePageState {
  switch (action.type) {
    case "restart":
      return initialScopePageState();
    case "start_first":
      return { ...state, phase: "loading" };
    case "start_more":
      return state.next !== null ? { ...state, phase: "loading_more" } : state;
    case "loaded":
      return applyLoadedPage(state, action.mode, action.page);
    case "failed":
      return {
        ...state,
        phase: action.code === "not_found" ? "not_found" : "failed",
      };
  }
}

/** Whether a scope load failure (`not_found`) means a selected project is gone and should close back to overview. */
export function shouldCloseScopeOnFailure(scope: BrandProjectFilesScope, phase: ScopeLoadPhase): boolean {
  return scope.kind === "project" && phase === "not_found";
}

export type ScopeTile =
  | { kind: "entry"; key: string; entry: HubEntry }
  | { kind: "film"; key: string; film: VideoProjectSummary };

/**
 * Merges loaded jobs, assets, and films into one newest-first interleaved tile list following `items` order,
 * applying `filterHubEntries` (search + role) to entries and matching substring/role filtering to films.
 */
export function mergeScopeTiles(
  state: Pick<ScopePageState, "items" | "jobs" | "assets" | "films">,
  opts: {
    sourceGeneratedLabel: string;
    liked: ReadonlySet<string>;
    query: string;
    role: ScopeRoleFilter;
  },
): ScopeTile[] {
  const allEntries = buildHubEntries(state.assets, state.jobs, opts.sourceGeneratedLabel);
  const visibleEntries = filterHubEntries(allEntries, {
    section: "all",
    liked: opts.liked,
    query: opts.query,
    kind: "all",
    role: opts.role,
    similarTo: null,
  });

  const entryByAssetId = new Map<string, HubEntry>();
  const entriesByJobId = new Map<string, HubEntry[]>();
  for (const entry of visibleEntries) {
    if (entry.asset) entryByAssetId.set(entry.asset.id, entry);
    else if (entry.jobId) {
      const bucket = entriesByJobId.get(entry.jobId);
      if (bucket) bucket.push(entry);
      else entriesByJobId.set(entry.jobId, [entry]);
    }
  }

  const needle = opts.query.trim().toLowerCase();
  const visibleFilms =
    opts.role !== "all"
      ? []
      : state.films.filter((film) => !needle || film.title.toLowerCase().includes(needle));
  const filmById = new Map<string, VideoProjectSummary>(visibleFilms.map((film) => [film.id, film]));

  const tiles: ScopeTile[] = [];
  const emitted = new Set<string>();
  const pushEntry = (entry: HubEntry) => {
    if (emitted.has(entry.key)) return;
    emitted.add(entry.key);
    tiles.push({ kind: "entry", key: entry.key, entry });
  };
  const pushFilm = (film: VideoProjectSummary) => {
    const key = `f:${film.id}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    tiles.push({ kind: "film", key, film });
  };

  for (const item of state.items) {
    if (item.type === "asset") {
      const entry = entryByAssetId.get(item.id);
      if (entry) pushEntry(entry);
    } else if (item.type === "job") {
      const group = entriesByJobId.get(item.id);
      if (group) for (const entry of group) pushEntry(entry);
    } else if (item.type === "film") {
      const film = filmById.get(item.id);
      if (film) pushFilm(film);
    }
  }

  // Fallback for any item omitted from `items`: keep newest-first deterministic ordering.
  for (const entry of visibleEntries) pushEntry(entry);
  for (const film of visibleFilms) pushFilm(film);

  return tiles;
}

/** Converts a compose/video aspect tag (`9:16`, `16:9`, `4:5`, `1:1`) into a numeric CSS `--r` ratio. */
export function filmTileAspectRatio(aspect: VideoProjectSummary["aspect"]): number {
  const parts = aspect.split(":");
  if (parts.length === 2) {
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return Math.min(1.9, Math.max(0.55, w / h));
    }
  }
  return 1;
}

/** Toggles one tile key inside a scope multi-selection set immutably (§5.5). */
export function toggleScopeSelection(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export interface ScopeMoveInput {
  jobIds: string[];
  assetIds: string[];
  filmIds: string[];
  selectedCount: number;
  totalTargets: number;
  overLimit: boolean;
}

/**
 * Translates selected tile keys in an opened scope into deduplicated `project.move` ids (§5.5):
 * generated outputs select their run (`jobIds`), uploads select their asset (`assetIds`),
 * and `편집본` tiles select their film (`filmIds`). Checks the 200 combined target cap.
 */
export function collectScopeMoveInput(
  tiles: readonly ScopeTile[],
  selectedKeys: ReadonlySet<string>,
  limit = BRAND_PROJECT_LIMITS.moveMax,
): ScopeMoveInput {
  const jobIds: string[] = [];
  const assetIds: string[] = [];
  const filmIds: string[] = [];
  const seenJobs = new Set<string>();
  const seenAssets = new Set<string>();
  const seenFilms = new Set<string>();
  let selectedCount = 0;

  for (const tile of tiles) {
    if (!selectedKeys.has(tile.key)) continue;
    selectedCount += 1;
    if (tile.kind === "film") {
      if (!seenFilms.has(tile.film.id)) {
        seenFilms.add(tile.film.id);
        filmIds.push(tile.film.id);
      }
      continue;
    }
    const { entry } = tile;
    if (entry.origin === "upload" && entry.asset) {
      if (!seenAssets.has(entry.asset.id)) {
        seenAssets.add(entry.asset.id);
        assetIds.push(entry.asset.id);
      }
    } else if (entry.origin === "generated" && entry.jobId) {
      if (!seenJobs.has(entry.jobId)) {
        seenJobs.add(entry.jobId);
        jobIds.push(entry.jobId);
      }
    }
  }

  const totalTargets = jobIds.length + assetIds.length + filmIds.length;
  return {
    jobIds,
    assetIds,
    filmIds,
    selectedCount,
    totalTargets,
    overLimit: totalTargets > limit,
  };
}

export type SpineMutationKind = "move" | "upload" | "delete" | "role" | "result_delete";

export interface SpineRefreshPlan {
  reloadOverview: boolean;
  reloadStudioState: boolean;
  restartOpenScope: boolean;
}

/**
 * Pure post-mutation refresh plan (§5.6, Fix 4-7, Fix 5-2, R-A):
 * - Re-reads `project.overview` once and restarts an open scope from page 1.
 * - Re-reads `studio` state for `move`, `role`, and `result_delete`; skips `reloadStudioState` on `delete` and `upload`
 *   because `studio.deleteAsset` and `studio.upload` already call `refreshSilently()`.
 */
export function planSpineRefresh(kind: SpineMutationKind, hasOpenScope: boolean): SpineRefreshPlan {
  return {
    reloadOverview: true,
    reloadStudioState: kind === "move" || kind === "role" || kind === "result_delete",
    restartOpenScope: hasOpenScope,
  };
}

export type AllViewKey = "all" | "uploads" | "generated" | "liked" | "folders" | "deliverables";

const ALL_VIEW_ORDER: readonly AllViewKey[] = ["all", "uploads", "generated", "liked", "folders", "deliverables"];

/**
 * Options for the `"보기"` select on `모든 파일` (§5.7), in fixed order and including
 * `liked` / `folders` / `deliverables` only when today's section list would include them.
 */
export function buildAllViewOptions(
  labels: Record<AllViewKey, string>,
  availableSections: readonly HubSection[],
): Array<{ id: AllViewKey; label: string }> {
  const present = new Set(availableSections);
  return ALL_VIEW_ORDER.filter((key) => present.has(key)).map((id) => ({
    id,
    label: labels[id],
  }));
}

/** Filters campaign deliverables belonging to one team project by trimmed case-insensitive title substring. */
export function filterTeamDeliverables(
  deliverables: readonly HubDeliverable[],
  teamProjectId: string,
  query: string,
): HubDeliverable[] {
  const needle = query.trim().toLowerCase();
  return deliverables.filter(
    (item) =>
      item.projectId === teamProjectId &&
      (!needle ||
        item.title.toLowerCase().includes(needle) ||
        item.projectTitle.toLowerCase().includes(needle)),
  );
}

export interface ScopeFirstPageCursor {
  scopeId: string;
  kind: ScopeKindFilter;
  refreshNonce: number;
}

/**
 * Pure decision (Fix 2-1): returns `true` only on mount (`prev === null`) or when `scopeId`,
 * `kind` filter, or post-mutation `refreshNonce` changed — never for fresh `scope` object identity.
 */
export function shouldReadScopeFirstPage(
  prev: ScopeFirstPageCursor | null,
  next: ScopeFirstPageCursor,
): boolean {
  if (!prev) return true;
  return (
    prev.scopeId !== next.scopeId ||
    prev.kind !== next.kind ||
    prev.refreshNonce !== next.refreshNonce
  );
}

export interface ScopeMoveSnapshot {
  readonly jobIds: readonly string[];
  readonly assetIds: readonly string[];
  readonly filmIds: readonly string[];
  readonly selectedCount: number;
}

/**
 * Captures a frozen copy of `ScopeMoveInput` when "프로젝트로 옮기기" opens the dialog (Fix 3-2),
 * ensuring background restarts or filter changes while the dialog is open cannot alter confirmed targets.
 */
export function freezeScopeMoveSnapshot(input: ScopeMoveInput): ScopeMoveSnapshot {
  return Object.freeze({
    jobIds: Object.freeze([...input.jobIds]),
    assetIds: Object.freeze([...input.assetIds]),
    filmIds: Object.freeze([...input.filmIds]),
    selectedCount: input.selectedCount,
  });
}

export interface OverviewReloadState {
  inFlight: boolean;
  queued: boolean;
}

export const IDLE_OVERVIEW_RELOAD: OverviewReloadState = Object.freeze({
  inFlight: false,
  queued: false,
});

/**
 * Fallback project covers when server `group.covers` is empty (Fix 4-4):
 * returns up to `limit` newest library uploads explicitly filed to `projectId` (`brandProjectId === projectId`)
 * with `kind === "image"` and a URL — never cross-project, missing/null `brandProjectId`, or video/audio.
 */
export function fallbackCovers(
  assets: readonly StudioAssetView[],
  projectId: string,
  limit = 6,
): StudioAssetView[] {
  if (!projectId || limit <= 0) return [];
  const target = projectId.toLowerCase();
  return assets
    .filter(
      (entry) =>
        typeof entry.brandProjectId === "string" &&
        entry.brandProjectId.toLowerCase() === target &&
        entry.kind === "image" &&
        Boolean(entry.thumbUrl ?? entry.url),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}

/**
 * Coalesces `loadBrandProjectOverview()` triggers so an invalidation arriving mid-flight sets
 * `queued: true` rather than being dropped (Fix 3-3), queueing at most one follow-up read.
 */
export function requestOverviewReload(
  state: OverviewReloadState,
): { next: OverviewReloadState; startRead: boolean } {
  if (state.inFlight) {
    return { next: { inFlight: true, queued: true }, startRead: false };
  }
  return { next: { inFlight: true, queued: false }, startRead: true };
}

/**
 * Settles one finished `loadBrandProjectOverview()` request cleanly (Fix 3-3):
 * runs at most one queued follow-up read (`queued -> false`) with no re-queue loop.
 */
export function settleOverviewReload(
  state: OverviewReloadState,
): { next: OverviewReloadState; startRead: boolean } {
  if (state.queued) {
    return { next: { inFlight: true, queued: false }, startRead: true };
  }
  return { next: { inFlight: false, queued: false }, startRead: false };
}

/** DOM selectors to return focus to a tile's menu button after closing the single-file move dialog (Fix 4-5). */
export function singleMoveReturnSelectors(entryKey: string): { menu: string; open: string } {
  return {
    menu: `[data-asset-hub-card="${entryKey}"] [aria-haspopup="menu"]`,
    open: `[data-asset-hub-card="${entryKey}"] [data-asset-hub-open]`,
  };
}

/**
 * Translates one `HubEntry` from a tile menu or `HubDetail` into `MoveToProjectDialog` props (Fix 2-10, Fix 3-5, Fix 4-10).
 * Generated outputs move their run (`jobIds`), uploaded library assets move their asset (`assetIds`).
 * Unfiled brand materials pass `{ kind: "brand_materials" }`; absent `brandProjectId` (`undefined`) passes `{ kind: "unknown" }`.
 */
export function singleEntryMoveInput(
  entry: Pick<HubEntry, "jobId" | "asset">,
  currentProjectId: string | null | undefined,
  inBrandMaterials = false,
): {
  jobIds: string[];
  assetIds: string[];
  currentScope: MoveDialogScope;
} {
  const isMaterial =
    inBrandMaterials ||
    (!entry.jobId && Boolean(entry.asset) && classifyLibraryEntry(entry.asset!).scope === "brand_materials");
  return {
    jobIds: entry.jobId ? [entry.jobId] : [],
    assetIds: !entry.jobId && entry.asset ? [entry.asset.id] : [],
    currentScope:
      typeof currentProjectId === "string"
        ? { kind: "project", id: currentProjectId }
        : currentProjectId === null
          ? isMaterial
            ? { kind: "brand_materials" }
            : { kind: "unfiled" }
          : isMaterial
            ? { kind: "brand_materials" }
            : { kind: "unknown" },
  };
}

export interface LibraryProjectsSwitchItem {
  key: BrandProjectViewFilter;
  label: string;
  count: number;
  href: string;
  current: boolean;
}

export interface LibraryProjectsSwitch {
  active: LibraryProjectsSwitchItem;
  all: LibraryProjectsSwitchItem;
}

/** Parses `?projects=all` on `/brand/library` (absent or anything else -> `'active'`). */
export function parseLibraryProjectsFilter(raw: string | string[] | undefined): BrandProjectViewFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" ? "all" : "active";
}

/** Builds the `진행 중 N / 전체 M` link switch for the assets by-project view when `totals` shows finished projects exist. */
export function libraryProjectsSwitch(
  overview: Pick<StudioBrandProjectOverview, "totals">,
  filter: BrandProjectViewFilter,
  organizationId: string,
  labels: { active: string; all: string },
): LibraryProjectsSwitch | null {
  if (!overview.totals || overview.totals.active === overview.totals.all) return null;
  const activeHref = `/brand/library?organizationId=${encodeURIComponent(organizationId)}`;
  return {
    active: {
      key: "active",
      label: labels.active,
      count: overview.totals.active,
      href: activeHref,
      current: filter === "active",
    },
    all: {
      key: "all",
      label: labels.all,
      count: overview.totals.all,
      href: `${activeHref}&projects=all`,
      current: filter === "all",
    },
  };
}

/** Whether an overview group belongs to a finished project (`selectable: false` or non-open `status`). */
export function isFinishedProjectGroup(
  group: Pick<StudioBrandProjectGroup, "status" | "selectable"> | null | undefined,
): boolean {
  if (!group) return false;
  return group.selectable === false || (group.status !== undefined && group.status !== "open");
}

/** Quiet mark shown beside a finished project group/scope title; `null` when active or legacy shape. */
export function projectGroupStatusMark(
  group: Pick<StudioBrandProjectGroup, "status" | "selectable"> | null | undefined,
  finishedMark: string,
): string | null {
  return isFinishedProjectGroup(group) ? finishedMark : null;
}

/**
 * Orders overview project groups for the assets by-project view (R-A §2.2):
 * on `all`, active groups keep server activity order first and finished groups follow in server activity order.
 */
export function orderOverviewProjects(
  projects: readonly StudioBrandProjectGroup[],
  filter: BrandProjectViewFilter,
): StudioBrandProjectGroup[] {
  if (filter !== "all") return [...projects];
  const active: StudioBrandProjectGroup[] = [];
  const finished: StudioBrandProjectGroup[] = [];
  for (const group of projects) {
    if (isFinishedProjectGroup(group)) finished.push(group);
    else active.push(group);
  }
  return [...active, ...finished];
}

/** Quiet `finishedFiles` link at the end of `진행 중` when finished projects hold files (`overview.finished.counts` total > 0). */
export function finishedFilesSummary(
  overview: Pick<StudioBrandProjectOverview, "finished">,
  filter: BrandProjectViewFilter,
  organizationId: string,
): { count: number; href: string } | null {
  if (filter === "all" || !overview.finished) return null;
  const count = sumProjectCounts(overview.finished.counts);
  if (count <= 0) return null;
  return {
    count,
    href: `/brand/library?organizationId=${encodeURIComponent(organizationId)}&projects=all`,
  };
}

/** Excludes finished projects from `MoveToProjectDialog` targets (cannot move INTO finished projects). */
export function selectableMoveProjects(projects: readonly StudioBrandProjectGroup[]): StudioBrandProject[] {
  return projects.filter((group) => !isFinishedProjectGroup(group)).map((group) => group.project);
}

/** Capabilities and banners for an opened project scope: finished projects hide add-work controls but keep view/download/send/move-out. */
export function finishedScopeControls(isFinished: boolean): {
  showFinishedHint: boolean;
  canAddWork: boolean;
  canView: boolean;
  canDownload: boolean;
  canSend: boolean;
  canMoveOut: boolean;
} {
  return {
    showFinishedHint: isFinished,
    canAddWork: !isFinished,
    canView: true,
    canDownload: true,
    canSend: true,
    canMoveOut: true,
  };
}

export type ScopeControls = ReturnType<typeof finishedScopeControls>;

function overviewHasFinishedFiles(overview: Pick<StudioBrandProjectOverview, "finished" | "totals">): boolean {
  if (overview.finished && sumProjectCounts(overview.finished.counts) > 0) return true;
  return Boolean(overview.totals && overview.totals.all > overview.totals.active);
}

function findSelectableProjectId(
  projectId: string | null | undefined,
  moveTargets: readonly Pick<StudioBrandProject, "id">[],
): string | undefined {
  if (typeof projectId !== "string" || !projectId) return undefined;
  const normalized = projectId.toLowerCase();
  const match = moveTargets.find((project) => project.id.toLowerCase() === normalized);
  return match ? match.id : undefined;
}

/**
 * Resolves `MoveToProjectDialog` `currentScope` for an opened `ScopeView` (Fix round 2):
 * finished or non-selectable projects map to `{ kind: "unknown" }` so opening the dialog sends 0 preview requests.
 */
export function resolveScopeDialogScope(
  scopeKind: BrandProjectFilesScope["kind"],
  brandProjectId: string,
  isFinished: boolean,
  moveTargets: readonly Pick<StudioBrandProject, "id">[],
): MoveDialogScope {
  if (scopeKind === "brand_materials") return { kind: "brand_materials" };
  if (scopeKind === "unfiled") return { kind: "unfiled" };
  if (isFinished) return { kind: "unknown" };
  const activeId = findSelectableProjectId(brandProjectId, moveTargets);
  return activeId ? { kind: "project", id: activeId } : { kind: "unknown" };
}

/**
 * Resolves the current project id for single-file `MoveToProjectDialog` (R-A Fix 4 & Fix round 2):
 * - Finished or non-selectable projects always return `undefined` (`{ kind: "unknown" }`) so opening the dialog sends 0 preview requests.
 * - Active projects continue returning their canonical id (`{ kind: "project", id }`).
 * - On `모든 파일`, finished project covers also return `undefined` (never finished id and never false `미분류`).
 */
export function resolveSingleMoveProjectId(
  entry: Pick<HubEntry, "jobId" | "asset" | "output">,
  reportedProjectId: string | null | undefined,
  ctx: {
    activeTab: SpineHubTab;
    openedScope: BrandProjectFilesScope | null;
    overview: StudioBrandProjectOverview;
    initialProjectGroup?: StudioBrandProjectGroup | null;
  },
): string | null | undefined {
  const moveTargets = selectableMoveProjects(ctx.overview.projects);
  if (ctx.activeTab === "by_project" && ctx.openedScope?.kind === "project") {
    return findSelectableProjectId(ctx.openedScope.brandProjectId, moveTargets);
  }
  if (ctx.activeTab === "brand_materials" || ctx.activeTab === "unfiled") {
    return null;
  }
  if (typeof reportedProjectId === "string" && reportedProjectId) {
    return findSelectableProjectId(reportedProjectId, moveTargets);
  }
  if (!entry.jobId && entry.asset && classifyLibraryEntry(entry.asset).scope === "brand_materials") {
    return null;
  }

  const outputId = entry.output?.id.toLowerCase() ?? null;
  const jobId = entry.jobId?.toLowerCase() ?? null;
  const matchesCover = (cover: { outputId: string; jobId: string }) =>
    (outputId !== null && cover.outputId.toLowerCase() === outputId) ||
    (jobId !== null && cover.jobId.toLowerCase() === jobId);

  if (outputId !== null || jobId !== null) {
    for (const group of ctx.overview.projects) {
      if (group.covers.some(matchesCover)) {
        return isFinishedProjectGroup(group)
          ? undefined
          : findSelectableProjectId(group.project.id, moveTargets);
      }
    }
    if (ctx.initialProjectGroup?.covers.some(matchesCover)) {
      return isFinishedProjectGroup(ctx.initialProjectGroup)
        ? undefined
        : findSelectableProjectId(ctx.initialProjectGroup.project.id, moveTargets);
    }
    if (ctx.overview.unfiled.covers.some(matchesCover)) {
      return null;
    }
  }

  if (overviewHasFinishedFiles(ctx.overview)) {
    return undefined;
  }
  return reportedProjectId;
}

/**
 * Pure plan for deleting one generated result from the assets page (R-A Fix 1):
 * includes `withSavedCopy` and `deleteBoth` ONLY when an asset in loaded studio state pairs
 * with this result via both `output.savedAssetId === asset.id` and `asset.sourceOutputId === output.id`
 * (never when `savedAssetId` points at a deduplicated genuine upload or missing studio state).
 */
export function planResultDelete(
  output: Pick<StudioOutputView, "id" | "savedAssetId">,
  assets?: readonly Pick<StudioAssetView, "id" | "sourceOutputId">[] | null,
): {
  outputId: string;
  withSavedCopy: boolean;
  showDeleteBothLine: boolean;
} {
  const savedId = output.savedAssetId?.toLowerCase();
  const outputId = output.id.toLowerCase();
  const hasPairedCopy = Boolean(
    savedId &&
      assets?.some(
        (asset) =>
          asset.id.toLowerCase() === savedId &&
          typeof asset.sourceOutputId === "string" &&
          asset.sourceOutputId.toLowerCase() === outputId,
      ),
  );
  return {
    outputId: output.id,
    withSavedCopy: hasPairedCopy,
    showDeleteBothLine: hasPairedCopy,
  };
}

/** Customer-facing error sentence for a failed result delete (`conflict` maps to the existing busy message). */
export function resultDeleteErrorMessage(code: string | null | undefined, studioCopy: StudioCopy): string {
  return code === "conflict" ? studioCopy.viewer.deleteBusy : errorLine(studioCopy, code);
}

/**
 * Number of projects beyond the server's listed 100 (`totals[filter] - listed[filter]`, clamped >= 0; 0 when
 * `totals` or `listed` is absent). Shared by both the home project cards and the assets by-project view (R-B).
 */
export function unlistedProjectCount(
  data: { totals?: StudioBrandProjectTotals; listed?: StudioBrandProjectTotals } | null | undefined,
  filter: BrandProjectViewFilter,
): number {
  if (!data?.totals || !data?.listed) return 0;
  const total = filter === "all" ? data.totals.all : data.totals.active;
  const listed = filter === "all" ? data.listed.all : data.listed.active;
  return Number.isFinite(total) && Number.isFinite(listed) ? Math.max(0, Math.floor(total - listed)) : 0;
}

/** Address opening `/brand/library` in the by-project view (without `view=archive`). */
export function libraryByProjectHref(organizationId: string): string {
  return scopedHref("/brand/library", organizationId ? { id: organizationId } : null);
}

/** Address opening `/brand/library` directly in the full-project archive view (`?view=archive`). */
export function brandArchiveHref(organizationId: string): string {
  const base = scopedHref("/brand/library", organizationId ? { id: organizationId } : null);
  return `${base}${base.includes("?") ? "&" : "?"}view=archive`;
}

/** Converts a page-1 `project.files` `project` summary into a group header shape without a second overview call (R-B). */
export function projectGroupFromSummary(
  summary: StudioBrandProjectSummary,
  lastActivityAt = "",
): StudioBrandProjectGroup {
  return {
    project: {
      id: summary.id,
      title: summary.title,
      origin: summary.origin,
      lastActivityAt,
    },
    counts: summary.counts,
    covers: [],
    status: summary.status,
    selectable: summary.selectable,
  };
}
