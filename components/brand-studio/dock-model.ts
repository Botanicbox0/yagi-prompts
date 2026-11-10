/**
 * What the prompt bar may offer and what it sends (docs/BRAND-STUDIO-V3.md §4, V2 §5.2).
 *
 * Every control comes from the model registry (lib/brand-studio/models.ts): switching the model
 * changes the legal ratios, qualities and lengths, and a model that is not `live` never appears.
 * The screen fixes the medium (`mode`): the image screen never offers video and the video screen never
 * offers images. `buildJob` turns the bar into one contract request, or names the one thing that stops
 * it. Amounts are worked out in KRW with the server's arithmetic and shown only as credits.
 */
import {
  STUDIO_KEEP_KEYS,
  STUDIO_LIMITS,
  type RegionBox,
  type StudioAudioMode,
  type StudioJobCreate,
  type StudioJobView,
  type StudioKeepKey,
  type StudioRemixMethod,
} from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  estimateImageUsd,
  selectableModels,
  studioModel,
  type StudioImageModel,
  type StudioImageQuality,
  type StudioMedium,
  type StudioModel,
  type StudioVideoModel,
} from "@/lib/brand-studio/models";
import { findMissingReferences, rewriteReferenceMentions, type MentionKind } from "@/lib/brand-studio/enhancer/mentions";
import { referenceVideoFit, type ReferenceVideoFit, type ReferenceVideoProblem } from "@/lib/brand-studio/reference-video";
import { imageRunUsd, regionEditRun, remixRunUsd, usageKrw, videoRunUsd, regionEditModel as editModelFor } from "@/lib/brand-studio/usage-rate";
import type { StudioOps } from "./api";
import { toReferences, type RefSource, type TrayItem } from "./refs";

export interface DockDraft {
  medium: StudioMedium;
  model: string;
  prompt: string;
  aspect: string;
  resolution: string;
  /** Models with `qualities` (GPT Image): low / medium / high; "" for the others. */
  quality: string;
  count: number;
  seconds: number;
  audio: StudioAudioMode;
  enhance: boolean;
  /** Reference video runs only. */
  method: StudioRemixMethod;
  keep: StudioKeepKey[];
  change: string;
}

/** The 480p first pass a final is made from (contracts.ts `VideoBase.resolution`). */
export const DRAFT_RESOLUTION = "draft";

function modelFor(medium: StudioMedium, id?: string): StudioModel {
  const live = selectableModels(medium);
  const wanted = id ? live.find((m) => m.id === id) : undefined;
  const fallback = live.find((m) => m.id === (medium === "image" ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL));
  const model = wanted ?? fallback ?? live[0];
  if (!model) throw new Error(`no live ${medium} model`);
  return model;
}

export interface DockControls {
  models: StudioModel[];
  model: StudioModel;
  aspects: readonly string[];
  resolutions: readonly string[];
  /** Empty for a model without a quality choice (the chip is not shown). */
  qualities: readonly string[];
  counts: number[];
  seconds: number[];
}

export function dockControls(draft: Pick<DockDraft, "medium" | "model">): DockControls {
  const model = modelFor(draft.medium, draft.model);
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (model.medium === "image")
    return {
      models: selectableModels("image"),
      model,
      aspects: model.aspects,
      resolutions: model.resolutions,
      qualities: model.qualities ?? [],
      counts: range(1, STUDIO_LIMITS.imageCountMax),
      seconds: [],
    };
  const video = model as StudioVideoModel;
  return {
    models: selectableModels("video"),
    model,
    aspects: video.aspects,
    resolutions: video.supportsDraft ? [DRAFT_RESOLUTION, ...video.resolutions] : video.resolutions,
    qualities: [],
    counts: [],
    seconds: range(video.minSeconds, video.maxSeconds),
  };
}

/** Keeps every value the current model allows and replaces the rest with that model's defaults. */
export function normalizeDraft(draft: DockDraft): DockDraft {
  const controls = dockControls(draft);
  const model = controls.model;
  const aspect = controls.aspects.includes(draft.aspect) ? draft.aspect : controls.aspects.includes("1:1") ? "1:1" : controls.aspects[0]!;
  // A video starts as the 480p draft when the model has one: the cheap first pass, finished at 1080p once it looks right.
  const fallbackResolution =
    model.medium === "image"
      ? (model as StudioImageModel).defaultResolution
      : (model as StudioVideoModel).supportsDraft
        ? DRAFT_RESOLUTION
        : (model as StudioVideoModel).defaultResolution;
  const resolution = controls.resolutions.includes(draft.resolution) ? draft.resolution : fallbackResolution;
  const video = model.medium === "video" ? (model as StudioVideoModel) : null;
  const seconds = video ? Math.min(video.maxSeconds, Math.max(video.minSeconds, draft.seconds || video.defaultSeconds)) : draft.seconds;
  const count = Math.min(STUDIO_LIMITS.imageCountMax, Math.max(1, Math.round(draft.count) || 1));
  const image = model.medium === "image" ? (model as StudioImageModel) : null;
  const quality = qualityOf(image, draft.quality);
  return { ...draft, model: model.id, aspect, resolution, quality, seconds, count };
}

/** The quality a model runs at: the asked one when it has it, else its default; "" without a choice. */
export function qualityOf(model: Pick<StudioImageModel, "qualities" | "defaultQuality"> | null, asked: string | null | undefined): string {
  const qualities = model?.qualities ?? [];
  if (!qualities.length) return "";
  return asked && (qualities as readonly string[]).includes(asked) ? asked : (model?.defaultQuality ?? qualities[0]!);
}

export function initialDraft(medium: StudioMedium = "image"): DockDraft {
  const model = modelFor(medium);
  return normalizeDraft({
    medium,
    model: model.id,
    prompt: "",
    aspect: medium === "video" ? "9:16" : "4:3",
    resolution: "",
    quality: "",
    count: 1,
    seconds: model.medium === "video" ? (model as StudioVideoModel).defaultSeconds : 5,
    audio: "native",
    enhance: true,
    method: "reference",
    keep: ["camera", "timing"],
    change: "",
  });
}

export function withMedium(draft: DockDraft, medium: StudioMedium): DockDraft {
  if (draft.medium === medium) return draft;
  return normalizeDraft({ ...draft, medium, model: modelFor(medium).id });
}

export function withModel(draft: DockDraft, id: string): DockDraft {
  return normalizeDraft({ ...draft, model: id });
}

/**
 * What a new reference does to the bar. The screen fixes the medium, so a video never turns the image
 * screen into a video run: it is refused there (`attachRefusal`). Without a fixed screen (older callers)
 * a video still switches a picture run to video.
 */
export function draftAfterAttach(draft: DockDraft, item: Pick<TrayItem, "kind">, locked = false): DockDraft {
  if (locked) return draft;
  return item.kind === "video" && draft.medium === "image" ? withMedium(draft, "video") : draft;
}

/** True when the image screen must turn a reference away (only pictures belong there). */
export function attachRefusal(mode: StudioMedium, item: Pick<TrayItem, "kind">): boolean {
  return mode === "image" && item.kind !== "image";
}

/** A video run with a reference video becomes a remix; the panel defaults it to the 480p draft. */
export function remixActive(draft: Pick<DockDraft, "medium">, tray: readonly Pick<TrayItem, "kind">[]): boolean {
  return draft.medium === "video" && tray.some((item) => item.kind === "video");
}

/** The registry's reference-video seconds, for the customer's sentence. */
export type FilmLimits = StudioVideoModel["referenceVideoSeconds"];

/** The reference video in a video run against the model's limits; null when there is none. */
export function remixFit(draft: Pick<DockDraft, "medium" | "model">, tray: readonly TrayItem[]): ReferenceVideoFit | null {
  const film = draft.medium === "video" ? tray.find((item) => item.kind === "video") : undefined;
  const model = dockControls(draft).model;
  if (!film || model.medium !== "video") return null;
  return referenceVideoFit(model as StudioVideoModel, { seconds: film.seconds, width: film.width ?? null, height: film.height ?? null });
}

/**
 * What about the reference video stops this run. A blueprint only reads the clip and never sends it
 * (docs/BRAND-STUDIO-V3.md §6), so its pixel size cannot block one; its length still can.
 */
export function remixBlocking(draft: Pick<DockDraft, "method">, fit: ReferenceVideoFit | null): ReferenceVideoProblem | null {
  if (!fit?.problem) return null;
  if (draft.method === "blueprint" && (fit.problem === "small" || fit.problem === "large")) return null;
  return fit.problem;
}

export type DockProblem =
  | { kind: "empty_prompt" }
  | { kind: "film_unusable"; problem: ReferenceVideoProblem; limits: FilmLimits }
  | { kind: "film_edit_short"; limits: FilmLimits }
  | { kind: "need_change" }
  | { kind: "image_only" }
  | { kind: "too_many_videos" }
  | { kind: "too_many_images"; max: number }
  | { kind: "missing"; mentions: Array<{ kind: MentionKind | "any"; number: number }> };

export function dockProblem(draft: DockDraft, tray: readonly TrayItem[]): DockProblem | null {
  const remix = remixActive(draft, tray);
  if (!remix && !draft.prompt.trim()) return { kind: "empty_prompt" };
  const fit = remix ? remixFit(draft, tray) : null;
  const limits = (dockControls(draft).model as StudioVideoModel).referenceVideoSeconds;
  const problem = remixBlocking(draft, fit);
  if (problem) return { kind: "film_unusable", problem, limits };
  if (fit && draft.method === "edit" && !fit.editable) return { kind: "film_edit_short", limits };
  if (remix && !draft.prompt.trim() && !draft.change.trim()) return { kind: "need_change" };
  if (draft.medium === "image" && tray.some((item) => item.kind !== "image")) return { kind: "image_only" };
  const model = dockControls(draft).model;
  const images = tray.filter((item) => item.kind === "image").length;
  if (model.medium === "video") {
    const video = model as StudioVideoModel;
    if (tray.filter((item) => item.kind === "video").length > video.maxReferenceVideos) return { kind: "too_many_videos" };
    if (images > video.maxReferenceImages) return { kind: "too_many_images", max: video.maxReferenceImages };
  } else if (images > (model as StudioImageModel).maxReferences) {
    return { kind: "too_many_images", max: (model as StudioImageModel).maxReferences };
  }
  const kinds = tray.map((item) => item.kind as MentionKind);
  const mentions = findMissingReferences(`${draft.prompt}\n${remix ? draft.change : ""}`, kinds);
  return mentions.length ? { kind: "missing", mentions } : null;
}

/**
 * One press of "만들기" as a contract request, or the reason it cannot be sent. `preEnhanced`: the
 * prompt in the bar is the one the ✨ button already improved, so it is sent as it is (`enhance: false`)
 * and never rewritten twice.
 */
export function buildJob(
  draft: DockDraft,
  tray: readonly TrayItem[],
  ids: { organizationId: string; requestId: string },
  options: { preEnhanced?: boolean } = {},
): { ok: true; input: StudioJobCreate } | { ok: false; problem: DockProblem } {
  const clean = normalizeDraft(draft);
  const problem = dockProblem(clean, tray);
  if (problem) return { ok: false, problem };
  const base = {
    organizationId: ids.organizationId,
    requestId: ids.requestId,
    model: clean.model,
    prompt: clean.prompt.trim(),
    enhance: options.preEnhanced ? false : clean.enhance,
    references: toReferences(tray, clean.medium),
    aspect: clean.aspect,
  };
  if (clean.medium === "image")
    return { ok: true, input: { kind: "image", ...base, resolution: clean.resolution, count: clean.count, ...(clean.quality ? { quality: clean.quality as StudioImageQuality } : {}) } };
  const resolution = clean.resolution as "draft" | "480p" | "720p" | "1080p";
  if (remixActive(clean, tray))
    return {
      ok: true,
      input: {
        kind: "video_remix",
        ...base,
        resolution,
        audio: clean.audio,
        method: clean.method,
        keep: STUDIO_KEEP_KEYS.filter((key) => clean.keep.includes(key)),
        change: clean.change.trim(),
        ...(clean.method !== "edit" ? { seconds: clean.seconds } : {}),
      },
    };
  return { ok: true, input: { kind: "video", ...base, resolution, audio: clean.audio, seconds: clean.seconds } };
}

/** The `prompt.enhance` input for what the bar would send: the same request without its id, enhancement on. */
export type EnhancePreviewInput = StudioOps["prompt.enhance"][0];

export function enhancePreviewInput(
  draft: DockDraft,
  tray: readonly TrayItem[],
  organizationId: string,
): { ok: true; input: EnhancePreviewInput } | { ok: false; problem: DockProblem } {
  const built = buildJob({ ...draft, enhance: true }, tray, { organizationId, requestId: "preview-0" });
  if (!built.ok) return built;
  if (built.input.kind === "video_final") return { ok: false, problem: { kind: "empty_prompt" } };
  const { requestId: _dropped, ...rest } = built.input;
  return { ok: true, input: rest as EnhancePreviewInput };
}

/**
 * "같은 설정으로 다시 만들기": a direct re-run for plain image and video jobs; null for the others (a
 * partial edit reopens its box, a reference-video run goes back to the bar).
 */
export function rerunInput(job: StudioJobView, ids: { organizationId: string; requestId: string }): StudioJobCreate | null {
  const enhance = job.finalPrompt !== null;
  const base = { organizationId: ids.organizationId, requestId: ids.requestId, model: job.model, prompt: job.prompt, enhance, references: job.references };
  if (job.kind === "image" && job.aspect && job.resolution)
    return {
      kind: "image",
      ...base,
      aspect: job.aspect,
      resolution: job.resolution,
      count: Math.min(STUDIO_LIMITS.imageCountMax, Math.max(1, job.expected)),
      ...(job.quality ? { quality: job.quality } : {}),
    };
  if (job.kind === "video" && job.aspect && job.resolution && job.seconds)
    return {
      kind: "video",
      ...base,
      aspect: job.aspect,
      resolution: job.resolution as "draft" | "480p" | "720p" | "1080p",
      audio: job.audio ?? "native",
      seconds: job.seconds,
    };
  return null;
}

/** "설정 다시 쓰기": the bar as it was for this job (the tray is rebuilt separately). */
export function draftFromJob(job: StudioJobView, current: DockDraft): DockDraft {
  const medium: StudioMedium = job.kind === "image" || job.kind === "region_edit" ? "image" : "video";
  const model = studioModel(job.model)?.medium === medium ? job.model : current.model;
  return normalizeDraft({
    ...withMedium(current, medium),
    model,
    prompt: job.prompt,
    aspect: job.aspect ?? current.aspect,
    resolution: job.resolution ?? "",
    quality: job.quality ?? "",
    count: job.kind === "image" ? job.expected : current.count,
    seconds: job.seconds ?? current.seconds,
    audio: job.audio ?? current.audio,
    enhance: job.finalPrompt !== null,
    ...(job.kind === "video_remix"
      ? { method: job.method ?? current.method, keep: [...job.keep], change: job.change ?? "" }
      : {}),
  });
}

/**
 * What this press will take from the monthly allowance, in KRW, computed with the server's own
 * arithmetic (lib/brand-studio/usage-rate.ts) from the same inputs: count, quality, references,
 * length, the reference video's length, and the 480p draft billed as 480p. Screens show `dockCredits`.
 */
export function dockEstimateKrw(draft: DockDraft, tray: readonly TrayItem[]): number {
  const clean = normalizeDraft(draft);
  const model = dockControls(clean).model;
  if (model.medium === "image")
    return usageKrw(imageRunUsd({ model: model.id, resolution: clean.resolution, references: tray.length, count: clean.count, quality: clean.quality || null }), "image");
  const film = tray.find((item) => item.kind === "video");
  if (film)
    return usageKrw(
      remixRunUsd({ model: model as StudioVideoModel, resolution: clean.resolution, method: clean.method, seconds: clean.method !== "edit" ? clean.seconds : null, referenceSeconds: film.seconds }).usd,
      "video",
    );
  return usageKrw(videoRunUsd({ resolution: clean.resolution, seconds: clean.seconds }), "video");
}

/** This press in credits (the number on the "만들기" button). */
export function dockCredits(draft: DockDraft, tray: readonly TrayItem[]): number {
  return creditsOf(dockEstimateKrw(draft, tray));
}

/**
 * Credits for ONE image on `model` at the bar's settings (the model menu's line). A quality the model
 * does not have reads at its default.
 */
export function imageCreditsFor(model: StudioImageModel, draft: Pick<DockDraft, "resolution"> & Partial<Pick<DockDraft, "quality">>, references: number): number {
  const resolution = (model.resolutions as readonly string[]).includes(draft.resolution) ? draft.resolution : model.defaultResolution;
  const quality = qualityOf(model, draft.quality) || null;
  return creditsOf(usageKrw(estimateImageUsd({ model: model.id, resolution, references, quality }), "image"));
}

/* ------------------------------------------------------------ partial edit */

/**
 * In the partial-edit form the cut-out is picture 1 and the references follow from 2, the numbers the
 * model itself reads. The server numbers references from 1, so before sending, a customer's "이미지 2"
 * becomes "이미지 1" and "이미지 1" becomes "the selected area".
 */
const AREA = { ko: "선택한 부분", en: "the selected area" } as const;
const IMAGE_WORD = { ko: "이미지", en: "image" } as const;

export function regionInstructionForServer(text: string, locale: "ko" | "en"): string {
  return rewriteReferenceMentions(text, (kind, n) => {
    if (kind === "image") return n === 1 ? AREA[locale] : `${IMAGE_WORD[locale]} ${n - 1}`;
    if (kind === "any") return n === 1 ? AREA[locale] : `@${n - 1}`;
    return null;
  });
}

/** The words as the form shows them again ("다시 만들기" on a partial edit): numbers back from 2. */
export function regionInstructionForForm(text: string, locale: "ko" | "en"): string {
  return rewriteReferenceMentions(text, (kind, n) => {
    if (kind === "image") return `${IMAGE_WORD[locale]} ${n + 1}`;
    if (kind === "any") return `@${n + 1}`;
    return null;
  });
}

/** Image models a partial edit may run on (live, with `regionEdit`). */
export { regionEditModels } from "@/lib/brand-studio/models";

/** The region edit model: the picked one when it edits well, otherwise the registry default. */
export function regionEditModel(draft: Pick<DockDraft, "medium" | "model">): string {
  return editModelFor(draft.model).id;
}

/** What one partial edit takes from the allowance, in KRW (one edit call; the cut-out counts as a reference). */
export function regionEstimateKrw(draft: Pick<DockDraft, "medium" | "model">, references = 0): number {
  return usageKrw(regionEditRun(regionEditModel(draft), references).usd, "image");
}

export function regionCredits(model: string, references: number, quality?: string | null): number {
  return creditsOf(usageKrw(regionEditRun(model, references, qualityOf(editModelFor(model), quality) || null).usd, "image"));
}

export type RegionProblem =
  | { kind: "need_box" }
  | { kind: "empty_prompt" }
  | { kind: "image_only" }
  | { kind: "too_many_images"; max: number }
  | { kind: "missing"; mentions: Array<{ kind: MentionKind | "any"; number: number }> };

/** What stops a partial edit before it is sent (the server checks again). Mention numbers are the form's. */
export function regionProblem(input: {
  box: RegionBox | null;
  instruction: string;
  model: string;
  references: readonly Pick<TrayItem, "kind">[];
}): RegionProblem | null {
  if (!input.box) return { kind: "need_box" };
  if (!input.instruction.trim()) return { kind: "empty_prompt" };
  if (input.references.some((r) => r.kind !== "image")) return { kind: "image_only" };
  const model = editModelFor(input.model);
  if (input.references.length + 1 > model.maxReferences) return { kind: "too_many_images", max: model.maxReferences - 1 };
  // The cut-out is picture 1 in the form, so "이미지 N" may go up to references + 1.
  const kinds: MentionKind[] = ["image", ...input.references.map(() => "image" as const)];
  const mentions = findMissingReferences(input.instruction, kinds);
  return mentions.length ? { kind: "missing", mentions } : null;
}

/** "부분 수정": the box, the instruction and the references on one result or library picture. */
export function regionEditInput(input: {
  ids: { organizationId: string; requestId: string };
  source: RefSource;
  box: RegionBox;
  instruction: string;
  draft: Pick<DockDraft, "medium" | "model" | "enhance">;
  /** The model picked in the form; the bar's model (or the default edit model) when absent. */
  model?: string;
  /** References after the cut-out, in form order (2, 3, …). */
  references?: readonly TrayItem[];
  /** Sent only when the edit model has qualities. */
  quality?: string | null;
  locale?: "ko" | "en";
}): StudioJobCreate {
  const references = input.references ?? [];
  const prompt = input.instruction.trim();
  const model = input.model ? editModelFor(input.model) : editModelFor(input.draft.model);
  const quality = qualityOf(model, input.quality);
  return {
    kind: "region_edit",
    organizationId: input.ids.organizationId,
    requestId: input.ids.requestId,
    model: model.id,
    prompt: regionInstructionForServer(prompt, input.locale ?? "ko"),
    enhance: input.draft.enhance,
    references: toReferences(references, "image"),
    source: "assetId" in input.source ? { assetId: input.source.assetId } : { outputId: input.source.outputId },
    box: input.box,
    ...(quality ? { quality: quality as StudioImageQuality } : {}),
  };
}

/** "1080p로 완성" for a finished 480p draft. */
export function finalInput(ids: { organizationId: string; requestId: string }, draftOutputId: string): StudioJobCreate {
  return { kind: "video_final", organizationId: ids.organizationId, requestId: ids.requestId, draftOutputId };
}
