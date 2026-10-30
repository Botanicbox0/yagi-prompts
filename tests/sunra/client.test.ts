import { describe, expect, it } from 'vitest';
import { SUNRA_DEFAULT_BASE_URL, SunraError, createSunraClient, parseSunraStatus, sunraBackupEnabled, sunraConfigFromEnv, sunraVideoEndpoint, toSunraTaskId, fromSunraTaskId } from '@/lib/sunra/client';

/**
 * The Sunra boundary, driven with the shapes docs.sunra.ai publishes (read 2026-10-31). `fetch` is
 * injected; the first live call is `npm run sunra:smoke`.
 */

type Call = { url: string; init: RequestInit };

function fakeFetch(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const config = { apiKey: 'test-key', baseUrl: SUNRA_DEFAULT_BASE_URL };

describe('configuration', () => {
  it('is null without a key and never reads a public variable', () => {
    expect(sunraConfigFromEnv({})).toBeNull();
    expect(sunraConfigFromEnv({ NEXT_PUBLIC_SUNRA_API_KEY: 'x' })).toBeNull();
    expect(sunraConfigFromEnv({ SUNRA_API_KEY: ' k ' })).toEqual({ apiKey: 'k', baseUrl: SUNRA_DEFAULT_BASE_URL });
  });

  it('keeps the backup off unless the flag is exactly on', () => {
    expect(sunraBackupEnabled({})).toBe(false);
    expect(sunraBackupEnabled({ SUNRA_VIDEO_BACKUP: 'true' })).toBe(false);
    expect(sunraBackupEnabled({ SUNRA_VIDEO_BACKUP: 'on' })).toBe(true);
  });
});

describe('task ids', () => {
  it('marks a Sunra task so the poll can never ask another provider', () => {
    expect(toSunraTaskId('pd_1')).toBe('sunra:pd_1');
    expect(fromSunraTaskId('sunra:pd_1')).toBe('pd_1');
    expect(fromSunraTaskId('cgt-1')).toBeNull();
  });

  it('names the two Seedance text endpoints and nothing else', () => {
    expect(sunraVideoEndpoint('seedance-2.0')).toBe('bytedance/seedance-2.0/text-to-video');
    expect(sunraVideoEndpoint('seedance-2.5')).toBe('bytedance/seedance-2.5/text-to-video');
    expect(sunraVideoEndpoint('kling-3.0-omni')).toBeNull();
  });
});

describe('client', () => {
  it('submits with the Key scheme and returns the request id', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: { request_id: 'pd_1' } }));
    const client = createSunraClient(config, { fetch: fetchImpl });
    await expect(client.submit('bytedance/seedance-2.0/text-to-video', { prompt: 'a' })).resolves.toEqual({ id: 'pd_1' });
    expect(calls[0]!.url).toBe('https://api.sunra.ai/v1/queue/bytedance/seedance-2.0/text-to-video');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Key test-key');
  });

  it('reads a finished video and its billing units', async () => {
    const { calls, fetchImpl } = fakeFetch((call) => call.url.endsWith('/status')
      ? { status: 200, body: { status: 'COMPLETED', success: true, error: null } }
      : { status: 200, body: { video: { url: 'https://cdn.example/v.mp4' }, total_tokens: 100, units: 500 } });
    const task = await createSunraClient(config, { fetch: fetchImpl }).getTask('pd_1');
    expect(task).toMatchObject({ status: 'COMPLETED', success: true, url: 'https://cdn.example/v.mp4', billedUsd: 0.5 });
    expect(calls.map((call) => call.url)).toEqual(['https://api.sunra.ai/v1/queue/requests/pd_1/status', 'https://api.sunra.ai/v1/queue/requests/pd_1']);
  });

  it('does not ask for the result while the task is running', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: { status: 'IN_PROGRESS' } }));
    const task = await createSunraClient(config, { fetch: fetchImpl }).getTask('pd_1');
    expect(task.status).toBe('IN_PROGRESS');
    expect(calls).toHaveLength(1);
  });

  it('classifies request errors', async () => {
    const credit = fakeFetch(() => ({ status: 412, body: { error: { type: 'invalid_request_error', code: 'INSUFFICIENT_CREDIT', message: 'no balance' } } }));
    const error = await createSunraClient(config, { fetch: credit.fetchImpl }).submit('m', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SunraError);
    expect(error).toMatchObject({ code: 'INSUFFICIENT_CREDIT', accessProblem: true, retryable: false });

    const unsafe = fakeFetch(() => ({ status: 422, body: { error: { code: 'PREDICTION_UNSAFE_CONTENT', message: 'unsafe' } } }));
    await expect(createSunraClient(config, { fetch: unsafe.fetchImpl }).submit('m', {})).rejects.toMatchObject({ moderated: true, retryable: false });

    const rate = fakeFetch(() => ({ status: 429, body: {} }));
    await expect(createSunraClient(config, { fetch: rate.fetchImpl }).submit('m', {})).rejects.toMatchObject({ code: 'http_429', retryable: true });
  });

  it('turns a thrown fetch into a retryable network error without the key', async () => {
    const fetchImpl = (async () => { throw new TypeError('boom'); }) as typeof fetch;
    const error = await createSunraClient(config, { fetch: fetchImpl }).submit('m', {}).catch((e: unknown) => e) as SunraError;
    expect(error).toMatchObject({ code: 'sunra_network', retryable: true });
    expect(error.message).not.toContain('test-key');
  });
});

describe('parseSunraStatus', () => {
  it('keeps a failed prediction\'s code and retry hint', () => {
    expect(parseSunraStatus({ status: 'COMPLETED', success: false, error: { code: 'unsafe_content', message: 'no', retryable: false } })).toMatchObject({ success: false, errorCode: 'unsafe_content', errorMessage: 'no', errorRetryable: false });
  });
  it('treats an unknown status as still queued', () => {
    expect(parseSunraStatus({ status: 'NEW' }).status).toBe('IN_QUEUE');
  });
});
