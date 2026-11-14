"use client";
/**
 * Unified Brand Assets Hub (`/brand/library` when Studio v2 is open, 묶음 B — docs/BRAND-STUDIO-CLEANUP-B.md).
 *
 * Replaces the split between the old campaign-only `/brand/library` ("보관함") and the studio's right-hand
 * library drawer with a single `에셋` (`Assets`) workspace:
 *   - All / Uploads / Generated / Folders / Liked (+ Campaign deliverables when present)
 *   - Instant search across asset names, tags, roles, and generation prompts
 *   - Media kind + role filters + 1-click "비슷한 항목" (role, shared tags, parent-output lineage, prompt overlap)
 *   - Drag-and-drop file upload, metadata editing, shared folder mosaic, and 1-click Studio launchers
 */
import "./rail/rail.css";
import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { STUDIO_ASSET_ROLES, STUDIO_LIMITS, type StudioAssetKind, type StudioAssetRole, type StudioAssetView, type StudioJobView, type StudioOutputView, type StudioState } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isFailure, uploadProblem, type StudioApi } from "./api";
import s from "./asset-hub.module.css";
import { errorLine, type StudioCopy } from "./copy";
import { FoldersTab } from "./rail/folders-tab";
import { hasExtras, isTempFolder } from "./rail/library-store";
import type { MenuItem, RailKit, ThumbAction } from "./rail/parts";
import { clock, fill, itemName, itemOfAsset, itemOfOutput, tagsFrom, writeError } from "./rail/text";
import { useStudioLibrary } from "./rail/use-library";
import type { RefSource } from "./refs";
import type { LibraryItemView, StudioFolderView, StudioLibrary } from "./seams";
import { ShareReviewDialog, useShareReviewEvent, type ShareReviewTarget } from "./share-review-dialog";
import { imageCanvasHref, imageScreenRefHref, videoComposeClipHref, videoScreenHref } from "./studio-app";
import { StorageMeterCard } from "./storage-meter";
import { useStudio } from "./use-studio";

export type HubSection = "all" | "uploads" | "generated" | "folders" | "liked" | "deliverables";

export interface HubEntry {
  key: string;
  source: RefSource;
  origin: "upload" | "generated";
  kind: StudioAssetKind;
  url: string;
  thumbUrl: string | null;
  title: string;
  role: StudioAssetRole | null;
  tags: readonly string[];
  prompt: string;
  seconds: number | null;
  createdAt: string;
  parentOutputId: string | null;
  jobId: string | null;
  asset: StudioAssetView | null;
  output: StudioOutputView | null;
}

const STOP_WORDS = new Set(["the", "and", "with", "for", "from", "into", "that", "this", "사진", "이미지", "영상", "장면", "있는", "위에", "으로"]);

function promptTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/** Builds unified entries from uploaded assets and ready generated studio outputs, newest first. */
export function buildHubEntries(assets: readonly StudioAssetView[], jobs: readonly StudioJobView[], fallbackGeneratedLabel: string): HubEntry[] {
  const entries: HubEntry[] = [];
  for (const asset of assets) {
    entries.push({
      key: `a:${asset.id}`,
      source: { assetId: asset.id },
      origin: "upload",
      kind: asset.kind,
      url: asset.url,
      thumbUrl: asset.thumbUrl,
      title: asset.name,
      role: asset.role,
      tags: asset.tags,
      prompt: "",
      seconds: asset.seconds,
      createdAt: asset.createdAt,
      parentOutputId: null,
      jobId: null,
      asset,
      output: null,
    });
  }
  for (const job of jobs) {
    for (const output of job.outputs) {
      entries.push({
        key: `o:${output.id}`,
        source: { outputId: output.id },
        origin: "generated",
        kind: output.kind,
        url: output.url,
        thumbUrl: output.thumbUrl,
        title: job.prompt.trim() || fallbackGeneratedLabel,
        role: null,
        tags: [],
        prompt: job.prompt,
        seconds: output.seconds,
        createdAt: output.createdAt,
        parentOutputId: job.parentOutputId,
        jobId: job.id,
        asset: null,
        output,
      });
    }
  }
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Scores relatedness (`> 0` means related) using role, shared tags, parent-output lineage, and prompt tokens. */
export function similarityScore(anchor: HubEntry, candidate: HubEntry): number {
  if (anchor.key === candidate.key) return 100;
  let score = 0;
  if (anchor.jobId && anchor.jobId === candidate.jobId) score += 8;
  if (anchor.output && candidate.parentOutputId === anchor.output.id) score += 10;
  if (candidate.output && anchor.parentOutputId === candidate.output.id) score += 10;
  if (anchor.parentOutputId && anchor.parentOutputId === candidate.parentOutputId) score += 6;
  if (anchor.role && anchor.role === candidate.role) score += 4;
  if (anchor.tags.length && candidate.tags.length) {
    const set = new Set(anchor.tags.map((t) => t.toLowerCase()));
    for (const tag of candidate.tags) if (set.has(tag.toLowerCase())) score += 5;
  }
  const anchorWords = new Set([...promptTokens(anchor.title), ...promptTokens(anchor.prompt), ...anchor.tags.map((t) => t.toLowerCase())]);
  if (anchorWords.size > 0) {
    const candWords = [...promptTokens(candidate.title), ...promptTokens(candidate.prompt), ...candidate.tags.map((t) => t.toLowerCase())];
    for (const word of candWords) if (anchorWords.has(word)) score += 2;
  }
  return score;
}

export function filterHubEntries(
  entries: readonly HubEntry[],
  opts: {
    section: HubSection;
    liked: ReadonlySet<string>;
    query: string;
    kind: "all" | StudioAssetKind;
    role: "all" | StudioAssetRole;
    similarTo: HubEntry | null;
  },
): HubEntry[] {
  const q = opts.query.trim().toLowerCase();
  const base = entries.filter((entry) => {
    if (opts.section === "uploads" && entry.origin !== "upload") return false;
    if (opts.section === "generated" && entry.origin !== "generated") return false;
    if (opts.section === "liked" && !opts.liked.has(entry.key)) return false;
    if (opts.kind !== "all" && entry.kind !== opts.kind) return false;
    if (opts.role !== "all" && entry.role !== opts.role) return false;
    if (q) {
      const hay = `${entry.title}\n${entry.prompt}\n${entry.role ?? ""}\n${entry.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!opts.similarTo) return base;
  return base
    .map((entry) => ({ entry, score: similarityScore(opts.similarTo!, entry) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entry);
}

export interface BrandAssetHubProps {
  organizationId: string;
  studioCopy: StudioCopy;
  libraryCopy: Dictionary["studioLibrary"];
  initialState?: StudioState | null;
  deliverableCount?: number;
  deliverablesNode?: ReactNode;
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
  canOpenStudio = true,
  injectedLibrary,
  api,
}: BrandAssetHubProps) {
  const studio = useStudio({ organizationId, initialState, api });
  const liveLibrary = useStudioLibrary(organizationId);
  const library = injectedLibrary ?? liveLibrary;
  const state = studio.store.state;
  const assets = useMemo(() => state?.assets ?? [], [state?.assets]);
  const jobs = useMemo(() => state?.jobs ?? [], [state?.jobs]);
  const canCreate = state?.canCreate ?? false;
  const uploadBlocked = Boolean(state?.storage?.uploadBlocked);
  const hubLocale: "ko" | "en" = libraryCopy.label === "Assets" ? "en" : "ko";
  const h = libraryCopy.hub;

  const [section, setSection] = useState<HubSection>("all");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | StudioAssetKind>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | StudioAssetRole>("all");
  const [similarKey, setSimilarKey] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<StudioAssetRole | "">("");
  const [editTags, setEditTags] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareReviewTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useShareReviewEvent(organizationId, setShareTarget);

  const entries = useMemo(() => buildHubEntries(assets, jobs, h.sourceGenerated), [assets, jobs, h.sourceGenerated]);
  const similarAnchor = useMemo(() => (similarKey ? entries.find((e) => e.key === similarKey) ?? null : null), [entries, similarKey]);

  const filtered = useMemo(
    () =>
      filterHubEntries(entries, {
        section,
        liked: library.liked,
        query,
        kind: kindFilter,
        role: roleFilter,
        similarTo: similarAnchor,
      }),
    [entries, kindFilter, library.liked, query, roleFilter, section, similarAnchor],
  );

  const totalCount = entries.length + deliverableCount;
  const generatedCount = useMemo(() => entries.filter((e) => e.origin === "generated").length, [entries]);

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

  const startEdit = (asset: StudioAssetView) => {
    setEditingId(asset.id);
    setEditName(asset.name);
    setEditRole(asset.role ?? "");
    setEditTags(asset.tags.join(", "));
  };

  const saveEdit = async (assetId: string) => {
    const res = await studio.updateAsset({
      assetId,
      name: editName.trim() || undefined,
      role: editRole === "" ? null : editRole,
      tags: tagsFrom(editTags),
    });
    if (isFailure(res)) setNotice(errorLine(studioCopy, res.code));
    else setEditingId(null);
  };

  const deleteAsset = async (assetId: string) => {
    const res = await studio.deleteAsset(assetId);
    if (isFailure(res)) setNotice(errorLine(studioCopy, res.code));
    else if (editingId === assetId) setEditingId(null);
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
    { id: "all", label: h.sections.all, count: entries.length },
    { id: "uploads", label: h.sections.uploads, count: assets.length },
    { id: "generated", label: h.sections.generated, count: generatedCount },
    { id: "folders", label: h.sections.folders, count: library.folders.length },
    { id: "liked", label: h.sections.liked, count: library.liked.size },
    ...(deliverableCount > 0 ? [{ id: "deliverables" as const, label: h.sections.deliverables, count: deliverableCount }] : []),
  ];

  const studioHref = `/brand/studio?organizationId=${encodeURIComponent(organizationId)}`;

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
        <div className={s.titleBlock}>
          <div className={s.titleRow}>
            <h1 className={s.title}>{libraryCopy.label}</h1>
            {totalCount > 0 && (
              <span className={s.countChip} data-library-total>
                {totalCount}
              </span>
            )}
          </div>
          <p className={s.subtitle}>{h.subtitle}</p>
        </div>
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
              <button
                type="button"
                className={s.primaryBtn}
                disabled={studio.uploads.length > 0 || uploadBlocked}
                onClick={() => fileInputRef.current?.click()}
                data-asset-hub-upload
              >
                {studio.uploads.length > 0 ? fill(libraryCopy.uploads.uploading, { n: studio.uploads.length }) : h.uploadAction}
              </button>
            </>
          )}
        </div>
      </header>

      {state?.storage && (
        <StorageMeterCard storage={state.storage} copy={libraryCopy.storage} locale={hubLocale} />
      )}

      <section className={s.toolbar} aria-label={h.sectionsLabel}>
        <div className={s.topBar}>
          <div className={s.segTrack} role="tablist" aria-label={h.sectionsLabel}>
            {sections.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className={s.segBtn}
                aria-selected={section === tab.id}
                data-asset-hub-tab={tab.id}
                onClick={() => setSection(tab.id)}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 && <span className={s.segNum}>{tab.count}</span>}
              </button>
            ))}
          </div>

          {section !== "folders" && section !== "deliverables" && (
            <div className={s.searchWrap}>
              <input
                type="search"
                className={s.searchInput}
                aria-label={h.searchLabel}
                placeholder={h.searchPlaceholder}
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
          )}
        </div>

        {section !== "folders" && section !== "deliverables" && (
          <div className={s.filterRow} role="group" aria-label={h.kindLabel}>
            {(["all", "image", "video", "audio"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={s.pill}
                aria-pressed={kindFilter === k}
                onClick={() => setKindFilter(k)}
                data-asset-hub-kind={k}
              >
                {h.kinds[k]}
              </button>
            ))}
            <span className={s.dividerDot} aria-hidden="true" />
            <button
              type="button"
              className={s.pill}
              aria-pressed={roleFilter === "all"}
              onClick={() => setRoleFilter("all")}
              data-asset-hub-role="all"
            >
              {libraryCopy.uploads.all}
            </button>
            {STUDIO_ASSET_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                className={s.pill}
                aria-pressed={roleFilter === role}
                onClick={() => setRoleFilter(role)}
                data-asset-hub-role={role}
              >
                {libraryCopy.roles[role]}
              </button>
            ))}
          </div>
        )}

        {similarAnchor && section !== "folders" && section !== "deliverables" && (
          <div className={s.similarBar} data-asset-hub-similar-active={similarAnchor.key}>
            <span>{fill(h.similarChip, { name: similarAnchor.title })}</span>
            <button type="button" className={s.miniAction} onClick={() => setSimilarKey(null)}>
              {h.clearSimilar}
            </button>
          </div>
        )}
      </section>

      {notice && (
        <p className={s.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {studio.store.phase === "failed" && !state && (
        <div className={s.empty} role="alert">
          <p>{libraryCopy.loadFailed}</p>
          <button type="button" className={s.ghostBtn} onClick={() => void studio.load()}>
            {libraryCopy.retry}
          </button>
        </div>
      )}

      {section === "deliverables" ? (
        <section data-asset-hub-deliverables>{deliverablesNode}</section>
      ) : section === "folders" ? (
        <section className={s.foldersWrap} data-asset-hub-folders>
          <FoldersTab
            kit={folderKit}
            library={library}
            openId={openFolderId}
            onOpen={setOpenFolderId}
            creating={creatingFolder}
            onCreating={setCreatingFolder}
          />
        </section>
      ) : studio.store.phase === "failed" && !state ? null : filtered.length === 0 ? (
        <section className={s.empty} data-asset-hub-empty={section}>
          <p>
            {similarAnchor
              ? h.emptySimilar
              : query || kindFilter !== "all" || roleFilter !== "all"
                ? libraryCopy.uploads.noMatch
                : section === "generated"
                  ? h.emptyGenerated
                  : section === "liked"
                    ? libraryCopy.liked.empty
                    : h.emptyAll}
          </p>
          {canOpenStudio && !query && kindFilter === "all" && roleFilter === "all" && !similarAnchor && (
            <a className={s.ghostBtn} href={studioHref}>
              {h.openStudio}
            </a>
          )}
        </section>
      ) : (
        <ul className={s.grid} data-asset-hub-grid>
          {filtered.map((entry) => {
            const liked = library.liked.has(entry.key);
            const isEditing = entry.asset && editingId === entry.asset.id;
            const itemView = entry.asset ? itemOfAsset(entry.asset) : itemOfOutput(entry.output!);
            const reverseHref =
              entry.asset && entry.kind === "video"
                ? `/brand/studio/video?organizationId=${encodeURIComponent(organizationId)}&start=reverse&asset=${encodeURIComponent(entry.asset.id)}`
                : null;
            return (
              <li key={entry.key} className={s.card} data-asset-hub-card={entry.key} data-origin={entry.origin}>
                <div className={s.mediaBox}>
                  {entry.kind === "image" ? (
                    <img src={entry.thumbUrl ?? entry.url} alt={entry.title} loading="lazy" />
                  ) : entry.kind === "video" ? (
                    entry.thumbUrl ? (
                      <img src={entry.thumbUrl} alt={entry.title} loading="lazy" />
                    ) : (
                      <video src={entry.url} muted playsInline preload="metadata" />
                    )
                  ) : (
                    <div className={s.audioStage}>{entry.title}</div>
                  )}
                  <div className={s.badges}>
                    <span className={s.chipDark}>
                      {entry.origin === "upload" ? h.sourceUpload : h.sourceGenerated}
                      {entry.seconds ? ` · ${clock(entry.seconds)}` : ""}
                    </span>
                    <button
                      type="button"
                      className={s.likeBtn}
                      aria-pressed={liked}
                      aria-label={fill(liked ? libraryCopy.item.unlike : libraryCopy.item.like, { name: itemName(itemView, libraryCopy) })}
                      onClick={() => void library.toggleLike(entry.source)}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M10 16.6s-6-3.9-6-8.4A3.4 3.4 0 0 1 10 6a3.4 3.4 0 0 1 6 2.2c0 4.5-6 8.4-6 8.4Z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className={s.meta}>
                  <div className={s.nameRow}>
                    <h2 className={s.itemTitle}>{entry.title}</h2>
                    {entry.role && <span className={s.roleTag}>{libraryCopy.roles[entry.role]}</span>}
                  </div>

                  {entry.tags.length > 0 && (
                    <div className={s.tagsRow}>
                      {entry.tags.map((tag) => (
                        <span key={tag} className={s.tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className={s.cardActions}>
                    {canOpenStudio && entry.kind === "image" && (
                      <>
                        <a className={s.miniAction} href={imageCanvasHref(organizationId, entry.source)} data-asset-hub-open-canvas>
                          {hubLocale === "en" ? "Canvas Editor" : "캔버스 편집"}
                        </a>
                        <a className={s.miniAction} href={imageScreenRefHref(organizationId, entry.source)} data-asset-hub-use-image>
                          {h.openInImage}
                        </a>
                        <a className={s.miniAction} href={videoScreenHref(organizationId, entry.source)} data-asset-hub-use-video>
                          {h.openInVideo}
                        </a>
                      </>
                    )}
                    {canOpenStudio && entry.kind === "video" && (
                      <a className={s.miniAction} href={videoComposeClipHref(organizationId, entry.source)} data-asset-hub-open-compose>
                        {hubLocale === "en" ? "To Editing Studio" : "편집 스튜디오로"}
                      </a>
                    )}
                    {canOpenStudio && reverseHref && (
                      <a className={s.miniAction} href={reverseHref} data-asset-hub-reverse>
                        {h.reverseVideo}
                      </a>
                    )}
                    {canOpenStudio && canCreate && (entry.kind === "image" || entry.kind === "video") && (
                      <button
                        type="button"
                        className={s.miniAction}
                        onClick={() =>
                          setShareTarget({
                            organizationId,
                            assetId: "assetId" in entry.source ? entry.source.assetId : null,
                            outputId: "outputId" in entry.source ? entry.source.outputId : null,
                            title: entry.title,
                          })
                        }
                        data-asset-hub-share-review
                      >
                        {hubLocale === "en" ? "Review & Share" : "검수 · 공유"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={s.miniAction}
                      onClick={() => setSimilarKey((cur) => (cur === entry.key ? null : entry.key))}
                      data-asset-hub-similar
                    >
                      {h.findSimilar}
                    </button>
                    {canCreate && entry.asset && (
                      <button
                        type="button"
                        className={s.miniAction}
                        onClick={() => (isEditing ? setEditingId(null) : startEdit(entry.asset!))}
                        data-asset-hub-edit
                      >
                        {isEditing ? libraryCopy.uploads.cancel : libraryCopy.uploads.edit}
                      </button>
                    )}
                  </div>

                  {canCreate && entry.asset && isEditing && (
                    <div className={s.editForm} data-asset-hub-edit-form>
                      <input
                        className={s.editInput}
                        aria-label={libraryCopy.uploads.name}
                        value={editName}
                        maxLength={120}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <select
                        className={s.editSelect}
                        aria-label={libraryCopy.uploads.role}
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as StudioAssetRole | "")}
                      >
                        <option value="">{libraryCopy.uploads.roleNone}</option>
                        {STUDIO_ASSET_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {libraryCopy.roles[r]}
                          </option>
                        ))}
                      </select>
                      <input
                        className={s.editInput}
                        aria-label={libraryCopy.uploads.tags}
                        placeholder={fill(libraryCopy.uploads.tagsHint, { n: STUDIO_LIMITS.tagsMax })}
                        value={editTags}
                        onChange={(e) => setEditTags(e.target.value)}
                      />
                      <div className={s.cardActions}>
                        <button type="button" className={s.miniAction} onClick={() => void saveEdit(entry.asset!.id)}>
                          {libraryCopy.uploads.save}
                        </button>
                        <button type="button" className={s.miniAction} onClick={() => void deleteAsset(entry.asset!.id)}>
                          {libraryCopy.uploads.delete}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {shareTarget && (
        <ShareReviewDialog
          target={shareTarget}
          locale={hubLocale}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
