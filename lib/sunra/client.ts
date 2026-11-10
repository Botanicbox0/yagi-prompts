/**
 * Sunra AI (sunra.ai) Multimodal Queue & Live Pricing Client
 *
 * Supports:
 * - High-concurrency async queue submission (`POST /v1/queue/{endpoint}`), status polling, and result retrieval
 * - Actual billed cost extraction (`units / 1000` USD and `total_tokens`)
 * - Live pricing endpoint inspection (`GET /v1/pricing/model/{model_id}/endpoint/{endpoint}`) so TWINGS
 *   can immediately detect unannounced Sunra price changes and trip the pricing circuit breaker.
 */

export const SUNRA_DEFAULT_BASE_URL = 'https://api.sunra.ai' as const;

/** Sunra charges a 5% platform top-up fee on credit purchases (Terms §6.2). */
export const SUNRA_TOPUP_FEE_MULTIPLIER = 1.05 as const;

/** Pre-submission credit hold amounts required by Sunra per video request. */
export const SUNRA_CREDIT_HOLD_USD: Readonly<Record<string, number>> = {
  'seedance-2.0': 8,
  'seedance-2.5': 18,
  'seedance-mini': 2
};

export interface SunraConfig {
  apiKey: string;
  baseUrl: string;
}

export function sunraConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): SunraConfig | null {
  const apiKey = env.SUNRA_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.SUNRA_BASE_URL?.trim().replace(/\/+$/, '') || SUNRA_DEFAULT_BASE_URL
  };
}

const TASK_PREFIX = 'sunra:';

export function toSunraTaskId(id: string): string {
  return `${TASK_PREFIX}${id}`;
}

export function fromSunraTaskId(taskId: string): string | null {
  return taskId.startsWith(TASK_PREFIX) ? taskId.slice(TASK_PREFIX.length) : null;
}

const VIDEO_ENDPOINTS: Readonly<Record<string, string>> = {
  'seedance-2.0': 'bytedance/seedance-2.0/text-to-video',
  'seedance-2.5': 'bytedance/seedance-2.5/text-to-video'
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
  url: string | null;
  /** Raw billed USD reported by Sunra (`units / 1000`). */
  billedUsd: number | null;
  /** Effective USD including Sunra's 5% credit top-up fee. */
  effectiveUsdWithFee: number | null;
  totalTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: boolean | null;
}

export interface SunraEndpointPricing {
  modelId: string;
  endpoint: string;
  /** Reported price per 1M tokens or per second from Sunra's pricing API. */
  unitPriceUsd: number;
  unitType: 'per_million_tokens' | 'per_second' | 'per_generation';
  checkedAt: string;
}

export function isSunraTerminal(status: SunraStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELED';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function parseSunraStatus(
  raw: unknown
): Pick<SunraTask, 'status' | 'success' | 'errorCode' | 'errorMessage' | 'errorRetryable'> {
  const record = asRecord(raw);
  const error = asRecord(record.error);
  return {
    status:
      typeof record.status === 'string' && (STATUSES as readonly string[]).includes(record.status)
        ? (record.status as SunraStatus)
        : 'IN_QUEUE',
    success: typeof record.success === 'boolean' ? record.success : null,
    errorCode: typeof error.code === 'string' ? error.code : null,
    errorMessage: typeof error.message === 'string' ? error.message : null,
    errorRetryable: typeof error.retryable === 'boolean' ? error.retryable : null
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

  get insufficientCredit(): boolean {
    return this.code === 'INSUFFICIENT_CREDIT' || this.status === 412;
  }

  get accessProblem(): boolean {
    return this.insufficientCredit || this.status === 401 || this.status === 403;
  }
}

/** The queue `/status` body, with the failure object Sunra publishes since 2026-08-17. */
export interface SunraQueueState {
  status: SunraStatus;
  success: boolean | null;
  error: { code: string | null; reason: string | null; retryable: boolean | null; message: string | null } | null;
  /** Settled charge in USD (`billing.amount`), when the status reports it. */
  billingUsd: number | null;
}

/** The result body of a completed prediction: every file it produced, plus the fields the brand studio needs. */
export interface SunraQueueResult {
  files: Array<{ url: string; contentType: string | null }>;
  draftTaskId: string | null;
  /** Billing units (1000 units = $1), when reported. */
  units: number | null;
  durationSeconds: number | null;
}

export interface SunraClient {
  /** `options.webhook`: Sunra POSTs the terminal state there (docs.sunra.ai — Webhooks). */
  submit(endpoint: string, input: Record<string, unknown>, options?: { webhook?: string | null }): Promise<{ id: string }>;
  getTask(id: string): Promise<SunraTask>;
  fetchPricing?(modelId: string, operation: string): Promise<SunraEndpointPricing | null>;
  /** Brand studio v2 (lib/brand-studio/provider/sunra-api.ts). */
  queueStatus?(id: string): Promise<SunraQueueState>;
  queueResult?(id: string): Promise<SunraQueueResult>;
  cancel?(id: string): Promise<void>;
}

function numberOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function parseSunraQueueState(raw: unknown): SunraQueueState {
  const record = asRecord(raw);
  const base = parseSunraStatus(raw);
  const error = record.error && typeof record.error === 'object' ? asRecord(record.error) : null;
  const billing = asRecord(record.billing);
  return {
    status: base.status,
    success: base.success,
    error: error
      ? {
          code: typeof error.code === 'string' ? error.code : null,
          reason: typeof error.reason === 'string' ? error.reason : null,
          retryable: typeof error.retryable === 'boolean' ? error.retryable : null,
          message: typeof error.message === 'string' ? error.message : null,
        }
      : null,
    billingUsd: billing.currency === undefined || billing.currency === 'USD' ? numberOf(billing.amount) : null,
  };
}

export function parseSunraQueueResult(raw: unknown): SunraQueueResult {
  const result = asRecord(raw);
  const files: SunraQueueResult['files'] = [];
  const push = (file: unknown) => {
    const f = asRecord(file);
    if (typeof f.url === 'string' && f.url) files.push({ url: f.url, contentType: typeof f.content_type === 'string' ? f.content_type : null });
  };
  if (Array.isArray(result.images)) result.images.forEach(push);
  if (result.video) push(result.video);
  if (result.image) push(result.image);
  const video = asRecord(result.video);
  const draft = typeof result.draft_task_id === 'string' ? result.draft_task_id : typeof video.draft_task_id === 'string' ? video.draft_task_id : null;
  return { files, draftTaskId: draft || null, units: numberOf(result.units), durationSeconds: numberOf(result.duration) };
}

export function createSunraClient(
  config: SunraConfig,
  deps: { fetch?: typeof fetch } = {}
): SunraClient {
  const doFetch = deps.fetch ?? globalThis.fetch;

  async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await doFetch(`${config.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Key ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (cause) {
      throw new SunraError(
        'sunra_network',
        cause instanceof Error ? cause.message : 'network error',
        0,
        true
      );
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
      const code =
        typeof error.code === 'string' && error.code ? error.code : `http_${response.status}`;
      const message =
        typeof error.message === 'string' && error.message ? error.message : response.statusText;
      throw new SunraError(
        code,
        message,
        response.status,
        response.status === 429 || response.status >= 500
      );
    }
    return json;
  }

  return {
    async submit(endpoint, input, options) {
      const webhook = options?.webhook ? `?webhook=${encodeURIComponent(options.webhook)}` : '';
      const json = await call(`/v1/queue/${endpoint}${webhook}`, {
        method: 'POST',
        body: JSON.stringify(input)
      });
      if (typeof json.request_id !== 'string' || !json.request_id) {
        throw new SunraError(
          'sunra_malformed_task',
          'submit response has no request_id',
          0,
          false
        );
      }
      return { id: json.request_id };
    },

    async getTask(id) {
      const path = `/v1/queue/requests/${encodeURIComponent(id)}`;
      const state = parseSunraStatus(await call(`${path}/status`, { method: 'GET' }));
      const task: SunraTask = {
        id,
        ...state,
        url: null,
        billedUsd: null,
        effectiveUsdWithFee: null,
        totalTokens: null
      };
      if (state.status !== 'COMPLETED' || state.success === false) return task;
      const result = await call(path, { method: 'GET' });
      const images = Array.isArray(result.images) ? result.images : [];
      const url = asRecord(result.video).url ?? asRecord(images[0]).url;
      const billedUsd =
        typeof result.units === 'number' && result.units > 0
          ? Math.round((result.units / 1000) * 10000) / 10000
          : null;
      const effectiveUsdWithFee =
        billedUsd !== null
          ? Math.round(billedUsd * SUNRA_TOPUP_FEE_MULTIPLIER * 10000) / 10000
          : null;
      const totalTokens =
        typeof result.total_tokens === 'number' && Number.isFinite(result.total_tokens)
          ? result.total_tokens
          : null;
      return {
        ...task,
        url: typeof url === 'string' ? url : null,
        billedUsd,
        effectiveUsdWithFee,
        totalTokens
      };
    },

    async queueStatus(id) {
      return parseSunraQueueState(await call(`/v1/queue/requests/${encodeURIComponent(id)}/status`, { method: 'GET' }));
    },

    async queueResult(id) {
      return parseSunraQueueResult(await call(`/v1/queue/requests/${encodeURIComponent(id)}`, { method: 'GET' }));
    },

    async cancel(id) {
      await call(`/v1/queue/requests/${encodeURIComponent(id)}/cancel`, { method: 'PUT' });
    },

    async fetchPricing(modelId, operation) {
      try {
        const json = await call(
          `/v1/pricing/model/${encodeURIComponent(modelId)}/endpoint/${encodeURIComponent(operation)}`,
          { method: 'GET' }
        );
        const rawPrice =
          typeof json.unit_price_usd === 'number'
            ? json.unit_price_usd
            : typeof json.price_per_million_tokens === 'number'
              ? json.price_per_million_tokens
              : typeof json.price === 'number'
                ? json.price
                : null;
        if (rawPrice === null || rawPrice <= 0) return null;
        const unitType =
          json.unit_type === 'per_second' || json.unit_type === 'per_generation'
            ? json.unit_type
            : 'per_million_tokens';
        return {
          modelId,
          endpoint: `${modelId}/${operation}`,
          unitPriceUsd: rawPrice,
          unitType,
          checkedAt: new Date().toISOString()
        };
      } catch {
        return null;
      }
    }
  };
}
