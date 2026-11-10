/**
 * What the prompt dock may offer and what it sends (docs/BRAND-STUDIO-V2.md §5.2).
 *
 * Every control comes from the model registry (lib/brand-studio/models.ts): switching the model
 * changes the legal ratios, qualities and lengths, and a model that is not `live` never appears.
 * `buildJob` turns the dock into one contract request, or names the one thing that stops it.
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
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_REGION_EDIT_MODEL,
  DEFAULT_VIDEO_MODEL,
  selectableModels,
  studioModel,
  type StudioImageModel,
  type StudioMedium,
  type StudioModel,
  type StudioVideoModel,
} from "@/lib/brand-studio/models";
import { findMissingReferences, type MentionKind } from "@/lib/brand-studio/enhancer/mentions";
import { toReferences, type RefSource, type TrayItem } from "./refs";

export interface DockDraft {
  medium: StudioMedium;
  model: string;
  prompt: string;
  aspect: string;
  resolution: string;
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
      counts: range(1, STUDIO_LIMITS.imageCountMax),
      seconds: [],
    };
  const video = model as StudioVideoModel;
  return {
    models: selectableModels("video"),
    model,
    aspects: video.aspects,
    resolutions: video.supportsDraft ? [DRAFT_RESOLUTION, ...video.resolutions] : video.resolutions,
    counts: [],
    seconds: range(video.minSeconds, video.maxSeconds),
  };
}

/** Keeps every value the current model allows and replaces the rest with that model's defaults. */
export function normalizeDraft(draft: DockDraft): DockDraft {
  const controls = dockControls(draft);
  const model = controls.model;
  const aspect = controls.aspects.includes(draft.aspect) ? draft.aspect : controls.aspects.includes("1:1") ? "1:1" : controls.aspects[0]!;
  const fallbackResolution = model.medium === "image" ? (model as StudioImageModel).defaultResolution : (model as StudioVideoModel).defaultResolution;
  const resolution = controls.resolutions.includes(draft.resolution) ? draft.resolution : fallbackResolution;
  const video = model.medium === "video" ? (model as StudioVideoModel) : null;
  const seconds = video ? Math.min(video.maxSeconds, Math.max(video.minSeconds, draft.seconds || video.defaultSeconds)) : draft.seconds;
  const count = Math.min(STUDIO_LIMITS.imageCountMax, Math.max(1, Math.round(draft.count) || 1));
  return { ...draft, model: model.id, aspect, resolution, seconds, count };
}

export function initialDraft(medium: StudioMedium = "image"): DockDraft {
  const model = modelFor(medium);
  return normalizeDraft({
    medium,
    model: model.id,
    prompt: "",
    aspect: medium === "video" ? "9:16" : "4:3",
    resolution: "",
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

/** A video run with a reference video becomes a remix; the panel defaults it to the 480p draft. */
export function remixActive(draft: Pick<DockDraft, "medium">, tray: readonly Pick<TrayItem, "kind">[]): boolean {
  return draft.medium === "video" && tray.some((item) => item.kind === "video");
}

export type DockProblem =
  | { kind: "empty_prompt" }
  | { kind: "need_change" }
  | { kind: "image_only" }
  | { kind: "too_many_videos" }
  | { kind: "too_many_images"; max: number }
  | { kind: "missing"; mentions: Array<{ kind: MentionKind | "any"; number: number }> };

export function dockProblem(draft: DockDraft, tray: readonly TrayItem[]): DockProblem | null {
  const remix = remixActive(draft, tray);
  if (!remix && !draft.prompt.trim()) return { kind: "empty_prompt" };
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

/** One press of "만들기" as a contract request, or the reason it cannot be sent. */
export function buildJob(
  draft: DockDraft,
  tray: readonly TrayItem[],
  ids: { organizationId: string; requestId: string },
): { ok: true; input: StudioJobCreate } | { ok: false; problem: DockProblem } {
  const clean = normalizeDraft(draft);
  const problem = dockProblem(clean, tray);
  if (problem) return { ok: false, problem };
  const base = {
    organizationId: ids.organizationId,
    requestId: ids.requestId,
    model: clean.model,
    prompt: clean.prompt.trim(),
    enhance: clean.enhance,
    references: toReferences(tray, clean.medium),
    aspect: clean.aspect,
  };
  if (clean.medium === "image")
    return { ok: true, input: { kind: "image", ...base, resolution: clean.resolution, count: clean.count } };
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
        ...(clean.method === "reference" ? { seconds: clean.seconds } : {}),
      },
    };
  return { ok: true, input: { kind: "video", ...base, resolution, audio: clean.audio, seconds: clean.seconds } };
}

/** "같은 설정으로 다시": a direct re-run for plain image and video jobs; null for the others. */
export function rerunInput(job: StudioJobView, ids: { organizationId: string; requestId: string }): StudioJobCreate | null {
  const enhance = job.finalPrompt !== null;
  const base = { organizationId: ids.organizationId, requestId: ids.requestId, model: job.model, prompt: job.prompt, enhance, references: job.references };
  if (job.kind === "image" && job.aspect && job.resolution)
    return { kind: "image", ...base, aspect: job.aspect, resolution: job.resolution, count: Math.min(STUDIO_LIMITS.imageCountMax, Math.max(1, job.expected)) };
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

/** "이 설정 다시 쓰기": the dock as it was for this job (the tray is rebuilt separately). */
export function draftFromJob(job: StudioJobView, current: DockDraft): DockDraft {
  const medium: StudioMedium = job.kind === "image" || job.kind === "region_edit" ? "image" : "video";
  const model = studioModel(job.model)?.medium === medium ? job.model : current.model;
  return normalizeDraft({
    ...withMedium(current, medium),
    model,
    prompt: job.prompt,
    aspect: job.aspect ?? current.aspect,
    resolution: job.resolution ?? "",
    count: job.kind === "image" ? job.expected : current.count,
    seconds: job.seconds ?? current.seconds,
    audio: job.audio ?? current.audio,
    enhance: job.finalPrompt !== null,
  });
}

/**
 * This run's expected usage, as the server priced it for an earlier run with the same settings; null
 * when no earlier run matches. The screen never prices a run itself.
 */
export function knownEstimate(jobs: readonly StudioJobView[], draft: DockDraft, tray: readonly TrayItem[]): number | null {
  const clean = normalizeDraft(draft);
  const kind = clean.medium === "image" ? "image" : remixActive(clean, tray) ? "video_remix" : "video";
  const match = jobs.find(
    (job) =>
      job.kind === kind &&
      job.model === clean.model &&
      job.resolution === clean.resolution &&
      job.references.length === tray.length &&
      (kind === "image" ? job.expected === clean.count : job.seconds === clean.seconds) &&
      job.estimateKrw > 0,
  );
  return match ? match.estimateKrw : null;
}

/** "부분 수정": the box and the instruction on one result or library picture. */
export function regionEditInput(input: {
  ids: { organizationId: string; requestId: string };
  source: RefSource;
  box: RegionBox;
  instruction: string;
  draft: Pick<DockDraft, "medium" | "model" | "enhance">;
}): StudioJobCreate {
  return {
    kind: "region_edit",
    organizationId: input.ids.organizationId,
    requestId: input.ids.requestId,
    model: regionEditModel(input.draft),
    prompt: input.instruction.trim(),
    enhance: input.draft.enhance,
    references: [],
    source: "assetId" in input.source ? { assetId: input.source.assetId } : { outputId: input.source.outputId },
    box: input.box,
  };
}

/** "1080p로 완성" for a finished 480p draft. */
export function finalInput(ids: { organizationId: string; requestId: string }, draftOutputId: string): StudioJobCreate {
  return { kind: "video_final", organizationId: ids.organizationId, requestId: ids.requestId, draftOutputId };
}

/** The region edit model: the dock's image model when it edits well, otherwise the registry default. */
export function regionEditModel(draft: Pick<DockDraft, "medium" | "model">): string {
  const chosen = studioModel(draft.model);
  return chosen?.medium === "image" && chosen.availability === "live" && (chosen as StudioImageModel).regionEdit
    ? chosen.id
    : DEFAULT_REGION_EDIT_MODEL;
}
