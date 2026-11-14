import { describe, expect, it, vi } from 'vitest';
import { createSunraStudioProvider } from '@/lib/brand-studio/provider/sunra-api';
import { StudioProviderError } from '@/lib/brand-studio/provider/types';
import { downloadableUrl } from '@/lib/brand-studio/provider/download';

/** The API lane against a scripted fetch: no network, no key, no money. */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function provider(routes: Record<string, () => Response>, log = vi.fn()) {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    for (const [suffix, respond] of Object.entries(routes)) if (url.includes(suffix)) return respond();
    return json(404, { error: { code: 'not_found', message: 'no route' } });
  }) as unknown as typeof globalThis.fetch;
  return { p: createSunraStudioProvider({ apiKey: 'sk-test', baseUrl: 'https://api.sunra.ai' }, { fetch, log }), calls, log };
}

describe('Sunra API lane', () => {
  it('submits with the webhook as a query parameter and reads images, cost and the draft id back', async () => {
    const { p, calls } = provider({
      '/v1/queue/bytedance/seedance-2.5/text-to-video': () => json(200, { request_id: 'pd_1' }),
      '/v1/queue/requests/pd_1/status': () => json(200, { status: 'COMPLETED', success: true, error: null, billing: { amount: '0.95', currency: 'USD' } }),
      '/v1/queue/requests/pd_1': () => json(200, { video: { url: 'https://cdn.sunra.ai/v.mp4', content_type: 'video/mp4' }, draft_task_id: 'draft_9', duration: 5, units: 950 }),
    });
    expect(await p.submit({ endpoint: 'bytedance/seedance-2.5/text-to-video', body: { prompt: 'x' } }, { webhookUrl: 'https://twings.app/api/brand-studio/webhook?token=s' })).toEqual({ taskId: 'pd_1' });
    expect(calls[0]).toBe(`POST https://api.sunra.ai/v1/queue/bytedance/seedance-2.5/text-to-video?webhook=${encodeURIComponent('https://twings.app/api/brand-studio/webhook?token=s')}`);
    expect(await p.status('pd_1')).toEqual({ state: 'succeeded', outputs: [{ url: 'https://cdn.sunra.ai/v.mp4', mime: 'video/mp4', seconds: 5 }], costUsd: 0.95, draftTaskId: 'draft_9' });
  });

  it('reports queued work as pending, an unsafe prediction as provider_rejected, a cancel as failed', async () => {
    let state: unknown = { status: 'IN_PROGRESS' };
    const { p } = provider({ '/v1/queue/requests/pd_2/status': () => json(200, state) });
    expect(await p.status('pd_2')).toEqual({ state: 'pending' });
    state = { status: 'COMPLETED', success: false, error: { code: 'unsafe_content', reason: 'moderation_blocked', retryable: false, message: 'suppressed' } };
    expect(await p.status('pd_2')).toMatchObject({ state: 'failed', code: 'provider_rejected' });
    state = { status: 'CANCELED' };
    expect(await p.status('pd_2')).toMatchObject({ state: 'failed', code: 'failed' });
  });

  it('maps a balance problem to provider_unavailable and logs studio_provider_balance (never the message to a customer)', async () => {
    for (const status of [402, 412]) {
      const { p, log } = provider({ '/v1/queue/': () => json(status, { error: { code: 'INSUFFICIENT_CREDIT', message: 'Insufficient balance: $0.00' } }) });
      const error = await p.submit({ endpoint: 'bytedance/seedream-5.5/text-to-image', body: {} }).catch((e) => e);
      expect(error).toBeInstanceOf(StudioProviderError);
      expect(error).toMatchObject({ code: 'provider_unavailable', retryable: false });
      expect(log).toHaveBeenCalledWith('studio_provider_balance', expect.objectContaining({ lane: 'sunra_api', status }));
    }
  });

  it('maps a refused input to provider_rejected, overload to a retryable outage, and a bad request to failed', async () => {
    const cases: Array<[number, string, string, boolean]> = [
      [400, 'unsafe_content', 'provider_rejected', false],
      [429, 'rate_limited', 'provider_unavailable', true],
      [503, 'unavailable', 'provider_unavailable', true],
      [401, 'invalid_key', 'provider_unavailable', false],
      [422, 'validation_error', 'failed', false],
    ];
    for (const [status, code, mapped, retryable] of cases) {
      const { p } = provider({ '/v1/queue/': () => json(status, { error: { code, message: 'x' } }) });
      expect(await p.submit({ endpoint: 'a/b/c', body: {} }).catch((e) => e), `${status} ${code}`).toMatchObject({ code: mapped, retryable });
    }
  });

  it('downloads only from public https hosts', () => {
    expect(downloadableUrl('https://cdn.sunra.ai/out/a.png')).not.toBeNull();
    for (const bad of ['http://cdn.sunra.ai/a.png', 'https://127.0.0.1/a.png', 'https://localhost/a.png', 'https://[::1]/a.png', 'https://user:pw@cdn.sunra.ai/a', 'https://metadata.internal/x', 'file:///etc/passwd']) {
      expect(downloadableUrl(bad), bad).toBeNull();
    }
  });
});
