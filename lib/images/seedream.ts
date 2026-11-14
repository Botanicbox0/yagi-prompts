import { IMAGE_ENGINES, sizeString, type ImageAspect, type SeedreamEngineId, type SeedreamResolutionTier, imageSizeFor } from './engines';

/**
 * BytePlus ModelArk — the Seedream image generation API, as ONE boundary (docs.byteplus.com,
 * "Image generation API" + "Seedream 5.0 pro tutorial", last updated 2026-08-31).
 *
 *   POST {base}/images/generations   Authorization: Bearer {ARK_API_KEY}
 *     { model, prompt, image?: string | string[], size, output_format, response_format, watermark,
 *       optimize_prompt_options?: { mode: 'standard' | 'fast' } }
 *     → { model, created, data: [{ url | b64_json, size, output_format }], usage: { input_images,
 *         generated_images, output_tokens, total_tokens }, error?: { code, message } }
 *
 * Same seam and same reasons as `lib/ark/client.ts`: `fetch` is injected, the key is read from the
 * environment by the caller. Moderation errors remain terminal; do not infer a blanket selfie
 * restriction from one rejection. Seedream accepts URLs/base64, not Seedance's asset:// scheme
 * (live Pro API verified 2026-09-22). Result URLs live 24 hours; copy them promptly.
 */

export const SEEDREAM_DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

export interface SeedreamConfig {
  apiKey: string;
  baseUrl: string;
}

export function seedreamConfigFromEnv(env: Record<string, string | undefined> = process.env): SeedreamConfig | null {
  const apiKey = env.ARK_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.ARK_BASE_URL?.trim().replace(/\/+$/, '') || SEEDREAM_DEFAULT_BASE_URL;
  return { apiKey, baseUrl };
}

export type { SeedreamEngineId };

export type SeedreamBackgroundMode = 'auto' | 'transparent' | 'opaque';

export function resolveSeedreamModelId(
  engine: SeedreamEngineId,
  env: Record<string, string | undefined> = process.env,
): string {
  if (engine === 'seedream-5.5') {
    const override = env.ARK_SEEDREAM_55_MODEL?.trim();
    if (override) return override;
  }
  return IMAGE_ENGINES[engine].model;
}

export interface SeedreamGenerateInput {
  engine: SeedreamEngineId;
  prompt: string;
  aspect: ImageAspect;
  /** Resolution tier (`1K`, `1.5K`, `2K`). Defaults to `2K`. */
  resolution?: SeedreamResolutionTier;
  /** Optional background mode (`Seedream 5.5`). `'transparent'` forces PNG output. */
  background?: SeedreamBackgroundMode;
  /** Explicit wire model id override (defaults to `resolveSeedreamModelId(engine)`). */
  modelOverride?: string;
  /** Image URLs or `data:image/...;base64,…` strings. Seedance asset:// IDs are not supported. */
  references?: string[];
  outputFormat?: 'png' | 'jpeg';
  responseFormat?: 'url' | 'b64_json';
  /** Off by default: our renders are the customer's, not a demo. */
  watermark?: boolean;
  promptMode?: 'standard' | 'fast';
}

export interface SeedreamImage {
  url: string | null;
  b64: string | null;
  size: string | null;
  outputFormat: string | null;
}

export interface SeedreamResult {
  model: string;
  images: SeedreamImage[];
  usage: { inputImages: number; generatedImages: number; outputTokens: number } | null;
}

export class SeedreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'SeedreamError';
  }
  /** The face policy, not a transient failure — the UI sends the visitor to verification, not to retry. */
  get inputRejected(): boolean {
    return this.code?.startsWith('InputImageSensitiveContentDetected') === true;
  }
  /** The key does not carry this model (console: API keys → edit permission) or it is not activated. */
  get accessProblem(): boolean {
    return this.code === 'AccessDenied' || this.code === 'ModelNotOpen' || this.code === 'InvalidEndpointOrModel.NotFound';
  }
}

/** The wire body, spelled the way the API spells it. Exported so a test can pin the mapping. */
export function toSeedreamBody(input: SeedreamGenerateInput): Record<string, unknown> {
  const spec = IMAGE_ENGINES[input.engine];
  const references = input.references ?? [];
  if (references.length > spec.maxReferenceImages) {
    throw new RangeError(`${input.engine} takes at most ${spec.maxReferenceImages} reference images`);
  }
  const background = spec.supportsTransparentBackground && input.background ? input.background : undefined;
  const outputFormat = background === 'transparent' ? 'png' : (input.outputFormat ?? 'jpeg');
  const body: Record<string, unknown> = {
    model: input.modelOverride?.trim() || spec.model,
    prompt: input.prompt,
    size: sizeString(imageSizeFor(input.engine, input.aspect, input.resolution)),
    output_format: outputFormat,
    response_format: input.responseFormat ?? 'url',
    watermark: input.watermark ?? false,
  };
  if (background) body.background = background;
  if (references.length === 1) body.image = references[0];
  else if (references.length > 1) body.image = references;
  if (input.promptMode) body.optimize_prompt_options = { mode: input.promptMode };
  return body;
}

interface RawResponse {
  model?: string;
  data?: Array<{ url?: string; b64_json?: string; size?: string; output_format?: string }>;
  usage?: { input_images?: number; generated_images?: number; output_tokens?: number };
  error?: { code?: string; message?: string };
}

export function createSeedreamClient(
  config: SeedreamConfig,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
) {
  return {
    async generate(input: SeedreamGenerateInput): Promise<SeedreamResult> {
      const modelId = input.modelOverride?.trim() || resolveSeedreamModelId(input.engine, env);
      const response = await fetchImpl(`${config.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(toSeedreamBody({ ...input, modelOverride: modelId })),
      });
      const text = await response.text();
      let parsed: RawResponse = {};
      try {
        parsed = JSON.parse(text) as RawResponse;
      } catch {
        /* a non-JSON body is reported as-is below */
      }
      if (!response.ok || parsed.error) {
        const message = parsed.error?.message ?? text.slice(0, 200);
        const requestId = /Request id: (\S+)/.exec(message)?.[1] ?? null;
        throw new SeedreamError(message, response.status, parsed.error?.code ?? null, requestId);
      }
      return {
        model: parsed.model ?? modelId,
        images: (parsed.data ?? []).map((item) => ({
          url: item.url ?? null,
          b64: item.b64_json ?? null,
          size: item.size ?? null,
          outputFormat: item.output_format ?? null,
        })),
        usage: parsed.usage
          ? {
              inputImages: parsed.usage.input_images ?? 0,
              generatedImages: parsed.usage.generated_images ?? 0,
              outputTokens: parsed.usage.output_tokens ?? 0,
            }
          : null,
      };
    },
  };
}

export type SeedreamClient = ReturnType<typeof createSeedreamClient>;
