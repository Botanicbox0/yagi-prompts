/**
 * The one Gemini call shape the studio uses: plain fetch to `{base}/models/{model}:generateContent`,
 * the same env names and default model as lib/template-director/flash-director.ts, JSON output with
 * a response schema. Server-only. Every failure throws; callers turn that into their fallback.
 *
 * Request fields checked against the Gemini API reference on 2026-11-10:
 * https://aistudio.google.com/api-reference/generate-content (generationConfig.responseMimeType,
 * responseJsonSchema, thinkingConfig.thinkingLevel MINIMAL|LOW|MEDIUM|HIGH) and the model table at
 * https://aistudio.google.com/docs/thinking (gemini-3.8-flash: low, medium, high).
 */
import {
  GEMINI_DIRECTOR_DEFAULT_BASE_URL,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
} from '@/lib/template-director/schema';

export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type GeminiPart = Record<string, unknown>;

/** Null when no key is set. `BRAND_STUDIO_ENHANCER_MODEL` overrides the model for every studio call. */
export function studioGeminiConfig(env: Record<string, string | undefined>): GeminiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.GEMINI_BASE_URL?.trim().replace(/\/+$/, '') || GEMINI_DIRECTOR_DEFAULT_BASE_URL;
  const override = env.BRAND_STUDIO_ENHANCER_MODEL?.trim();
  const model = override && /^[a-z0-9.-]{1,60}$/i.test(override) ? override : GEMINI_DIRECTOR_DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

/** Text of a JSON answer, tolerant of a fenced block. */
export function parseJsonText(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return JSON.parse(fenced ? fenced[1]! : text);
}

export async function callGeminiJson(
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  request: {
    system: string;
    parts: GeminiPart[];
    schema: Record<string, unknown>;
    thinking: 'LOW' | 'MEDIUM' | 'HIGH';
    timeoutMs: number;
  },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl}/models/${config.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: request.parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: request.schema,
          thinkingConfig: { thinkingLevel: request.thinking },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`gemini_http_${response.status}`);
    const body = (await response.json()) as GeminiResponse;
    if (body.promptFeedback?.blockReason) throw new Error('gemini_blocked');
    const candidate = body.candidates?.[0];
    if (!candidate) throw new Error('gemini_no_candidate');
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`gemini_finish_${candidate.finishReason.toLowerCase()}`);
    }
    const text = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (!text.trim()) throw new Error('gemini_empty');
    return parseJsonText(text);
  } finally {
    clearTimeout(timer);
  }
}

export function inlinePart(bytes: Uint8Array, mimeType: string): GeminiPart {
  return { inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') } };
}
