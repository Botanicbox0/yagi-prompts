/**
 * Pure state and validation helpers for the Video Studio workspace (Bundle C, docs/BRAND-STUDIO-VIDEO-C.md):
 *  - `@` asset mention detection and cursor-aware insertion (`@이미지 1`, `@영상 1`, `@image 1`, `@video 1`)
 *  - Seedance-based Video Edit (`kind: 'video_remix', method: 'edit'`) job builder and credit calculator
 *  - Pure trim & crop math for the clip segment/region modal.
 *
 * Client-safe: zero server/env/DB imports (`npm run security:client`).
 */
import type {
  StudioAssetView,
  StudioAudioMode,
  StudioJobCreate,
} from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { findMissingReferences, type MentionKind } from "@/lib/brand-studio/enhancer/mentions";
import { DEFAULT_VIDEO_MODEL, studioModel, type StudioVideoModel, type StudioVideoResolution } from "@/lib/brand-studio/models";
import { referenceVideoFit } from "@/lib/brand-studio/reference-video";
import { remixRunUsd, usageKrw } from "@/lib/brand-studio/usage-rate";
import { toReferences, type TrayItem } from "../refs";

export interface CropRect {
  /** Normalized 0..1 coordinates relative to the video frame. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function clampCropRect(rect: CropRect, minSize = 0.2): CropRect {
  const w = Math.min(1, Math.max(minSize, Number.isFinite(rect.w) ? rect.w : 1));
  const h = Math.min(1, Math.max(minSize, Number.isFinite(rect.h) ? rect.h : 1));
  const x = Math.min(1 - w, Math.max(0, Number.isFinite(rect.x) ? rect.x : 0));
  const y = Math.min(1 - h, Math.max(0, Number.isFinite(rect.y) ? rect.y : 0));
  return { x: round2(x), y: round2(y), w: round2(w), h: round2(h) };
}

export function clampTrimRange(
  start: number,
  end: number,
  total: number,
  minSeconds = 4,
  maxSeconds = 30,
): { start: number; end: number; duration: number } {
  const safeTotal = Math.max(0.1, Number.isFinite(total) && total > 0 ? total : minSeconds);
  if (safeTotal <= minSeconds) {
    return { start: 0, end: round1(safeTotal), duration: round1(safeTotal) };
  }
  let s = Math.max(0, Math.min(safeTotal - minSeconds, Number.isFinite(start) ? start : 0));
  let e = Math.max(s + minSeconds, Math.min(safeTotal, Number.isFinite(end) ? end : Math.min(safeTotal, maxSeconds)));
  if (e - s > maxSeconds) {
    e = Math.min(safeTotal, s + maxSeconds);
    if (e - s < minSeconds) s = Math.max(0, e - minSeconds);
  }
  s = round1(s);
  e = round1(e);
  return { start: s, end: e, duration: round1(Math.max(0.1, e - s)) };
}

export function isFullFrameAndRange(
  range: { start: number; end: number },
  total: number,
  crop: CropRect,
  maxSeconds = 30,
): boolean {
  if (total > maxSeconds) return false;
  const fullRange = range.start <= 0.08 && Math.abs(total - range.end) <= 0.12;
  const fullCrop = crop.x <= 0.01 && crop.y <= 0.01 && crop.w >= 0.98 && crop.h >= 0.98;
  return fullRange && fullCrop;
}

/* ---------------------------------------------------------- @ asset mentions */

export interface AtMentionTrigger {
  active: boolean;
  query: string;
  atIndex: number;
}

/**
 * Detects an active `@query` token right before `cursor` (preceded by start-of-text or whitespace).
 * Once the user finishes a mention like `@이미지 1 `, whitespace after the number closes the popup.
 */
export function detectAtMentionQuery(text: string, cursor: number): AtMentionTrigger {
  const safeCursor = Math.max(0, Math.min(text.length, cursor));
  const before = text.slice(0, safeCursor);
  const match = /(?:^|\s)@([^\s@]{0,24})$/.exec(before);
  if (!match) return { active: false, query: "", atIndex: -1 };
  const query = match[1] ?? "";
  const atIndex = safeCursor - query.length - 1;
  return { active: true, query, atIndex };
}

/**
 * Inserts `tag` (e.g. `@이미지 2`) at `cursor`, replacing any active `@query` token immediately before it.
 */
export function insertAssetMention(
  text: string,
  cursor: number,
  tag: string,
): { text: string; nextCursor: number } {
  const safeCursor = Math.max(0, Math.min(text.length, cursor));
  const trigger = detectAtMentionQuery(text, safeCursor);
  const start = trigger.active ? trigger.atIndex : safeCursor;
  const before = text.slice(0, start);
  const after = text.slice(safeCursor);
  const needsLeadSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailSpace = after.length === 0 || !/^\s/.test(after);
  const piece = `${needsLeadSpace ? " " : ""}${tag}${needsTrailSpace ? " " : ""}`;
  const nextText = `${before}${piece}${after}`;
  return { text: nextText, nextCursor: before.length + piece.length };
}

/* ---------------------------------------------------------- video edit run */

export type VideoEditProblem =
  | { kind: "need_video" }
  | { kind: "too_short"; min: number }
  | { kind: "too_long"; max: number }
  | { kind: "bad_dimensions"; reason: "small" | "large" }
  | { kind: "empty_prompt" }
  | { kind: "too_many_images"; max: number }
  | { kind: "missing_mentions"; mentions: Array<{ kind: MentionKind | "any"; number: number }> };

export interface VideoEditDraft {
  model: string;
  prompt: string;
  resolution: "draft" | StudioVideoResolution;
  audio: StudioAudioMode;
  enhance: boolean;
}

export function defaultVideoEditDraft(): VideoEditDraft {
  return {
    model: DEFAULT_VIDEO_MODEL,
    prompt: "",
    resolution: "720p",
    audio: "native",
    enhance: true,
  };
}

function resolveVideoModel(id: string): StudioVideoModel {
  const found = studioModel(id);
  if (found && found.medium === "video" && found.availability === "live") return found;
  const fallback = studioModel(DEFAULT_VIDEO_MODEL);
  if (!fallback || fallback.medium !== "video") throw new Error("no live video model");
  return fallback;
}

export function checkVideoEditClip(
  video: Pick<StudioAssetView, "seconds" | "width" | "height"> | null,
  modelId: string = DEFAULT_VIDEO_MODEL,
): VideoEditProblem | null {
  if (!video) return { kind: "need_video" };
  const model = resolveVideoModel(modelId);
  const limits = model.referenceVideoSeconds;
  if (video.seconds !== null && video.seconds > limits.max) return { kind: "too_long", max: limits.max };
  if (video.seconds !== null && video.seconds < limits.editMin) return { kind: "too_short", min: limits.editMin };
  const fit = referenceVideoFit(model, video);
  if (fit.problem === "small" || fit.problem === "large") return { kind: "bad_dimensions", reason: fit.problem };
  if (!fit.editable) return { kind: "too_short", min: limits.editMin };
  return null;
}

export function buildVideoEditJob(input: {
  video: StudioAssetView | null;
  images: readonly TrayItem[];
  draft: VideoEditDraft;
  ids: { organizationId: string; requestId: string };
  preEnhanced?: boolean;
}): { ok: true; input: StudioJobCreate } | { ok: false; problem: VideoEditProblem } {
  const model = resolveVideoModel(input.draft.model);
  const clipProblem = checkVideoEditClip(input.video, model.id);
  if (clipProblem) return { ok: false, problem: clipProblem };
  const prompt = input.draft.prompt.trim();
  if (!prompt) return { ok: false, problem: { kind: "empty_prompt" } };
  const imageItems = input.images.filter((i) => i.kind === "image");
  if (imageItems.length > model.maxReferenceImages) {
    return { ok: false, problem: { kind: "too_many_images", max: model.maxReferenceImages } };
  }
  const trayKinds: MentionKind[] = ["video", ...imageItems.map(() => "image" as const)];
  const missing = findMissingReferences(prompt, trayKinds);
  if (missing.length > 0) return { ok: false, problem: { kind: "missing_mentions", mentions: missing } };

  const references = [
    { assetId: input.video!.id },
    ...toReferences(imageItems, "video").map(({ frame: _ignored, ...rest }) => rest),
  ];

  return {
    ok: true,
    input: {
      kind: "video_remix",
      organizationId: input.ids.organizationId,
      requestId: input.ids.requestId,
      model: model.id,
      prompt: "",
      change: prompt,
      enhance: input.preEnhanced ? false : input.draft.enhance,
      references,
      aspect: model.aspects[0] ?? "9:16",
      resolution: input.draft.resolution,
      audio: input.draft.audio,
      method: "edit",
      keep: [],
    },
  };
}

export function videoEditCredits(
  video: Pick<StudioAssetView, "seconds"> | null,
  resolution: "draft" | StudioVideoResolution,
  modelId: string = DEFAULT_VIDEO_MODEL,
): number {
  const model = resolveVideoModel(modelId);
  const seconds = video?.seconds ?? model.defaultSeconds;
  const { usd } = remixRunUsd({
    model,
    resolution,
    method: "edit",
    seconds: null,
    referenceSeconds: seconds,
  });
  return creditsOf(usageKrw(usd, "video"));
}
