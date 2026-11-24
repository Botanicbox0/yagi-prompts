import type { ArkRatio, ArkResolution } from '@/lib/ark/models';
import { ArkError, arkConfigFromEnv, createArkClient, isTerminal, type ArkClient, type ArkContentItem } from '@/lib/ark/client';
import { IMAGE_ENGINES, estimateImageUsd, isGoogleEngine, isKlingEngine, isOpenAiEngine, type ImageAspect, type ImageEngineId, type VideoAspect, type VideoEngineId } from '@/lib/images/engines';
import { OpenAiImageError, createOpenAiImageClient, openAiConfigFromEnv, type OpenAiImageClient, type ReferenceImage } from '@/lib/images/openai';
import { SeedreamError, createSeedreamClient, seedreamConfigFromEnv, type SeedreamClient } from '@/lib/images/seedream';
import { GeminiImageError, createGeminiImageClient, geminiConfigFromEnv, type GeminiImageClient } from '@/lib/images/gemini';
import { KlingError, createKlingClient, isKlingTerminal, klingConfigFromEnv, type KlingClient } from '@/lib/kling/client';
import type { KlingAspect, KlingResolution } from '@/lib/kling/models';
import { assetReference } from '@/lib/identity/service';
import { quoteArkVideo } from '@/lib/ark/pricing';
import { DEFAULT_CREATOR_RESOLUTION, type CreatorResolution } from '@/lib/twings/resolution';
import { isKlingModel, quoteVideo, videoModelForEngine, type VideoModelKey } from '@/lib/video/models';
import type { SunraClient } from '@/lib/sunra/client';
import type { RenderProvider } from './repo';
import { isSunraLaneTaskId, pollSunraRender, startSunraRender } from './engines-sunra';

/**
 * The engine adapters the render pass drives — one call per engine family, every provider
 * quirk translated into ONE failure vocabulary the row, the page and the email can speak.
 *
 *   image   synchronous: the GPT Image family (the visitor's photo rides the edits endpoint), Seedream
 *           5.0 (photo as a base64 data URL — never `asset://`, which its API refuses; a face its
 *           moderation refuses is `face_policy`),
 *           Gemini Nano Banana (photo as an inline image block, lib/images/gemini.ts)
 *   film    asynchronous: ModelArk or Kling creates a task, the pass polls it, the finished URL
 *           is copied into our storage at once (ModelArk's lives 24h — `ARK_VIDEO_URL_TTL_HOURS`;
 *           Kling's 30 days, treated the same).
 *
 * Every client is injectable (tests drive the adapters with fakes and no key), and every key is
 * read from the environment here and nowhere else in the render code. `retryable` is the one
 * decision the pass makes from a failure: a network blip or a 5xx goes back to the queue; a
 * policy refusal, a bad key or a malformed answer does not. The same codes, the same retry rule,
 * for every provider — a new adapter adds a branch to `toFailure`, never a new vocabulary.
 */

export type RenderFailureCode =
  /** No key for this engine in the environment — the deployment is not wired. */
  | 'no_engine_key'
  /** The provider refused the photo: a real person's face on ModelArk (docs/TEMPLATES-IA.md §7). */
  | 'face_policy'
  /** A content-policy refusal of the prompt or the photo. */
  | 'moderated'
  /** The key does not carry this model, or the model is not activated (console work, not code). */
  | 'engine_access'
  /** Anything else the provider said no to. */
  | 'engine_error'
  | 'network'
  /** The provider answered without a usable object. */
  | 'bad_output'
  /** ModelArk needs the person's verified face (docs §8.2) and they have not verified. */
  | 'identity_required'
  /** The identity service is not configured (AK/SK) or cannot hand the bank a photo URL. */
  | 'identity_unavailable'
  /** The bank compared the photo with the verified face and refused it, or never finished. */
  | 'asset_failed'
  | 'edit_refused'
  | 'edit_invalid'
  | 'edit_unavailable'
  | 'edit_request_limit'
  | 'edit_in_progress';

export class RenderFailure extends Error {
  constructor(
    readonly code: RenderFailureCode,
    message: string,
    readonly retryable: boolean,
    /** A recipe step that failed (lib/recipes/execute.ts); recorded as `code:step` on the row. */
    readonly step?: string,
  ) {
    super(message);
    this.name = 'RenderFailure';
  }
}

/** `face_policy:shot1` → `face_policy`: the reader-facing vocabulary never includes a step id. */
export function baseFailureCode(code: string | null): string | null {
  return code === null ? null : code.split(':')[0]!;
}

export interface RenderPhoto {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface RenderEngineDeps {
  openai?: OpenAiImageClient | null;
  seedream?: SeedreamClient | null;
  gemini?: GeminiImageClient | null;
  ark?: ArkClient | null;
  kling?: KlingClient | null;
  /** Downloads the provider's result URL (ModelArk and Kling films, Seedream `url` answers). */
  fetch?: typeof fetch;
  /**
   * The personal Sunra lane (./engines-sunra.ts, docs/PERSONAL-STUDIO.md §5.1). Read only for a job on that
   * lane (`VideoRenderInput.lane`, a `sunra:` task id); every other job ignores these three.
   */
  sunra?: SunraClient | null;
  /** A charge a FAILED Sunra job may have cost (USD with the top-up fee). Idempotent per task id: set, not add. */
  onProviderCharge?: (taskId: string | null, usd: number, source: 'provider_usage' | 'estimate') => Promise<void>;
  /** A Sunra circuit to open (lib/renders/sunra-lane.ts `recordSunraCircuit`). */
  onSunraCircuit?: (state: 'open_price_drift' | 'open_insufficient_hold' | 'open_provider_outage', reason: string) => Promise<void>;
}

export interface EngineOutput {
  bytes: Uint8Array;
  mime: string;
  provider: RenderProvider;
  /** Booked from the provider's usage counters where it reports them, else the estimate. */
  costUsd: number | null;
  costSource?: 'provider_usage' | 'estimate';
  completionTokens?: number | null;
}

/**
 * ModelArk default (memory 2026-09-02: "기본 2.0@720p, 2.5는 프리미엄"; docs/TEMPLATES-IA.md §12,
 * 2026-09-17: "영상 기본 720p, 1080p는 선택"). A job asks for 1080p only when it was bought.
 */
export const VIDEO_RESOLUTION: ArkResolution = DEFAULT_CREATOR_RESOLUTION;

function dataUrl(photo: RenderPhoto): string {
  return `data:${photo.mime};base64,${Buffer.from(photo.bytes).toString('base64')}`;
}

/**
 * Kling and Gemini publish no separate real-person code; when their refusal names a person's
 * likeness it is reported as `face_policy` (the same word ModelArk's PrivacyInformation gets), so
 * the page can say "본인 확인" rather than "내용을 바꿔 보세요".
 */
export function looksLikeFaceRefusal(message: string): boolean {
  return /real person|real people|real human|portrait|likeness|face|facial|privacy|celebrit|public figure/i.test(message);
}

function toFailure(error: unknown): RenderFailure {
  if (error instanceof RenderFailure) return error;
  if (error instanceof OpenAiImageError) {
    if (error.moderated) return new RenderFailure('moderated', error.message, false);
    if (error.auth) return new RenderFailure('engine_access', error.message, false);
    return new RenderFailure('engine_error', error.message, error.status === 429 || error.status >= 500);
  }
  if (error instanceof GeminiImageError) {
    if (error.auth) return new RenderFailure('engine_access', error.message, false);
    if (error.moderated) return new RenderFailure(looksLikeFaceRefusal(error.message) ? 'face_policy' : 'moderated', error.message, false);
    if (error.interactionStatus !== null) return new RenderFailure('bad_output', error.message, false);
    return new RenderFailure('engine_error', error.message, error.retryable);
  }
  if (error instanceof KlingError) {
    if (error.moderated) return new RenderFailure(looksLikeFaceRefusal(error.message) ? 'face_policy' : 'moderated', error.message, false);
    if (error.accessProblem) return new RenderFailure('engine_access', error.message, false);
    if (error.code === 'kling_network') return new RenderFailure('network', error.message, true);
    if (error.code === 'kling_malformed_task') return new RenderFailure('bad_output', error.message, false);
    return new RenderFailure('engine_error', error.message, error.retryable);
  }
  if (error instanceof SeedreamError) {
    if (error.inputRejected) return new RenderFailure('face_policy', error.message, false);
    if (error.accessProblem) return new RenderFailure('engine_access', error.message, false);
    if (error.code?.startsWith('OutputImageSensitiveContentDetected') || error.code?.startsWith('InputTextSensitiveContentDetected')) {
      return new RenderFailure('moderated', error.message, false);
    }
    return new RenderFailure('engine_error', error.message, error.status === 429 || error.status >= 500);
  }
  if (error instanceof ArkError) {
    if (error.code.startsWith('InputImageSensitiveContentDetected')) return new RenderFailure('face_policy', error.message, false);
    if (error.inputRejected) return new RenderFailure('moderated', error.message, false);
    if (error.status === 401 || error.status === 403 || error.code === 'ModelNotOpen' || error.code === 'AccessDenied') {
      return new RenderFailure('engine_access', error.message, false);
    }
    if (error.code === 'ark_network') return new RenderFailure('network', error.message, true);
    return new RenderFailure('engine_error', error.message, error.retryable);
  }
  if (error instanceof TypeError) return new RenderFailure('network', error.message, true);
  return new RenderFailure('engine_error', error instanceof Error ? error.message : String(error), false);
}

async function download(url: string, doFetch: typeof fetch, fallbackMime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  let response: Response;
  try {
    response = await doFetch(url);
  } catch (error) {
    throw new RenderFailure('network', `download failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
  if (!response.ok) throw new RenderFailure('bad_output', `download answered ${response.status}`, response.status >= 500);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new RenderFailure('bad_output', 'download was empty', true);
  const header = response.headers.get('content-type')?.split(';')[0]?.trim();
  return { bytes, mime: header && header !== 'application/octet-stream' ? header : fallbackMime };
}

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

export interface ImageRenderInput {
  engine: ImageEngineId;
  prompt: string;
  aspect: ImageAspect;
  photo: RenderPhoto | null;
  /** Kept for the input's shape only: no image engine reads a ModelArk asset (Seedream refuses `asset://`). */
  assetId?: string | null;
  /**
   * A recipe step's references, in prompt order ("Image 1", "Image 2", …), replacing photo/assetId.
   * OpenAI and Gemini take bytes only; Seedream takes bytes (sent as a data URL) or an https URL.
   */
  references?: readonly StepReference[];
}

export type StepReference = { kind: 'bytes'; bytes: Uint8Array; mime: RenderPhoto['mime'] } | { kind: 'url'; url: string };

/** The bytes-only providers' reference list: the step's references, else the visitor's photo. */
function byteReferences(input: ImageRenderInput, provider: string): ReferenceImage[] {
  if (input.references) {
    return input.references.map((reference, index) => {
      if (reference.kind !== 'bytes') throw new RenderFailure('engine_error', `${provider} takes reference bytes only`, false);
      return { bytes: reference.bytes, mime: reference.mime, name: `image${index + 1}` };
    });
  }
  return input.photo ? [{ bytes: input.photo.bytes, mime: input.photo.mime, name: 'photo' }] : [];
}

export async function runImageRender(input: ImageRenderInput, deps: RenderEngineDeps = {}): Promise<EngineOutput> {
  try {
    if (isOpenAiEngine(input.engine)) {
      const client = deps.openai === undefined ? openAiClientFromEnv() : deps.openai;
      if (client === null) throw new RenderFailure('no_engine_key', 'OPENAI_API_KEY is not set', false);
      const references = byteReferences(input, 'OpenAI');
      // The engine table decides the quality tier; this call never names one.
      const result =
        references.length > 0
          ? await client.edit({ engine: input.engine, prompt: input.prompt, aspect: input.aspect, references, outputFormat: 'jpeg' })
          : await client.generate({ engine: input.engine, prompt: input.prompt, aspect: input.aspect, outputFormat: 'jpeg' });
      const bytes = new Uint8Array(Buffer.from(result.b64, 'base64'));
      if (bytes.byteLength === 0) throw new RenderFailure('bad_output', 'the image came back empty', true);
      return { bytes, mime: 'image/jpeg', provider: 'openai', costUsd: result.usd };
    }

    if (isGoogleEngine(input.engine)) {
      const client = deps.gemini === undefined ? geminiClientFromEnv() : deps.gemini;
      if (client === null) throw new RenderFailure('no_engine_key', 'GEMINI_API_KEY is not set', false);
      const references = byteReferences(input, 'Gemini');
      const result = await client.generate({ engine: input.engine, prompt: input.prompt, aspect: input.aspect, references });
      const bytes = new Uint8Array(Buffer.from(result.b64, 'base64'));
      if (bytes.byteLength === 0) throw new RenderFailure('bad_output', 'the image came back empty', true);
      // The per-image rate is list price and the input tokens are the API's own count: an estimate still.
      return { bytes, mime: result.mime, provider: 'google', costUsd: result.usd, costSource: 'estimate' };
    }

    // Seedream's image API answers `asset://` with "invalid url" (2026-09-22): refused here, before a
    // paid call, so a stale path fails as a wiring error instead of as the customer's photo.
    if (input.assetId || input.references?.some((reference) => reference.kind === 'url' && reference.url.startsWith('asset://'))) {
      throw new RenderFailure('engine_error', 'Seedream takes the photo itself, not a ModelArk asset', false);
    }
    const client = deps.seedream === undefined ? seedreamClientFromEnv() : deps.seedream;
    if (client === null) throw new RenderFailure('no_engine_key', 'ARK_API_KEY is not set', false);
    const engine = input.engine;
    const result = await client.generate({
      engine,
      prompt: input.prompt,
      aspect: input.aspect,
      references: input.references
        ? input.references.map((reference) => (reference.kind === 'url' ? reference.url : dataUrl(reference)))
        : input.photo ? [dataUrl(input.photo)] : [],
      outputFormat: 'jpeg',
      responseFormat: 'b64_json',
    });
    const image = result.images[0];
    if (!image) throw new RenderFailure('bad_output', 'Seedream answered with no image', true);
    // The same rule the price floor uses, so a free first reference is free here too.
    const estimate = estimateImageUsd(engine, input.references ? input.references.length : input.photo ? 1 : 0);
    if (image.b64) {
      const bytes = new Uint8Array(Buffer.from(image.b64, 'base64'));
      if (bytes.byteLength === 0) throw new RenderFailure('bad_output', 'the image came back empty', true);
      return { bytes, mime: image.outputFormat === 'png' ? 'image/png' : 'image/jpeg', provider: 'modelark', costUsd: estimate };
    }
    if (image.url) {
      const downloaded = await download(image.url, deps.fetch ?? globalThis.fetch, 'image/jpeg');
      return { ...downloaded, provider: 'modelark', costUsd: estimate };
    }
    throw new RenderFailure('bad_output', 'Seedream answered with neither bytes nor a url', true);
  } catch (error) {
    throw toFailure(error);
  }
}

function openAiClientFromEnv(): OpenAiImageClient | null {
  const config = openAiConfigFromEnv();
  return config === null ? null : createOpenAiImageClient(config);
}

function seedreamClientFromEnv(): SeedreamClient | null {
  const config = seedreamConfigFromEnv();
  return config === null ? null : createSeedreamClient(config);
}

function geminiClientFromEnv(): GeminiImageClient | null {
  const config = geminiConfigFromEnv();
  return config === null ? null : createGeminiImageClient(config);
}

// ---------------------------------------------------------------------------
// films
// ---------------------------------------------------------------------------

export interface VideoRenderInput {
  engine: VideoEngineId;
  prompt: string;
  aspect: VideoAspect;
  /** The template's runtime; clamped to what the chosen model can do in one task. */
  seconds: number;
  photo: RenderPhoto | null;
  /** The person's photo as a verified-library asset (docs §8.2); when set, the bytes are never sent. */
  assetId?: string | null;
  callbackUrl?: string;
  /** Reviewed product/set references, ordered AFTER the customer's identity. Server-owned only. */
  fixedReferenceUrls?: readonly string[];
  /** What the job was bought at (render_jobs.resolution); absent = the 720p default. */
  resolution?: CreatorResolution;
  /** A recipe step's references in prompt order, replacing photo/assetId/fixedReferenceUrls. */
  references?: ReadonlyArray<{ type: 'image' | 'video' | 'audio'; url: string }>;
  /** `'sunra'`: the personal Sunra lane (./engines-sunra.ts). Absent: the engine's own provider, as always. */
  lane?: 'sunra';
}

/**
 * A 30-second template on Seedance 2.0 (15s per task) is rendered on 2.5 in one task instead;
 * `kling-omni` renders on whichever Kling model the deployment configured (lib/video/models.ts).
 */
export function videoModelFor(engine: VideoEngineId, seconds: number): { model: VideoModelKey; seconds: number } {
  return videoModelForEngine(engine, seconds);
}

export interface StartedVideo {
  taskId: string;
  model: VideoModelKey;
  seconds: number;
  /** What the job row records next to the task id. */
  provider: RenderProvider;
}

export async function startVideoRender(input: VideoRenderInput, deps: RenderEngineDeps = {}): Promise<StartedVideo> {
  if (input.lane === 'sunra') return startSunraRender(input, deps);
  if (isKlingEngine(input.engine)) return startKlingRender(input, deps);
  const client = deps.ark === undefined ? arkClientFromEnv() : deps.ark;
  if (client === null) throw new RenderFailure('no_engine_key', 'ARK_API_KEY is not set', false);
  const { model, seconds } = videoModelFor(input.engine, input.seconds);
  if (isKlingModel(model)) throw new RenderFailure('engine_error', `${input.engine} does not render on ${model}`, false);
  const content: ArkContentItem[] = [{ type: 'text', text: input.prompt }];
  if (input.references) {
    for (const reference of input.references) {
      content.push(
        reference.type === 'video'
          ? { type: 'video_url', video_url: { url: reference.url }, role: 'reference_video' }
          : reference.type === 'audio'
            ? { type: 'audio_url', audio_url: { url: reference.url }, role: 'reference_audio' }
            : { type: 'image_url', image_url: { url: reference.url }, role: 'reference_image' },
      );
    }
  } else if (input.assetId) content.push({ type: 'image_url', image_url: { url: assetReference(input.assetId) }, role: 'reference_image' });
  else if (input.photo) content.push({ type: 'image_url', image_url: { url: dataUrl(input.photo) }, role: 'reference_image' });
  for (const url of input.references ? [] : input.fixedReferenceUrls ?? []) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  }
  try {
    const { id } = await client.createVideoTask({
      model,
      content,
      resolution: input.resolution ?? VIDEO_RESOLUTION,
      ratio: input.aspect as ArkRatio,
      duration: seconds,
      generateAudio: true,
      watermark: false,
      ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
    });
    return { taskId: id, model, seconds, provider: 'modelark' };
  } catch (error) {
    throw toFailure(error);
  }
}

/**
 * Kling: the same inputs, its own dialect (lib/kling/client.ts). The person's photo goes as bytes
 * (a `data:` URL the client turns into base64) or as the storage URL a recipe step hands over —
 * never an `asset://`, which only ModelArk understands. 4:3 / 3:4 are refused up front: the API
 * has no such frame, and silently rendering 1:1 for someone who bought 3:4 is the worse outcome.
 * No callback: Kling's callback protocol is not ModelArk's, and the pass polls regardless.
 */
async function startKlingRender(input: VideoRenderInput, deps: RenderEngineDeps): Promise<StartedVideo> {
  const client = deps.kling === undefined ? klingClientFromEnv() : deps.kling;
  if (client === null) throw new RenderFailure('no_engine_key', 'KLING_API_KEY is not set', false);
  const { model, seconds } = videoModelFor(input.engine, input.seconds);
  if (!isKlingModel(model)) throw new RenderFailure('engine_error', `${input.engine} does not render on ${model}`, false);
  if (input.aspect !== '16:9' && input.aspect !== '9:16' && input.aspect !== '1:1') throw new RenderFailure('engine_error', `Kling renders 16:9, 9:16 or 1:1, not ${input.aspect}`, false);
  const references: Array<{ type: 'image' | 'video'; url: string }> = [];
  if (input.references) {
    for (const reference of input.references) {
      if (reference.type === 'audio') throw new RenderFailure('engine_error', 'Kling takes image or video references only', false);
      references.push({ type: reference.type, url: reference.url });
    }
  } else {
    if (input.assetId) throw new RenderFailure('engine_error', 'Kling takes the photo itself, not a ModelArk asset', false);
    if (input.photo) references.push({ type: 'image', url: dataUrl(input.photo) });
    for (const url of input.fixedReferenceUrls ?? []) references.push({ type: 'image', url });
  }
  if (references.some((reference) => reference.url.startsWith('asset://'))) throw new RenderFailure('engine_error', 'Kling cannot read a ModelArk asset', false);
  const resolution: KlingResolution = (input.resolution ?? VIDEO_RESOLUTION) === '1080p' ? '1080p' : '720p';
  try {
    const { id } = await client.createVideoTask({ prompt: input.prompt, references, resolution, aspect: input.aspect as KlingAspect, duration: seconds, audio: 'native' });
    return { taskId: id, model, seconds, provider: 'kling' };
  } catch (error) {
    throw toFailure(error);
  }
}

export type VideoPoll =
  | { status: 'pending' }
  | { status: 'succeeded'; output: EngineOutput }
  | { status: 'failed'; failure: RenderFailure };

export async function pollVideoRender(args: {
  taskId: string; model: VideoModelKey; seconds: number; resolution?: CreatorResolution | '480p'; aspect?: string;
  /** Called once the provider reports success, before the film is downloaded (the wait's "마무리"). Must not throw. */
  onProviderDone?: () => Promise<void>;
}, deps: RenderEngineDeps = {}): Promise<VideoPoll> {
  // The task id names the lane, so the pass's poll needs no change for it.
  if (isSunraLaneTaskId(args.taskId)) return pollSunraRender(args.taskId, args, deps);
  if (isKlingModel(args.model)) return pollKlingRender({ ...args, model: args.model }, deps);
  const client = deps.ark === undefined ? arkClientFromEnv() : deps.ark;
  if (client === null) return { status: 'failed', failure: new RenderFailure('no_engine_key', 'ARK_API_KEY is not set', false) };
  let task;
  try {
    task = await client.getVideoTask(args.taskId);
  } catch (error) {
    const failure = toFailure(error);
    // A poll that cannot reach the provider is not a failed render — ask again next pass.
    return failure.retryable ? { status: 'pending' } : { status: 'failed', failure };
  }
  if (!isTerminal(task.status)) return { status: 'pending' };
  if (task.status !== 'succeeded' || !task.videoUrl) {
    const code = task.error?.code ?? task.status;
    const message = task.error?.message ?? `the task ended ${task.status}`;
    const failure = code.startsWith('InputImageSensitiveContentDetected')
      ? new RenderFailure('face_policy', message, false)
      : code.includes('SensitiveContent')
        ? new RenderFailure('moderated', message, false)
        : new RenderFailure('engine_error', message, task.status === 'expired');
    return { status: 'failed', failure };
  }
  await args.onProviderDone?.();
  try {
    const downloaded = await download(task.videoUrl, deps.fetch ?? globalThis.fetch, 'video/mp4');
    const resolution = args.resolution ?? VIDEO_RESOLUTION;
    // Public subscription quotes cover 720p/1080p. Preserve legacy 480p polling without
    // claiming a tariff or dimensions that have not been verified for that resolution.
    const quote = resolution === '720p' || resolution === '1080p' ? quoteArkVideo({ model: args.model, resolution, seconds: args.seconds, aspect: args.aspect ?? '9:16' }) : null;
    const completionTokens = Number.isSafeInteger(task.completionTokens) && (task.completionTokens ?? 0) > 0 ? task.completionTokens : null;
    const costUsd = quote ? completionTokens === null ? quote.providerUsd : completionTokens * quote.providerUsd / quote.providerTokens : null;
    return { status: 'succeeded', output: { ...downloaded, provider: 'modelark', costUsd, costSource: costUsd === null ? undefined : completionTokens === null ? 'estimate' : 'provider_usage', completionTokens } };
  } catch (error) {
    const failure = toFailure(error);
    return failure.retryable ? { status: 'pending' } : { status: 'failed', failure };
  }
}

/** The Kling poll: same outcomes, its task shape; a failed task's message decides policy vs. error. */
async function pollKlingRender(args: {
  taskId: string; model: VideoModelKey; seconds: number; resolution?: CreatorResolution | '480p'; aspect?: string; onProviderDone?: () => Promise<void>;
}, deps: RenderEngineDeps): Promise<VideoPoll> {
  const client = deps.kling === undefined ? klingClientFromEnv() : deps.kling;
  if (client === null) return { status: 'failed', failure: new RenderFailure('no_engine_key', 'KLING_API_KEY is not set', false) };
  let task;
  try {
    task = await client.getVideoTask(args.taskId);
  } catch (error) {
    const failure = toFailure(error);
    return failure.retryable ? { status: 'pending' } : { status: 'failed', failure };
  }
  if (!isKlingTerminal(task.status)) return { status: 'pending' };
  if (task.status !== 'succeeded' || !task.videoUrl) {
    const message = task.message ?? `the task ended ${task.status}`;
    const policy = /risk control|content security|policy|sensitive|violat|prohibit/i.test(message);
    const failure = policy
      ? new RenderFailure(looksLikeFaceRefusal(message) ? 'face_policy' : 'moderated', message, false)
      : new RenderFailure('engine_error', message, false);
    return { status: 'failed', failure };
  }
  await args.onProviderDone?.();
  try {
    const downloaded = await download(task.videoUrl, deps.fetch ?? globalThis.fetch, 'video/mp4');
    const resolution = args.resolution ?? VIDEO_RESOLUTION;
    const quote = resolution === '720p' || resolution === '1080p' ? quoteVideo({ model: args.model, resolution, seconds: args.seconds, aspect: args.aspect ?? '9:16' }) : null;
    // `billing[]` on the finished task is what the account was charged; the per-second list price otherwise.
    const billed = task.billedUsd !== null && task.billedUsd > 0 ? task.billedUsd : null;
    const costUsd = billed ?? quote?.providerUsd ?? null;
    return { status: 'succeeded', output: { ...downloaded, provider: 'kling', costUsd, costSource: costUsd === null ? undefined : billed === null ? 'estimate' : 'provider_usage', completionTokens: null } };
  } catch (error) {
    const failure = toFailure(error);
    return failure.retryable ? { status: 'pending' } : { status: 'failed', failure };
  }
}

function arkClientFromEnv(): ArkClient | null {
  const config = arkConfigFromEnv();
  return config === null ? null : createArkClient(config);
}

function klingClientFromEnv(): KlingClient | null {
  const config = klingConfigFromEnv();
  return config === null ? null : createKlingClient(config);
}
