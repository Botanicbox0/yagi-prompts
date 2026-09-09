import { IMAGE_ENGINES, imageSizeFor, sizeString, type GptImageQuality, type ImageAspect, type OpenAiEngineId } from './engines';

/**
 * OpenAI — the Images API for the GPT Image family, as ONE boundary (developers.openai.com API
 * reference, read 2026-09-06; GPT Image 2.5 model pages + guide, read 2026-09-10).
 *
 *   POST https://api.openai.com/v1/images/generations   (JSON)      text → image
 *   POST https://api.openai.com/v1/images/edits         (multipart) image[] + prompt → image
 *     model gpt-image-2.5-flare | gpt-image-2.5-sunburst | gpt-image-2 · size `WxH` (multiples of
 *     16, 1:3 … 3:1) · quality (2.5: low … max; gpt-image-2: low/medium/high) · output_format
 *     png|jpeg|webp · moderation auto|low (no input_fidelity on any of them)
 *     → { created, data: [{ b64_json }], usage: { input_tokens, output_tokens,
 *         input_tokens_details: { image_tokens, text_tokens } } }
 *
 * Founder rule (2026-09-06): quality is ALWAYS the engine's top tier — "우리는 고품질로 파는거니까".
 * The tier comes from the engine table (`IMAGE_ENGINES[engine].quality`), so no caller can quietly
 * sell a medium render; the only way to change it is to change the table. The `quality` field on
 * the input exists for the smoke script's measurements and nothing else (a test pins that the
 * render pass never sets it).
 *
 * The visitor's photo goes in as a reference on the EDITS endpoint; the GPT Image models read
 * references at high fidelity on their own (the `input_fidelity` flag was gpt-image-1's and is
 * refused here — 400 invalid_input_fidelity_model, verified 2026-09-06). OpenAI's policy allows a
 * person's own photo and forbids a likeness used without consent — consent is ours to collect, and
 * a moderation refusal is surfaced as `OpenAiImageError.moderated` so the UI can say so rather
 * than retry.
 *
 * Same seam as the other clients: `fetch` injected, the key read from the environment by the
 * caller (`OPENAI_API_KEY`, no `NEXT_PUBLIC_` prefix, never in this code base or a conversation).
 */

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** gpt-image-2's top tier, and the floor for every OpenAI engine (a table entry below it is a bug). */
export const GPT_IMAGE_QUALITY = 'high' as const;
/** What a request renders on when it names no engine: the product's image default. */
export const DEFAULT_OPENAI_ENGINE: OpenAiEngineId = 'gpt-image-2';

export interface OpenAiConfig {
  apiKey: string;
  baseUrl: string;
}

export function openAiConfigFromEnv(env: Record<string, string | undefined> = process.env): OpenAiConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') || OPENAI_DEFAULT_BASE_URL;
  return { apiKey, baseUrl };
}

export interface ReferenceImage {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  name?: string;
}

export interface GptImageInput {
  /** Which GPT Image model; the table decides its size and quality. */
  engine?: OpenAiEngineId;
  prompt: string;
  aspect: ImageAspect;
  /** The visitor's photo (and any template plates). Empty → plain generation. */
  references?: ReferenceImage[];
  outputFormat?: 'png' | 'jpeg' | 'webp';
  moderation?: 'auto' | 'low';
  /** MEASUREMENT ONLY (scripts/image-smoke.ts): override the table's tier for one call. */
  quality?: GptImageQuality;
}

export interface GptImageResult {
  /** Base64 of the finished image — the API's default for GPT models. */
  b64: string;
  outputFormat: 'png' | 'jpeg' | 'webp';
  size: string;
  quality: GptImageQuality;
  usage: { inputTokens: number; outputTokens: number; inputImageTokens: number; inputTextTokens: number } | null;
  /** USD from the usage counters at the published token prices — the number to book, not the estimate. */
  usd: number | null;
}

export class OpenAiImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly type: string | null,
  ) {
    super(message);
    this.name = 'OpenAiImageError';
  }
  /** A content-policy refusal — not transient, not a bug in the prompt. */
  get moderated(): boolean {
    return this.code === 'moderation_blocked' || this.code === 'content_policy_violation' || /safety|moderation|policy/i.test(this.message);
  }
  get auth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Published per-million token prices (same for gpt-image-2 and both 2.5 models, 2026-09-10). */
export const GPT_IMAGE_USD_PER_M = { textIn: 5, imageIn: 8, imageOut: 30 } as const;

export function gptImageUsd(usage: { inputImageTokens: number; inputTextTokens: number; outputTokens: number }): number {
  const usd =
    (usage.inputTextTokens * GPT_IMAGE_USD_PER_M.textIn +
      usage.inputImageTokens * GPT_IMAGE_USD_PER_M.imageIn +
      usage.outputTokens * GPT_IMAGE_USD_PER_M.imageOut) /
    1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

function engineOf(input: GptImageInput): OpenAiEngineId {
  return input.engine ?? DEFAULT_OPENAI_ENGINE;
}

/** The tier a call renders at: the table's, unless the smoke script is measuring another. */
export function qualityFor(engine: OpenAiEngineId, override?: GptImageQuality): GptImageQuality {
  return override ?? IMAGE_ENGINES[engine].quality ?? GPT_IMAGE_QUALITY;
}

/** The generation body (no references) — exported so a test can pin the mapping. */
export function toGenerationBody(input: GptImageInput): Record<string, unknown> {
  const engine = engineOf(input);
  return {
    model: IMAGE_ENGINES[engine].model,
    prompt: input.prompt,
    size: sizeString(imageSizeFor(engine, input.aspect)),
    quality: qualityFor(engine, input.quality),
    output_format: input.outputFormat ?? 'png',
    moderation: input.moderation ?? 'auto',
    n: 1,
  };
}

/** The edits form — the visitor's photo rides as `image[]`. */
export function toEditForm(input: GptImageInput): FormData {
  const engine = engineOf(input);
  const references = input.references ?? [];
  const max = IMAGE_ENGINES[engine].maxReferenceImages;
  if (references.length === 0 || references.length > max) {
    throw new RangeError(`${engine} edits take 1–${max} reference images`);
  }
  const form = new FormData();
  form.set('model', IMAGE_ENGINES[engine].model);
  form.set('prompt', input.prompt);
  form.set('size', sizeString(imageSizeFor(engine, input.aspect)));
  form.set('quality', qualityFor(engine, input.quality));
  // No `input_fidelity`: the GPT Image 2 family refuses the parameter (400 invalid_input_fidelity_model,
  // verified 2026-09-06) — it processes references at high fidelity by itself (gpt-image-1 needed the flag).
  form.set('output_format', input.outputFormat ?? 'png');
  form.set('moderation', input.moderation ?? 'auto');
  form.set('n', '1');
  references.forEach((reference, index) => {
    const ext = reference.mime === 'image/png' ? 'png' : reference.mime === 'image/webp' ? 'webp' : 'jpg';
    // A fresh ArrayBuffer-backed copy: a Uint8Array view over a shared buffer is not what Blob wants.
    const copy = new Uint8Array(reference.bytes);
    form.append('image[]', new Blob([copy], { type: reference.mime }), reference.name ?? `reference-${index + 1}.${ext}`);
  });
  return form;
}

interface RawResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  };
  error?: { message?: string; code?: string | null; type?: string | null };
}

export function createOpenAiImageClient(config: OpenAiConfig, fetchImpl: typeof fetch = fetch) {
  async function call(path: string, init: RequestInit, input: GptImageInput): Promise<GptImageResult> {
    const engine = engineOf(input);
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${config.apiKey}` },
    });
    const text = await response.text();
    let parsed: RawResponse = {};
    try {
      parsed = JSON.parse(text) as RawResponse;
    } catch {
      /* reported below */
    }
    if (!response.ok || parsed.error) {
      throw new OpenAiImageError(parsed.error?.message ?? text.slice(0, 200), response.status, parsed.error?.code ?? null, parsed.error?.type ?? null);
    }
    const first = parsed.data?.[0];
    if (!first?.b64_json) throw new OpenAiImageError('the response carried no image', response.status, 'empty', null);
    const usage = parsed.usage
      ? {
          inputTokens: parsed.usage.input_tokens ?? 0,
          outputTokens: parsed.usage.output_tokens ?? 0,
          inputImageTokens: parsed.usage.input_tokens_details?.image_tokens ?? 0,
          inputTextTokens: parsed.usage.input_tokens_details?.text_tokens ?? 0,
        }
      : null;
    return {
      b64: first.b64_json,
      outputFormat: input.outputFormat ?? 'png',
      size: sizeString(imageSizeFor(engine, input.aspect)),
      quality: qualityFor(engine, input.quality),
      usage,
      usd: usage ? gptImageUsd(usage) : null,
    };
  }

  return {
    /** Text → image. */
    generate(input: GptImageInput): Promise<GptImageResult> {
      return call('/images/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toGenerationBody(input)) }, input);
    },
    /** Photo(s) + prompt → image, the visitor's face kept at high fidelity. */
    edit(input: GptImageInput): Promise<GptImageResult> {
      return call('/images/edits', { method: 'POST', body: toEditForm(input) }, input);
    },
  };
}

export type OpenAiImageClient = ReturnType<typeof createOpenAiImageClient>;
