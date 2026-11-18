import { describe, expect, it } from 'vitest';
import { enhanceMeta, enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { buildSystemInstruction, CORE_HEADER, MODEL_BLOCKS, PROFILE_BLOCKS, PROFILE_HEADERS, profileVersionOf } from '@/lib/brand-studio/enhancer/profiles';
import { listReferenceMentions } from '@/lib/brand-studio/enhancer/mentions';
import { bindReferences, mapCustomerMentions } from '@/lib/brand-studio/enhancer/references';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';
import { ENV, input, mockGemini, sentBody } from './helpers';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('every profile says what it is, what it rests on and when it was checked', () => {
  it('headers carry a version, target models, dated sources with a claim, and lastVerified', () => {
    const headers = [CORE_HEADER, ...Object.values(PROFILE_HEADERS), ...Object.values(MODEL_BLOCKS).map((b) => b.header)];
    for (const h of headers) {
      expect(h.version, h.id).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      expect(h.lastVerified, h.id).toMatch(DATE);
      expect(h.models.length, h.id).toBeGreaterThan(0);
      expect(h.sources.length, h.id).toBeGreaterThan(0);
      for (const s of h.sources) {
        expect(s.seen, `${h.id} ${s.url}`).toMatch(DATE);
        expect(s.claim.length, `${h.id} ${s.url}`).toBeGreaterThan(10);
        expect(s.claim, `${h.id} ${s.url}`).toMatch(/\[(?:official|aggregator|house|founder: \d{4}-\d{2}-\d{2})\]/);
      }
    }
  });

  it('every image model in the registry is covered by a family header and every model block names its model', () => {
    for (const m of STUDIO_MODELS) expect(PROFILE_HEADERS[m.promptProfile].models.includes(m.id) || m.id === 'seedream-5-flash' || m.medium === 'video', m.id).toBe(true);
    for (const [id, block] of Object.entries(MODEL_BLOCKS)) expect(block.header.models).toContain(id);
  });

  it('records the family and the model block versions', () => {
    expect(profileVersionOf('seedream', 'seedream-5.5')).toBe('seedream@2026-11-19.1');
    expect(profileVersionOf('nano-banana', 'nano-banana-2.1')).toBe('nano-banana@2026-11-19.1+nano-banana-2.1@2026-11-19.1');
    expect(profileVersionOf('gpt-image', 'gpt-image-2.6-sunburst')).toBe('gpt-image@2026-11-19.1+gpt-image-2.6@2026-11-19.1');
    expect(profileVersionOf('nano-banana')).toBe('nano-banana@2026-11-19.1');
  });
});

describe('lookup by model id first, then by family', () => {
  const nb = (model?: string): EnhanceInput => input({ profile: 'nano-banana', ...(model ? { model } : {}), prompt: '이미지 1 병을 대리석 위에', references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }] });
  const system = (i: EnhanceInput) => buildSystemInstruction(i, bindReferences(i), null, []);

  it('Nano Banana 2.1 and Pro each get their own block after the family block', () => {
    expect(system(nb('nano-banana-2.1'))).toContain(MODEL_BLOCKS['nano-banana-2.1']!.text);
    expect(system(nb('nano-banana-2.1'))).not.toContain(MODEL_BLOCKS['nano-banana-pro']!.text);
    expect(system(nb('nano-banana-pro'))).toContain(MODEL_BLOCKS['nano-banana-pro']!.text);
    expect(system(nb())).toContain(PROFILE_BLOCKS['nano-banana']);
    expect(system(nb())).not.toContain('This model:');
  });

  it('GPT Image 2.6 gets the layout block; the markup rule only when a markup is sent', () => {
    const g = input({ profile: 'gpt-image', model: 'gpt-image-2.6-flare', prompt: '"SUMMER SALE" 포스터' });
    expect(buildSystemInstruction(g, bindReferences(g), null, [])).toMatch(/plans a layout before it renders/);
    expect(buildSystemInstruction(g, bindReferences(g), null, [])).not.toMatch(/red outline/);
    expect(buildSystemInstruction(g, bindReferences(g), null, [], { markup: true })).toMatch(/the area inside the red outline/);
  });
});

describe('rule wording (2026-11-19)', () => {
  it('Seedream: Image N, a use-case phrase, "no other text", the 200-word ceiling', () => {
    const s = PROFILE_BLOCKS.seedream;
    expect(s).toMatch(/"Image N" \(a capital I/);
    expect(s).not.toMatch(/Figure/);
    expect(s).toMatch(/what the picture is for/);
    expect(s).toMatch(/followed by "no other text"/);
    expect(s).toMatch(/up to 200 words when there are three or more references/);
  });

  it('Nano Banana: positive phrasing, the logo sentence included, intent, up to eight sentences', () => {
    const s = PROFILE_BLOCKS['nano-banana'];
    expect(s).toMatch(/in positive words/);
    expect(s).toMatch(/reproduce the mark from image N exactly as drawn/);
    expect(s).not.toMatch(/do not redraw/);
    expect(s).toMatch(/what the picture is for/);
    expect(s).toMatch(/up to eight when three or more images are attached/);
  });

  it('GPT Image: photorealistic photograph, framing / gaze / hands, spelling of unusual words', () => {
    const s = PROFILE_BLOCKS['gpt-image'];
    expect(s).toMatch(/call it a photorealistic photograph/);
    expect(s).toMatch(/where they look, what their hands do and what they touch/);
    expect(s).toMatch(/letter by letter/);
  });
});

describe('Seedream references read "Image N"; "Figure N" still works', () => {
  const seed = (prompt: string): EnhanceInput =>
    input({ prompt, references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }, { index: 2, kind: 'image', label: '이미지 2', role: 'style' }] });

  it('the customer may type 이미지 N, image N or Figure N: all bind to Image N', () => {
    for (const typed of ['이미지 1의 병을 이미지 2의 빛으로', 'image 1의 병을 image 2의 빛으로', 'Figure 1의 병을 Figure 2의 빛으로', 'Image 1의 병을 Image 2의 빛으로']) {
      const i = seed(typed);
      expect(mapCustomerMentions(typed, bindReferences(i).bound), typed).toBe('Image 1의 병을 Image 2의 빛으로');
      expect(listReferenceMentions(typed).map((m) => m.number), typed).toEqual([1, 2]);
    }
  });

  it('an answer written with "Figure N" is the same reference: checked and sent as "Image N"', async () => {
    const fetchMock = mockGemini({ prompt: 'The frosted bottle from Figure 1 stands on marble; keep the exact label, cap, proportions and colours of Figure 1, lit like Figure 2, a product photo for a feed post.', notes: '병을 구체적으로 적었어요.' });
    const result = await enhancePrompt(seed('이미지 1의 병을 이미지 2의 빛으로'), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('model');
    expect(result.prompt).not.toMatch(/Figure/);
    expect(result.prompt).toMatch(/from Image 1 .* colours of Image 1, lit like Image 2/);
    const payload = JSON.parse((sentBody(fetchMock).contents[0]!.parts[0] as { text: string }).text);
    expect(payload.request).toBe('Image 1의 병을 Image 2의 빛으로');
  });
});

describe('what a job records about its prompt', () => {
  it('model answer: profile versions, the writer, the skin plan', async () => {
    const fetchMock = mockGemini({ prompt: 'The frosted bottle in image 1 on white marble, a product photo for a shop page. Keep its exact label and colours.', notes: '구체적으로 적었어요.' });
    const i = input({ profile: 'nano-banana', model: 'nano-banana-2.1', prompt: '이미지 1 병을 대리석 위에', references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }] });
    const result = await enhancePrompt(i, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.meta).toEqual({
      profile: 'nano-banana',
      profileVersion: 'nano-banana@2026-11-19.1+nano-banana-2.1@2026-11-19.1',
      coreVersion: 'core@2026-11-19.1',
      llmModel: 'gemini-4-hydrogen',
      source: 'model',
      skinMode: 'off',
      toneMatch: false,
    });
  });

  it('fallback: the reason, no writer; a timeout reads as one', async () => {
    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    const fetchMock = mockGemini(() => {
      throw abort;
    });
    const result = await enhancePrompt(input({ model: 'seedream-5.5', prompt: '모델이 크림을 바르는 장면, 실사' }), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('fallback');
    expect(result.meta).toMatchObject({ source: 'fallback', fallbackReason: 'timeout', llmModel: null, skinMode: 'realism', profileVersion: 'seedream@2026-11-19.1' });
    expect(enhanceMeta(input({ prompt: '병' }), 'fallback', { fallbackReason: 'no_key' })).toMatchObject({ fallbackReason: 'no_key', skinMode: 'off' });
  });
});
