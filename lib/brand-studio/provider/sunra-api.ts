/**
 * The API lane (`sunra_api`): Sunra's queue with `SUNRA_API_KEY` (docs/BRAND-STUDIO-V2.md §7).
 *
 * Error mapping (customer codes only; Sunra's words go to `detail` and the server log):
 *   unsafe content (submit or prediction)      -> provider_rejected
 *   every documented refusal class             -> provider_rejected (moderation categories incl. `copyright`, real-person
 *                                                 and sensitive content; `SENSITIVE_WORD_ERROR`). The strings come from the
 *                                                 docs (docs/research/brand-sound-studio-2026-11-20/suno-prompting.md), not
 *                                                 from an observed response: none has been sent on purpose (§12.5).
 *   402/412 or INSUFFICIENT_CREDIT              -> provider_unavailable, plus a `studio_provider_balance` log
 *   401/403, upstream account trouble           -> provider_unavailable
 *   network, 429, 5xx                           -> provider_unavailable, retryable
 *   anything else                               -> failed
 */
import { createSunraClient, SunraError, type SunraClient, type SunraConfig } from '@/lib/sunra/client';
import { downloadResult } from './download';
import { StudioProviderError, type StudioProvider, type StudioTaskStatus } from './types';

type Log = (event: string, detail?: Record<string, unknown>) => void;

const UNSAFE = new Set(['unsafe_content', 'PREDICTION_UNSAFE_CONTENT', 'content_policy_violation', 'copyright', 'SENSITIVE_WORD_ERROR']);
/** Refusal words in a code or a reason: Sunra's moderation categories and the relay statuses the docs list. */
const REFUSAL = /moderation|unsafe|sensitive|copyright|real[-_ ]?person|content[-_ ]?policy/i;

function insufficient(error: SunraError): boolean {
  return error.insufficientCredit || error.status === 402;
}

export function mapSunraSubmitError(error: unknown, log?: Log): StudioProviderError {
  if (!(error instanceof SunraError)) {
    return new StudioProviderError('provider_unavailable', error instanceof Error ? error.message : 'submit failed', true);
  }
  const detail = `${error.code} (${error.status}): ${error.message}`.slice(0, 500);
  if (error.moderated || UNSAFE.has(error.code) || REFUSAL.test(error.code)) return new StudioProviderError('provider_rejected', detail, false);
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
  if (UNSAFE.has(code) || REFUSAL.test(code) || REFUSAL.test(reason)) return { state: 'failed', code: 'provider_rejected', detail };
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
      // A failed request also reads COMPLETED (paid smoke test, 2026-11-20): `success` and `error` decide, never `status`.
      if (state.success === false || (state.success !== true && state.error)) return mapSunraPredictionFailure(state.error, deps.log);
      let result;
      try {
        result = await client.queueResult(taskId);
      } catch (error) {
        const mapped = mapSunraSubmitError(error, deps.log);
        if (mapped.retryable) return { state: 'pending' };
        return { state: 'failed', code: mapped.code, detail: mapped.detail };
      }
      if (result.error) return mapSunraPredictionFailure(result.error, deps.log);
      if (result.files.length === 0) return { state: 'failed', code: 'failed', detail: 'completed without a file' };
      // The charge is `billing.amount` (status first, then the result body).
      const costUsd = state.billingUsd ?? result.billingUsd ?? (result.units !== null && result.units > 0 ? result.units / 1000 : undefined);
      return {
        state: 'succeeded',
        outputs: result.clips?.length
          ? result.clips.map((c) => ({ url: c.url, mime: 'audio/mpeg', seconds: c.seconds, meta: c.meta }))
          : result.files.map((f) => ({ url: f.url, mime: f.contentType, seconds: result.durationSeconds })),
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
