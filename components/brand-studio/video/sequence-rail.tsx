"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { StudioAllowanceNotice } from "@/components/brand-studio/studio-allowance-notice";
import { fill as interpolate } from "@/components/brand-studio/copy";
import { isEditableTextTarget } from "@/lib/brand-studio/clipboard-image";
import type { StudioAllowanceView, StudioAssetView } from "@/lib/brand-studio/contracts";
import { creditsLeft, formatCredits } from "@/lib/brand-studio/credits";
import type { BillingPlanCatalogueItem } from "@/lib/brands/billing-ui";
import type { BrandBillingCopy } from "@/messages/brand-billing";
import {
  COMPOSE_ASPECTS,
  DEFAULT_COLOR_GRADE_SPEC,
  DEFAULT_COLOR_REGION,
  applyTimelinePatches,
  clamp,
  clipPlaybackRate,
  clipPlayDuration,
  cssFilterForColorGrade,
  detectVideoSceneCutsInBrowser,
  extractColorProfileInBrowser,
  frameStateAtTime,
  generate33CubeLutFromSpec,
  normalizeColorRegion,
  playheadClipSplitTarget,
  projectDurationSec,
  roundTenths,
  selectClipTake,
  splittableCutMediaSecs,
  stackClipTake,
  timelineSpans,
  toColorGradeSpec,
  type CaptionPosition,
  type ColorGradeProfile,
  type ComposeAspect,
  type ComposeClip,
  type ComposeColorGradeState,
  type ComposeColorPresetId,
  type ComposeColorScope,
  type ComposerProject,
  type DetectedCut,
  type TimelinePatch,
} from "@/lib/brand-studio/compose";
import { musicCredits, sfxCredits } from "@/lib/brand-studio/music/contracts";
import { upscaleCredits, type UpscaleResolution } from "@/lib/brand-studio/upscale/contracts";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { FloatingClipBar } from "./floating-clip-bar";
import w from "./video-workspace.module.css";

export type SequenceRailHeight = "compact" | "medium" | "full";
export type SequenceInspectorTab = "color" | "music" | "captions" | "upscale";

type MusicStyleKey = "frenchHouse" | "ambientCello" | "marimbaPerc" | "warmSynth";

const MUSIC_STYLES: Readonly<
  Record<
    MusicStyleKey,
    {
      presetId: string;
      leadInstrument:
        | "mellow Rhodes lead melody"
        | "warm cello lead melody"
        | "glass marimba lead motif"
        | "analog poly-synth lead melody";
      keySignature: "Dm" | "Em" | "Am" | "Fm";
      prompt: string;
    }
  >
> = {
  frenchHouse: {
    presetId: "french_house_runway_122",
    leadInstrument: "mellow Rhodes lead melody",
    keySignature: "Dm",
    prompt: "refined French house runway groove, crisp sidechained bass",
  },
  ambientCello: {
    presetId: "minimal_cello_editorial_96",
    leadInstrument: "warm cello lead melody",
    keySignature: "Em",
    prompt: "minimal editorial ambient cello, warm acoustic air",
  },
  marimbaPerc: {
    presetId: "architectural_marimba_112",
    leadInstrument: "glass marimba lead motif",
    keySignature: "Am",
    prompt: "architectural glass marimba pulse, clean modern percussion",
  },
  warmSynth: {
    presetId: "analog_synth_groove_124",
    leadInstrument: "analog poly-synth lead melody",
    keySignature: "Fm",
    prompt: "warm analog poly-synth groove, clean editorial dynamics",
  },
};

function makeReqId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function postPostProduction(
  operation: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch("/api/brand-studio/post-production", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ operation, input }),
  });
  return (await res.json().catch(() => ({ ok: false, code: "failed" }))) as Record<string, unknown>;
}

const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface SequenceRailProps {
  organizationId: string;
  organizationName?: string | null;
  locale: "ko" | "en";
  canEdit: boolean;
  project: ComposerProject;
  railHeight: SequenceRailHeight;
  selectedClipId: string | null;
  inspectorTab: SequenceInspectorTab;
  audioAssets: StudioAssetView[];
  allowance?: StudioAllowanceView | null;
  billingCopy?: BrandBillingCopy["customer"];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  railCopy: StudioVideoCopy["workspace"]["rail"];
  floatingCopy: StudioVideoCopy["workspace"]["floatingBar"];
  extendingScene?: boolean;
  /**
   * `BRAND_STUDIO_MUSIC_GENERATION`. Closed (default): no generate-music button, no music generation in the
   * inspector (its tab keeps the sound-effect generator), and the empty BGM lane does not offer generation.
   */
  musicGeneration?: boolean;
  onHeightChange(next: SequenceRailHeight): void;
  onSelectClip(clipId: string | null): void;
  onInspectorTabChange(tab: SequenceInspectorTab): void;
  onProjectChange(next: ComposerProject): void;
  onAttachClipToDock(clip: ComposeClip): void;
  onExtendNextScene?: (clip: ComposeClip) => void;
  onLocalVideoFiles(files: File[]): void;
  onNotice(text: string): void;
  onAllowanceUpdate?(allowance: StudioAllowanceView): void;
}

export function SequenceRail({
  organizationId,
  organizationName,
  locale,
  canEdit,
  project,
  railHeight,
  selectedClipId,
  inspectorTab,
  audioAssets,
  allowance,
  billingCopy,
  planCatalogue,
  railCopy,
  floatingCopy,
  extendingScene = false,
  musicGeneration = false,
  onHeightChange,
  onSelectClip,
  onInspectorTabChange,
  onProjectChange,
  onAttachClipToDock,
  onExtendNextScene,
  onLocalVideoFiles,
  onNotice,
  onAllowanceUpdate,
}: SequenceRailProps) {
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [detectingCuts, setDetectingCuts] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Inspector states
  const [analyzingRef, setAnalyzingRef] = useState(false);
  const [musicStyle, setMusicStyle] = useState<MusicStyleKey>("frenchHouse");
  const [musicBpm, setMusicBpm] = useState(122);
  const [musicRefLabel, setMusicRefLabel] = useState<string | null>(null);
  const [musicRefAssetId, setMusicRefAssetId] = useState<string | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [sfxPrompt, setSfxPrompt] = useState("");
  const [sfxBusy, setSfxBusy] = useState(false);
  const [captionText, setCaptionText] = useState("");
  const [captionPos, setCaptionPos] = useState<CaptionPosition>("bottom");
  const [upscaleRes, setUpscaleRes] = useState<UpscaleResolution>(1080);
  const [upscaleColor, setUpscaleColor] = useState<"lab" | "wavelet">("lab");
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [postProdAllowanceError, setPostProdAllowanceError] = useState<{
    code: "allowance_closed" | "allowance_exhausted";
    neededCredits: number | null;
  } | null>(null);

  const localVideoInputRef = useRef<HTMLInputElement>(null);
  const gradeRefInputRef = useRef<HTMLInputElement>(null);
  const musicRefInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const spans = useMemo(() => timelineSpans(project), [project]);
  const totalSec = useMemo(() => projectDurationSec(project), [project]);

  const selectedIdx = useMemo(
    () => (selectedClipId ? project.clips.findIndex((c) => c.id === selectedClipId) : -1),
    [project.clips, selectedClipId],
  );
  const selectedClip = selectedIdx >= 0 ? (project.clips[selectedIdx] ?? null) : null;

  const applyPatches = useCallback(
    (patches: readonly TimelinePatch[]): ComposerProject => {
      const { project: next } = applyTimelinePatches(project, patches);
      onProjectChange(next);
      return next;
    },
    [onProjectChange, project],
  );

  // Delete / Backspace shortcut when a clip is selected on the Sequence Rail
  useEffect(() => {
    if (!canEdit || !selectedClip) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTextTarget(event.target)) return;
      if (event.key === "Delete") {
        event.preventDefault();
        const nextIdx = Math.max(0, selectedIdx - 1);
        const updated = applyPatches([{ op: "remove_clip", clipIndex: selectedIdx }]);
        onSelectClip(updated.clips[nextIdx]?.id ?? null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyPatches, canEdit, onSelectClip, selectedClip, selectedIdx]);

  // Playback loop in `full` mode
  const frameAtPlayhead = useMemo(
    () => frameStateAtTime(project, playheadSec),
    [playheadSec, project],
  );
  const liveCssFilter = useMemo(
    () => cssFilterForColorGrade(toColorGradeSpec(frameAtPlayhead.activeColorGrade)),
    [frameAtPlayhead.activeColorGrade],
  );

  useEffect(() => {
    if (railHeight !== "full" && playing) {
      setPlaying(false);
    }
  }, [playing, railHeight]);

  useEffect(() => {
    const v = previewVideoRef.current;
    const active = frameAtPlayhead.activeClip;
    if (!v || !active || railHeight !== "full") return;
    if (v.getAttribute("data-src") !== active.clip.srcUrl) {
      v.setAttribute("data-src", active.clip.srcUrl);
      v.src = active.clip.srcUrl;
    }
    // Play at the cut's speed, as the exported file does (a new source resets the rate to the default one).
    const rate = clipPlaybackRate(active.clip);
    if (v.defaultPlaybackRate !== rate) v.defaultPlaybackRate = rate;
    if (v.playbackRate !== rate) v.playbackRate = rate;
    if (Math.abs(v.currentTime - active.mediaTimeSec) > 0.35 * rate) {
      try {
        v.currentTime = active.mediaTimeSec;
      } catch {
        // Metadata still loading
      }
    }
    if (playing && v.paused) void v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [frameAtPlayhead.activeClip, playing, railHeight]);

  useEffect(() => {
    if (!playing || totalSec <= 0 || railHeight !== "full") return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      setPlayheadSec((cur) => {
        if (cur + dt >= totalSec) {
          setPlaying(false);
          return 0;
        }
        return cur + dt;
      });
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, railHeight, totalSec]);

  /* ------------------------------------------------ Floating Bar & Timeline Actions */

  const handleTrimAction = () => {
    if (!canEdit || !selectedClip || selectedIdx < 0) return;
    const splitTarget = playheadClipSplitTarget(project, playheadSec);
    if (splitTarget && splitTarget.clipIndex === selectedIdx && railHeight === "full") {
      applyPatches([{ op: "split_clip_at", clipIndex: selectedIdx, atMediaSec: splitTarget.atMediaSec }]);
      return;
    }
    const mid = roundTenths((selectedClip.trimStartSec + selectedClip.trimEndSec) / 2);
    if (
      railHeight !== "compact" &&
      mid >= roundTenths(selectedClip.trimStartSec + 0.3) &&
      mid <= roundTenths(selectedClip.trimEndSec - 0.3)
    ) {
      applyPatches([{ op: "split_clip_at", clipIndex: selectedIdx, atMediaSec: mid }]);
      return;
    }
    onHeightChange("medium");
  };

  const handleDetectCuts = async () => {
    if (!canEdit || !selectedClip || selectedIdx < 0 || detectingCuts) return;
    setDetectingCuts(true);
    try {
      // Only what the browser analysis found: the server has no analysis of its own and never guesses a cut.
      let detected: DetectedCut[] = [];
      try {
        detected = await detectVideoSceneCutsInBrowser(selectedClip.srcUrl, {
          minShotSec: 0.4,
          maxDurationSec: Math.min(120, selectedClip.durationSec),
        });
      } catch {
        detected = [];
      }

      const cutMarkers = detected
        .map((c) => Number(c.timeSec))
        .filter((n) => Number.isFinite(n) && n > 0.05 && n < selectedClip.durationSec - 0.05);

      const valid = splittableCutMediaSecs(selectedClip, cutMarkers);
      if (valid.length > 0) {
        applyPatches([
          { op: "set_clip_cuts", clipIndex: selectedIdx, cutMarkers },
          { op: "split_clip_cuts", clipIndex: selectedIdx, cutMediaSecs: valid },
        ]);
      } else {
        applyPatches([{ op: "set_clip_cuts", clipIndex: selectedIdx, cutMarkers }]);
        onNotice(railCopy.noCutsDetected);
      }
      if (railHeight === "compact") onHeightChange("medium");
    } finally {
      setDetectingCuts(false);
    }
  };

  const handleOpenColorGrade = () => {
    onInspectorTabChange("color");
    onHeightChange("full");
    if (canEdit && selectedClip && !project.colorGrade?.enabled) {
      applyPatches([
        {
          op: "set_color_grade",
          enabled: true,
          scope: "selected_clip",
          clipId: selectedClip.id,
          clipIndex: selectedIdx,
          presetId: "twings-french-blue",
        },
      ]);
    }
  };

  const handleOpenMusicGen = () => {
    onInspectorTabChange("music");
    onHeightChange("full");
  };

  const handleOpenUpscale = () => {
    onInspectorTabChange("upscale");
    onHeightChange("full");
  };

  const handleDeleteSelected = () => {
    if (!canEdit || selectedIdx < 0) return;
    const nextIdx = Math.max(0, selectedIdx - 1);
    const updated = applyPatches([{ op: "remove_clip", clipIndex: selectedIdx }]);
    onSelectClip(updated.clips[nextIdx]?.id ?? null);
  };

  /* ------------------------------------------------ Inspector Operations */

  const currentGrade: ComposeColorGradeState = useMemo(
    () =>
      project.colorGrade ?? {
        enabled: false,
        scope: "full_timeline",
        clipId: null,
        clipIndex: null,
        region: DEFAULT_COLOR_REGION,
        presetId: null,
        referenceLabel: null,
        referenceUrl: null,
        referenceAssetId: null,
        referenceOutputId: null,
        referenceProfile: null,
        intensity: 0.85,
        skinProtect: 0.7,
        grain: 2.0,
        halation: 0.04,
      },
    [project.colorGrade],
  );

  const handleSetGradeScope = (scope: ComposeColorScope) => {
    if (!canEdit) return;
    applyPatches([
      {
        op: "set_color_grade",
        enabled: true,
        scope,
        clipId: scope === "selected_clip" ? (selectedClip?.id ?? project.clips[0]?.id ?? null) : null,
        clipIndex: scope === "selected_clip" ? Math.max(0, selectedIdx) : null,
        region: scope === "region" ? normalizeColorRegion(currentGrade.region ?? DEFAULT_COLOR_REGION) : currentGrade.region,
        presetId: currentGrade.presetId ?? "twings-french-blue",
        intensity: currentGrade.intensity,
        skinProtect: currentGrade.skinProtect,
        grain: currentGrade.grain,
        halation: currentGrade.halation,
      },
    ]);
  };

  const handleSelectGradePreset = (presetId: ComposeColorPresetId) => {
    if (!canEdit) return;
    applyPatches([
      {
        op: "set_color_grade",
        enabled: true,
        scope: currentGrade.scope,
        clipId: currentGrade.scope === "selected_clip" ? (selectedClip?.id ?? currentGrade.clipId ?? null) : null,
        clipIndex: currentGrade.scope === "selected_clip" ? Math.max(0, selectedIdx) : null,
        presetId,
        intensity: currentGrade.intensity,
        skinProtect: currentGrade.skinProtect,
        grain: currentGrade.grain,
        halation: currentGrade.halation,
      },
    ]);
  };

  const handleGradeRefUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canEdit) return;
    setAnalyzingRef(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const isVideo = file.type.startsWith("video/") || /\.(mp4|mov)$/i.test(file.name);
      let profile: ColorGradeProfile | null = null;
      try {
        profile = await extractColorProfileInBrowser(objectUrl, isVideo ? "video" : "image");
      } catch {
        profile = null;
      }
      // The reference could not be read: apply nothing rather than a made-up look (E2).
      if (!profile) return;
      try {
        const res = await postPostProduction("grade.analyze", {
          organizationId,
          referenceProfile: profile,
          referenceLabel: file.name,
          scope: currentGrade.scope,
          targetClipId: currentGrade.scope === "selected_clip" ? (selectedClip?.id ?? null) : null,
          intensity: currentGrade.intensity,
          skinProtect: currentGrade.skinProtect,
          grain: currentGrade.grain,
          halation: currentGrade.halation,
        });
        if (res.ok === true && res.profile && typeof res.profile === "object") {
          profile = res.profile as ColorGradeProfile;
        }
      } catch {
        // Offline / local fallback
      }
      applyPatches([
        {
          op: "set_color_grade",
          enabled: true,
          scope: currentGrade.scope,
          clipId: currentGrade.scope === "selected_clip" ? (selectedClip?.id ?? null) : null,
          clipIndex: currentGrade.scope === "selected_clip" ? Math.max(0, selectedIdx) : null,
          referenceLabel: file.name.slice(0, 60),
          referenceProfile: profile,
          intensity: currentGrade.intensity,
          skinProtect: currentGrade.skinProtect,
          grain: currentGrade.grain,
          halation: currentGrade.halation,
        },
      ]);
    } finally {
      URL.revokeObjectURL(objectUrl);
      setAnalyzingRef(false);
    }
  };

  const targetMusicDuration = useMemo(() => {
    const raw = selectedClip ? clipPlayDuration(selectedClip) : totalSec;
    return clamp(Math.round(raw > 0 ? raw : 15), 5, 60);
  }, [selectedClip, totalSec]);

  const musicCostCredits = useMemo(() => musicCredits(targetMusicDuration), [targetMusicDuration]);

  const handleGenerateMusic = async () => {
    if (!canEdit || musicBusy) return;
    setMusicBusy(true);
    setPostProdAllowanceError(null);
    try {
      const spec = MUSIC_STYLES[musicStyle];
      let current = await postPostProduction("music.generate", {
        organizationId,
        requestId: makeReqId("mus"),
        presetId: spec.presetId,
        prompt: `${spec.prompt}, pure instrumental arrangement without vocals`,
        bpm: musicBpm,
        keySignature: spec.keySignature,
        leadInstrument: spec.leadInstrument,
        durationSec: targetMusicDuration,
        ...(musicRefAssetId ? { refAudioAssetId: musicRefAssetId } : {}),
      });

      let polls = 0;
      while (
        current.ok === true &&
        (current.status === "running" || current.status === "queued") &&
        typeof current.jobId === "string" &&
        polls < 20
      ) {
        await waitMs(350);
        current = await postPostProduction("music.status", {
          organizationId,
          jobId: current.jobId,
        });
        polls += 1;
      }

      if (current.allowance && typeof current.allowance === "object") {
        onAllowanceUpdate?.(current.allowance as StudioAllowanceView);
      }

      if (current.ok !== true || current.status !== "succeeded") {
        if (current.code === "allowance_closed" || current.code === "allowance_exhausted") {
          setPostProdAllowanceError({ code: current.code, neededCredits: musicCostCredits });
        }
        return;
      }
      const assetId = typeof current.assetId === "string" ? current.assetId : undefined;
      const srcUrl =
        (typeof current.audioUrl === "string" && current.audioUrl) ||
        (typeof current.dataUrl === "string" && current.dataUrl) ||
        (assetId ? `/api/brand-studio/compose?organizationId=${organizationId}&source=asset&id=${assetId}` : "");
      if (srcUrl) {
        onProjectChange({
          ...project,
          bgm: {
            label: `${railCopy.inspector.musicStyles[musicStyle]} (${musicBpm} BPM)`,
            sourceKind: "asset",
            ...(assetId ? { assetId } : {}),
            srcUrl,
            durationSec: typeof current.durationSec === "number" ? current.durationSec : targetMusicDuration,
            trimStartSec: 0,
            volume: 0.45,
            nonCommercialGuide: current.commercialAllowed === true ? false : current.nonCommercialOnly !== false,
          },
        });
      }
    } finally {
      setMusicBusy(false);
    }
  };

  const sfxCostCredits = useMemo(() => sfxCredits(4), []);

  const handleGenerateSfx = async () => {
    const text = sfxPrompt.trim();
    if (!canEdit || !text || sfxBusy) return;
    setSfxBusy(true);
    setPostProdAllowanceError(null);
    try {
      let current = await postPostProduction("sfx.generate", {
        organizationId,
        requestId: makeReqId("sfx"),
        text,
        durationSec: 4,
      });
      let polls = 0;
      while (
        current.ok === true &&
        (current.status === "running" || current.status === "queued") &&
        typeof current.jobId === "string" &&
        polls < 20
      ) {
        await waitMs(350);
        current = await postPostProduction("sfx.status", {
          organizationId,
          jobId: current.jobId,
        });
        polls += 1;
      }
      if (current.allowance && typeof current.allowance === "object") {
        onAllowanceUpdate?.(current.allowance as StudioAllowanceView);
      }
      if (current.ok !== true || current.status !== "succeeded") {
        if (current.code === "allowance_closed" || current.code === "allowance_exhausted") {
          setPostProdAllowanceError({ code: current.code, neededCredits: sfxCostCredits });
        }
        return;
      }
      const assetId = typeof current.assetId === "string" ? current.assetId : undefined;
      const srcUrl =
        (typeof current.audioUrl === "string" && current.audioUrl) ||
        (typeof current.dataUrl === "string" && current.dataUrl) ||
        (assetId ? `/api/brand-studio/compose?organizationId=${organizationId}&source=asset&id=${assetId}` : "");
      if (srcUrl) {
        applyPatches([
          {
            op: "add_sfx",
            label: text.slice(0, 28),
            sourceKind: "asset",
            ...(assetId ? { assetId } : {}),
            srcUrl,
            startSec: roundTenths(playheadSec),
            durationSec: typeof current.durationSec === "number" ? current.durationSec : 4,
            volume: 0.85,
          },
        ]);
        setSfxPrompt("");
      }
    } finally {
      setSfxBusy(false);
    }
  };

  const handleDownloadCubeLut = () => {
    const spec = toColorGradeSpec(currentGrade) ?? {
      ...DEFAULT_COLOR_GRADE_SPEC,
      enabled: true,
      intensity: currentGrade.intensity,
      skinProtect: currentGrade.skinProtect,
      grain: currentGrade.grain,
      halation: currentGrade.halation,
    };
    const cube = generate33CubeLutFromSpec(spec, currentGrade.referenceLabel ?? "TWINGS Studio Look");
    const blob = new Blob([cube], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "twings-grade-33.cube";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleAddCaption = (event: FormEvent) => {
    event.preventDefault();
    const text = captionText.trim();
    if (!canEdit || !text) return;
    applyPatches([
      {
        op: "add_caption",
        text,
        startSec: roundTenths(playheadSec),
        durationSec: 2.5,
        position: captionPos,
        size: "md",
      },
    ]);
    setCaptionText("");
  };

  const targetUpscaleClip = selectedClip ?? project.clips[0] ?? null;
  const upscaleDuration = targetUpscaleClip ? clipPlayDuration(targetUpscaleClip) : Math.max(1, totalSec || 5);
  const upscaleCostCredits = useMemo(
    () => upscaleCredits(upscaleRes, upscaleDuration, "video"),
    [upscaleDuration, upscaleRes],
  );

  const handleRunUpscale = async () => {
    if (!canEdit || !targetUpscaleClip || upscaleBusy) return;
    setUpscaleBusy(true);
    setPostProdAllowanceError(null);
    try {
      let current = await postPostProduction("upscale.submit", {
        organizationId,
        requestId: makeReqId("ups"),
        kind: "video",
        ...(targetUpscaleClip.assetId ? { assetId: targetUpscaleClip.assetId } : {}),
        ...(!targetUpscaleClip.assetId && targetUpscaleClip.outputId ? { outputId: targetUpscaleClip.outputId } : {}),
        sourceUrl: targetUpscaleClip.srcUrl,
        resolution: upscaleRes,
        durationSec: upscaleDuration,
        shotCutSeconds: targetUpscaleClip.cutMarkers ?? [],
        batchSize: 21,
        colorCorrection: upscaleColor,
      });

      let polls = 0;
      while (
        current.ok === true &&
        (current.status === "running" || current.status === "queued") &&
        typeof current.jobId === "string" &&
        polls < 25
      ) {
        await waitMs(350);
        current = await postPostProduction("upscale.status", {
          organizationId,
          jobId: current.jobId,
        });
        polls += 1;
      }

      if (current.allowance && typeof current.allowance === "object") {
        onAllowanceUpdate?.(current.allowance as StudioAllowanceView);
      }

      if (current.ok !== true || current.status !== "succeeded") {
        if (current.code === "allowance_closed" || current.code === "allowance_exhausted") {
          setPostProdAllowanceError({ code: current.code, neededCredits: upscaleCostCredits });
        }
        return;
      }

      const newAssetId = typeof current.assetId === "string" ? current.assetId : undefined;
      const newUrl =
        (typeof current.url === "string" && current.url) ||
        (typeof current.outputUrl === "string" && current.outputUrl) ||
        targetUpscaleClip.srcUrl;
      const stacked = stackClipTake(project, targetUpscaleClip.id, {
        label: `${targetUpscaleClip.label} (${upscaleRes === 2160 ? "4K" : `${upscaleRes}p`})`,
        sourceKind: newAssetId ? "asset" : targetUpscaleClip.sourceKind,
        ...(newAssetId ? { assetId: newAssetId } : {}),
        ...(!newAssetId && targetUpscaleClip.outputId ? { outputId: targetUpscaleClip.outputId } : {}),
        srcUrl: newUrl,
        thumbUrl: targetUpscaleClip.thumbUrl ?? null,
        durationSec: targetUpscaleClip.durationSec,
        trimStartSec: targetUpscaleClip.trimStartSec,
        trimEndSec: targetUpscaleClip.trimEndSec,
      });
      onProjectChange(stacked);
    } finally {
      setUpscaleBusy(false);
    }
  };

  /* ------------------------------------------------ Drag Reorder Handlers */

  const onClipDragStart = (event: DragEvent, index: number) => {
    if (!canEdit) return;
    setDragFromIdx(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  };

  const onClipDrop = (event: DragEvent, targetIndex: number) => {
    event.preventDefault();
    const from = dragFromIdx ?? Number(event.dataTransfer.getData("text/plain"));
    setDragFromIdx(null);
    if (!canEdit || !Number.isInteger(from) || from < 0 || from === targetIndex) return;
    applyPatches([{ op: "move_clip", fromIndex: from, toIndex: targetIndex }]);
  };

  const renderClipCard = (clip: ComposeClip, idx: number) => {
    const isSelected = clip.id === selectedClipId;
    const playSec = clipPlayDuration(clip);
    const takes = clip.takes ?? [];
    const hasMultiTakes = takes.length > 1;
    const activeTakeIdx = clamp(clip.activeTakeIndex ?? takes.length - 1, 0, Math.max(0, takes.length - 1));
    const splittableCuts = splittableCutMediaSecs(clip, clip.cutMarkers ?? []);

    return (
      <div
        key={clip.id}
        role="button"
        tabIndex={0}
        draggable={canEdit}
        aria-pressed={isSelected}
        className={w.seqClipCard}
        data-sequence-clip={clip.id}
        data-selected={isSelected ? "" : undefined}
        onClick={() => onSelectClip(isSelected && railHeight === "compact" ? null : clip.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectClip(clip.id);
          } else if (canEdit && e.altKey && e.key === "ArrowLeft" && idx > 0) {
            e.preventDefault();
            applyPatches([{ op: "move_clip", fromIndex: idx, toIndex: idx - 1 }]);
          } else if (canEdit && e.altKey && e.key === "ArrowRight" && idx < project.clips.length - 1) {
            e.preventDefault();
            applyPatches([{ op: "move_clip", fromIndex: idx, toIndex: idx + 1 }]);
          }
        }}
        onDragStart={(e) => onClipDragStart(e, idx)}
        onDragOver={(e) => {
          if (canEdit) e.preventDefault();
        }}
        onDrop={(e) => onClipDrop(e, idx)}
      >
        <div className={w.seqClipThumbWrap}>
          {clip.thumbUrl ? (
            <img src={clip.thumbUrl} alt={clip.label} className={w.seqClipThumb} />
          ) : (
            <video src={clip.srcUrl} muted playsInline preload="metadata" className={w.seqClipThumb} />
          )}
          <span className={w.seqClipOrderBadge}>{idx + 1}</span>
          <span className={w.seqClipDurationBadge}>{playSec}s</span>

          {hasMultiTakes && (
            <span
              className={w.takeStackPill}
              data-clip-take-stack={clip.id}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={w.takeChevronBtn}
                aria-label={railCopy.prevTake}
                disabled={!canEdit || activeTakeIdx <= 0}
                onClick={() => onProjectChange(selectClipTake(project, clip.id, activeTakeIdx - 1))}
                data-clip-take-prev={clip.id}
              >
                ‹
              </button>
              <span className={w.takeStackCount}>
                {interpolate(railCopy.takePill, {
                  current: activeTakeIdx + 1,
                  total: takes.length,
                })}
              </span>
              <button
                type="button"
                className={w.takeChevronBtn}
                aria-label={railCopy.nextTake}
                disabled={!canEdit || activeTakeIdx >= takes.length - 1}
                onClick={() => onProjectChange(selectClipTake(project, clip.id, activeTakeIdx + 1))}
                data-clip-take-next={clip.id}
              >
                ›
              </button>
            </span>
          )}
        </div>

        {railHeight !== "compact" && (
          <div className={w.seqClipDetail} onClick={(e) => e.stopPropagation()}>
            <div className={w.seqClipTitleRow}>
              <span className={w.seqClipTitleText} title={clip.label}>
                {clip.label}
              </span>
              <div className={w.seqMoveArrows}>
                <button
                  type="button"
                  className={w.seqArrowBtn}
                  aria-label={railCopy.moveLeft}
                  disabled={!canEdit || idx === 0}
                  onClick={() => applyPatches([{ op: "move_clip", fromIndex: idx, toIndex: idx - 1 }])}
                  data-clip-move-left={clip.id}
                >
                  ←
                </button>
                <button
                  type="button"
                  className={w.seqArrowBtn}
                  aria-label={railCopy.moveRight}
                  disabled={!canEdit || idx === project.clips.length - 1}
                  onClick={() => applyPatches([{ op: "move_clip", fromIndex: idx, toIndex: idx + 1 }])}
                  data-clip-move-right={clip.id}
                >
                  →
                </button>
              </div>
            </div>

            <div className={w.seqTrimRow}>
              <label className={w.seqTrimField}>
                <span>{railCopy.trimIn}</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={Math.max(0, roundTenths(clip.trimEndSec - 0.3))}
                  value={clip.trimStartSec}
                  disabled={!canEdit}
                  onChange={(e) =>
                    applyPatches([
                      { op: "trim_clip", clipIndex: idx, trimStartSec: Number(e.target.value) },
                    ])
                  }
                  data-clip-trim-in={clip.id}
                />
              </label>
              <label className={w.seqTrimField}>
                <span>{railCopy.trimOut}</span>
                <input
                  type="number"
                  step={0.1}
                  min={roundTenths(clip.trimStartSec + 0.3)}
                  max={clip.durationSec}
                  value={clip.trimEndSec}
                  disabled={!canEdit}
                  onChange={(e) =>
                    applyPatches([
                      { op: "trim_clip", clipIndex: idx, trimEndSec: Number(e.target.value) },
                    ])
                  }
                  data-clip-trim-out={clip.id}
                />
              </label>
            </div>

            {/* Only the cut points inside this cut's trim, the ones its split button uses: a piece of a split
                source keeps the source's points, and none of those may fall inside it (E2). */}
            {splittableCuts.length > 0 && (
              <div className={w.seqCutMarkerRow} data-clip-cut-markers={clip.id}>
                <span className={w.seqCutBadge}>
                  {interpolate(railCopy.cutMarkersBadge, { count: splittableCuts.length })}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className={w.seqSplitCutsBtn}
                    onClick={() =>
                      applyPatches([
                        { op: "split_clip_cuts", clipIndex: idx, cutMediaSecs: splittableCuts },
                      ])
                    }
                    data-clip-split-cuts={clip.id}
                  >
                    {interpolate(railCopy.splitDetectedBtn, { count: splittableCuts.length })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={w.sequenceRailStack}>
      {selectedClip && (
        <FloatingClipBar
          clip={selectedClip}
          clipIndex={selectedIdx}
          canEdit={canEdit}
          detectingCuts={detectingCuts}
          extendingScene={extendingScene}
          copy={floatingCopy}
          onTrim={handleTrimAction}
          onDetectCuts={() => void handleDetectCuts()}
          onColorGrade={handleOpenColorGrade}
          onAttachAsReference={() => onAttachClipToDock(selectedClip)}
          onExtendScene={onExtendNextScene ? () => onExtendNextScene(selectedClip) : undefined}
          onGenerateMusic={musicGeneration ? handleOpenMusicGen : undefined}
          onUpscale={handleOpenUpscale}
          onDelete={handleDeleteSelected}
        />
      )}

      <section
        className={w.sequenceRail}
        aria-label={railCopy.label}
        data-sequence-rail
        data-rail-height={railHeight}
      >
        <input
          ref={localVideoInputRef}
          type="file"
          accept="video/mp4,video/quicktime"
          multiple
          hidden
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (list.length > 0) onLocalVideoFiles(list);
          }}
        />
        <input
          ref={gradeRefInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
          hidden
          onChange={(e) => void handleGradeRefUpload(e)}
        />
        <input
          ref={musicRefInputRef}
          type="file"
          accept="audio/mpeg,audio/wav"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) {
              setMusicRefLabel(f.name);
              onNotice(f.name);
            }
          }}
        />

        <div className={w.seqHeaderBar}>
          <div className={w.seqHeaderStart}>
            <span className={w.seqTitle}>{railCopy.label}</span>
            <span className={w.seqTotalBadge} data-sequence-total-duration>
              {interpolate(railCopy.totalDuration, {
                clips: project.clips.length,
                seconds: totalSec,
              })}
            </span>
            {totalSec >= 30 && (
              <span className={w.seqTotalBadge} data-sequence-over30-badge>
                {railCopy.over30Badge}
              </span>
            )}
            {railHeight === "full" && (
              <div className={w.seqAspectPills}>
                {COMPOSE_ASPECTS.map((asp: ComposeAspect) => (
                  <button
                    key={asp}
                    type="button"
                    className={w.seqHeightBtn}
                    aria-pressed={project.aspect === asp}
                    disabled={!canEdit}
                    onClick={() => applyPatches([{ op: "set_aspect", aspect: asp }])}
                    data-sequence-aspect={asp}
                  >
                    {asp}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={w.seqHeaderEnd}>
            {canEdit && onExtendNextScene && project.clips.length > 0 && (
              <button
                type="button"
                className={w.seqUploadBtn}
                disabled={extendingScene}
                onClick={() => onExtendNextScene(selectedClip ?? project.clips[project.clips.length - 1]!)}
                data-sequence-extend-scene
              >
                {extendingScene ? floatingCopy.extendingScene : railCopy.extendNextSceneBtn}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className={w.seqUploadBtn}
                onClick={() => localVideoInputRef.current?.click()}
                data-rail-upload-local
              >
                {railCopy.uploadLocalBtn}
              </button>
            )}
            <div className={w.seqHeightGroup} role="group" aria-label={railCopy.label}>
              {(["compact", "medium", "full"] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={w.seqHeightBtn}
                  aria-pressed={railHeight === h}
                  onClick={() => onHeightChange(h)}
                  data-rail-set-height={h}
                >
                  {h === "compact"
                    ? railCopy.heightCompact
                    : h === "medium"
                      ? railCopy.heightMedium
                      : railCopy.heightFull}
                </button>
              ))}
            </div>
          </div>
        </div>

        {railHeight === "compact" && (
          <div className={w.seqCompactBody} data-sequence-filmstrip>
            {project.clips.length === 0 ? (
              <p className={w.seqEmptyHint}>{railCopy.emptyHint}</p>
            ) : (
              <div className={w.seqClipRow}>{project.clips.map(renderClipCard)}</div>
            )}
          </div>
        )}

        {railHeight === "medium" && (
          <div className={w.seqMediumBody}>
            <div className={w.seqClipRow} data-sequence-filmstrip>
              {project.clips.length === 0 ? (
                <p className={w.seqEmptyHint}>{railCopy.emptyHint}</p>
              ) : (
                project.clips.map(renderClipCard)
              )}
            </div>

            <div className={w.seqAuxLanes}>
              <div className={w.seqTrackLane} data-sequence-bgm-lane>
                {project.bgm ? (
                  <>
                    <span>{interpolate(railCopy.bgmActive, { label: project.bgm.label })}</span>
                    {canEdit && (
                      <button
                        type="button"
                        className={w.seqLaneAction}
                        onClick={() => applyPatches([{ op: "remove_bgm" }])}
                      >
                        {railCopy.bgmRemove}
                      </button>
                    )}
                  </>
                ) : musicGeneration ? (
                  <button
                    type="button"
                    className={w.seqLaneGhost}
                    onClick={handleOpenMusicGen}
                  >
                    {railCopy.bgmEmpty}
                  </button>
                ) : (
                  <span>{railCopy.bgmNone}</span>
                )}
              </div>

              <div className={w.seqTrackLane} data-sequence-caption-lane>
                <button
                  type="button"
                  className={w.seqLaneGhost}
                  onClick={() => {
                    onInspectorTabChange("captions");
                    onHeightChange("full");
                  }}
                >
                  {project.captions.length > 0
                    ? interpolate(railCopy.captionsCount, { count: project.captions.length })
                    : railCopy.captionsEmpty}
                </button>
              </div>
            </div>
          </div>
        )}

        {railHeight === "full" && (
          <div className={w.seqFullGrid}>
            <div className={w.seqPreviewCol}>
              <div className={w.seqMonitorFrame} data-sequence-monitor>
                {frameAtPlayhead.activeClip ? (
                  <video
                    ref={previewVideoRef}
                    className={w.seqMonitorVideo}
                    style={liveCssFilter ? { filter: liveCssFilter } : undefined}
                    muted={frameAtPlayhead.activeClip.clip.muted}
                    playsInline
                  />
                ) : (
                  <div className={w.seqMonitorEmpty}>{railCopy.emptyHint}</div>
                )}

                {frameAtPlayhead.activeCaptions.map((cap) => (
                  <div key={cap.id} className={w.seqMonitorCaption} data-pos={cap.position}>
                    {cap.text}
                  </div>
                ))}
              </div>

              <div className={w.seqTransportRow}>
                <button
                  type="button"
                  className={w.seqHeightBtn}
                  disabled={totalSec <= 0}
                  onClick={() => setPlaying((p) => !p)}
                  data-sequence-play-toggle
                >
                  {playing ? railCopy.pausePreview : railCopy.playPreview}
                </button>
                <input
                  type="range"
                  className={w.seqScrubber}
                  min={0}
                  max={Math.max(0.1, totalSec)}
                  step={0.1}
                  value={Math.min(playheadSec, Math.max(0, totalSec))}
                  onChange={(e) => {
                    setPlaying(false);
                    setPlayheadSec(Number(e.target.value));
                  }}
                  data-sequence-scrubber
                />
                <span className={w.seqTimecode}>
                  {roundTenths(playheadSec)}s / {totalSec}s
                </span>
              </div>
            </div>

            <div className={w.seqTracksCol}>
              <div className={w.seqClipRow} data-sequence-filmstrip>
                {project.clips.length === 0 ? (
                  <p className={w.seqEmptyHint}>{railCopy.emptyHint}</p>
                ) : (
                  project.clips.map(renderClipCard)
                )}
              </div>

              <div className={w.seqAuxLanes}>
                <div className={w.seqTrackLane} data-sequence-bgm-lane>
                  {project.bgm ? (
                    <>
                      <span>{interpolate(railCopy.bgmActive, { label: project.bgm.label })}</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={project.bgm.volume}
                        disabled={!canEdit}
                        onChange={(e) =>
                          applyPatches([{ op: "set_bgm_volume", volume: Number(e.target.value) }])
                        }
                      />
                      {canEdit && (
                        <button
                          type="button"
                          className={w.seqLaneAction}
                          onClick={() => applyPatches([{ op: "remove_bgm" }])}
                        >
                          {railCopy.bgmRemove}
                        </button>
                      )}
                    </>
                  ) : (
                    <span>{musicGeneration ? railCopy.bgmEmpty : railCopy.bgmNone}</span>
                  )}
                </div>

                <div className={w.seqTrackLane} data-sequence-caption-lane>
                  <span>
                    {project.captions.length > 0
                      ? interpolate(railCopy.captionsCount, { count: project.captions.length })
                      : railCopy.captionsEmpty}
                  </span>
                  {spans.length > 0 && project.captions.length > 0 && (
                    <div className={w.seqCaptionChips}>
                      {project.captions.map((cap, cIdx) => (
                        <span key={cap.id} className={w.seqCaptionChip}>
                          {cap.text}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => applyPatches([{ op: "remove_caption", captionIndex: cIdx }])}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className={w.seqMultiTrackPanel} data-nle-multitrack>
                  {selectedClip && selectedIdx >= 0 && (
                    <div className={w.seqNleControlRow} data-nle-clip-controls={selectedClip.id}>
                      <span>{railCopy.speedLabel}</span>
                      {([0.5, 1, 1.5, 2] as const).map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          className={w.seqHeightBtn}
                          aria-pressed={Math.abs((selectedClip.playbackRate ?? 1) - rate) < 0.05}
                          disabled={!canEdit}
                          onClick={() =>
                            applyPatches([{ op: "set_clip_speed", clipIndex: selectedIdx, playbackRate: rate }])
                          }
                          data-nle-speed={rate}
                        >
                          {rate}x
                        </button>
                      ))}
                      <button
                        type="button"
                        className={w.seqLaneAction}
                        disabled={!canEdit}
                        onClick={() => applyPatches([{ op: "slip_clip", clipIndex: selectedIdx, deltaSec: -0.5 }])}
                        data-nle-slip="back"
                      >
                        {railCopy.slipBack}
                      </button>
                      <button
                        type="button"
                        className={w.seqLaneAction}
                        disabled={!canEdit}
                        onClick={() => applyPatches([{ op: "slip_clip", clipIndex: selectedIdx, deltaSec: 0.5 }])}
                        data-nle-slip="forward"
                      >
                        {railCopy.slipForward}
                      </button>
                      <button
                        type="button"
                        className={w.seqLaneAction}
                        disabled={!canEdit}
                        onClick={() =>
                          applyPatches([{ op: "set_clip_audio_offset", clipIndex: selectedIdx, audioOffsetSec: -0.5 }])
                        }
                        data-nle-audio-offset="lead"
                      >
                        {railCopy.audioLead}
                      </button>
                      <button
                        type="button"
                        className={w.seqLaneAction}
                        disabled={!canEdit}
                        onClick={() =>
                          applyPatches([{ op: "set_clip_audio_offset", clipIndex: selectedIdx, audioOffsetSec: 0.5 }])
                        }
                        data-nle-audio-offset="lag"
                      >
                        {railCopy.audioLag}
                      </button>
                      {/* No transition control: a dissolve plays in neither the preview nor the MP4, only in the
                          XML export (E5 renders it). A stored transition still goes to that export unchanged. */}
                    </div>
                  )}

                  <div className={w.seqTrackLane} data-sequence-overlay-lane>
                    <span>{railCopy.overlayLaneLabel}</span>
                    {canEdit && (selectedClip ?? project.clips[0]) && (
                      <button
                        type="button"
                        className={w.seqLaneAction}
                        onClick={() => {
                          const target = selectedClip ?? project.clips[0];
                          if (!target) return;
                          applyPatches([
                            {
                              op: "add_overlay",
                              label: `${target.label} PiP`,
                              sourceKind: target.sourceKind,
                              ...(target.assetId ? { assetId: target.assetId } : {}),
                              ...(target.outputId ? { outputId: target.outputId } : {}),
                              srcUrl: target.thumbUrl ?? target.srcUrl,
                              ...(target.thumbUrl !== undefined ? { thumbUrl: target.thumbUrl } : {}),
                              mediaKind: target.thumbUrl ? "image" : "video",
                              startSec: roundTenths(playheadSec),
                              endSec: roundTenths(playheadSec + Math.min(4, Math.max(1, totalSec - playheadSec || 3))),
                            },
                          ]);
                        }}
                        data-overlay-add
                      >
                        {railCopy.overlayAddFromSelected}
                      </button>
                    )}
                    <div className={w.seqCaptionChips}>
                      {(project.overlays ?? []).map((ov, ovIdx) => (
                        <span key={ov.id} className={w.seqCaptionChip}>
                          {ov.label}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => applyPatches([{ op: "remove_overlay", overlayIndex: ovIdx }])}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {(project.overlays?.length ?? 0) > 0 && canEdit && (
                      <button
                        type="button"
                        className={w.seqLaneAction}
                        onClick={() => applyPatches([{ op: "remove_overlay", overlayIndex: "all" }])}
                      >
                        {railCopy.overlayClear}
                      </button>
                    )}
                  </div>

                  <div className={w.seqTrackLane} data-sequence-sfx-lane>
                    <span>{railCopy.sfxLaneLabel}</span>
                    {(project.sfxClips?.length ?? 0) > 0 ? (
                      <div className={w.seqCaptionChips}>
                        {project.sfxClips!.map((sfx, sfxIdx) => (
                          <span key={sfx.id} className={w.seqCaptionChip}>
                            {sfx.label} ({sfx.startSec}s)
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => applyPatches([{ op: "remove_sfx", sfxIndex: sfxIdx }])}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span>{railCopy.sfxEmpty}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <aside className={w.seqInspectorCol} data-sequence-inspector>
              <div className={w.seqInspectorTabs} role="tablist">
                {(["color", "music", "captions", "upscale"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === tab}
                    className={w.seqInspectorTab}
                    onClick={() => onInspectorTabChange(tab)}
                    data-inspector-tab={tab}
                  >
                    {tab === "color"
                      ? railCopy.inspector.colorTab
                      : tab === "music"
                        ? musicGeneration
                          ? railCopy.inspector.musicTab
                          : railCopy.inspector.sfxTitle
                        : tab === "captions"
                          ? railCopy.inspector.captionsTab
                          : railCopy.inspector.upscaleTab}
                  </button>
                ))}
              </div>

              {postProdAllowanceError ? (
                <StudioAllowanceNotice
                  kind={postProdAllowanceError.code === "allowance_closed" ? "closed" : "exhausted"}
                  organizationId={organizationId}
                  organizationName={organizationName}
                  locale={locale}
                  billingCopy={billingCopy}
                  planCatalogue={planCatalogue}
                  neededCredits={postProdAllowanceError.neededCredits}
                  remainingCredits={
                    allowance ? creditsLeft(allowance.capKrw, allowance.usedKrw) : null
                  }
                  resetsAt={allowance?.resetsAt ?? null}
                  allowanceWindow={allowance?.window ?? null}
                  surface="studio_video"
                  solidCta={postProdAllowanceError.code === "allowance_closed"}
                />
              ) : null}

              {inspectorTab === "color" && (
                <div className={w.seqInspectorBody} data-inspector-panel="color">
                  <div className={w.seqPillRow}>
                    {(["full_timeline", "selected_clip", "region"] as const).map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        className={w.seqHeightBtn}
                        aria-pressed={currentGrade.enabled && currentGrade.scope === sc}
                        disabled={!canEdit}
                        onClick={() => handleSetGradeScope(sc)}
                        data-grade-scope={sc}
                      >
                        {sc === "full_timeline"
                          ? railCopy.inspector.scopeFull
                          : sc === "selected_clip"
                            ? railCopy.inspector.scopeClip
                            : railCopy.inspector.scopeRegion}
                      </button>
                    ))}
                  </div>

                  <div className={w.seqPresetGrid}>
                    {(
                      [
                        ["twings-french-blue", railCopy.inspector.presets.frenchBlue],
                        ["clean-high-key", railCopy.inspector.presets.cleanHighKey],
                        ["editorial-cool-porcelain", railCopy.inspector.presets.coolPorcelain],
                        ["kodak-2383-warm", railCopy.inspector.presets.filmWarm],
                        ["moody-teal-amber", railCopy.inspector.presets.tealAmber],
                        ["pastel-airy-film", railCopy.inspector.presets.pastelAiry],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={w.seqPresetBtn}
                        aria-pressed={currentGrade.enabled && currentGrade.presetId === id}
                        disabled={!canEdit}
                        onClick={() => handleSelectGradePreset(id)}
                        data-grade-preset={id}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className={w.seqSliderStack}>
                    <label className={w.seqSliderRow}>
                      <span>{railCopy.inspector.intensity}</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={currentGrade.intensity}
                        disabled={!canEdit}
                        onChange={(e) =>
                          applyPatches([
                            {
                              op: "set_color_grade",
                              enabled: true,
                              scope: currentGrade.scope,
                              intensity: Number(e.target.value),
                            },
                          ])
                        }
                      />
                    </label>
                    <label className={w.seqSliderRow}>
                      <span>{railCopy.inspector.skinProtect}</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={currentGrade.skinProtect}
                        disabled={!canEdit}
                        onChange={(e) =>
                          applyPatches([
                            {
                              op: "set_color_grade",
                              enabled: true,
                              scope: currentGrade.scope,
                              skinProtect: Number(e.target.value),
                            },
                          ])
                        }
                      />
                    </label>
                    <label className={w.seqSliderRow}>
                      <span>{railCopy.inspector.grain}</span>
                      <input
                        type="range"
                        min={0}
                        max={6}
                        step={0.5}
                        value={currentGrade.grain}
                        disabled={!canEdit}
                        onChange={(e) =>
                          applyPatches([
                            {
                              op: "set_color_grade",
                              enabled: true,
                              scope: currentGrade.scope,
                              grain: Number(e.target.value),
                            },
                          ])
                        }
                      />
                    </label>
                  </div>

                  <div className={w.seqPillRow}>
                    <button
                      type="button"
                      className={w.seqUploadBtn}
                      disabled={!canEdit || analyzingRef}
                      onClick={() => gradeRefInputRef.current?.click()}
                      data-grade-upload-ref
                    >
                      {railCopy.inspector.matchRefUpload}
                    </button>
                    <button
                      type="button"
                      className={w.seqUploadBtn}
                      disabled={project.clips.length === 0}
                      onClick={handleDownloadCubeLut}
                      data-grade-download-cube
                    >
                      {railCopy.inspector.downloadCubeBtn}
                    </button>
                    {currentGrade.enabled && (
                      <button
                        type="button"
                        className={w.seqUploadBtn}
                        disabled={!canEdit}
                        onClick={() => applyPatches([{ op: "set_color_grade", enabled: false }])}
                        data-grade-reset
                      >
                        {railCopy.inspector.clearGrade}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {inspectorTab === "music" && (
                <div className={w.seqInspectorBody} data-inspector-panel="music">
                  {/* Closed generation keeps the badge only to flag a guide track already on the timeline. */}
                  {(musicGeneration || project.bgm?.nonCommercialGuide === true) && (
                    <span className={w.seqLicenseTag} data-music-license-badge>
                      {project.bgm?.nonCommercialGuide === true
                        ? railCopy.inspector.musicLicense
                        : railCopy.inspector.musicCommercialLicense}
                    </span>
                  )}
                  {musicGeneration && (
                    <>
                      <div className={w.seqPresetGrid}>
                        {(["frenchHouse", "ambientCello", "marimbaPerc", "warmSynth"] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            className={w.seqPresetBtn}
                            aria-pressed={musicStyle === st}
                            disabled={!canEdit}
                            onClick={() => setMusicStyle(st)}
                            data-music-style={st}
                          >
                            {railCopy.inspector.musicStyles[st]}
                          </button>
                        ))}
                      </div>

                      <label className={w.seqSliderRow}>
                        <span>{interpolate(railCopy.inspector.musicBpm, { bpm: musicBpm })}</span>
                        <input
                          type="range"
                          min={80}
                          max={150}
                          step={2}
                          value={musicBpm}
                          disabled={!canEdit}
                          onChange={(e) => setMusicBpm(Number(e.target.value))}
                        />
                      </label>

                      {audioAssets.length > 0 && (
                        <div className={w.seqAudioAssetRow}>
                          {audioAssets.slice(0, 4).map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              className={w.seqPresetBtn}
                              aria-pressed={musicRefAssetId === a.id}
                              disabled={!canEdit}
                              onClick={() => {
                                setMusicRefAssetId(a.id);
                                setMusicRefLabel(a.name);
                              }}
                            >
                              {a.name.slice(0, 20)}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className={w.seqPillRow}>
                        <button
                          type="button"
                          className={w.seqUploadBtn}
                          disabled={!canEdit}
                          onClick={() => musicRefInputRef.current?.click()}
                        >
                          {musicRefLabel ? musicRefLabel.slice(0, 20) : railCopy.inspector.musicAttachRef}
                        </button>
                        <button
                          type="button"
                          className={w.barDarkBtn}
                          disabled={!canEdit || musicBusy}
                          onClick={() => void handleGenerateMusic()}
                          data-inspector-generate-music
                        >
                          {musicBusy
                            ? railCopy.inspector.musicGenerating
                            : interpolate(railCopy.inspector.musicGenerateBtn, {
                                credits: formatCredits(musicCostCredits, locale),
                              })}
                        </button>
                      </div>
                    </>
                  )}

                  <div className={w.seqSfxDivider} data-sfx-generator>
                    {/* Closed music generation: the tab itself is named after this block, so no second heading. */}
                    {musicGeneration && <span className={w.seqLicenseTag}>{railCopy.inspector.sfxTitle}</span>}
                    <input
                      type="text"
                      className={w.seqSfxInput}
                      value={sfxPrompt}
                      disabled={!canEdit || sfxBusy}
                      placeholder={railCopy.inspector.sfxPlaceholder}
                      onChange={(e) => setSfxPrompt(e.target.value)}
                      data-sfx-prompt
                    />
                    <button
                      type="button"
                      className={w.seqUploadBtn}
                      disabled={!canEdit || sfxBusy || !sfxPrompt.trim()}
                      onClick={() => void handleGenerateSfx()}
                      data-sfx-generate
                    >
                      {sfxBusy
                        ? railCopy.inspector.sfxGenerating
                        : interpolate(railCopy.inspector.sfxGenerateBtn, {
                            credits: formatCredits(sfxCostCredits, locale),
                          })}
                    </button>
                  </div>
                </div>
              )}

              {inspectorTab === "captions" && (
                <form className={w.seqInspectorBody} onSubmit={handleAddCaption} data-inspector-panel="captions">
                  <input
                    type="text"
                    className={w.projectTitleInput}
                    placeholder={railCopy.inspector.captionPlaceholder}
                    value={captionText}
                    maxLength={120}
                    disabled={!canEdit}
                    onChange={(e) => setCaptionText(e.target.value)}
                  />
                  <div className={w.seqPillRow}>
                    {(["bottom", "center", "top"] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        className={w.seqHeightBtn}
                        aria-pressed={captionPos === pos}
                        onClick={() => setCaptionPos(pos)}
                      >
                        {pos}
                      </button>
                    ))}
                    <button
                      type="submit"
                      className={w.barDarkBtn}
                      disabled={!canEdit || !captionText.trim()}
                      data-inspector-add-caption
                    >
                      {railCopy.inspector.captionAdd}
                    </button>
                  </div>
                </form>
              )}

              {inspectorTab === "upscale" && (
                <div className={w.seqInspectorBody} data-inspector-panel="upscale">
                  <div className={w.seqPillRow}>
                    {([1080, 1440, 2160] as const).map((res) => (
                      <button
                        key={res}
                        type="button"
                        className={w.seqHeightBtn}
                        aria-pressed={upscaleRes === res}
                        disabled={!canEdit}
                        onClick={() => setUpscaleRes(res)}
                        data-upscale-res={res}
                      >
                        {res === 1080
                          ? railCopy.inspector.upscaleRes1080
                          : res === 1440
                            ? railCopy.inspector.upscaleRes1440
                            : railCopy.inspector.upscaleRes2160}
                      </button>
                    ))}
                  </div>

                  <div className={w.seqPillRow}>
                    {(["lab", "wavelet"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={w.seqHeightBtn}
                        aria-pressed={upscaleColor === mode}
                        disabled={!canEdit}
                        onClick={() => setUpscaleColor(mode)}
                      >
                        {mode === "lab"
                          ? railCopy.inspector.upscaleColorLab
                          : railCopy.inspector.upscaleColorWavelet}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={w.barDarkBtn}
                    disabled={!canEdit || !targetUpscaleClip || upscaleBusy}
                    onClick={() => void handleRunUpscale()}
                    data-inspector-run-upscale
                  >
                    {upscaleBusy
                      ? railCopy.inspector.upscaleRunning
                      : interpolate(railCopy.inspector.upscaleRunBtn, {
                          credits: formatCredits(upscaleCostCredits, locale),
                        })}
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}
