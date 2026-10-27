import { KLING_MODELS, klingModelFromEnv, klingModelId, type KlingAspect, type KlingModelKey, type KlingResolution } from './models';

/**
 * Kling official API — the omni-video task API, as ONE boundary (kling.ai/document-api, read
 * 2026-10-24; the same shape on `/omni-video/kling-3.0-omni` today and `/omni-video/kling-4.0`
 * when it opens — only the path segment differs, and that is configuration: lib/kling/models.ts).
 *
 *   POST {base}/omni-video/{model}        Authorization: Bearer {KLING_API_KEY}
 *     { contents: [ {type:'prompt', text}, {type:'refer_image'|'first_frame'|'last_frame', url, id},
 *                   {type:'feature_video'|'base_video', url, id} ],
 *       settings: { resolution, duration, aspect_ratio, audio: 'native'|'off', multi_shot },
 *       options: { callback_url?, external_task_id?, watermark_info: { enabled } } }
 *     → { code: 0, message, request_id, data: { id, status, create_time, update_time } }
 *   GET  {base}/tasks?task_ids={id}
 *     → { code, data: [ { id, status: submitted|processing|succeeded|failed, message,
 *           outputs: [ { type:'video', id, url, duration } ], billing: [ { amount, currency, … } ] } ] }
 *
 * Every error is `{ code, message }` with a service code (kling.ai/document-api/api/get-started/
 * error-codes): 1000–1004 and 1103/1304 are the key or the account (console work), 1100–1102 the
 * balance, 1200–1203 the request, 1300/1301 the platform's content policy (not retryable, not the
 * prompt's fault — the one class the studio explains in product language), 1302/1303 rate limits
 * (retry later), 5000–5002 the server (retry later).
 *
 * Same seam and same reasons as `lib/ark/client.ts`: `fetch` is injected, the key is read from the
 * environment by the caller (`KLING_API_KEY`, no `NEXT_PUBLIC_` prefix, never in this code base or
 * a conversation). Two facts shape the callers: the finished `url` is kept 30 days but is copied
 * into our storage the moment a task succeeds, like ModelArk's 24-hour one; and the prompt dialect
 * is `@image_1` / `@video_1` — `toKlingPrompt` turns the pass's "Image 1" / "Video 1" prose into
 * it, so no caller writes engine syntax.
 *
 * Kling publishes no separate real-person code. Whether it refuses a customer's selfie at all is
 * what `npm run kling:smoke` records (PLATFORM-2.0 §7.3 `needsIdentity` matrix) — nothing here
 * assumes the answer, and nothing here bypasses our own consent and face checks.
 */

export const KLING_DEFAULT_BASE_URL = 'https://api-singapore.klingai.com';

export interface KlingConfig {
  apiKey: string;
  baseUrl: string;
  model: KlingModelKey;
  /** The create endpoint's path segment (`kling-3.0-omni` today). */
  modelId: string;
}

/** `null` when unconfigured — a Kling job fails `no_engine_key`, never a 500. */
export function klingConfigFromEnv(env: Record<string, string | undefined> = process.env): KlingConfig | null {
  const apiKey = env.KLING_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.KLING_BASE_URL?.trim().replace(/\/+$/, '') || KLING_DEFAULT_BASE_URL;
  const model = klingModelFromEnv(env);
  return { apiKey, baseUrl, model, modelId: klingModelId(model, env) };
}

// ---------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------

export type KlingContentItem =
  | { type: 'prompt'; text: string }
  | { type: 'first_frame' | 'last_frame' | 'refer_image'; url: string; id: string }
  | { type: 'feature_video' | 'base_video'; url: string; id: string };

export interface KlingReference {
  type: 'image' | 'video';
  /** An https URL, or for images a `data:` URL / raw base64 (the API takes base64 in `url`). */
  url: string;
}

export interface CreateKlingTaskInput {
  /** The pass's prompt in the shared "Image 1" dialect; rewritten to `@image_1` here. */
  prompt: string;
  /** In prompt order: images become `image_1…`, films `video_1…`. */
  references?: readonly KlingReference[];
  resolution?: KlingResolution;
  aspect?: KlingAspect;
  /** Whole seconds inside the model's range (lib/kling/models.ts `clampKlingDuration`). */
  duration?: number;
  audio?: 'native' | 'off';
  callbackUrl?: string;
  externalTaskId?: string;
}

/** "Image 2" → "@image_2", "Video 1" → "@video_1": the only place engine syntax is written. */
export function toKlingPrompt(text: string): string {
  return text.replace(/\b(Image|Video)\s+(\d+)\b/g, (_match, kind: string, n: string) => `@${kind.toLowerCase()}_${n}`);
}

/** A `data:` URL becomes the raw base64 the API wants; anything else is sent as given. */
export function toKlingImageUrl(url: string): string {
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(url);
  return match ? match[1]! : url;
}

/** The wire body, spelled the way the API spells it. Exported so a test can pin the mapping. */
export function toKlingBody(input: CreateKlingTaskInput, model: KlingModelKey): Record<string, unknown> {
  const spec = KLING_MODELS[model];
  const references = input.references ?? [];
  const images = references.filter((reference) => reference.type === 'image').length;
  if (images > spec.maxReferenceImages) throw new RangeError(`${model} takes at most ${spec.maxReferenceImages} reference images`);
  if (references.filter((reference) => reference.type === 'video').length > 1) throw new RangeError(`${model} takes at most one reference video`);
  let image = 0, video = 0;
  const contents: KlingContentItem[] = [{ type: 'prompt', text: toKlingPrompt(input.prompt) }];
  for (const reference of references) {
    if (reference.type === 'video') contents.push({ type: 'feature_video', url: reference.url, id: `video_${++video}` });
    else contents.push({ type: 'refer_image', url: toKlingImageUrl(reference.url), id: `image_${++image}` });
  }
  const settings: Record<string, unknown> = { audio: input.audio ?? 'native', multi_shot: false };
  if (input.resolution !== undefined) settings.resolution = input.resolution;
  if (input.aspect !== undefined) settings.aspect_ratio = input.aspect;
  if (input.duration !== undefined) settings.duration = input.duration;
  const options: Record<string, unknown> = { watermark_info: { enabled: false } };
  if (input.callbackUrl !== undefined) options.callback_url = input.callbackUrl;
  if (input.externalTaskId !== undefined) options.external_task_id = input.externalTaskId;
  return { contents, settings, options };
}

// ---------------------------------------------------------------------------
// response
// ---------------------------------------------------------------------------

export type KlingTaskStatus = 'submitted' | 'processing' | 'succeeded' | 'failed';

const TASK_STATUSES: readonly KlingTaskStatus[] = ['submitted', 'processing', 'succeeded', 'failed'];

export interface KlingTask {
  id: string;
  status: KlingTaskStatus;
  /** The failure reason on a failed task ("triggering the content risk control of the platform", …). */
  message: string | null;
  videoUrl: string | null;
  /** Seconds, as the API reports them (a string on the wire). */
  durationSeconds: number | null;
  /** What the account was charged, when the task reports a USD cash deduction; the estimate otherwise. */
  billedUsd: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function isKlingTerminal(status: KlingTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

/** 1300 "blocked by platform policy" and 1301 "content security policy" — refused, not retryable. */
export function isKlingPolicyCode(code: number | null | undefined): boolean {
  return code === 1300 || code === 1301;
}

export function parseKlingTask(raw: unknown): KlingTask {
  const record = asRecord(raw);
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) throw new KlingError('kling_malformed_task', 'task response has no id', 0, false);
  const status = typeof record.status === 'string' && (TASK_STATUSES as readonly string[]).includes(record.status) ? (record.status as KlingTaskStatus) : 'submitted';
  const outputs = Array.isArray(record.outputs) ? record.outputs.map(asRecord) : [];
  const video = outputs.find((output) => output.type === 'video' && typeof output.url === 'string') ?? null;
  const billing = Array.isArray(record.billing) ? record.billing.map(asRecord) : [];
  const cash = billing.find((line) => line.charge_type === 'cash' && line.currency === 'USD' && typeof line.amount === 'string' && Number.isFinite(Number(line.amount)));
  const duration = video && typeof video.duration === 'string' ? Number.parseFloat(video.duration) : video && typeof video.duration === 'number' ? video.duration : NaN;
  return {
    id,
    status,
    message: typeof record.message === 'string' && record.message ? record.message : null,
    videoUrl: video ? (video.url as string) : null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    billedUsd: cash ? Number(cash.amount) : null,
    createdAt: millisOrNull(record.create_time),
    updatedAt: millisOrNull(record.update_time),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function millisOrNull(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && /^\d{10,14}$/.test(value)) return new Date(Number(value)).toISOString();
  return null;
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export class KlingError extends Error {
  /** The service code as a string (`1301`), or a local name (`kling_network`, `http_502`). */
  readonly code: string;
  readonly serviceCode: number | null;
  readonly status: number;
  /** 1302/1303 (rate), 429 and 5xx are worth another attempt; the rest is the request's or the account's. */
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor(code: string, message: string, status: number, retryable: boolean, requestId: string | null = null) {
    super(message);
    this.name = 'KlingError';
    this.code = code;
    this.serviceCode = /^\d+$/.test(code) ? Number(code) : null;
    this.status = status;
    this.retryable = retryable;
    this.requestId = requestId;
  }

  /** The platform's content policy refused the prompt or an image — not transient. */
  get moderated(): boolean {
    return isKlingPolicyCode(this.serviceCode);
  }

  /** The key, the account's balance, the model's permission or the IP allowlist: console work, not code. */
  get accessProblem(): boolean {
    const code = this.serviceCode;
    return code !== null && ((code >= 1000 && code <= 1004) || (code >= 1100 && code <= 1103) || code === 1304);
  }
}

function retryableCode(status: number, code: number | null): boolean {
  if (code === 1302 || code === 1303) return true;
  if (code !== null && code >= 5000) return true;
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

export interface KlingClient {
  readonly model: KlingModelKey;
  createVideoTask(input: CreateKlingTaskInput): Promise<{ id: string }>;
  getVideoTask(id: string): Promise<KlingTask>;
}

export interface KlingClientDeps {
  fetch?: typeof fetch;
}

export function createKlingClient(config: KlingConfig, deps: KlingClientDeps = {}): KlingClient {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' };

  async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await doFetch(`${config.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    } catch (cause) {
      throw new KlingError('kling_network', cause instanceof Error ? cause.message : 'network error', 0, true);
    }
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? asRecord(JSON.parse(text)) : {};
    } catch {
      json = {};
    }
    const serviceCode = typeof json.code === 'number' ? json.code : null;
    if (!response.ok || (serviceCode !== null && serviceCode !== 0)) {
      const code = serviceCode !== null && serviceCode !== 0 ? String(serviceCode) : `http_${response.status}`;
      const message = typeof json.message === 'string' && json.message ? json.message : text.slice(0, 200) || response.statusText;
      throw new KlingError(code, message, response.status, retryableCode(response.status, serviceCode), typeof json.request_id === 'string' ? json.request_id : null);
    }
    return json;
  }

  return {
    model: config.model,
    async createVideoTask(input) {
      const json = await call(`/omni-video/${encodeURIComponent(config.modelId)}`, { method: 'POST', body: JSON.stringify(toKlingBody(input, config.model)) });
      const id = asRecord(json.data).id;
      if (typeof id !== 'string' || !id) throw new KlingError('kling_malformed_task', 'create response has no id', 0, false);
      return { id };
    },
    async getVideoTask(id) {
      const json = await call(`/tasks?task_ids=${encodeURIComponent(id)}`, { method: 'GET' });
      const data = Array.isArray(json.data) ? json.data : [json.data];
      const task = data.map(asRecord).find((row) => row.id === id) ?? data[0];
      return parseKlingTask(task);
    },
  };
}
