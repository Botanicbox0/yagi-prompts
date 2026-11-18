/**
 * Pure builders: (job kind + params + resolved input URLs + final prompt) -> the exact Sunra request.
 *
 * Shapes follow docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt and the per-model OpenAPI documents
 * of the Sunra catalogue (read 2026-11-10): image inputs are arrays of URL strings; Seedance's
 * image-to-video takes no `ratio` (it follows the start frame); an explicit edit needs `duration: -1`
 * and `ratio: 'adaptive'`; a draft is `draft: true` at 480p with a length of its own (a run that follows
 * its source, `duration: -1`, never is: ../reference-video.ts `isDraftRun`); a final is `draft-to-video`
 * with the draft id only.
 *
 * `enable_safety_checker` is sent as `true` on every endpoint that has the field (the Seedream family).
 * There is deliberately no parameter that could turn it off.
 */
import type { StudioJobKind } from '../contracts';
import { gptReasoningEffort } from './complexity';
import { pixelSize, studioModel, type StudioImageModel, type StudioModel, type StudioVideoModel } from '../models';
import type { StudioJobParams } from '../types';
import type { StudioProviderRequest } from './types';

export interface StudioRequestInput {
  kind: StudioJobKind;
  model: string;
  /** What is sent: the enhanced prompt, or the customer's words when enhancement is off. */
  prompt: string;
  params: StudioJobParams;
  /** Reference images in tray order. `frame` marks an opening/closing still for a video. */
  images: ReadonlyArray<{ url: string; frame?: 'start' | 'end' }>;
  videos: ReadonlyArray<{ url: string }>;
  audios?: ReadonlyArray<{ url: string }>;
  /** region_edit: the enlarged crop; it is image 1, the references follow. */
  regionCrop?: { url: string; aspect: string } | null;
  /** video_final: the draft to finish. */
  draftTaskId?: string | null;
}

export class StudioRequestError extends Error {
  constructor(readonly reason: string) {
    super(`studio request: ${reason}`);
    this.name = 'StudioRequestError';
  }
}

/** Endpoints whose input schema carries `enable_safety_checker` (Seedream 5.0 models). */
export function hasSafetyChecker(model: StudioModel): boolean {
  return Boolean(model.safetyChecker);
}

function imageModel(id: string): StudioImageModel {
  const model = studioModel(id);
  if (!model || model.medium !== 'image') throw new StudioRequestError(`not an image model: ${id}`);
  return model;
}

function videoModel(id: string): StudioVideoModel {
  const model = studioModel(id);
  if (!model || model.medium !== 'video') throw new StudioRequestError(`not a video model: ${id}`);
  return model;
}

function pick<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function safety(model: StudioModel): Record<string, unknown> {
  return hasSafetyChecker(model) ? { enable_safety_checker: true } : {};
}

/**
 * GPT Image 2.6 (catalogue schema, 2026-11-11): the tier and ratio become exact `width` / `height`
 * (models.ts sizes), `quality` is the one the run was planned at (low|medium|high; sent explicitly so a
 * default change upstream cannot move it), one image per request (`n` left at 1), edits take `images`
 * (up to 16). No safety field exists on these endpoints. The output stays PNG (SVG is never asked for).
 */
function pixelShape(model: StudioImageModel, resolution: string | null | undefined, aspect: string, quality: string | null | undefined): Record<string, unknown> {
  const size = pixelSize(model, pick(resolution, model.resolutions, model.defaultResolution), aspect);
  if (!size) throw new StudioRequestError(`no size for ${model.id}`);
  const qualities = model.qualities ?? [];
  return { width: size[0], height: size[1], quality: pick(quality, qualities, model.defaultQuality ?? 'medium') };
}

/** GPT Image 2.6 planning depth (provider/complexity.ts); nothing for models without the field. */
function reasoning(model: StudioImageModel, kind: StudioJobKind, prompt: string, references: number): Record<string, unknown> {
  return model.supportsReasoningEffort ? { reasoning_effort: gptReasoningEffort({ kind, prompt, references }) } : {};
}

function imageRequest(input: StudioRequestInput): StudioProviderRequest {
  const model = imageModel(input.model);
  const urls = input.images.map((i) => i.url);
  if (urls.length > model.maxReferences) throw new StudioRequestError('too many reference images');
  if (model.pixels) {
    const body = {
      prompt: input.prompt,
      ...pixelShape(model, input.params.resolution, pick(input.params.aspect, model.aspects, model.aspects[0]!), input.params.quality),
      ...reasoning(model, 'image', input.prompt, urls.length),
    };
    if (urls.length === 0) return { endpoint: `${model.api.alias}/${model.endpoints.textToImage}`, body };
    return { endpoint: `${model.api.alias}/${model.endpoints.edit}`, body: { ...body, images: urls } };
  }
  const background = model.supportsTransparentBackground && input.params.background ? input.params.background : undefined;
  const common = {
    prompt: input.prompt,
    aspect_ratio: pick(input.params.aspect, model.aspects, model.aspects[0]!),
    resolution: pick(input.params.resolution, model.resolutions, model.defaultResolution),
    ...(background ? { background } : {}),
    ...(background === 'transparent' ? { output_format: 'png' } : {}),
    ...safety(model),
  };
  if (urls.length === 0) return { endpoint: `${model.api.alias}/${model.endpoints.textToImage}`, body: common };
  return { endpoint: `${model.api.alias}/${model.endpoints.edit}`, body: { ...common, images: urls } };
}

function regionRequest(input: StudioRequestInput): StudioProviderRequest {
  const model = imageModel(input.model);
  if (!input.regionCrop) throw new StudioRequestError('region edit without a crop');
  const urls = [input.regionCrop.url, ...input.images.map((i) => i.url)].slice(0, model.maxReferences);
  if (model.pixels)
    return {
      endpoint: `${model.api.alias}/${model.endpoints.edit}`,
      body: { prompt: input.prompt, images: urls, ...pixelShape(model, input.params.resolution ?? '2K', input.regionCrop.aspect, input.params.quality), ...reasoning(model, 'region_edit', input.prompt, urls.length), output_format: 'png' },
    };
  return {
    endpoint: `${model.api.alias}/${model.endpoints.edit}`,
    body: {
      prompt: input.prompt,
      images: urls,
      aspect_ratio: pick(input.regionCrop.aspect, model.aspects, model.aspects[0]!),
      // The crop is worked at 1,536-2,048 px on its long side (docs/BRAND-STUDIO-V2.md §8.3).
      resolution: pick('2K', model.resolutions, model.defaultResolution),
      output_format: 'png',
      ...safety(model),
    },
  };
}

/**
 * GPT Image 2.6 edit with a markup overlay (provider/markup.ts): the API lane's `image-editing` with `markup`, the
 * overlay's URL (a transparent PNG the size of the first image; mutually exclusive with `mask`, which is never
 * sent). NOT CALLED by any studio flow yet (2026-11-19, see provider/markup.ts for what it would take); kept
 * typed and tested so the day a GPT Image run carries a drawn box it is one call.
 */
export function gptMarkupEditRequest(input: {
  model: string;
  prompt: string;
  images: ReadonlyArray<{ url: string }>;
  markupUrl: string;
  params: Pick<StudioJobParams, 'resolution' | 'aspect' | 'quality'>;
}): StudioProviderRequest {
  const model = imageModel(input.model);
  if (!model.supportsMarkup || !model.pixels) throw new StudioRequestError(`no markup on ${model.id}`);
  const urls = input.images.map((i) => i.url);
  if (urls.length === 0) throw new StudioRequestError('markup needs the picture it marks');
  if (urls.length > model.maxReferences) throw new StudioRequestError('too many reference images');
  if (!/^https:\/\/\S+$/i.test(input.markupUrl)) throw new StudioRequestError('markup must be an https URL');
  return {
    endpoint: `${model.api.alias}/${model.endpoints.edit}`,
    body: {
      prompt: input.prompt,
      images: urls,
      markup: input.markupUrl,
      ...pixelShape(model, input.params.resolution, pick(input.params.aspect, model.aspects, model.aspects[0]!), input.params.quality),
      ...reasoning(model, 'region_edit', input.prompt, urls.length),
      output_format: 'png',
    },
  };
}

/** `draft` means the 480p first pass a final is made from. */
function videoQuality(model: StudioVideoModel, resolution: string | null): { resolution: string; draft: boolean } {
  if (resolution === 'draft') {
    if (!model.supportsDraft) throw new StudioRequestError('model has no draft mode');
    return { resolution: '480p', draft: true };
  }
  return { resolution: pick(resolution, model.resolutions, model.defaultResolution), draft: false };
}

function seconds(model: StudioVideoModel, value: number | null | undefined): number {
  const n = typeof value === 'number' && Number.isInteger(value) ? value : model.defaultSeconds;
  return Math.min(model.maxSeconds, Math.max(model.minSeconds, n));
}

function videoRequest(input: StudioRequestInput): StudioProviderRequest {
  const model = videoModel(input.model);
  const p = input.params;
  const quality = videoQuality(model, p.resolution);
  const sound = { generate_audio: p.audio !== 'silent' };
  const audios = (input.audios ?? []).map((a) => a.url);
  if (input.videos.length > 0) throw new StudioRequestError('a reference video belongs to video_remix');
  if (input.images.length > model.maxReferenceImages) throw new StudioRequestError('too many reference images');
  const start = input.images.filter((i) => i.frame === 'start');
  const end = input.images.filter((i) => i.frame === 'end');
  const plainImages = input.images.filter((i) => i.frame === undefined);
  const base = { prompt: input.prompt, resolution: quality.resolution, duration: seconds(model, p.seconds), draft: quality.draft, output_format: 'mp4', ...sound };
  // Opening (and optionally closing) still only: image-to-video, which follows the still's shape.
  if (start.length === 1 && end.length <= 1 && plainImages.length === 0 && audios.length === 0) {
    return {
      endpoint: `${model.api.alias}/${model.endpoints.image}`,
      body: { ...base, start_image: start[0]!.url, ...(end[0] ? { end_image: end[0].url } : {}) },
    };
  }
  const ratio = pick(p.aspect, model.aspects, model.aspects[0]!);
  if (input.images.length === 0 && audios.length === 0) {
    return { endpoint: `${model.api.alias}/${model.endpoints.text}`, body: { ...base, ratio } };
  }
  // Anything else is a reference generation; the prompt names them @Image1, @Audio1 in tray order.
  return {
    endpoint: `${model.api.alias}/${model.endpoints.reference}`,
    body: {
      ...base,
      ratio,
      ...(input.images.length ? { reference_images: input.images.map((i) => i.url) } : {}),
      ...(audios.length ? { reference_audios: audios } : {}),
    },
  };
}

function remixRequest(input: StudioRequestInput): StudioProviderRequest {
  const model = videoModel(input.model);
  const p = input.params;
  if (input.videos.length !== 1) throw new StudioRequestError('a remix needs exactly one reference video');
  if (input.images.length > model.maxReferenceImages) throw new StudioRequestError('too many reference images');
  const quality = videoQuality(model, p.resolution);
  const audios = (input.audios ?? []).map((a) => a.url);
  const edit = p.method === 'edit';
  const duration = edit ? -1 : typeof p.seconds === 'number' ? seconds(model, p.seconds) : -1;
  return {
    endpoint: `${model.api.alias}/${model.endpoints.reference}`,
    body: {
      prompt: input.prompt,
      reference_videos: [input.videos[0]!.url],
      ...(input.images.length ? { reference_images: input.images.map((i) => i.url) } : {}),
      ...(audios.length ? { reference_audios: audios } : {}),
      resolution: quality.resolution,
      // An explicit edit follows the source: its length and its shape.
      ratio: edit ? 'adaptive' : pick(p.aspect, model.aspects, model.aspects[0]!),
      duration,
      omni_reference_task_type: edit ? 'edit' : 'reference',
      // A run that follows its source's length is never a draft, on either lane (../reference-video.ts `isDraftRun`).
      draft: quality.draft && duration !== -1,
      output_format: 'mp4',
      generate_audio: p.audio !== 'silent',
    },
  };
}

function finalRequest(input: StudioRequestInput): StudioProviderRequest {
  const model = videoModel(input.model);
  if (!model.supportsDraft) throw new StudioRequestError('model has no draft mode');
  const draft = input.draftTaskId?.trim();
  if (!draft) throw new StudioRequestError('final without a draft id');
  return { endpoint: `${model.api.alias}/${model.endpoints.finalize}`, body: { draft_task_id: draft, output_format: 'mp4' } };
}

export function buildStudioRequest(input: StudioRequestInput): StudioProviderRequest {
  switch (input.kind) {
    case 'image':
      return imageRequest(input);
    case 'region_edit':
      return regionRequest(input);
    case 'video':
      return videoRequest(input);
    case 'video_remix':
      // A blueprint was only read; it goes out as the text / image / reference-image run it is, and
      // `videoRequest` refuses it outright if a video ever reached its inputs (docs/BRAND-STUDIO-V3.md §6).
      return input.params.method === 'blueprint' ? videoRequest(input) : remixRequest(input);
    case 'video_final':
      return finalRequest(input);
  }
}
