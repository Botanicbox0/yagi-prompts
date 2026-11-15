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
  composeFinalRenderCredits,
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
import { formatCredits } from "@/lib/brand-studio/credits";
import type { StudioVideoModel } from "@/lib/brand-studio/models";
import type { VideoProjectDetail, VideoProjectStatus, VideoProjectSummary } from "@/lib/brand-studio/video-projects";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { createStudioApi, isFailure, measureInBrowser, uploadProblem, type StudioApi } from "../api";
import { EXAMPLES, jobsFor } from "../board";
import { errorLine, fill as interpolate, type StudioCopy, type StudioLocale } from "../copy";
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
  trayItemFromAsset,
  trayItemFromOutput,
  trayLabels,
  withStartFrame,
  type RefSource,
  type TrayItem,
} from "../refs";
import { ShareReviewDialog, useShareReviewEvent, type ShareReviewTarget } from "../share-review-dialog";
import { STUDIO_JOB_STARTED } from "../seams";
import { findOutput } from "../store";
import { useDock } from "../use-dock";
import { useStudio } from "../use-studio";
import { sourceOf, useViewer } from "../use-viewer";
import { Viewer, canRerun, itemKey, type ViewerItem } from "../viewer";
import { ClipTrimModal } from "./clip-trim-modal";
import { VideoProjectBar } from "./project-bar";
import { RecentCreationsPanel } from "./recent-creations-panel";
import { ReversePanel } from "./reverse";
import { fillText } from "./reverse-model";
import { SequenceRail, type SequenceInspectorTab, type SequenceRailHeight } from "./sequence-rail";
import w from "./video-workspace.module.css";
import { validateVideoEditDurationSeconds } from "./workspace-model";

export interface VideoStudioWorkspaceProps {
  organizationId: string;
  locale: StudioLocale;
  copy: StudioCopy;
  libraryCopy: Dictionary["studioLibrary"];
  videoCopy: StudioVideoCopy;
  initialTab?: "create" | "edit";
  initialCreateMode?: "prompt" | "blueprint";
  initialAssetId?: string | null;
  initialProjectId?: string | null;
  initialRailHeight?: SequenceRailHeight;
  initialTimeline?: ComposerProject | null;
  initialSelectedClipId?: string | null;
  initialState?: StudioState | null;
  api?: StudioApi;
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

function syncProjectUrlParam(projectId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (projectId) {
      url.searchParams.set("project", projectId);
    } else {
      url.searchParams.delete("project");
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
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
  locale,
  copy,
  libraryCopy,
  videoCopy,
  initialTab = "create",
  initialCreateMode = "prompt",
  initialAssetId = null,
  initialProjectId = null,
  initialRailHeight = "compact",
  initialTimeline = null,
  initialSelectedClipId = null,
  initialState = null,
  api,
}: VideoStudioWorkspaceProps) {
  const wc = videoCopy.workspace;
  const clientApi = useMemo(() => api ?? createStudioApi({ organizationId }), [api, organizationId]);
  const studio = useStudio({ organizationId, initialState, api: clientApi });
  const dock = useDock({ studio, copy, organizationId, initialMedium: "video", mode: "video" });
  const library = useStudioLibrary(organizationId);
  const state = studio.store.state;
  const allJobs = useMemo(() => state?.jobs ?? [], [state?.jobs]);
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
  const [sheetOpen, setSheetOpen] = useState(false);

  // Lazy server-persisted Video Project & 3-Height Sequence Rail state
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [projectTitle, setProjectTitle] = useState<string>(wc.projects.untitled);
  const [projectStatus, setProjectStatus] = useState<VideoProjectStatus>("active");
  const [projectRevision, setProjectRevision] = useState<number>(1);
  const [savingProject, setSavingProject] = useState(false);
  const [timeline, setTimeline] = useState<ComposerProject>(
    () => initialTimeline ?? emptyComposerProject("9:16"),
  );
  const [railHeight, setRailHeight] = useState<SequenceRailHeight>(initialRailHeight);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(initialSelectedClipId);
  const [inspectorTab, setInspectorTab] = useState<SequenceInspectorTab>("color");
  const [exportingNle, setExportingNle] = useState(false);
  const [exportingMp4Ratio, setExportingMp4Ratio] = useState<number | null>(null);

  const lazyCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  const lazyRequestIdRef = useRef<string>(makeProjectReqId("vp"));
  const revisionRef = useRef<number>(1);
  const projectIdRef = useRef<string | null>(initialProjectId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localBlobUrlsRef = useRef<string[]>([]);

  // Track jobs started in this session for automatic Sequence Rail append or Take Stack (`1/N`)
  const knownJobIdsRef = useRef<Set<string> | null>(null);
  const sessionJobTargetClipRef = useRef<Map<string, string | null>>(new Map());
  const ingestedOutputIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    revisionRef.current = projectRevision;
  }, [projectRevision]);

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

  const applyLoadedProject = useCallback((detail: VideoProjectDetail) => {
    setProjectId(detail.id);
    projectIdRef.current = detail.id;
    setProjectTitle(detail.title);
    setProjectStatus(detail.status);
    setProjectRevision(detail.revision);
    revisionRef.current = detail.revision;
    setTimeline(detail.timeline);
    setSelectedClipId(detail.timeline.clips[0]?.id ?? null);
    syncProjectUrlParam(detail.id);
  }, []);

  const loadProjectsFromServer = useCallback(
    async (targetId?: string | null) => {
      if (typeof fetch !== "function") return;
      try {
        const q = new URLSearchParams({ organizationId });
        if (targetId) q.set("projectId", targetId);
        const res = await fetch(`/api/brand-studio/video-projects?${q.toString()}`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          projects?: VideoProjectSummary[];
          project?: VideoProjectDetail | null;
        };
        if (!data.ok) return;
        if (Array.isArray(data.projects)) setProjects(data.projects);
        if (data.project) applyLoadedProject(data.project);
      } catch {
        // Offline / pure unit test environment without fetch handler
      }
    },
    [applyLoadedProject, organizationId],
  );

  const initialProjectsLoadedRef = useRef(false);
  useEffect(() => {
    if (initialProjectsLoadedRef.current) return;
    initialProjectsLoadedRef.current = true;
    let urlProjectId = initialProjectId;
    if (!urlProjectId && typeof window !== "undefined") {
      try {
        const p = new URL(window.location.href).searchParams.get("project");
        if (p && /^[0-9a-f-]{36}$/i.test(p)) urlProjectId = p;
      } catch {
        // Ignore
      }
    }
    void loadProjectsFromServer(urlProjectId);
  }, [initialProjectId, loadProjectsFromServer]);

  const ensureLazyProjectCreated = useCallback(
    async (opts: {
      nextTimeline: ComposerProject;
      firstPrompt?: string;
      explicitTitle?: string;
    }): Promise<string | null> => {
      if (projectIdRef.current) return projectIdRef.current;
      if (!canCreate || typeof fetch !== "function") return null;
      if (lazyCreatePromiseRef.current) return lazyCreatePromiseRef.current;

      const persistable = sanitizeProjectForPersistence(opts.nextTimeline);
      const promise = (async () => {
        setSavingProject(true);
        try {
          const res = await fetch("/api/brand-studio/video-projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              op: "create",
              organizationId,
              requestId: lazyRequestIdRef.current,
              ...(opts.explicitTitle ? { title: opts.explicitTitle } : {}),
              ...(opts.firstPrompt ? { firstPrompt: opts.firstPrompt } : {}),
              locale,
              aspect: persistable.aspect,
              timeline: persistable,
            }),
          });
          if (!res.ok) return null;
          const data = (await res.json()) as { ok?: boolean; project?: VideoProjectDetail };
          if (!data.ok || !data.project) return null;
          const created = data.project;
          setProjectId(created.id);
          projectIdRef.current = created.id;
          setProjectTitle(created.title);
          setProjectStatus(created.status);
          setProjectRevision(created.revision);
          revisionRef.current = created.revision;
          setProjects((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
          syncProjectUrlParam(created.id);
          return created.id;
        } catch {
          return null;
        } finally {
          setSavingProject(false);
          lazyCreatePromiseRef.current = null;
        }
      })();

      lazyCreatePromiseRef.current = promise;
      return promise;
    },
    [canCreate, locale, organizationId],
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

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const persistable = sanitizeProjectForPersistence(nextTimeline);
        setSavingProject(true);
        void fetch("/api/brand-studio/video-projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            op: "save",
            organizationId,
            projectId: pid,
            ...(nextTitle ? { title: nextTitle } : {}),
            aspect: persistable.aspect,
            timeline: persistable,
            expectedRevision: revisionRef.current,
          }),
        })
          .then(async (res) => {
            const data = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              project?: VideoProjectDetail;
              code?: string;
              currentRevision?: number;
            };
            if (data.ok && data.project) {
              setProjectRevision(data.project.revision);
              revisionRef.current = data.project.revision;
              setProjectTitle(data.project.title);
              setProjects((prev) => [data.project!, ...prev.filter((p) => p.id !== data.project!.id)]);
            } else if (data.code === "conflict" && typeof data.currentRevision === "number") {
              revisionRef.current = data.currentRevision;
              setProjectRevision(data.currentRevision);
            }
          })
          .catch(() => {})
          .finally(() => setSavingProject(false));
      }, 600);
    },
    [canCreate, ensureLazyProjectCreated, organizationId],
  );

  const commitTimeline = useCallback(
    (next: ComposerProject) => {
      setTimeline(next);
      scheduleProjectSave(next);
    },
    [scheduleProjectSave],
  );

  const handleStartNewProject = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    lazyRequestIdRef.current = makeProjectReqId("vp");
    setProjectId(null);
    projectIdRef.current = null;
    setProjectTitle(wc.projects.untitled);
    setProjectStatus("active");
    setProjectRevision(1);
    revisionRef.current = 1;
    setTimeline(emptyComposerProject("9:16"));
    setSelectedClipId(null);
    syncProjectUrlParam(null);
  }, [wc.projects.untitled]);

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
          setStatus(wc.projects.projectCompletedNotice);
        }
      }
    } finally {
      setSavingProject(false);
    }
  }, [canCreate, organizationId, projectStatus, wc.projects.projectCompletedNotice]);

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
          setStatus(interpolate(wc.projects.sentToProject, { title: savedJson.project.title }));
        }
      } catch {
        // Ignore network errors
      }
    },
    [canCreate, organizationId, selectedClipId, timeline.clips, wc.projects.sentToProject],
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
            addVideoOutputToSequence(out, j.prompt || wc.projects.untitled, {
              stackIntoClipId: targetClipId,
            });
          }
        }
        sessionJobTargetClipRef.current.delete(j.id);
      }
    }
  }, [addVideoOutputToSequence, jobs, selectedClipId, state, wc.projects.untitled]);

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
        if (output.kind === "video") return { output, label: job.prompt || wc.projects.untitled };
      }
    }
    return null;
  }, [jobs, wc.projects.untitled]);

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

  const uploadFiles = useCallback(
    async (files: File[], attach: boolean) => {
      const say = attach ? dock.setMessage : setPanelNotice;
      say(null);
      await Promise.all(
        files.map(async (file) => {
          const problem = uploadProblem(file);
          if (problem) return say(errorLine(copy, problem));
          const result = await studio.upload(file);
          if (isFailure(result)) return say(errorLine(copy, result.code));
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
        dock.setMessage(errorLine(copy, problem));
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
        dock.setMessage(errorLine(copy, res.code));
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
  const mp4RenderCredits = useMemo(
    () => composeFinalRenderCredits(Math.max(1, totalSequenceSec || 5)),
    [totalSequenceSec],
  );

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
        projectTitle: projectTitle || wc.projects.untitled,
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
  }, [exportingNle, projectTitle, timeline, wc.projects.nleExportedNotice, wc.projects.nleFailedNotice, wc.projects.untitled]);

  const handleBarExportMp4 = useCallback(async () => {
    if (!canCreate || timeline.clips.length === 0 || exportingMp4Ratio !== null) return;
    setExportingMp4Ratio(0.02);
    let reservedJobId: string | null = null;
    let creditsUsed = mp4RenderCredits;

    try {
      const reserveRes = await fetch("/api/brand-studio/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operation: "render.reserve",
          input: {
            organizationId,
            requestId: makeProjectReqId("mp4"),
            durationSec: Math.max(0.3, totalSequenceSec),
          },
        }),
      });
      const reserve = (await reserveRes.json().catch(() => ({ ok: false }))) as Record<string, unknown>;
      if (reserve.ok !== true || typeof reserve.jobId !== "string") {
        setStatus(wc.projects.mp4FailedNotice);
        return;
      }
      reservedJobId = reserve.jobId;
      if (typeof reserve.creditsUsed === "number") creditsUsed = reserve.creditsUsed;
      if (reserve.allowance && typeof reserve.allowance === "object") {
        setAllowanceOverride(reserve.allowance as StudioAllowanceView);
      }

      const rendered = await exportCompositionMp4(timeline, (r) => setExportingMp4Ratio(r));
      const objectUrl = URL.createObjectURL(rendered.blob);
      triggerBrowserDownload(objectUrl, rendered.filename);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setStatus(
        interpolate(wc.projects.mp4ExportedNotice, {
          seconds: rendered.durationSec,
          credits: formatCredits(creditsUsed, locale),
        }),
      );
    } catch {
      if (reservedJobId) {
        try {
          const refundRes = await fetch("/api/brand-studio/compose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              operation: "render.refund",
              input: { organizationId, jobId: reservedJobId },
            }),
          });
          const refund = (await refundRes.json().catch(() => ({}))) as Record<string, unknown>;
          if (refund.ok === true && refund.allowance && typeof refund.allowance === "object") {
            setAllowanceOverride(refund.allowance as StudioAllowanceView);
          }
        } catch {
          // Best-effort refund
        }
      }
      setStatus(wc.projects.mp4FailedNotice);
    } finally {
      setExportingMp4Ratio(null);
    }
  }, [canCreate, exportingMp4Ratio, locale, mp4RenderCredits, organizationId, timeline, totalSequenceSec, wc.projects.mp4ExportedNotice, wc.projects.mp4FailedNotice]);

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
      ) : (
        <p className="bs-muted">{canCreate ? copy.dock.closedBody : copy.board.emptyReadOnly}</p>
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
            locale={locale}
            canEdit={canCreate}
            projectId={projectId}
            projectTitle={projectTitle}
            projectStatus={projectStatus}
            savingProject={savingProject}
            projects={projects}
            clipCount={timeline.clips.length}
            renderCredits={mp4RenderCredits}
            railHeight={railHeight}
            solidMp4Cta={dockOpen && dockCollapsed}
            exportingNle={exportingNle}
            exportingMp4Ratio={exportingMp4Ratio}
            canSendClipToOtherProject={timeline.clips.length > 0}
            copy={wc.projects}
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
              locale={locale}
              canEdit={canCreate}
              project={timeline}
              railHeight={railHeight}
              selectedClipId={selectedClipId}
              inspectorTab={inspectorTab}
              audioAssets={audioAssets}
              extendingScene={extendingScene}
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
                  >
                    {wc.projects.expandDock}
                  </button>
                </div>
              ) : (
                <Dock
                  mode="video"
                  draft={dock.draft}
                  tray={dock.tray}
                  labels={trayLabels(dock.tray, copy)}
                  copy={copy}
                  locale={locale}
                  allowance={effectiveAllowance ?? state.allowance}
                  credits={dockCredits(dock.draft, dock.tray)}
                  busy={dock.busy}
                  message={dock.message}
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
                    const nextTimeline = addProjectReferenceAssetIds(timeline, trayAssetIds);
                    if (nextTimeline !== timeline) setTimeline(nextTimeline);
                    const submittedPrompt = dock.draft.prompt || dock.draft.change || "";
                    void ensureLazyProjectCreated({
                      nextTimeline,
                      firstPrompt: submittedPrompt,
                    }).then((pid) => {
                      if (pid && nextTimeline !== timeline) {
                        scheduleProjectSave(nextTimeline);
                      }
                    });

                    void dock.submit().then((started) => {
                      if (started) {
                        setStageTab("history");
                        setStatus(copy.state.started);
                      }
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
          <section className="bs-closed" data-studio-allowance-closed>
            <h2>{copy.dock.closedTitle}</h2>
            <p>{copy.dock.closedBody}</p>
            <button type="button" className="bs-btn" data-variant="solid" data-size="md" onClick={openSupport}>
              {copy.dock.closedAction}
            </button>
          </section>
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
        initialOpen={false}
        initialAssetId={remixVideo?.assetId ?? initialAssetId}
        api={clientApi}
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
    </div>
  );
}
