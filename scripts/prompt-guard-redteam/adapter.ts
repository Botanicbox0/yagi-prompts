import { parseJsonText } from '@/lib/brand-studio/enhancer/gemini';
import { EnhancerOutputSchema } from '@/lib/brand-studio/enhancer/schema';
import type { TokenUsage } from './types';

export const DEFAULT_LOCAL_URL = 'http://127.0.0.1:11434';
export const DEFAULT_LOCAL_MODEL = 'yagi-crm-gemma4:31b-q8_0';

export interface GeminiPartShape {
  text?: string;
  thought?: boolean;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
}

export interface GeminiRequestBody {
  systemInstruction?: {
    parts?: GeminiPartShape[];
  };
  contents?: Array<{
    role?: string;
    parts?: GeminiPartShape[];
  }>;
  generationConfig?: {
    responseMimeType?: string;
    responseJsonSchema?: Record<string, unknown>;
    thinkingConfig?: {
      thinkingLevel?: string;
    };
  };
}

export interface GeminiResponseBody {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: GeminiPartShape[];
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface OllamaChatRequest {
  model: string;
  stream: false;
  think: false;
  format?: Record<string, unknown> | 'json';
  options: {
    temperature: number;
    num_predict: number;
  };
  messages: OllamaChatMessage[];
}

export interface OllamaChatResponse {
  model?: string;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  message?: {
    role?: string;
    content?: unknown;
    thinking?: string;
  };
}

/**
 * Validates that the local server URL goes only through the gpu-arbiter on loopback (never raw Ollama port 11444).
 */
export function validateLocalOllamaUrl(raw: string | undefined): URL {
  const url = new URL(raw?.trim() || DEFAULT_LOCAL_URL);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port === '11444' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Invalid local Ollama URL "${raw ?? ''}": must be http://127.0.0.1[:port] or http://localhost[:port], never port 11444.`);
  }
  url.pathname = '/';
  return url;
}

export function validateModelName(model: string): string {
  const trimmed = model.trim();
  if (!/^[\w.:/-]{1,120}$/.test(trimmed)) {
    throw new Error(`Invalid local model name "${model}"`);
  }
  return trimmed;
}

export function extractGeminiSystemText(body: GeminiRequestBody): string {
  return (body.systemInstruction?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .filter((t) => t.length > 0)
    .join('\n');
}

export function extractGeminiUserTexts(body: GeminiRequestBody): string[] {
  const out: string[] = [];
  for (const item of body.contents ?? []) {
    for (const part of item.parts ?? []) {
      if (typeof part.text === 'string') out.push(part.text);
    }
  }
  return out;
}

export function countGeminiInlineImages(body: GeminiRequestBody): number {
  let count = 0;
  for (const item of body.contents ?? []) {
    for (const part of item.parts ?? []) {
      if (part.inlineData && typeof part.inlineData.data === 'string' && part.inlineData.data.length > 0) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Turns a Gemini `generateContent` request body into an Ollama `/api/chat` request body
 * (system + user, JSON output schema/mode, non-streaming).
 */
export function geminiToOllamaRequest(
  geminiBody: GeminiRequestBody,
  options: { model: string; numPredict?: number; temperature?: number },
): OllamaChatRequest {
  const model = validateModelName(options.model);
  const systemText = extractGeminiSystemText(geminiBody);
  const userTexts: string[] = [];
  const images: string[] = [];

  for (const content of geminiBody.contents ?? []) {
    for (const part of content.parts ?? []) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        userTexts.push(part.text);
      }
      if (part.inlineData && typeof part.inlineData.data === 'string' && part.inlineData.data.length > 0) {
        images.push(part.inlineData.data);
      }
    }
  }

  const messages: OllamaChatMessage[] = [];
  if (systemText.length > 0) {
    messages.push({ role: 'system', content: systemText });
  }
  const userMessage: OllamaChatMessage = {
    role: 'user',
    content: userTexts.join('\n\n'),
  };
  if (images.length > 0) {
    userMessage.images = images;
  }
  messages.push(userMessage);

  const schema = geminiBody.generationConfig?.responseJsonSchema;
  const format = schema
    ? schema
    : geminiBody.generationConfig?.responseMimeType === 'application/json'
      ? 'json'
      : undefined;

  return {
    model,
    stream: false,
    think: false,
    ...(format !== undefined ? { format } : {}),
    options: {
      temperature: options.temperature ?? 0.2,
      num_predict: options.numPredict ?? 2048,
    },
    messages,
  };
}

export function validateSiteSchema(rawText: string): { valid: boolean; rawChars: number } {
  const trimmed = rawText.trim();
  if (!trimmed) return { valid: false, rawChars: rawText.length };
  try {
    const parsed = parseJsonText(trimmed);
    const result = EnhancerOutputSchema.safeParse(parsed);
    return { valid: result.success, rawChars: rawText.length };
  } catch {
    return { valid: false, rawChars: rawText.length };
  }
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Turns an Ollama `/api/chat` response envelope back into a Gemini `generateContent` response shape,
 * preserving raw character count, schema validity, and token usage.
 */
export function ollamaToGeminiResponse(envelope: OllamaChatResponse): {
  geminiBody: GeminiResponseBody;
  rawChars: number;
  schemaValid: boolean;
  usage: TokenUsage;
  finishReason: string;
} {
  const contentRaw = envelope.message?.content;
  const text =
    typeof contentRaw === 'string'
      ? contentRaw
      : contentRaw && typeof contentRaw === 'object'
        ? JSON.stringify(contentRaw)
        : '';

  const finishReason =
    envelope.done_reason === 'length'
      ? 'MAX_TOKENS'
      : envelope.done === false
        ? 'OTHER'
        : 'STOP';

  const inputTokens = nonNegativeInt(envelope.prompt_eval_count) ?? 0;
  const outputTokens = nonNegativeInt(envelope.eval_count) ?? 0;
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };

  const schemaCheck = validateSiteSchema(text);
  const schemaValid = finishReason === 'STOP' && schemaCheck.valid;

  const geminiBody: GeminiResponseBody = {
    candidates: [
      {
        finishReason,
        content: {
          parts: [{ text }],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: usage.inputTokens,
      candidatesTokenCount: usage.outputTokens,
      totalTokenCount: usage.totalTokens,
    },
  };

  return {
    geminiBody,
    rawChars: text.length,
    schemaValid,
    usage,
    finishReason,
  };
}

export function extractGeminiResponseInfo(raw: unknown): {
  rawChars: number;
  schemaValid: boolean;
  usage: TokenUsage | null;
  finishReason: string;
} {
  if (!raw || typeof raw !== 'object') {
    return { rawChars: 0, schemaValid: false, usage: null, finishReason: 'INVALID_BODY' };
  }
  const body = raw as GeminiResponseBody;
  const candidate = body.candidates?.[0];
  const finishReason = candidate?.finishReason ?? (body.promptFeedback?.blockReason ? `BLOCKED:${body.promptFeedback.blockReason}` : 'NO_CANDIDATE');
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text ?? '')
    .join('');
  const schemaCheck = validateSiteSchema(text);
  const schemaValid = !body.promptFeedback?.blockReason && finishReason === 'STOP' && schemaCheck.valid;

  let usage: TokenUsage | null = null;
  const um = body.usageMetadata;
  if (um && typeof um === 'object') {
    const promptCount = nonNegativeInt(um.promptTokenCount) ?? 0;
    const thoughtsCount = nonNegativeInt(um.thoughtsTokenCount);
    const candidatesCount = nonNegativeInt(um.candidatesTokenCount);
    const totalCount = nonNegativeInt(um.totalTokenCount);
    const visibleOutput =
      candidatesCount !== null
        ? candidatesCount
        : totalCount !== null
          ? Math.max(0, totalCount - promptCount - (thoughtsCount ?? 0))
          : 0;
    const outputTokens = visibleOutput + (thoughtsCount ?? 0);
    usage = {
      inputTokens: promptCount,
      outputTokens,
      totalTokens: totalCount ?? promptCount + outputTokens,
      ...(thoughtsCount !== null ? { thoughtsTokens: thoughtsCount } : {}),
    };
  }

  return {
    rawChars: text.length,
    schemaValid,
    usage,
    finishReason,
  };
}
