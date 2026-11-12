"use client";
/**
 * Video Studio 2-column workspace (Bundle C, docs/BRAND-STUDIO-VIDEO-C.md):
 *   - Left control panel: `영상 만들기` (`문장·참조로 만들기` | `설계도로 재현`) and `영상 편집` (Seedance-based
 *     4–30s clip edit with segment & crop modal, up to 9 reference images, `@` asset mentions, sound, resolution).
 *   - Right stage: `기록` (video wall + viewer + 1080p final + campaign handoff) | `사용 방법` (3-step visual guide)
 *     plus the collapsible `LibraryRail`.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import {
  STUDIO_AUDIO_MODES,
  STUDIO_KEEP_KEYS,
  STUDIO_LIMITS,
  STUDIO_UPLOAD_MIMES,
  type StudioAssetView,
  type StudioJobView,
  type StudioOutputView,
  type StudioState,
} from "@/lib/brand-studio/contracts";
import { formatCredits } from "@/lib/brand-studio/credits";
import { selectableModels, type StudioVideoModel, type StudioVideoResolution } from "@/lib/brand-studio/models";
import { remakeSeconds } from "@/lib/brand-studio/reference-video";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { createStudioApi, isFailure, measureInBrowser, uploadKind, uploadProblem, type StudioApi } from "../api";
import { EXAMPLES, jobsFor } from "../board";
import { credits as formatCreditLine, errorLine, fill, newRequestId, type StudioCopy, type StudioLocale } from "../copy";
import { AllowanceLine, Tip } from "../dock";
import { DRAFT_RESOLUTION, dockControls, dockCredits, withMedium, withModel, type EnhancePreviewInput } from "../dock-model";
import { ModelMenu, modelHint } from "../gallery/model-menu";
import { Wall, type SendingTile, type TileAction, type WallTileItem } from "../gallery/wall";
import { HandoffDialog, handoffInput } from "../handoff-dialog";
import { StudioIcon } from "../icons";
import { useModal } from "../modal";
import { LibraryRail } from "../rail";
import { useStudioLibrary } from "../rail/use-library";
import {
  REF_DRAG_TYPE,
  acceptsDrag,
  addToTray,
  decodeRefDrag,
  mentionLabel,
  removeFromTray,
  trayItemFromAsset,
  trayItemFromOutput,
  trayNumbers,
  withStartFrame,
  type RefSource,
  type TrayItem,
} from "../refs";
import { STUDIO_JOB_STARTED, STUDIO_OPEN_REVERSE, announce } from "../seams";
import { findOutput } from "../store";
import { isPreEnhanced, useDock, type Enhanced } from "../use-dock";
import { useStudio } from "../use-studio";
import { useViewer } from "../use-viewer";
import { Viewer, canRerun, itemKey, type ViewerItem } from "../viewer";
import { ClipTrimModal } from "./clip-trim-modal";
import { ReversePanel } from "./reverse";
import {
  CHANGE_SLOTS,
  aspectFor,
  buildReverseJob,
  clipNotice,
  defaultKeep,
  draftCredits,
  emptyDraft as emptyBlueprintDraft,
  fillText,
  imageNumbers,
  reverseModel,
  tableOf,
  type ChangeSlot,
  type ReadState,
  type ReverseDraft,
} from "./reverse-model";
import w from "./video-workspace.module.css";
import {
  buildVideoEditJob,
  checkVideoEditClip,
  defaultVideoEditDraft,
  detectAtMentionQuery,
  insertAssetMention,
  validateVideoEditDurationSeconds,
  videoEditCredits,
  type VideoEditDraft,
  type VideoEditProblem,
} from "./workspace-model";

export interface VideoStudioWorkspaceProps {
  organizationId: string;
  locale: StudioLocale;
  copy: StudioCopy;
  libraryCopy: Dictionary["studioLibrary"];
  videoCopy: StudioVideoCopy;
  initialTab?: "create" | "edit";
  initialCreateMode?: "prompt" | "blueprint";
  initialAssetId?: string | null;
  initialState?: StudioState | null;
  api?: StudioApi;
}

function parseRefParam(value: string | null): RefSource | null {
  const match = /^([ao]):([0-9a-f-]{36})$/i.exec(value ?? "");
  if (!match) return null;
  return match[1] === "a" ? { assetId: match[2]! } : { outputId: match[2]! };
}

function useHeadSlot() {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => setSlot(document.querySelector("[data-studio-head-slot]")), []);
  return slot;
}

const GUIDE_VIDEOS = [
  { src: "/reel/landing/v7/rx-beauty-orig.mp4", poster: "/reel/landing/v7/rx-beauty-orig.jpg" },
  { src: "/reel/landing/v7/rx-beauty-world.mp4", poster: "/reel/landing/v7/rx-beauty-world.jpg" },
  { src: "/reel/brands/production-paris.mp4", poster: "/reel/brands/production-paris.jpg" },
] as const;

type AssetPickerTarget =
  | { kind: "startFrame" }
  | { kind: "endFrame" }
  | { kind: "createRefs" }
  | { kind: "editVideo" }
  | { kind: "editRefs" }
  | { kind: "blueprintVideo" }
  | { kind: "blueprintSlot"; slot: ChangeSlot };

export function VideoStudioWorkspace({
  organizationId,
  locale,
  copy,
  libraryCopy,
  videoCopy,
  initialTab = "create",
  initialCreateMode = "prompt",
  initialAssetId = null,
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
  const imageAssets = useMemo(() => assets.filter((a) => a.kind === "image"), [assets]);
  const videoAssets = useMemo(() => assets.filter((a) => a.kind === "video"), [assets]);
  const canCreate = state?.canCreate ?? false;
  const runOpen = canCreate && (state?.allowance.capKrw ?? 0) > 0;

  // Navigation & panel modes
  const [tab, setTab] = useState<"create" | "edit">(initialTab);
  const [createMode, setCreateMode] = useState<"prompt" | "blueprint">(initialCreateMode);
  const [frameMode, setFrameMode] = useState<"frames" | "refs">("frames");
  const [stageTab, setStageTab] = useState<"history" | "guide">("history");

  // Video Edit state (`tab === "edit"`)
  const [editClip, setEditClip] = useState<StudioAssetView | null>(null);
  const [editClipTrimmed, setEditClipTrimmed] = useState(false);
  const [trimModalClip, setTrimModalClip] = useState<StudioAssetView | null>(null);
  const [editRefs, setEditRefs] = useState<TrayItem[]>([]);
  const [editDraft, setEditDraft] = useState<VideoEditDraft>(() => defaultVideoEditDraft());
  const [editBusy, setEditBusy] = useState(false);
  const [editEnhancing, setEditEnhancing] = useState(false);
  const [editEnhanced, setEditEnhanced] = useState<Enhanced | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const editPressRef = useRef<{ fingerprint: string; id: string } | null>(null);

  // Blueprint inline state (`createMode === "blueprint"`)
  const bpModel = useMemo(() => reverseModel(), []);
  const [bpDraft, setBpDraft] = useState<ReverseDraft>(() => emptyBlueprintDraft(bpModel));
  const [bpReads, setBpReads] = useState<Record<string, ReadState>>({});
  const [bpBusy, setBpBusy] = useState(false);
  const [bpNotice, setBpNotice] = useState<string | null>(null);
  const bpPressRef = useRef<{ fingerprint: string; id: string } | null>(null);

  // Shared UI states
  const [pickerTarget, setPickerTarget] = useState<AssetPickerTarget | null>(null);
  const [mentionOpen, setMentionOpen] = useState<"create" | "edit" | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [handoff, setHandoff] = useState<RefSource | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [jobNotes, setJobNotes] = useState<Record<string, string>>({});
  const [sending] = useState<SendingTile[]>([]);

  const createPromptRef = useRef<HTMLTextAreaElement>(null);
  const editPromptRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<AssetPickerTarget | null>(null);
  const searchId = useId();
  const railId = useId();
  const tipId = useId();
  const headSlot = useHeadSlot();

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

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

  const focusActivePrompt = useCallback(() => {
    if (tab === "edit") editPromptRef.current?.focus();
    else createPromptRef.current?.focus();
  }, [tab]);

  // Blueprint clip reading
  const readBlueprintClip = useCallback(
    async (assetId: string) => {
      if (bpReads[assetId]) return;
      setBpReads((cur) => ({ ...cur, [assetId]: { status: "loading" } }));
      const result = await clientApi.call("film.analyze", { organizationId, assetId, depth: "blueprint" });
      setBpReads((cur) => ({ ...cur, [assetId]: { status: "done", sheet: isFailure(result) ? null : result.sheet } }));
    },
    [bpReads, clientApi, organizationId],
  );

  const chooseBlueprintClip = useCallback(
    (asset: StudioAssetView) => {
      setBpNotice(null);
      setBpDraft((cur) => ({
        ...cur,
        videoId: asset.id,
        shots: null,
        method: "blueprint",
        keep: defaultKeep("blueprint"),
        aspect: aspectFor(bpModel, asset),
        seconds: remakeSeconds(bpModel, asset.seconds),
      }));
      void readBlueprintClip(asset.id);
    },
    [bpModel, readBlueprintClip],
  );

  const editProblemLine = useCallback(
    (problem: VideoEditProblem): string => {
      switch (problem.kind) {
        case "need_video":
          return videoCopy.reverse.run.needVideo;
        case "unmeasured":
          return fillText(wc.editSource.unmeasured, { min: problem.min, max: problem.max });
        case "too_short":
          return fillText(wc.editSource.tooShort, { min: problem.min });
        case "too_long":
          return fillText(wc.editSource.tooLong, { max: problem.max });
        case "bad_dimensions":
          return problem.reason === "small" ? copy.remix.limitSmall : copy.remix.limitLarge;
        case "empty_prompt":
          return copy.dock.needChange;
        case "too_many_images":
          return fill(copy.tray.tooManyImages, { n: problem.max });
        case "missing_mentions":
          return fill(copy.tray.missing, {
            label: problem.mentions.map((m) => mentionLabel(m.kind, m.number, copy)).join(", "),
          });
      }
    },
    [copy, videoCopy.reverse.run.needVideo, wc.editSource.tooLong, wc.editSource.tooShort, wc.editSource.unmeasured],
  );

  const selectEditVideoClip = useCallback(
    (asset: StudioAssetView, openTrim = true): boolean => {
      const clipProblem = checkVideoEditClip(asset, editDraft.model);
      if (clipProblem) {
        const line = editProblemLine(clipProblem);
        setEditMessage(line);
        setStatus(line);
        return false;
      }
      setEditMessage(null);
      setEditClip(asset);
      setEditClipTrimmed(false);
      if (openTrim) setTrimModalClip(asset);
      return true;
    },
    [editDraft.model, editProblemLine],
  );

  // Initial asset preselection (`?start=reverse&asset=<uuid>` or `?tab=edit&asset=<uuid>`)
  const initAssetDone = useRef(false);
  useEffect(() => {
    if (initAssetDone.current || !initialAssetId || !state) return;
    initAssetDone.current = true;
    const found = state.assets.find((a) => a.id === initialAssetId && a.kind === "video");
    if (!found) return;
    if (initialTab === "edit") {
      selectEditVideoClip(found, true);
    } else if (initialCreateMode === "blueprint") {
      chooseBlueprintClip(found);
    }
  }, [chooseBlueprintClip, initialAssetId, initialCreateMode, initialTab, selectEditVideoClip, state]);

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
        setTab("create");
        setCreateMode("prompt");
        setFrameMode("frames");
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
        if (tile.kind === "video" && refSrc && "assetId" in refSrc) {
          const vid = lookup.asset(refSrc.assetId);
          if (vid) {
            setTab("edit");
            selectEditVideoClip(vid, true);
          }
        } else if (tile.kind === "image") {
          setTab("create");
          setCreateMode("prompt");
          setFrameMode("refs");
          dock.attach(tile);
        }
      }
      url.searchParams.delete("ref");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [dock, lookup, selectEditVideoClip, sourceItem, state]);

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
    onReview: () => undefined,
    onToVideoScreen: () => undefined,
    onRegionSending: () => undefined,
    focusPrompt: focusActivePrompt,
  });

  // Attach from LibraryRail or Viewer into whichever tab is currently active
  const attachToActiveTab = useCallback(
    (source: RefSource) => {
      const item = sourceItem(source);
      if (!item) return;
      if (tab === "edit") {
        if (item.kind === "video" && "assetId" in source) {
          const vid = lookup.asset(source.assetId);
          if (vid) {
            selectEditVideoClip(vid, true);
          }
        } else if (item.kind === "image") {
          setEditRefs((cur) => addToTray(cur, item).items);
        }
        return;
      }
      if (createMode === "blueprint") {
        if (item.kind === "video" && "assetId" in source) {
          const vid = lookup.asset(source.assetId);
          if (vid) chooseBlueprintClip(vid);
        } else if (item.kind === "image" && "assetId" in source) {
          const img = lookup.asset(source.assetId);
          if (img) {
            setBpDraft((cur) =>
              cur.images.some((i) => i.assetId === img.id) || cur.images.length >= bpModel.maxReferenceImages
                ? cur
                : {
                    ...cur,
                    images: [...cur.images, { assetId: img.id, url: img.url, thumbUrl: img.thumbUrl, name: img.name, slot: "product" }],
                  },
            );
          }
        }
        return;
      }
      if (item.kind === "image" && frameMode === "frames") {
        const hasStart = dock.tray.some((t) => t.frame === "start");
        if (!hasStart) dock.setTray((cur) => withStartFrame(cur, item));
        else dock.setTray((cur) => [...cur.filter((t) => t.frame !== "end" && t.key !== item.key), { ...item, frame: "end" as const }]);
        return;
      }
      if (item.kind === "image") setFrameMode("refs");
      dock.attach(item);
    },
      [bpModel.maxReferenceImages, chooseBlueprintClip, createMode, dock, frameMode, lookup, selectEditVideoClip, sourceItem, tab],
  );

  // Upload helper routing to the requested slot
  const handleUploadedAsset = useCallback(
    (asset: StudioAssetView, target: AssetPickerTarget | null) => {
      if (!target) return;
      switch (target.kind) {
        case "startFrame":
          if (asset.kind === "image") dock.setTray((cur) => withStartFrame(cur, trayItemFromAsset(asset)));
          break;
        case "endFrame":
          if (asset.kind === "image") {
            const tile = { ...trayItemFromAsset(asset), frame: "end" as const };
            dock.setTray((cur) => [...cur.filter((t) => t.frame !== "end" && t.key !== tile.key), tile]);
          }
          break;
        case "createRefs":
          dock.attach(trayItemFromAsset(asset));
          break;
        case "editVideo":
          if (asset.kind === "video") {
            selectEditVideoClip(asset, true);
          }
          break;
        case "editRefs":
          if (asset.kind === "image") setEditRefs((cur) => addToTray(cur, trayItemFromAsset(asset)).items);
          break;
        case "blueprintVideo":
          if (asset.kind === "video") chooseBlueprintClip(asset);
          break;
        case "blueprintSlot":
          if (asset.kind === "image") {
            setBpDraft((cur) =>
              cur.images.some((i) => i.assetId === asset.id) || cur.images.length >= bpModel.maxReferenceImages
                ? cur
                : {
                    ...cur,
                    images: [...cur.images, { assetId: asset.id, url: asset.url, thumbUrl: asset.thumbUrl, name: asset.name, slot: target.slot }],
                  },
            );
          }
          break;
      }
    },
    [bpModel.maxReferenceImages, chooseBlueprintClip, dock, selectEditVideoClip],
  );

  const triggerFileUpload = (target: AssetPickerTarget, accept: string) => {
    uploadTargetRef.current = target;
    if (uploadInputRef.current) {
      uploadInputRef.current.accept = accept;
      uploadInputRef.current.click();
    }
  };

  const uploadSingleForTarget = useCallback(
    async (file: File, target: AssetPickerTarget | null) => {
      const problem = uploadProblem(file);
      if (problem) {
        const line = errorLine(copy, problem);
        if (target?.kind === "editVideo") setEditMessage(line);
        setStatus(line);
        return null;
      }
      if (target?.kind === "editVideo" && file.type.startsWith("video/")) {
        const measured = await measureInBrowser(file, "video").catch(() => ({ seconds: undefined }));
        const durProblem = validateVideoEditDurationSeconds(
          measured.seconds,
          bpModel.referenceVideoSeconds.editMin,
          bpModel.referenceVideoSeconds.max,
        );
        if (durProblem) {
          const line = editProblemLine(durProblem);
          setEditMessage(line);
          setStatus(line);
          return null;
        }
      }
      const res = await studio.upload(file);
      if (isFailure(res)) {
        const line = errorLine(copy, res.code);
        if (target?.kind === "editVideo") setEditMessage(line);
        setStatus(line);
        return null;
      }
      if (target) handleUploadedAsset(res.asset, target);
      return res.asset;
    },
    [bpModel.referenceVideoSeconds.editMin, bpModel.referenceVideoSeconds.max, copy, editProblemLine, handleUploadedAsset, studio],
  );

  const uploadTrimmedClip = useCallback(
    async (file: File): Promise<StudioAssetView | null> => {
      const problem = uploadProblem(file);
      if (problem) {
        setEditMessage(errorLine(copy, problem));
        return null;
      }
      const measured = await measureInBrowser(file, "video").catch(() => ({ seconds: undefined }));
      const durProblem = validateVideoEditDurationSeconds(
        measured.seconds,
        bpModel.referenceVideoSeconds.editMin,
        bpModel.referenceVideoSeconds.max,
      );
      if (durProblem) {
        setEditMessage(editProblemLine(durProblem));
        return null;
      }
      const res = await studio.upload(file);
      if (isFailure(res)) {
        setEditMessage(errorLine(copy, res.code));
        return null;
      }
      return res.asset;
    },
    [bpModel.referenceVideoSeconds.editMin, bpModel.referenceVideoSeconds.max, copy, editProblemLine, studio],
  );

  const uploadRailFiles = useCallback(
    async (files: File[]) => {
      setPanelNotice(null);
      await Promise.all(
        files.map(async (file) => {
          const problem = uploadProblem(file);
          if (problem) return setPanelNotice(errorLine(copy, problem));
          const res = await studio.upload(file);
          if (isFailure(res)) setPanelNotice(errorLine(copy, res.code));
        }),
      );
    },
    [copy, studio],
  );

  // `@` mention selection handler
  const applyAssetMention = useCallback(
    (target: "create" | "edit", asset: StudioAssetView) => {
      if (target === "create") {
        let currentTray = dock.tray;
        const tile = trayItemFromAsset(asset);
        const existingIdx = currentTray.findIndex((t) => t.key === tile.key);
        if (existingIdx < 0) {
          if (asset.kind === "image" && frameMode === "frames") setFrameMode("refs");
          const added = addToTray(currentTray, tile);
          currentTray = added.items;
          dock.attach(tile);
        }
        const sameKind = currentTray.filter((t) => t.kind === asset.kind);
        const ordinal = Math.max(1, sameKind.findIndex((t) => t.key === tile.key) + 1);
        const tag = fillText(asset.kind === "video" ? wc.mention.videoTag : wc.mention.imageTag, { n: ordinal });
        const el = createPromptRef.current;
        const cursor = el?.selectionStart ?? dock.draft.prompt.length;
        const next = insertAssetMention(dock.draft.prompt, cursor, tag);
        dock.setDraft((cur) => ({ ...cur, prompt: next.text }));
        setMentionOpen(null);
        requestAnimationFrame(() => {
          if (el) {
            el.focus();
            el.setSelectionRange(next.nextCursor, next.nextCursor);
          }
        });
        return;
      }

      // Edit mode mention (`@영상 1` for editClip, `@이미지 N` for editRefs)
      if (asset.kind === "video") {
        if (!selectEditVideoClip(asset, false)) {
          setMentionOpen(null);
          return;
        }
        const tag = fillText(wc.mention.videoTag, { n: 1 });
        const el = editPromptRef.current;
        const cursor = el?.selectionStart ?? editDraft.prompt.length;
        const next = insertAssetMention(editDraft.prompt, cursor, tag);
        setEditDraft((cur) => ({ ...cur, prompt: next.text }));
        setMentionOpen(null);
        requestAnimationFrame(() => {
          if (el) {
            el.focus();
            el.setSelectionRange(next.nextCursor, next.nextCursor);
          }
        });
        return;
      }

      const tile = trayItemFromAsset(asset);
      const nextRefs = addToTray(editRefs, tile).items;
      setEditRefs(nextRefs);
      const imgs = nextRefs.filter((t) => t.kind === "image");
      const ordinal = Math.max(1, imgs.findIndex((t) => t.key === tile.key) + 1);
      const tag = fillText(wc.mention.imageTag, { n: ordinal });
      const el = editPromptRef.current;
      const cursor = el?.selectionStart ?? editDraft.prompt.length;
      const next = insertAssetMention(editDraft.prompt, cursor, tag);
      setEditDraft((cur) => ({ ...cur, prompt: next.text }));
      setMentionOpen(null);
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          el.setSelectionRange(next.nextCursor, next.nextCursor);
        }
      });
    },
    [dock, editDraft.prompt, editRefs, frameMode, selectEditVideoClip, wc.mention.imageTag, wc.mention.videoTag],
  );

  // Edit mode prompt enhancer & submit
  const editPreEnhanced = isPreEnhanced(editEnhanced, editDraft.prompt);

  const enhanceEditPrompt = useCallback(async () => {
    if (editEnhancing || !editDraft.prompt.trim()) return;
    const built = buildVideoEditJob({
      video: editClip,
      images: editRefs,
      draft: { ...editDraft, enhance: true },
      ids: { organizationId, requestId: "preview-edit" },
    });
    if (!built.ok) {
      setEditMessage(editProblemLine(built.problem));
      return;
    }
    if (built.input.kind === "video_final") return;
    const { requestId: _ignored, ...previewBody } = built.input;
    const original = editDraft.prompt;
    setEditEnhancing(true);
    setEditMessage(null);
    const res = await studio.enhancePrompt(previewBody as EnhancePreviewInput);
    setEditEnhancing(false);
    if (isFailure(res) || !res.prompt.trim()) {
      setEditMessage(copy.dock.enhanceFailed);
      return;
    }
    const improved = res.prompt.trim().slice(0, STUDIO_LIMITS.promptMax);
    setEditDraft((cur) => (cur.prompt === original ? { ...cur, prompt: improved } : cur));
    setEditEnhanced({ original, improved });
  }, [copy.dock.enhanceFailed, editClip, editDraft, editEnhancing, editProblemLine, editRefs, organizationId, studio]);

  const submitEditRun = useCallback(async () => {
    if (editBusy || editEnhancing) return;
    const built = buildVideoEditJob({
      video: editClip,
      images: editRefs,
      draft: editDraft,
      ids: { organizationId, requestId: "probe-edit" },
      preEnhanced: editPreEnhanced,
    });
    if (!built.ok) {
      setEditMessage(editProblemLine(built.problem));
      return;
    }
    const fingerprint = JSON.stringify({ ...built.input, requestId: null });
    if (editPressRef.current?.fingerprint !== fingerprint) {
      editPressRef.current = { fingerprint, id: newRequestId() };
    }
    setEditBusy(true);
    setEditMessage(null);
    const res = await studio.createJob({ ...built.input, requestId: editPressRef.current.id });
    setEditBusy(false);
    if (isFailure(res)) {
      setEditMessage(errorLine(copy, res.code));
      return;
    }
    editPressRef.current = null;
    setStageTab("history");
    setStatus(copy.state.started);
  }, [copy, editBusy, editClip, editDraft, editEnhancing, editPreEnhanced, editProblemLine, editRefs, organizationId, studio]);

  // Blueprint inline submit
  const bpClip = bpDraft.videoId ? (assets.find((a) => a.id === bpDraft.videoId) ?? null) : null;
  const bpRead: ReadState = bpClip ? (bpReads[bpClip.id] ?? { status: "idle" }) : { status: "idle" };
  const bpSheet = bpRead.status === "done" ? bpRead.sheet : null;
  const bpTable = useMemo(() => tableOf(bpDraft, bpSheet), [bpDraft, bpSheet]);
  const bpWords = useMemo(
    () => ({
      product: videoCopy.reverse.change.product,
      person: videoCopy.reverse.change.person,
      place: videoCopy.reverse.change.place,
      imageWord: videoCopy.reverse.change.imageWord,
    }),
    [videoCopy.reverse.change],
  );

  const submitBlueprintRun = useCallback(async () => {
    if (bpBusy) return;
    const built = buildReverseJob(
      bpDraft,
      { video: bpClip, sheet: bpSheet, words: bpWords },
      { organizationId, requestId: "probe-bp" },
      bpModel,
    );
    if (!built.ok) {
      const msg =
        built.problem === "video"
          ? videoCopy.reverse.run.needVideo
          : built.problem === "reading"
            ? videoCopy.reverse.run.needReading
            : built.problem === "change"
              ? videoCopy.reverse.run.needChange
              : videoCopy.reverse.method.unavailable;
      setBpNotice(msg);
      return;
    }
    const fingerprint = JSON.stringify({ ...built.input, requestId: null });
    if (bpPressRef.current?.fingerprint !== fingerprint) {
      bpPressRef.current = { fingerprint, id: newRequestId() };
    }
    setBpBusy(true);
    setBpNotice(null);
    const res = await studio.createJob({ ...built.input, requestId: bpPressRef.current.id });
    setBpBusy(false);
    if (isFailure(res)) {
      setBpNotice(errorLine(copy, res.code));
      return;
    }
    bpPressRef.current = null;
    announce(STUDIO_JOB_STARTED, { jobId: res.job.id });
    setStageTab("history");
    setStatus(copy.state.started);
  }, [bpBusy, bpClip, bpDraft, bpModel, bpSheet, bpWords, copy, organizationId, studio, videoCopy.reverse]);

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
        setTab(job.kind === "video_remix" && job.method === "edit" ? "edit" : "create");
        return viewer.reuse(job);
      case "campaign":
        return setHandoff({ outputId: output.id });
      case "save":
        return void studio.saveOutput(output.id).then((res) => setStatus(isFailure(res) ? errorLine(copy, res.code) : copy.viewer.saved));
      case "delete":
        return void studio.deleteOutput(output.id).then((res) => {
          if (isFailure(res)) setStatus(res.code === "conflict" ? copy.viewer.deleteBusy : errorLine(copy, res.code));
        });
      case "reference":
        attachToActiveTab({ outputId: output.id });
        return focusActivePrompt();
      case "download":
        return void window.open(output.url, "_blank", "noopener,noreferrer");
      default:
        void item;
    }
  };

  // Controls & numbers
  const controls = dockControls(dock.draft);
  const videoModels = useMemo(() => selectableModels("video"), []);
  const startFrame = dock.tray.find((t) => t.kind === "image" && t.frame === "start") ?? null;
  const endFrame = dock.tray.find((t) => t.kind === "image" && t.frame === "end") ?? null;
  const createCost = dockCredits(dock.draft, dock.tray);
  const bpCost = draftCredits(bpDraft, bpClip, bpModel);
  const editCost = videoEditCredits(editClip, editDraft.resolution, editDraft.model);
  const editClipCheck = editClip ? checkVideoEditClip(editClip, editDraft.model) : null;
  const bpClipWarn = bpClip ? clipNotice(bpModel, bpClip) : null;

  const filteredMentionAssets = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    const pool = tab === "edit" ? assets.filter((a) => a.kind === "image" || a.kind === "video") : assets.filter((a) => a.kind === "image" || a.kind === "video");
    if (!q) return pool.slice(0, 16);
    return pool.filter((a) => a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q))).slice(0, 16);
  }, [assets, mentionQuery, tab]);

  const onPanelDrop = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (source) {
      attachToActiveTab(source);
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []).filter((f) => uploadKind(f.type) !== null);
    if (!files.length) return;
    const firstFile = files[0]!;
    if (tab === "edit") {
      if (firstFile.type.startsWith("video/")) void uploadSingleForTarget(firstFile, { kind: "editVideo" });
      else void uploadSingleForTarget(firstFile, { kind: "editRefs" });
    } else if (createMode === "blueprint") {
      if (firstFile.type.startsWith("video/")) void uploadSingleForTarget(firstFile, { kind: "blueprintVideo" });
      else void uploadSingleForTarget(firstFile, { kind: "blueprintSlot", slot: "product" });
    } else {
      void uploadSingleForTarget(firstFile, frameMode === "frames" && !startFrame ? { kind: "startFrame" } : { kind: "createRefs" });
    }
  };

  const headPortalContent = (
    <>
      {state && state.allowance.capKrw > 0 && <AllowanceLine allowance={state.allowance} copy={copy} locale={locale} />}
      {state && (
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
      )}
    </>
  );

  const guideSection = (
    <section className={w.guideWrap} data-video-guide>
      <div className={w.guideHeader}>
        <h2>{wc.guide.heading}</h2>
        <p>{wc.guide.subheading}</p>
      </div>
      <ol className={w.guideGrid}>
        {wc.guide.steps.map((step, idx) => {
          const media = GUIDE_VIDEOS[idx] ?? GUIDE_VIDEOS[0];
          return (
            <li key={idx} className={w.guideCard} data-video-guide-step={idx + 1}>
              <div className={w.guideMedia} aria-hidden="true">
                <video
                  className={w.guideVideo}
                  src={media.src}
                  poster={media.poster}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
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
      {runOpen && (
        <div className={w.guideActions}>
          <button
            type="button"
            className="bs-btn"
            data-variant="solid"
            data-size="sm"
            onClick={() => {
              setTab("create");
              setCreateMode("prompt");
              setStageTab("history");
              requestAnimationFrame(() => createPromptRef.current?.focus());
            }}
          >
            {wc.guide.tryCreate}
          </button>
          <button
            type="button"
            className="bs-btn"
            data-variant="soft"
            data-size="sm"
            onClick={() => {
              setTab("create");
              setCreateMode("blueprint");
              setStageTab("history");
            }}
          >
            {wc.guide.tryBlueprint}
          </button>
          <button
            type="button"
            className="bs-btn"
            data-variant="soft"
            data-size="sm"
            onClick={() => {
              setTab("edit");
              setStageTab("history");
            }}
          >
            {wc.guide.tryEdit}
          </button>
        </div>
      )}
    </section>
  );

  const emptyWallContent = (
    <div className="bs-empty" data-studio-empty>
      {guideSection}
      {runOpen ? (
        <div className="bs-examples-block">
          <p>{copy.board.emptyBody}</p>
          <ul className="bs-examples" data-studio-examples>
            {EXAMPLES.video.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="bs-example"
                  onClick={() => {
                    setTab("create");
                    setCreateMode("prompt");
                    dock.setDraft((cur) => ({ ...cur, prompt: copy.board.examples[key] }));
                    requestAnimationFrame(() => createPromptRef.current?.focus());
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
    ? ((("assetId" in handoff ? lookup.asset(handoff.assetId)?.kind : lookup.output(handoff.outputId)?.kind) === "video" ? "video" : "image") as "image" | "video")
    : "video";

  return (
    <div
      className={w.workspace}
      data-video-studio-workspace
      data-studio-mode="video"
      data-studio-phase={studio.store.phase}
      onDragOver={(ev) => {
        if (acceptsDrag(ev.dataTransfer?.types)) {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={onPanelDrop}
    >
      {headSlot ? createPortal(headPortalContent, headSlot) : null}

      <input
        ref={uploadInputRef}
        type="file"
        hidden
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          const target = uploadTargetRef.current;
          ev.target.value = "";
          if (file) void uploadSingleForTarget(file, target);
        }}
      />

      {/* ==================== LEFT MANIPULATION PANEL ==================== */}
      <aside className={w.controlPanel} data-video-control-panel>
        <div className={w.modeTabs} role="tablist" aria-label={wc.tabs.label}>
          <button
            type="button"
            role="tab"
            className={w.modeTab}
            aria-selected={tab === "create"}
            data-video-tab="create"
            onClick={() => setTab("create")}
          >
            {wc.tabs.create}
          </button>
          <button
            type="button"
            role="tab"
            className={w.modeTab}
            aria-selected={tab === "edit"}
            data-video-tab="edit"
            onClick={() => setTab("edit")}
          >
            {wc.tabs.edit}
          </button>
        </div>

        {tab === "create" ? (
          <div className={w.panelForm} data-video-create-panel>
            <div className={w.subSwitch} role="group" aria-label={wc.createModes.label}>
              <button
                type="button"
                className={w.subPill}
                aria-pressed={createMode === "prompt"}
                data-video-create-mode="prompt"
                onClick={() => setCreateMode("prompt")}
              >
                {wc.createModes.prompt}
              </button>
              <button
                type="button"
                className={w.subPill}
                aria-pressed={createMode === "blueprint"}
                data-video-create-mode="blueprint"
                onClick={() => setCreateMode("blueprint")}
              >
                {wc.createModes.blueprint}
              </button>
            </div>

            {/* Model Card (renders model brand name only once client state is ready so SSR stays clean) */}
            <div className={w.modelCard} data-video-model-card>
              <span className={w.modelBadge} aria-hidden="true">
                <StudioIcon name="video" />
              </span>
              <div className={w.modelMeta}>
                <span className={w.modelName}>{state ? controls.model.label : wc.model.loading}</span>
                <span className={w.modelHint}>{state ? modelHint(copy, controls.model) : wc.tabs.create}</span>
              </div>
              {state && (
                <ModelMenu
                  models={videoModels}
                  value={controls.model.id}
                  draft={dock.draft}
                  references={dock.tray.length}
                  copy={copy}
                  locale={locale}
                  onChange={(nextId) => dock.setDraft((cur) => withModel(cur, nextId))}
                />
              )}
            </div>

            {createMode === "prompt" ? (
              <form
                className={w.panelForm}
                onSubmit={(ev) => {
                  ev.preventDefault();
                  setStatus(null);
                  void dock.submit().then((ok) => {
                    if (ok) {
                      setStageTab("history");
                      setStatus(copy.state.started);
                    }
                  });
                }}
                data-studio-dock
              >
                {/* Start/End Frames or Multi-Reference Media */}
                <div className={w.block} data-video-refs-section>
                  <div className={w.blockHead}>
                    <span className={w.blockTitle}>{wc.frames.refLabel}</span>
                    <div className={w.inlineToggle}>
                      <button
                        type="button"
                        className={w.inlineToggleBtn}
                        aria-pressed={frameMode === "frames"}
                        onClick={() => setFrameMode("frames")}
                        data-video-frame-mode="frames"
                      >
                        {wc.frames.modeFrames}
                      </button>
                      <button
                        type="button"
                        className={w.inlineToggleBtn}
                        aria-pressed={frameMode === "refs"}
                        onClick={() => setFrameMode("refs")}
                        data-video-frame-mode="refs"
                      >
                        {fillText(wc.frames.modeRefs, { max: (controls.model as StudioVideoModel).maxReferenceImages })}
                      </button>
                    </div>
                  </div>

                  {frameMode === "frames" ? (
                    <div className={w.framePair}>
                      <div className={`${w.frameCard} ${startFrame ? w.frameCardFilled : ""}`} data-video-start-frame>
                        {startFrame ? (
                          <>
                            <img className={w.frameThumb} src={startFrame.thumbUrl ?? startFrame.url} alt="" />
                            <div className={w.frameOverlayBar}>
                              <span>{wc.frames.startLabel}</span>
                              <button
                                type="button"
                                className={w.frameRemoveBtn}
                                onClick={() => dock.remove(startFrame.key)}
                              >
                                {wc.frames.remove}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <div className={w.frameCardLabel}>{wc.frames.startLabel}</div>
                              <div className={w.frameCardHint}>{wc.frames.startHint}</div>
                            </div>
                            <div className={w.frameActions}>
                              <button
                                type="button"
                                className={w.miniBtn}
                                disabled={!runOpen}
                                onClick={() => triggerFileUpload({ kind: "startFrame" }, STUDIO_UPLOAD_MIMES.image.join(","))}
                              >
                                {wc.frames.upload}
                              </button>
                              <button
                                type="button"
                                className={w.miniBtn}
                                disabled={!runOpen}
                                onClick={() => setPickerTarget({ kind: "startFrame" })}
                              >
                                {wc.frames.pickAsset}
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      <div className={`${w.frameCard} ${endFrame ? w.frameCardFilled : ""}`} data-video-end-frame>
                        {endFrame ? (
                          <>
                            <img className={w.frameThumb} src={endFrame.thumbUrl ?? endFrame.url} alt="" />
                            <div className={w.frameOverlayBar}>
                              <span>{wc.frames.endLabel}</span>
                              <button
                                type="button"
                                className={w.frameRemoveBtn}
                                onClick={() => dock.remove(endFrame.key)}
                              >
                                {wc.frames.remove}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <div className={w.frameCardLabel}>{wc.frames.endLabel}</div>
                              <div className={w.frameCardHint}>{wc.frames.endHint}</div>
                            </div>
                            <div className={w.frameActions}>
                              <button
                                type="button"
                                className={w.miniBtn}
                                disabled={!runOpen}
                                onClick={() => triggerFileUpload({ kind: "endFrame" }, STUDIO_UPLOAD_MIMES.image.join(","))}
                              >
                                {wc.frames.upload}
                              </button>
                              <button
                                type="button"
                                className={w.miniBtn}
                                disabled={!runOpen}
                                onClick={() => setPickerTarget({ kind: "endFrame" })}
                              >
                                {wc.frames.pickAsset}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className={w.blockSub}>
                        {fillText(wc.frames.refHint, { max: (controls.model as StudioVideoModel).maxReferenceImages })}
                      </p>
                      <div className={w.refStrip}>
                        {dock.tray.map((item, idx) => {
                          const nums = trayNumbers(dock.tray);
                          const n = nums[idx] ?? idx + 1;
                          const label = fillText(item.kind === "video" ? wc.mention.videoTag : wc.mention.imageTag, { n });
                          return (
                            <div key={item.key} className={w.refChip} data-video-ref-chip={item.key}>
                              {item.kind === "video" ? (
                                <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" />
                              ) : (
                                <img src={item.thumbUrl ?? item.url} alt="" />
                              )}
                              <span className={w.refBadge}>{label}</span>
                              <button
                                type="button"
                                className={w.refRemove}
                                aria-label={wc.frames.remove}
                                onClick={() => dock.remove(item.key)}
                              >
                                <StudioIcon name="close" />
                              </button>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className={w.refAddBox}
                          disabled={!runOpen}
                          onClick={() => setPickerTarget({ kind: "createRefs" })}
                          data-video-add-ref
                        >
                          <span>+ {wc.frames.addRef}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Prompt + `@` Asset Mention + Sound + Enhancer */}
                <div className={w.block} data-video-prompt-section>
                  <label className={w.blockTitle} htmlFor={`${tipId}-create-prompt`}>
                    {wc.prompt.createLabel}
                  </label>
                  <div className={w.promptBox}>
                    {mentionOpen === "create" && (
                      <div className={w.mentionPopover} role="listbox" aria-label={wc.mention.title} data-video-mention-menu>
                        <p className={w.mentionGroupTitle}>{wc.mention.library}</p>
                        {filteredMentionAssets.length === 0 ? (
                          <p className={w.noteLine}>{wc.mention.empty}</p>
                        ) : (
                          filteredMentionAssets.map((asset) => (
                            <button
                              key={asset.id}
                              type="button"
                              role="option"
                              aria-selected={false}
                              className={w.mentionItem}
                              onClick={() => applyAssetMention("create", asset)}
                              data-video-mention-item={asset.id}
                            >
                              {asset.kind === "video" ? (
                                <video src={`${asset.url}#t=0.1`} muted playsInline preload="metadata" />
                              ) : (
                                <img src={asset.thumbUrl ?? asset.url} alt="" />
                              )}
                              <span className={w.mentionName}>{asset.name}</span>
                              <span className={w.mentionTag}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    <textarea
                      ref={createPromptRef}
                      id={`${tipId}-create-prompt`}
                      className={`bs-prompt ${w.promptInput}`}
                      rows={4}
                      maxLength={STUDIO_LIMITS.promptMax}
                      value={dock.draft.prompt}
                      placeholder={wc.prompt.createPlaceholder}
                      disabled={!runOpen || dock.enhancing}
                      onChange={(ev) => {
                        const val = ev.target.value;
                        const cursor = ev.target.selectionStart ?? val.length;
                        dock.setDraft((cur) => ({ ...cur, prompt: val }));
                        const trig = detectAtMentionQuery(val, cursor);
                        if (trig.active) {
                          setMentionQuery(trig.query);
                          setMentionOpen("create");
                        } else if (mentionOpen === "create") {
                          setMentionOpen(null);
                        }
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === "Escape" && mentionOpen) {
                          ev.preventDefault();
                          setMentionOpen(null);
                          return;
                        }
                        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
                          ev.preventDefault();
                          ev.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />

                    <div className={w.promptToolbar}>
                      <div className={w.promptToolsStart}>
                        <button
                          type="button"
                          className={w.atBtn}
                          disabled={!runOpen}
                          onClick={() => {
                            setMentionQuery("");
                            setMentionOpen((cur) => (cur === "create" ? null : "create"));
                          }}
                          data-video-at-btn
                        >
                          {wc.mention.button}
                        </button>
                        <select
                          aria-label={wc.prompt.audioLabel}
                          className={w.compactSelect}
                          value={dock.draft.audio}
                          disabled={!runOpen}
                          onChange={(ev) => dock.setDraft((cur) => ({ ...cur, audio: ev.target.value as StudioState["jobs"][number]["audio"] & string }))}
                          data-video-audio
                        >
                          {STUDIO_AUDIO_MODES.map((m) => (
                            <option key={m} value={m}>
                              {copy.sound[m]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className={w.promptToolsEnd}>
                        <button
                          type="button"
                          role="switch"
                          className="bs-switch"
                          aria-checked={dock.draft.enhance}
                          disabled={!runOpen}
                          onClick={() => dock.setDraft((cur) => ({ ...cur, enhance: !cur.enhance }))}
                          data-studio-enhance
                        >
                          <span className="bs-switch-knob" aria-hidden="true" />
                          {copy.dock.enhance}
                        </button>
                        <Tip id={`${tipId}-enhance`} label={copy.dock.enhanceInfo}>
                          <span>{copy.dock.enhanceTipVideo}</span>
                          <span>{copy.dock.enhanceTipFree}</span>
                        </Tip>
                        <button
                          type="button"
                          className="bs-chip-btn bs-enhance-now"
                          aria-label={copy.dock.enhanceNow}
                          title={copy.dock.enhanceNow}
                          disabled={!runOpen || !dock.draft.prompt.trim() || dock.enhancing || dock.busy}
                          onClick={() => void dock.enhanceNow()}
                          data-studio-enhance-now
                        >
                          <StudioIcon name="sparkles" />
                        </button>
                      </div>
                    </div>
                  </div>
                  {dock.enhanced && (
                    <p className={w.noteLine}>
                      {copy.dock.enhanced}{" "}
                      <button type="button" className="bs-link-btn" onClick={dock.undoEnhance}>
                        {copy.dock.undoEnhance}
                      </button>
                    </p>
                  )}
                </div>

                {/* Specs: Duration · Aspect · Resolution */}
                <div className={w.specGrid}>
                  <div className={w.block}>
                    <div className={w.blockHead}>
                      <span className={w.blockTitle}>{wc.specs.seconds}</span>
                      <select
                        aria-label={wc.specs.seconds}
                        className={`${w.compactSelect} ${w.compactSelectMono}`}
                        value={dock.draft.seconds}
                        disabled={!runOpen}
                        onChange={(ev) => dock.setDraft((cur) => ({ ...cur, seconds: Number(ev.target.value) }))}
                        data-video-seconds-select
                      >
                        {controls.seconds.map((sec) => (
                          <option key={sec} value={sec}>
                            {fillText(wc.specs.secondsUnit, { n: sec })}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={w.pillGroup}>
                      {[5, 8, 10, 15].filter((sec) => controls.seconds.includes(sec)).map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          className={w.pill}
                          aria-pressed={dock.draft.seconds === sec}
                          disabled={!runOpen}
                          onClick={() => dock.setDraft((cur) => ({ ...cur, seconds: sec }))}
                        >
                          {fillText(wc.specs.secondsUnit, { n: sec })}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={w.block}>
                    <span className={w.blockTitle}>{wc.specs.aspect}</span>
                    <div className={w.pillGroup}>
                      {controls.aspects.map((aspect) => (
                        <button
                          key={aspect}
                          type="button"
                          className={w.pill}
                          aria-pressed={dock.draft.aspect === aspect}
                          disabled={!runOpen}
                          onClick={() => dock.setDraft((cur) => ({ ...cur, aspect }))}
                          data-video-aspect={aspect}
                        >
                          {aspect}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={w.block}>
                    <span className={w.blockTitle}>{wc.specs.resolution}</span>
                    <div className={w.resGrid}>
                      {([DRAFT_RESOLUTION, "720p", "1080p"] as const)
                        .filter((r) => controls.resolutions.includes(r))
                        .map((res) => (
                          <button
                            key={res}
                            type="button"
                            className={w.pill}
                            aria-pressed={dock.draft.resolution === res}
                            disabled={!runOpen}
                            onClick={() => dock.setDraft((cur) => ({ ...cur, resolution: res }))}
                            data-video-resolution={res}
                          >
                            {res === DRAFT_RESOLUTION ? wc.specs.draftOption : res}
                          </button>
                        ))}
                    </div>
                    {dock.draft.resolution === DRAFT_RESOLUTION && <p className={w.noteLine}>{wc.specs.draftHint}</p>}
                  </div>
                </div>

                {dock.message && (
                  <p className={w.alertLine} role="alert" data-studio-dock-message>
                    {dock.message}
                  </p>
                )}

                <button
                  type="submit"
                  className={w.ctaBtn}
                  disabled={!runOpen || dock.busy || dock.enhancing}
                  data-studio-submit
                >
                  <span>{dock.busy ? wc.cta.starting : wc.cta.create}</span>
                  {!dock.busy && (
                    <span className={w.ctaCost} data-studio-quote>
                      {formatCreditLine(copy.credits.amount, createCost, locale)}
                    </span>
                  )}
                </button>
              </form>
            ) : (
              /* -------------------- Create > Blueprint Remake -------------------- */
              <div className={w.panelForm} data-video-blueprint-panel>
                <div className={w.block}>
                  <span className={w.blockTitle}>{videoCopy.reverse.sections.video}</span>
                  {bpClip ? (
                    <div className={w.selectedClipCard} data-blueprint-clip={bpClip.id}>
                      <video className={w.selectedClipThumb} src={`${bpClip.url}#t=0.1`} poster={bpClip.thumbUrl ?? undefined} muted playsInline preload="metadata" />
                      <div className={w.selectedClipBody}>
                        <p className={w.selectedClipName}>{bpClip.name}</p>
                        <p className={`${w.selectedClipMeta} bs-num`}>
                          {fillText(videoCopy.reverse.pick.metaShort, { seconds: (bpClip.seconds ?? 0).toFixed(1) })}
                        </p>
                        <div className={w.selectedClipBtns}>
                          <button
                            type="button"
                            className={w.miniBtn}
                            onClick={() => announce(STUDIO_OPEN_REVERSE, { assetId: bpClip.id })}
                            data-blueprint-open-drawer
                          >
                            {bpTable.length > 0
                              ? fillText(wc.blueprint.openTable, { n: bpTable.length })
                              : wc.blueprint.openFullDrawer}
                          </button>
                          <button
                            type="button"
                            className={w.miniBtn}
                            onClick={() => setBpDraft((cur) => ({ ...cur, videoId: null, shots: null }))}
                          >
                            {wc.editSource.replace}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={w.editDropzone}>
                      <p className={w.editDropTitle}>{videoCopy.intro.title}</p>
                      <p className={w.editDropLine}>
                        {fillText(videoCopy.reverse.pick.hint, {
                          mb: Math.round(STUDIO_LIMITS.videoBytesMax / 1_000_000),
                          min: bpModel.referenceVideoSeconds.min,
                          max: bpModel.referenceVideoSeconds.max,
                        })}
                      </p>
                      <div className={w.editDropBtns}>
                        <button
                          type="button"
                          className={w.miniBtn}
                          disabled={!runOpen}
                          onClick={() => triggerFileUpload({ kind: "blueprintVideo" }, STUDIO_UPLOAD_MIMES.video.join(","))}
                        >
                          {videoCopy.reverse.pick.upload}
                        </button>
                        <button
                          type="button"
                          className={w.miniBtn}
                          disabled={!runOpen}
                          onClick={() => setPickerTarget({ kind: "blueprintVideo" })}
                        >
                          {wc.editSource.pickAsset}
                        </button>
                      </div>
                    </div>
                  )}
                  {bpClipWarn === "tooShort" && (
                    <p className={w.alertLine}>{fillText(videoCopy.reverse.pick.tooShort, { min: bpModel.referenceVideoSeconds.min })}</p>
                  )}
                  {bpClipWarn === "tooLong" && (
                    <p className={w.alertLine}>{fillText(videoCopy.reverse.pick.tooLong, { max: bpModel.referenceVideoSeconds.max })}</p>
                  )}
                </div>

                {bpClip && (
                  <div className={w.blueprintBox}>
                    <p className={w.noteLine} role="status">
                      {bpRead.status === "loading"
                        ? wc.blueprint.readingNote
                        : bpTable.length > 0
                          ? fillText(wc.blueprint.readyNote, { n: bpTable.length })
                          : videoCopy.reverse.read.failed}
                    </p>
                    {bpSheet?.summary && <p className={w.blockSub}>{bpSheet.summary}</p>}

                    {CHANGE_SLOTS.map((slot) => {
                      const slotImages = bpDraft.images.filter((i) => i.slot === slot);
                      const numbers = imageNumbers(bpDraft.images);
                      const placeholder =
                        slot === "product"
                          ? videoCopy.reverse.change.productPlaceholder
                          : slot === "person"
                            ? videoCopy.reverse.change.personPlaceholder
                            : videoCopy.reverse.change.placePlaceholder;
                      return (
                        <div key={slot} className={w.slotField}>
                          <div className={w.blockHead}>
                            <label htmlFor={`${tipId}-bp-${slot}`}>{videoCopy.reverse.change[slot]}</label>
                            <button
                              type="button"
                              className={w.miniBtn}
                              disabled={!runOpen}
                              onClick={() => setPickerTarget({ kind: "blueprintSlot", slot })}
                            >
                              + {videoCopy.reverse.change.imageWord}
                            </button>
                          </div>
                          <input
                            id={`${tipId}-bp-${slot}`}
                            type="text"
                            className="bs-field"
                            value={bpDraft.change[slot]}
                            placeholder={placeholder}
                            disabled={!runOpen}
                            onChange={(ev) => setBpDraft((cur) => ({ ...cur, change: { ...cur.change, [slot]: ev.target.value } }))}
                          />
                          {slotImages.length > 0 && (
                            <div className={w.pillGroup}>
                              {slotImages.map((img) => (
                                <div key={img.assetId} className={w.refChip}>
                                  <img src={img.thumbUrl ?? img.url} alt="" />
                                  <span className={w.refBadge}>{`${videoCopy.reverse.change.imageWord} ${numbers.get(img.assetId) ?? 1}`}</span>
                                  <button
                                    type="button"
                                    className={w.refRemove}
                                    aria-label={wc.frames.remove}
                                    onClick={() => setBpDraft((cur) => ({ ...cur, images: cur.images.filter((i) => i.assetId !== img.assetId) }))}
                                  >
                                    <StudioIcon name="close" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className={w.block}>
                      <span className={w.blockTitle}>{videoCopy.reverse.change.keep}</span>
                      <div className={w.pillGroup}>
                        {STUDIO_KEEP_KEYS.map((key) => {
                          const on = bpDraft.keep.includes(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              className={w.pill}
                              aria-pressed={on}
                              disabled={!runOpen}
                              onClick={() =>
                                setBpDraft((cur) => ({
                                  ...cur,
                                  keep: on ? cur.keep.filter((k) => k !== key) : [...cur.keep, key],
                                }))
                              }
                            >
                              {videoCopy.reverse.change.keepKeys[key]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {bpNotice && (
                  <p className={w.alertLine} role="alert">
                    {bpNotice}
                  </p>
                )}

                <button
                  type="button"
                  className={w.ctaBtn}
                  disabled={!runOpen || bpBusy || !bpClip || bpRead.status === "loading"}
                  onClick={() => void submitBlueprintRun()}
                  data-blueprint-submit
                >
                  <span>{bpBusy ? wc.cta.starting : wc.cta.blueprint}</span>
                  {bpClip && !bpBusy && (
                    <span className={w.ctaCost}>
                      {fillText(videoCopy.reverse.run.cost, { n: formatCredits(bpCost, locale) })}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ==================== TAB 2: VIDEO EDIT (Seedance-based) ==================== */
          <form
            className={w.panelForm}
            data-video-edit-panel
            onSubmit={(ev) => {
              ev.preventDefault();
              void submitEditRun();
            }}
          >
            {/* 1. Source Clip (4–30s) */}
            <div className={w.block} data-video-edit-source>
              <span className={w.blockTitle}>{wc.editSource.label}</span>
              {editClip ? (
                <div className={w.selectedClipCard} data-video-edit-clip={editClip.id}>
                  <video
                    className={w.selectedClipThumb}
                    src={`${editClip.url}#t=0.1`}
                    poster={editClip.thumbUrl ?? undefined}
                    muted
                    playsInline
                    preload="metadata"
                  />
                  <div className={w.selectedClipBody}>
                    <p className={w.selectedClipName}>{editClip.name}</p>
                    <p className={`${w.selectedClipMeta} bs-num`}>
                      {editClip.width && editClip.height
                        ? fillText(videoCopy.reverse.pick.meta, {
                            seconds: (editClip.seconds ?? 0).toFixed(1),
                            width: editClip.width,
                            height: editClip.height,
                          })
                        : fillText(videoCopy.reverse.pick.metaShort, { seconds: (editClip.seconds ?? 0).toFixed(1) })}
                      {editClipTrimmed ? ` · ${wc.editSource.trimmedBadge}` : ""}
                    </p>
                    <div className={w.selectedClipBtns}>
                      <button
                        type="button"
                        className={w.miniBtn}
                        onClick={() => setTrimModalClip(editClip)}
                        data-video-open-trim
                      >
                        {wc.editSource.trimAction}
                      </button>
                      <button
                        type="button"
                        className={w.miniBtn}
                        onClick={() => {
                          setEditClip(null);
                          setEditClipTrimmed(false);
                        }}
                      >
                        {wc.editSource.replace}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={w.editDropzone}>
                  <p className={w.editDropTitle}>{wc.editSource.emptyTitle}</p>
                  <p className={w.editDropLine}>{wc.editSource.emptyLine}</p>
                  <div className={w.editDropBtns}>
                    <button
                      type="button"
                      className={w.miniBtn}
                      disabled={!runOpen}
                      onClick={() => triggerFileUpload({ kind: "editVideo" }, STUDIO_UPLOAD_MIMES.video.join(","))}
                      data-video-edit-upload
                    >
                      {wc.editSource.upload}
                    </button>
                    <button
                      type="button"
                      className={w.miniBtn}
                      disabled={!runOpen}
                      onClick={() => setPickerTarget({ kind: "editVideo" })}
                      data-video-edit-pick
                    >
                      {wc.editSource.pickAsset}
                    </button>
                  </div>
                </div>
              )}
              {editClipCheck && (
                <p className={w.alertLine} role="status">
                  {editProblemLine(editClipCheck)}
                </p>
              )}
            </div>

            {/* 2. Reference Images (up to 9) */}
            <div className={w.block} data-video-edit-refs>
              <span className={w.blockTitle}>
                {fillText(wc.editSource.refsLabel, { max: bpModel.maxReferenceImages })}
              </span>
              <p className={w.blockSub}>{wc.editSource.refsHint}</p>
              <div className={w.refStrip}>
                {editRefs.map((item, idx) => (
                  <div key={item.key} className={w.refChip} data-edit-ref-chip={item.key}>
                    <img src={item.thumbUrl ?? item.url} alt="" />
                    <span className={w.refBadge}>{fillText(wc.mention.imageTag, { n: idx + 1 })}</span>
                    <button
                      type="button"
                      className={w.refRemove}
                      aria-label={wc.frames.remove}
                      onClick={() => setEditRefs((cur) => removeFromTray(cur, item.key))}
                    >
                      <StudioIcon name="close" />
                    </button>
                  </div>
                ))}
                {editRefs.length < bpModel.maxReferenceImages && (
                  <>
                    <button
                      type="button"
                      className={w.refAddBox}
                      disabled={!runOpen}
                      onClick={() => triggerFileUpload({ kind: "editRefs" }, STUDIO_UPLOAD_MIMES.image.join(","))}
                    >
                      <span>+ {wc.frames.upload}</span>
                    </button>
                    <button
                      type="button"
                      className={w.refAddBox}
                      disabled={!runOpen}
                      onClick={() => setPickerTarget({ kind: "editRefs" })}
                    >
                      <span>+ {wc.frames.pickAsset}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 3. Edit Prompt + `@` Mention + Audio + Enhancer */}
            <div className={w.block} data-video-edit-prompt>
              <label className={w.blockTitle} htmlFor={`${tipId}-edit-prompt`}>
                {wc.prompt.editLabel}
              </label>
              <div className={w.promptBox}>
                {mentionOpen === "edit" && (
                  <div className={w.mentionPopover} role="listbox" aria-label={wc.mention.title} data-video-mention-menu>
                    <p className={w.mentionGroupTitle}>{wc.mention.library}</p>
                    {filteredMentionAssets.length === 0 ? (
                      <p className={w.noteLine}>{wc.mention.empty}</p>
                    ) : (
                      filteredMentionAssets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className={w.mentionItem}
                          onClick={() => applyAssetMention("edit", asset)}
                        >
                          {asset.kind === "video" ? (
                            <video src={`${asset.url}#t=0.1`} muted playsInline preload="metadata" />
                          ) : (
                            <img src={asset.thumbUrl ?? asset.url} alt="" />
                          )}
                          <span className={w.mentionName}>{asset.name}</span>
                          <span className={w.mentionTag}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                <textarea
                  ref={editPromptRef}
                  id={`${tipId}-edit-prompt`}
                  className={w.promptInput}
                  rows={4}
                  maxLength={STUDIO_LIMITS.promptMax}
                  value={editDraft.prompt}
                  placeholder={wc.prompt.editPlaceholder}
                  disabled={!runOpen || editEnhancing}
                  onChange={(ev) => {
                    const val = ev.target.value;
                    const cursor = ev.target.selectionStart ?? val.length;
                    setEditDraft((cur) => ({ ...cur, prompt: val }));
                    const trig = detectAtMentionQuery(val, cursor);
                    if (trig.active) {
                      setMentionQuery(trig.query);
                      setMentionOpen("edit");
                    } else if (mentionOpen === "edit") {
                      setMentionOpen(null);
                    }
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Escape" && mentionOpen) {
                      ev.preventDefault();
                      setMentionOpen(null);
                      return;
                    }
                    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
                      ev.preventDefault();
                      ev.currentTarget.form?.requestSubmit();
                    }
                  }}
                />

                <div className={w.promptToolbar}>
                  <div className={w.promptToolsStart}>
                    <button
                      type="button"
                      className={w.atBtn}
                      disabled={!runOpen}
                      onClick={() => {
                        setMentionQuery("");
                        setMentionOpen((cur) => (cur === "edit" ? null : "edit"));
                      }}
                    >
                      {wc.mention.button}
                    </button>
                    <select
                      aria-label={wc.prompt.audioLabel}
                      className={w.compactSelect}
                      value={editDraft.audio}
                      disabled={!runOpen}
                      onChange={(ev) => setEditDraft((cur) => ({ ...cur, audio: ev.target.value as VideoEditDraft["audio"] }))}
                    >
                      {STUDIO_AUDIO_MODES.map((m) => (
                        <option key={m} value={m}>
                          {copy.sound[m]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={w.promptToolsEnd}>
                    <button
                      type="button"
                      role="switch"
                      className="bs-switch"
                      aria-checked={editDraft.enhance}
                      disabled={!runOpen}
                      onClick={() => setEditDraft((cur) => ({ ...cur, enhance: !cur.enhance }))}
                    >
                      <span className="bs-switch-knob" aria-hidden="true" />
                      {copy.dock.enhance}
                    </button>
                    <button
                      type="button"
                      className="bs-chip-btn bs-enhance-now"
                      aria-label={copy.dock.enhanceNow}
                      title={copy.dock.enhanceNow}
                      disabled={!runOpen || !editClip || !editDraft.prompt.trim() || editEnhancing || editBusy}
                      onClick={() => void enhanceEditPrompt()}
                    >
                      <StudioIcon name="sparkles" />
                    </button>
                  </div>
                </div>
              </div>
              {editPreEnhanced && editEnhanced && (
                <p className={w.noteLine}>
                  {copy.dock.enhanced}{" "}
                  <button
                    type="button"
                    className="bs-link-btn"
                    onClick={() => {
                      setEditDraft((cur) => ({ ...cur, prompt: editEnhanced.original }));
                      setEditEnhanced(null);
                    }}
                  >
                    {copy.dock.undoEnhance}
                  </button>
                </p>
              )}
            </div>

            {/* 4. Model Card + Resolution + CTA */}
            <div className={w.modelCard}>
              <span className={w.modelBadge} aria-hidden="true">
                <StudioIcon name="video" />
              </span>
              <div className={w.modelMeta}>
                <span className={w.modelName}>{state ? bpModel.label : wc.model.loading}</span>
                <span className={w.modelHint}>{state ? modelHint(copy, bpModel) : wc.tabs.edit}</span>
              </div>
              {state && (
                <ModelMenu
                  models={videoModels}
                  value={editDraft.model}
                  draft={{ resolution: editDraft.resolution }}
                  references={editRefs.length}
                  copy={copy}
                  locale={locale}
                  onChange={(nextId) => setEditDraft((cur) => ({ ...cur, model: nextId }))}
                />
              )}
            </div>

            <div className={w.block}>
              <span className={w.blockTitle}>{wc.specs.resolution}</span>
              <div className={w.resGrid}>
                {(["480p", "720p", "1080p"] as const satisfies readonly StudioVideoResolution[]).map((res) => (
                  <button
                    key={res}
                    type="button"
                    className={w.pill}
                    aria-pressed={editDraft.resolution === res}
                    disabled={!runOpen}
                    onClick={() => setEditDraft((cur) => ({ ...cur, resolution: res }))}
                    data-edit-resolution={res}
                  >
                    {res}
                  </button>
                ))}
              </div>
              <p className={w.noteLine}>{wc.specs.editKeepHint}</p>
            </div>

            {editMessage && (
              <p className={w.alertLine} role="alert" data-video-edit-message>
                {editMessage}
              </p>
            )}

            <button
              type="submit"
              className={w.ctaBtn}
              disabled={!runOpen || editBusy || editEnhancing || Boolean(editClipCheck)}
              data-video-edit-submit
            >
              <span>{editBusy ? wc.cta.starting : wc.cta.edit}</span>
              {!editBusy && (
                <span className={w.ctaCost}>
                  {formatCreditLine(copy.credits.amount, editCost, locale)}
                </span>
              )}
            </button>
          </form>
        )}

        {state && canCreate && !runOpen && (
          <p className={w.noteLine} data-studio-allowance-closed>
            {copy.dock.closedBody}
          </p>
        )}
        {state && !canCreate && (
          <p className={w.noteLine} data-studio-read-only>
            {copy.dock.readOnly}
          </p>
        )}
      </aside>

      {/* ==================== RIGHT STAGE + LIBRARY RAIL ==================== */}
      <div className={w.stageColumn}>
        <div className={w.stageMain}>
          <div className={w.stageBar}>
            <div className={w.stageSwitch} role="tablist" aria-label={wc.stageTabs.label}>
              <button
                type="button"
                role="tab"
                className={w.stageTab}
                aria-selected={stageTab === "history"}
                data-video-stage-tab="history"
                onClick={() => setStageTab("history")}
              >
                {wc.stageTabs.history}
                {jobs.length > 0 ? ` (${jobs.length})` : ""}
              </button>
              <button
                type="button"
                role="tab"
                className={w.stageTab}
                aria-selected={stageTab === "guide"}
                data-video-stage-tab="guide"
                onClick={() => setStageTab("guide")}
              >
                {wc.stageTabs.guide}
              </button>
            </div>
            {status && (
              <p className="bs-notice" role="status" aria-live="polite" data-studio-status="">
                {status}
              </p>
            )}
          </div>

          {studio.store.phase === "loading" && !state && (
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

          {stageTab === "guide" ? (
            guideSection
          ) : (
            state && (
              <Wall
                mode="video"
                jobs={jobs}
                sending={sending}
                copy={copy}
                locale={locale}
                canGenerate={runOpen}
                canEdit={canCreate}
                canStop={canCreate}
                stopping={stopping}
                notes={jobNotes}
                library={library}
                parentOf={parentOf}
                onAction={tileAction}
                onRetry={(job) => (canRerun(job) ? viewer.rerun(job) : viewer.reuse(job))}
                onCancel={(job) => void cancel(job)}
                onNotice={setStatus}
                empty={emptyWallContent}
              />
            )
          )}
        </div>

        <div className="bs-rail-slot" data-studio-rail-slot>
          {state && (
            <LibraryRail
              id={railId}
              organizationId={organizationId}
              locale={locale}
              library={library}
              assets={assets}
              outputOf={(id: string): StudioOutputView | null => findOutput(allJobs, id)}
              canCreate={canCreate}
              attachOnPress={runOpen}
              open={sheetOpen}
              notice={panelNotice}
              uploading={studio.uploads.map((u) => u.name)}
              searchId={searchId}
              onClose={() => setSheetOpen(false)}
              onAttach={(source) => {
                attachToActiveTab(source);
                setSheetOpen(false);
              }}
              onView={(source) =>
                viewer.show("assetId" in source ? { list: "assets", key: `a:${source.assetId}` } : { list: "outputs", key: `o:${source.outputId}` })
              }
              onFiles={(files) => void uploadRailFiles(files)}
              onUpdate={(assetId, patch) => studio.updateAsset({ assetId, ...patch })}
              onDelete={studio.deleteAsset}
              copy={libraryCopy}
            />
          )}
        </div>
      </div>

      {/* Wide shot-table blueprint drawer (opened on demand via `넓은 설계도 창 열기` or `STUDIO_OPEN_REVERSE`) */}
      <ReversePanel
        organizationId={organizationId}
        locale={locale}
        copy={copy}
        video={videoCopy}
        initialOpen={false}
        initialAssetId={null}
        api={clientApi}
      />

      {/* Segment & Crop Modal for Video Edit */}
      {trimModalClip && (
        <ClipTrimModal
          asset={trimModalClip}
          copy={wc.trimModal}
          minSeconds={bpModel.referenceVideoSeconds.editMin}
          maxSeconds={bpModel.referenceVideoSeconds.max}
          onSkip={(original) => {
            setEditClip(original);
            setEditClipTrimmed(false);
            setTrimModalClip(null);
          }}
          onApply={({ asset: chosen, trimmed, fallbackNotice }) => {
            setEditClip(chosen);
            setEditClipTrimmed(trimmed);
            setTrimModalClip(null);
            if (fallbackNotice) setStatus(fallbackNotice);
          }}
          onUploadTrimmed={uploadTrimmedClip}
          onClose={() => setTrimModalClip(null)}
        />
      )}

      {/* Asset Picker Modal */}
      {pickerTarget && (
        <AssetPickerModal
          target={pickerTarget}
          images={imageAssets}
          videos={videoAssets}
          copy={wc.assetModal}
          onPick={(asset) => {
            handleUploadedAsset(asset, pickerTarget);
            setPickerTarget(null);
          }}
          onUpload={() => {
            const target = pickerTarget;
            setPickerTarget(null);
            const wantsVideo = target.kind === "editVideo" || target.kind === "blueprintVideo";
            triggerFileUpload(target, (wantsVideo ? STUDIO_UPLOAD_MIMES.video : STUDIO_UPLOAD_MIMES.image).join(","));
          }}
          onClose={() => setPickerTarget(null)}
        />
      )}

      {/* Viewer & Campaign Handoff */}
      {viewer.open && viewer.index >= 0 && (
        <Viewer
          items={viewer.items}
          index={viewer.index}
          copy={copy}
          locale={locale}
          canCreate={canCreate}
          canGenerate={runOpen}
          busy={viewer.busy}
          notice={viewer.notice}
          regionPreset={null}
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
    </div>
  );
}

function AssetPickerModal({
  target,
  images,
  videos,
  copy,
  onPick,
  onUpload,
  onClose,
}: {
  target: AssetPickerTarget;
  images: StudioAssetView[];
  videos: StudioAssetView[];
  copy: StudioVideoCopy["workspace"]["assetModal"];
  onPick(asset: StudioAssetView): void;
  onUpload(): void;
  onClose(): void;
}) {
  const ref = useModal();
  const id = useId();
  const wantsVideo = target.kind === "editVideo" || target.kind === "blueprintVideo";
  const list = wantsVideo ? videos : images;

  return (
    <dialog
      ref={ref}
      className={w.assetDialog}
      aria-labelledby={`${id}-title`}
      data-video-asset-picker
      onCancel={(ev) => {
        ev.preventDefault();
        onClose();
      }}
    >
      <header className={w.assetDialogHead}>
        <h2 id={`${id}-title`}>{wantsVideo ? copy.pickVideoTitle : copy.pickImageTitle}</h2>
        <div style={{ display: "inline-flex", gap: 8 }}>
          <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={onUpload}>
            <StudioIcon name="upload" />
          </button>
          <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={copy.close} onClick={onClose}>
            <StudioIcon name="close" />
          </button>
        </div>
      </header>
      <div className={w.assetDialogBody}>
        {list.length === 0 ? (
          <p className={w.noteLine}>{wantsVideo ? copy.emptyVideos : copy.emptyImages}</p>
        ) : (
          <ul className={w.assetGrid}>
            {list.map((asset) => (
              <li key={asset.id}>
                <button type="button" className={w.assetTile} onClick={() => onPick(asset)} data-picker-asset={asset.id}>
                  {asset.kind === "video" ? (
                    <video src={`${asset.url}#t=0.1`} poster={asset.thumbUrl ?? undefined} muted playsInline preload="metadata" />
                  ) : (
                    <img src={asset.thumbUrl ?? asset.url} alt="" loading="lazy" />
                  )}
                  {asset.seconds ? <span className={w.assetTileDur}>{`${asset.seconds.toFixed(1)}s`}</span> : null}
                  <span className={w.assetTileName}>{asset.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
