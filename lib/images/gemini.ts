import { IMAGE_ENGINES, imageSizeFor, sizeString, type GoogleEngineId, type ImageAspect } from './engines';
import type { ReferenceImage } from './openai';

/**
 * Google Gemini — the image models ("Nano Banana") through the Interactions API, as ONE boundary
 * (ai.google.dev/gemini-api/docs/image-generation + the Interactions OpenAPI spec, read 2026-10-24;
 * `generateContent` is the legacy surface and new image features land here only).
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions   x-goog-api-key: {GEMINI_API_KEY}
 *     { model, input: [ {type:'text', text}, {type:'image', mime_type, data: <base64>}, … ],
 *       response_format: { type:'image', mime_type:'image/jpeg', aspect_ratio, image_size:'1K'|'2K'|'4K' } }
 *     → { id, status: completed|failed|incomplete|…, steps: [ { type:'model_output',
 *          content: [ { type:'image', data, mime_type } ] } ], usage: { total_input_tokens,
 *          total_output_tokens, output_tokens_by_modality: [ { modality, tokens } ] },
 *          errors: [ { code, message } ] }
 *     HTTP 4xx/5xx → { error: { code, message } }
 *
 * The visitor's photo rides as an `image` input block (bytes, like OpenAI — Gemini takes no asset
 * library), up to the model's reference limit (lib/images/engines.ts). Aspect and size go in
 * `response_format`; the table's size for an aspect is the official 2K pixel size for it. Every
 * output carries Google's SynthID watermark (invisible) — the product's "AI 생성 표시 없음" rule is
 * about visible badges and is unaffected.
 *
 * A refusal is not a transient failure: a `failed`/`incomplete` interaction with no image, or a
 * 400 whose message names safety / prohibited content, is `GeminiImageError.moderated` so the UI
 * says so rather than retrying. Whether a real face is refused is what `npm run gemini:smoke`
 * records; nothing here assumes it, and nothing here bypasses our own consent checks.
 *
 * Same seam as the other clients: `fetch` injected, the key read from the environment by the caller
 * (`GEMINI_API_KEY`, no `NEXT_PUBLIC_` prefix). `GEMINI_IMAGE_MODEL` overrides the wire model id
 * for the day a newer Nano Banana ships, the way `KLING_VIDEO_MODEL` does for Kling.
 */

export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
/** 2K: the same "sell the higher tier" call Seedream Pro got (founder, 2026-09-06). */
export const GEMINI_IMAGE_SIZE = '2K' as const;
export const DEFAULT_GOOGLE_ENGINE: GoogleEngineId = 'nano-banana-2.1';

export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  /** The wire model id; the engine table's unless `GEMINI_IMAGE_MODEL` overrides it. */
  model: string;
}

export function geminiConfigFromEnv(env: Record<string, string | undefined> = process.env): GeminiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.GEMINI_BASE_URL?.trim().replace(/\/+$/, '') || GEMINI_DEFAULT_BASE_URL;
  const override = env.GEMINI_IMAGE_MODEL?.trim();
  const model = override && /^[a-z0-9.-]{1,60}$/i.test(override) ? override : IMAGE_ENGINES[DEFAULT_GOOGLE_ENGINE].model;
  return { apiKey, baseUrl, model };
}

export interface GeminiImageInput {
  engine?: GoogleEngineId;
  prompt: string;
  aspect: ImageAspect;
  /** The visitor's photo and any maker plates, in prompt order. Empty → plain generation. */
  references?: ReferenceImage[];
}

export interface GeminiImageResult {
  b64: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  /** The size the table asked for (the API reports none). */
  size: string;
  usage: { inputTokens: number; outputTokens: number; outputImageTokens: number } | null;
  /** List price: the per-image rate for the size plus image input tokens — the number to book. */
  usd: number | null;
  interactionId: string | null;
}

export class GeminiImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** The interaction's own status when the HTTP call succeeded but no image came back. */
    readonly interactionStatus: string | null = null,
  ) {
    super(message);
    this.name = 'GeminiImageError';
  }
  /** A safety refusal of the prompt or an image — not transient, not a bug in the prompt. */
  get moderated(): boolean {
    if (/safety|prohibit|blocked|policy|harm|violat/i.test(`${this.code ?? ''} ${this.message}`)) return true;
    return this.interactionStatus === 'failed' || this.interactionStatus === 'incomplete';
  }
  get auth(): boolean {
    return this.status === 401 || this.status === 403;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Published image-input rate (USD per million tokens, Nano Banana 2.1, pricing page 2026-10-24). */
export const GEMINI_IMAGE_INPUT_USD_PER_M = 1.5;
/** Nano Banana Pro's input rate is its own. */
export const GEMINI_PRO_INPUT_USD_PER_M = 2;

export function geminiImageUsd(engine: GoogleEngineId, usage: { inputTokens: number } | null): number {
  const spec = IMAGE_ENGINES[engine];
  const rate = engine === 'nano-banana-pro' ? GEMINI_PRO_INPUT_USD_PER_M : GEMINI_IMAGE_INPUT_USD_PER_M;
  const inputs = usage ? (usage.inputTokens * rate) / 1_000_000 : 0;
  return Math.round((spec.usdPerRender + inputs) * 10_000) / 10_000;
}

/** The wire body — exported so a test can pin the mapping. */
export function toGeminiBody(input: GeminiImageInput, model: string): Record<string, unknown> {
  const engine = input.engine ?? DEFAULT_GOOGLE_ENGINE;
  const references = input.references ?? [];
  const max = IMAGE_ENGINES[engine].maxReferenceImages;
  if (references.length > max) throw new RangeError(`${engine} takes at most ${max} reference images`);
  return {
    model,
    input: [
      { type: 'text', text: input.prompt },
      ...references.map((reference) => ({ type: 'image', mime_type: reference.mime, data: Buffer.from(reference.bytes).toString('base64') })),
    ],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: input.aspect, image_size: GEMINI_IMAGE_SIZE },
  };
}

interface RawInteraction {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; data?: string; mime_type?: string }> }>;
  output_image?: { data?: string; mime_type?: string };
  usage?: { total_input_tokens?: number; total_output_tokens?: number; output_tokens_by_modality?: Array<{ modality?: string; tokens?: number }> };
  errors?: Array<{ code?: string; message?: string }>;
  error?: { code?: string | number; message?: string; status?: string };
}

/** The last image the model produced — the SDKs' `output_image` convenience, done by hand. */
export function geminiOutputImage(parsed: RawInteraction): { data: string; mime: string } | null {
  for (const step of [...(parsed.steps ?? [])].reverse()) {
    if (step.type !== 'model_output') continue;
    for (const part of [...(step.content ?? [])].reverse()) {
      if (part.type === 'image' && typeof part.data === 'string' && part.data) return { data: part.data, mime: part.mime_type ?? 'image/jpeg' };
    }
  }
  if (parsed.output_image?.data) return { data: parsed.output_image.data, mime: parsed.output_image.mime_type ?? 'image/jpeg' };
  return null;
}

export function createGeminiImageClient(config: GeminiConfig, fetchImpl: typeof fetch = fetch) {
  return {
    model: config.model,
    async generate(input: GeminiImageInput): Promise<GeminiImageResult> {
      const engine = input.engine ?? DEFAULT_GOOGLE_ENGINE;
      // `GEMINI_IMAGE_MODEL` moves the default engine; a named engine like Pro keeps its own model.
      const model = engine === DEFAULT_GOOGLE_ENGINE ? config.model : IMAGE_ENGINES[engine].model;
      const response = await fetchImpl(`${config.baseUrl}/interactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify(toGeminiBody(input, model)),
      });
      const text = await response.text();
      let parsed: RawInteraction = {};
      try {
        parsed = JSON.parse(text) as RawInteraction;
      } catch {
        /* reported below */
      }
      if (!response.ok || parsed.error) {
        const code = parsed.error?.code ?? parsed.error?.status ?? null;
        throw new GeminiImageError(parsed.error?.message ?? (text.slice(0, 200) || response.statusText), response.status, code === null ? null : String(code));
      }
      const image = geminiOutputImage(parsed);
      if (!image) {
        const first = parsed.errors?.[0];
        throw new GeminiImageError(first?.message ?? `the interaction ended ${parsed.status ?? 'without an image'}`, response.status, first?.code ?? null, parsed.status ?? null);
      }
      const usage = parsed.usage
        ? {
            inputTokens: parsed.usage.total_input_tokens ?? 0,
            outputTokens: parsed.usage.total_output_tokens ?? 0,
            outputImageTokens: parsed.usage.output_tokens_by_modality?.find((row) => row.modality?.toLowerCase() === 'image')?.tokens ?? 0,
          }
        : null;
      const mime = image.mime === 'image/png' || image.mime === 'image/webp' ? image.mime : 'image/jpeg';
      return { b64: image.data, mime, size: sizeString(imageSizeFor(engine, input.aspect)), usage, usd: geminiImageUsd(engine, usage), interactionId: parsed.id ?? null };
    },
  };
}

export type GeminiImageClient = ReturnType<typeof createGeminiImageClient>;
