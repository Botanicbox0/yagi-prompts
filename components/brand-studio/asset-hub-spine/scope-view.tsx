"use client";
/**
 * Opened-scope view for the regrouped assets page (`project:<id>`, `brand_materials`, `unfiled`; slice 2b §5.4, §5.5).
 * Pages through `project.files` (40 per page via `StudioApi.listBrandProjectFiles`), preserves loaded items on
 * retryable paging failures, renders sound outputs as `HubTile` with `data-asset-hub-sound`, renders `편집본`
 * links to the video studio (`?film=<id>`), supports `canMove` multi-select + `MoveToProjectDialog` (§5.5),
 * shows team deliverables on team project scopes, and closes missing projects cleanly back to `프로젝트별`.
 */
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  BrandProjectFilesScope,
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectOverview,
} from "@/lib/brand-studio/contracts";
import type { VideoProjectSummary } from "@/lib/brand-studio/video-projects/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioApi } from "../api";
import type { HubDeliverable, HubEntry } from "../asset-hub-model";
import { HubLinkTile } from "../asset-hub-tile";
import s from "../asset-hub.module.css";
import { errorLine, type StudioCopy, type StudioLocale } from "../copy";
import { MoveToProjectDialog } from "../project-chip";
import { RailIcon } from "../rail/icons";
import { fill } from "../rail/text";
import sp from "./asset-hub-spine.module.css";
import {
  brandMaterialsCountsWithLogo,
  buildKindChips,
  buildRoleChips,
  collectScopeMoveInput,
  filmTileAspectRatio,
  filterTeamDeliverables,
  formatGroupCounts,
  freezeScopeMoveSnapshot,
  initialScopePageState,
  mergeScopeTiles,
  scopeEmptyMessage,
  scopeMarker,
  scopePageReducer,
  shouldCloseScopeOnFailure,
  shouldReadScopeFirstPage,
  sumProjectCounts,
  toggleScopeSelection,
  type ScopeFirstPageCursor,
  type ScopeKindFilter,
  type ScopeMoveSnapshot,
  type ScopePageState,
  type ScopeRoleFilter,
  type SpineOrgLogo,
} from "./model";

const ZERO_COUNTS: StudioBrandProjectCounts = {
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
};

export interface ScopeTileSelectOpts {
  selecting: boolean;
  selected: boolean;
  onToggleSelect(): void;
}

export interface ScopeViewProps {
  organizationId: string;
  locale?: StudioLocale;
  scope: BrandProjectFilesScope;
  overview: StudioBrandProjectOverview;
  libraryCopy: Dictionary["studioLibrary"];
  projectSpineCopy: Dictionary["projectSpine"];
  studioCopy: StudioCopy;
  filmMeta: string;
  canOpenStudio: boolean;
  canMove: boolean;
  orgLogo?: SpineOrgLogo | null;
  api: StudioApi;
  query: string;
  onQueryChange(next: string): void;
  likedKeys: ReadonlySet<string>;
  deliverableCount?: number;
  deliverables?: readonly HubDeliverable[];
  unfiledSelecting?: boolean;
  refreshNonce?: number;
  onBack?(): void;
  onScopeGone(message: string): void;
  onMoved?(projectId: string | null, toast: string): void;
  onStopSelecting?(): void;
  filmHref?(filmId: string): string | null;
  renderTile(entry: HubEntry, scopeKey: string, selectOpts?: ScopeTileSelectOpts): ReactNode;
  /** Optional deterministic state overrides for SSR tests (§6). */
  initialPage?: StudioBrandProjectFiles | null;
  initialState?: ScopePageState;
  initialKind?: ScopeKindFilter;
  initialRole?: ScopeRoleFilter;
  initialSelecting?: boolean;
  initialSelectedKeys?: readonly string[];
}

function defaultFilmHref(organizationId: string, filmId: string, canOpenStudio: boolean): string | null {
  if (!canOpenStudio) return null;
  return `/brand/studio/video?organizationId=${encodeURIComponent(organizationId)}&film=${encodeURIComponent(filmId)}`;
}

function FilmTile({
  film,
  href,
  filmLabel,
  metaTemplate,
  selecting,
  selected,
  onToggleSelect,
}: {
  film: VideoProjectSummary;
  href: string | null;
  filmLabel: string;
  metaTemplate: string;
  selecting: boolean;
  selected: boolean;
  onToggleSelect(): void;
}) {
  const ratio = filmTileAspectRatio(film.aspect);
  const meta = fill(metaTemplate, {
    clips: film.clipCount,
    seconds: Math.max(0, Math.round(film.durationSec)),
  });

  const body = (
    <>
      {film.thumbUrl ? (
        <img src={film.thumbUrl} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <div className={sp.filmStage} aria-hidden="true">
          <RailIcon name="open" />
        </div>
      )}
      <span className={s.badge} data-asset-hub-film-badge="">
        {filmLabel}
      </span>
      <div className={`${s.foot} ${sp.filmFoot}`}>
        <span className={`${s.footTitle} ${sp.filmTitle}`}>{film.title}</span>
        <span className={`${s.footNote} ${sp.filmMeta}`}>{meta}</span>
      </div>
      {selecting && (
        <span className={s.selectMark} data-selected={selected ? "" : undefined} aria-hidden="true">
          {selected && (
            <svg viewBox="0 0 12 12" focusable="false">
              <path d="M2.4 6.2 4.9 8.7 9.6 3.5" />
            </svg>
          )}
        </span>
      )}
    </>
  );

  return (
    <li
      className={s.tile}
      style={{ "--r": ratio } as CSSProperties}
      data-asset-hub-film={film.id}
      data-kind="film"
      data-selected={selecting && selected ? "" : undefined}
    >
      {selecting ? (
        <button
          type="button"
          className={sp.filmLink}
          aria-label={`${film.title} · ${meta}`}
          aria-pressed={selected}
          onClick={onToggleSelect}
        >
          {body}
        </button>
      ) : href ? (
        <a className={sp.filmLink} href={href} aria-label={`${film.title} · ${meta}`}>
          {body}
        </a>
      ) : (
        <div className={sp.filmCard}>{body}</div>
      )}
    </li>
  );
}

export function ScopeView({
  organizationId,
  locale,
  scope,
  overview,
  libraryCopy,
  projectSpineCopy,
  studioCopy,
  filmMeta,
  canOpenStudio,
  canMove,
  orgLogo = null,
  api,
  query,
  onQueryChange,
  likedKeys,
  deliverableCount = 0,
  deliverables = [],
  unfiledSelecting = false,
  refreshNonce = 0,
  onBack,
  onScopeGone,
  onMoved,
  onStopSelecting,
  filmHref,
  renderTile,
  initialPage = null,
  initialState,
  initialKind = "all",
  initialRole = "all",
  initialSelecting = false,
  initialSelectedKeys,
}: ScopeViewProps) {
  const h = libraryCopy.hub;
  const spineCopy = h.spine;
  const viewLocale: StudioLocale = locale ?? (libraryCopy.label === "Assets" ? "en" : "ko");
  const scopeId = scopeMarker(scope);
  const isProject = scope.kind === "project";
  const isMaterials = scope.kind === "brand_materials";
  const limitHintId = useId();

  const [kindFilter, setKindFilter] = useState<ScopeKindFilter>(initialKind);
  const [roleFilter, setRoleFilter] = useState<ScopeRoleFilter>(initialRole);
  const [selecting, setSelecting] = useState(
    () => canMove && (initialSelecting || (scope.kind === "unfiled" && unfiledSelecting)),
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() =>
    canMove && initialSelectedKeys?.length ? new Set(initialSelectedKeys) : new Set(),
  );
  const [moveSnapshot, setMoveSnapshot] = useState<ScopeMoveSnapshot | null>(null);

  const [pageState, dispatch] = useReducer(
    scopePageReducer,
    undefined,
    () => initialState ?? initialScopePageState(initialPage),
  );

  const reqSeqRef = useRef(0);
  const goneSentForRef = useRef<string | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const scopeBrandProjectId = scope.kind === "project" ? scope.brandProjectId : "";
  const prevScopeIdRef = useRef(scopeId);
  const lastReadCursorRef = useRef<ScopeFirstPageCursor | null>(
    initialPage || initialState ? { scopeId, kind: initialKind, refreshNonce } : null,
  );

  // Reset per-scope chip filters when navigating to another scope.
  useEffect(() => {
    if (prevScopeIdRef.current === scopeId) return;
    prevScopeIdRef.current = scopeId;
    setKindFilter("all");
    setRoleFilter("all");
    setSelecting(canMove && scopeRef.current.kind === "unfiled" && unfiledSelecting);
    setSelectedKeys(new Set());
    setMoveSnapshot(null);
    goneSentForRef.current = null;
  }, [canMove, scopeId, unfiledSelecting]);

  useEffect(() => {
    if (!canMove) {
      setSelecting(false);
      setSelectedKeys(new Set());
      setMoveSnapshot(null);
    } else if (scopeRef.current.kind === "unfiled" && unfiledSelecting) {
      setSelecting(true);
    }
  }, [canMove, unfiledSelecting]);

  const fetchFirstPage = useCallback(
    (targetScope: BrandProjectFilesScope, targetKind: ScopeKindFilter) => {
      const seq = ++reqSeqRef.current;
      goneSentForRef.current = null;
      setSelectedKeys(new Set());
      dispatch({ type: "restart" });
      void api
        .listBrandProjectFiles({
          scope: targetScope,
          ...(targetKind !== "all" ? { kind: targetKind } : {}),
        })
        .then((res) => {
          if (seq !== reqSeqRef.current) return;
          if (!res.ok) {
            dispatch({ type: "failed", code: res.code });
            return;
          }
          dispatch({ type: "loaded", mode: "replace", page: res });
        })
        .catch(() => {
          if (seq !== reqSeqRef.current) return;
          dispatch({ type: "failed", code: "failed" });
        });
    },
    [api],
  );

  useEffect(() => {
    const nextCursor: ScopeFirstPageCursor = { scopeId, kind: kindFilter, refreshNonce };
    if (!shouldReadScopeFirstPage(lastReadCursorRef.current, nextCursor)) return;
    lastReadCursorRef.current = nextCursor;
    fetchFirstPage(scopeRef.current, kindFilter);
  }, [fetchFirstPage, kindFilter, refreshNonce, scopeId]);

  useEffect(() => {
    if (!shouldCloseScopeOnFailure(scopeRef.current, pageState.phase)) return;
    const marker = `${scopeId}|${kindFilter}`;
    if (goneSentForRef.current === marker) return;
    goneSentForRef.current = marker;
    onScopeGone(errorLine(studioCopy, "not_found"));
  }, [kindFilter, onScopeGone, pageState.phase, scopeId, studioCopy]);

  const loadMore = () => {
    if (pageState.phase === "loading" || pageState.phase === "loading_more" || pageState.next === null) return;
    const seq = ++reqSeqRef.current;
    const cursor = pageState.next;
    dispatch({ type: "start_more" });
    void api
      .listBrandProjectFiles({
        scope: scopeRef.current,
        ...(kindFilter !== "all" ? { kind: kindFilter } : {}),
        cursor,
      })
      .then((res) => {
        if (seq !== reqSeqRef.current) return;
        if (!res.ok) {
          dispatch({ type: "failed", code: res.code });
          return;
        }
        dispatch({ type: "loaded", mode: "append", page: res });
      })
      .catch(() => {
        if (seq !== reqSeqRef.current) return;
        dispatch({ type: "failed", code: "failed" });
      });
  };

  const retry = () => {
    if (pageState.items.length > 0 && pageState.next !== null) {
      loadMore();
      return;
    }
    dispatch({ type: "start_first" });
    fetchFirstPage(scopeRef.current, kindFilter);
  };

  const projectGroup = isProject ? overview.projects.find((g) => g.project.id === scopeBrandProjectId) ?? null : null;
  const countLabels = useMemo(
    () => ({
      image: h.kinds.image,
      video: h.kinds.video,
      sound: spineCopy.kindSound,
      upload: spineCopy.kindUploads,
      film: projectSpineCopy.film,
      deliverables: spineCopy.kindDeliverables,
    }),
    [h.kinds.image, h.kinds.video, projectSpineCopy.film, spineCopy.kindDeliverables, spineCopy.kindSound, spineCopy.kindUploads],
  );

  const kindChips = useMemo(() => {
    if (isMaterials) return [];
    const counts = isProject ? (projectGroup?.counts ?? ZERO_COUNTS) : overview.unfiled.counts;
    return buildKindChips(
      counts,
      {
        all: spineCopy.kindAll,
        image: h.kinds.image,
        video: h.kinds.video,
        sound: spineCopy.kindSound,
        upload: spineCopy.kindUploads,
        film: projectSpineCopy.film,
      },
      kindFilter,
    );
  }, [
    h.kinds.image,
    h.kinds.video,
    isMaterials,
    isProject,
    kindFilter,
    overview.unfiled.counts,
    projectGroup?.counts,
    projectSpineCopy.film,
    spineCopy.kindAll,
    spineCopy.kindSound,
    spineCopy.kindUploads,
  ]);

  const materialsCounts = useMemo(
    () => brandMaterialsCountsWithLogo(overview.brandMaterials, Boolean(orgLogo)),
    [orgLogo, overview.brandMaterials],
  );

  const roleChips = useMemo(() => {
    if (!isMaterials) return [];
    return buildRoleChips(materialsCounts.byRole, { all: h.roleAll, ...libraryCopy.roles }, roleFilter);
  }, [h.roleAll, isMaterials, libraryCopy.roles, materialsCounts.byRole, roleFilter]);

  const showOrgLogoTile = Boolean(
    isMaterials &&
      orgLogo &&
      (roleFilter === "all" || roleFilter === "logo") &&
      (!query.trim() || libraryCopy.roles.logo.toLowerCase().includes(query.trim().toLowerCase())),
  );

  const tiles = useMemo(
    () =>
      mergeScopeTiles(pageState, {
        sourceGeneratedLabel: h.sourceGenerated,
        liked: likedKeys,
        query,
        role: isMaterials ? roleFilter : "all",
      }),
    [h.sourceGenerated, isMaterials, likedKeys, pageState, query, roleFilter],
  );

  const teamDeliverables = useMemo(() => {
    if (!isProject || projectGroup?.project.origin !== "team" || kindFilter !== "all") return [];
    return filterTeamDeliverables(deliverables, scopeBrandProjectId, query);
  }, [deliverables, isProject, kindFilter, projectGroup?.project.origin, query, scopeBrandProjectId]);

  const moveSelection = useMemo(
    () => collectScopeMoveInput(tiles, selectedKeys),
    [selectedKeys, tiles],
  );

  const projectList = useMemo(() => overview.projects.map((g) => g.project), [overview.projects]);
  const currentDialogScope = useMemo(
    () =>
      scope.kind === "project"
        ? ({ kind: "project", id: scopeBrandProjectId } as const)
        : scope.kind === "brand_materials"
          ? ({ kind: "brand_materials" } as const)
          : ({ kind: "unfiled" } as const),
    [scope.kind, scopeBrandProjectId],
  );

  const leaveSelection = () => {
    setSelecting(false);
    setSelectedKeys(new Set());
    setMoveSnapshot(null);
    onStopSelecting?.();
  };

  const changeKindFilter = (next: ScopeKindFilter) => {
    if (next === kindFilter) return;
    setKindFilter(next);
    setSelectedKeys(new Set());
  };

  const changeRoleFilter = (next: ScopeRoleFilter) => {
    if (next === roleFilter) return;
    setRoleFilter(next);
    setSelectedKeys(new Set());
  };

  const toggleTileSelection = (key: string) => {
    setSelectedKeys((cur) => toggleScopeSelection(cur, key));
  };

  const renderEntry = (entry: HubEntry) => {
    const selected = selecting && selectedKeys.has(entry.key);
    const selectOpts: ScopeTileSelectOpts | undefined = canMove
      ? { selecting, selected, onToggleSelect: () => toggleTileSelection(entry.key) }
      : undefined;
    return renderTile(entry, scopeId, selectOpts);
  };

  const resolveFilmHref = (filmId: string) =>
    filmHref ? filmHref(filmId) : defaultFilmHref(organizationId, filmId, canOpenStudio);

  const headerTitle = isProject
    ? (projectGroup?.project.title ?? "")
    : isMaterials
      ? spineCopy.tabMaterials
      : projectSpineCopy.unfiled;

  const headerMeta = isProject
    ? (() => {
        const originLabel = projectGroup?.project.origin === "team" ? h.projects.team : h.projects.self;
        const summary = projectGroup
          ? formatGroupCounts(projectGroup.counts, projectGroup.project.origin, countLabels, deliverableCount)
          : "";
        return summary ? `${originLabel} · ${summary}` : originLabel;
      })()
    : isMaterials
      ? `${spineCopy.materialsDesc} · ${fill(spineCopy.count, { n: materialsCounts.count })}`
      : `${spineCopy.unfiledDesc} · ${fill(spineCopy.count, { n: sumProjectCounts(overview.unfiled.counts) })}`;

  const hasFilterOrSearch = Boolean(query.trim()) || kindFilter !== "all" || roleFilter !== "all";
  const hasVisibleTiles = tiles.length > 0 || teamDeliverables.length > 0 || showOrgLogoTile;
  const isInitialLoading = pageState.phase === "loading" && !hasVisibleTiles;
  const isErrorPhase =
    pageState.phase === "failed" ||
    (pageState.phase === "not_found" && !shouldCloseScopeOnFailure(scope, pageState.phase));
  const isInitialFailed = isErrorPhase && !hasVisibleTiles;
  const canToggleSelect = canMove && (tiles.length > 0 || selecting);

  return (
    <section
      className={sp.group}
      data-asset-hub-scope={scopeId}
      data-selecting={selecting ? "true" : undefined}
    >
      <div className={sp.placeholderHead}>
        {isProject && (
          <button
            type="button"
            className={`${s.quietBtn} ${sp.scopeBack}`}
            onClick={onBack}
            data-asset-hub-scope-back=""
          >
            <RailIcon name="back" />
            {spineCopy.tabByProject}
          </button>
        )}
        <h2 className={sp.groupTitle}>
          {isProject && projectGroup?.project.origin === "team" ? (
            <a className={sp.groupTitleLink} href={`/brand/projects/${projectGroup.project.id}`}>
              {headerTitle}
            </a>
          ) : (
            headerTitle
          )}
        </h2>
        <span className={sp.groupMeta}>{headerMeta}</span>
        {canToggleSelect && (
          <div className={sp.groupActions}>
            <button
              type="button"
              className={sp.textAction}
              onClick={() => {
                if (selecting) leaveSelection();
                else setSelecting(true);
              }}
              data-asset-hub-select=""
            >
              {selecting ? spineCopy.selectDone : spineCopy.selectStart}
            </button>
          </div>
        )}
      </div>

      {canMove && selecting && (
        <div className={s.selectBar} role="toolbar" aria-label={spineCopy.selectStart}>
          <p className={s.selectBarCount} data-asset-hub-selected-count="">
            {fill(spineCopy.selectedCount, { n: moveSelection.selectedCount })}
          </p>
          {moveSelection.overLimit && (
            <p className={s.selectBarHint} id={limitHintId} role="status">
              {projectSpineCopy.moveTooMany}
            </p>
          )}
          <div className={sp.groupActions}>
            <button
              type="button"
              className={s.ghostBtn}
              disabled={moveSelection.totalTargets === 0 || moveSelection.overLimit}
              title={moveSelection.overLimit ? projectSpineCopy.moveTooMany : undefined}
              aria-describedby={moveSelection.overLimit ? limitHintId : undefined}
              onClick={() => setMoveSnapshot(freezeScopeMoveSnapshot(moveSelection))}
              data-asset-hub-move=""
            >
              {projectSpineCopy.move}
            </button>
            <button type="button" className={s.quietBtn} onClick={leaveSelection}>
              {projectSpineCopy.cancel}
            </button>
          </div>
        </div>
      )}

      <div className={sp.scopeBar}>
        {kindChips.length > 0 ? (
          <div className={sp.chipBar} role="group" aria-label={h.kindLabel}>
            {kindChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={sp.chip}
                aria-pressed={kindFilter === chip.id}
                data-asset-hub-scope-kind={chip.id}
                onClick={() => changeKindFilter(chip.id)}
              >
                <span>{chip.label}</span>
                {chip.count > 0 && <span className={sp.chipNum}>{chip.count}</span>}
              </button>
            ))}
          </div>
        ) : roleChips.length > 0 ? (
          <div className={sp.chipBar} role="group" aria-label={libraryCopy.uploads.roleFilter}>
            {roleChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={sp.chip}
                aria-pressed={roleFilter === chip.id}
                data-asset-hub-scope-role={chip.id}
                onClick={() => changeRoleFilter(chip.id)}
              >
                <span>{chip.label}</span>
                {chip.count > 0 && <span className={sp.chipNum}>{chip.count}</span>}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}

        <div className={s.filters}>
          <div className={s.searchWrap}>
            <input
              type="search"
              className={s.searchInput}
              aria-label={h.searchLabel}
              placeholder={h.searchLabel}
              title={h.searchPlaceholder}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              data-asset-hub-search=""
            />
            {query && (
              <button
                type="button"
                className={s.searchClear}
                aria-label={h.clearSearch}
                onClick={() => onQueryChange("")}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {isInitialLoading ? (
        <div className={sp.scopeLoading} aria-busy="true" />
      ) : isInitialFailed ? (
        <div className={s.empty} role="alert" data-asset-hub-scope-error="">
          <p>{spineCopy.loadFailed}</p>
          <button type="button" className={s.ghostBtn} onClick={retry}>
            {spineCopy.retry}
          </button>
        </div>
      ) : !hasVisibleTiles ? (
        <section className={s.empty} data-asset-hub-empty={scopeId}>
          <p>{scopeEmptyMessage(scope, spineCopy, hasFilterOrSearch, libraryCopy.uploads.noMatch)}</p>
        </section>
      ) : (
        <ul className={s.grid} data-asset-hub-grid="">
          {showOrgLogoTile && orgLogo && (
            <li className={s.tile} style={{ "--r": 1 } as CSSProperties} data-asset-hub-org-logo="">
              {orgLogo.editHref ? (
                <a
                  className={sp.orgLogoCard}
                  href={orgLogo.editHref}
                  aria-label={`${libraryCopy.roles.logo} · ${libraryCopy.uploads.edit}`}
                >
                  <img src={orgLogo.url} alt="" loading="lazy" decoding="async" draggable={false} />
                </a>
              ) : (
                <div className={sp.orgLogoCard}>
                  <img src={orgLogo.url} alt="" loading="lazy" decoding="async" draggable={false} />
                </div>
              )}
            </li>
          )}
          {tiles.map((item) =>
            item.kind === "entry" ? (
              renderEntry(item.entry)
            ) : (
              <FilmTile
                key={item.key}
                film={item.film}
                href={resolveFilmHref(item.film.id)}
                filmLabel={projectSpineCopy.film}
                metaTemplate={filmMeta}
                selecting={Boolean(canMove && selecting)}
                selected={selecting && selectedKeys.has(item.key)}
                onToggleSelect={() => toggleTileSelection(item.key)}
              />
            ),
          )}
          {teamDeliverables.map((item) => (
            <HubLinkTile
              key={`c:${item.id}`}
              item={item}
              href={`/brand/projects/${item.projectId}#review`}
              copy={libraryCopy}
            />
          ))}
        </ul>
      )}

      {isErrorPhase && hasVisibleTiles && (
        <div className={sp.scopeError} role="alert" data-asset-hub-scope-error="">
          <p>{spineCopy.loadFailed}</p>
          <button type="button" className={s.ghostBtn} onClick={retry}>
            {spineCopy.retry}
          </button>
        </div>
      )}

      {pageState.next !== null && !isErrorPhase && !isInitialLoading && (
        <div className={sp.pagerRow}>
          <button
            type="button"
            className={s.ghostBtn}
            disabled={pageState.phase === "loading_more"}
            aria-busy={pageState.phase === "loading_more" || undefined}
            onClick={loadMore}
            data-asset-hub-more=""
          >
            {spineCopy.loadMore}
          </button>
        </div>
      )}

      {canMove && moveSnapshot && (
        <MoveToProjectDialog
          projects={projectList}
          currentScope={currentDialogScope}
          jobIds={moveSnapshot.jobIds}
          assetIds={moveSnapshot.assetIds}
          filmIds={moveSnapshot.filmIds}
          locale={viewLocale}
          copy={projectSpineCopy}
          onMove={api.moveToBrandProject}
          onMoved={(res) => {
            leaveSelection();
            onMoved?.(res.projectId, res.toast);
          }}
          onClose={() => setMoveSnapshot(null)}
        />
      )}
    </section>
  );
}
