import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estimateImageUsd } from '@/lib/images/engines';
import { createGeminiImageClient } from '@/lib/images/gemini';
import { baseKrw } from '@/lib/twings/template-price';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { normalizeSetPrompt, parsePromptMedia, setPromptIssue } from '@/lib/prompts/schemas';
import { loadTemplateRecipe } from '@/lib/recipes/repo';
import { parseRecipe } from '@/lib/recipes/schema';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

const prompt = (n: number) => `Image 1 is the person. Keep their face. Frame ${n}, a quiet studio portrait.`;
const fields = (overrides: Record<string, unknown> = {}) => ({
  title: 'Three Quiet Portraits',
  titleKo: '조용한 초상 세 컷',
  engine: 'nano-banana-pro',
  aspect: '4:5',
  frameCount: '3',
  thumbnail: '1',
  frame0Prompt: prompt(1),
  frame1Prompt: prompt(2),
  frame2Prompt: prompt(3),
  frame0Size: '1856x2304',
  frame1Size: '1856x2304',
  frame2Size: '1856x2304',
  frame0: upload('one.webp', 'ONE', 'image/webp'),
  frame1: upload('two.webp', 'TWO', 'image/webp'),
  frame2: upload('three.webp', 'THREE', 'image/webp'),
  ...overrides,
});

/** Dana's report (2026-11-01): the site had no shape for an image set, and no Nano Banana Pro. */
describe('prompt.createSet', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);

  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.db.close());

  it('publishes one template at its base price with one recipe step and one example per frame', async () => {
    const outcome = await harness.run('prompt.createSet', fields());
    expect(outcome).toMatchObject({ ok: true, code: 'published', detail: 'three-quiet-portraits' });

    const row = (await loadPromptBySlug(sql(), 'three-quiet-portraits'))!;
    expect(row).toMatchObject({ status: 'published', medium: 'image', engine: 'nano-banana-pro', aspectDefault: '4:5', models: ['nano-banana-pro'] });
    // Three Nano Banana Pro frames: 571원 of provider cost × 1.12 = 64 credits = 800원 by card.
    expect(row.priceKrw).toBe(baseKrw({ medium: 'image', providerUsd: estimateImageUsd('nano-banana-pro', 1) * 3 }));
    expect(row.priceKrw).toBe(800);
    expect(outcome.ok && outcome.to).toBe(`/admin/prompts/${row.id}`);

    const media = parsePromptMedia(row.media);
    expect(media.gallery).toHaveLength(3);
    // The chosen main image, not the first frame.
    expect(media.poster?.sha256).toBe(media.gallery?.[1]?.sha256);
    expect(media.gallery?.[0]).toMatchObject({ w: 1856, h: 2304 });

    const recipe = (await loadTemplateRecipe(sql(), row.id))!;
    expect(recipe.steps.map((step) => step.engine)).toEqual(['nano-banana-pro', 'nano-banana-pro', 'nano-banana-pro']);
    expect(recipe.output).toEqual({ frames: ['shot1', 'shot2', 'shot3'] });
    expect(harness.promptsRevalidated).toBe(1);
  });

  it.each([
    ['one frame', { frameCount: '1' }],
    ['seven frames', { frameCount: '7' }],
    ['an unknown engine', { engine: 'midjourney' }],
    ['a video engine', { engine: 'seedance-2.5' }],
    ['a prompt without the photo', { frame1Prompt: 'A quiet studio portrait with no person named.' }],
    ['a reference the set does not carry', { frame1Prompt: 'Image 1 stands beside the dress in Image 2.' }],
    ['an image of the wrong shape', { frame2Size: '1024x1024' }],
    ['a main image outside the set', { thumbnail: '3' }],
  ])('refuses %s and writes nothing', async (_name, overrides) => {
    const outcome = await harness.run('prompt.createSet', fields(overrides));
    expect(outcome.ok).toBe(false);
    expect(await loadPromptBySlug(sql(), 'three-quiet-portraits')).toBeNull();
  });

  // Slack 2026-11-02: "@image1 프롬프트 이미 작성되어있는데 없다고 안넘어감".
  it('accepts the photo written @image1 and stores it as the set\'s Image 1', async () => {
    const outcome = await harness.run('prompt.createSet', fields({ frame0Prompt: '@image1 is the person. Keep their face. A quiet studio portrait.' }));
    expect(outcome).toMatchObject({ ok: true, detail: 'three-quiet-portraits' });
    const row = (await loadPromptBySlug(sql(), 'three-quiet-portraits'))!;
    const recipe = (await loadTemplateRecipe(sql(), row.id))!;
    expect(recipe.steps[0]!.prompt).toBe('{{selfie}} is the person. Keep their face. A quiet studio portrait.');
  });

  it('still refuses another reference written as a handle', async () => {
    const outcome = await harness.run('prompt.createSet', fields({ frame1Prompt: '@image1 stands beside the dress in @image2, quietly.' }));
    expect(outcome.ok).toBe(false);
    expect(await loadPromptBySlug(sql(), 'three-quiet-portraits')).toBeNull();
  });

  it('refuses a frame with no image', async () => {
    const outcome = await harness.run('prompt.createSet', fields({ frame2: undefined }));
    expect(outcome).toMatchObject({ ok: false, code: 'upload', detail: 'frame 3: no image' });
  });

  it('takes the next free address rather than refusing a repeated title', async () => {
    await harness.run('prompt.createSet', fields());
    const again = await harness.run('prompt.createSet', fields());
    expect(again).toMatchObject({ ok: true, detail: 'three-quiet-portraits-2' });
  });
});

describe('the studio-only engine', () => {
  const recipe = {
    version: 2,
    slots: { selfie: { kind: 'image', source: 'user', required: true } },
    steps: [{ id: 'one', kind: 'image', engine: 'nano-banana-pro', inputs: ['selfie'], prompt: 'A portrait of {{selfie}} in a studio.', params: { aspect: '4:5' } }],
    output: { from: 'one' },
  };

  it('stays closed to a maker save and open to a studio read', () => {
    expect(parseRecipe(recipe)).toMatchObject({ ok: false, issues: [{ code: 'engine', step: 'one' }] });
    expect(parseRecipe(recipe, { studio: true }).ok).toBe(true);
  });

  it('calls its own model even when GEMINI_IMAGE_MODEL moves the default', async () => {
    const seen: string[] = [];
    const fetchStub = (async (_url: unknown, init: { body: string }) => {
      seen.push((JSON.parse(init.body) as { model: string }).model);
      return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', data: 'QQ==', mime_type: 'image/jpeg' }] }] }));
    }) as unknown as typeof fetch;
    const client = createGeminiImageClient({ apiKey: 'k', baseUrl: 'https://example.test', model: 'gemini-nano-banana-3' }, fetchStub);
    const pro = await client.generate({ engine: 'nano-banana-pro', prompt: 'p', aspect: '4:5' });
    await client.generate({ prompt: 'p', aspect: '4:5' });
    expect(seen).toEqual(['gemini-3-pro-image', 'gemini-nano-banana-3']);
    expect(pro.usd).toBe(0.134);
  });
});

describe('setPromptIssue', () => {
  it.each([
    ['Image 1 smiles at the camera.', null],
    ['She smiles at the camera.', 'no_photo'],
    ['Image 1 holds the bag from Image 2.', 'other_reference'],
    ['Image 1 and {{selfie}}.', 'braces'],
  ])('%s → %s', (text, issue) => expect(setPromptIssue(text)).toBe(issue));
});

describe('normalizeSetPrompt', () => {
  it.each([
    ['@image1 smiles.', 'Image 1 smiles.'],
    ['@Image 1 smiles.', 'Image 1 smiles.'],
    ['@image_1 smiles.', 'Image 1 smiles.'],
    ['image1 smiles.', 'Image 1 smiles.'],
    ['the person in image 1 smiles.', 'the person in Image 1 smiles.'],
    ['Image 1 smiles.', 'Image 1 smiles.'],
    ['@image2 and @Video 1 and @audio1.', 'Image 2 and Video 1 and Audio 1.'],
    ['image 12 and myimage1 stay.', 'image 12 and myimage1 stay.'],
  ])('%s → %s', (text, normal) => expect(normalizeSetPrompt(text)).toBe(normal));

  it('turns a handle into the words the check reads', () => {
    expect(setPromptIssue(normalizeSetPrompt('@image1 smiles at the camera.'))).toBeNull();
    expect(setPromptIssue(normalizeSetPrompt('@image1 holds the bag from @image2.'))).toBe('other_reference');
  });
});
