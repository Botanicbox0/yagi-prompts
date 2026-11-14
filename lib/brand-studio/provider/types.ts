/**
 * The one shape every execution backend speaks (docs/BRAND-STUDIO-V2.md §7). The engine never knows
 * whether a task ran on Sunra's queue or the fake provider; it submits a request body built by
 * ./requests.ts, asks for the status, and downloads what came back.
 *
 * Provider messages stay in `detail` (server logs and `error_detail`); only the codes reach a customer.
 */

export type StudioProviderFailure = 'provider_rejected' | 'provider_unavailable' | 'failed';

export interface StudioProviderRequest {
  /** `alias/endpoint`, e.g. `bytedance/seedream-5.5/text-to-image`. */
  endpoint: string;
  body: Record<string, unknown>;
}

export interface StudioProviderOutput {
  url: string;
  mime: string | null;
  /** Video length when the provider reports it. */
  seconds?: number | null;
}

export type StudioTaskStatus =
  | { state: 'pending' }
  | { state: 'succeeded'; outputs: StudioProviderOutput[]; costUsd?: number; draftTaskId?: string }
  | { state: 'failed'; code: StudioProviderFailure; detail: string };

export class StudioProviderError extends Error {
  constructor(
    readonly code: StudioProviderFailure,
    readonly detail: string,
    /** True when the same request may succeed later (network, 429, 5xx). */
    readonly retryable: boolean,
    /** `balance`: the account behind this lane cannot pay; the job may move to another lane. */
    readonly reason?: 'balance',
  ) {
    super(`${code}: ${detail}`);
    this.name = 'StudioProviderError';
  }
}

export interface StudioProvider {
  readonly name: 'sunra_api' | 'fake';
  submit(request: StudioProviderRequest, options?: { webhookUrl?: string | null }): Promise<{ taskId: string }>;
  status(taskId: string): Promise<StudioTaskStatus>;
  /** Best effort; a provider that cannot cancel simply lets the task finish unused. */
  cancel?(taskId: string): Promise<void>;
  /** Fetch a result file the provider (or the account-lane worker) pointed at. */
  download(url: string): Promise<{ bytes: Uint8Array; mime: string | null }>;
}
