"use client";
/**
 * Regrouped Brand Assets Hub container (`BrandAssetHub` when `spine` prop is passed, slice 2b).
 * Renders the 4-tab bar (프로젝트별 · 브랜드 자료 · 미분류 · 모든 파일), the 프로젝트별 overview (§5.3),
 * opened scopes via `ScopeView` (§5.4, §5.5), post-mutation refresh plan (§5.6), and `"보기"` switching inside
 * `모든 파일` (§5.7).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  BrandProjectFilesScope,
  StudioBrandProjectFiles,
  StudioBrandProjectOverview,
  StudioState,
} from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioApi } from "../api";
import type { HubDeliverable, HubEntry, HubSection } from "../asset-hub-model";
import s from "../asset-hub.module.css";
import type { StudioCopy, StudioLocale } from "../copy";
import { MoveToProjectDialog } from "../project-chip";
import { ByProjectView } from "./by-project-view";
import {
  IDLE_OVERVIEW_RELOAD,
  buildAllViewOptions,
  buildSpineTabs,
  initialSpineTab,
  planSpineRefresh,
  requestOverviewReload,
  scopeMarker,
  settleOverviewReload,
  singleEntryMoveInput,
  singleMoveReturnSelectors,
  type OverviewReloadState,
  type ScopeKindFilter,
  type ScopePageState,
  type ScopeRoleFilter,
  type SpineHubTab,
  type SpineMutationKind,
  type SpineOrgLogo,
} from "./model";
import { ScopeView, type ScopeTileSelectOpts } from "./scope-view";

export type { SpineOrgLogo };

const BRAND_MATERIALS_SCOPE: BrandProjectFilesScope = Object.freeze({ kind: "brand_materials" });
const UNFILED_SCOPE: BrandProjectFilesScope = Object.freeze({ kind: "unfiled" });

export interface SpineScopeSeed {
  page?: StudioBrandProjectFiles | null;
  state?: ScopePageState;
  kind?: ScopeKindFilter;
  role?: ScopeRoleFilter;
  selecting?: boolean;
  selectedKeys?: readonly string[];
}

export interface SingleMoveRequest {
  entry: HubEntry;
  projectId: string | null | undefined;
}

export interface AssetHubSpineProps {
  overview: StudioBrandProjectOverview;
  canMove: boolean;
  copy: Dictionary["projectSpine"];
  filmMeta: string;
  orgLogo?: SpineOrgLogo | null;
}

export interface AssetHubSpineViewProps {
  organizationId: string;
  locale?: StudioLocale;
  studioCopy: StudioCopy;
  libraryCopy: Dictionary["studioLibrary"];
  state: StudioState | null;
  loadFailed: boolean;
  notice: string | null;
  onRetryLoad(): void;
  onNotice(message: string | null): void;
  deliverables: readonly HubDeliverable[];
  canOpenStudio: boolean;
  api: StudioApi;
  likedKeys: ReadonlySet<string>;
  spine: AssetHubSpineProps;
  allSection?: ReactNode;
  renderAllSection?(viewControl: ReactNode): ReactNode;
  renderAllFilters?(viewControl: ReactNode): ReactNode;
  renderAllBody?(): ReactNode;
  allView?: HubSection;
  availableSections?: readonly HubSection[];
  onAllViewChange?(next: HubSection): void;
  mutationSignal?: { seq: number; kind: SpineMutationKind } | null;
  onReloadStudioState?(): void;
  emptyActions?: ReactNode;
  forceAllNonce?: number;
  filmHref?(filmId: string): string | null;
  renderScopeTile(entry: HubEntry, scopeKey: string, selectOpts?: ScopeTileSelectOpts): ReactNode;
  singleMove?: SingleMoveRequest | null;
  onCloseSingleMove?(): void;
  /** Optional initial state overrides for deterministic SSR tests (§6). */
  initialTab?: SpineHubTab;
  initialOpenedScope?: BrandProjectFilesScope | null;
  initialQuery?: string;
  initialScopeQuery?: string;
  initialScopeSeed?: SpineScopeSeed;
}

export function AssetHubSpine({
  organizationId,
  locale,
  studioCopy,
  libraryCopy,
  state,
  loadFailed,
  notice,
  onRetryLoad,
  onNotice,
  deliverables,
  canOpenStudio,
  api,
  likedKeys,
  spine,
  allSection = null,
  renderAllSection,
  renderAllFilters,
  renderAllBody,
  allView = "all",
  availableSections = ["all", "uploads", "generated", "folders", "liked"],
  onAllViewChange,
  mutationSignal = null,
  onReloadStudioState,
  emptyActions,
  forceAllNonce = 0,
  filmHref,
  renderScopeTile,
  singleMove = null,
  onCloseSingleMove,
  initialTab,
  initialOpenedScope = null,
  initialQuery = "",
  initialScopeQuery = "",
  initialScopeSeed,
}: AssetHubSpineViewProps) {
  const { overview: initialOverview, canMove, copy: projectSpineCopy, filmMeta, orgLogo = null } = spine;
  const h = libraryCopy.hub;
  const spineCopy = h.spine;
  const viewLocale: StudioLocale = locale ?? (libraryCopy.label === "Assets" ? "en" : "ko");
  const hasOrgLogo = Boolean(orgLogo);

  const [overview, setOverview] = useState(initialOverview);
  useEffect(() => {
    setOverview(initialOverview);
  }, [initialOverview]);

  const [activeTab, setActiveTab] = useState<SpineHubTab>(
    () => initialTab ?? initialSpineTab(initialOverview, hasOrgLogo),
  );
  const [openedScope, setOpenedScope] = useState<BrandProjectFilesScope | null>(initialOpenedScope);
  const [seedScopeId] = useState<string | null>(() => {
    if (initialOpenedScope) return scopeMarker(initialOpenedScope);
    if (initialTab === "brand_materials" || initialTab === "unfiled") return initialTab;
    return null;
  });
  const [query, setQuery] = useState(initialQuery);
  const [scopeQuery, setScopeQuery] = useState(initialScopeQuery);
  const [unfiledSelecting, setUnfiledSelecting] = useState(false);
  const [scopeRefreshNonce, setScopeRefreshNonce] = useState(0);

  const overviewReloadRef = useRef<OverviewReloadState>({ ...IDLE_OVERVIEW_RELOAD });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const lastMutationSeqRef = useRef(0);

  const hasOpenScope =
    Boolean(openedScope) || activeTab === "brand_materials" || activeTab === "unfiled";

  const kickOverviewRead = useCallback(() => {
    void api
      .loadBrandProjectOverview()
      .then((res) => {
        if (mountedRef.current && res.ok) setOverview(res);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!mountedRef.current) {
          overviewReloadRef.current = IDLE_OVERVIEW_RELOAD;
          return;
        }
        const { next, startRead } = settleOverviewReload(overviewReloadRef.current);
        overviewReloadRef.current = next;
        if (startRead) kickOverviewRead();
      });
  }, [api]);

  const reloadOverviewOnce = useCallback(() => {
    const { next, startRead } = requestOverviewReload(overviewReloadRef.current);
    overviewReloadRef.current = next;
    if (startRead) kickOverviewRead();
  }, [kickOverviewRead]);

  const runRefreshPlan = useCallback(
    (kind: SpineMutationKind) => {
      const plan = planSpineRefresh(kind, hasOpenScope);
      if (plan.reloadOverview) reloadOverviewOnce();
      if (plan.reloadStudioState) onReloadStudioState?.();
      if (plan.restartOpenScope) setScopeRefreshNonce((n) => n + 1);
    },
    [hasOpenScope, onReloadStudioState, reloadOverviewOnce],
  );

  useEffect(() => {
    if (!mutationSignal || mutationSignal.seq <= lastMutationSeqRef.current) return;
    lastMutationSeqRef.current = mutationSignal.seq;
    runRefreshPlan(mutationSignal.kind);
  }, [mutationSignal, runRefreshPlan]);

  useEffect(() => {
    if (forceAllNonce <= 0) return;
    setActiveTab("all");
    setOpenedScope(null);
    setUnfiledSelecting(false);
  }, [forceAllNonce]);

  const tabs = useMemo(
    () =>
      buildSpineTabs(
        overview,
        {
          byProject: spineCopy.tabByProject,
          brandMaterials: spineCopy.tabMaterials,
          unfiled: projectSpineCopy.unfiled,
          all: spineCopy.tabAll,
        },
        hasOrgLogo,
      ),
    [hasOrgLogo, overview, projectSpineCopy.unfiled, spineCopy.tabAll, spineCopy.tabByProject, spineCopy.tabMaterials],
  );

  const viewOptions = useMemo(
    () =>
      buildAllViewOptions(
        {
          all: spineCopy.viewAll,
          uploads: spineCopy.viewUploaded,
          generated: spineCopy.viewMade,
          liked: h.sections.liked,
          folders: h.sections.folders,
          deliverables: h.sections.deliverables,
        },
        availableSections,
      ),
    [
      availableSections,
      h.sections.deliverables,
      h.sections.folders,
      h.sections.liked,
      spineCopy.viewAll,
      spineCopy.viewMade,
      spineCopy.viewUploaded,
    ],
  );

  const handleScopeGone = useCallback(
    (message: string) => {
      onNotice(message);
      setOpenedScope(null);
      setActiveTab("by_project");
      setScopeQuery("");
      reloadOverviewOnce();
    },
    [onNotice, reloadOverviewOnce],
  );

  const handleMoved = useCallback(
    (_projectId: string | null, toast: string) => {
      onNotice(toast);
      setUnfiledSelecting(false);
      runRefreshPlan("move");
    },
    [onNotice, runRefreshPlan],
  );

  const openProjectScope = (projectId: string) => {
    onNotice(null);
    setActiveTab("by_project");
    setOpenedScope({ kind: "project", brandProjectId: projectId });
    setScopeQuery("");
    setUnfiledSelecting(false);
  };

  const selectTab = (tabId: SpineHubTab) => {
    onNotice(null);
    setActiveTab(tabId);
    setOpenedScope(null);
    setScopeQuery("");
    setUnfiledSelecting(false);
  };

  const openedProjectDeliverables =
    openedScope?.kind === "project"
      ? deliverables.filter((d) => d.projectId === openedScope.brandProjectId).length
      : 0;

  const viewControl = (
    <span className={s.selectWrap} data-active={allView !== "all" ? "" : undefined}>
      <select
        className={s.select}
        aria-label={spineCopy.viewLabel}
        value={allView}
        onChange={(e) => onAllViewChange?.(e.target.value as HubSection)}
        data-asset-hub-view={allView}
      >
        {viewOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </span>
  );

  const seedPropsFor = (scope: BrandProjectFilesScope): SpineScopeSeed | undefined =>
    initialScopeSeed && seedScopeId === scopeMarker(scope) ? initialScopeSeed : undefined;

  const projectSeed = openedScope?.kind === "project" ? seedPropsFor(openedScope) : undefined;
  const materialsSeed = seedPropsFor(BRAND_MATERIALS_SCOPE);
  const unfiledSeed = seedPropsFor(UNFILED_SCOPE);
  const projectList = useMemo(() => overview.projects.map((g) => g.project), [overview.projects]);
  const singleMoveInput =
    canMove && singleMove
      ? singleEntryMoveInput(singleMove.entry, singleMove.projectId, activeTab === "brand_materials")
      : null;

  return (
    <>
      <section className={s.toolbar} aria-label={h.sectionsLabel}>
        <div className={s.segTrack} role="tablist" aria-label={h.sectionsLabel}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={s.segBtn}
              aria-selected={activeTab === tab.id}
              data-asset-hub-tab={tab.id}
              onClick={() => selectTab(tab.id)}
            >
              <span>{tab.label}</span>
              {typeof tab.count === "number" && tab.count > 0 && <span className={s.segNum}>{tab.count}</span>}
            </button>
          ))}
        </div>

        {activeTab === "by_project" && !openedScope ? (
          <div className={s.filters}>
            <div className={s.searchWrap}>
              <input
                type="search"
                className={s.searchInput}
                aria-label={h.searchLabel}
                placeholder={h.searchLabel}
                title={h.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-asset-hub-search
              />
              {query && (
                <button
                  type="button"
                  className={s.searchClear}
                  aria-label={h.clearSearch}
                  onClick={() => setQuery("")}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ) : activeTab === "all" && renderAllFilters ? (
          renderAllFilters(viewControl)
        ) : null}
      </section>

      {activeTab !== "all" && notice && (
        <p className={s.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {activeTab !== "all" && loadFailed && (
        <div className={s.empty} role="alert">
          <p>{libraryCopy.loadFailed}</p>
          <button type="button" className={s.ghostBtn} onClick={onRetryLoad}>
            {libraryCopy.retry}
          </button>
        </div>
      )}

      {activeTab === "by_project" ? (
        openedScope?.kind === "project" ? (
          <ScopeView
            key={`project:${openedScope.brandProjectId}`}
            organizationId={organizationId}
            locale={viewLocale}
            scope={openedScope}
            overview={overview}
            libraryCopy={libraryCopy}
            projectSpineCopy={projectSpineCopy}
            studioCopy={studioCopy}
            filmMeta={filmMeta}
            canOpenStudio={canOpenStudio}
            canMove={canMove}
            api={api}
            query={scopeQuery}
            onQueryChange={setScopeQuery}
            likedKeys={likedKeys}
            deliverableCount={openedProjectDeliverables}
            deliverables={deliverables}
            refreshNonce={scopeRefreshNonce}
            onBack={() => {
              setOpenedScope(null);
              setScopeQuery("");
            }}
            onScopeGone={handleScopeGone}
            onMoved={handleMoved}
            filmHref={filmHref}
            renderTile={renderScopeTile}
            initialPage={projectSeed?.page}
            initialState={projectSeed?.state}
            initialKind={projectSeed?.kind}
            initialRole={projectSeed?.role}
            initialSelecting={projectSeed?.selecting}
            initialSelectedKeys={projectSeed?.selectedKeys}
          />
        ) : (
          <ByProjectView
            overview={overview}
            libraryCopy={libraryCopy}
            projectSpineCopy={projectSpineCopy}
            state={state}
            deliverables={deliverables}
            canMove={canMove}
            orgLogo={orgLogo}
            query={query}
            emptyActions={emptyActions}
            onOpenMaterials={() => selectTab("brand_materials")}
            onOpenProject={openProjectScope}
            onOpenUnfiled={() => selectTab("unfiled")}
            onMoveUnfiled={() => {
              onNotice(null);
              setActiveTab("unfiled");
              setOpenedScope(null);
              setScopeQuery("");
              setUnfiledSelecting(true);
            }}
          />
        )
      ) : activeTab === "brand_materials" ? (
        <ScopeView
          key="brand_materials"
          organizationId={organizationId}
          locale={viewLocale}
          scope={BRAND_MATERIALS_SCOPE}
          overview={overview}
          libraryCopy={libraryCopy}
          projectSpineCopy={projectSpineCopy}
          studioCopy={studioCopy}
          filmMeta={filmMeta}
          canOpenStudio={canOpenStudio}
          canMove={canMove}
          orgLogo={orgLogo}
          api={api}
          query={scopeQuery}
          onQueryChange={setScopeQuery}
          likedKeys={likedKeys}
          refreshNonce={scopeRefreshNonce}
          onScopeGone={handleScopeGone}
          onMoved={handleMoved}
          filmHref={filmHref}
          renderTile={renderScopeTile}
          initialPage={materialsSeed?.page}
          initialState={materialsSeed?.state}
          initialKind={materialsSeed?.kind}
          initialRole={materialsSeed?.role}
          initialSelecting={materialsSeed?.selecting}
          initialSelectedKeys={materialsSeed?.selectedKeys}
        />
      ) : activeTab === "unfiled" ? (
        <ScopeView
          key="unfiled"
          organizationId={organizationId}
          locale={viewLocale}
          scope={UNFILED_SCOPE}
          overview={overview}
          libraryCopy={libraryCopy}
          projectSpineCopy={projectSpineCopy}
          studioCopy={studioCopy}
          filmMeta={filmMeta}
          canOpenStudio={canOpenStudio}
          canMove={canMove}
          api={api}
          query={scopeQuery}
          onQueryChange={setScopeQuery}
          likedKeys={likedKeys}
          unfiledSelecting={unfiledSelecting}
          refreshNonce={scopeRefreshNonce}
          onScopeGone={handleScopeGone}
          onMoved={handleMoved}
          onStopSelecting={() => setUnfiledSelecting(false)}
          filmHref={filmHref}
          renderTile={renderScopeTile}
          initialPage={unfiledSeed?.page}
          initialState={unfiledSeed?.state}
          initialKind={unfiledSeed?.kind}
          initialRole={unfiledSeed?.role}
          initialSelecting={unfiledSeed?.selecting}
          initialSelectedKeys={unfiledSeed?.selectedKeys}
        />
      ) : renderAllBody ? (
        renderAllBody()
      ) : renderAllSection ? (
        renderAllSection(viewControl)
      ) : (
        allSection
      )}

      {canMove && singleMove && singleMoveInput && (
        <MoveToProjectDialog
          projects={projectList}
          currentScope={singleMoveInput.currentScope}
          jobIds={singleMoveInput.jobIds}
          assetIds={singleMoveInput.assetIds}
          filmIds={[]}
          locale={viewLocale}
          copy={projectSpineCopy}
          onMove={api.moveToBrandProject}
          onMoved={(res) => {
            onCloseSingleMove?.();
            handleMoved(res.projectId, res.toast);
          }}
          onClose={() => onCloseSingleMove?.()}
          returnFocus={() => {
            if (typeof document === "undefined") return null;
            const selectors = singleMoveReturnSelectors(singleMove.entry.key);
            const menuBtn = document.querySelector<HTMLElement>(selectors.menu);
            if (menuBtn && menuBtn.getClientRects().length > 0) return menuBtn;
            return document.querySelector<HTMLElement>(selectors.open);
          }}
        />
      )}
    </>
  );
}
