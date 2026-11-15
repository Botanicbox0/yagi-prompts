"use client";
/**
 * The brand studio's making screen (docs/BRAND-STUDIO-V3.md §4): the gallery wall, the floating prompt
 * bar and the library rail, plus the viewer, the layer editor and the campaign handoff. The only
 * client island on the page. The screen's `mode` fixes the medium: `/brand/studio` mounts it with
 * `mode="image"`, `/brand/studio/video` (slice C) with `mode="video"`.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extractClipboardImages, isEditableTextTarget, prepareClipboardUploadFiles } from "@/lib/brand-studio/clipboard-image";
import type { StudioAssetView, StudioJobView, StudioOutputView, StudioState } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isFailure, uploadProblem, type StudioApi } from "./api";
import { EXAMPLES, jobsFor } from "./board";
import { errorLine, newRequestId, type StudioCopy, type StudioLocale } from "./copy";
import { AllowanceLine, Dock } from "./dock";
import { DRAFT_RESOLUTION, dockCredits, regionEditInput, regionEditModel, regionEditModels, remixActive, remixFit, withMedium, type EnhancePreviewInput } from "./dock-model";
import { Explainer } from "./explainer";
import { Wall, type SendingTile, type TileAction, type WallTileItem } from "./gallery/wall";
import { HandoffDialog, handoffInput } from "./handoff-dialog";
import { naturalSize } from "./layers/browser";
import { LibraryRail } from "./rail";
import { useStudioLibrary } from "./rail/use-library";
import { trayItemFromAsset, trayItemFromOutput, trayLabels, withStartFrame, type RefSource, type TrayItem } from "./refs";
import { ShareReviewDialog, useShareReviewEvent, type ShareReviewTarget } from "./share-review-dialog";
import { libraryKey, type LayerEditorProps, type LayerEditorRegionPreset } from "./seams";
import { findOutput } from "./store";
import { useDock } from "./use-dock";
import { useStudio } from "./use-studio";
import { sourceOf, useViewer } from "./use-viewer";
import { Viewer, canRerun, itemKey, type ViewerItem } from "./viewer";

/** The layer editor ("꾸미기", slice E), loaded only when someone decorates a picture. */
const LayerEditor = dynamic(() => import("./layers"), { ssr: false });

/**
 * Props of the making screen. Slice C mounts it on the video screen as
 * `<StudioApp mode="video" organizationId locale copy libraryCopy layersCopy />`.
 */
export interface StudioAppProps {
  organizationId: string;
  locale: StudioLocale;
  /** `dict.brandStudio`. */
  copy: StudioCopy;
  /** The medium this screen makes and lists: the image screen never shows video controls or video runs, and the reverse. */
  mode: StudioMedium;
  /** `dict.studioLibrary`, handed to the library rail (slice B2). */
  libraryCopy: Dictionary["studioLibrary"];
  /** `dict.studioLayers`, handed to the layer editor (slice E). */
  layersCopy: Dictionary["studioLayers"];
  /** `dict.studioVideo` (video screen): the reference-video panel's link into the full reverse panel. */
  videoCopy?: Dictionary["studioVideo"];
  /** Server-loaded state; without it the screen loads its own on mount. */
  initialState?: StudioState | null;
  /** Tests inject a client; the screen otherwise talks to `/api/brand-studio`. */
  api?: StudioApi;
}

/** The workspace's live support drawer (components/brand-workspace/support.tsx). */
function openSupport() {
  document.querySelector<HTMLButtonElement>("[data-concierge-launcher]")?.click();
}

/** The explainer's "첫 문장 쓰기" fires this on `window`; the screen focuses the prompt. */
export const STUDIO_FOCUS_PROMPT = "twings:studio-focus-prompt";

const focusPrompt = () => document.querySelector<HTMLTextAreaElement>("[data-studio-dock] textarea.bs-prompt")?.focus();

/** The studio header's slot (v2-page.tsx), where the credits line and the phone's library button live. */
function useHeadSlot() {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => setSlot(document.querySelector("[data-studio-head-slot]")), []);
  return slot;
}

/** The library rail's width as `--bs-rail-w`, so the docked viewer leaves the rail usable. */
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

/**
 * The workspace's phone tab bar (slice A) is fixed to the bottom of the screen; its height goes to
 * `--bs-tabbar-h` so the prompt bar sits on top of it instead of under it.
 */
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

/** `/brand/studio?organizationId=…&ref=a:<id>`: the image screen with a picture attached to its references. */
export function imageScreenRefHref(organizationId: string, source: RefSource): string {
  const params = new URLSearchParams({ organizationId, ref: "assetId" in source ? `a:${source.assetId}` : `o:${source.outputId}` });
  return `/brand/studio?${params.toString()}`;
}

/** `/brand/studio?organizationId=…&canvas=a:<id>`: the image screen opening the picture directly in OpenCanva (`LayerEditor`). */
export function imageCanvasHref(organizationId: string, source: RefSource): string {
  const params = new URLSearchParams({ organizationId, canvas: "assetId" in source ? `a:${source.assetId}` : `o:${source.outputId}` });
  return `/brand/studio?${params.toString()}`;
}

/** `/brand/studio/video?organizationId=…&from=o:<id>`: the video screen with a picture as its opening frame. */
export function videoScreenHref(organizationId: string, source: RefSource): string {
  const params = new URLSearchParams({ organizationId, from: "assetId" in source ? `a:${source.assetId}` : `o:${source.outputId}` });
  return `/brand/studio/video?${params.toString()}`;
}

/** `/brand/studio/compose?organizationId=…&clip=a:<id>`: the video editing studio with a clip ready on arrival. */
export function videoComposeClipHref(organizationId: string, source: RefSource): string {
  const params = new URLSearchParams({ organizationId, clip: "assetId" in source ? `a:${source.assetId}` : `o:${source.outputId}` });
  return `/brand/studio/compose?${params.toString()}`;
}

export const BLANK_CANVAS_PRESETS = [
  { id: "4:5", label: "4:5 · 1080×1350", width: 1080, height: 1350, syntheticAssetId: "00000000-0000-4000-8000-00000000c405" },
  { id: "9:16", label: "9:16 · 1080×1920", width: 1080, height: 1920, syntheticAssetId: "00000000-0000-4000-8000-00000000c916" },
  { id: "16:9", label: "16:9 · 1920×1080", width: 1920, height: 1080, syntheticAssetId: "00000000-0000-4000-8000-0000000c1609" },
  { id: "1:1", label: "1:1 · 1080×1080", width: 1080, height: 1080, syntheticAssetId: "00000000-0000-4000-8000-00000000c101" },
] as const;

export type BlankCanvasPresetId = (typeof BLANK_CANVAS_PRESETS)[number]["id"];

/** Generates a clean white `#FFFFFF` PNG data URL via `<canvas>` (with 1x1 white PNG fallback in SSR/test DOMs). */
export function createBlankCanvasDataUrl(width: number, height: number): string {
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        const url = canvas.toDataURL("image/png");
        if (url.startsWith("data:image/png")) return url;
      }
    } catch {
      // Fallback below when canvas 2d context is unavailable (e.g. jsdom).
    }
  }
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
}

async function dataUrlToPngFile(dataUrl: string, fileName: string): Promise<File> {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
  const binary = typeof atob === "function" ? atob(b64) : "";
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: "image/png" });
}

/** `from=o:<id>` / `from=a:<id>` from the address, or null. */
export function parseFrom(value: string | null): RefSource | null {
  const match = /^([ao]):([0-9a-f-]{36})$/i.exec(value ?? "");
  if (!match) return null;
  return match[1] === "a" ? { assetId: match[2]! } : { outputId: match[2]! };
}

/** Recent pictures the partial-edit form offers (results first, then uploads), newest first. */
export function recentPictures(jobs: readonly StudioJobView[], assets: readonly StudioAssetView[], label: string, limit = 12): TrayItem[] {
  const out: TrayItem[] = [];
  for (const job of jobs) for (const output of job.outputs) if (output.kind === "image" && out.length < limit) out.push(trayItemFromOutput(output, label));
  for (const asset of assets) if (asset.kind === "image" && out.length < limit + 6) out.push(trayItemFromAsset(asset));
  return out;
}

export function StudioApp({ organizationId, locale, copy, mode, libraryCopy, layersCopy, videoCopy, initialState = null, api }: StudioAppProps) {
  const studio = useStudio({ organizationId, initialState, api });
  const dock = useDock({ studio, copy, organizationId, initialMedium: mode, mode });
  const library = useStudioLibrary(organizationId);
  const state = studio.store.state;
  const allJobs = useMemo(() => state?.jobs ?? [], [state?.jobs]);
  const jobs = useMemo(() => jobsFor(allJobs, mode), [allJobs, mode]);
  const assets = useMemo(() => state?.assets ?? [], [state?.assets]);
  const canCreate = state?.canCreate ?? false;
  const dockOpen = canCreate && (state?.allowance.capKrw ?? 0) > 0;
  const [handoff, setHandoff] = useState<RefSource | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareReviewTarget | null>(null);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false);
  const canvasMenuWrapRef = useRef<HTMLDivElement>(null);
  const [editorState, setEditorState] = useState<{
    nonce: number;
    base: LayerEditorProps["base"];
    isBlankCanvas?: boolean;
    initialTool: "move" | "marquee";
    initialPatch: LayerEditorProps["initialPatch"];
    initialRegionPreset: LayerEditorProps["initialRegionPreset"];
  } | null>(null);
  const blankUploadedAssetRef = useRef<Record<string, string>>({});
  const editorNonceRef = useRef(0);

  useShareReviewEvent(organizationId, setShareTarget);

  useEffect(() => {
    if (!canvasMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && canvasMenuWrapRef.current?.contains(target)) return;
      setCanvasMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCanvasMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canvasMenuOpen]);
  const [sheet, setSheet] = useState(false);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [jobNotes, setJobNotes] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<SendingTile[]>([]);
  const searchId = useId();
  const panelId = useId();
  const headSlot = useHeadSlot();
  const railSlot = useRailWidth();
  useTabBarHeight();

  // A status line fades after a while; a new one replaces it.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    window.addEventListener(STUDIO_FOCUS_PROMPT, focusPrompt);
    return () => window.removeEventListener(STUDIO_FOCUS_PROMPT, focusPrompt);
  }, []);

  // A reference video in a video run: read it once, and start from the 480p draft.
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
  // A clip too short to edit can only be followed in a new take.
  const editable = remixFit(dock.draft, dock.tray)?.editable ?? true;
  useEffect(() => {
    if (!editable) setDraft((current) => (current.method === "edit" ? { ...current, method: "reference" } : current));
  }, [editable, setDraft]);

  const parentOf = useCallback((outputId: string | null) => findOutput(allJobs, outputId), [allJobs]);
  const lookup = useMemo(
    () => ({ asset: (id: string) => assets.find((a) => a.id === id) ?? null, output: (id: string) => findOutput(allJobs, id) }),
    [assets, allJobs],
  );
  const parentAssetOf = useCallback((assetId: string | null) => (assetId ? lookup.asset(assetId) : null), [lookup]);

  const sourceItem = useCallback(
    (source: RefSource): TrayItem | null => {
      const asset = "assetId" in source ? lookup.asset(source.assetId) : null;
      const output = "outputId" in source ? lookup.output(source.outputId) : null;
      return asset ? trayItemFromAsset(asset) : output ? trayItemFromOutput(output, copy.viewer.label) : null;
    },
    [copy, lookup],
  );

  const onReview = useCallback(
    (source: RefSource, title: string) => {
      setShareTarget({
        organizationId,
        assetId: "assetId" in source ? source.assetId : null,
        outputId: "outputId" in source ? source.outputId : null,
        title: title.slice(0, 120) || copy.gallery.reviewTitle,
      });
    },
    [copy, organizationId],
  );

  const openBlankCanvas = useCallback(
    (presetId: BlankCanvasPresetId = "4:5") => {
      const preset = BLANK_CANVAS_PRESETS.find((p) => p.id === presetId) ?? BLANK_CANVAS_PRESETS[0];
      const url = createBlankCanvasDataUrl(preset.width, preset.height);
      setCanvasMenuOpen(false);
      editorNonceRef.current += 1;
      setEditorState({
        nonce: editorNonceRef.current,
        base: {
          ref: { assetId: preset.syntheticAssetId },
          url,
          width: preset.width,
          height: preset.height,
          name: locale === "en" ? `Canvas ${preset.label}` : `빈 캔버스 ${preset.label}`,
        },
        isBlankCanvas: true,
        initialTool: "move",
        initialPatch: null,
        initialRegionPreset: null,
      });
    },
    [locale],
  );

  const openLayerEditor = useCallback(
    async (source: RefSource, opts: { tool: "move" | "marquee"; preset?: LayerEditorRegionPreset | null }) => {
      const asset = "assetId" in source ? lookup.asset(source.assetId) : null;
      const output = "outputId" in source ? lookup.output(source.outputId) : null;
      const file = asset ?? output;
      if (!file || file.kind !== "image") return;

      // When opening "꾸미기" on a completed region_edit output that stored a patch, load its parent picture
      // as Base and the patch as a masked layer so seams can be inspected (Base eye) and erased/restored.
      if (opts.tool === "move" && output?.regionPatch) {
        const originJob = allJobs.find((j) => j.id === output.jobId) ?? null;
        if (originJob?.kind === "region_edit") {
          const parentOut = originJob.parentOutputId ? parentOf(originJob.parentOutputId) : null;
          const parentAst = !parentOut && originJob.parentAssetId ? parentAssetOf(originJob.parentAssetId) : null;
          const parent = parentOut ?? parentAst;
          if (parent && parent.kind === "image") {
            const pSize = parent.width && parent.height ? { width: parent.width, height: parent.height } : await naturalSize(parent.url);
            if (pSize) {
              const rp = output.regionPatch;
              editorNonceRef.current += 1;
              setEditorState({
                nonce: editorNonceRef.current,
                base: {
                  ref: parentOut ? { outputId: parentOut.id } : { assetId: parentAst!.id },
                  url: parent.url,
                  width: pSize.width,
                  height: pSize.height,
                  name: parentAst?.name ?? null,
                },
                initialTool: "move",
                initialPatch: {
                  id: `patch-${output.id}`,
                  url: rp.url,
                  maskUrl: rp.maskUrl,
                  box: {
                    x: rp.x * pSize.width,
                    y: rp.y * pSize.height,
                    w: rp.w * pSize.width,
                    h: rp.h * pSize.height,
                  },
                  ref: { outputId: output.id },
                },
                initialRegionPreset: null,
              });
              return;
            }
          }
        }
      }

      const size = file.width && file.height ? { width: file.width, height: file.height } : await naturalSize(file.url);
      if (!size) return;
      editorNonceRef.current += 1;
      setEditorState({
        nonce: editorNonceRef.current,
        base: { ref: source, url: file.url, width: size.width, height: size.height, name: asset?.name ?? null },
        initialTool: opts.tool,
        initialPatch: null,
        initialRegionPreset: opts.preset ?? null,
      });
    },
    [allJobs, lookup, parentAssetOf, parentOf],
  );

  const onRegionSending = useCallback((event: { key: string; ratio: string } | { done: string; line: string | null }) => {
    if ("key" in event) setSending((current) => [{ key: event.key, ratio: event.ratio }, ...current]);
    else {
      setSending((current) => current.filter((tile) => tile.key !== event.done));
      if (event.line) setStatus(event.line);
    }
  }, []);

  const viewer = useViewer({
    studio,
    dock,
    copy,
    locale,
    mode,
    organizationId,
    jobs,
    assets,
    lookup,
    onCampaign: setHandoff,
    onDecorate: (item) => void openLayerEditor(sourceOf(item), { tool: "move" }),
    onOpenRegionEditor: dockOpen && mode === "image" ? (src, preset) => void openLayerEditor(src, { tool: "marquee", preset }) : undefined,
    onReview: (item) => void onReview(sourceOf(item), item.type === "output" ? item.job.prompt : item.asset.name),
    onToVideoScreen: (source) => window.location.assign(videoScreenHref(organizationId, source)),
    onRegionSending,
    focusPrompt,
  });

  const attachSource = useCallback(
    (source: RefSource) => {
      const item = sourceItem(source);
      if (item) dock.attach(item);
    },
    [dock, sourceItem],
  );

  // The video screen opened from "영상으로 만들기": that picture is the opening frame.
  const fromDone = useRef(false);
  useEffect(() => {
    if (fromDone.current || mode !== "video" || !state) return;
    fromDone.current = true;
    const url = new URL(window.location.href);
    const source = parseFrom(url.searchParams.get("from"));
    if (!source) return;
    const tile = sourceItem(source);
    if (tile && tile.kind === "image") {
      dock.setDraft((current) => withMedium(current, "video"));
      dock.setTray((current) => withStartFrame(current, tile));
    }
    url.searchParams.delete("from");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [dock, mode, sourceItem, state]);

  // Opened from unified Assets (`/brand/library`) with `?ref=a:<id>|o:<id>`: attach into prompt references.
  const refDone = useRef(false);
  useEffect(() => {
    if (refDone.current || !state) return;
    refDone.current = true;
    const url = new URL(window.location.href);
    const source = parseFrom(url.searchParams.get("ref"));
    if (!source) return;
    const tile = sourceItem(source);
    if (tile && (mode === "video" || tile.kind === "image")) {
      dock.attach(tile);
      focusPrompt();
    }
    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [dock, mode, sourceItem, state]);

  // Opened from unified Assets (`/brand/library`) with `?canvas=a:<id>|o:<id>`: auto-open `LayerEditor` immediately.
  const canvasDone = useRef(false);
  useEffect(() => {
    if (canvasDone.current || mode !== "image" || !state) return;
    canvasDone.current = true;
    const url = new URL(window.location.href);
    const source = parseFrom(url.searchParams.get("canvas"));
    if (!source) return;
    if (canCreate) {
      void openLayerEditor(source, { tool: "move" });
    }
    url.searchParams.delete("canvas");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [canCreate, mode, openLayerEditor, state]);

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

  // Allow Ctrl+V / Cmd+V anywhere on the Studio canvas (when no modal/editor consumed it) to attach copied images into Dock's tray.
  useEffect(() => {
    if (!dockOpen || editorState || viewer.open || handoff || shareTarget || typeof window === "undefined") return;
    const onWindowPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const inDock = Boolean(event.target && typeof (event.target as HTMLElement).closest === "function" && (event.target as HTMLElement).closest("[data-studio-dock]"));
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
  }, [dockOpen, editorState, viewer.open, handoff, shareTarget, uploadFiles, copy.tray.pasted]);

  /** Pictures picked in the partial-edit form: uploaded, then handed back as references. */
  const uploadForRegion = useCallback(
    async (files: File[]) => {
      const added: TrayItem[] = [];
      for (const file of files) {
        const problem = uploadProblem(file);
        if (problem || !file.type.startsWith("image/")) {
          setStatus(errorLine(copy, problem ?? "unsupported_file"));
          continue;
        }
        const result = await studio.upload(file);
        if (isFailure(result)) setStatus(errorLine(copy, result.code));
        else added.push(trayItemFromAsset(result.asset));
      }
      return added;
    },
    [copy, studio],
  );

  const cancel = useCallback(
    async (job: StudioJobView) => {
      setStopping(job.id);
      const result = await studio.cancelJob(job.id);
      setStopping(null);
      setJobNotes((notes) => {
        const { [job.id]: _dropped, ...rest } = notes;
        if (!isFailure(result)) return rest;
        return { ...rest, [job.id]: result.code === "conflict" ? copy.board.cancelLate : errorLine(copy, result.code) };
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
      case "region":
        return void openLayerEditor({ outputId: output.id }, { tool: "marquee" });
      case "decorate":
        return void openLayerEditor({ outputId: output.id }, { tool: "move" });
      case "toVideo":
        return viewer.actions.toVideo(item);
      case "review":
        return void onReview({ outputId: output.id }, job.prompt);
      case "campaign":
        return setHandoff({ outputId: output.id });
      case "save":
        return void studio.saveOutput(output.id).then((result) => setStatus(isFailure(result) ? errorLine(copy, result.code) : copy.viewer.saved));
      case "delete":
        return void studio.deleteOutput(output.id).then((result) => {
          if (isFailure(result)) setStatus(result.code === "conflict" ? copy.viewer.deleteBusy : errorLine(copy, result.code));
        });
      case "reference":
        dock.attach(trayItemFromOutput(output, copy.viewer.label));
        return focusPrompt();
      case "download":
        return void window.open(output.url, "_blank", "noopener,noreferrer");
    }
  };

  const openCanvasLabel = locale === "en" ? "Canvas Editor" : "캔버스 편집";
  const canvasLauncher =
    mode === "image" && canCreate ? (
      <div ref={canvasMenuWrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button
          type="button"
          className="bs-btn"
          data-variant="soft"
          data-size="sm"
          aria-haspopup="menu"
          aria-expanded={canvasMenuOpen}
          onClick={() => setCanvasMenuOpen((open) => !open)}
          data-studio-open-canvas
        >
          {openCanvasLabel}
        </button>
        {canvasMenuOpen && (
          <div
            role="menu"
            aria-label={openCanvasLabel}
            data-studio-canvas-presets
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              minWidth: 184,
              padding: 6,
              borderRadius: 14,
              background: "var(--ys-surface, #111113)",
              border: "1px solid var(--ys-line-strong, rgba(255, 255, 255, 0.18))",
              boxShadow: "var(--ys-float, none)",
              display: "grid",
              gap: 2,
            }}
          >
            {BLANK_CANVAS_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="menuitem"
                data-studio-canvas-preset={preset.id}
                onClick={() => openBlankCanvas(preset.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  minHeight: 34,
                  padding: "0 12px",
                  border: 0,
                  borderRadius: 10,
                  background: "transparent",
                  color: "var(--ys-ink, #ededed)",
                  fontFamily: "'Geist Mono', 'Geist', 'Pretendard Variable', sans-serif",
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
    ) : null;

  const libraryToggle = (
    <button type="button" className="bs-btn bs-library-toggle" data-variant="soft" data-size="sm" aria-expanded={sheet} aria-controls={panelId} onClick={() => setSheet(true)}>
      {copy.gallery.library}
    </button>
  );
  const head = (
    <>
      {state && state.allowance.capKrw > 0 && <AllowanceLine allowance={state.allowance} copy={copy} locale={locale} />}
      {state && canvasLauncher}
      {state && libraryToggle}
    </>
  );

  const handoffKind = handoff ? ((("assetId" in handoff ? lookup.asset(handoff.assetId)?.kind : lookup.output(handoff.outputId)?.kind) === "video" ? "video" : "image") as "image" | "video") : "image";
  const loading = studio.store.phase === "loading" && !state;
  const e = copy.explainer;
  const examples = EXAMPLES[mode];
  const empty = (
    <div className="bs-empty" data-studio-empty>
      {/* The video screen explains itself with its own start cards (slice C). */}
      {mode === "image" && (
        <Explainer
          storageKey="twings_studio_image_explainer_v1"
          title={e.title}
          line={e.line}
          actions={dockOpen ? [{ label: e.action, event: STUDIO_FOCUS_PROMPT, primary: true }] : []}
          stepsTitle={e.stepsTitle}
          steps={[e.steps.refs, e.steps.write, e.steps.enhance, e.steps.finish]}
          dismissLabel={e.dismiss}
          reopenLabel={e.reopen}
        />
      )}
      {dockOpen ? (
        <div className="bs-examples-block">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <p style={{ margin: 0 }}>{copy.board.emptyBody}</p>
            {mode === "image" && canCreate && (
              <button
                type="button"
                className="bs-btn"
                data-variant="soft"
                data-size="sm"
                onClick={() => openBlankCanvas("4:5")}
                data-studio-empty-open-canvas
              >
                {openCanvasLabel} · 4:5
              </button>
            )}
          </div>
          <ul className="bs-examples" data-studio-examples>
            {examples.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="bs-example"
                  onClick={() => {
                    dock.setDraft((current) => ({ ...current, prompt: copy.board.examples[key] }));
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

  return (
    <div className="bs-studio" data-studio-mode={mode} data-studio-phase={studio.store.phase} data-studio-can-create={canCreate ? "" : undefined}>
      <div className="bs-main">
        {headSlot ? createPortal(head, headSlot) : <div className="bs-toolbar">{head}</div>}
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
        {state && (
          <Wall
            mode={mode}
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
            onNotice={setStatus}
            empty={empty}
          />
        )}
        {/* Announced here; shown as a pill above the prompt bar, or as a line when there is no bar. */}
        <p className={state && dockOpen ? "bs-sr" : "bs-notice"} role="status" aria-live="polite" data-studio-status={status ? "" : undefined}>
          {status}
        </p>
        {state && dockOpen && (
          <Dock
            mode={mode}
            draft={dock.draft}
            tray={dock.tray}
            labels={trayLabels(dock.tray, copy)}
            copy={copy}
            locale={locale}
            allowance={state.allowance}
            credits={dockCredits(dock.draft, dock.tray)}
            busy={dock.busy}
            message={dock.message}
            notice={dock.notice}
            toast={status}
            film={remixVideo?.assetId ? studio.films[remixVideo.assetId] ?? null : null}
            uploading={studio.uploads.map((u) => u.name)}
            enhancing={dock.enhancing}
            enhanced={dock.enhanced}
            videoCopy={videoCopy}
            onDraft={dock.setDraft}
            onTrayUpdate={dock.update}
            onTrayRemove={dock.remove}
            onTrayMove={dock.move}
            onSubmit={() => {
              setStatus(null);
              void dock.submit().then((started) => started && setStatus(copy.state.started));
            }}
            onDropSource={attachSource}
            onFiles={(files) => void uploadFiles(files, true)}
            onBrowse={() => {
              setSheet(true);
              document.getElementById(searchId)?.focus();
            }}
            onEnhance={() => void dock.enhanceNow()}
            onUndoEnhance={dock.undoEnhance}
          />
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
      <div ref={railSlot} className="bs-rail-slot" data-studio-rail-slot>
        {state && (
          <LibraryRail
            id={panelId}
            organizationId={organizationId}
            locale={locale}
            library={library}
            assets={assets}
            outputOf={(id: string): StudioOutputView | null => findOutput(allJobs, id)}
            canCreate={canCreate}
            attachOnPress={dockOpen}
            open={sheet}
            notice={panelNotice}
            uploading={studio.uploads.map((u) => u.name)}
            searchId={searchId}
            onClose={() => setSheet(false)}
            onAttach={(source) => {
              attachSource(source);
              setSheet(false);
            }}
            onView={(source) => viewer.show("assetId" in source ? { list: "assets", key: `a:${source.assetId}` } : { list: "outputs", key: `o:${source.outputId}` })}
            onFiles={(files) => void uploadFiles(files, false)}
            onUpdate={(assetId, patch) => studio.updateAsset({ assetId, ...patch })}
            onDelete={studio.deleteAsset}
            onRegionEdit={dockOpen && mode === "image" ? (src) => void openLayerEditor(src, { tool: "marquee" }) : undefined}
            onDecorate={canCreate ? (src) => void openLayerEditor(src, { tool: "move" }) : undefined}
            copy={libraryCopy}
          />
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
          region={
            dockOpen && mode === "image"
              ? {
                  models: regionEditModels(),
                  defaultModel: regionEditModel(dock.draft),
                  defaultQuality: dock.draft.quality,
                  recent: recentPictures(jobs, assets, copy.viewer.label),
                  resolve: (source) => {
                    const tile = sourceItem(source);
                    return tile && tile.kind === "image" ? tile : null;
                  },
                  upload: uploadForRegion,
                }
              : null
          }
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
      {editorState && (
        <LayerEditor
          key={`${libraryKey(editorState.base.ref)}:${editorState.nonce}`}
          organizationId={organizationId}
          locale={locale}
          base={editorState.base}
          assets={assets}
          library={library}
          initialTool={editorState.initialTool}
          initialPatch={editorState.initialPatch}
          initialRegionPreset={editorState.initialRegionPreset}
          region={
            dockOpen && mode === "image"
              ? {
                  sourceRef: editorState.base.ref,
                  previewUrl: editorState.base.url,
                  models: regionEditModels(),
                  defaultModel: regionEditModel(dock.draft),
                  defaultQuality: dock.draft.quality,
                  jobs: allJobs,
                  errorText: (code) => errorLine(copy, code ?? "failed"),
                  submit: async (req) => {
                    let effectiveSource = req.source;
                    if (editorState.isBlankCanvas && "assetId" in effectiveSource) {
                      const cachedId = blankUploadedAssetRef.current[effectiveSource.assetId];
                      if (cachedId) {
                        effectiveSource = { assetId: cachedId };
                      } else {
                        const file = await dataUrlToPngFile(editorState.base.url, "blank-canvas.png");
                        const uploaded = await studio.upload(file);
                        if (isFailure(uploaded)) {
                          return { ok: false, message: errorLine(copy, uploaded.code) };
                        }
                        blankUploadedAssetRef.current[effectiveSource.assetId] = uploaded.asset.id;
                        effectiveSource = { assetId: uploaded.asset.id };
                      }
                    }
                    const key = newRequestId();
                    const ratio = `${editorState.base.width} / ${editorState.base.height}`;
                    onRegionSending({ key, ratio });
                    const body = regionEditInput({
                      ids: { organizationId, requestId: key },
                      source: effectiveSource,
                      box: req.box,
                      instruction: req.instruction,
                      draft: { ...dock.draft, enhance: req.enhance },
                      model: req.model,
                      quality: req.quality || null,
                      references: req.references,
                      locale,
                    });
                    const result = await studio.createJob(body);
                    const line = isFailure(result) ? errorLine(copy, result.code) : null;
                    onRegionSending({ done: key, line });
                    if (isFailure(result)) {
                      return { ok: false, message: line ?? errorLine(copy, "failed") };
                    }
                    return { ok: true, job: result.job };
                  },
                  enhancePrompt: async (req) => {
                    let effectiveSource = req.source;
                    if (editorState.isBlankCanvas && "assetId" in effectiveSource) {
                      const cachedId = blankUploadedAssetRef.current[effectiveSource.assetId];
                      if (cachedId) effectiveSource = { assetId: cachedId };
                    }
                    const built = regionEditInput({
                      ids: { organizationId, requestId: "preview-0" },
                      source: effectiveSource,
                      box: req.box,
                      instruction: req.instruction,
                      draft: { ...dock.draft, enhance: true },
                      model: req.model,
                      quality: req.quality || null,
                      references: req.references,
                      locale,
                    });
                    if (built.kind === "video_final") {
                      return { ok: false, message: copy.dock.enhanceFailed };
                    }
                    const { requestId: _dropped, ...previewInput } = built;
                    const result = await studio.enhancePrompt(previewInput as EnhancePreviewInput);
                    if (isFailure(result) || !result.prompt.trim()) {
                      return { ok: false, message: copy.dock.enhanceFailed };
                    }
                    return { ok: true, finalPrompt: result.prompt.trim() };
                  },
                }
              : null
          }
          upload={(file) => studio.upload(file)}
          onSaved={(asset) => {
            setStatus(copy.gallery.decorated);
            void asset;
          }}
          onClose={() => setEditorState(null)}
          copy={layersCopy}
        />
      )}
    </div>
  );
}
