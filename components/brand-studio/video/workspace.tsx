"use client";
/**
 * Unified `영상 스튜디오` Workspace (Studio Pro Suite v5, docs/STUDIO-PRO-SUITE-V4.md):
 *  - Zero-friction lazy project model (`brand_studio_video_projects` auto-created on first prompt submit
 *    or first clip added to the Sequence Rail, URL synced to `?project=<id>`).
 *  - Project bar (`[data-video-project-bar]`) with `내 프로젝트` switcher, inline rename, `프로젝트 완료`
 *    (shot-sheet cache cleanup), `클립 생성` (`72px`) ↔ `컷 편집` (`55vh`) `0ms` preset snap,
 *    `검수 · 공유`, `Premiere · DaVinci (.xml)` (BGM included by default), and `MP4 내보내기`.
 *  - 3-Height Elastic Sequence Rail (`72px` / `200px` / `55vh`) + Take Stacks (`1/N`) + Floating Clip Bar.
 *  - Right-hand Asset Drawer with filterable `최근 생성` (Image & Video Studio outputs) + `LibraryRail`
 *    (`폴더 / 좋아요 / 업로드`) + `Ctrl+V` clipboard paste.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extractClipboardImages, isEditableTextTarget, prepareClipboardUploadFiles } from "@/lib/brand-studio/clipboard-image";
import {
  addProjectReferenceAssetIds,
  appendClip,
  emptyComposerProject,
  projectDurationSec,
  roundTenths,
  sanitizeProjectForPersistence,
  stackClipTake,
  type ComposeClip,
  type ComposerProject,
} from "@/lib/brand-studio/compose";
import { exportCompositionMp4 } from "@/lib/brand-studio/compose/export-client";
import { exportProjectNleBundleZip } from "@/lib/brand-studio/compose/nle-export";
import type { ContinuityPlan } from "@/lib/brand-studio/continuity/contracts";
import { extractContinuityFramesInBrowser } from "@/lib/brand-studio/continuity/frame-picker";
import type { StudioAllowanceView, StudioAssetView, StudioJobView, StudioOutputView, StudioState } from "@/lib/brand-studio/contracts";
import {
  belongsToOpenProject,
  brandProjectIdOf,
  queryParamOfOpenProject,
  replaceProjectUrlParam,
  writeOpenProjectCookie,
  type OpenProject,
  type StudioSpineProps,
} from "@/lib/brand-studio/open-project";
import type { StudioVideoModel } from "@/lib/brand-studio/models";
import type { VideoProjectDetail, VideoProjectStatus, VideoProjectSummary } from "@/lib/brand-studio/video-projects";
import type { BillingPlanCatalogueItem } from "@/lib/brands/billing-ui";
import type { BrandBillingCopy } from "@/messages/brand-billing";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { createStudioApi, isFailure, measureInBrowser, uploadProblem, type StudioApi } from "../api";
import { ClosedAllowanceBanner } from "../closed-allowance-banner";
import { EXAMPLES, jobsFor } from "../board";
import { errorLine, fill as interpolate, studioUploadErrorLine, type StudioCopy, type StudioLocale } from "../copy";
import { AllowanceLine, Dock } from "../dock";
import {
  DRAFT_RESOLUTION,
  dockControls,
  dockCredits,
  draftAfterAttach,
  remixActive,
  remixFit,
  withMedium,
} from "../dock-model";
import { Wall, type SendingTile, type TileAction, type WallTileItem } from "../gallery/wall";
import { HandoffDialog, handoffInput } from "../handoff-dialog";
import { LibraryRail } from "../rail";
import { useStudioLibrary } from "../rail/use-library";
import {
  REF_DRAG_TYPE,
  acceptsDrag,
  decodeRefDrag,
  trayItemFromAsset,
  trayItemFromOutput,
  trayLabels,
  withStartFrame,
  type RefSource,
  type TrayItem,
} from "../refs";
import { usePageDrag } from "../use-page-drag";
import { ShareReviewDialog, useShareReviewEvent, type ShareReviewTarget } from "../share-review-dialog";
import { STUDIO_JOB_STARTED } from "../seams";
import { findOutput, listedJobs } from "../store";
import { useDock } from "../use-dock";
import { jobInputForBrandProject, useStudio } from "../use-studio";
import { sourceOf, useViewer } from "../use-viewer";
import { Viewer, canRerun, itemKey, type ViewerItem } from "../viewer";
import { handleNotFoundForOpenProject, MoveToProjectDialog, useProjectSpine, type ProjectSpineCopy } from "../project-chip";
import { ClipTrimModal } from "./clip-trim-modal";
import { VideoProjectBar, filmBarCopy } from "./project-bar";
import { RecentCreationsPanel } from "./recent-creations-panel";
import { ReversePanel } from "./reverse";
import { fillText } from "./reverse-model";
import { SequenceRail, type SequenceInspectorTab, type SequenceRailHeight } from "./sequence-rail";
import w from "./video-workspace.module.css";
import { validateVideoEditDurationSeconds } from "./workspace-model";

export interface VideoStudioWorkspaceProps {
  organizationId: string;
  organizationName?: string | null;
  locale: StudioLocale;
  copy: StudioCopy;
  libraryCopy: Dictionary["studioLibrary"];
  videoCopy: StudioVideoCopy;
  billingCopy?: BrandBillingCopy["customer"];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  initialTab?: "create" | "edit";
  initialCreateMode?: "prompt" | "blueprint";
  initialAssetId?: string | null;
  initialProjectId?: string | null;
  initialRailHeight?: SequenceRailHeight;
  initialTimeline?: ComposerProject | null;
  initialSelectedClipId?: string | null;
  initialState?: StudioState | null;
  /** Server-loaded films (spine open only). */
  initialProjects?: VideoProjectSummary[];
  /** Server-loaded film detail when opened via `?film=` (spine open only). */
  initialProjectDetail?: VideoProjectDetail | null;
  /** Brand project spine prop (present only when `BRAND_PROJECT_SPINE` is open and viewer is a member). */
  spine?: StudioSpineProps | null;
  /** `dict.projectSpine` (spine open only, for the bar's `편집본` noun). */
  spineCopy?: ProjectSpineCopy;
  api?: StudioApi;
  /** `BRAND_STUDIO_MUSIC_GENERATION`: music generation controls in the sequence rail. Closed by default. */
  musicGeneration?: boolean;
}

const GUIDE_VIDEOS = [
  { src: "/reel/landing/v7/rx-beauty-orig.mp4", poster: "/reel/landing/v7/rx-beauty-orig.jpg" },
  { src: "/reel/landing/v7/rx-beauty-world.mp4", poster: "/reel/landing/v7/rx-beauty-world.jpg" },
  { src: "/reel/brands/production-paris.mp4", poster: "/reel/brands/production-paris.jpg" },
] as const;

function parseRefParam(value: string | null): RefSource | null {
  const match = /^([ao]):([0-9a-f-]{36})$/i.exec(value ?? "");
  if (!match) return null;
  return match[1] === "a" ? { assetId: match[2]! } : { outputId: match[2]! };
}

function makeProjectReqId(prefix = "vp"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Keyed lazy-film requestId (G0):
 * - Without the spine (`brandProjectId === undefined`): single slot (`__legacy__`), exact old behaviour.
 * - With the spine (`brandProjectId: string | null`): one slot per scope (`projectId` or `__unfiled__`),
 *   so switching projects never drops an in-flight/pending key.
 */
export function scopedLazyRequestId(
  cache: Map<string, string>,
  brandProjectId: string | null | undefined,
  makeId: () => string = () => makeProjectReqId("vp"),
): string {
  const key =
    brandProjectId === undefined ? "__legacy__" : brandProjectId ? brandProjectId.toLowerCase() : "__unfiled__";
  const existing = cache.get(key);
  if (existing) return existing;
  const next = makeId();
  cache.set(key, next);
  return next;
}

/** Pure helper for `?project=` (flag off) vs `?film=` (spine open, preserving `?project=`). */
export function syncVideoFilmUrlParam(href: string, filmId: string | null, useFilmParam: boolean): string {
  const url = new URL(href);
  const key = useFilmParam ? "film" : "project";
  if (filmId) url.searchParams.set(key, filmId);
  else url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Read the initial film id from the address on mount (`film` under spine, `project` without, G6). */
export function readVideoFilmIdFromUrl(href: string, spineActive: boolean): string | null {
  try {
    const paramName = spineActive ? "film" : "project";
    const value = new URL(href).searchParams.get(paramName);
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Client recovery when the film named in the address cannot be opened (G1, J1):
 * runs ONLY when the spine is active AND the server answered `not_found`.
 * Without the spine or on any temporary/network error, returns no-op (`main` parity).
 */
export function planStaleFilmRecovery(input: {
  requestedFilmId: string | null;
  loadedFilmPresent: boolean;
  spineActive: boolean;
  errorCode?: string | null;
  href: string | null;
}): { reloadListWithoutFilm: boolean; nextUrl: string | null } {
  if (!input.spineActive || !input.requestedFilmId || input.loadedFilmPresent) {
    return { reloadListWithoutFilm: false, nextUrl: null };
  }
  if (input.errorCode !== "not_found") {
    return { reloadListWithoutFilm: false, nextUrl: null };
  }
  const nextUrl = input.href ? syncVideoFilmUrlParam(input.href, null, true) : null;
  return {
    reloadListWithoutFilm: true,
    nextUrl,
  };
}

/** Client sync after server-side film-wins on `?film=` (G5): update cookie and rewrite `?project=` to the winning scope. */
export function planFilmWinsSync(input: {
  spineActive: boolean;
  initialFilm: { brandProjectId?: string | null } | null;
  open: OpenProject | undefined;
  href: string | null;
}): { writeCookie: OpenProject | null; nextUrl: string | null } {
  if (!input.spineActive || !input.initialFilm || !input.open) {
    return { writeCookie: null, nextUrl: null };
  }
  const nextUrl = input.href ? replaceProjectUrlParam(input.href, input.open) : null;
  return {
    writeCookie: input.open,
    nextUrl: nextUrl && nextUrl !== input.href ? nextUrl : null,
  };
}

export interface PendingFilmSave {
  projectId: string;
  timeline: ComposerProject;
  title?: string;
  expectedRevision: number;
}

export interface InFlightFilmSave {
  projectId: string;
  promise: Promise<number | null>;
}

/**
 * J2: Flush a pending film save using the revision current at flush time; if another save of the
 * same film is still in flight, wait for its answer first so two saves of one film never race.
 */
export async function flushFilmSaveWithCurrentRevision(input: {
  pending: PendingFilmSave;
  currentRevision: number;
  inFlight: InFlightFilmSave | null;
  send: (save: PendingFilmSave) => Promise<number | null> | void;
}): Promise<PendingFilmSave> {
  let revision = input.currentRevision;
  if (input.inFlight && input.inFlight.projectId === input.pending.projectId) {
    const settledRevision = await input.inFlight.promise.catch(() => null);
    if (typeof settledRevision === "number") {
      revision = settledRevision;
    }
  }
  const toSend: PendingFilmSave = { ...input.pending, expectedRevision: revision };
  await input.send(toSend);
  return toSend;
}

export interface InFlightLazyCreate {
  scopeKey: string;
  promise: Promise<string | null>;
}

/**
 * J3: Reuse an in-flight lazy film-create promise only when it matches the current scope
 * (always reused without the spine, matching `main`).
 */
export function reusableLazyCreatePromise(
  inFlight: InFlightLazyCreate | null,
  currentScopeKey: string,
  spineActive: boolean,
): Promise<string | null> | null {
  if (!inFlight) return null;
  if (!spineActive) return inFlight.promise;
  return inFlight.scopeKey === currentScopeKey ? inFlight.promise : null;
}

/** Decide whether a chip scope switch must flush a pending debounced film save before resetting (G3). */
export function planScopeSwitchFilmReset(input: {
  activeFilmId: string | null;
  activeFilmBrandProjectId: string | null | undefined;
  nextScope: OpenProject;
  pendingSave: PendingFilmSave | null;
}): { reset: boolean; flush: PendingFilmSave | null } {
  if (!input.activeFilmId || belongsToOpenProject(input.activeFilmBrandProjectId, input.nextScope)) {
    return { reset: false, flush: null };
  }
  const flush =
    input.pendingSave && input.pendingSave.projectId === input.activeFilmId ? input.pendingSave : null;
  return { reset: true, flush };
}

/** Whether a lazy-created film response should be adopted as the active film on screen (G3). */
export function shouldAdoptCreatedFilm(input: {
  createdBrandProjectId: string | null | undefined;
  sentScope: OpenProject | undefined;
  currentScope: OpenProject | undefined;
}): boolean {
  if (!input.sentScope && !input.currentScope) return true;
  if (!input.sentScope || !input.currentScope) return false;
  if (queryParamOfOpenProject(input.sentScope) !== queryParamOfOpenProject(input.currentScope)) return false;
  return belongsToOpenProject(input.createdBrandProjectId, input.currentScope);
}

/** Exact `render.reserve` input for MP4 export (G6): omits `brandProjectId` when closed/unfiled. */
export function videoRenderReserveBody(input: {
  organizationId: string;
  requestId: string;
  durationSec: number;
  brandProjectId?: string | null;
}) {
  return {
    organizationId: input.organizationId,
    requestId: input.requestId,
    durationSec: input.durationSec,
    ...(input.brandProjectId ? { brandProjectId: input.brandProjectId } : {}),
  };
}

/** Pass the exact `clientApi` reference to ReversePanel when no project is open (G6). */
export function selectReverseApi(clientApi: StudioApi, openBrandProjectId: string | null | undefined): StudioApi {
  if (!openBrandProjectId) return clientApi;
  return {
    ...clientApi,
    call: ((operation, input) => {
      if (operation === "job.create") {
        return clientApi.call(
          "job.create",
          jobInputForBrandProject(input as Parameters<typeof jobInputForBrandProject>[0], openBrandProjectId),
        );
      }
      return clientApi.call(operation, input as never);
    }) as StudioApi["call"],
    upload: (file, options = {}) => clientApi.upload(file, { ...options, brandProjectId: openBrandProjectId }),
  };
}

/** Films visible in `VideoProjectBar`: all films when spine is closed, or only films in the open scope (§4.5). */
export function filmsInOpenScope<T extends Pick<VideoProjectSummary, "brandProjectId">>(
  films: readonly T[],
  open: OpenProject | undefined,
): T[] {
  if (!open) return [...films];
  return films.filter((film) => belongsToOpenProject(film.brandProjectId, open));
}

/** Payload for `POST /api/brand-studio/video-projects` `{ op: 'create' }`, attaching `brandProjectId` only when open. */
export function videoFilmCreateBody(input: {
  organizationId: string;
  requestId: string;
  title?: string;
  firstPrompt?: string;
  locale: StudioLocale;
  timeline: ComposerProject;
  brandProjectId?: string | null;
}) {
  return {
    op: "create" as const,
    organizationId: input.organizationId,
    requestId: input.requestId,
    ...(input.brandProjectId ? { brandProjectId: input.brandProjectId } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.firstPrompt ? { firstPrompt: input.firstPrompt } : {}),
    locale: input.locale,
    aspect: input.timeline.aspect,
    timeline: input.timeline,
  };
}

function syncProjectUrlParam(projectId: string | null, useFilmParam = false): void {
  if (typeof window === "undefined") return;
  try {
    const next = syncVideoFilmUrlParam(window.location.href, projectId, useFilmParam);
    window.history.replaceState(window.history.state, "", next);
  } catch {
    // Ignore synthetic test environments without valid window.location
  }
}

function triggerBrowserDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openSupport() {
  document.querySelector<HTMLButtonElement>("[data-concierge-launcher]")?.click();
}

const focusPrompt = () => document.querySelector<HTMLTextAreaElement>("[data-studio-dock] textarea.bs-prompt")?.focus();

function useHeadSlot() {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => setSlot(document.querySelector("[data-studio-head-slot]")), []);
  return slot;
}

function useRailWidth() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--bs-rail-w", `${Math.round(el.getBoundingClientRect().width)}px`);
    const observer = new ResizeObserver(write);
    observer.observe(el);
    write();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bs-rail-w");
    };
  }, []);
  return ref;
}

function useTabBarHeight() {
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".bw-rail-tabs");
    const root = document.documentElement;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const write = () => {
      const style = getComputedStyle(bar);
      const shown = style.position === "fixed" && style.display !== "none" && style.visibility !== "hidden";
      root.style.setProperty("--bs-tabbar-h", `${shown ? Math.round(bar.getBoundingClientRect().height) : 0}px`);
    };
    const observer = new ResizeObserver(write);
    observer.observe(bar);
    window.addEventListener("resize", write);
    write();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
      root.style.removeProperty("--bs-tabbar-h");
    };
  }, []);
}

export function VideoStudioWorkspace({
  organizationId,
  organizationName,
  locale,
  copy,
  libraryCopy,
  videoCopy,
  billingCopy,
  planCatalogue,
  initialTab = "create",
  initialCreateMode = "prompt",
  initialAssetId = null,
  initialProjectId = null,
  initialRailHeight = "compact",
  initialTimeline = null,
  initialSelectedClipId = null,
  initialState = null,
  initialProjects,
  initialProjectDetail = null,
  spine = null,
  spineCopy,
  api,
  musicGeneration = false,
}: VideoStudioWorkspaceProps) {
  const wc = videoCopy.workspace;
  const spineCtx = useProjectSpine();
  const spineOpen = spineCtx?.open ?? spine?.open ?? undefined;
  const spineActive = Boolean(spineOpen);
  const openBrandProjectId = spineActive ? brandProjectIdOf(spineOpen) : null;
  const projectsCopy = useMemo(
    () => (spineActive && spineCopy ? filmBarCopy(wc.projects, spineCopy) : wc.projects),
    [spineActive, spineCopy, wc.projects],
  );
  const clientApi = useMemo(() => api ?? createStudioApi({ organizationId }), [api, organizationId]);
  const reverseApi = useMemo<StudioApi>(
    () => selectReverseApi(clientApi, openBrandProjectId),
    [clientApi, openBrandProjectId],
  );
  const studio = useStudio({
    organizationId,
    initialState,
    api: clientApi,
    ...(spineOpen ? { spineOpen, onProjectGone: spineCtx?.markProjectGone } : {}),
  });
  const dock = useDock({
    studio,
    copy,
    organizationId,
    initialMedium: "video",
    mode: "video",
    // The workspace home's hand-off (prefill.ts): only where this member has an open prompt bar.
    prefill: { ready: Boolean(studio.store.state), canCreate: Boolean(studio.store.state?.canCreate) && (studio.store.state?.allowance.capKrw ?? 0) > 0 },
    ...(spineActive ? { brandProjectId: openBrandProjectId } : {}),
  });
  const library = useStudioLibrary(organizationId);
  const state = studio.store.state;
  // Never the internal strips of "빈 곳 채우기" (store.ts `listedJobs`).
  const allJobs = useMemo(() => listedJobs(state?.jobs ?? []), [state?.jobs]);
  const jobs = useMemo(() => jobsFor(allJobs, "video"), [allJobs]);
  const assets = useMemo(() => state?.assets ?? [], [state?.assets]);
  const audioAssets = useMemo(() => assets.filter((a) => a.kind === "audio"), [assets]);
  const canCreate = state?.canCreate ?? false;
  const [allowanceOverride, setAllowanceOverride] = useState<StudioAllowanceView | null>(null);
  const effectiveAllowance = allowanceOverride ?? state?.allowance ?? null;
  const dockOpen = canCreate && (effectiveAllowance?.capKrw ?? 0) > 0;

  const [stageTab, setStageTab] = useState<"history" | "guide">("history");
  const [trimModalClip, setTrimModalClip] = useState<StudioAssetView | null>(null);
  const [handoff, setHandoff] = useState<RefSource | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareReviewTarget | null>(null);
  const [moveRequest, setMoveRequest] = useState<{ jobIds: string[]; opener: HTMLElement | null } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Lazy server-persisted Video Project & 3-Height Sequence Rail state
  const [projects, setProjects] = useState<VideoProjectSummary[]>(() => initialProjects ?? []);
  const [projectId, setProjectId] = useState<string | null>(initialProjectDetail?.id ?? initialProjectId);
  const [projectBrandProjectId, setProjectBrandProjectId] = useState<string | null | undefined>(
    initialProjectDetail?.brandProjectId,
  );
  const [projectTitle, setProjectTitle] = useState<string>(initialProjectDetail?.title ?? projectsCopy.untitled);
  const [projectStatus, setProjectStatus] = useState<VideoProjectStatus>(initialProjectDetail?.status ?? "active");
  const [projectRevision, setProjectRevision] = useState<number>(initialProjectDetail?.revision ?? 1);
  const [savingProject, setSavingProject] = useState(false);
  const [timeline, setTimeline] = useState<ComposerProject>(
    () => initialProjectDetail?.timeline ?? initialTimeline ?? emptyComposerProject("9:16"),
  );
  const [railHeight, setRailHeight] = useState<SequenceRailHeight>(initialRailHeight);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    () => initialSelectedClipId ?? initialProjectDetail?.timeline.clips[0]?.id ?? null,
  );
  const [inspectorTab, setInspectorTab] = useState<SequenceInspectorTab>("color");
  const [exportingNle, setExportingNle] = useState(false);
  const [exportingMp4Ratio, setExportingMp4Ratio] = useState<number | null>(null);

  const lazyCreatePromiseRef = useRef<InFlightLazyCreate | null>(null);
  const lazyRequestIdsRef = useRef<Map<string, string>>(new Map());
  const spineOpenRef = useRef<OpenProject | undefined>(spineOpen);
  spineOpenRef.current = spineOpen;
  const revisionRef = useRef<number>(initialProjectDetail?.revision ?? 1);
  const projectIdRef = useRef<string | null>(initialProjectDetail?.id ?? initialProjectId);
  const projectBrandProjectIdRef = useRef<string | null | undefined>(initialProjectDetail?.brandProjectId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<PendingFilmSave | null>(null);
  const inFlightSaveRef = useRef<InFlightFilmSave | null>(null);
  const localBlobUrlsRef = useRef<string[]>([]);

  // Track jobs started in this session for automatic Sequence Rail append or Take Stack (`1/N`)
  const knownJobIdsRef = useRef<Set<string> | null>(null);
  const sessionJobTargetClipRef = useRef<Map<string, string | null>>(new Map());
  const ingestedOutputIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    projectBrandProjectIdRef.current = projectBrandProjectId;
  }, [projectBrandProjectId]);

  useEffect(() => {
    revisionRef.current = projectRevision;
  }, [projectRevision]);

  // G5: If the page opened a film by `?film=` on the server and the film won the open scope, keep cookie AND `?project=` in sync.
  const syncedFilmCookieRef = useRef(false);
  useEffect(() => {
    if (syncedFilmCookieRef.current) return;
    const href = typeof window !== "undefined" ? window.location.href : null;
    const plan = planFilmWinsSync({
      spineActive,
      initialFilm: initialProjectDetail,
      open: spineOpen,
      href,
    });
    if (!plan.writeCookie) return;
    syncedFilmCookieRef.current = true;
    writeOpenProjectCookie(organizationId, plan.writeCookie);
    if (plan.nextUrl && typeof window !== "undefined") {
      try {
        window.history.replaceState(window.history.state, "", plan.nextUrl);
      } catch {
        // Ignore history errors in restricted environments.
      }
    }
  }, [initialProjectDetail, organizationId, spineActive, spineOpen]);

  // G1: If the server recovered from a stale `?film=` (initialProjectId null, but `?film=` still in URL), strip `film` cleanly.
  const strippedStaleFilmRef = useRef(false);
  useEffect(() => {
    if (strippedStaleFilmRef.current || !spineActive || initialProjectId || typeof window === "undefined") return;
    strippedStaleFilmRef.current = true;
    const urlFilm = readVideoFilmIdFromUrl(window.location.href, true);
    if (!urlFilm) return;
    const recovery = planStaleFilmRecovery({
      requestedFilmId: urlFilm,
      loadedFilmPresent: false,
      spineActive: true,
      errorCode: "not_found",
      href: window.location.href,
    });
    if (recovery.nextUrl) {
      try {
        window.history.replaceState(window.history.state, "", recovery.nextUrl);
      } catch {
        // Ignore
      }
    }
  }, [initialProjectId, spineActive]);

  // The timeline as it is now, for work that resumes after a request (a run is sent before its project is made).
  const timelineRef = useRef<ComposerProject>(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  // Bumped when the customer opens another project, starts a new one or deletes this one: what a press of
  // 만들기 recorded belongs to the project that was open when it was pressed.
  const projectContextRef = useRef(0);
  // An accepted run's bookkeeping, done once the timeline holding its references is committed.
  const [afterRun, setAfterRun] = useState<{ firstPrompt: string; context: number; refsChanged: boolean } | null>(null);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      for (const u of localBlobUrlsRef.current) URL.revokeObjectURL(u);
    },
    [],
  );

  useShareReviewEvent(organizationId, setShareTarget);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [jobNotes, setJobNotes] = useState<Record<string, string>>({});
  const [sending] = useState<SendingTile[]>([]);

  const searchId = useId();
  const railId = useId();
  const headSlot = useHeadSlot();
  const railSlot = useRailWidth();
  useTabBarHeight();

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

  /* --------------------------------------------- Video Projects API & Lazy Persistence */

  const applyLoadedProject = useCallback(
    (detail: VideoProjectDetail, opts?: { fromUrl?: boolean }) => {
      projectContextRef.current += 1;
      setProjectId(detail.id);
      projectIdRef.current = detail.id;
      setProjectBrandProjectId(detail.brandProjectId);
      projectBrandProjectIdRef.current = detail.brandProjectId;
      setProjectTitle(detail.title);
      setProjectStatus(detail.status);
      setProjectRevision(detail.revision);
      revisionRef.current = detail.revision;
      setTimeline(detail.timeline);
      setSelectedClipId(detail.timeline.clips[0]?.id ?? null);
      syncProjectUrlParam(detail.id, spineActive);
      // Opening a film by address (`?film=`) whose brandProjectId differs from open scope switches scope (film wins).
      if (opts?.fromUrl && spineCtx && !belongsToOpenProject(detail.brandProjectId, spineCtx.open)) {
        const targetOpen: OpenProject =
          detail.brandProjectId && spineCtx.projects.some((p) => p.id.toLowerCase() === detail.brandProjectId!.toLowerCase())
            ? { kind: "project", id: detail.brandProjectId }
            : { kind: "unfiled" };
        spineCtx.select(targetOpen);
      }
    },
    [spineActive, spineCtx],
  );

  const loadProjectsFromServer = useCallback(
    async (targetId?: string | null, opts?: { fromUrl?: boolean }) => {
      if (typeof fetch !== "function") return;
      try {
        const q = new URLSearchParams({ organizationId });
        if (targetId) q.set("projectId", targetId);
        const res = await fetch(`/api/brand-studio/video-projects?${q.toString()}`, {
          credentials: "same-origin",
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          code?: string;
          projects?: VideoProjectSummary[];
          project?: VideoProjectDetail | null;
        } | null;
        if (!res.ok || !data?.ok) {
          // J1: Recover only when the spine is active AND the server answered `not_found`.
          // Without the spine (or on temporary/network errors), do nothing — exact `main` parity.
          if (targetId && spineActive) {
            const href = typeof window !== "undefined" ? window.location.href : null;
            const recovery = planStaleFilmRecovery({
              requestedFilmId: targetId,
              loadedFilmPresent: false,
              spineActive,
              errorCode: data?.code ?? null,
              href,
            });
            if (recovery.nextUrl && typeof window !== "undefined") {
              try {
                window.history.replaceState(window.history.state, "", recovery.nextUrl);
              } catch {
                // Ignore
              }
            }
            if (recovery.reloadListWithoutFilm) {
              await loadProjectsFromServer(null);
            }
          }
          return;
        }
        if (Array.isArray(data.projects)) setProjects(data.projects);
        if (data.project) {
          const currentScope = spineOpenRef.current;
          if (!opts?.fromUrl && currentScope && !belongsToOpenProject(data.project.brandProjectId, currentScope)) {
            return;
          }
          applyLoadedProject(data.project, opts);
        }
      } catch {
        // Offline / pure unit test environment without fetch handler
      }
    },
    [applyLoadedProject, organizationId, spineActive],
  );

  const initialProjectsLoadedRef = useRef(
    Boolean(initialProjects && (!initialProjectId || initialProjectDetail?.id === initialProjectId)),
  );
  useEffect(() => {
    if (initialProjectsLoadedRef.current) return;
    initialProjectsLoadedRef.current = true;
    let urlProjectId = initialProjectId;
    if (!urlProjectId && typeof window !== "undefined") {
      urlProjectId = readVideoFilmIdFromUrl(window.location.href, spineActive);
    }
    void loadProjectsFromServer(urlProjectId, { fromUrl: Boolean(urlProjectId) });
  }, [initialProjectId, loadProjectsFromServer, spineActive]);

  const ensureLazyProjectCreated = useCallback(
    async (opts: {
      nextTimeline: ComposerProject;
      firstPrompt?: string;
      explicitTitle?: string;
    }): Promise<string | null> => {
      if (projectIdRef.current) return projectIdRef.current;
      if (!canCreate || typeof fetch !== "function") return null;

      const persistable = sanitizeProjectForPersistence(opts.nextTimeline);
      const sentScope = spineOpenRef.current;
      const targetBrandProjectId = spineActive ? openBrandProjectId : undefined;
      const scopeCacheKey =
        targetBrandProjectId === undefined
          ? "__legacy__"
          : targetBrandProjectId
            ? targetBrandProjectId.toLowerCase()
            : "__unfiled__";
      const reusable = reusableLazyCreatePromise(lazyCreatePromiseRef.current, scopeCacheKey, spineActive);
      if (reusable) return reusable;
      const reqId = scopedLazyRequestId(lazyRequestIdsRef.current, targetBrandProjectId);
      const entry: InFlightLazyCreate = { scopeKey: scopeCacheKey, promise: null! };
      const promise = (async () => {
        setSavingProject(true);
        try {
          const res = await fetch("/api/brand-studio/video-projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(
              videoFilmCreateBody({
                organizationId,
                requestId: reqId,
                title: opts.explicitTitle,
                firstPrompt: opts.firstPrompt,
                locale,
                timeline: persistable,
                brandProjectId: openBrandProjectId,
              }),
            ),
          });
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            code?: string;
            project?: VideoProjectDetail;
          } | null;
          if (!res.ok || !data?.ok || !data.project) {
            if (data?.code === "not_found" && openBrandProjectId && spineCtx?.markProjectGone) {
              const gone = await handleNotFoundForOpenProject({
                code: "not_found",
                openProjectId: openBrandProjectId,
                listProjects: () => clientApi.listBrandProjects(),
                onProjectGone: spineCtx.markProjectGone,
              });
              if (gone) lazyRequestIdsRef.current.delete(scopeCacheKey);
            }
            return null;
          }
          const created = data.project;
          lazyRequestIdsRef.current.delete(scopeCacheKey);
          setProjects((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
          // G3: If the member switched brand project while this film was creating, keep it in its created scope without adopting it.
          if (
            !shouldAdoptCreatedFilm({
              createdBrandProjectId: created.brandProjectId,
              sentScope,
              currentScope: spineOpenRef.current,
            })
          ) {
            return created.id;
          }
          setProjectId(created.id);
          projectIdRef.current = created.id;
          setProjectBrandProjectId(created.brandProjectId);
          projectBrandProjectIdRef.current = created.brandProjectId;
          setProjectTitle(created.title);
          setProjectStatus(created.status);
          setProjectRevision(created.revision);
          revisionRef.current = created.revision;
          syncProjectUrlParam(created.id, spineActive);
          return created.id;
        } catch {
          return null;
        } finally {
          setSavingProject(false);
          if (lazyCreatePromiseRef.current === entry) {
            lazyCreatePromiseRef.current = null;
          }
        }
      })();

      entry.promise = promise;
      lazyCreatePromiseRef.current = entry;
      return promise;
    },
    [canCreate, clientApi, locale, openBrandProjectId, organizationId, spineActive, spineCtx],
  );

  const sendFilmSave = useCallback(
    (save: PendingFilmSave): Promise<number | null> => {
      const persistable = sanitizeProjectForPersistence(save.timeline);
      setSavingProject(true);
      const entry: InFlightFilmSave = { projectId: save.projectId, promise: null! };
      const promise = fetch("/api/brand-studio/video-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          op: "save",
          organizationId,
          projectId: save.projectId,
          ...(save.title ? { title: save.title } : {}),
          aspect: persistable.aspect,
          timeline: persistable,
          expectedRevision: save.expectedRevision,
        }),
      })
        .then(async (res): Promise<number | null> => {
          const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            project?: VideoProjectDetail;
            code?: string;
            currentRevision?: number;
          };
          if (data.ok && data.project) {
            // J4: Without the spine, update state unconditionally as on `main`; with the spine, guard by active film id.
            if (!spineActive || projectIdRef.current === data.project.id) {
              setProjectRevision(data.project.revision);
              revisionRef.current = data.project.revision;
              setProjectTitle(data.project.title);
            }
            setProjects((prev) => [data.project!, ...prev.filter((p) => p.id !== data.project!.id)]);
            return data.project.revision;
          }
          if (data.code === "conflict" && typeof data.currentRevision === "number") {
            if (!spineActive || projectIdRef.current === save.projectId) {
              revisionRef.current = data.currentRevision;
              setProjectRevision(data.currentRevision);
            }
            return data.currentRevision;
          }
          return null;
        })
        .catch(() => null)
        .finally(() => {
          setSavingProject(false);
          if (inFlightSaveRef.current === entry) {
            inFlightSaveRef.current = null;
          }
        });
      entry.promise = promise;
      inFlightSaveRef.current = entry;
      return promise;
    },
    [organizationId, spineActive],
  );

  const scheduleProjectSave = useCallback(
    (nextTimeline: ComposerProject, nextTitle?: string) => {
      if (!canCreate || typeof fetch !== "function") return;
      const pid = projectIdRef.current;
      if (!pid) {
        if (nextTimeline.clips.length > 0) {
          void ensureLazyProjectCreated({ nextTimeline, explicitTitle: nextTitle });
        }
        return;
      }

      const pending: PendingFilmSave = {
        projectId: pid,
        timeline: nextTimeline,
        title: nextTitle,
        expectedRevision: revisionRef.current,
      };
      pendingSaveRef.current = pending;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        pendingSaveRef.current = null;
        sendFilmSave({ ...pending, expectedRevision: revisionRef.current });
      }, 600);
    },
    [canCreate, ensureLazyProjectCreated, sendFilmSave],
  );

  // After an accepted run (Lazy Create): make the project, or save the references onto the open one, from the
  // committed timeline, so a clip that joined the sequence while the run was on its way is kept.
  useEffect(() => {
    if (!afterRun) return;
    setAfterRun(null);
    if (projectContextRef.current !== afterRun.context) return;
    void ensureLazyProjectCreated({ nextTimeline: timeline, firstPrompt: afterRun.firstPrompt }).then((pid) => {
      if (pid && afterRun.refsChanged) scheduleProjectSave(timelineRef.current);
    });
  }, [afterRun, timeline, ensureLazyProjectCreated, scheduleProjectSave]);

  const commitTimeline = useCallback(
    (next: ComposerProject) => {
      setTimeline(next);
      scheduleProjectSave(next);
    },
    [scheduleProjectSave],
  );

  const resetActiveFilm = useCallback(
    (rotateRequestId: boolean) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = null;
      projectContextRef.current += 1;
      if (rotateRequestId) {
        const key = !spineActive ? "__legacy__" : openBrandProjectId ? openBrandProjectId.toLowerCase() : "__unfiled__";
        lazyRequestIdsRef.current.delete(key);
      }
      setProjectId(null);
      projectIdRef.current = null;
      setProjectBrandProjectId(openBrandProjectId);
      projectBrandProjectIdRef.current = openBrandProjectId;
      setProjectTitle(projectsCopy.untitled);
      setProjectStatus("active");
      setProjectRevision(1);
      revisionRef.current = 1;
      setTimeline(emptyComposerProject("9:16"));
      setSelectedClipId(null);
      syncProjectUrlParam(null, spineActive);
    },
    [openBrandProjectId, projectsCopy.untitled, spineActive],
  );

  const handleStartNewProject = useCallback(() => {
    resetActiveFilm(true);
  }, [resetActiveFilm]);

  // G3: When the user switches the open brand project in the header chip, flush any pending debounced film save
  // BEFORE resetting an open film from another scope, without dropping any pending lazy-create requestId (G0/F1).
  const prevSpineScopeRef = useRef<string | undefined>(spineOpen ? queryParamOfOpenProject(spineOpen) : undefined);
  useEffect(() => {
    if (!spineOpen) return;
    const nextScope = queryParamOfOpenProject(spineOpen);
    const prevScope = prevSpineScopeRef.current;
    prevSpineScopeRef.current = nextScope;
    if (prevScope === undefined || prevScope === nextScope) return;
    const plan = planScopeSwitchFilmReset({
      activeFilmId: projectIdRef.current,
      activeFilmBrandProjectId: projectBrandProjectIdRef.current,
      nextScope: spineOpen,
      pendingSave: pendingSaveRef.current,
    });
    if (!plan.reset) return;
    if (plan.flush) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = null;
      // J2: Capture current revision before resetActiveFilm zeroes it, and wait for any in-flight save of this film first.
      const currentRevision = revisionRef.current;
      const inFlight = inFlightSaveRef.current;
      void flushFilmSaveWithCurrentRevision({
        pending: plan.flush,
        currentRevision,
        inFlight,
        send: sendFilmSave,
      });
    }
    resetActiveFilm(false);
  }, [resetActiveFilm, sendFilmSave, spineOpen]);

  const visibleProjects = useMemo(() => filmsInOpenScope(projects, spineOpen), [projects, spineOpen]);

  const handleRenameProject = useCallback(
    (nextTitle: string) => {
      setProjectTitle(nextTitle);
      if (projectIdRef.current) {
        scheduleProjectSave(timeline, nextTitle);
      }
    },
    [scheduleProjectSave, timeline],
  );

  const handleToggleProjectComplete = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid || !canCreate || typeof fetch !== "function") return;
    const nextStatus: VideoProjectStatus = projectStatus === "completed" ? "active" : "completed";
    setSavingProject(true);
    try {
      const res = await fetch("/api/brand-studio/video-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          op: "status",
          organizationId,
          projectId: pid,
          status: nextStatus,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        project?: VideoProjectDetail;
      };
      if (data.ok && data.project) {
        setProjectStatus(data.project.status);
        setProjectRevision(data.project.revision);
        revisionRef.current = data.project.revision;
        setProjects((prev) => [data.project!, ...prev.filter((p) => p.id !== data.project!.id)]);
        if (nextStatus === "completed") {
          setStatus(projectsCopy.projectCompletedNotice);
        }
      }
    } finally {
      setSavingProject(false);
    }
  }, [canCreate, organizationId, projectStatus, projectsCopy.projectCompletedNotice]);

  const handleDeleteProject = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid || !canCreate || typeof fetch !== "function") return;
    setSavingProject(true);
    try {
      const res = await fetch("/api/brand-studio/video-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          op: "delete",
          organizationId,
          projectId: pid,
        }),
      });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== pid));
        handleStartNewProject();
      }
    } finally {
      setSavingProject(false);
    }
  }, [canCreate, handleStartNewProject, organizationId]);

  const handleSendClipToExistingProject = useCallback(
    async (targetProjectId: string) => {
      if (!canCreate || typeof fetch !== "function") return;
      const clipToSend =
        (selectedClipId ? timeline.clips.find((c) => c.id === selectedClipId) : null) ??
        timeline.clips[timeline.clips.length - 1] ??
        null;
      if (!clipToSend) return;

      try {
        const q = new URLSearchParams({ organizationId, projectId: targetProjectId });
        const detailRes = await fetch(`/api/brand-studio/video-projects?${q.toString()}`, {
          credentials: "same-origin",
        });
        const detailJson = (await detailRes.json().catch(() => ({}))) as {
          ok?: boolean;
          project?: VideoProjectDetail;
        };
        if (!detailJson.ok || !detailJson.project) return;
        const targetProj = detailJson.project;
        const mergedTimeline = sanitizeProjectForPersistence(
          appendClip(targetProj.timeline, {
            label: clipToSend.label,
            sourceKind: clipToSend.sourceKind,
            ...(clipToSend.assetId ? { assetId: clipToSend.assetId } : {}),
            ...(clipToSend.outputId ? { outputId: clipToSend.outputId } : {}),
            srcUrl: clipToSend.srcUrl,
            thumbUrl: clipToSend.thumbUrl ?? null,
            durationSec: clipToSend.durationSec,
            trimStartSec: clipToSend.trimStartSec,
            trimEndSec: clipToSend.trimEndSec,
            volume: clipToSend.volume,
            muted: clipToSend.muted,
          }),
        );

        const saveRes = await fetch("/api/brand-studio/video-projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            op: "save",
            organizationId,
            projectId: targetProjectId,
            timeline: mergedTimeline,
            expectedRevision: targetProj.revision,
          }),
        });
        const savedJson = (await saveRes.json().catch(() => ({}))) as {
          ok?: boolean;
          project?: VideoProjectDetail;
        };
        if (savedJson.ok && savedJson.project) {
          setProjects((prev) => [savedJson.project!, ...prev.filter((p) => p.id !== savedJson.project!.id)]);
          setStatus(interpolate(projectsCopy.sentToProject, { title: savedJson.project.title }));
        }
      } catch {
        // Ignore network errors
      }
    },
    [canCreate, organizationId, projectsCopy.sentToProject, selectedClipId, timeline.clips],
  );

  /* --------------------------------------------- Session Video Output -> Sequence / Take Stack */

  const addVideoOutputToSequence = useCallback(
    (output: StudioOutputView, label: string, opts?: { stackIntoClipId?: string | null }) => {
      const dur = Math.max(1, roundTenths(output.seconds ?? 5));
      const cleanLabel = label.trim().slice(0, 64) || output.id.slice(0, 8);
      const targetStackId = opts?.stackIntoClipId ?? null;

      setTimeline((prev) => {
        let next: ComposerProject;
        if (targetStackId && prev.clips.some((c) => c.id === targetStackId)) {
          const targetClip = prev.clips.find((c) => c.id === targetStackId)!;
          next = stackClipTake(prev, targetStackId, {
            label: cleanLabel,
            sourceKind: "output",
            outputId: output.id,
            srcUrl: output.url,
            thumbUrl: output.thumbUrl ?? null,
            durationSec: dur,
            trimStartSec: 0,
            trimEndSec: dur,
          });
          const updatedClip = next.clips.find((c) => c.id === targetStackId);
          const count = updatedClip?.takes?.length ?? 2;
          setStatus(
            interpolate(wc.projects.takeStackedNotice, {
              label: targetClip.label,
              take: `${count}/${count}`,
            }),
          );
        } else {
          next = appendClip(prev, {
            label: cleanLabel,
            sourceKind: "output",
            outputId: output.id,
            srcUrl: output.url,
            thumbUrl: output.thumbUrl ?? null,
            durationSec: dur,
            trimStartSec: 0,
            trimEndSec: dur,
            volume: 1,
            muted: false,
          });
          const added = next.clips[next.clips.length - 1];
          if (added) setSelectedClipId(added.id);
          setStatus(interpolate(wc.projects.clipAddedNotice, { label: cleanLabel }));
        }
        scheduleProjectSave(next);
        return next;
      });
    },
    [scheduleProjectSave, wc.projects.clipAddedNotice, wc.projects.takeStackedNotice],
  );

  // Detect newly started & newly settled video jobs from this session
  useEffect(() => {
    if (!state) return;
    if (knownJobIdsRef.current === null) {
      knownJobIdsRef.current = new Set(jobs.map((j) => j.id));
      for (const j of jobs) {
        for (const o of j.outputs) ingestedOutputIdsRef.current.add(o.id);
      }
      return;
    }

    for (const j of jobs) {
      if (!knownJobIdsRef.current.has(j.id)) {
        knownJobIdsRef.current.add(j.id);
        if (!sessionJobTargetClipRef.current.has(j.id)) {
          sessionJobTargetClipRef.current.set(j.id, selectedClipId);
        }
      }

      if (sessionJobTargetClipRef.current.has(j.id) && j.status === "succeeded" && j.outputs.length > 0) {
        const targetClipId = sessionJobTargetClipRef.current.get(j.id) ?? null;
        for (const out of j.outputs) {
          if (out.kind === "video" && !ingestedOutputIdsRef.current.has(out.id)) {
            ingestedOutputIdsRef.current.add(out.id);
            addVideoOutputToSequence(out, j.prompt || projectsCopy.untitled, {
              stackIntoClipId: targetClipId,
            });
          }
        }
        sessionJobTargetClipRef.current.delete(j.id);
      }
    }
  }, [addVideoOutputToSequence, jobs, projectsCopy.untitled, selectedClipId, state]);

  // Refresh gallery when a job starts from the wide ReversePanel drawer.
  const { load: reloadStudio } = studio;
  useEffect(() => {
    const onStarted = () => {
      setStageTab("history");
      setStatus(copy.state.started);
      void reloadStudio();
    };
    window.addEventListener(STUDIO_JOB_STARTED, onStarted);
    return () => window.removeEventListener(STUDIO_JOB_STARTED, onStarted);
  }, [copy.state.started, reloadStudio]);

  // Analyze reference video automatically when `@video1` enters the dock tray.
  const remixOn = remixActive(dock.draft, dock.tray);
  const remixVideo = remixOn ? dock.tray.find((item) => item.kind === "video") : undefined;
  const { analyzeFilm } = studio;
  const { setDraft } = dock;
  useEffect(() => {
    if (remixVideo?.assetId) analyzeFilm(remixVideo.assetId);
  }, [remixVideo?.assetId, analyzeFilm]);
  useEffect(() => {
    if (remixOn) setDraft((current) => ({ ...current, resolution: DRAFT_RESOLUTION }));
  }, [remixOn, setDraft]);
  const editable = remixFit(dock.draft, dock.tray)?.editable ?? true;
  useEffect(() => {
    if (!editable) {
      setDraft((current) => (current.method === "edit" ? { ...current, method: "blueprint", methodPinned: false } : current));
    }
  }, [editable, setDraft]);

  const parentOf = useCallback((outputId: string | null) => findOutput(allJobs, outputId), [allJobs]);
  const lookup = useMemo(
    () => ({
      asset: (id: string) => assets.find((a) => a.id === id) ?? null,
      output: (id: string) => findOutput(allJobs, id),
    }),
    [assets, allJobs],
  );
  const parentAssetOf = useCallback((assetId: string | null) => (assetId ? lookup.asset(assetId) : null), [lookup]);

  const sourceItem = useCallback(
    (source: RefSource): TrayItem | null => {
      const asset = "assetId" in source ? lookup.asset(source.assetId) : null;
      const output = "outputId" in source ? lookup.output(source.outputId) : null;
      return asset ? trayItemFromAsset(asset) : output ? trayItemFromOutput(output, copy.viewer.label) : null;
    },
    [copy.viewer.label, lookup],
  );

  // Recent outputs across image & video jobs for Section 2 of `@` autocomplete.
  const recentOutputs = useMemo(() => {
    const out: TrayItem[] = [];
    for (const job of allJobs) {
      for (const output of job.outputs) {
        if (out.length >= 12) break;
        out.push(trayItemFromOutput(output, copy.viewer.label));
      }
      if (out.length >= 12) break;
    }
    return out;
  }, [allJobs, copy.viewer.label]);

  const latestReadyVideoOutput = useMemo(() => {
    for (const job of jobs) {
      for (const output of job.outputs) {
        if (output.kind === "video") return { output, label: job.prompt || projectsCopy.untitled };
      }
    }
    return null;
  }, [jobs, projectsCopy.untitled]);

  const onReview = useCallback(
    (source: RefSource, title: string) => {
      setShareTarget({
        organizationId,
        assetId: "assetId" in source ? source.assetId : null,
        outputId: "outputId" in source ? source.outputId : null,
        title: title.slice(0, 120) || copy.gallery.reviewTitle,
      });
    },
    [copy.gallery.reviewTitle, organizationId],
  );

  const viewer = useViewer({
    studio,
    dock,
    copy,
    locale,
    mode: "video",
    organizationId,
    jobs,
    assets,
    lookup,
    onCampaign: setHandoff,
    onDecorate: () => undefined,
    onReview: (item) => void onReview(sourceOf(item), item.type === "output" ? item.job.prompt : item.asset.name),
    onToVideoScreen: () => undefined,
    onRegionSending: () => undefined,
    focusPrompt,
    reviseV2: Boolean(state?.reviseV2),
  });

  const attachSource = useCallback(
    (source: RefSource) => {
      const item = sourceItem(source);
      if (item) dock.attach(item);
    },
    [dock, sourceItem],
  );

  // Initial URL / prop preselection (`?start=reverse&asset=<uuid>`, `?tab=edit&asset=<uuid>`)
  const initAssetDone = useRef(false);
  useEffect(() => {
    if (initAssetDone.current || !initialAssetId || !state) return;
    initAssetDone.current = true;
    const found = state.assets.find((a) => a.id === initialAssetId);
    if (!found) return;
    const tile = trayItemFromAsset(found);
    dock.attach(tile);
    if (found.kind === "video") {
      if (initialTab === "edit") {
        const videoModel = dockControls(dock.draft).model as StudioVideoModel;
        const canEdit =
          typeof found.seconds !== "number" ||
          (found.seconds >= videoModel.referenceVideoSeconds.editMin && found.seconds <= videoModel.referenceVideoSeconds.max);
        if (canEdit) {
          dock.setDraft((cur) => ({ ...cur, method: "edit", methodPinned: true, clipCount: 1, targetTotalSeconds: null }));
        } else {
          setTrimModalClip(found);
        }
      } else if (initialCreateMode === "blueprint") {
        dock.setDraft((cur) => ({ ...cur, method: "blueprint", methodPinned: true }));
      }
    }
  }, [dock, initialAssetId, initialCreateMode, initialTab, state]);

  // URL `?from=` (opening frame from Image Studio) & `?ref=` (from Brand Asset Hub)
  const urlAttachDone = useRef(false);
  useEffect(() => {
    if (urlAttachDone.current || !state) return;
    urlAttachDone.current = true;
    const url = new URL(window.location.href);
    const fromSrc = parseRefParam(url.searchParams.get("from"));
    if (fromSrc) {
      const tile = sourceItem(fromSrc);
      if (tile && tile.kind === "image") {
        dock.setDraft((cur) => withMedium(cur, "video"));
        dock.setTray((cur) => withStartFrame(cur, tile));
      }
      url.searchParams.delete("from");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const refSrc = parseRefParam(url.searchParams.get("ref"));
    if (refSrc) {
      const tile = sourceItem(refSrc);
      if (tile) {
        dock.attach(tile);
        focusPrompt();
      }
      url.searchParams.delete("ref");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [dock, sourceItem, state]);

  // Opened from the workspace home (`/brand/home`, docs/BRAND-STUDIO-V3.md §12) with `?view=o:<id>`: that
  // clip opens in the viewer. One this screen does not list leaves the screen as it is.
  const viewDone = useRef(false);
  const showInViewer = viewer.show;
  useEffect(() => {
    if (viewDone.current || !state) return;
    viewDone.current = true;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("view")) return;
    const source = parseRefParam(url.searchParams.get("view"));
    url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (!source || !("outputId" in source)) return;
    if (jobs.some((job) => job.outputs.some((output) => output.id === source.outputId))) {
      showInViewer({ list: "outputs", key: `o:${source.outputId}` });
    }
  }, [jobs, showInViewer, state]);

  const uploadFiles = useCallback(
    async (files: File[], attach: boolean) => {
      const say = attach ? dock.setMessage : setPanelNotice;
      say(null);
      await Promise.all(
        files.map(async (file) => {
          const problem = uploadProblem(file);
          if (problem) return say(studioUploadErrorLine(copy, problem));
          const result = await studio.upload(file);
          if (isFailure(result)) {
            if ((result as { projectGone?: boolean }).projectGone) return;
            return say(studioUploadErrorLine(copy, result.code, result.reason));
          }
          if (attach) dock.attach(trayItemFromAsset(result.asset));
        }),
      );
    },
    [copy, dock, studio],
  );

  const handleLocalSequenceFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (!file.type.startsWith("video/") && !/\.(mp4|mov)$/i.test(file.name)) continue;
        const measured = await measureInBrowser(file, "video").catch(() => ({ seconds: 5 }));
        const dur = Math.max(1, roundTenths(measured.seconds ?? 5));
        const label = file.name.replace(/\.[^.]+$/, "") || "Clip";

        if (canCreate) {
          const uploaded = await studio.upload(file);
          if (!isFailure(uploaded)) {
            setTimeline((prev) => {
              const next = appendClip(prev, {
                label: uploaded.asset.name || label,
                sourceKind: "asset",
                assetId: uploaded.asset.id,
                srcUrl: uploaded.asset.url,
                thumbUrl: uploaded.asset.thumbUrl ?? null,
                durationSec: Math.max(1, roundTenths(uploaded.asset.seconds ?? dur)),
                trimStartSec: 0,
                trimEndSec: Math.max(1, roundTenths(uploaded.asset.seconds ?? dur)),
                volume: 1,
                muted: false,
              });
              scheduleProjectSave(next);
              return next;
            });
            continue;
          }
        }

        const blobUrl = URL.createObjectURL(file);
        localBlobUrlsRef.current.push(blobUrl);
        setTimeline((prev) =>
          appendClip(prev, {
            label,
            sourceKind: "local",
            srcUrl: blobUrl,
            thumbUrl: null,
            durationSec: dur,
            trimStartSec: 0,
            trimEndSec: dur,
            volume: 1,
            muted: false,
          }),
        );
      }
    },
    [canCreate, scheduleProjectSave, studio],
  );

  // Allow Ctrl+V / Cmd+V anywhere on the Video Studio canvas (when no modal consumed it) to attach copied images into Dock's tray.
  useEffect(() => {
    if (!dockOpen || trimModalClip || viewer.open || handoff || shareTarget || typeof window === "undefined") return;
    const onWindowPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const inDock = Boolean(
        event.target &&
          typeof (event.target as HTMLElement).closest === "function" &&
          (event.target as HTMLElement).closest("[data-studio-dock]"),
      );
      if (inDock || isEditableTextTarget(event.target)) return;
      const pasted = extractClipboardImages(event.clipboardData);
      if (!pasted.length) return;
      event.preventDefault();
      event.stopPropagation();
      void prepareClipboardUploadFiles(pasted).then(async (ready) => {
        await uploadFiles(ready, true);
        setStatus(copy.tray.pasted);
      });
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [dockOpen, trimModalClip, viewer.open, handoff, shareTarget, uploadFiles, copy.tray.pasted]);

  // Open `ClipTrimModal` directly from `@video1` in `Tray` or `RemixPanel`.
  const openTrimForTrayItem = useCallback(
    (item: TrayItem) => {
      if (item.kind !== "video") return;
      if (item.assetId) {
        const asset = lookup.asset(item.assetId);
        if (asset) {
          setTrimModalClip(asset);
          return;
        }
      }
      setTrimModalClip({
        id: item.assetId ?? item.outputId ?? "00000000-0000-4000-8000-000000000000",
        kind: "video",
        role: item.role ?? null,
        name: item.name,
        width: item.width ?? null,
        height: item.height ?? null,
        seconds: item.seconds ?? null,
        tags: [],
        url: item.url,
        thumbUrl: item.thumbUrl,
        source: "generation",
        createdAt: new Date().toISOString(),
      });
    },
    [lookup],
  );

  const videoModel = useMemo(() => dockControls(dock.draft).model as StudioVideoModel, [dock.draft]);

  const uploadTrimmedClip = useCallback(
    async (file: File): Promise<StudioAssetView | null> => {
      const problem = uploadProblem(file);
      if (problem) {
        dock.setMessage(studioUploadErrorLine(copy, problem));
        return null;
      }
      const measured = await measureInBrowser(file, "video").catch(() => ({ seconds: undefined }));
      const durProblem = validateVideoEditDurationSeconds(
        measured.seconds,
        videoModel.referenceVideoSeconds.editMin,
        videoModel.referenceVideoSeconds.max,
      );
      if (durProblem) {
        const line =
          durProblem.kind === "too_short"
            ? fillText(wc.editSource.tooShort, { min: durProblem.min })
            : durProblem.kind === "too_long"
              ? fillText(wc.editSource.tooLong, { max: durProblem.max })
              : fillText(wc.editSource.unmeasured, { min: durProblem.min, max: durProblem.max });
        dock.setMessage(line);
        return null;
      }
      const res = await studio.upload(file);
      if (isFailure(res)) {
        if (!(res as { projectGone?: boolean }).projectGone) {
          dock.setMessage(studioUploadErrorLine(copy, res.code, res.reason));
        }
        return null;
      }
      return res.asset;
    },
    [copy, dock, studio, videoModel.referenceVideoSeconds.editMin, videoModel.referenceVideoSeconds.max, wc.editSource],
  );

  const replaceVideoInTray = useCallback(
    (nextAsset: StudioAssetView) => {
      const replacement = trayItemFromAsset(nextAsset);
      dock.setTray((current) => {
        const idx = current.findIndex((t) => t.kind === "video");
        if (idx < 0) return [replacement, ...current];
        const copyList = [...current];
        copyList[idx] = replacement;
        return copyList;
      });
      dock.setDraft((current) => draftAfterAttach(current, replacement, true, dock.tray));
    },
    [dock],
  );

  /* --------------------------------------------- Header Export & Share Handlers */

  const totalSequenceSec = useMemo(() => projectDurationSec(timeline), [timeline]);

  const handleBarShareReview = useCallback(() => {
    const chosen =
      (selectedClipId ? timeline.clips.find((c) => c.id === selectedClipId) : null) ??
      timeline.clips[0] ??
      null;
    if (chosen?.assetId) {
      onReview({ assetId: chosen.assetId }, projectTitle || chosen.label);
      return;
    }
    if (chosen?.outputId) {
      onReview({ outputId: chosen.outputId }, projectTitle || chosen.label);
      return;
    }
    if (latestReadyVideoOutput) {
      onReview({ outputId: latestReadyVideoOutput.output.id }, latestReadyVideoOutput.label);
      return;
    }
    setStatus(wc.projects.reviewNeedsClipNotice);
  }, [latestReadyVideoOutput, onReview, projectTitle, selectedClipId, timeline.clips, wc.projects.reviewNeedsClipNotice]);

  const handleBarExportNle = useCallback(async () => {
    if (timeline.clips.length === 0 || exportingNle) return;
    setExportingNle(true);
    try {
      const fetchMedia = async (url: string): Promise<Uint8Array> => {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`media fetch ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };
      const bundle = await exportProjectNleBundleZip(timeline, fetchMedia, {
        projectTitle: projectTitle || projectsCopy.untitled,
        includeBgm: true,
      });
      const blob = new Blob([bundle.zipBytes as BlobPart], { type: "application/zip" });
      const objectUrl = URL.createObjectURL(blob);
      triggerBrowserDownload(objectUrl, bundle.filename);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setStatus(interpolate(wc.projects.nleExportedNotice, { filename: bundle.filename }));
    } catch {
      setStatus(wc.projects.nleFailedNotice);
    } finally {
      setExportingNle(false);
    }
  }, [exportingNle, projectTitle, projectsCopy.untitled, timeline, wc.projects.nleExportedNotice, wc.projects.nleFailedNotice]);

  const handleBarExportMp4 = useCallback(async () => {
    if (!canCreate || timeline.clips.length === 0 || exportingMp4Ratio !== null) return;
    setExportingMp4Ratio(0.02);

    try {
      // Export is free (docs/BRAND-EDITING-STUDIO.md §8-3): the server only records it, nothing to refund.
      const reserveRes = await fetch("/api/brand-studio/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operation: "render.reserve",
          input: videoRenderReserveBody({
            organizationId,
            requestId: makeProjectReqId("mp4"),
            durationSec: Math.max(0.3, totalSequenceSec),
            brandProjectId: openBrandProjectId,
          }),
        }),
      });
      const reserve = (await reserveRes.json().catch(() => ({ ok: false }))) as Record<string, unknown>;
      if (reserve.ok !== true || typeof reserve.jobId !== "string") {
        setStatus(wc.projects.mp4FailedNotice);
        return;
      }

      const rendered = await exportCompositionMp4(timeline, (r) => setExportingMp4Ratio(r));
      const objectUrl = URL.createObjectURL(rendered.blob);
      triggerBrowserDownload(objectUrl, rendered.filename);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setStatus(interpolate(wc.projects.mp4ExportedNotice, { seconds: rendered.durationSec }));
    } catch {
      setStatus(wc.projects.mp4FailedNotice);
    } finally {
      setExportingMp4Ratio(null);
    }
  }, [canCreate, exportingMp4Ratio, openBrandProjectId, organizationId, timeline, totalSequenceSec, wc.projects.mp4ExportedNotice, wc.projects.mp4FailedNotice]);

  const handleAttachSequenceClipToDock = useCallback(
    (clip: ComposeClip) => {
      if (clip.assetId) {
        const asset = lookup.asset(clip.assetId);
        if (asset) {
          dock.attach(trayItemFromAsset(asset));
          if (railHeight === "full") setRailHeight("compact");
          window.setTimeout(focusPrompt, 0);
          return;
        }
      }
      if (clip.outputId) {
        const output = lookup.output(clip.outputId);
        if (output) {
          dock.attach(trayItemFromOutput(output, clip.label));
          if (railHeight === "full") setRailHeight("compact");
          window.setTimeout(focusPrompt, 0);
          return;
        }
      }
      dock.attach({
        key: clip.assetId ? `a:${clip.assetId}` : `o:${clip.outputId ?? clip.id}`,
        kind: "video",
        name: clip.label,
        url: clip.srcUrl,
        thumbUrl: clip.thumbUrl ?? null,
        width: null,
        height: null,
        seconds: clip.durationSec,
        ...(clip.assetId ? { assetId: clip.assetId } : {}),
        ...(clip.outputId ? { outputId: clip.outputId } : {}),
      });
      if (railHeight === "full") setRailHeight("compact");
      window.setTimeout(focusPrompt, 0);
    },
    [dock, lookup, railHeight],
  );

  const [extendingScene, setExtendingScene] = useState(false);

  const handleExtendNextScene = useCallback(
    async (clip: ComposeClip) => {
      if (!canCreate || extendingScene) return;
      setExtendingScene(true);
      try {
        const keyframes = await extractContinuityFramesInBrowser(
          clip.srcUrl,
          clip.trimStartSec,
          clip.trimEndSec,
          4,
        ).catch(() => []);
        const res = await fetch("/api/brand-studio/post-production", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation: "continuity.plan",
            input: {
              organizationId,
              locale,
              clipDurationSec: Math.max(0.3, clip.trimEndSec - clip.trimStartSec),
              sequenceDurationSec: totalSequenceSec,
              targetNextSeconds: 6,
              ...(clip.assetId ? { assetId: clip.assetId } : {}),
              ...(clip.outputId ? { outputId: clip.outputId } : {}),
              clipLabel: clip.label,
              keyframes,
            },
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; plan?: ContinuityPlan }
          | null;
        if (data?.ok && data.plan) {
          const plan = data.plan;
          let nextTray: TrayItem[] = [];
          for (const ref of plan.referenceRefs) {
            if (ref.kind === "asset") {
              const a = lookup.asset(ref.id);
              if (a) {
                const item = trayItemFromAsset(a);
                nextTray = ref.role === "start_frame" ? withStartFrame(nextTray, item) : [...nextTray, item];
              }
            } else if (ref.kind === "output") {
              const o = lookup.output(ref.id);
              if (o) {
                const item = trayItemFromOutput(o, ref.name);
                nextTray = ref.role === "start_frame" ? withStartFrame(nextTray, item) : [...nextTray, item];
              }
            }
          }
          if (nextTray.length > 0) {
            dock.setTray(nextTray);
          } else {
            handleAttachSequenceClipToDock(clip);
          }
          dock.setDraft((cur) => ({ ...cur, prompt: plan.recommendedPrompt }));
          if (railHeight === "full") setRailHeight("compact");
          window.setTimeout(focusPrompt, 0);
          setStatus(plan.continuityNotes || plan.cameraTransition);
          return;
        }
        handleAttachSequenceClipToDock(clip);
      } catch {
        handleAttachSequenceClipToDock(clip);
      } finally {
        setExtendingScene(false);
      }
    },
    [
      canCreate,
      dock,
      extendingScene,
      handleAttachSequenceClipToDock,
      locale,
      lookup,
      organizationId,
      railHeight,
      totalSequenceSec,
    ],
  );

  const cancel = useCallback(
    async (job: StudioJobView) => {
      setStopping(job.id);
      const res = await studio.cancelJob(job.id);
      setStopping(null);
      setJobNotes((notes) => {
        const { [job.id]: _dropped, ...rest } = notes;
        if (!isFailure(res)) return rest;
        return { ...rest, [job.id]: res.code === "conflict" ? copy.board.cancelLate : errorLine(copy, res.code) };
      });
    },
    [copy, studio],
  );

  const tileAction = (action: TileAction, { output, job }: WallTileItem) => {
    const item: ViewerItem = { type: "output", output, job };
    const key = `o:${output.id}`;
    switch (action) {
      case "open":
        return viewer.show({ list: "outputs", key });
      case "rerun":
        return canRerun(job) ? viewer.rerun(job) : viewer.reuse(job);
      case "reuse":
        return viewer.reuse(job);
      case "review":
        return void onReview({ outputId: output.id }, job.prompt);
      case "campaign":
        return setHandoff({ outputId: output.id });
      case "save":
        return void studio.saveOutput(output.id).then((res) => setStatus(isFailure(res) ? errorLine(copy, res.code) : copy.viewer.saved));
      case "delete":
        return void studio.deleteOutput(output.id).then((res) => {
          if (isFailure(res)) setStatus(res.code === "conflict" ? copy.viewer.deleteBusy : errorLine(copy, res.code));
        });
      case "reference":
        dock.attach(trayItemFromOutput(output, copy.viewer.label));
        if (railHeight === "full") setRailHeight("compact");
        return focusPrompt();
      case "download":
        return void window.open(output.url, "_blank", "noopener,noreferrer");
      default:
        void item;
    }
  };

  const stageToggle = jobs.length > 0 && (
    <div className={w.stageSwitch} role="tablist" aria-label={wc.stageTabs.label} data-video-stage-tabs>
      <button
        type="button"
        role="tab"
        aria-selected={stageTab === "history"}
        className={w.stageTab}
        data-stage-tab="history"
        onClick={() => setStageTab("history")}
      >
        {wc.stageTabs.history}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={stageTab === "guide"}
        className={w.stageTab}
        data-stage-tab="guide"
        onClick={() => setStageTab("guide")}
      >
        {wc.stageTabs.guide}
      </button>
    </div>
  );

  const libraryToggle = (
    <button
      type="button"
      className="bs-btn bs-library-toggle"
      data-variant="soft"
      data-size="sm"
      aria-expanded={sheetOpen}
      aria-controls={railId}
      onClick={() => setSheetOpen(true)}
    >
      {copy.gallery.library}
    </button>
  );

  const head = (
    <>
      {stageToggle}
      {state && effectiveAllowance && effectiveAllowance.capKrw > 0 && (
        <AllowanceLine allowance={effectiveAllowance} copy={copy} locale={locale} />
      )}
      {state && libraryToggle}
    </>
  );

  const examples = EXAMPLES.video;
  const guideSection = (
    <div className="bs-empty" data-studio-empty data-video-guide>
      <section className={w.guideWrap} aria-label={wc.guide.heading}>
        <div className={w.guideHeader}>
          <h2>{wc.guide.heading}</h2>
          <p>{wc.guide.subheading}</p>
        </div>
        <ol className={w.guideGrid}>
          {wc.guide.steps.map((step, idx) => {
            const media = GUIDE_VIDEOS[idx] ?? GUIDE_VIDEOS[0];
            return (
              <li key={step.title} className={w.guideCard} data-video-guide-step={idx + 1}>
                <div className={w.guideMedia}>
                  <video
                    className={w.guideVideo}
                    src={media.src}
                    poster={media.poster}
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                  />
                </div>
                <div className={w.guideCardBody}>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <span className={w.guideTag}>{step.tag}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {dockOpen ? (
        <div className="bs-examples-block">
          <p>{copy.board.emptyBody}</p>
          <ul className="bs-examples" data-studio-examples>
            {examples.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="bs-example"
                  onClick={() => {
                    dock.setDraft((current) => ({ ...current, prompt: copy.board.examples[key] }));
                    setStageTab("history");
                    if (railHeight === "full") setRailHeight("compact");
                    focusPrompt();
                  }}
                >
                  {copy.board.examples[key]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : canCreate ? null : (
        // Closed for someone who can create: the banner below (ClosedAllowanceBanner) says it, once.
        <p className="bs-muted">{copy.board.emptyReadOnly}</p>
      )}
    </div>
  );

  const handoffKind = handoff
    ? ((("assetId" in handoff ? lookup.asset(handoff.assetId)?.kind : lookup.output(handoff.outputId)?.kind) === "video"
        ? "video"
        : "image") as "image" | "video")
    : "video";
  const loading = studio.store.phase === "loading" && !state;
  const dockCollapsed = railHeight === "full";
  // The folded prompt bar takes the same drops as the open one (same attach and upload path), and says so.
  const pillDrag = usePageDrag(Boolean(dockOpen && dockCollapsed), acceptsDrag);
  const [pillOver, setPillOver] = useState(false);

  return (
    <div
      className={`bs-studio ${w.videoRoot}`}
      data-video-studio-workspace
      data-studio-mode="video"
      data-studio-phase={studio.store.phase}
      data-studio-can-create={canCreate ? "" : undefined}
    >
      <div className="bs-main">
        {headSlot ? createPortal(head, headSlot) : <div className="bs-toolbar">{head}</div>}

        {state && (
          <VideoProjectBar
            canEdit={canCreate}
            projectId={projectId}
            projectTitle={projectTitle}
            projectStatus={projectStatus}
            savingProject={savingProject}
            projects={visibleProjects}
            clipCount={timeline.clips.length}
            railHeight={railHeight}
            solidMp4Cta={dockOpen && dockCollapsed}
            exportingNle={exportingNle}
            exportingMp4Ratio={exportingMp4Ratio}
            canSendClipToOtherProject={timeline.clips.length > 0}
            copy={projectsCopy}
            onSelectProject={(id) => void loadProjectsFromServer(id)}
            onStartNewProject={handleStartNewProject}
            onRenameTitle={handleRenameProject}
            onToggleComplete={() => void handleToggleProjectComplete()}
            onDeleteProject={() => void handleDeleteProject()}
            onSendClipToProject={(targetId) => void handleSendClipToExistingProject(targetId)}
            onSelectLayoutPreset={(preset) => setRailHeight(preset === "edit" ? "full" : "compact")}
            onShareReview={handleBarShareReview}
            onExportNle={() => void handleBarExportNle()}
            onExportMp4={() => void handleBarExportMp4()}
          />
        )}

        {state && canCreate && latestReadyVideoOutput && railHeight !== "full" && (
          <div className={w.quickOutputBar} data-video-quick-sequence-bar>
            <span className={w.quickOutputInfo}>{latestReadyVideoOutput.label.slice(0, 56)}</span>
            <div className={w.quickOutputActions}>
              <button
                type="button"
                className={w.barActionBtn}
                onClick={() =>
                  addVideoOutputToSequence(latestReadyVideoOutput.output, latestReadyVideoOutput.label)
                }
                data-video-add-to-sequence
              >
                {wc.projects.addToSequence}
              </button>
              {selectedClipId && timeline.clips.some((c) => c.id === selectedClipId) && (
                <button
                  type="button"
                  className={w.barActionBtn}
                  onClick={() =>
                    addVideoOutputToSequence(latestReadyVideoOutput.output, latestReadyVideoOutput.label, {
                      stackIntoClipId: selectedClipId,
                    })
                  }
                  data-video-stack-take
                >
                  {wc.projects.stackAsTake}
                </button>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className="bs-skeleton" aria-busy="true" data-studio-skeleton>
            <span className="bs-sr" role="status">
              {copy.state.loading}
            </span>
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
        {studio.store.phase === "failed" && (
          <div className="bs-banner" role="alert" data-studio-load-failed>
            <p>
              {copy.state.loadFailed} {errorLine(copy, studio.store.code)}
            </p>
            <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => void studio.load()}>
              {copy.state.retry}
            </button>
          </div>
        )}
        {state &&
          railHeight !== "full" &&
          (jobs.length > 0 && stageTab === "guide" ? (
            <div className={w.guideStage}>{guideSection}</div>
          ) : (
            <Wall
              mode="video"
              jobs={jobs}
              sending={sending}
              copy={copy}
              locale={locale}
              canGenerate={dockOpen}
              canEdit={canCreate}
              canStop={canCreate}
              stopping={stopping}
              notes={jobNotes}
              library={library}
              parentOf={parentOf}
              onAction={tileAction}
              onRetry={(job) => (canRerun(job) ? viewer.rerun(job) : viewer.reuse(job))}
              onCancel={(job) => void cancel(job)}
              canRemove={canCreate && Boolean(state?.canRemoveRuns)}
              onRemove={(job) => studio.deleteJob(job.id).then((result) => setStatus(isFailure(result) ? copy.gallery.removeFailedError : null))}
              {...(spineActive && spineCtx?.canCreate ? { onMoveJobs: (ids: string[], opener?: HTMLElement | null) => setMoveRequest({ jobIds: ids, opener: opener ?? null }) } : {})}
              onNotice={setStatus}
              empty={guideSection}
            />
          ))}
        <p className={state && dockOpen ? "bs-sr" : "bs-notice"} role="status" aria-live="polite" data-studio-status={status ? "" : undefined}>
          {status}
        </p>

        {state && (
          <div className={w.videoBottomStack} data-video-bottom-stack>
            <SequenceRail
              organizationId={organizationId}
              organizationName={organizationName}
              locale={locale}
              canEdit={canCreate}
              project={timeline}
              railHeight={railHeight}
              selectedClipId={selectedClipId}
              inspectorTab={inspectorTab}
              audioAssets={audioAssets}
              allowance={effectiveAllowance ?? state.allowance}
              billingCopy={billingCopy}
              planCatalogue={planCatalogue}
              extendingScene={extendingScene}
              musicGeneration={musicGeneration}
              {...(openBrandProjectId ? { brandProjectId: openBrandProjectId } : {})}
              railCopy={wc.rail}
              floatingCopy={wc.floatingBar}
              onHeightChange={setRailHeight}
              onSelectClip={setSelectedClipId}
              onInspectorTabChange={setInspectorTab}
              onProjectChange={commitTimeline}
              onAttachClipToDock={handleAttachSequenceClipToDock}
              onExtendNextScene={(clip) => void handleExtendNextScene(clip)}
              onLocalVideoFiles={(files) => void handleLocalSequenceFiles(files)}
              onNotice={setStatus}
              onAllowanceUpdate={setAllowanceOverride}
            />

            {dockOpen && (
              dockCollapsed ? (
                <div className={w.collapsedDockWrap}>
                  <button
                    type="button"
                    className={w.collapsedDockPill}
                    onClick={() => {
                      setRailHeight("compact");
                      window.setTimeout(focusPrompt, 0);
                    }}
                    data-video-expand-dock
                    data-drop-ready={pillDrag && !pillOver ? "" : undefined}
                    data-drop-target={pillDrag && pillOver ? "" : undefined}
                    onDragOver={(event) => {
                      if (!acceptsDrag(event.dataTransfer?.types)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                      if (!pillOver) setPillOver(true);
                    }}
                    onDragLeave={() => setPillOver(false)}
                    onDrop={(event) => {
                      if (!acceptsDrag(event.dataTransfer?.types)) return;
                      event.preventDefault();
                      setPillOver(false);
                      setRailHeight("compact");
                      const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
                      if (source) attachSource(source);
                      else if (event.dataTransfer.files.length) void uploadFiles(Array.from(event.dataTransfer.files), true);
                    }}
                  >
                    {pillDrag ? copy.tray.drop : wc.projects.expandDock}
                  </button>
                </div>
              ) : (
                <Dock
                  organizationId={organizationId}
                  organizationName={organizationName}
                  mode="video"
                  draft={dock.draft}
                  tray={dock.tray}
                  labels={trayLabels(dock.tray, copy)}
                  copy={copy}
                  locale={locale}
                  billingCopy={billingCopy}
                  planCatalogue={planCatalogue}
                  allowance={effectiveAllowance ?? state.allowance}
                  credits={dockCredits(dock.draft, dock.tray)}
                  busy={dock.busy}
                  message={dock.message}
                  errorCode={dock.errorCode}
                  notice={dock.notice}
                  toast={status}
                  film={remixVideo?.assetId ? (studio.films[remixVideo.assetId] ?? null) : null}
                  uploading={studio.uploads.map((u) => u.name)}
                  enhancing={dock.enhancing}
                  enhanced={dock.enhanced}
                  videoCopy={videoCopy}
                  availableAssets={assets}
                  recentOutputs={recentOutputs}
                  onAttachItem={dock.attach}
                  onTrimVideo={openTrimForTrayItem}
                  onDraft={dock.setDraft}
                  onTrayUpdate={dock.update}
                  onTrayRemove={dock.remove}
                  onTrayMove={dock.move}
                  onSubmit={() => {
                    setStatus(null);
                    const trayAssetIds = dock.tray
                      .map((t) => t.assetId)
                      .filter((id): id is string => typeof id === "string" && id.length > 0);
                    const submittedPrompt = dock.draft.prompt || dock.draft.change || "";
                    const context = projectContextRef.current;

                    // Lazy Create ("첫 생성 제출 또는 첫 클립 추가 시"): the project is made, and the references
                    // recorded on it, only once a run was accepted. A press the bar refuses (empty prompt, unknown
                    // mention, two reference videos …) or the server refuses leaves no project and no `?project=`.
                    // Runs carry no video-project id, so making it right after the accepted run changes nothing
                    // for the run; its clip joins the sequence when it lands, as before. If another project was
                    // opened (or a new one started) meanwhile, nothing is recorded for this press.
                    void dock.submit().then((started) => {
                      if (!started) return;
                      setStageTab("history");
                      setStatus(copy.state.started);
                      if (projectContextRef.current !== context) return;
                      const known = timelineRef.current;
                      const refsChanged = addProjectReferenceAssetIds(known, trayAssetIds) !== known;
                      setTimeline((prev) => addProjectReferenceAssetIds(prev, trayAssetIds));
                      setAfterRun({ firstPrompt: submittedPrompt, context, refsChanged });
                    });
                  }}
                  onDropSource={attachSource}
                  onFiles={(files) => void uploadFiles(files, true)}
                  onBrowse={() => {
                    setSheetOpen(true);
                    document.getElementById(searchId)?.focus();
                  }}
                  onEnhance={() => void dock.enhanceNow()}
                  onUndoEnhance={dock.undoEnhance}
                />
              )
            )}
          </div>
        )}

        {state && canCreate && !dockOpen && (
          <ClosedAllowanceBanner organizationId={organizationId} organizationName={organizationName} dockCopy={copy.dock} billingCopy={billingCopy} planCatalogue={planCatalogue} locale={locale} surface="studio_video" />
        )}
        {state && !canCreate && (
          <p className="bs-readonly" data-studio-read-only>
            {copy.dock.readOnly}
          </p>
        )}
      </div>

      <div ref={railSlot} className={`bs-rail-slot ${w.videoRailSlot}`} data-studio-rail-slot>
        {state && (
          <>
            <RecentCreationsPanel
              allJobs={allJobs}
              canEdit={canCreate}
              copy={wc.drawer}
              onAttachOutput={(output, label) => {
                dock.attach(trayItemFromOutput(output, label));
                if (railHeight === "full") setRailHeight("compact");
                focusPrompt();
              }}
              onAddVideoToSequence={(output, label) => addVideoOutputToSequence(output, label)}
            />
            <LibraryRail
              id={railId}
              organizationId={organizationId}
              locale={locale}
              library={library}
              assets={assets}
              outputOf={(id: string): StudioOutputView | null => findOutput(allJobs, id)}
              canCreate={canCreate}
              attachOnPress={dockOpen}
              open={sheetOpen}
              notice={panelNotice}
              uploading={studio.uploads.map((u) => u.name)}
              searchId={searchId}
              onClose={() => setSheetOpen(false)}
              onAttach={(source) => {
                attachSource(source);
                setSheetOpen(false);
                if (railHeight === "full") setRailHeight("compact");
                focusPrompt();
              }}
              onView={(source) =>
                viewer.show("assetId" in source ? { list: "assets", key: `a:${source.assetId}` } : { list: "outputs", key: `o:${source.outputId}` })
              }
              onFiles={(files) => void uploadFiles(files, false)}
              onUpdate={(assetId, patch) => studio.updateAsset({ assetId, ...patch })}
              onDelete={studio.deleteAsset}
              copy={libraryCopy}
            />
          </>
        )}
      </div>

      {viewer.open && viewer.index >= 0 && (
        <Viewer
          items={viewer.items}
          index={viewer.index}
          copy={copy}
          locale={locale}
          organizationId={organizationId}
          organizationName={organizationName}
          billingCopy={billingCopy}
          planCatalogue={planCatalogue}
          allowance={effectiveAllowance ?? state?.allowance ?? null}
          canCreate={canCreate}
          canGenerate={dockOpen}
          busy={viewer.busy}
          notice={viewer.notice}
          regionPreset={viewer.preset}
          revise={viewer.revise}
          region={null}
          parentOf={parentOf}
          parentAssetOf={parentAssetOf}
          onIndex={(index) => {
            const item = viewer.items[index];
            if (item && viewer.open) viewer.show({ list: viewer.open.list, key: itemKey(item) });
          }}
          onClose={() => viewer.show(null)}
          actions={viewer.actions}
        />
      )}

      {handoff && state && (
        <HandoffDialog
          campaigns={state.campaigns}
          copy={copy}
          kind={handoffKind}
          onSend={(choice, requestId, asFormat) => studio.handoff(handoffInput(handoff, choice, { organizationId, requestId }, asFormat))}
          onDone={(href) => window.location.assign(href)}
          onClose={() => setHandoff(null)}
        />
      )}

      {shareTarget && (
        <ShareReviewDialog
          target={shareTarget}
          locale={locale}
          onClose={() => setShareTarget(null)}
        />
      )}

      <ReversePanel
        organizationId={organizationId}
        locale={locale}
        copy={copy}
        video={videoCopy}
        // `?start=reverse` (a link from the asset hub or the prompt bar, with or without `&asset=`): open once on arrival. The panel
        // reads this only as its first state, so a state refresh never reopens it after it was closed.
        initialOpen={initialCreateMode === "blueprint"}
        initialAssetId={remixVideo?.assetId ?? initialAssetId}
        api={reverseApi}
      />

      {trimModalClip && (
        <ClipTrimModal
          asset={trimModalClip}
          copy={wc.trimModal}
          minSeconds={videoModel.referenceVideoSeconds.editMin}
          maxSeconds={videoModel.referenceVideoSeconds.max}
          onSkip={(original) => {
            replaceVideoInTray(original);
            setTrimModalClip(null);
          }}
          onUploadTrimmed={uploadTrimmedClip}
          onApply={({ asset: nextAsset, fallbackNotice }) => {
            replaceVideoInTray(nextAsset);
            if (fallbackNotice) setStatus(fallbackNotice);
            setTrimModalClip(null);
          }}
          onClose={() => setTrimModalClip(null)}
        />
      )}

      {moveRequest && spineCtx && (
        <MoveToProjectDialog
          projects={spineCtx.projects}
          currentScope={spineCtx.open}
          jobIds={moveRequest.jobIds}
          locale={locale}
          copy={spineCtx.copy}
          returnFocus={() => moveRequest.opener}
          onMove={studio.moveToBrandProject}
          onMoved={({ toast, removedJobIds }) => {
            if (removedJobIds.length) studio.removeJobs(removedJobIds);
            setStatus(toast);
          }}
          onClose={() => setMoveRequest(null)}
        />
      )}
    </div>
  );
}
