import { describe, expect, it, vi } from 'vitest';
import { createPremiumEditClient, PremiumEditFailure, premiumEditConfigFromEnv } from '@/lib/premium-editing/provider';

const response = (content: unknown[], extra: object = {}) => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content }], usage: { input_tokens: 240, input_tokens_details: { cached_tokens: 20 }, output_tokens: 30 }, ...extra }), { status: 200 });
const input = { renderId: '00000000-0000-4000-8000-000000000001', basePrompt: 'PRIVATE RECIPE camera timing identity', requestText: 'Make the shirt blue', allowedScopes: ['wardrobe_color'] as const, references: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' as const }] };

describe('private GPT 5.6 Responses adapter', () => {
  it('sends only bounded JSON schema, store false, resized reference bytes and capped output', async () => {
    const doFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response([{ type: 'output_text', text: JSON.stringify({ approved: true, refusal: 'none', changes: [{ scope: 'wardrobe_color', value: 'blue' }] }) }]));
    const client = createPremiumEditClient({ apiKey: 'fake-key', model: 'gpt-5.6-sol' }, { fetch: doFetch });
    const result = await client.prepare(input);
    const request = JSON.parse(String(doFetch.mock.calls[0]![1]!.body));
    expect(doFetch.mock.calls[0]![0]).toBe('https://api.openai.com/v1/responses');
    expect(request).toMatchObject({ model: 'gpt-5.6-sol', store: false, max_output_tokens: 600, reasoning: { effort: 'none' }, text: { format: { type: 'json_schema', strict: true } } });
    expect(request.input[1].content[1]).toMatchObject({ type: 'input_image', detail: 'low', image_url: 'data:image/jpeg;base64,AQID' });
    expect(request).not.toHaveProperty('tools');
    expect(JSON.stringify(request)).not.toContain('PRIVATE RECIPE');
    expect(result).toMatchObject({ plan: { changes: [{ scope: 'wardrobe_color', value: 'blue' }] }, usage: { inputTokens: 240, cachedInputTokens: 20, outputTokens: 30 }, model: 'gpt-5.6-sol' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('rejects refusal, malformed/leaking output and never places provider bodies into errors', async () => {
    const bodies = [response([{ type: 'refusal', refusal: 'PRIVATE RECIPE' }]), response([{ type: 'output_text', text: JSON.stringify({ approved: true, refusal: 'none', changes: [], prompt: 'PRIVATE RECIPE' }) }]), new Response(JSON.stringify({ error: { message: 'PRIVATE RECIPE' } }), { status: 403 })];
    for (const body of bodies) {
      const client = createPremiumEditClient({ apiKey: 'fake-key', model: 'gpt-5.6-sol' }, { fetch: async () => body });
      let failure: unknown;
      try { await client.prepare(input); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(PremiumEditFailure);
      expect(String(failure)).not.toContain('PRIVATE');
      if (body.status === 200) expect((failure as PremiumEditFailure).telemetry?.usage).toEqual({ inputTokens: 240, cachedInputTokens: 20, outputTokens: 30 });
    }
  });

  it('preserves the named GPT 5.6 family and requires an actual server key', () => {
    expect(premiumEditConfigFromEnv({})).toBeNull();
    expect(premiumEditConfigFromEnv({ OPENAI_API_KEY: 'fake' })).toEqual({ apiKey: 'fake', model: 'gpt-5.6-sol' });
    expect(premiumEditConfigFromEnv({ OPENAI_API_KEY: 'fake', PREMIUM_EDIT_MODEL: 'gpt-6-astra' })).toBeNull();
  });
});
