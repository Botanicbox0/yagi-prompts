/**
 * Pure state machine for the Video Studio's 3-mode switch (slice VM-1).
 *
 * The mode is a view of existing state (`tray` has a video or not, `draft.method`, `draft.methodPinned`)
 * plus client-only `VideoModesUiState` (`pendingMode`, `pickedVideoModeByHand`, `undo`, `forcedLimitMessage`).
 * Zero new fields are sent to the server; existing `dock-model.ts` builders and `reference-video.ts` limits
 * remain the sole source of truth for routing and requests.
 */
import { STUDIO_LIMITS, STUDIO_SHOT_LIMITS, STUDIO_UPLOAD_MIMES, type StudioRemixMethod } from "@/lib/brand-studio/contracts";
import type { StudioVideoModel } from "@/lib/brand-studio/models";
import { blueprintFit, planMultiClipGeneration, referenceVideoFit } from "@/lib/brand-studio/reference-video";
import type { StudioVideoCopy } from "@/messages/studio-video";
import type { StudioVideoModesCopy } from "@/messages/studio-video-modes";
import { fill, type StudioCopy } from "../copy";
import {
  dockControls,
  draftAfterAttach,
  normalizeDraft,
  remixActive,
  remixFit,
  resolveUnifiedRemixMethod,
  type DockDraft,
} from "../dock-model";
import type { TrayItem } from "../refs";
import { filmLimitLine } from "../use-dock";
import type { FilmState } from "../use-studio";

export type VideoStudioMode = "basic" | "re_architect" | "motion_transfer";
export type PendingVideoMode = Exclude<VideoStudioMode, "basic">;

export const VIDEO_MODES_ORDER: readonly VideoStudioMode[] = ["basic", "re_architect", "motion_transfer"];

export interface RemovedVideoEntry {
  item: TrayItem;
  index: number;
}

export interface RemovedVideoUndo {
  /** All video tray items removed when switching to 기본, in ascending original index order. */
  items: RemovedVideoEntry[];
  method: StudioRemixMethod;
  methodPinned: boolean;
  pickedVideoModeByHand: boolean;
}

export interface VideoModesUiState {
  /** Mode picked by the customer while no video is attached (or kept after manual removal). */
  pendingMode: PendingVideoMode | null;
  /** True once the customer explicitly chose Re-Architect or Motion Transfer in this session. */
  pickedVideoModeByHand: boolean;
  /** Undo snapshot from Rule 6 (picking 기본 while video(s) were attached). */
  undo: RemovedVideoUndo | null;
  /** Non-silent limit line shown when Rule 3 falls back from a forbidden pending mode. */
  forcedLimitMessage: string | null;
}

export const INITIAL_VIDEO_MODES_STATE: VideoModesUiState = {
  pendingMode: null,
  pickedVideoModeByHand: false,
  undo: null,
  forcedLimitMessage: null,
};

export function modeForRemixMethod(method: StudioRemixMethod): PendingVideoMode {
  return method === "blueprint" ? "re_architect" : "motion_transfer";
}

export function methodForVideoMode(mode: PendingVideoMode): StudioRemixMethod {
  return mode === "re_architect" ? "blueprint" : "reference";
}

/** Derives the active video studio mode from existing `draft` + `tray` and client-only `pendingMode`. */
export function deriveVideoMode(
  draft: Pick<DockDraft, "medium" | "model" | "method" | "methodPinned" | "clipCount" | "targetTotalSeconds">,
  tray: readonly TrayItem[],
  pendingMode: PendingVideoMode | null,
): VideoStudioMode {
  if (!remixActive(draft, tray)) {
    return pendingMode ?? "basic";
  }
  return modeForRemixMethod(resolveUnifiedRemixMethod(draft, tray));
}

export interface VideoModeOptionState {
  mode: VideoStudioMode;
  disabled: boolean;
  reason: string | null;
}

/**
 * Computes which modes are disabled (and why) for the current clip.
 * Rule 5 / Fix item 2 / Round 5 item 1: when no video is attached, no mode is disabled. When a video is attached,
 * a mode is disabled ONLY by today's hard clip limits (`referenceVideoFit` length >30s/<2s or pixel size limits
 * for Motion Transfer). An unreadable blueprint reading does NOT disable Re-Architect because reading can succeed
 * on retry (`다시 읽기`); instead Re-Architect stays selectable and shows the blocked state with retry.
 * Multi-clip does NOT disable Motion Transfer because selecting Motion Transfer resets `clipCount: 1`.
 */
export function videoModeAvailability(args: {
  draft: DockDraft;
  tray: readonly TrayItem[];
  film: FilmState | null;
  copy: StudioCopy;
  videoCopy: StudioVideoCopy;
}): Record<VideoStudioMode, VideoModeOptionState> {
  const { draft, tray, copy } = args;
  const open: Record<VideoStudioMode, VideoModeOptionState> = {
    basic: { mode: "basic", disabled: false, reason: null },
    re_architect: { mode: "re_architect", disabled: false, reason: null },
    motion_transfer: { mode: "motion_transfer", disabled: false, reason: null },
  };
  if (!remixActive(draft, tray)) return open;

  const model = dockControls(draft).model as StudioVideoModel;
  const fit = remixFit(draft, tray);

  if (fit?.problem) {
    open.motion_transfer = {
      mode: "motion_transfer",
      disabled: true,
      reason: filmLimitLine(fit.problem, model.referenceVideoSeconds, copy),
    };
  }

  return open;
}

/**
 * Rules 3 & 4 when a reference item is attached while the video modes switch is open.
 * - Rule 4 (`pendingMode === null`): returns `draftAfterAttach` verbatim.
 * - Rule 3 (`pendingMode !== null` and attaching a video): pins the pending mode's method when today's
 *   rules (`referenceVideoFit`, `resolveUnifiedRemixMethod`) allow it; otherwise falls back to the forced
 *   method (`blueprint`) and records today's limit line in `ui.forcedLimitMessage` so it is never silent.
 */
export function draftAndStateAfterVideoAttach(args: {
  draft: DockDraft;
  nextTray: readonly TrayItem[];
  item: Pick<TrayItem, "kind"> & Partial<Pick<TrayItem, "seconds" | "width" | "height">>;
  ui: VideoModesUiState;
  copy: StudioCopy;
}): { draft: DockDraft; ui: VideoModesUiState } {
  const { draft, nextTray, item, ui, copy } = args;
  const base = draftAfterAttach(draft, item, true, nextTray);
  if (item.kind !== "video") {
    return { draft: base, ui };
  }

  // Rule 4: nothing pending — exact automatic routing from `draftAfterAttach`.
  if (!ui.pendingMode) {
    return {
      draft: base,
      ui: {
        pendingMode: null,
        pickedVideoModeByHand: ui.pickedVideoModeByHand,
        undo: null,
        forcedLimitMessage: null,
      },
    };
  }

  // Rule 3: a video mode was pending before the video arrived.
  const model = dockControls(base).model as StudioVideoModel;
  if (ui.pendingMode === "re_architect") {
    return {
      draft: normalizeDraft({ ...base, method: "blueprint", methodPinned: true }),
      ui: {
        pendingMode: null,
        pickedVideoModeByHand: true,
        undo: null,
        forcedLimitMessage: null,
      },
    };
  }

  // `pendingMode === "motion_transfer"`
  const fit = referenceVideoFit(model, {
    seconds: item.seconds ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
  });
  const bp = blueprintFit(model, { seconds: item.seconds ?? null });

  if (!fit.problem) {
    return {
      draft: normalizeDraft({
        ...base,
        method: "reference",
        methodPinned: true,
        clipCount: 1,
        targetTotalSeconds: null,
      }),
      ui: {
        pendingMode: null,
        pickedVideoModeByHand: true,
        undo: null,
        forcedLimitMessage: null,
      },
    };
  }

  // Forbidden for `reference` (>30s, or too small/large) while `blueprint` can read the clip:
  // force `blueprint` (Re-Architect) AND surface today's exact limit line (never silent).
  if (bp.readable) {
    return {
      draft: normalizeDraft({
        ...base,
        method: "blueprint",
        methodPinned: false,
      }),
      ui: {
        pendingMode: null,
        pickedVideoModeByHand: true,
        undo: null,
        forcedLimitMessage: filmLimitLine(fit.problem, model.referenceVideoSeconds, copy),
      },
    };
  }

  // Forbidden for both (<2s or >600s): `filmLimit` already shows the length limit and blocks submit.
  const overRaw = typeof item.seconds === "number" && item.seconds > model.referenceVideoSeconds.max;
  return {
    draft: normalizeDraft({
      ...base,
      method: overRaw ? "blueprint" : "reference",
      methodPinned: !overRaw,
      ...(overRaw ? {} : { clipCount: 1, targetTotalSeconds: null }),
    }),
    ui: {
      pendingMode: null,
      pickedVideoModeByHand: true,
      undo: null,
      forcedLimitMessage: null,
    },
  };
}

/**
 * Rules 2, 5, and 6 when the customer picks a mode from the segmented radio control.
 */
export function selectVideoMode(args: {
  target: VideoStudioMode;
  draft: DockDraft;
  tray: readonly TrayItem[];
  ui: VideoModesUiState;
  availability: Record<VideoStudioMode, VideoModeOptionState>;
}): {
  draft: DockDraft;
  tray: TrayItem[];
  ui: VideoModesUiState;
  clearedMessage: boolean;
  openedMode: PendingVideoMode | null;
} {
  const { target, draft, tray, ui, availability } = args;
  if (availability[target].disabled) {
    return { draft, tray: [...tray], ui, clearedMessage: false, openedMode: null };
  }

  const hasVideo = remixActive(draft, tray);
  if (!hasVideo) {
    if (target === "basic") {
      return {
        draft,
        tray: [...tray],
        ui: {
          pendingMode: null,
          pickedVideoModeByHand: false,
          undo: ui.undo,
          forcedLimitMessage: null,
        },
        clearedMessage: true,
        openedMode: null,
      };
    }
    return {
      draft,
      tray: [...tray],
      ui: {
        pendingMode: target,
        pickedVideoModeByHand: true,
        undo: null,
        forcedLimitMessage: null,
      },
      clearedMessage: true,
      openedMode: target,
    };
  }

  // Video is attached.
  if (target === "basic") {
    // Rule 6 + Fix item 4 & 5: remove ALL video items from tray (images & audio stay), store all for Undo.
    const removed: RemovedVideoEntry[] = [];
    tray.forEach((item, index) => {
      if (item.kind === "video") removed.push({ item, index });
    });
    const nextTray = tray.filter((item) => item.kind !== "video");
    const method = resolveUnifiedRemixMethod(draft, tray);
    const undo: RemovedVideoUndo | null = removed.length
      ? {
          items: removed,
          method,
          methodPinned: Boolean(draft.methodPinned),
          pickedVideoModeByHand: ui.pickedVideoModeByHand,
        }
      : null;
    return {
      draft,
      tray: nextTray,
      ui: {
        pendingMode: null,
        pickedVideoModeByHand: false,
        undo,
        forcedLimitMessage: null,
      },
      clearedMessage: true,
      openedMode: null,
    };
  }

  const method = methodForVideoMode(target);
  const nextDraft: DockDraft = {
    ...draft,
    method,
    methodPinned: true,
    ...(target === "motion_transfer" ? { clipCount: 1, targetTotalSeconds: null } : {}),
  };
  return {
    draft: nextDraft,
    tray: [...tray],
    ui: {
      pendingMode: null,
      pickedVideoModeByHand: true,
      undo: null,
      forcedLimitMessage: null,
    },
    clearedMessage: true,
    openedMode: target,
  };
}

/**
 * Rule 6 undo (Fix items 4 & 5): puts every removed video back in its original order and restores
 * ONLY `method` and `methodPinned` (preserving any `seconds` / `clipCount` / `targetTotalSeconds` edits
 * the customer made while in 기본).
 */
export function undoRemovedVideo(
  draft: DockDraft,
  tray: readonly TrayItem[],
  ui: VideoModesUiState,
): { draft: DockDraft; tray: TrayItem[]; ui: VideoModesUiState } {
  if (!ui.undo) return { draft, tray: [...tray], ui };
  const { items, method, methodPinned, pickedVideoModeByHand } = ui.undo;
  const nextTray = [...tray];
  const sorted = [...items].sort((a, b) => a.index - b.index);
  for (const entry of sorted) {
    if (!nextTray.some((t) => t.key === entry.item.key)) {
      const at = Math.max(0, Math.min(entry.index, nextTray.length));
      nextTray.splice(at, 0, entry.item);
    }
  }
  return {
    draft: {
      ...draft,
      method,
      methodPinned,
    },
    tray: nextTray,
    ui: {
      pendingMode: null,
      pickedVideoModeByHand,
      undo: null,
      forcedLimitMessage: null,
    },
  };
}

/**
 * Rule 7 + W3: when the customer removes the reference video from the tray by hand,
 * mode returns to `basic` unless they explicitly picked a video mode by hand in this session
 * (in which case that mode stays pending with the video well).
 */
export function stateAfterManualTrayRemove(args: {
  draft: DockDraft;
  prevTray: readonly TrayItem[];
  nextTray: readonly TrayItem[];
  removedKey: string;
  ui: VideoModesUiState;
}): VideoModesUiState {
  const { draft, prevTray, nextTray, removedKey, ui } = args;
  const removed = prevTray.find((item) => item.key === removedKey);
  if (!removed || removed.kind !== "video") return ui;
  if (nextTray.some((item) => item.kind === "video")) return ui;
  if (ui.pickedVideoModeByHand) {
    const activeBefore = modeForRemixMethod(resolveUnifiedRemixMethod(draft, prevTray));
    return {
      pendingMode: activeBefore,
      pickedVideoModeByHand: true,
      undo: null,
      forcedLimitMessage: null,
    };
  }
  return {
    pendingMode: null,
    pickedVideoModeByHand: false,
    undo: null,
    forcedLimitMessage: null,
  };
}

/** Expert `edit` toggle inside Motion Transfer (`method: "edit"` ↔ `method: "reference"`). */
export function applyVideoModeEditToggle(draft: DockDraft, nextMethod: "edit" | "reference"): DockDraft {
  return {
    ...draft,
    method: nextMethod,
    methodPinned: true,
    clipCount: 1,
    targetTotalSeconds: null,
  };
}

/** Derives container display names (e.g. `MP4 · MOV`) directly from `STUDIO_UPLOAD_MIMES.video`. */
export function formatVideoContainers(mimes: readonly string[] = STUDIO_UPLOAD_MIMES.video): string {
  const names = mimes.map((mime) => {
    const lower = mime.toLowerCase();
    if (lower === "video/mp4") return "MP4";
    if (lower === "video/quicktime") return "MOV";
    const sub = lower.split("/")[1] ?? lower;
    return sub.toUpperCase();
  });
  return names.join(" · ");
}

/** Maximum multi-clip count derived from `planMultiClipGeneration` (`reference-video.ts`). */
export function maxMultiClipCount(maxPerClipSeconds = 15): number {
  return planMultiClipGeneration({
    referenceSeconds: STUDIO_SHOT_LIMITS.secondsMax,
    targetTotalSeconds: STUDIO_SHOT_LIMITS.secondsMax,
    clipCount: 99,
    maxPerClipSeconds,
  }).clipCount;
}

/** Formats the video well's mode-specific limits directly from the registry & contract constants. */
export function formatVideoWellLimits(args: {
  mode: PendingVideoMode;
  model: Pick<StudioVideoModel, "referenceVideoSeconds">;
  limits?: { videoBytesMax: number };
  shotLimits?: { secondsMax: number };
  videoMimes?: readonly string[];
  copy: StudioVideoModesCopy["well"];
}): string {
  const {
    mode,
    model,
    limits = STUDIO_LIMITS,
    shotLimits = STUDIO_SHOT_LIMITS,
    videoMimes = STUDIO_UPLOAD_MIMES.video,
    copy,
  } = args;
  const maxMb = Math.round(limits.videoBytesMax / 1_000_000);
  const formats = formatVideoContainers(videoMimes);
  if (mode === "re_architect") {
    const maxMinutes = Math.max(1, Math.round(shotLimits.secondsMax / 60));
    return fill(copy.limitsReArchitect, {
      min: model.referenceVideoSeconds.min,
      maxMinutes,
      maxMb,
      formats,
    });
  }
  return fill(copy.limitsMotionTransfer, {
    min: model.referenceVideoSeconds.min,
    max: model.referenceVideoSeconds.max,
    maxMb,
    formats,
  });
}

/** Fills every numeric placeholder in the `!` popover and explainer copy from existing model/contract constants. */
export function formatVideoModeTipLines(args: {
  mode: VideoStudioMode;
  model: Pick<StudioVideoModel, "maxReferenceImages" | "minSeconds" | "maxSeconds" | "referenceVideoSeconds">;
  shotLimits?: { secondsMax: number };
  maxClips?: number;
  copy: StudioVideoModesCopy["tip"];
}): { give: string; keep: string; get: string } {
  const {
    mode,
    model,
    shotLimits = STUDIO_SHOT_LIMITS,
    maxClips = maxMultiClipCount(model.maxSeconds),
    copy,
  } = args;
  const values = {
    maxImages: model.maxReferenceImages,
    minSeconds: model.minSeconds,
    maxSeconds: model.maxSeconds,
    refMin: model.referenceVideoSeconds.min,
    refMaxMinutes: Math.max(1, Math.round(shotLimits.secondsMax / 60)),
    refMaxSeconds: model.referenceVideoSeconds.max,
    maxClips,
  };
  const raw = mode === "basic" ? copy.basic : mode === "re_architect" ? copy.reArchitect : copy.motionTransfer;
  return {
    give: fill(raw.give, values),
    keep: fill(raw.keep, values),
    get: fill(raw.get, values),
  };
}

/** True when a pending video mode without a video must block submission client-side (Rule 2 + W2). */
export function needsReferenceVideoForSubmit(
  pendingMode: PendingVideoMode | null,
  tray: readonly Pick<TrayItem, "kind">[],
): boolean {
  return pendingMode !== null && !tray.some((item) => item.kind === "video");
}

/**
 * True when the active mode is Re-Architect (`blueprint`) for an attached clip whose reading
 * finished with no sheet (`film.status === "done" && !film.sheet`).
 * While `film` is `null` or `"loading"`, this returns `false` so submitting during analysis works as on main.
 */
export function isBlueprintUnreadableBlock(args: {
  draft: Pick<DockDraft, "medium" | "model" | "method" | "methodPinned" | "clipCount" | "targetTotalSeconds">;
  tray: readonly TrayItem[];
  film: FilmState | null;
}): boolean {
  if (!remixActive(args.draft, args.tray)) return false;
  if (resolveUnifiedRemixMethod(args.draft, args.tray) !== "blueprint") return false;
  return args.film?.status === "done" && !args.film.sheet;
}
