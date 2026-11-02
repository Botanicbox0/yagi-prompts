import { describe, expect, it } from 'vitest';
import {
  KLING_DEFAULT_BASE_URL,
  KlingError,
  createKlingClient,
  isKlingPolicyCode,
  isKlingTerminal,
  klingConfigFromEnv,
  parseKlingTask,
  toKlingBody,
  toKlingImageUrl,
  toKlingPrompt,
} from '@/lib/kling/client';
import { DEFAULT_KLING_MODEL, KLING_MODELS, clampKlingDuration, estimateKlingUsd, klingModelFromEnv, klingModelId } from '@/lib/kling/models';

/**
 * The Kling boundary, driven with the response shapes the official docs publish (kling.ai/document-api,
 * read 2026-10-24). There is no key on this machine, so `fetch` is injected; the first live call is
 * `npm run kling:smoke` and these pin what that call must look like.
 */

type Call = { url: string; init: RequestInit };

function fakeFetch(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const config = { apiKey: 'test-key', baseUrl: KLING_DEFAULT_BASE_URL, model: 'kling-3.0-omni' as const, modelId: 'kling-3.0-omni' };

describe('configuration (the model is configuration, not code)', () => {
  it('reads KLING_API_KEY only, defaults to the Singapore host and 3.0 Omni', () => {
    expect(klingConfigFromEnv({})).toBeNull();
    expect(klingConfigFromEnv({ KLING_API_KEY: '  ' })).toBeNull();
    expect(klingConfigFromEnv({ KLING_API_KEY: 'k' })).toEqual({ apiKey: 'k', baseUrl: 'https://api-singapore.klingai.com', model: 'kling-3.0-omni', modelId: 'kling-3.0-omni' });
    expect(klingConfigFromEnv({ KLING_API_KEY: 'k', KLING_BASE_URL: 'https://proxy.test/' })?.baseUrl).toBe('https://proxy.test');
  });

  it('switches to 4.0 by KLING_VIDEO_MODEL, lets KLING_VIDEO_MODEL_ID rename the path segment, ignores nonsense', () => {
    expect(klingModelFromEnv({})).toBe(DEFAULT_KLING_MODEL);
    expect(klingModelFromEnv({ KLING_VIDEO_MODEL: 'kling-4.0' })).toBe('kling-4.0');
    expect(klingModelFromEnv({ KLING_VIDEO_MODEL: 'kling-9' })).toBe('kling-3.0-omni');
    expect(klingModelId('kling-4.0', {})).toBe('kling-4.0');
    expect(klingModelId('kling-4.0', { KLING_VIDEO_MODEL_ID: 'kling-4.0-omni' })).toBe('kling-4.0-omni');
    expect(klingModelId('kling-4.0', { KLING_VIDEO_MODEL_ID: 'not a path/segment' })).toBe('kling-4.0');
    expect(klingConfigFromEnv({ KLING_API_KEY: 'k', KLING_VIDEO_MODEL: 'kling-4.0' })).toMatchObject({ model: 'kling-4.0', modelId: 'kling-4.0' });
  });

  it('carries the official limits and audio rates (PLATFORM-2.0 §9.1)', () => {
    expect(KLING_MODELS['kling-3.0-omni']).toMatchObject({ minDurationSeconds: 3, maxDurationSeconds: 15, aspects: ['16:9', '9:16', '1:1'], maxReferenceImages: 7 });
    expect(KLING_MODELS['kling-4.0']).toMatchObject({ minDurationSeconds: 3, maxDurationSeconds: 30, maxReferenceImages: 10 });
    expect(estimateKlingUsd({ model: 'kling-3.0-omni', resolution: '720p', seconds: 10 })).toBeCloseTo(1.12, 6);
    expect(estimateKlingUsd({ model: 'kling-3.0-omni', resolution: '1080p', seconds: 5 })).toBeCloseTo(0.7, 6);
    expect(estimateKlingUsd({ model: 'kling-4.0', resolution: '720p', seconds: 10 })).toBeCloseTo(1.57, 6);
    expect(estimateKlingUsd({ model: 'kling-3.0-omni', resolution: '720p', seconds: 20 })).toBeNull();
    expect(clampKlingDuration('kling-3.0-omni', 30)).toBe(15);
    expect(clampKlingDuration('kling-4.0', 30)).toBe(30);
    expect(clampKlingDuration('kling-3.0-omni', 1.2)).toBe(3);
  });
});

describe('request body', () => {
  it('spells the pass prose as Kling handles and numbers references in order', () => {
    expect(toKlingPrompt('Image 1 walks through Image 2 while Video 1 plays. Image 10 too.')).toBe('@image_1 walks through @image_2 while @video_1 plays. @image_10 too.');
    expect(toKlingImageUrl('data:image/jpeg;base64,AAAA')).toBe('AAAA');
    expect(toKlingImageUrl('https://store.test/a.jpg')).toBe('https://store.test/a.jpg');
    const body = toKlingBody(
      {
        prompt: 'Image 1 shows the person. They enter Image 2.',
        references: [{ type: 'image', url: 'data:image/png;base64,QUJD' }, { type: 'image', url: 'https://store.test/scene.jpg' }],
        resolution: '720p',
        aspect: '9:16',
        duration: 5,
      },
      'kling-3.0-omni',
    );
    expect(body).toEqual({
      contents: [
        { type: 'prompt', text: '@image_1 shows the person. They enter @image_2.' },
        { type: 'refer_image', url: 'QUJD', id: 'image_1' },
        { type: 'refer_image', url: 'https://store.test/scene.jpg', id: 'image_2' },
      ],
      settings: { audio: 'native', multi_shot: false, resolution: '720p', aspect_ratio: '9:16', duration: 5 },
      options: { watermark_info: { enabled: false } },
    });
  });

  it('refuses more references than the model takes, and a second film', () => {
    const images = new Array(8).fill({ type: 'image', url: 'https://x/a.jpg' });
    expect(() => toKlingBody({ prompt: 'p', references: images }, 'kling-3.0-omni')).toThrow(RangeError);
    expect(() => toKlingBody({ prompt: 'p', references: images }, 'kling-4.0')).not.toThrow();
    expect(() => toKlingBody({ prompt: 'p', references: [{ type: 'video', url: 'https://x/a.mp4' }, { type: 'video', url: 'https://x/b.mp4' }] }, 'kling-3.0-omni')).toThrow(RangeError);
    const withFilm = toKlingBody({ prompt: 'Video 1', references: [{ type: 'video', url: 'https://x/a.mp4' }], callbackUrl: 'https://twings.test/cb', externalTaskId: 'job-1' }, 'kling-3.0-omni');
    expect(withFilm.contents).toEqual([{ type: 'prompt', text: '@video_1' }, { type: 'feature_video', url: 'https://x/a.mp4', id: 'video_1' }]);
    expect(withFilm.options).toEqual({ watermark_info: { enabled: false }, callback_url: 'https://twings.test/cb', external_task_id: 'job-1' });
  });
});

describe('task shape', () => {
  it('reads the finished task: the video url, its duration and a USD cash deduction', () => {
    const task = parseKlingTask({
      id: '893605946402811985', status: 'succeeded', message: '', create_time: 1781080778802, update_time: 1781080794151,
      outputs: [{ type: 'video', id: 'v1', url: 'https://cdn.kling/out.mp4', watermark_url: 'https://cdn.kling/wm.mp4', duration: '5.0' }],
      billing: [{ charge_type: 'cash', cash_type: 'balance', amount: '0.56', currency: 'USD', list_price: '0.56' }],
    });
    expect(task).toEqual({
      id: '893605946402811985', status: 'succeeded', message: null, videoUrl: 'https://cdn.kling/out.mp4', durationSeconds: 5,
      billedUsd: 0.56, createdAt: '2026-06-10T08:39:38.802Z', updatedAt: '2026-06-10T08:39:54.151Z',
    });
    expect(isKlingTerminal('succeeded')).toBe(true);
    expect(isKlingTerminal('processing')).toBe(false);
    expect(isKlingTerminal('submitted')).toBe(false);
  });

  it('keeps a CNY or unit deduction out of the USD figure and a failed task’s message', () => {
    const task = parseKlingTask({ id: 't', status: 'failed', message: 'Trigger the platform content risk control', outputs: [], billing: [{ charge_type: 'unit', amount: '12', package_type: 'video' }] });
    expect(task).toMatchObject({ status: 'failed', message: 'Trigger the platform content risk control', videoUrl: null, billedUsd: null });
    expect(parseKlingTask({ id: 't', status: 'succeeded', outputs: [{ type: 'video', url: 'https://x/a.mp4' }], billing: [{ charge_type: 'cash', amount: '3.9', currency: 'CNY' }] }).billedUsd).toBeNull();
    expect(() => parseKlingTask({ status: 'succeeded' })).toThrow(KlingError);
  });
});

describe('client', () => {
  it('creates a task on the configured model path with the bearer key, and polls /tasks by id', async () => {
    const { fetchImpl, calls } = fakeFetch(({ url }) =>
      url.includes('/omni-video/')
        ? { status: 200, body: { code: 0, message: 'ok', request_id: 'r1', data: { id: 'task-1', status: 'submitted' } } }
        : { status: 200, body: { code: 0, message: 'ok', request_id: 'r2', data: [{ id: 'task-1', status: 'processing', outputs: [] }] } },
    );
    const client = createKlingClient({ ...config, model: 'kling-4.0', modelId: 'kling-4.0' }, { fetch: fetchImpl });
    expect(client.model).toBe('kling-4.0');
    expect(await client.createVideoTask({ prompt: 'p', duration: 5, aspect: '9:16', resolution: '720p' })).toEqual({ id: 'task-1' });
    expect(calls[0]!.url).toBe('https://api-singapore.klingai.com/omni-video/kling-4.0');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ contents: [{ type: 'prompt', text: 'p' }], settings: { duration: 5, aspect_ratio: '9:16', resolution: '720p', audio: 'native' } });
    expect(await client.getVideoTask('task-1')).toMatchObject({ id: 'task-1', status: 'processing' });
    expect(calls[1]!.url).toBe('https://api-singapore.klingai.com/tasks?task_ids=task-1');
    expect(calls[1]!.init.method).toBe('GET');
  });

  it('turns the service codes into the vocabulary the pass reads: policy, access, rate, server', async () => {
    const codes = [
      [400, 1301, { moderated: true, accessProblem: false, retryable: false }],
      [400, 1300, { moderated: true, accessProblem: false, retryable: false }],
      [401, 1002, { moderated: false, accessProblem: true, retryable: false }],
      [429, 1101, { moderated: false, accessProblem: true, retryable: true }],
      [403, 1103, { moderated: false, accessProblem: true, retryable: false }],
      [429, 1302, { moderated: false, accessProblem: false, retryable: true }],
      [400, 1201, { moderated: false, accessProblem: false, retryable: false }],
      [503, 5001, { moderated: false, accessProblem: false, retryable: true }],
    ] as const;
    for (const [status, code, expected] of codes) {
      const { fetchImpl } = fakeFetch(() => ({ status, body: { code, message: `code ${code}`, request_id: 'r' } }));
      const client = createKlingClient(config, { fetch: fetchImpl });
      await expect(client.createVideoTask({ prompt: 'p' })).rejects.toSatisfy((error: unknown) =>
        error instanceof KlingError && error.code === String(code) && error.serviceCode === code && error.requestId === 'r' &&
        error.moderated === expected.moderated && error.accessProblem === expected.accessProblem && error.retryable === expected.retryable,
      );
    }
    expect(isKlingPolicyCode(1301)).toBe(true);
    expect(isKlingPolicyCode(1302)).toBe(false);
  });

  it('reports a non-zero code inside a 200, a bare HTTP failure and a network failure', async () => {
    const inBody = createKlingClient(config, { fetch: fakeFetch(() => ({ status: 200, body: { code: 1201, message: 'duration must be 3-15' } })).fetchImpl });
    await expect(inBody.createVideoTask({ prompt: 'p', duration: 2 })).rejects.toMatchObject({ code: '1201', status: 200, retryable: false });
    const bare = createKlingClient(config, { fetch: fakeFetch(() => ({ status: 502, body: null })).fetchImpl });
    await expect(bare.getVideoTask('t')).rejects.toMatchObject({ code: 'http_502', retryable: true });
    const offline = createKlingClient(config, { fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await expect(offline.getVideoTask('t')).rejects.toMatchObject({ code: 'kling_network', retryable: true });
    const empty = createKlingClient(config, { fetch: fakeFetch(() => ({ status: 200, body: { code: 0, data: {} } })).fetchImpl });
    await expect(empty.createVideoTask({ prompt: 'p' })).rejects.toMatchObject({ code: 'kling_malformed_task', retryable: false });
  });
});
