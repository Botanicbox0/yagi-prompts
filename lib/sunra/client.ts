/**
 * Sunra AI (sunra.ai, Second Enlightenment Global Pte. Ltd., Singapore) — the queue API, as ONE
 * boundary (docs.sunra.ai/multimodal/queue, read 2026-10-31):
 *
 *   POST {base}/v1/queue/{owner}/{model}/{operation}   Authorization: Key {SUNRA_API_KEY}
 *     → { request_id, response_url, status_url, cancel_url }
 *   GET  {base}/v1/queue/requests/{id}/status
 *     → { status: IN_QUEUE|IN_PROGRESS|COMPLETED|CANCELED, success?, error?: { code, message, retryable } }
 *   GET  {base}/v1/queue/requests/{id}
 *     → { video: { url }, total_tokens, units }   (1000 units = $1)
 *
 * A backup and a price reference, never the default (docs/SUNRA-PROVIDER.md). Sunra's upload URLs
 * are public and do not expire, so a customer's photo has no place on this path: only the
 * person-free `text-to-video` endpoints are named here, and no upload call exists.
 */

export const SUNRA_DEFAULT_BASE_URL = 'https://api.sunra.ai';

export interface SunraConfig {
  apiKey: string;
  baseUrl: string;
}

/** `null` when unconfigured. The key is never logged or returned. */
export function sunraConfigFromEnv(env: Record<string, string | undefined> = process.env): SunraConfig | null {
  const apiKey = env.SUNRA_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: env.SUNRA_BASE_URL?.trim().replace(/\/+$/, '') || SUNRA_DEFAULT_BASE_URL };
}

/** The manual switch: person-free Seedance jobs go to Sunra only while this is exactly `on`. */
export function sunraBackupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SUNRA_VIDEO_BACKUP?.trim() === 'on';
}

const TASK_PREFIX = 'sunra:';

/** The job row keeps this, so the poll finds Sunra whatever the flag says by then. */
export function toSunraTaskId(id: string): string {
  return `${TASK_PREFIX}${id}`;
}

export function fromSunraTaskId(taskId: string): string | null {
  return taskId.startsWith(TASK_PREFIX) ? taskId.slice(TASK_PREFIX.length) : null;
}

const VIDEO_ENDPOINTS: Readonly<Record<string, string>> = {
  'seedance-2.0': 'bytedance/seedance-2.0/text-to-video',
  'seedance-2.5': 'bytedance/seedance-2.5/text-to-video',
};

export function sunraVideoEndpoint(model: string): string | null {
  return Object.hasOwn(VIDEO_ENDPOINTS, model) ? VIDEO_ENDPOINTS[model]! : null;
}

export type SunraStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
const STATUSES: readonly SunraStatus[] = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'];

export interface SunraTask {
  id: string;
  status: SunraStatus;
  success: boolean | null;
  /** The finished video's or first image's URL. */
  url: string | null;
  /** From the result's `units` (1000 units = $1). */
  billedUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: boolean | null;
}

export function isSunraTerminal(status: SunraStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELED';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function parseSunraStatus(raw: unknown): Pick<SunraTask, 'status' | 'success' | 'errorCode' | 'errorMessage' | 'errorRetryable'> {
  const record = asRecord(raw);
  const error = asRecord(record.error);
  return {
    status: typeof record.status === 'string' && (STATUSES as readonly string[]).includes(record.status) ? (record.status as SunraStatus) : 'IN_QUEUE',
    success: typeof record.success === 'boolean' ? record.success : null,
    errorCode: typeof error.code === 'string' ? error.code : null,
    errorMessage: typeof error.message === 'string' ? error.message : null,
    errorRetryable: typeof error.retryable === 'boolean' ? error.retryable : null,
  };
}

export class SunraError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'SunraError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  get moderated(): boolean {
    return this.code === 'PREDICTION_UNSAFE_CONTENT';
  }

  /** The key or the balance: console work, not code. Never topped up from here. */
  get accessProblem(): boolean {
    return this.code === 'INSUFFICIENT_CREDIT' || this.status === 401 || this.status === 403;
  }
}

export interface SunraClient {
  submit(endpoint: string, input: Record<string, unknown>): Promise<{ id: string }>;
  getTask(id: string): Promise<SunraTask>;
}

export function createSunraClient(config: SunraConfig, deps: { fetch?: typeof fetch } = {}): SunraClient {
  const doFetch = deps.fetch ?? globalThis.fetch;

  async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await doFetch(`${config.baseUrl}${path}`, { ...init, headers: { Authorization: `Key ${config.apiKey}`, 'Content-Type': 'application/json' } });
    } catch (cause) {
      throw new SunraError('sunra_network', cause instanceof Error ? cause.message : 'network error', 0, true);
    }
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? asRecord(JSON.parse(text)) : {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      const error = asRecord(json.error);
      const code = typeof error.code === 'string' && error.code ? error.code : `http_${response.status}`;
      const message = typeof error.message === 'string' && error.message ? error.message : response.statusText;
      throw new SunraError(code, message, response.status, response.status === 429 || response.status >= 500);
    }
    return json;
  }

  return {
    async submit(endpoint, input) {
      const json = await call(`/v1/queue/${endpoint}`, { method: 'POST', body: JSON.stringify(input) });
      if (typeof json.request_id !== 'string' || !json.request_id) throw new SunraError('sunra_malformed_task', 'submit response has no request_id', 0, false);
      return { id: json.request_id };
    },
    async getTask(id) {
      const path = `/v1/queue/requests/${encodeURIComponent(id)}`;
      const state = parseSunraStatus(await call(`${path}/status`, { method: 'GET' }));
      const task: SunraTask = { id, ...state, url: null, billedUsd: null };
      if (state.status !== 'COMPLETED' || state.success === false) return task;
      const result = await call(path, { method: 'GET' });
      const images = Array.isArray(result.images) ? result.images : [];
      const url = asRecord(result.video).url ?? asRecord(images[0]).url;
      return { ...task, url: typeof url === 'string' ? url : null, billedUsd: typeof result.units === 'number' && result.units > 0 ? result.units / 1000 : null };
    },
  };
}
