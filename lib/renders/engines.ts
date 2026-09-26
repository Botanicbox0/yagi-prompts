import { ARK_MODELS, estimateRenderUsd, type ArkModelKey, type ArkRatio, type ArkResolution } from '@/lib/ark/models';
import { ArkError, arkConfigFromEnv, createArkClient, isTerminal, type ArkClient, type ArkContentItem } from '@/lib/ark/client';
import { IMAGE_ENGINES, isOpenAiEngine, type ImageAspect, type ImageEngineId, type VideoAspect, type VideoEngineId } from '@/lib/images/engines';
import { OpenAiImageError, createOpenAiImageClient, openAiConfigFromEnv, type OpenAiImageClient, type ReferenceImage } from '@/lib/images/openai';
import { SeedreamError, createSeedreamClient, seedreamConfigFromEnv, type SeedreamClient } from '@/lib/images/seedream';
import { assetReference } from '@/lib/identity/service';

/**
 * The engine adapters the render pass drives — one call per engine family, every provider
 * quirk translated into ONE failure vocabulary the row, the page and the email can speak.
 *
 *   image   synchronous: the GPT Image family (the visitor's photo rides the edits endpoint), Seedream
 *           5.0 (photo as a base64 data URL; a real face is refused by policy — `face_policy`)
 *   film    asynchronous: ModelArk creates a task, the pass polls it, the finished `video_url`
 *           is copied into our storage at once (it lives 24h — `ARK_VIDEO_URL_TTL_HOURS`).
 *
 * Every client is injectable (tests drive the adapters with fakes and no key), and every key is
 * read from the environment here and nowhere else in the render code. `retryable` is the one
 * decision the pass makes from a failure: a network blip or a 5xx goes back to the queue; a
 * policy refusal, a bad key or a malformed answer does not.
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
  | 'asset_failed';

export class RenderFailure extends Error {
  constructor(
    readonly code: RenderFailureCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'RenderFailure';
  }
}

export interface RenderPhoto {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface RenderEngineDeps {
  openai?: OpenAiImageClient | null;
  seedream?: SeedreamClient | null;
  ark?: ArkClient | null;
  /** Downloads the provider's result URL (ModelArk films, Seedream `url` answers). */
  fetch?: typeof fetch;
}

export interface EngineOutput {
  bytes: Uint8Array;
  mime: string;
  provider: 'openai' | 'modelark';
  /** Booked from the provider's usage counters where it reports them, else the estimate. */
  costUsd: number | null;
}

/** ModelArk default (memory 2026-09-02: "기본 2.0@720p, 2.5는 프리미엄"). */
export const VIDEO_RESOLUTION: ArkResolution = '720p';

function dataUrl(photo: RenderPhoto): string {
  return `data:${photo.mime};base64,${Buffer.from(photo.bytes).toString('base64')}`;
}

function toFailure(error: unknown): RenderFailure {
  if (error instanceof RenderFailure) return error;
  if (error instanceof OpenAiImageError) {
    if (error.moderated) return new RenderFailure('moderated', error.message, false);
    if (error.auth) return new RenderFailure('engine_access', error.message, false);
    return new RenderFailure('engine_error', error.message, error.status === 429 || error.status >= 500);
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
  /** ModelArk: the person's photo as a verified-library asset; when set, the bytes are never sent. */
  assetId?: string | null;
}

export async function runImageRender(input: ImageRenderInput, deps: RenderEngineDeps = {}): Promise<EngineOutput> {
  try {
    if (isOpenAiEngine(input.engine)) {
      const client = deps.openai === undefined ? openAiClientFromEnv() : deps.openai;
      if (client === null) throw new RenderFailure('no_engine_key', 'OPENAI_API_KEY is not set', false);
      const references: ReferenceImage[] = input.photo ? [{ bytes: input.photo.bytes, mime: input.photo.mime, name: 'photo' }] : [];
      // The engine table decides the quality tier; this call never names one.
      const result =
        references.length > 0
          ? await client.edit({ engine: input.engine, prompt: input.prompt, aspect: input.aspect, references, outputFormat: 'jpeg' })
          : await client.generate({ engine: input.engine, prompt: input.prompt, aspect: input.aspect, outputFormat: 'jpeg' });
      const bytes = new Uint8Array(Buffer.from(result.b64, 'base64'));
      if (bytes.byteLength === 0) throw new RenderFailure('bad_output', 'the image came back empty', true);
      return { bytes, mime: 'image/jpeg', provider: 'openai', costUsd: result.usd };
    }

    const client = deps.seedream === undefined ? seedreamClientFromEnv() : deps.seedream;
    if (client === null) throw new RenderFailure('no_engine_key', 'ARK_API_KEY is not set', false);
    const engine = input.engine;
    const result = await client.generate({
      engine,
      prompt: input.prompt,
      aspect: input.aspect,
      references: input.assetId ? [assetReference(input.assetId)] : input.photo ? [dataUrl(input.photo)] : [],
      outputFormat: 'jpeg',
      responseFormat: 'b64_json',
    });
    const image = result.images[0];
    if (!image) throw new RenderFailure('bad_output', 'Seedream answered with no image', true);
    const spec = IMAGE_ENGINES[engine];
    const estimate = spec.usdPerRender + (input.photo ? spec.usdPerReference : 0);
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
}

/** A 30-second template on Seedance 2.0 (15s per task) is rendered on 2.5 in one task instead. */
export function videoModelFor(engine: VideoEngineId, seconds: number): { model: ArkModelKey; seconds: number } {
  const wanted: ArkModelKey = engine === 'seedance-2.5' ? 'seedance-2.5' : 'seedance-2.0';
  const model: ArkModelKey = seconds > ARK_MODELS[wanted].maxDurationSeconds ? 'seedance-2.5' : wanted;
  const spec = ARK_MODELS[model];
  return { model, seconds: Math.min(spec.maxDurationSeconds, Math.max(spec.minDurationSeconds, Math.round(seconds))) };
}

export async function startVideoRender(input: VideoRenderInput, deps: RenderEngineDeps = {}): Promise<{ taskId: string; model: ArkModelKey; seconds: number }> {
  const client = deps.ark === undefined ? arkClientFromEnv() : deps.ark;
  if (client === null) throw new RenderFailure('no_engine_key', 'ARK_API_KEY is not set', false);
  const { model, seconds } = videoModelFor(input.engine, input.seconds);
  const content: ArkContentItem[] = [{ type: 'text', text: input.prompt }];
  if (input.assetId) content.push({ type: 'image_url', image_url: { url: assetReference(input.assetId) }, role: 'reference_image' });
  else if (input.photo) content.push({ type: 'image_url', image_url: { url: dataUrl(input.photo) }, role: 'reference_image' });
  for (const url of input.fixedReferenceUrls ?? []) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  }
  try {
    const { id } = await client.createVideoTask({
      model,
      content,
      resolution: VIDEO_RESOLUTION,
      ratio: input.aspect as ArkRatio,
      duration: seconds,
      generateAudio: true,
      watermark: false,
      ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
    });
    return { taskId: id, model, seconds };
  } catch (error) {
    throw toFailure(error);
  }
}

export type VideoPoll =
  | { status: 'pending' }
  | { status: 'succeeded'; output: EngineOutput }
  | { status: 'failed'; failure: RenderFailure };

export async function pollVideoRender(args: { taskId: string; model: ArkModelKey; seconds: number }, deps: RenderEngineDeps = {}): Promise<VideoPoll> {
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
  try {
    const downloaded = await download(task.videoUrl, deps.fetch ?? globalThis.fetch, 'video/mp4');
    const estimate = estimateRenderUsd({ model: args.model, resolution: VIDEO_RESOLUTION, seconds: args.seconds });
    return { status: 'succeeded', output: { ...downloaded, provider: 'modelark', costUsd: estimate.ok ? estimate.usd : null } };
  } catch (error) {
    const failure = toFailure(error);
    return failure.retryable ? { status: 'pending' } : { status: 'failed', failure };
  }
}

function arkClientFromEnv(): ArkClient | null {
  const config = arkConfigFromEnv();
  return config === null ? null : createArkClient(config);
}
