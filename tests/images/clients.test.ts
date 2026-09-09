import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_ENGINES } from '@/lib/images/engines';
import { SeedreamError, createSeedreamClient, seedreamConfigFromEnv, toSeedreamBody } from '@/lib/images/seedream';
import {
  GPT_IMAGE_QUALITY,
  OpenAiImageError,
  createOpenAiImageClient,
  gptImageUsd,
  openAiConfigFromEnv,
  toEditForm,
  toGenerationBody,
} from '@/lib/images/openai';

/**
 * Both clients take `fetch` as a dependency, so the wire shape and the error vocabulary are pinned
 * here against recorded responses — the same discipline as tests/ark/client.test.ts. No key on
 * this machine is read by these tests.
 */

function fakeFetch(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      capture.init = init;
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('Seedream client (ModelArk images/generations)', () => {
  it('reads the same ModelArk key the video client uses, never a public one', () => {
    expect(seedreamConfigFromEnv({})).toBeNull();
    expect(seedreamConfigFromEnv({ ARK_API_KEY: 'k' })).toEqual({ apiKey: 'k', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3' });
  });

  it('spells the body the way the API does: explicit size, no watermark, one or many references', () => {
    const body = toSeedreamBody({ engine: 'seedream-5.0-pro', prompt: 'p', aspect: '4:5' });
    expect(body).toEqual({
      model: 'dola-seedream-5-0-pro-260628',
      prompt: 'p',
      size: '1728x2160',
      output_format: 'jpeg',
      response_format: 'url',
      watermark: false,
    });
    expect(toSeedreamBody({ engine: 'seedream-5.0-lite', prompt: 'p', aspect: '1:1', references: ['asset://a'] }).image).toBe('asset://a');
    expect(toSeedreamBody({ engine: 'seedream-5.0-lite', prompt: 'p', aspect: '1:1', references: ['asset://a', 'https://x/b.png'] }).image).toEqual(['asset://a', 'https://x/b.png']);
    expect(() => toSeedreamBody({ engine: 'seedream-5.0-pro', prompt: 'p', aspect: '1:1', references: new Array(11).fill('asset://a') })).toThrow(RangeError);
  });

  it('returns the url, the size and the usage of a finished image', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createSeedreamClient(
      { apiKey: 'k', baseUrl: 'https://ark.test/api/v3' },
      fakeFetch(200, { model: 'dola-seedream-5-0-pro-260628', data: [{ url: 'https://cdn/x.jpg', size: '1728x2160', output_format: 'jpeg' }], usage: { input_images: 1, generated_images: 1, output_tokens: 4096, total_tokens: 4096 } }, capture),
    );
    const result = await client.generate({ engine: 'seedream-5.0-pro', prompt: 'p', aspect: '4:5', references: ['asset://a'] });
    expect(capture.url).toBe('https://ark.test/api/v3/images/generations');
    expect((capture.init?.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(result.images[0]).toEqual({ url: 'https://cdn/x.jpg', b64: null, size: '1728x2160', outputFormat: 'jpeg' });
    expect(result.usage).toEqual({ inputImages: 1, generatedImages: 1, outputTokens: 4096 });
  });

  it('names the two refusals the UI has to answer differently', async () => {
    const denied = createSeedreamClient({ apiKey: 'k', baseUrl: 'https://ark.test' }, fakeFetch(403, { error: { code: 'AccessDenied', message: 'no access. Request id: 0217' } }));
    await expect(denied.generate({ engine: 'seedream-5.0-pro', prompt: 'p', aspect: '1:1' })).rejects.toMatchObject({ code: 'AccessDenied', accessProblem: true, inputRejected: false, requestId: '0217' });
    const face = createSeedreamClient({ apiKey: 'k', baseUrl: 'https://ark.test' }, fakeFetch(400, { error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'may contain a real person' } }));
    await expect(face.generate({ engine: 'seedream-5.0-pro', prompt: 'p', aspect: '1:1', references: ['https://x/face.jpg'] })).rejects.toSatisfy((error: unknown) => error instanceof SeedreamError && error.inputRejected && !error.accessProblem);
  });
});

describe('GPT Image client (OpenAI images: 2.5 Flare · 2.5 Sunburst · 2)', () => {
  it('reads OPENAI_API_KEY only', () => {
    expect(openAiConfigFromEnv({})).toBeNull();
    expect(openAiConfigFromEnv({ OPENAI_API_KEY: 'sk' })).toEqual({ apiKey: 'sk', baseUrl: 'https://api.openai.com/v1' });
  });

  it('renders at the engine table’s tier — gpt-image-2 at high (the default until the org is verified), and nothing in the product can lower it', () => {
    expect(GPT_IMAGE_QUALITY).toBe('high');
    const body = toGenerationBody({ engine: 'gpt-image-2', prompt: 'p', aspect: '4:5' });
    expect(body).toEqual({ model: 'gpt-image-2', prompt: 'p', size: '1024x1280', quality: 'high', output_format: 'png', moderation: 'auto', n: 1 });
    expect(toGenerationBody({ prompt: 'p', aspect: '4:5' })).toMatchObject({ model: 'gpt-image-2', quality: 'high' });
    expect(toGenerationBody({ engine: 'gpt-image-2.5-flare', prompt: 'p', aspect: '4:5' })).toMatchObject({ model: 'gpt-image-2.5-flare', quality: IMAGE_ENGINES['gpt-image-2.5-flare'].quality });
    expect(toGenerationBody({ engine: 'gpt-image-2.5-sunburst', prompt: 'p', aspect: '1:1' })).toMatchObject({ model: 'gpt-image-2.5-sunburst', size: '1024x1024', quality: IMAGE_ENGINES['gpt-image-2.5-sunburst'].quality });
    // The override exists for the smoke script's measurements; the render pass never names a quality.
    expect(toGenerationBody({ engine: 'gpt-image-2.5-flare', prompt: 'p', aspect: '4:5', quality: 'max' })).toMatchObject({ quality: 'max' });
    expect(readFileSync(join(process.cwd(), 'lib', 'renders', 'engines.ts'), 'utf8')).not.toMatch(/quality\s*:/);
  });

  it('sends the visitor photo as an edit reference — and never the gpt-image-1 fidelity flag', () => {
    const form = toEditForm({ engine: 'gpt-image-2', prompt: 'p', aspect: '9:16', references: [{ bytes: new Uint8Array([137, 80, 78, 71]), mime: 'image/png' }] });
    expect(form.get('model')).toBe('gpt-image-2');
    expect(form.get('quality')).toBe('high');
    expect(form.get('input_fidelity')).toBeNull();
    expect(form.get('size')).toBe('864x1536');
    const image = form.get('image[]');
    expect(image).toBeInstanceOf(Blob);
    expect((image as Blob).type).toBe('image/png');
    expect(() => toEditForm({ prompt: 'p', aspect: '1:1', references: [] })).toThrow(RangeError);
  });

  it('books the render from the usage counters at the published token prices', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createOpenAiImageClient(
      { apiKey: 'sk', baseUrl: 'https://openai.test/v1' },
      fakeFetch(200, { created: 1, data: [{ b64_json: 'AAAA' }], usage: { input_tokens: 2100, output_tokens: 6240, input_tokens_details: { image_tokens: 2000, text_tokens: 100 } } }, capture),
    );
    const result = await client.edit({ engine: 'gpt-image-2', prompt: 'p', aspect: '4:5', references: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' }] });
    expect(capture.url).toBe('https://openai.test/v1/images/edits');
    expect(result.quality).toBe('high');
    expect(result.b64).toBe('AAAA');
    expect(result.size).toBe('1024x1280');
    expect(result.usd).toBe(gptImageUsd({ inputImageTokens: 2000, inputTextTokens: 100, outputTokens: 6240 }));
    // 2000×8 + 100×5 + 6240×30 = 16,000 + 500 + 187,200 = 203,700 µ$ → $0.2037
    expect(result.usd).toBe(0.2037);
  });

  it('names a policy refusal so the UI does not offer a retry', async () => {
    const client = createOpenAiImageClient({ apiKey: 'sk', baseUrl: 'https://openai.test/v1' }, fakeFetch(400, { error: { message: 'Your request was rejected by the safety system', code: 'moderation_blocked', type: 'invalid_request_error' } }));
    await expect(client.generate({ prompt: 'p', aspect: '1:1' })).rejects.toSatisfy((error: unknown) => error instanceof OpenAiImageError && error.moderated && !error.auth);
  });
});
