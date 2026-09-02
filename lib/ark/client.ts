import { ARK_MODELS, type ArkModelKey, type ArkRatio, type ArkResolution } from './models';

/**
 * BytePlus ModelArk — the video-generation task API, as ONE boundary.
 *
 * Same seam and same reasons as `lib/notify/mailer.ts`: there is no `ARK_API_KEY` on this machine
 * until the founder places one in Vercel and `.env.local` (a key never passes through this code
 * base or this conversation), so the client takes its `fetch` as a dependency and the tests drive
 * it with recorded response shapes. The first live call validates the shapes; nothing here guesses.
 *
 * What the API is (docs.byteplus.com, Seedance 2.5 tutorial, 2026-08-31):
 *
 *   POST {base}/contents/generations/tasks   Authorization: Bearer {ARK_API_KEY}
 *     { model, content: [ {type:'text'}, {type:'image_url', role}, {type:'video_url', role},
 *       {type:'audio_url', role} ], resolution, ratio, duration, generate_audio, watermark, … }
 *     → { id: 'cgt-…' }
 *   GET  {base}/contents/generations/tasks/{id}
 *     → { id, status: queued|running|succeeded|failed|cancelled|expired, content: { video_url },
 *         error: { code, message }, usage: { completion_tokens } }
 *
 * Two facts shape the callers more than the schema does:
 *   · the finished `video_url` is valid for 24 hours (`ARK_VIDEO_URL_TTL_HOURS`) — the job worker
 *     copies it into our storage the moment a task succeeds, never later;
 *   · a reference image that "may contain a real person" is REJECTED at input
 *     (`InputImageSensitiveContentDetected.PrivacyInformation`). That is not a transient error and
 *     not a bug in the prompt — it is the policy that makes the real-human asset library
 *     (`asset://…` URLs) the only door for a user's own face. `isInputRejection` names it so the
 *     UI can say "본인 인증을 먼저 해주세요" instead of "다시 시도".
 *
 * No `server-only` guard, like the mailer: scripts and tests import it directly. The API key is
 * still server-side by construction — `arkConfigFromEnv` reads `ARK_API_KEY`, which has no
 * `NEXT_PUBLIC_` prefix and therefore never reaches a browser bundle.
 */

export const ARK_DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

export interface ArkConfig {
  apiKey: string;
  baseUrl: string;
}

/** `null` when unconfigured — the studio stays a mock and the admin surface says why. */
export function arkConfigFromEnv(env: Record<string, string | undefined> = process.env): ArkConfig | null {
  const apiKey = env.ARK_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.ARK_BASE_URL?.trim().replace(/\/+$/, '') || ARK_DEFAULT_BASE_URL;
  return { apiKey, baseUrl };
}

// ---------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------

export type ArkImageRole = 'first_frame' | 'last_frame' | 'reference_image';

export type ArkContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: ArkImageRole }
  | { type: 'video_url'; video_url: { url: string }; role: 'reference_video' }
  | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' };

export interface CreateVideoTaskInput {
  model: ArkModelKey;
  content: ArkContentItem[];
  resolution?: ArkResolution;
  ratio?: ArkRatio;
  /** Seconds, or -1 to let the model pick within the valid range. */
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  outputFormat?: 'mp4' | 'mov';
  seed?: number;
  /** Task-completion webhook. Optional: the worker polls regardless, so a lost callback costs nothing. */
  callbackUrl?: string;
}

/** The wire body, spelled the way the API spells it. Exported so a test can pin the mapping. */
export function toCreateBody(input: CreateVideoTaskInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: ARK_MODELS[input.model].id,
    content: input.content,
  };
  if (input.resolution !== undefined) body.resolution = input.resolution;
  if (input.ratio !== undefined) body.ratio = input.ratio;
  if (input.duration !== undefined) body.duration = input.duration;
  if (input.generateAudio !== undefined) body.generate_audio = input.generateAudio;
  if (input.watermark !== undefined) body.watermark = input.watermark;
  if (input.outputFormat !== undefined) body.output_format = input.outputFormat;
  if (input.seed !== undefined) body.seed = input.seed;
  if (input.callbackUrl !== undefined) body.callback_url = input.callbackUrl;
  return body;
}

// ---------------------------------------------------------------------------
// response
// ---------------------------------------------------------------------------

export type ArkTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

const TASK_STATUSES: readonly ArkTaskStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
];

export interface ArkTask {
  id: string;
  status: ArkTaskStatus;
  model: string | null;
  videoUrl: string | null;
  error: { code: string; message: string } | null;
  /** Billing truth — the estimate in `models.ts` is only a forecast of this. */
  completionTokens: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function isTerminal(status: ArkTaskStatus): boolean {
  return status !== 'queued' && status !== 'running';
}

/**
 * Error codes that mean "the INPUT was refused by policy" — not retryable, not the prompt's fault,
 * and the one class the studio must explain in product language. The real-person code is the one
 * that matters to TWINGS; the others are the same family (text / output moderation).
 */
export function isInputRejection(code: string | null | undefined): boolean {
  if (!code) return false;
  return (
    code.startsWith('InputImageSensitiveContentDetected') ||
    code.startsWith('InputVideoSensitiveContentDetected') ||
    code.startsWith('InputTextSensitiveContentDetected') ||
    code.startsWith('OutputVideoSensitiveContentDetected')
  );
}

export const ARK_REAL_PERSON_CODE = 'InputImageSensitiveContentDetected.PrivacyInformation';

export function parseTask(raw: unknown): ArkTask {
  const record = asRecord(raw);
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) throw new ArkError('ark_malformed_task', 'task response has no id', 0, false);
  const status = typeof record.status === 'string' && (TASK_STATUSES as readonly string[]).includes(record.status)
    ? (record.status as ArkTaskStatus)
    : 'queued';
  const content = asRecord(record.content);
  const error = asRecord(record.error);
  const usage = asRecord(record.usage);
  return {
    id,
    status,
    model: typeof record.model === 'string' ? record.model : null,
    videoUrl: typeof content.video_url === 'string' ? content.video_url : null,
    error:
      typeof error.code === 'string'
        ? { code: error.code, message: typeof error.message === 'string' ? error.message : '' }
        : null,
    completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
    createdAt: stringOrNull(record.created_at),
    updatedAt: stringOrNull(record.updated_at),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  return null;
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export class ArkError extends Error {
  readonly code: string;
  readonly status: number;
  /** A 429 or a 5xx is worth another attempt; a 4xx is the request's fault and is not. */
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'ArkError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  get inputRejected(): boolean {
    return isInputRejection(this.code);
  }
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

export interface ArkClient {
  createVideoTask(input: CreateVideoTaskInput): Promise<{ id: string }>;
  getVideoTask(id: string): Promise<ArkTask>;
}

export interface ArkClientDeps {
  fetch?: typeof fetch;
}

export function createArkClient(config: ArkConfig, deps: ArkClientDeps = {}): ArkClient {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  async function call(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${config.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    } catch (cause) {
      throw new ArkError('ark_network', cause instanceof Error ? cause.message : 'network error', 0, true);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const error = asRecord(asRecord(json).error);
      const code = typeof error.code === 'string' ? error.code : `http_${response.status}`;
      const message = typeof error.message === 'string' ? error.message : text.slice(0, 200) || response.statusText;
      const retryable = response.status === 429 || response.status >= 500;
      throw new ArkError(code, message, response.status, retryable);
    }
    return json;
  }

  return {
    async createVideoTask(input) {
      const json = await call('/contents/generations/tasks', {
        method: 'POST',
        body: JSON.stringify(toCreateBody(input)),
      });
      const id = asRecord(json).id;
      if (typeof id !== 'string' || !id) {
        throw new ArkError('ark_malformed_task', 'create response has no id', 0, false);
      }
      return { id };
    },
    async getVideoTask(id) {
      const json = await call(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'GET' });
      return parseTask(json);
    },
  };
}
