import { describe, expect, it } from 'vitest';
import { IMAGE_ENGINES } from '@/lib/images/engines';
import {
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_IMAGE_SIZE,
  GeminiImageError,
  createGeminiImageClient,
  geminiConfigFromEnv,
  geminiImageUsd,
  geminiOutputImage,
  toGeminiBody,
} from '@/lib/images/gemini';

/**
 * The Gemini image boundary (Interactions API), pinned against the shapes in the official guide
 * and OpenAPI spec (2026-10-24). No key on this machine: `fetch` is injected, and the first live
 * call is `npm run gemini:smoke`.
 */

function fakeFetch(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      capture.init = init;
    }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg' as const };
const config = { apiKey: 'g-key', baseUrl: GEMINI_DEFAULT_BASE_URL, model: 'gemini-nano-banana-2.1' };

describe('Gemini image client (Nano Banana 2.1 via /interactions)', () => {
  it('reads GEMINI_API_KEY only and lets GEMINI_IMAGE_MODEL rename the wire model', () => {
    expect(geminiConfigFromEnv({})).toBeNull();
    expect(geminiConfigFromEnv({ GEMINI_API_KEY: 'g' })).toEqual({ apiKey: 'g', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-nano-banana-2.1' });
    expect(geminiConfigFromEnv({ GEMINI_API_KEY: 'g', GEMINI_IMAGE_MODEL: 'gemini-nano-banana-3' })?.model).toBe('gemini-nano-banana-3');
    expect(geminiConfigFromEnv({ GEMINI_API_KEY: 'g', GEMINI_IMAGE_MODEL: 'not a model!' })?.model).toBe('gemini-nano-banana-2.1');
    expect(geminiConfigFromEnv({ GEMINI_API_KEY: 'g', GEMINI_BASE_URL: 'https://proxy.test/v1beta/' })?.baseUrl).toBe('https://proxy.test/v1beta');
  });

  it('spells the body the way the guide does: text then inline images, a JPEG at the table’s aspect and 2K', () => {
    expect(toGeminiBody({ prompt: 'p', aspect: '4:5', references: [PHOTO] }, 'gemini-nano-banana-2.1')).toEqual({
      model: 'gemini-nano-banana-2.1',
      input: [{ type: 'text', text: 'p' }, { type: 'image', mime_type: 'image/jpeg', data: '/9j/' }],
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '4:5', image_size: GEMINI_IMAGE_SIZE },
    });
    expect((toGeminiBody({ prompt: 'p', aspect: '1:1' }, 'm').input as unknown[]).length).toBe(1);
    expect(() => toGeminiBody({ prompt: 'p', aspect: '1:1', references: new Array(IMAGE_ENGINES['nano-banana-2.1'].maxReferenceImages + 1).fill(PHOTO) }, 'm')).toThrow(RangeError);
  });

  it('returns the last image the model produced, the usage and the booked price', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createGeminiImageClient(config, fakeFetch(200, {
      id: 'int-1', status: 'completed',
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'p' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'Here you go' }, { type: 'image', mime_type: 'image/jpeg', data: 'QUJD' }] },
      ],
      usage: { total_input_tokens: 1400, total_output_tokens: 1680, output_tokens_by_modality: [{ modality: 'image', tokens: 1680 }] },
    }, capture));
    const result = await client.generate({ prompt: 'p', aspect: '4:5', references: [PHOTO] });
    expect(capture.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect((capture.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(result).toEqual({
      b64: 'QUJD', mime: 'image/jpeg', size: '1856x2304', interactionId: 'int-1',
      usage: { inputTokens: 1400, outputTokens: 1680, outputImageTokens: 1680 },
      usd: geminiImageUsd('nano-banana-2.1', { inputTokens: 1400 }),
    });
    // $0.0504 per 2K image + 1,400 input tokens at $1.50/M.
    expect(result.usd).toBeCloseTo(0.0504 + 0.0021, 4);
    expect(geminiOutputImage({ output_image: { data: 'Zm9v' } })).toEqual({ data: 'Zm9v', mime: 'image/jpeg' });
    expect(geminiOutputImage({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'no' }] }] })).toBeNull();
  });

  it('names the refusals the pass has to answer differently', async () => {
    const denied = createGeminiImageClient(config, fakeFetch(403, { error: { code: 403, message: 'PERMISSION_DENIED: key not valid', status: 'PERMISSION_DENIED' } }));
    await expect(denied.generate({ prompt: 'p', aspect: '1:1' })).rejects.toSatisfy((error: unknown) => error instanceof GeminiImageError && error.auth && !error.moderated && error.code === '403');
    const blocked = createGeminiImageClient(config, fakeFetch(400, { error: { code: 400, message: 'The request was blocked by safety filters (PROHIBITED_CONTENT)', status: 'INVALID_ARGUMENT' } }));
    await expect(blocked.generate({ prompt: 'p', aspect: '1:1' })).rejects.toSatisfy((error: unknown) => error instanceof GeminiImageError && error.moderated && !error.auth && !error.retryable);
    const noImage = createGeminiImageClient(config, fakeFetch(200, { id: 'int-2', status: 'incomplete', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot create that image.' }] }] }));
    await expect(noImage.generate({ prompt: 'p', aspect: '1:1' })).rejects.toMatchObject({ interactionStatus: 'incomplete', moderated: true, status: 200 });
    const failed = createGeminiImageClient(config, fakeFetch(200, { id: 'int-3', status: 'failed', steps: [], errors: [{ code: 'safety', message: 'Image generation blocked: the input image depicts a real person' }] }));
    await expect(failed.generate({ prompt: 'p', aspect: '1:1' })).rejects.toMatchObject({ code: 'safety', message: expect.stringContaining('real person'), moderated: true });
    const throttled = createGeminiImageClient(config, fakeFetch(429, { error: { code: 429, message: 'RESOURCE_EXHAUSTED', status: 'RESOURCE_EXHAUSTED' } }));
    await expect(throttled.generate({ prompt: 'p', aspect: '1:1' })).rejects.toMatchObject({ retryable: true, moderated: false });
    const garbage = createGeminiImageClient(config, fakeFetch(502, '<html>bad gateway</html>'));
    await expect(garbage.generate({ prompt: 'p', aspect: '1:1' })).rejects.toMatchObject({ status: 502, retryable: true });
  });
});
