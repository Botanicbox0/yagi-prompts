/**
 * The reference-video (reverse) panel's rules, kept pure so they are tested without a browser
 * (docs/BRAND-STUDIO-V3.md §6): which methods a clip allows, the shot-table edits, the change sentence,
 * the credits a draft takes and the one `job.create` request it sends. Every limit comes from the model
 * registry and the server's own arithmetic (lib/brand-studio/{reference-video,usage-rate}.ts), so the
 * panel never promises what the server would refuse or quotes a number the server would not reserve.
 */
import {
  STUDIO_KEEP_KEYS,
  type FilmSheet,
  type FilmShot,
  type StudioAssetRole,
  type StudioAssetView,
  type StudioAudioMode,
  type StudioJobCreate,
  type StudioJobView,
  type StudioKeepKey,
  type StudioReference,
  type StudioRemixMethod,
} from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { DEFAULT_VIDEO_MODEL, studioModel, type StudioVideoModel } from "@/lib/brand-studio/models";
import { blueprintFit, referenceVideoFit, remakeSeconds } from "@/lib/brand-studio/reference-video";
import { remixRunUsd, usageKrw } from "@/lib/brand-studio/usage-rate";

/** `{name}` placeholders, left as written when a value is missing. */
export function fillText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export type ChangeSlot = "product" | "person" | "place";
export const CHANGE_SLOTS: readonly ChangeSlot[] = ["product", "person", "place"];
/** The methods in the order the panel offers them: the one that needs nothing attached first. */
export const REVERSE_METHODS: readonly StudioRemixMethod[] = ["blueprint", "reference", "edit"];

const SLOT_ROLE: Record<ChangeSlot, StudioAssetRole> = { product: "product", person: "person", place: "place" };

export function reverseModel(): StudioVideoModel {
  const model = studioModel(DEFAULT_VIDEO_MODEL);
  if (!model || model.medium !== "video") throw new Error("no video model");
  return model;
}

export interface ReverseImage {
  assetId: string;
  url: string;
  thumbUrl: string | null;
  name: string;
  slot: ChangeSlot;
}

export interface ReverseDraft {
  videoId: string | null;
  method: StudioRemixMethod;
  /** The shot table as the customer left it; null while it is exactly what was read. */
  shots: FilmShot[] | null;
  change: Record<ChangeSlot, string>;
  images: ReverseImage[];
  keep: StudioKeepKey[];
  audio: StudioAudioMode;
  seconds: number;
  aspect: string;
  note: string;
}

export type ReverseVideo = Pick<StudioAssetView, "id" | "seconds" | "width" | "height">;

export function emptyDraft(model: StudioVideoModel = reverseModel()): ReverseDraft {
  return {
    videoId: null,
    method: "blueprint",
    shots: null,
    change: { product: "", person: "", place: "" },
    images: [],
    keep: defaultKeep("blueprint"),
    audio: "native",
    seconds: model.defaultSeconds,
    aspect: model.aspects.includes("9:16") ? "9:16" : model.aspects[0]!,
    note: "",
  };
}

/** A blueprint keeps everything by default (it is a remake); a new take follows camera and timing. */
export function defaultKeep(method: StudioRemixMethod): StudioKeepKey[] {
  if (method === "blueprint") return [...STUDIO_KEEP_KEYS];
  if (method === "reference") return ["camera", "timing"];
  return [];
}

/** The model shape closest to the clip's own (within its list), else 9:16. */
export function aspectFor(model: Pick<StudioVideoModel, "aspects">, video: Pick<ReverseVideo, "width" | "height"> | null): string {
  const fallback = model.aspects.includes("9:16") ? "9:16" : model.aspects[0]!;
  if (!video?.width || !video.height) return fallback;
  const ratio = video.width / video.height;
  let best: [string, number] | null = null;
  for (const aspect of model.aspects) {
    const [w, h] = aspect.split(":").map(Number);
    if (!w || !h) continue;
    const off = Math.abs(Math.log(ratio / (w / h)));
    if (!best || off < best[1]) best = [aspect, off];
  }
  return best ? best[0] : fallback;
}

export type ClipNotice = "tooShort" | "tooLong" | "small" | "large" | "editShort" | null;

/** One plain sentence's worth: why a clip cannot be used at all, or which way is closed for it. */
export function clipNotice(model: StudioVideoModel, video: ReverseVideo | null): ClipNotice {
  if (!video) return null;
  const fit = referenceVideoFit(model, video);
  const read = blueprintFit(model, video);
  if (read.problem === "length") return (video.seconds ?? 0) < model.referenceVideoSeconds.min ? "tooShort" : "tooLong";
  if (fit.problem === "small" || fit.problem === "large") return fit.problem;
  return fit.editable ? null : "editShort";
}

export type ReadState = { status: "idle" } | { status: "loading" } | { status: "done"; sheet: FilmSheet | null };

/** Which ways this clip allows. A blueprint also needs a reading (or a table the customer wrote). */
export function methodsFor(
  model: StudioVideoModel,
  video: ReverseVideo | null,
  shots: readonly FilmShot[] | null,
): Record<StudioRemixMethod, boolean> {
  if (!video) return { blueprint: false, reference: false, edit: false };
  const fit = referenceVideoFit(model, video);
  return {
    blueprint: blueprintFit(model, video).readable && Boolean(shots?.length),
    reference: fit.problem === null,
    edit: fit.editable,
  };
}

/** The first way this clip allows, in the panel's order; the current one when it is still open. */
export function pickMethod(current: StudioRemixMethod, allowed: Record<StudioRemixMethod, boolean>): StudioRemixMethod {
  if (allowed[current]) return current;
  return REVERSE_METHODS.find((m) => allowed[m]) ?? current;
}

/* -------------------------------------------------------------- shot table */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The table shown: the customer's edits, else what was read. */
export function tableOf(draft: Pick<ReverseDraft, "shots">, sheet: FilmSheet | null | undefined): FilmShot[] {
  return draft.shots ?? (sheet?.shots ?? []).map((s) => ({ ...s }));
}

/** Text edits to one row. Rewriting the camera drops the read travel/turn/zoom split, which no longer matches it. */
export function editShot(
  table: readonly FilmShot[],
  index: number,
  patch: Partial<Pick<FilmShot, "framing" | "camera" | "action" | "transition">>,
): FilmShot[] {
  return table.map((shot, i) => {
    if (i !== index) return shot;
    const next: FilmShot = { ...shot, ...patch };
    if (patch.camera !== undefined && patch.camera !== shot.camera) delete next.move;
    return next;
  });
}

/** Moves the cut after row `index`: that row ends there and the next one starts there (0.1 s apart at least). */
export function setShotEnd(table: readonly FilmShot[], index: number, end: number, total: number): FilmShot[] {
  const row = table[index];
  if (!row || !Number.isFinite(end)) return [...table];
  const next = table[index + 1];
  const max = next ? next.end - 0.1 : total;
  const value = round1(Math.min(max, Math.max(row.start + 0.1, end)));
  return table.map((shot, i) => (i === index ? { ...shot, end: value } : i === index + 1 ? { ...shot, start: value } : shot));
}

/** Removes a row; its time goes to the row before it (or, for the first row, to the one after). */
export function removeShot(table: readonly FilmShot[], index: number): FilmShot[] {
  if (table.length <= 1 || !table[index]) return [...table];
  const removed = table[index]!;
  const rest = table.filter((_, i) => i !== index);
  if (index === 0) return rest.map((shot, i) => (i === 0 ? { ...shot, start: removed.start } : shot));
  return rest.map((shot, i) => (i === index - 1 ? { ...shot, end: removed.end } : shot));
}

/* ---------------------------------------------------------- the request */

export interface ChangeWords {
  product: string;
  person: string;
  place: string;
  /** "이미지" / "image": the word the server maps to the attached picture ("이미지 2" → that picture). */
  imageWord: string;
}

/** Picture numbers in send order (the video is not a picture, so pictures count from 1). */
export function imageNumbers(images: readonly ReverseImage[]): Map<string, number> {
  return new Map(images.map((image, i) => [image.assetId, i + 1]));
}

/** "제품: 우리 세럼 병으로 (이미지 1)" — one line per slot the customer filled, in their words. */
export function changeText(draft: Pick<ReverseDraft, "change" | "images">, words: ChangeWords): string {
  const numbers = imageNumbers(draft.images);
  return CHANGE_SLOTS.map((slot) => {
    const text = draft.change[slot].trim();
    const refs = draft.images.filter((i) => i.slot === slot).map((i) => `${words.imageWord} ${numbers.get(i.assetId)}`);
    if (!text && refs.length === 0) return "";
    return `${words[slot]}: ${[text, refs.length ? `(${refs.join(", ")})` : ""].filter(Boolean).join(" ")}`;
  })
    .filter(Boolean)
    .join("\n");
}

export type ReverseProblem = "video" | "reading" | "change" | "images" | "method";

/** The draft as one `job.create` input, or the one thing that stops it. */
export function buildReverseJob(
  draft: ReverseDraft,
  context: { video: ReverseVideo | null; sheet: FilmSheet | null | undefined; words: ChangeWords },
  ids: { organizationId: string; requestId: string },
  model: StudioVideoModel = reverseModel(),
): { ok: true; input: StudioJobCreate } | { ok: false; problem: ReverseProblem } {
  if (!draft.videoId || !context.video || context.video.id !== draft.videoId) return { ok: false, problem: "video" };
  const table = tableOf(draft, context.sheet);
  const allowed = methodsFor(model, context.video, table);
  if (draft.method === "blueprint" && table.length === 0) return { ok: false, problem: "reading" };
  if (!allowed[draft.method]) return { ok: false, problem: "method" };
  if (draft.images.length > model.maxReferenceImages) return { ok: false, problem: "images" };
  const change = changeText(draft, context.words);
  if (draft.method !== "blueprint" && !change && !draft.note.trim()) return { ok: false, problem: "change" };
  const references: StudioReference[] = [
    { assetId: draft.videoId },
    ...draft.images.map((image) => ({ assetId: image.assetId, role: SLOT_ROLE[image.slot] })),
  ];
  const remake = draft.method !== "edit";
  return {
    ok: true,
    input: {
      kind: "video_remix",
      organizationId: ids.organizationId,
      requestId: ids.requestId,
      model: model.id,
      prompt: draft.note.trim(),
      enhance: true,
      references,
      aspect: draft.aspect,
      resolution: "draft",
      audio: draft.audio,
      method: draft.method,
      keep: remake ? STUDIO_KEEP_KEYS.filter((key) => draft.keep.includes(key)) : [],
      change,
      ...(remake ? { seconds: draft.seconds } : {}),
      // The customer's own table only when they changed it; otherwise the server uses its kept reading.
      ...(remake && draft.shots?.length ? { shots: draft.shots } : {}),
    },
  };
}

/** Credits the 480p draft takes, with the server's arithmetic (a blueprint has no reference-video part). */
export function draftCredits(draft: Pick<ReverseDraft, "method" | "seconds">, video: ReverseVideo | null, model: StudioVideoModel = reverseModel()): number {
  if (!video) return 0;
  const { usd } = remixRunUsd({
    model,
    resolution: "draft",
    method: draft.method,
    seconds: draft.method === "edit" ? null : draft.seconds,
    referenceSeconds: video.seconds,
  });
  return creditsOf(usageKrw(usd, "video"));
}

/** The panel set up again from a finished or failed remix ("설정 다시 쓰기"). */
export function draftFromJob(job: StudioJobView, assets: readonly StudioAssetView[], model: StudioVideoModel = reverseModel()): ReverseDraft | null {
  if (job.kind !== "video_remix") return null;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const video = job.references.map((r) => (r.assetId ? byId.get(r.assetId) : undefined)).find((a) => a?.kind === "video");
  if (!video) return null;
  const images: ReverseImage[] = [];
  for (const ref of job.references) {
    const asset = ref.assetId ? byId.get(ref.assetId) : undefined;
    if (!asset || asset.kind !== "image") continue;
    const slot: ChangeSlot = ref.role === "person" ? "person" : ref.role === "place" ? "place" : "product";
    images.push({ assetId: asset.id, url: asset.url, thumbUrl: asset.thumbUrl, name: asset.name, slot });
  }
  const method = job.method ?? "blueprint";
  return {
    ...emptyDraft(model),
    videoId: video.id,
    method,
    shots: job.shots?.length ? job.shots.map((s) => ({ ...s })) : null,
    // The change was one sentence when it was sent; it comes back whole, as the note.
    note: [job.change ?? "", job.prompt].map((s) => s.trim()).filter(Boolean).join("\n"),
    images,
    keep: job.keep.length ? [...job.keep] : defaultKeep(method),
    audio: job.audio ?? "native",
    seconds: job.seconds ?? remakeSeconds(model, video.seconds),
    aspect: job.aspect ?? aspectFor(model, video),
  };
}
