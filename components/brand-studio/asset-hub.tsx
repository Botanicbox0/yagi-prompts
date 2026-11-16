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
import { STUDIO_ASSET_ROLES, type StudioAssetKind, type StudioAssetRole, type StudioAssetView, type StudioState } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isFailure, uploadProblem, type StudioApi } from "./api";
import {
  buildHubEntries,
  familySize,
  filterHubEntries,
  filterProjectView,
  groupByProject,
  groupCount,
  hubActions,
  type HubAction,
  type HubActionCopy,
  type HubDeliverable,
  type HubEntry,
  type HubProjectGroup,
  type HubProjectLinks,
  type HubSection,
} from "./asset-hub-model";
import { ProjectPickDialog } from "./asset-hub-project";
import { HubDetail, HubLinkTile, HubTile } from "./asset-hub-tile";
import { listedJobs } from "./store";
import s from "./asset-hub.module.css";
import { errorLine, type StudioCopy } from "./copy";
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
export type { HubAction, HubDeliverable, HubEntry, HubProjectGroup, HubProjectLinks, HubProjectView, HubSection } from "./asset-hub-model";

const KINDS = ["all", "image", "video", "audio"] as const;
/** A project's cover row shows at most this many pictures (fewer on narrow screens, by CSS). */
const COVERS = 6;

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
  /** Optional test injection so server/unit tests render without network calls. */
  injectedLibrary?: StudioLibrary;
  api?: StudioApi;
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
  injectedLibrary,
  api,
}: BrandAssetHubProps) {
  const studio = useStudio({ organizationId, initialState, api });
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
  const [section, setSection] = useState<HubSection | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | StudioAssetKind>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | StudioAssetRole>("all");
  const [similarKey, setSimilarKey] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [tileMenu, setTileMenu] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<StudioAssetView | null>(null);
  const [picking, setPicking] = useState<HubEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareReviewTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useShareReviewEvent(organizationId, setShareTarget);

  const entries = useMemo(() => buildHubEntries(assets, jobs, h.sourceGenerated), [assets, jobs, h.sourceGenerated]);
  const similarAnchor = useMemo(() => (similarKey ? entries.find((e) => e.key === similarKey) ?? null : null), [entries, similarKey]);
  const detail = useMemo(() => (detailKey ? entries.find((e) => e.key === detailKey) ?? null : null), [entries, detailKey]);

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
  const active: HubSection = section === null || (section === "projects" && !hasProjects) ? (hasProjects ? "projects" : "all") : section;

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
  const actionsOf = (entry: HubEntry) =>
    hubActions(entry, {
      organizationId,
      canOpenStudio,
      canCreate,
      copy: actionCopy,
      // A run that holds several results says so in the menu: they move together.
      projectLabel: canAssign ? (item) => (movesWith(item) > 1 ? fill(libraryCopy.projects.assignMany, { n: movesWith(item) }) : libraryCopy.projects.assign) : null,
    });

  const handleFiles = useCallback(
    async (files: File[]) => {
      setNotice(null);
      if (uploadBlocked) {
        setNotice(errorLine(studioCopy, "storage_quota_exceeded"));
        return;
      }
      for (const file of files) {
        const problem = uploadProblem(file);
        if (problem) {
          setNotice(errorLine(studioCopy, problem));
          continue;
        }
        const res = await studio.upload(file);
        if (isFailure(res)) setNotice(errorLine(studioCopy, res.code));
      }
    },
    [studio, studioCopy, uploadBlocked],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropActive(false);
    if (!canCreate || !event.dataTransfer.files.length) return;
    event.preventDefault();
    void handleFiles(Array.from(event.dataTransfer.files));
  };

  /** The actions that change something on this page (the ones with an address are plain links). */
  const runAction = (entry: HubEntry, action: HubAction) => {
    setTileMenu(null);
    setDetailKey(null);
    if (action.key === "similar") {
      // Related items are ranked across everything, so the by-project view hands over to the full grid.
      if (active === "projects") setSection("all");
      setSimilarKey((cur) => (cur === entry.key ? null : entry.key));
    } else if (action.key === "edit" && entry.asset) {
      setEditing(entry.asset);
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
    group.origin === "team"
      ? `/brand/projects/${group.id}`
      : canOpenStudio
        ? `/brand/studio/video?organizationId=${encodeURIComponent(organizationId)}&project=${encodeURIComponent(group.id)}`
        : null;
  /** `scope` keeps one open menu when the same file is drawn in two places (two projects, or a project and the strip). */
  const tile = (entry: HubEntry, scope: string, compact = false) => {
    const name = nameOf(entry);
    const { main, more } = actionsOf(entry);
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
        menuOpen={tileMenu === menuKey}
        onMenu={(open) => setTileMenu(open ? menuKey : null)}
        onOpen={() => {
          setTileMenu(null);
          setDetailKey(entry.key);
        }}
        onLike={() => void library.toggleLike(entry.source)}
        onAction={(action) => runAction(entry, action)}
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
          </div>
        </div>
      </header>

      {storage && !storageQuiet && <StorageMeterCard storage={storage} copy={libraryCopy.storage} locale={hubLocale} />}

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

        {gridSection && (
          <div className={s.filters}>
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
          </div>
        )}
      </section>

      {similarAnchor && gridSection && (
        <div className={s.similarBar} data-asset-hub-similar-active={similarAnchor.key}>
          {(similarAnchor.thumbUrl || similarAnchor.kind === "image") && <img className={s.similarThumb} src={similarAnchor.thumbUrl ?? similarAnchor.url} alt="" />}
          <span className={s.similarText}>{fill(h.similarChip, { name: nameOf(similarAnchor) })}</span>
          <button type="button" className={s.quietBtn} onClick={() => setSimilarKey(null)}>
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
          {!filtering && !similarAnchor && (canOpenStudio || emptyCanUpload) && (
            <div className={s.emptyActions}>
              {emptyCanUpload && (
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
          )}
        </section>
      ) : (
        <ul className={s.grid} data-asset-hub-grid>
          {filtered.map((entry) => tile(entry, "all"))}
        </ul>
      )}

      {detail && (
        <HubDetail
          key={detail.key}
          entry={detail}
          copy={libraryCopy}
          name={nameOf(detail)}
          liked={library.liked.has(detail.key)}
          {...actionsOf(detail)}
          onLike={() => void library.toggleLike(detail.source)}
          onAction={(action) => runAction(detail, action)}
          onClose={() => setDetailKey(null)}
        />
      )}
      {editing && (
        <AssetDialog
          key={editing.id}
          asset={editing}
          copy={libraryCopy}
          onUpdate={(assetId, patch) => studio.updateAsset({ assetId, ...patch })}
          onDelete={(assetId) => studio.deleteAsset(assetId)}
          onClose={() => setEditing(null)}
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
