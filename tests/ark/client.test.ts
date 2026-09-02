import { describe, expect, it } from 'vitest';
import {
  ARK_DEFAULT_BASE_URL,
  ARK_REAL_PERSON_CODE,
  ArkError,
  arkConfigFromEnv,
  createArkClient,
  isInputRejection,
  isTerminal,
  parseTask,
  toCreateBody,
} from '@/lib/ark/client';
import { ARK_MODELS, estimateRenderUsd, tasksForDuration } from '@/lib/ark/models';
import { missingReferences, rewriteReferenceHandles } from '@/lib/ark/prompt';

/**
 * The ModelArk boundary, driven with recorded response shapes (docs.byteplus.com, 2026-08-31).
 * There is no API key on this machine, so `fetch` is injected; the first live call is the
 * integration test and these pin what that call must look like.
 */

type Call = { url: string; init: RequestInit };

function fakeFetch(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(body === null ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const config = { apiKey: 'test-key', baseUrl: ARK_DEFAULT_BASE_URL };

describe('configuration', () => {
  it('is null without ARK_API_KEY, so the studio stays a mock', () => {
    expect(arkConfigFromEnv({})).toBeNull();
    expect(arkConfigFromEnv({ ARK_API_KEY: '   ' })).toBeNull();
  });

  it('defaults to the ap-southeast base URL and strips a trailing slash from an override', () => {
    expect(arkConfigFromEnv({ ARK_API_KEY: 'k' })).toEqual({
      apiKey: 'k',
      baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    });
    expect(
      arkConfigFromEnv({ ARK_API_KEY: 'k', ARK_BASE_URL: 'https://example.test/api/v3/' })?.baseUrl,
    ).toBe('https://example.test/api/v3');
  });

  it('never carries the key under a NEXT_PUBLIC_ name', () => {
    // A browser-visible key would be a leak, not a config option.
    expect(arkConfigFromEnv({ NEXT_PUBLIC_ARK_API_KEY: 'k' })).toBeNull();
  });
});

describe('create task', () => {
  it('POSTs the documented body with a Bearer key and returns the task id', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { id: 'cgt-20260902-abc' } }));
    const client = createArkClient(config, { fetch: fetchImpl });

    const result = await client.createVideoTask({
      model: 'seedance-2.0',
      content: [
        { type: 'text', text: 'The woman in Image 1 listens, then answers.' },
        { type: 'image_url', image_url: { url: 'asset://asset-1' }, role: 'reference_image' },
        { type: 'audio_url', audio_url: { url: 'https://cdn.example/master.wav' }, role: 'reference_audio' },
      ],
      resolution: '720p',
      ratio: '16:9',
      duration: 15,
      generateAudio: true,
      watermark: false,
    });

    expect(result).toEqual({ id: 'cgt-20260902-abc' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe('dreamina-seedance-2-0-260128');
    expect(body.generate_audio).toBe(true);
    expect(body.watermark).toBe(false);
    expect(body.content[1].role).toBe('reference_image');
    expect(body.content[2].role).toBe('reference_audio');
  });

  it('spells every optional parameter the way the API does, and omits the ones not given', () => {
    const body = toCreateBody({
      model: 'seedance-2.5',
      content: [{ type: 'text', text: 'x' }],
      outputFormat: 'mov',
      seed: 7,
      callbackUrl: 'https://twings.app/api/ark/callback',
    });
    expect(body).toEqual({
      model: ARK_MODELS['seedance-2.5'].id,
      content: [{ type: 'text', text: 'x' }],
      output_format: 'mov',
      seed: 7,
      callback_url: 'https://twings.app/api/ark/callback',
    });
    expect('resolution' in body).toBe(false);
  });

  it('turns a 4xx into a non-retryable ArkError carrying the API error code', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 400,
      body: { error: { code: 'InvalidParameter', message: 'duration out of range' } },
    }));
    const client = createArkClient(config, { fetch: fetchImpl });
    await expect(
      client.createVideoTask({ model: 'seedance-2.0', content: [{ type: 'text', text: 'x' }], duration: 99 }),
    ).rejects.toMatchObject({ name: 'ArkError', code: 'InvalidParameter', status: 400, retryable: false });
  });

  it('marks 429 and 5xx retryable, and a network failure too', async () => {
    const limited = createArkClient(config, {
      fetch: fakeFetch(() => ({ status: 429, body: { error: { code: 'RateLimitExceeded', message: '' } } })).fetchImpl,
    });
    await expect(limited.getVideoTask('cgt-1')).rejects.toMatchObject({ retryable: true, status: 429 });

    const down = createArkClient(config, {
      fetch: (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    });
    await expect(down.getVideoTask('cgt-1')).rejects.toMatchObject({ code: 'ark_network', retryable: true });
  });
});

describe('get task', () => {
  it('reads a succeeded task: video_url, usage, timestamps', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        id: 'cgt-1',
        model: 'dreamina-seedance-2-0-260128',
        status: 'succeeded',
        content: { video_url: 'https://ark-content.example/out.mp4?sig=1' },
        usage: { completion_tokens: 205920, total_tokens: 205920 },
        created_at: 1788330000,
        updated_at: 1788330180,
      },
    }));
    const task = await createArkClient(config, { fetch: fetchImpl }).getVideoTask('cgt-1');
    expect(calls[0]!.url).toBe(`${ARK_DEFAULT_BASE_URL}/contents/generations/tasks/cgt-1`);
    expect(task.status).toBe('succeeded');
    expect(task.videoUrl).toBe('https://ark-content.example/out.mp4?sig=1');
    expect(task.completionTokens).toBe(205920);
    expect(task.createdAt).toBe('2026-09-02T06:20:00.000Z');
    expect(isTerminal(task.status)).toBe(true);
  });

  /**
   * THE error TWINGS is built around: a real face in a directly-uploaded reference image is refused
   * at input. The task fails, and the UI must route the person to identity verification rather
   * than to a retry button.
   */
  it('surfaces the real-person rejection as a failed task with a recognisable code', () => {
    const task = parseTask({
      id: 'cgt-2',
      status: 'failed',
      error: {
        code: ARK_REAL_PERSON_CODE,
        message: 'The input image may contain a real person. Please replace the input.',
      },
    });
    expect(task.status).toBe('failed');
    expect(task.videoUrl).toBeNull();
    expect(isInputRejection(task.error?.code)).toBe(true);
    expect(new ArkError(ARK_REAL_PERSON_CODE, '', 400, false).inputRejected).toBe(true);
    expect(isInputRejection('RateLimitExceeded')).toBe(false);
    expect(isInputRejection(null)).toBe(false);
  });

  it('treats queued and running as non-terminal, and an unknown status as still queued', () => {
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(parseTask({ id: 'cgt-3', status: 'something-new' }).status).toBe('queued');
  });
});

describe('the price a render will cost, before it is created', () => {
  it('reproduces the pricing page examples', () => {
    // Seedance 2.0, 720p, 5 s → $0.76 per video on the page.
    expect(estimateRenderUsd({ model: 'seedance-2.0', resolution: '720p', seconds: 5 })).toMatchObject({ ok: true, usd: 0.75 });
    // The two TWINGS styles, on the engine the $4 / $7 price points can afford.
    expect(estimateRenderUsd({ model: 'seedance-2.0', resolution: '720p', seconds: 15 })).toMatchObject({ ok: true, usd: 2.25 });
    // …and on Seedance 2.5, where the 30-second film costs the sale price.
    expect(estimateRenderUsd({ model: 'seedance-2.5', resolution: '720p', seconds: 30 })).toMatchObject({ ok: true, usd: 6.93 });
    expect(estimateRenderUsd({ model: 'seedance-2.5', resolution: '1080p', seconds: 15 })).toMatchObject({ ok: true, usd: 8.54 });
  });

  it('refuses what the engine cannot do instead of pricing it', () => {
    expect(estimateRenderUsd({ model: 'seedance-2.0', resolution: '720p', seconds: 30 })).toEqual({
      ok: false,
      problem: 'duration-too-long',
      model: 'seedance-2.0',
    });
    expect(estimateRenderUsd({ model: 'seedance-2.0-fast', resolution: '1080p', seconds: 5 })).toMatchObject({
      ok: false,
      problem: 'resolution-unsupported',
    });
    expect(estimateRenderUsd({ model: 'seedance-2.5', resolution: '480p', seconds: 3 })).toMatchObject({
      ok: false,
      problem: 'duration-too-short',
    });
  });

  it('knows a 30-second film is one task on 2.5 and two on 2.0', () => {
    expect(tasksForDuration('seedance-2.5', 30)).toBe(1);
    expect(tasksForDuration('seedance-2.0', 30)).toBe(2);
    expect(tasksForDuration('seedance-2.0', 15)).toBe(1);
  });
});

describe('catalog prompt → ModelArk prompt', () => {
  it('rewrites Higgsfield @handles into positional prose and reports what it saw', () => {
    const { text, references } = rewriteReferenceHandles(
      'Use @image1 only for identity and @audio1 as master audio. Ignore @Image1 pose. Cut to @video2.',
    );
    expect(text).toBe('Use Image 1 only for identity and Audio 1 as master audio. Ignore Image 1 pose. Cut to Video 2.');
    expect(references).toEqual({ images: [1], audios: [1], videos: [2] });
  });

  it('leaves a prompt that already speaks ModelArk untouched', () => {
    const source = 'Reference Image 1 is the sole identity reference.';
    expect(rewriteReferenceHandles(source).text).toBe(source);
  });

  it('names the references a request forgot to attach', () => {
    const { references } = rewriteReferenceHandles('@image1 @image2 @audio1');
    expect(missingReferences(references, { images: 1, audios: 0, videos: 0 })).toEqual(['Image 2', 'Audio 1']);
    expect(missingReferences(references, { images: 2, audios: 1, videos: 0 })).toEqual([]);
  });
});
