/**
 * The API lane (`sunra_api`): Sunra's queue with `SUNRA_API_KEY` (docs/BRAND-STUDIO-V2.md §7).
 *
 * Error mapping (customer codes only; Sunra's words go to `detail` and the server log):
 *   unsafe content (submit or prediction)      -> provider_rejected
 *   402/412 or INSUFFICIENT_CREDIT              -> provider_unavailable, plus a `studio_provider_balance` log
 *   401/403, upstream account trouble           -> provider_unavailable
 *   network, 429, 5xx                           -> provider_unavailable, retryable
 *   anything else                               -> failed
 */
import { createSunraClient, SunraError, type SunraClient, type SunraConfig } from '@/lib/sunra/client';
import { downloadResult } from './download';
import { StudioProviderError, type StudioProvider, type StudioTaskStatus } from './types';

type Log = (event: string, detail?: Record<string, unknown>) => void;

const UNSAFE = new Set(['unsafe_content', 'PREDICTION_UNSAFE_CONTENT', 'content_policy_violation']);

function insufficient(error: SunraError): boolean {
  return error.insufficientCredit || error.status === 402;
}

export function mapSunraSubmitError(error: unknown, log?: Log): StudioProviderError {
  if (!(error instanceof SunraError)) {
    return new StudioProviderError('provider_unavailable', error instanceof Error ? error.message : 'submit failed', true);
  }
  const detail = `${error.code} (${error.status}): ${error.message}`.slice(0, 500);
  if (error.moderated || UNSAFE.has(error.code)) return new StudioProviderError('provider_rejected', detail, false);
  if (insufficient(error)) {
    log?.('studio_provider_balance', { lane: 'sunra_api', status: error.status, code: error.code });
    return new StudioProviderError('provider_unavailable', detail, false, 'balance');
  }
  if (error.status === 401 || error.status === 403) return new StudioProviderError('provider_unavailable', detail, false);
  if (error.retryable || error.status === 0) return new StudioProviderError('provider_unavailable', detail, true);
  return new StudioProviderError('failed', detail, false);
}

export function mapSunraPredictionFailure(
  error: { code: string | null; reason: string | null; message: string | null } | null,
  log?: Log,
): Extract<StudioTaskStatus, { state: 'failed' }> {
  const code = error?.code ?? 'unknown';
  const reason = error?.reason ?? '';
  const detail = `${code}${reason ? `/${reason}` : ''}: ${error?.message ?? ''}`.slice(0, 500);
  if (UNSAFE.has(code) || /moderation|unsafe|sensitive/i.test(reason)) return { state: 'failed', code: 'provider_rejected', detail };
  if (/credit|balance|insufficient/i.test(reason) || /credit|balance/i.test(code)) {
    log?.('studio_provider_balance', { lane: 'sunra_api', code, reason });
    return { state: 'failed', code: 'provider_unavailable', detail };
  }
  if (/account|unavailable|capacity/i.test(reason)) return { state: 'failed', code: 'provider_unavailable', detail };
  return { state: 'failed', code: 'failed', detail };
}

export function createSunraStudioProvider(
  config: SunraConfig,
  deps: { fetch?: typeof fetch; log?: Log; client?: SunraClient } = {},
): StudioProvider {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const client = deps.client ?? createSunraClient(config, { fetch: doFetch });
  return {
    name: 'sunra_api',
    async submit(request, options) {
      try {
        const { id } = await client.submit(request.endpoint, request.body, { webhook: options?.webhookUrl ?? null });
        return { taskId: id };
      } catch (error) {
        throw mapSunraSubmitError(error, deps.log);
      }
    },
    async status(taskId) {
      if (!client.queueStatus || !client.queueResult) throw new Error('sunra client without queue status');
      let state;
      try {
        state = await client.queueStatus(taskId);
      } catch (error) {
        const mapped = mapSunraSubmitError(error, deps.log);
        if (mapped.retryable) return { state: 'pending' };
        return { state: 'failed', code: mapped.code, detail: mapped.detail };
      }
      if (state.status === 'IN_QUEUE' || state.status === 'IN_PROGRESS') return { state: 'pending' };
      if (state.status === 'CANCELED') return { state: 'failed', code: 'failed', detail: 'canceled at the provider' };
      if (state.success === false) return mapSunraPredictionFailure(state.error, deps.log);
      let result;
      try {
        result = await client.queueResult(taskId);
      } catch (error) {
        const mapped = mapSunraSubmitError(error, deps.log);
        if (mapped.retryable) return { state: 'pending' };
        return { state: 'failed', code: mapped.code, detail: mapped.detail };
      }
      if (result.files.length === 0) return { state: 'failed', code: 'failed', detail: 'completed without a file' };
      const costUsd = state.billingUsd ?? (result.units !== null && result.units > 0 ? result.units / 1000 : undefined);
      return {
        state: 'succeeded',
        outputs: result.files.map((f) => ({ url: f.url, mime: f.contentType, seconds: result.durationSeconds })),
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(result.draftTaskId ? { draftTaskId: result.draftTaskId } : {}),
      };
    },
    async cancel(taskId) {
      try {
        await client.cancel?.(taskId);
      } catch {
        /* Best effort: a task that already started finishes unused. */
      }
    },
    download: (url) => downloadResult(doFetch, url),
  };
}
