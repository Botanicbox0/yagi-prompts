"use client";
/**
 * Unified Brand Assets Hub (`/brand/library` when Studio v2 is open, 묶음 B — docs/BRAND-STUDIO-CLEANUP-B.md).
 *
 * One `에셋` (`Assets`) workspace for uploads, studio results, shared folders, likes and campaign deliverables.
 * The picture is the tile (2026-11-16, docs/design/TASTE.md): no file names and no button rows under it.
 * Hover or keyboard focus shows one main action and a "more" menu; a press opens the sheet with everything,
 * which is also how touch screens reach every action. Search covers names, tags, roles and prompts.
 *
 * When some of the work belongs to a project the page opens by project: the brand's standing material,
 * then one row of covers per project (made in the studio, or done with the YAGI team), then everything that
 * is in no project as the usual grid. The grouping is derived server-side from existing links
 * (lib/brand-studio/asset-projects.ts) and placed by `groupByProject`; "전체" stays one tab away.
 */
import "./rail/rail.css";
import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { SendTransport } from "@/components/brand-rooms/chat/transport";
import { SendPageScope } from "@/components/brand-send/file-send";
import type { SendLocale, ViewerSendProp } from "@/components/brand-send/model";
import { WorkspaceBell } from "@/components/brand-workspace/bell";
import {
  STUDIO_ASSET_ROLES,
  type BrandProjectFilesScope,
  type StudioAssetKind,
  type StudioAssetRole,
  type StudioAssetView,
  type StudioState,
} from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { createStudioApi, isFailure, uploadProblem, type StudioApi } from "./api";
import {
  buildHubEntries,
  entryMatchesAsset,
  familySize,
  filterHubEntries,
  filterProjectView,
  findHubEntryJob,
  groupByProject,
  groupCount,
  hubActions,
  resolveHubEntry,
  type HubAction,
  type HubActionCopy,
  type HubDeliverable,
  type HubEntry,
  type HubProjectGroup,
  type HubProjectLinks,
  type HubSection,
} from "./asset-hub-model";
import { AssetHubSpine, type AssetHubSpineProps, type SingleMoveRequest, type SpineScopeSeed } from "./asset-hub-spine";
import type { SpineHubTab, SpineMutationKind } from "./asset-hub-spine/model";
import type { ScopeTileSelectOpts } from "./asset-hub-spine/scope-view";
import { ProjectPickDialog } from "./asset-hub-project";
import { HubDetail, HubLinkTile, HubTile } from "./asset-hub-tile";
import { listedJobs } from "./store";
import s from "./asset-hub.module.css";
import { errorLine, studioUploadErrorLine, type StudioCopy } from "./copy";
import { AssetDialog } from "./rail/asset-dialog";
import { FoldersTab } from "./rail/folders-tab";
import { RailIcon } from "./rail/icons";
import { hasExtras, isTempFolder } from "./rail/library-store";
import type { MenuItem, RailKit, ThumbAction } from "./rail/parts";
import { fill, itemName, writeError } from "./rail/text";
import { useStudioLibrary } from "./rail/use-library";
import type { LibraryItemView, StudioFolderView, StudioLibrary } from "./seams";
import { ShareReviewDialog, useShareReviewEvent, type ShareReviewTarget } from "./share-review-dialog";
import { imageScreenRefHref } from "./studio-app";
import { StorageMeterCard, storageIsQuiet } from "./storage-meter";
import { useStudio } from "./use-studio";

export { buildHubEntries, filterHubEntries, filterProjectView, groupByProject, hubActions, humanTitle, similarityScore } from "./asset-hub-model";
export type { AssetHubSpineProps };
export type { HubAction, HubDeliverable, HubEntry, HubProjectGroup, HubProjectLinks, HubProjectView, HubSection } from "./asset-hub-model";

/** Link target for a project group in the asset hub (`?film=` while brand project spine is open, `?project=` otherwise). */
export function assetHubProjectHref(
  organizationId: string,
  group: Pick<HubProjectGroup, "id" | "origin">,
  canOpenStudio: boolean,
  useFilmParam = false,
): string | null {
  if (group.origin === "team") return `/brand/projects/${group.id}`;
  if (!canOpenStudio) return null;
  const param = useFilmParam ? "film" : "project";
  return `/brand/studio/video?organizationId=${encodeURIComponent(organizationId)}&${param}=${encodeURIComponent(group.id)}`;
}

const KINDS = ["all", "image", "video", "audio"] as const;
/** A project's cover row shows at most this many pictures (fewer on narrow screens, by CSS). */
const COVERS = 6;

export interface BrandAssetHubSpineInitial extends SpineScopeSeed {
  tab?: SpineHubTab;
  openedScope?: BrandProjectFilesScope | null;
  query?: string;
  scopeQuery?: string;
  menuKey?: string;
  detailKey?: string;
}

export interface BrandAssetHubProps {
  organizationId: string;
  studioCopy: StudioCopy;
  libraryCopy: Dictionary["studioLibrary"];
  initialState?: StudioState | null;
  deliverableCount?: number;
  deliverablesNode?: ReactNode;
  /** Which files belong to which project (ids only, server-derived). Null or empty: no by-project view. */
  projectLinks?: HubProjectLinks | null;
  /** Campaign deliverables, for their project's group. They stay links into the project's review. */
  deliverables?: readonly HubDeliverable[];
  /** False for project-only clients (`self_studio` denied) so dead links to `/brand/studio` are hidden. */
  canOpenStudio?: boolean;
  /** Brand project spine open: video studio film links use `?film=` instead of `?project=` (§4.5). */
  useFilmParam?: boolean;
  /** Regrouped assets view (slice 2b); omitted when the spine is closed or overview failed. */
  spine?: AssetHubSpineProps;
  /** Optional initial `모든 파일` view override for deterministic SSR tests (§6). */
  initialAllView?: HubSection;
  /** Optional initial spine tab / opened scope / tile state for deterministic SSR tests (§6). */
  initialSpine?: BrandAssetHubSpineInitial;
  /** Optional test injection so server/unit tests render without network calls. */
  injectedLibrary?: StudioLibrary;
  api?: StudioApi;
  /** Server-gated 보내기 prop (omitted/null when closed, staff, or project guest). */
  send?: (ViewerSendProp & { locale?: SendLocale; transport?: SendTransport }) | null;
}

export function BrandAssetHub({
  organizationId,
  studioCopy,
  libraryCopy,
  initialState = null,
  deliverableCount = 0,
  deliverablesNode = null,
  projectLinks = null,
  deliverables,
  canOpenStudio = true,
  useFilmParam = false,
  spine,
  initialAllView,
  initialSpine,
  injectedLibrary,
  api,
  send = null,
}: BrandAssetHubProps) {
  const spineOn = Boolean(spine);
  const loadStateReqSeqRef = useRef(0);
  const settledLoadStateRef = useRef<{ seq: number; state: StudioState } | null>(null);
  const deletedAssetIdsRef = useRef<Map<string, number>>(new Map());
  const rawStudioApi = useMemo(() => api ?? createStudioApi({ organizationId }), [api, organizationId]);
  const studioApi = useMemo<StudioApi>(() => {
    if (!spineOn) return rawStudioApi;
    return {
      ...rawStudioApi,
      loadState: async (options) => {
        const reqSeq = ++loadStateReqSeqRef.current;
        const result = await rawStudioApi.loadState(options);
        if (isFailure(result)) return result;
        const settled = settledLoadStateRef.current;
        // Guard against an older in-flight state load (e.g. from move) overwriting a newer settled reload (e.g. delete's refreshSilently).
        if (settled && reqSeq < settled.seq) {
          return settled.state;
        }
        let fresh = result;
        if (deletedAssetIdsRef.current.size > 0) {
          const filteredAssets = result.assets.filter((asset) => {
            const deletedAtSeq = deletedAssetIdsRef.current.get(asset.id);
            if (deletedAtSeq === undefined) return true;
            if (reqSeq <= deletedAtSeq) return false;
            deletedAssetIdsRef.current.delete(asset.id);
            return true;
          });
          if (filteredAssets.length !== result.assets.length) {
            fresh = { ...result, assets: filteredAssets };
          }
          for (const [id, deletedAtSeq] of deletedAssetIdsRef.current) {
            if (reqSeq > deletedAtSeq) deletedAssetIdsRef.current.delete(id);
          }
        }
        settledLoadStateRef.current = { seq: reqSeq, state: fresh };
        return fresh;
      },
      call: async (operation, input) => {
        const res = await rawStudioApi.call(operation, input);
        if (operation === "asset.delete" && !isFailure(res)) {
          const assetId = (input as { assetId?: unknown }).assetId;
          if (typeof assetId === "string" && assetId) {
            deletedAssetIdsRef.current.set(assetId, loadStateReqSeqRef.current);
          }
        }
        return res;
      },
    };
  }, [rawStudioApi, spineOn]);
  const studio = useStudio({ organizationId, initialState, api: studioApi });
  const liveLibrary = useStudioLibrary(organizationId);
  const library = injectedLibrary ?? liveLibrary;
  const state = studio.store.state;
  const assets = useMemo(() => state?.assets ?? [], [state?.assets]);
  const jobs = useMemo(() => listedJobs(state?.jobs ?? []), [state?.jobs]);
  const canCreate = state?.canCreate ?? false;
  const uploadBlocked = Boolean(state?.storage?.uploadBlocked);
  const hubLocale: "ko" | "en" = libraryCopy.label === "Assets" ? "en" : "ko";
  const h = libraryCopy.hub;

  // Null until a tab is chosen: the page then opens by project when there is a project to show, else on everything.
  const [section, setSection] = useState<HubSection | null>(() => (spine && initialAllView ? initialAllView : null));
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | StudioAssetKind>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | StudioAssetRole>("all");
  const [similarEntry, setSimilarEntry] = useState<HubEntry | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [tileMenu, setTileMenu] = useState<string | null>(() => (spine && initialSpine?.menuKey) ? initialSpine.menuKey : null);
  const [detailEntry, setDetailEntry] = useState<HubEntry | null>(() => {
    if (!spine || !initialSpine?.detailKey) return null;
    const pool = [
      ...buildHubEntries(assets, jobs, h.sourceGenerated),
      ...(initialSpine.page ? buildHubEntries(initialSpine.page.assets, initialSpine.page.jobs, h.sourceGenerated) : []),
      ...(initialSpine.state ? buildHubEntries(initialSpine.state.assets, initialSpine.state.jobs, h.sourceGenerated) : []),
    ];
    return pool.find((e) => e.key === initialSpine.detailKey) ?? null;
  });
  const [detailScopeKey, setDetailScopeKey] = useState<string | undefined>(() => {
    if (!spine || !initialSpine?.detailKey) return undefined;
    if (initialSpine.openedScope?.kind === "project") return `project:${initialSpine.openedScope.brandProjectId}`;
    return initialSpine.tab;
  });
  const [singleMove, setSingleMove] = useState<SingleMoveRequest | null>(null);
  const [forceAllNonce, setForceAllNonce] = useState(0);
  const [mutationSignal, setMutationSignal] = useState<{ seq: number; kind: SpineMutationKind } | null>(null);
  const [editing, setEditing] = useState<StudioAssetView | null>(null);
  const [picking, setPicking] = useState<HubEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareReviewTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useShareReviewEvent(organizationId, setShareTarget);

  const entries = useMemo(() => buildHubEntries(assets, jobs, h.sourceGenerated), [assets, jobs, h.sourceGenerated]);
  const similarAnchor = useMemo(
    () => resolveHubEntry(entries, similarEntry?.key ?? null, similarEntry, spineOn),
    [entries, similarEntry, spineOn],
  );
  const detail = useMemo(
    () => resolveHubEntry(entries, detailEntry?.key ?? null, detailEntry, spineOn),
    [detailEntry, entries, spineOn],
  );

  // Present only while runs can belong to a project (`BRAND_STUDIO_PROJECTS` and migration 0091).
  const studioProjects = state?.projects;
  const canAssign = Boolean(studioProjects) && canCreate && canOpenStudio;
  // The page was rendered with the projects of that moment; one made since (or one with nothing on its
  // timeline) still gets a group as soon as a run is put in it.
  const links = useMemo<HubProjectLinks | null>(() => {
    if (!studioProjects) return projectLinks;
    const known = new Set((projectLinks?.self ?? []).map((link) => link.id));
    const added = studioProjects.filter((project) => !known.has(project.id)).map((project) => ({ id: project.id, title: project.title, updatedAt: "", assetIds: [], outputIds: [] }));
    return { self: [...(projectLinks?.self ?? []), ...added], team: projectLinks?.team ?? [] };
  }, [projectLinks, studioProjects]);
  const projectView = useMemo(() => groupByProject(entries, links, deliverables), [deliverables, entries, links]);
  const hasProjects = projectView.groups.length > 0;
  const active: HubSection = spine
    ? section === null || section === "projects"
      ? "all"
      : section
    : section === null || (section === "projects" && !hasProjects)
      ? hasProjects
        ? "projects"
        : "all"
      : section;

  // Studio results carry no role, so the role filter (and its control) does not apply on that tab.
  const activeRole = active === "generated" ? "all" : roleFilter;
  const filtered = useMemo(
    () =>
      filterHubEntries(entries, {
        section: active,
        liked: library.liked,
        query,
        kind: kindFilter,
        role: activeRole,
        similarTo: similarAnchor,
      }),
    [active, activeRole, entries, kindFilter, library.liked, query, similarAnchor],
  );
  const shownView = useMemo(
    () => filterProjectView(projectView, { liked: library.liked, query, kind: kindFilter, role: activeRole }),
    [activeRole, kindFilter, library.liked, projectView, query],
  );
  const opened = active === "projects" && openGroup ? projectView.groups.find((group) => group.key === openGroup) ?? null : null;
  const openedShown: HubProjectGroup | null = opened ? shownView.groups.find((group) => group.key === opened.key) ?? { ...opened, entries: [], deliverables: [] } : null;

  const totalCount = entries.length + deliverableCount;
  const generatedCount = useMemo(() => entries.filter((e) => e.origin === "generated").length, [entries]);

  const actionCopy: HubActionCopy = useMemo(
    () => ({
      useImage: h.openInImage,
      decorate: studioCopy.gallery.menu.decorate,
      makeVideo: h.openInVideo,
      compose: h.openInCompose,
      reverse: h.reverseVideo,
      share: h.shareReview,
      similar: h.findSimilar,
      edit: libraryCopy.uploads.edit,
    }),
    [h, libraryCopy.uploads.edit, studioCopy.gallery.menu.decorate],
  );
  /** What a person would call the item, else its kind ("이미지", "영상"). Never the stored file name. */
  const nameOf = (entry: HubEntry) => entry.label ?? libraryCopy.item[entry.kind];
  const movesWith = (entry: HubEntry) => (entry.jobId ? familySize(jobs, entry.jobId) : 1);
  const actionsOf = (entry: HubEntry, externalLinkLabel?: string) =>
    hubActions(entry, {
      organizationId,
      canOpenStudio,
      canCreate,
      copy: actionCopy,
      ...(externalLinkLabel ? { externalLinkLabel } : {}),
      // Under spine, projectMove replaces the legacy job-only project picker on both runs and library entries.
      projectLabel: spine
        ? null
        : canAssign
          ? (item) => (movesWith(item) > 1 ? fill(libraryCopy.projects.assignMany, { n: movesWith(item) }) : libraryCopy.projects.assign)
          : null,
      moveProjectLabel: spine?.canMove ? spine.copy.move : null,
    });

  const projectIdForScope = (entry: HubEntry, scopeKey?: string): string | null | undefined => {
    if (scopeKey?.startsWith("project:")) return scopeKey.slice("project:".length);
    if (scopeKey === "brand_materials" || scopeKey === "unfiled") return null;
    if (entry.asset && "brandProjectId" in entry.asset) return entry.asset.brandProjectId;
    if (entry.jobId) {
      const matched = jobs.find((j) => j.id === entry.jobId);
      if (matched && "brandProjectId" in matched) return matched.brandProjectId;
    }
    return undefined;
  };

  const triggerSpineMutation = useCallback(
    (kind: SpineMutationKind) => {
      if (!spine) return;
      setMutationSignal((cur) => ({ seq: (cur?.seq ?? 0) + 1, kind }));
    },
    [spine],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      setNotice(null);
      if (uploadBlocked) {
        const reason = state?.storage?.uploadApproved === false ? "unapproved_quota" : undefined;
        setNotice(studioUploadErrorLine(studioCopy, "storage_quota_exceeded", reason));
        return;
      }
      let uploadedCount = 0;
      for (const file of files) {
        const problem = uploadProblem(file);
        if (problem) {
          setNotice(studioUploadErrorLine(studioCopy, problem));
          continue;
        }
        const res = await studio.upload(file);
        if (isFailure(res)) setNotice(studioUploadErrorLine(studioCopy, res.code, res.reason));
        else uploadedCount += 1;
      }
      if (uploadedCount > 0) triggerSpineMutation("upload");
    },
    [state?.storage?.uploadApproved, studio, studioCopy, triggerSpineMutation, uploadBlocked],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropActive(false);
    if (!canCreate || !event.dataTransfer.files.length) return;
    event.preventDefault();
    void handleFiles(Array.from(event.dataTransfer.files));
  };

  /** The actions that change something on this page (the ones with an address are plain links). */
  const runAction = (entry: HubEntry, action: HubAction, scopeKey?: string) => {
    setTileMenu(null);
    setDetailEntry(null);
    setDetailScopeKey(undefined);
    if (action.key === "similar") {
      // Related items are ranked across everything, so the by-project or scoped view hands over to the full grid.
      if (spine) {
        setSection("all");
        setForceAllNonce((n) => n + 1);
      } else if (active === "projects") {
        setSection("all");
      }
      setSimilarEntry((cur) => (cur?.key === entry.key ? null : entry));
    } else if (action.key === "edit" && entry.asset) {
      setEditing(entry.asset);
    } else if (action.key === "projectMove" && spine) {
      setSingleMove({ entry, projectId: projectIdForScope(entry, scopeKey) });
    } else if (action.key === "project" && entry.jobId) {
      setPicking(entry);
    } else if (action.key === "share") {
      setShareTarget({
        organizationId,
        assetId: "assetId" in entry.source ? entry.source.assetId : null,
        outputId: "outputId" in entry.source ? entry.source.outputId : null,
        title: nameOf(entry),
      });
    }
  };

  const folderKit: RailKit = {
    copy: libraryCopy,
    canCreate,
    attachOnPress: false,
    onAttach: (source) => {
      if (canOpenStudio) window.location.assign(imageScreenRefHref(organizationId, source));
    },
    onView: (source) => {
      if (canOpenStudio) window.location.assign(imageScreenRefHref(organizationId, source));
    },
    menu: folderMenu,
    setMenu: setFolderMenu,
    say: (msg) => setNotice(msg || null),
    likeAction(item: LibraryItemView): ThumbAction {
      const liked = library.liked.has(item.key);
      const name = itemName(item, libraryCopy);
      return {
        key: "like",
        label: fill(libraryCopy.item.like, { name }),
        title: fill(liked ? libraryCopy.item.unlike : libraryCopy.item.like, { name }),
        icon: "heart",
        pressed: liked,
        run: () => void library.toggleLike(item.ref),
      };
    },
    fileItems(item: LibraryItemView): MenuItem[] {
      if (!canCreate) return [];
      const folders = library.folders.filter((f: StudioFolderView) => !isTempFolder(f.id));
      return folders.map((f) => ({
        key: `file:${f.id}`,
        label: f.name,
        run: () =>
          void library.addToFolder(f.id, item.ref).then((done) => {
            setNotice(done ? fill(libraryCopy.folders.filed, { name: f.name }) : writeError(libraryCopy, hasExtras(library) ? library.lastError : null, "add"));
          }),
      }));
    },
  };

  const sections: Array<{ id: HubSection; label: string; count?: number }> = [
    ...(hasProjects ? [{ id: "projects" as const, label: h.sections.projects, count: projectView.groups.length }] : []),
    { id: "all", label: h.sections.all, count: entries.length },
    { id: "uploads", label: h.sections.uploads, count: assets.length },
    { id: "generated", label: h.sections.generated, count: generatedCount },
    { id: "folders", label: h.sections.folders, count: library.folders.length },
    { id: "liked", label: h.sections.liked, count: library.liked.size },
    ...(deliverableCount > 0 ? [{ id: "deliverables" as const, label: h.sections.deliverables, count: deliverableCount }] : []),
  ];

  const studioHref = `/brand/studio?organizationId=${encodeURIComponent(organizationId)}`;
  const gridSection = active !== "folders" && active !== "deliverables";
  const filtering = Boolean(query) || kindFilter !== "all" || activeRole !== "all";
  // One quiet line in the head while there is room; the full card (with its notice) once there is something to act on.
  const storage = state?.storage ?? null;
  const storageQuiet = storage ? storageIsQuiet(storage) : false;
  const loadFailed = studio.store.phase === "failed" && !state;
  const uploading = studio.uploads.length > 0;
  const pickFiles = () => fileInputRef.current?.click();
  const emptyCanUpload = canCreate && active !== "generated" && active !== "liked";

  const countLine = (n: number) => (n === 1 ? h.projects.one : fill(libraryCopy.folders.count, { n }));
  const originLine = (group: HubProjectGroup) => `${group.origin === "team" ? h.projects.team : h.projects.self} · ${countLine(groupCount(group))}`;
  const projectHref = (group: HubProjectGroup): string | null =>
    assetHubProjectHref(organizationId, group, canOpenStudio, useFilmParam);
  /** `scope` keeps one open menu when the same file is drawn in two places (two projects, or a project and the strip). */
  const tile = (entry: HubEntry, scope: string, compact = false, opts?: { soundMarker?: boolean; select?: ScopeTileSelectOpts }) => {
    const name = nameOf(entry);
    const { main, more } = actionsOf(entry, send?.copy.externalLink);
    const menuKey = `${scope}|${entry.key}`;
    return (
      <HubTile
        key={entry.key}
        entry={entry}
        copy={libraryCopy}
        name={name}
        liked={library.liked.has(entry.key)}
        main={main}
        more={more}
        moreLabel={fill(libraryCopy.uploads.more, { name })}
        compact={compact}
        soundMarker={opts?.soundMarker}
        selecting={opts?.select?.selecting}
        selected={opts?.select?.selected}
        onToggleSelect={opts?.select?.onToggleSelect}
        menuOpen={tileMenu === menuKey}
        onMenu={(open) => setTileMenu(open ? menuKey : null)}
        onOpen={() => {
          setTileMenu(null);
          setDetailEntry(entry);
          setDetailScopeKey(scope);
        }}
        onLike={() => void library.toggleLike(entry.source)}
        onAction={(action) => runAction(entry, action, scope)}
      />
    );
  };
  const linkTile = (item: HubDeliverable, compact = false) => (
    <HubLinkTile key={`c:${item.id}`} item={item} href={`/brand/projects/${item.projectId}#review`} copy={libraryCopy} compact={compact} />
  );
  const noMatch = (
    <section className={s.empty} data-asset-hub-empty={active}>
      <p>{libraryCopy.uploads.noMatch}</p>
    </section>
  );

  const emptyActionsFor = (allowUpload: boolean) =>
    canOpenStudio || allowUpload ? (
      <div className={s.emptyActions}>
        {allowUpload && (
          <button type="button" className={s.ghostBtn} disabled={uploading || uploadBlocked} onClick={pickFiles} data-asset-hub-empty-upload>
            {h.uploadAction}
          </button>
        )}
        {canOpenStudio && (
          <a className={s.ghostBtn} href={studioHref}>
            {h.openStudio}
          </a>
        )}
      </div>
    ) : null;

  // One filter + body fragment shared between today's page and the spine's `모든 파일` tab so filters, search,
  // similar chip, empty states and grid behavior can never drift between the two paths (Fix 0-2, Fix 2-7).
  const renderAllFilters = (viewControl: ReactNode) =>
    spine || gridSection ? (
      <div className={s.filters}>
        {viewControl}
        {gridSection && (
          <>
            <span className={s.selectWrap} data-active={kindFilter !== "all" ? "" : undefined}>
              <select
                className={s.select}
                aria-label={h.kindLabel}
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as "all" | StudioAssetKind)}
                data-asset-hub-kind={kindFilter}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {h.kinds[k]}
                  </option>
                ))}
              </select>
            </span>
            {active !== "generated" && (
              <span className={s.selectWrap} data-active={roleFilter !== "all" ? "" : undefined}>
                <select
                  className={s.select}
                  aria-label={libraryCopy.uploads.roleFilter}
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as "all" | StudioAssetRole)}
                  data-asset-hub-role={roleFilter}
                >
                  <option value="all">{h.roleAll}</option>
                  {STUDIO_ASSET_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {libraryCopy.roles[role]}
                    </option>
                  ))}
                </select>
              </span>
            )}
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
                <button type="button" className={s.searchClear} aria-label={h.clearSearch} onClick={() => setQuery("")}>
                  ×
                </button>
              )}
            </div>
          </>
        )}
      </div>
    ) : null;

  const renderAllBody = () => (
    <>

      {similarAnchor && gridSection && (
        <div className={s.similarBar} data-asset-hub-similar-active={similarAnchor.key}>
          {(similarAnchor.thumbUrl || similarAnchor.kind === "image") && <img className={s.similarThumb} src={similarAnchor.thumbUrl ?? similarAnchor.url} alt="" />}
          <span className={s.similarText}>{fill(h.similarChip, { name: nameOf(similarAnchor) })}</span>
          <button type="button" className={s.quietBtn} onClick={() => setSimilarEntry(null)}>
            {h.clearSimilar}
          </button>
        </div>
      )}

      {notice && (
        <p className={s.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {loadFailed && (
        <div className={s.empty} role="alert">
          <p>{libraryCopy.loadFailed}</p>
          <button type="button" className={s.ghostBtn} onClick={() => void studio.load()}>
            {libraryCopy.retry}
          </button>
        </div>
      )}

      {active === "deliverables" ? (
        <section data-asset-hub-deliverables>{deliverablesNode}</section>
      ) : active === "folders" ? (
        <section className={s.foldersWrap} data-asset-hub-folders>
          <FoldersTab kit={folderKit} library={library} openId={openFolderId} onOpen={setOpenFolderId} creating={creatingFolder} onCreating={setCreatingFolder} />
        </section>
      ) : loadFailed ? null : active === "projects" ? (
        openedShown ? (
          <section className={s.group} data-asset-hub-project={openedShown.key} data-origin={openedShown.origin} data-asset-hub-project-open>
            <div className={s.groupBar}>
              <button type="button" className={s.quietBtn} onClick={() => setOpenGroup(null)} data-asset-hub-project-back>
                <RailIcon name="back" />
                {h.sections.projects}
              </button>
              <h2 className={s.groupTitle}>{openedShown.title}</h2>
              <span className={s.groupMeta}>{originLine(openedShown)}</span>
              {projectHref(openedShown) && (
                <a className={s.groupLink} href={projectHref(openedShown)!} data-asset-hub-project-link>
                  {h.projects.open}
                </a>
              )}
            </div>
            {groupCount(openedShown) === 0 ? (
              noMatch
            ) : (
              <ul className={s.grid} data-asset-hub-grid>
                {openedShown.entries.map((entry) => tile(entry, openedShown.key))}
                {openedShown.deliverables.map((item) => linkTile(item))}
              </ul>
            )}
          </section>
        ) : shownView.standing.length + shownView.groups.length + shownView.loose.length === 0 ? (
          noMatch
        ) : (
          <div className={s.groups} data-asset-hub-projects>
            {shownView.standing.length > 0 && (
              <section className={s.group} data-asset-hub-standing>
                <div className={s.groupHead}>
                  <h2 className={s.groupTitle}>{h.projects.standing}</h2>
                  <span className={s.groupMeta}>{countLine(shownView.standing.length)}</span>
                </div>
                <ul className={s.strip}>{shownView.standing.map((entry) => tile(entry, "standing", true))}</ul>
              </section>
            )}
            {shownView.groups.map((group) => {
              const covers = group.entries.slice(0, COVERS);
              const rest = group.deliverables.slice(0, COVERS - covers.length);
              return (
                <section key={group.key} className={s.group} data-asset-hub-project={group.key} data-origin={group.origin}>
                  <div className={s.groupHead}>
                    <h2 className={s.groupTitle}>
                      <button type="button" className={s.groupOpen} onClick={() => setOpenGroup(group.key)} data-asset-hub-project-see-all>
                        {group.title}
                      </button>
                    </h2>
                    <span className={s.groupMeta}>{originLine(group)}</span>
                    <span className={s.groupMore} aria-hidden="true">
                      {h.projects.seeAll}
                      <RailIcon name="collapse" />
                    </span>
                  </div>
                  <ul className={s.covers}>
                    {covers.map((entry) => tile(entry, group.key, true))}
                    {rest.map((item) => linkTile(item, true))}
                  </ul>
                </section>
              );
            })}
            {shownView.loose.length > 0 && (
              <section className={s.group} data-asset-hub-loose>
                <div className={s.groupHead}>
                  <h2 className={s.groupTitle}>{h.projects.loose}</h2>
                  <span className={s.groupMeta}>{countLine(shownView.loose.length)}</span>
                </div>
                <ul className={s.grid} data-asset-hub-grid>
                  {shownView.loose.map((entry) => tile(entry, "loose"))}
                </ul>
              </section>
            )}
          </div>
        )
      ) : filtered.length === 0 ? (
        <section className={s.empty} data-asset-hub-empty={active}>
          <p>
            {similarAnchor
              ? h.emptySimilar
              : filtering
                ? libraryCopy.uploads.noMatch
                : active === "generated"
                  ? h.emptyGenerated
                  : active === "liked"
                    ? libraryCopy.liked.empty
                    : h.emptyAll}
          </p>
          {!filtering && !similarAnchor && emptyActionsFor(emptyCanUpload)}
        </section>
      ) : (
        <ul className={s.grid} data-asset-hub-grid>
          {filtered.map((entry) => tile(entry, "all"))}
        </ul>
      )}
    </>
  );

  const detailNode = detail ? (
    <HubDetail
      key={detail.key}
      entry={detail}
      copy={libraryCopy}
      name={nameOf(detail)}
      liked={library.liked.has(detail.key)}
      {...actionsOf(detail, send?.copy.externalLink)}
      onLike={() => void library.toggleLike(detail.source)}
      onAction={(action) => runAction(detail, action, detailScopeKey)}
      onClose={() => {
        setDetailEntry(null);
        setDetailScopeKey(undefined);
      }}
      {...(send
        ? {
            send,
            sendJob: findHubEntryJob(detail, state?.jobs, initialSpine?.page?.jobs, initialSpine?.state?.jobs),
          }
        : {})}
    />
  ) : null;

  return (
    <div
      className={`${s.hub} ${dropActive ? s.dropActive : ""}`}
      data-brand-library
      data-brand-asset-hub
      onDragOver={(e) => {
        if (canCreate && Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      <header className={s.head}>
        <div className={s.titleRow}>
          <h1 className={s.title}>{libraryCopy.label}</h1>
          {totalCount > 0 && (
            <span className={s.countChip} data-library-total>
              {totalCount}
            </span>
          )}
        </div>
        <div className={s.headSide}>
          {storage && storageQuiet && <StorageMeterCard storage={storage} copy={libraryCopy.storage} locale={hubLocale} compact />}
          <div className={s.headActions}>
            {canOpenStudio && (
              <a className={s.ghostBtn} href={studioHref} data-asset-hub-open-studio>
                {h.openStudio}
              </a>
            )}
            {canCreate && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav"
                  hidden
                  onChange={(e) => {
                    const picked = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = "";
                    if (picked.length) void handleFiles(picked);
                  }}
                />
                <button type="button" className={s.primaryBtn} disabled={uploading || uploadBlocked} onClick={pickFiles} data-asset-hub-upload>
                  {uploading ? fill(libraryCopy.uploads.uploading, { n: studio.uploads.length }) : h.uploadAction}
                </button>
              </>
            )}
            <WorkspaceBell />
          </div>
        </div>
      </header>

      {storage && !storageQuiet && <StorageMeterCard storage={storage} copy={libraryCopy.storage} locale={hubLocale} />}

      {spine ? (
        <AssetHubSpine
          organizationId={organizationId}
          locale={hubLocale}
          studioCopy={studioCopy}
          libraryCopy={libraryCopy}
          state={state}
          loadFailed={loadFailed}
          notice={notice}
          onRetryLoad={() => void studio.load()}
          onNotice={setNotice}
          deliverables={deliverables ?? []}
          canOpenStudio={canOpenStudio}
          api={studioApi}
          likedKeys={library.liked}
          spine={spine}
          renderAllFilters={renderAllFilters}
          renderAllBody={renderAllBody}
          allView={active}
          availableSections={sections.map((tab) => tab.id)}
          onAllViewChange={(next) => {
            setSection(next);
            setOpenGroup(null);
          }}
          mutationSignal={mutationSignal}
          onReloadStudioState={() => void studio.load()}
          emptyActions={emptyActionsFor(canCreate)}
          forceAllNonce={forceAllNonce}
          filmHref={(filmId) => assetHubProjectHref(organizationId, { id: filmId, origin: "self" }, canOpenStudio, true)}
          renderScopeTile={(entry, scopeKey, selectOpts) =>
            tile(entry, scopeKey, false, {
              soundMarker: entry.kind === "audio" && entry.origin === "generated",
              select: selectOpts,
            })
          }
          singleMove={singleMove}
          onCloseSingleMove={() => setSingleMove(null)}
          initialTab={initialSpine?.tab}
          initialOpenedScope={initialSpine?.openedScope}
          initialQuery={initialSpine?.query}
          initialScopeQuery={initialSpine?.scopeQuery}
          initialScopeSeed={initialSpine}
        />
      ) : (
        <>
          <section className={s.toolbar} aria-label={h.sectionsLabel}>
            <div className={s.segTrack} role="tablist" aria-label={h.sectionsLabel}>
              {sections.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className={s.segBtn}
                  aria-selected={active === tab.id}
                  data-asset-hub-tab={tab.id}
                  onClick={() => {
                    setSection(tab.id);
                    setOpenGroup(null);
                  }}
                >
                  <span>{tab.label}</span>
                  {typeof tab.count === "number" && tab.count > 0 && <span className={s.segNum}>{tab.count}</span>}
                </button>
              ))}
            </div>
            {renderAllFilters(null)}
          </section>
          {renderAllBody()}
        </>
      )}

      {send ? <SendPageScope>{detailNode}</SendPageScope> : detailNode}
      {editing && (
        <AssetDialog
          key={editing.id}
          asset={editing}
          copy={libraryCopy}
          onUpdate={async (assetId, patch) => {
            const res = await studio.updateAsset({ assetId, ...patch });
            if (!isFailure(res)) triggerSpineMutation("role");
            return res;
          }}
          onDelete={async (assetId) => {
            const res = await studio.deleteAsset(assetId);
            if (!isFailure(res)) {
              setDetailEntry((cur) => (entryMatchesAsset(cur, assetId) ? null : cur));
              setSimilarEntry((cur) => (entryMatchesAsset(cur, assetId) ? null : cur));
              triggerSpineMutation("delete");
            }
            return res;
          }}
          onClose={() => setEditing(null)}
          returnFocus={() => document.querySelector<HTMLElement>(`[data-asset-hub-card="a:${editing.id}"] [data-asset-hub-open]`)}
        />
      )}
      {picking && picking.jobId && studioProjects && (
        <ProjectPickDialog
          key={picking.key}
          copy={libraryCopy}
          projects={studioProjects}
          current={picking.projectId && studioProjects.some((project) => project.id === picking.projectId) ? picking.projectId : null}
          count={movesWith(picking)}
          onPick={async (target) => {
            const result = await studio.assignProject(picking.jobId!, target);
            if (isFailure(result)) return errorLine(studioCopy, result.code);
            const name = studioProjects.find((project) => project.id === target)?.title ?? "";
            setNotice(target ? fill(libraryCopy.projects.assigned, { name }) : libraryCopy.projects.removed);
            setPicking(null);
            return null;
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {shareTarget && <ShareReviewDialog target={shareTarget} locale={hubLocale} onClose={() => setShareTarget(null)} />}
    </div>
  );
}
