/**
 * Pure state machine for the Video Studio's 3-mode switch (slice VM-1).
 *
 * The mode is a view of existing state (`tray` has a video or not, `draft.method`, `draft.methodPinned`)
 * plus client-only `VideoModesUiState` (`pendingMode`, `pickedVideoModeByHand`, `undo`, `forcedLimitMessage`).
 * Zero new fields are sent to the server; existing `dock-model.ts` builders and `reference-video.ts` limits
 * remain the sole source of truth for routing and requests.
 */
import {
  STUDIO_ASSET_ROLES,
  STUDIO_LIMITS,
  STUDIO_SHOT_LIMITS,
  STUDIO_UPLOAD_MIMES,
  type StudioAssetRole,
  type StudioRemixMethod,
  type StudioVideoCountingScheme,
  type VideoUnderstandCard,
  type VideoUnderstandQuestion,
  type VideoUnderstandSchema,
  type VideoUnderstandSwap,
} from "@/lib/brand-studio/contracts";
import type { z } from "zod";
import type { StudioVideoModel } from "@/lib/brand-studio/models";
import { blueprintFit, planMultiClipGeneration, referenceVideoFit } from "@/lib/brand-studio/reference-video";
import type { StudioVideoCopy } from "@/messages/studio-video";
import type { StudioVideoModesCopy } from "@/messages/studio-video-modes";
import { virtualMentionTag } from "../at-mention-menu";
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

/** True when the mode uses the confirm-before-making step (Re-Architect or Motion Transfer). */
export function isConfirmVideoMode(mode: VideoStudioMode): mode is PendingVideoMode {
  return mode !== "basic";
}

/**
 * Deterministic staleness signature for the inline confirm card: changing mode or adding/removing/replacing
 * any tray item invalidates an open card so stale settings cannot be submitted.
 */
export function confirmCardSignature(mode: VideoStudioMode, tray: readonly Pick<TrayItem, "key" | "assetId" | "kind" | "seconds">[]): string {
  return `${mode}|${tray.map((t) => `${t.key}:${t.assetId ?? ""}:${t.kind}:${t.seconds ?? ""}`).join(",")}`;
}

/**
 * Derives compact single-clip length choices strictly from the model's `minSeconds` / `maxSeconds`
 * (plus `defaultSeconds` and any currently selected legal duration so the active chip always highlights).
 */
export function singleLengthChoices(
  model: Pick<StudioVideoModel, "minSeconds" | "maxSeconds" | "defaultSeconds">,
  currentSeconds?: number | null,
): number[] {
  const min = Math.max(1, Math.round(model.minSeconds));
  const max = Math.max(min, Math.round(model.maxSeconds));
  const def = Math.min(max, Math.max(min, Math.round(model.defaultSeconds)));
  const span = max - min;
  if (span <= 4) {
    return Array.from({ length: span + 1 }, (_, i) => min + i);
  }
  const set = new Set<number>([min, def, max]);
  const steps = 4;
  for (let i = 1; i < steps; i += 1) {
    const tick = Math.round(min + (span * i) / steps);
    if (tick > min && tick < max) set.add(tick);
  }
  if (typeof currentSeconds === "number" && Number.isFinite(currentSeconds)) {
    const cur = Math.round(currentSeconds);
    if (cur >= min && cur <= max) set.add(cur);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Derives multi-clip length plans (`2..maxClips` × `model.maxSeconds`) without hardcoding clip lengths.
 */
export function multiLengthChoices(
  model: Pick<StudioVideoModel, "maxSeconds">,
  maxClips = maxMultiClipCount(model.maxSeconds),
): Array<{ total: number; clips: number }> {
  const perClip = Math.max(1, Math.round(model.maxSeconds));
  const out: Array<{ total: number; clips: number }> = [];
  for (let clips = 2; clips <= maxClips; clips += 1) {
    out.push({ clips, total: clips * perClip });
  }
  return out;
}

/**
 * Applies a single-clip or multi-clip length choice from the `길이` popover (shared by settings chip and
 * confirm card), producing the exact same `DockDraft` fields as `RemixPanel.selectDurationPlan`.
 */
export function applyCardLengthPlan(
  draft: DockDraft,
  totalSeconds: number,
  explicitClips?: number,
  referenceSeconds?: number | null,
  model?: Pick<StudioVideoModel, "minSeconds" | "maxSeconds">,
): DockDraft {
  const resolved = model ?? (dockControls(draft).model as StudioVideoModel);
  const minSec = Math.max(1, Math.round(resolved.minSeconds));
  const maxSec = Math.max(minSec, Math.round(resolved.maxSeconds));
  if (totalSeconds <= maxSec && (explicitClips ?? 1) === 1) {
    const clamped = Math.max(minSec, Math.min(maxSec, Math.round(totalSeconds)));
    return {
      ...draft,
      seconds: clamped,
      targetTotalSeconds: clamped,
      clipCount: 1,
    };
  }
  const nextPlan = planMultiClipGeneration({
    referenceSeconds: referenceSeconds ?? null,
    targetTotalSeconds: totalSeconds,
    clipCount: explicitClips,
    maxPerClipSeconds: maxSec,
  });
  return {
    ...draft,
    method: "blueprint",
    methodPinned: true,
    seconds: nextPlan.clipDurations[0] ?? maxSec,
    targetTotalSeconds: nextPlan.clipDurations.reduce((sum, n) => sum + n, 0),
    clipCount: nextPlan.clipCount,
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

/* ---------------------------------------------------------- Batch B: video.understand client helpers */

const VALID_ROLES_SET: ReadonlySet<string> = new Set(STUDIO_ASSET_ROLES);
const CLIENT_CREDIT_FIGURE_RE = /\d[\d,]*\s*(?:크레딧|credits?|원|₩)/i;
const CLIENT_WON_PREFIX_RE = /₩\s*\d[\d,]*/;
const CLIENT_CREDIT_ONLY_RE = /\d[\d,]*\s*(?:크레딧|credits?)/gi;
const CLIENT_UI_OUTPUT_LABELS: ReadonlySet<string> = new Set(["결과 보기", "View result"]);

function hasClientCreditFigure(text: string): boolean {
  return CLIENT_CREDIT_FIGURE_RE.test(text) || CLIENT_WON_PREFIX_RE.test(text);
}

/**
 * Client-side second line of defense (W3 + W4): drops any WHOLE sentence containing a credit/currency
 * figure from MODEL PROSE (`reply`, `question.text`, `options`) so stripping never leaves broken
 * fragments like `총 이 들어요.`.
 */
export function stripClientCreditFigures(text: string): string {
  if (!text) return "";
  return text
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !hasClientCreditFigure(s))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Last-three #2: Removes ONLY credit figures (`크레딧` / `credit(s)`) from `requestText` / `changeText` /
 * swap notes so customer won prices (`9,900원`), percentages, and other ad copy survive intact.
 */
export function stripClientCreditOnly(text: string): string {
  if (!text) return "";
  CLIENT_CREDIT_ONLY_RE.lastIndex = 0;
  return text
    .replace(CLIENT_CREDIT_ONLY_RE, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

/**
 * W1: Client-side swap validation run BEFORE both drawing and applying — drops any swap whose role
 * is not in `STUDIO_ASSET_ROLES`, whose picture is not attached in `tray`, whose `refIndex` is a
 * duplicate, or whose raw `label`/`use`/`avoid` exceed contract limits.
 */
export function sanitizeClientUnderstandSwaps(
  swaps: readonly VideoUnderstandSwap[],
  tray: readonly TrayItem[],
): VideoUnderstandSwap[] {
  const imageOrdinals = new Set<number>();
  let imgOrd = 0;
  for (const item of tray) {
    if (item.kind === "image") {
      imgOrd += 1;
      imageOrdinals.add(imgOrd);
    }
  }
  const seen = new Set<number>();
  const out: VideoUnderstandSwap[] = [];
  for (const swap of swaps) {
    if (!swap || typeof swap !== "object") continue;
    if (!Number.isInteger(swap.refIndex) || !imageOrdinals.has(swap.refIndex) || seen.has(swap.refIndex)) continue;
    if (typeof swap.role !== "string" || !VALID_ROLES_SET.has(swap.role)) continue;
    if (typeof swap.label !== "string" || swap.label.trim().length === 0 || swap.label.length > 80) continue;
    const rawUse = typeof swap.use === "string" ? swap.use : "";
    const rawAvoid = typeof swap.avoid === "string" ? swap.avoid : "";
    if (rawUse.length > STUDIO_LIMITS.noteMax || rawAvoid.length > STUDIO_LIMITS.noteMax) continue;
    const cleanLabel = stripClientCreditOnly(swap.label).trim();
    if (!cleanLabel) continue;
    seen.add(swap.refIndex);
    out.push({
      refIndex: swap.refIndex,
      role: swap.role as StudioAssetRole,
      label: cleanLabel,
      use: stripClientCreditOnly(rawUse).slice(0, STUDIO_LIMITS.noteMax),
      avoid: stripClientCreditOnly(rawAvoid).slice(0, STUDIO_LIMITS.noteMax),
    });
  }
  return out;
}

/** W8: Never sends a UI placeholder label (`결과 보기` / `View result`) as a result video's name. */
export function understandReferenceName(item: Pick<TrayItem, "outputId" | "name">): string {
  const trimmed = item.name.trim();
  if (!trimmed) return "";
  if (item.outputId && CLIENT_UI_OUTPUT_LABELS.has(trimmed)) return "";
  return trimmed.slice(0, STUDIO_LIMITS.nameMax);
}

export function hasUnderstandStandingChange(
  card: Pick<VideoUnderstandCard, "swaps" | "changeText" | "requestText"> | null | undefined,
): boolean {
  if (!card) return false;
  return card.swaps.length > 0 || card.changeText.trim().length > 0 || card.requestText.trim().length > 0;
}

export interface TrayImageSnapshotEntry {
  role?: StudioAssetRole;
  use: string;
  avoid: string;
}

export type TrayImageSnapshot = Record<string, TrayImageSnapshotEntry>;

/** Snapshots every attached image's role/use/avoid before the first card of a session is applied (S1). */
export function snapshotTrayImages(tray: readonly TrayItem[]): TrayImageSnapshot {
  const out: TrayImageSnapshot = {};
  for (const item of tray) {
    if (item.kind !== "image") continue;
    out[item.key] = {
      ...(item.role ? { role: item.role } : {}),
      use: item.use ?? "",
      avoid: item.avoid ?? "",
    };
  }
  return out;
}

/** A3: Updates an image's snapshot entry when the customer hand-edits role/use/avoid so later turns never revert it. */
export function updateTraySnapshotForHandEdit(
  snapshot: TrayImageSnapshot,
  key: string,
  patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>,
  currentItem?: TrayItem | null,
): TrayImageSnapshot {
  if (currentItem && currentItem.kind !== "image") return snapshot;
  const prev = snapshot[key] ?? {
    ...(currentItem?.role ? { role: currentItem.role } : {}),
    use: currentItem?.use ?? "",
    avoid: currentItem?.avoid ?? "",
  };
  const nextRole = "role" in patch ? patch.role : prev.role;
  const nextEntry: TrayImageSnapshotEntry = {
    ...(nextRole ? { role: nextRole } : {}),
    use: "use" in patch ? (patch.use ?? "") : prev.use,
    avoid: "avoid" in patch ? (patch.avoid ?? "") : prev.avoid,
  };
  return { ...snapshot, [key]: nextEntry };
}

export const VIDEO_UNDERSTAND_STORAGE_KEY = "twings_studio_video_understand_v1";

export interface StoredUnderstandSession {
  sig: string;
  card: VideoUnderstandCard;
  questions: VideoUnderstandQuestion[];
  openQuestion: number | null;
  reply: string | null;
  readyToMake: boolean;
  turns: Array<{ who: "customer" | "studio"; text: string }>;
  settledPrompt: string;
  countingScheme?: StudioVideoCountingScheme | null;
  traySnapshot?: TrayImageSnapshot | null;
  touchedKeys?: string[];
}

/**
 * Re-checks every `swap.refIndex` against the client's OWN attached image tray before applying a
 * `video.understand` card (Batch B correction #3), restores snapshot roles/notes ONLY for images
 * previously touched by a card (S1 + A3: hand edits on untouched or edited images survive later turns),
 * clamps length/clips strictly to the CURRENT mode without ever changing mode/method (W2),
 * and sets `draft.prompt` to the card's settled `requestText` (or clears it when withdrawn to empty, W5).
 */
export function applyUnderstandCardToDraftAndTray(args: {
  card: VideoUnderstandCard;
  draft: DockDraft;
  tray: readonly TrayItem[];
  mode?: PendingVideoMode;
  snapshot?: TrayImageSnapshot | null;
  touchedKeys?: ReadonlySet<string> | null;
  clearPromptWhenEmpty?: boolean;
  model?: Pick<StudioVideoModel, "minSeconds" | "maxSeconds">;
  videoSeconds?: number | null;
}): { draft: DockDraft; tray: TrayItem[]; appliedSwaps: number; droppedSwaps: number; writtenKeys: string[] } {
  const {
    card,
    draft,
    tray,
    snapshot = null,
    touchedKeys = null,
    clearPromptWhenEmpty = false,
    model,
    videoSeconds = null,
  } = args;
  const resolvedMode: PendingVideoMode =
    args.mode ?? (resolveUnifiedRemixMethod(draft, tray) === "blueprint" ? "re_architect" : "motion_transfer");

  const imageOrdinalToTrayIdx = new Map<number, number>();
  let imgOrd = 0;
  tray.forEach((item, idx) => {
    if (item.kind === "image") {
      imgOrd += 1;
      imageOrdinalToTrayIdx.set(imgOrd, idx);
    }
  });

  // S1 + A3: Restore snapshot for images previously written by a card (or all images when `touchedKeys` is null).
  // Untouched images (and any hand-edited image whose snapshot was updated) keep the customer's own values.
  const nextTray = tray.map((item) => {
    const mayRestore = touchedKeys === null || touchedKeys.has(item.key);
    if (item.kind === "image" && mayRestore && snapshot && Object.prototype.hasOwnProperty.call(snapshot, item.key)) {
      const orig = snapshot[item.key]!;
      return {
        ...item,
        role: orig.role,
        use: orig.use,
        avoid: orig.avoid,
      };
    }
    return { ...item };
  });

  // W1: Validate swaps against `STUDIO_ASSET_ROLES`, attached tray images, and field length limits BEFORE applying.
  const validSwaps = sanitizeClientUnderstandSwaps(card.swaps, tray);
  const droppedSwaps = card.swaps.length - validSwaps.length;
  let appliedSwaps = 0;
  const writtenKeys: string[] = [];

  for (const swap of validSwaps) {
    const trayIdx = imageOrdinalToTrayIdx.get(swap.refIndex);
    if (trayIdx === undefined) continue;
    const current = nextTray[trayIdx]!;
    if (current.kind !== "image") continue;
    // W5 (per-field rule): a field the customer set by hand on a picture (present in `snapshot`,
    // or already on `current` when no snapshot was given) is never erased by an empty model field.
    const snapEntry =
      snapshot && Object.prototype.hasOwnProperty.call(snapshot, current.key) ? snapshot[current.key]! : null;
    const baseUse = snapEntry ? snapEntry.use : (current.use ?? "");
    const baseAvoid = snapEntry ? snapEntry.avoid : (current.avoid ?? "");
    const incomingUse = stripClientCreditOnly(swap.use ?? "").slice(0, STUDIO_LIMITS.noteMax);
    const incomingAvoid = stripClientCreditOnly(swap.avoid ?? "").slice(0, STUDIO_LIMITS.noteMax);
    nextTray[trayIdx] = {
      ...current,
      role: swap.role,
      use: incomingUse || baseUse,
      avoid: incomingAvoid || baseAvoid,
    };
    writtenKeys.push(current.key);
    appliedSwaps += 1;
  }

  // W2: Clamp strictly by CURRENT mode and NEVER change `draft.method` or `draft.methodPinned`.
  const resolvedModel = model ?? (dockControls(draft).model as StudioVideoModel);
  const minSec = Math.max(1, Math.round(resolvedModel.minSeconds));
  const maxSec = Math.max(minSec, Math.round(resolvedModel.maxSeconds));

  let withLength: DockDraft;
  if (resolvedMode === "motion_transfer") {
    const clampedSec = Math.max(minSec, Math.min(maxSec, Math.round(card.seconds)));
    withLength = {
      ...draft,
      seconds: clampedSec,
      clipCount: 1,
      targetTotalSeconds: null,
    };
  } else {
    const maxClips = maxMultiClipCount(maxSec);
    const clampedClips = Math.max(1, Math.min(maxClips, Math.round(card.clipCount)));
    const totalSec =
      clampedClips >= 2
        ? Math.min(clampedClips * maxSec, card.targetTotalSeconds ?? clampedClips * maxSec)
        : Math.max(minSec, Math.min(maxSec, Math.round(card.seconds)));
    const appliedPlan = applyCardLengthPlan(draft, totalSec, clampedClips, videoSeconds, resolvedModel);
    withLength = {
      ...appliedPlan,
      method: draft.method,
      methodPinned: draft.methodPinned,
    };
  }

  const settledPrompt = stripClientCreditOnly(card.requestText).slice(0, STUDIO_LIMITS.promptMax);
  const settledChange = stripClientCreditOnly(card.changeText).slice(0, STUDIO_LIMITS.promptMax);
  const nextDraft: DockDraft = {
    ...withLength,
    audio: card.audio,
    change: settledChange,
    ...(settledPrompt
      ? { prompt: settledPrompt }
      : clearPromptWhenEmpty
        ? { prompt: "" }
        : {}),
  };

  return { draft: nextDraft, tray: nextTray, appliedSwaps, droppedSwaps, writtenKeys };
}

/** Builds the exact `VideoUnderstandSchema` request payload from client dock state (W1: carries position, index & mention). */
export function buildUnderstandInput(args: {
  organizationId: string;
  mode: PendingVideoMode;
  draft: DockDraft;
  tray: readonly TrayItem[];
  message: string;
  videoAssetId?: string | null;
  previous?: {
    card: VideoUnderstandCard;
    questions: VideoUnderstandQuestion[];
    turns: Array<{ who: "customer" | "studio"; text: string }>;
    countingScheme?: StudioVideoCountingScheme | null;
  } | null;
  answering?: { option?: number } | null;
}): z.input<typeof VideoUnderstandSchema> {
  const { organizationId, mode, draft, tray, message, videoAssetId, previous = null, answering = null } = args;
  let imgOrd = 0;
  let vidOrd = 0;
  let audOrd = 0;
  const references = tray.map((item, posIdx) => {
    const index = item.kind === "image" ? ++imgOrd : item.kind === "video" ? ++vidOrd : ++audOrd;
    const mention = virtualMentionTag(item.kind, index);
    return {
      position: posIdx + 1,
      index,
      mention,
      kind: item.kind,
      name: understandReferenceName(item),
      ...(typeof item.seconds === "number" ? { seconds: item.seconds } : {}),
      ...(item.role ? { role: item.role } : {}),
      ...(item.use ? { use: item.use.slice(0, STUDIO_LIMITS.noteMax) } : {}),
      ...(item.avoid ? { avoid: item.avoid.slice(0, STUDIO_LIMITS.noteMax) } : {}),
    };
  });

  return {
    organizationId,
    mode,
    model: draft.model,
    message: message.trim().slice(0, STUDIO_LIMITS.promptMax),
    ...(videoAssetId ? { videoAssetId } : {}),
    references,
    current: {
      seconds: draft.seconds,
      clipCount: draft.clipCount ?? 1,
      targetTotalSeconds: draft.targetTotalSeconds ?? null,
      audio: draft.audio,
      changeText: draft.change.slice(0, STUDIO_LIMITS.promptMax),
    },
    previous,
    ...(answering ? { answering } : {}),
  };
}

function getSessionStore(store?: Storage | null): Storage | null {
  if (store !== undefined) return store;
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readUnderstandSession(sig: string, store?: Storage | null): StoredUnderstandSession | null {
  const s = getSessionStore(store);
  if (!s || !sig) return null;
  try {
    const raw = s.getItem(VIDEO_UNDERSTAND_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUnderstandSession>;
    if (!parsed || parsed.sig !== sig || !parsed.card) return null;
    return parsed as StoredUnderstandSession;
  } catch {
    return null;
  }
}

export function writeUnderstandSession(data: StoredUnderstandSession, store?: Storage | null): void {
  const s = getSessionStore(store);
  if (!s) return;
  try {
    s.setItem(VIDEO_UNDERSTAND_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore private-mode / quota errors.
  }
}

export function clearUnderstandSession(store?: Storage | null): void {
  const s = getSessionStore(store);
  if (!s) return;
  try {
    s.removeItem(VIDEO_UNDERSTAND_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}
