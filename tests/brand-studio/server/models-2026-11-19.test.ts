import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
// @ts-expect-error -- plain Node module of the lane worker, without type declarations
import { toolCall } from '@/scripts/brand-studio-lane-mapping.mjs';
import { gptReasoningEffort } from '@/lib/brand-studio/provider/complexity';
import { markupOverlayPng, markupOverlaySvg } from '@/lib/brand-studio/provider/markup';
import { buildStudioRequest, gptMarkupEditRequest, StudioRequestError, type StudioRequestInput } from '@/lib/brand-studio/provider/requests';
import { estimateImageUsd, regionEditModels, selectableModels, studioModel, type StudioImageModel } from '@/lib/brand-studio/models';
import type { StudioJobParams } from '@/lib/brand-studio/types';

const params = (patch: Partial<StudioJobParams> = {}): StudioJobParams => ({ aspect: '4:3', resolution: '2K', seconds: null, audio: null, count: 1, locale: 'ko', ...patch });
const base = (patch: Partial<StudioRequestInput> = {}): StudioRequestInput => ({ kind: 'image', model: 'nano-banana-2.1', prompt: 'a bottle', params: params(), images: [], videos: [], ...patch });
const cents = (usd: number) => Math.round(usd * 100);

/**
 * Nano Banana 2.1 (founder 2026-11-19). The API lane's parameters are the public OpenAPI document's
 * (oapi.sunra.ai, read 2026-11-19); the request builder may send nothing else.
 */
const NB21_KEYS = {
  'text-to-image': ['prompt', 'aspect_ratio', 'resolution', 'enable_web_search', 'thinking_level'],
  'image-editing': ['prompt', 'images', 'aspect_ratio', 'resolution', 'enable_web_search', 'thinking_level'],
} as const;
const NB21_ASPECTS = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];

describe('Nano Banana 2.1 in the registry', () => {
  const nb = studioModel('nano-banana-2.1') as StudioImageModel;

  it('is offered next to Pro, with the catalogue facts of both lanes', () => {
    expect(selectableModels('image').map((m) => m.id)).toEqual(['seedream-5.5', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'nano-banana-pro', 'nano-banana-2.1']);
    expect(nb).toMatchObject({ availability: 'live', promptProfile: 'nano-banana', api: { alias: 'google/gemini-nano-banana-2.1' }, mcp: { model: 'nano-banana-2.1' }, maxReferences: 14, resolutions: ['1K', '2K', '4K'], defaultResolution: '2K' });
    for (const a of nb.aspects) expect(NB21_ASPECTS).toContain(a);
    // Partial edits stay on Seedream 5.5 (founder 2026-11-17).
    expect(regionEditModels().map((m) => m.id)).not.toContain('nano-banana-2.1');
    expect(studioModel('nano-banana-pro')).toMatchObject({ availability: 'live' });
  });

  it('sends only parameters its schema has, and never web search', () => {
    for (const images of [[], [{ url: 'https://m/1.png' }, { url: 'https://m/2.png' }]]) {
      const request = buildStudioRequest(base({ images, params: params({ aspect: '9:16', resolution: '4K' }) }));
      const name = request.endpoint.replace('google/gemini-nano-banana-2.1/', '') as keyof typeof NB21_KEYS;
      expect(Object.keys(NB21_KEYS)).toContain(name);
      for (const key of Object.keys(request.body)) expect(NB21_KEYS[name] as readonly string[], key).toContain(key);
      expect(request.body).toMatchObject({ aspect_ratio: '9:16', resolution: '4K' });
      expect(request.body).not.toHaveProperty('enable_web_search');
    }
  });

  it('the account lane gets its own id and settings', () => {
    const call = toolCall({ kind: 'image', model: 'nano-banana-2.1', prompt: 'p', params: { aspect: '3:4', resolution: '2K', quality: null, count: 1 }, inputs: [] }, 'proj');
    expect(call).toMatchObject({ tool: 'create_image', input: { model: 'nano-banana-2.1', aspect_ratio: '3:4', resolution: '2K' } });
    expect(call.input).not.toHaveProperty('reasoning_effort');
  });

  it('is quoted what the provider charges: 4 / 5 / 12 credits at 1K / 2K / 4K, whatever the references', () => {
    // Sunra price card $0.034 / $0.050 / $0.113 and the account lane's estimate_cost (2026-11-19) with 0, 1, 3 references.
    for (const references of [0, 1, 3]) {
      expect(cents(estimateImageUsd({ model: 'nano-banana-2.1', resolution: '1K', references }))).toBe(4);
      expect(cents(estimateImageUsd({ model: 'nano-banana-2.1', resolution: '2K', references }))).toBe(5);
      expect(cents(estimateImageUsd({ model: 'nano-banana-2.1', resolution: '4K', references }))).toBe(12);
    }
  });
});

describe('GPT Image 2.6 complexity (`reasoning_effort`)', () => {
  it('plans at high for text, layout, many references and edits; medium for a plain shot', () => {
    expect(gptReasoningEffort({ kind: 'image', prompt: 'a frosted bottle on marble', references: 1 })).toBe('medium');
    expect(gptReasoningEffort({ kind: 'image', prompt: '대리석 위 향수병', references: 0 })).toBe('medium');
    expect(gptReasoningEffort({ kind: 'image', prompt: '"SUMMER SALE" 큰 제목', references: 0 })).toBe('high');
    expect(gptReasoningEffort({ kind: 'image', prompt: '세로 포스터, 병 하나', references: 0 })).toBe('high');
    expect(gptReasoningEffort({ kind: 'image', prompt: 'an infographic of three steps', references: 0 })).toBe('high');
    expect(gptReasoningEffort({ kind: 'image', prompt: 'a bottle', references: 3 })).toBe('high');
    expect(gptReasoningEffort({ kind: 'region_edit', prompt: 'label', references: 1 })).toBe('high');
  });

  it('both lanes send the same value; other models send none', () => {
    const plain = buildStudioRequest(base({ model: 'gpt-image-2.6-flare', params: params({ quality: 'high' }) }));
    expect(plain.body).toMatchObject({ reasoning_effort: 'medium' });
    const poster = buildStudioRequest(base({ model: 'gpt-image-2.6-sunburst', prompt: 'A poster with "SALE" as the headline', params: params({ quality: 'high' }) }));
    expect(poster.body).toMatchObject({ reasoning_effort: 'high' });
    expect(buildStudioRequest(base({ model: 'nano-banana-pro' })).body).not.toHaveProperty('reasoning_effort');
    expect(buildStudioRequest(base({ model: 'seedream-5.5' })).body).not.toHaveProperty('reasoning_effort');
    const call = toolCall({ kind: 'image', model: 'gpt-image-2.6-flare', prompt: 'p', params: { aspect: '1:1', resolution: '1K', quality: 'medium', reasoningEffort: 'medium', count: 1 }, inputs: [] }, 'proj');
    expect(call.input).toMatchObject({ reasoning_effort: 'medium', quality: 'medium' });
  });
});

describe('GPT Image 2.6 markup edits (built and tested, not wired to a studio flow)', () => {
  it('the overlay is a transparent PNG the size of the picture with a red outline around the box', async () => {
    const png = await markupOverlayPng(1200, 1600, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
    const meta = await sharp(Buffer.from(png)).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 1200, height: 1600, hasAlpha: true });
    const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => data.slice((y * info.width + x) * 4, (y * info.width + x) * 4 + 4);
    expect([...at(10, 10)][3]).toBe(0); // outside: transparent
    expect([...at(600, 1000)][3]).toBe(0); // inside the box: transparent too
    const edge = [...at(600, 800 + 3)];
    expect(edge[0]).toBeGreaterThan(200);
    expect(edge[3]).toBeGreaterThan(200); // the outline
    expect(markupOverlaySvg(10, 10, { x: 0, y: 0, w: 1, h: 1 })).toMatch(/^<svg[^>]+width="16" height="16"/);
  });

  it('the request carries `markup` on the API lane edit endpoint, and refuses what it cannot send', () => {
    const request = gptMarkupEditRequest({ model: 'gpt-image-2.6-sunburst', prompt: 'Recolor the vase inside the red outline.', images: [{ url: 'https://m/1.png' }], markupUrl: 'https://m/markup.png', params: { resolution: '2K', aspect: '3:4', quality: 'high' } });
    expect(request.endpoint).toBe('openai/gpt-image-2.6-sunburst/image-editing');
    expect(request.body).toMatchObject({ images: ['https://m/1.png'], markup: 'https://m/markup.png', width: 1536, height: 2048, quality: 'high', reasoning_effort: 'high', output_format: 'png' });
    expect(request.body).not.toHaveProperty('mask');
    expect(() => gptMarkupEditRequest({ model: 'seedream-5.5', prompt: 'p', images: [{ url: 'https://m/1.png' }], markupUrl: 'https://m/x.png', params: { aspect: '1:1', resolution: '1K' } })).toThrow(StudioRequestError);
    expect(() => gptMarkupEditRequest({ model: 'gpt-image-2.6-flare', prompt: 'p', images: [], markupUrl: 'https://m/x.png', params: { aspect: '1:1', resolution: '1K' } })).toThrow(StudioRequestError);
    expect(() => gptMarkupEditRequest({ model: 'gpt-image-2.6-flare', prompt: 'p', images: [{ url: 'https://m/1.png' }], markupUrl: 'data:image/png;base64,AAAA', params: { aspect: '1:1', resolution: '1K' } })).toThrow(StudioRequestError);
  });
});
