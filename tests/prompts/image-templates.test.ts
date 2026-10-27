import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPromptCatalog } from '@/lib/prompts/catalog';
import {
  buildImageTemplateSet,
  parseImageTemplateManifest,
  registerImageTemplateSet,
  type ImageFrameSpec,
  type ImageTemplateSet,
  type PosterImage,
} from '@/lib/prompts/image-templates';
import { parsePromptMediaRef, promptGalleryRef, promptMediaPath } from '@/lib/prompts/links';
import { publishPromptMedia } from '@/lib/prompts/media';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { parsePromptMedia } from '@/lib/prompts/schemas';
import { loadTemplateRecipe } from '@/lib/recipes/repo';
import { engineStepPrompt, outputSteps } from '@/lib/recipes/schema';
import { emptyPromptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * A studio image SET from a production manifest (lib/prompts/image-templates.ts, founder 2026-10-27:
 * "모든 이미지가 하나의 세트로"): the manifest and the set file are refused whole on any bad entry,
 * and the registered template is ONE card whose recipe hands every frame's prompt to the engine
 * exactly as the manifest wrote it.
 */

const prompt = (shot: string) =>
  `Reference Image 1 provides only the female subject's facial identity—preserve her exact Korean facial bone structure. ${shot} ` +
  'HUMAN EDITORIAL SKIN (AMERICANO CONTRACT) — matte-to-natural human skin, low specular-to-diffuse ratio, no text or watermarks.';

const entry = (n: number, overrides: Record<string, unknown> = {}) => ({
  template_index: n,
  template_slug: `bridal-0${n}-shot`,
  title_ko: `웨딩 컷 ${n}`,
  title_en: `Bridal shot ${n}`,
  file_name: `0${n}_shot_seedream_2k.png`,
  local_path: `D:/somewhere/0${n}_shot_seedream_2k.png`,
  model_id: 'seedream_v5_pro',
  resolution: '2k',
  aspect_ratio: '3:4',
  optical_post_grade: null,
  prompt: prompt(`Shot ${n} by a window.`),
  ...overrides,
});
const MANIFEST = [1, 2, 3, 4, 5].map((n) => entry(n));
const SET = {
  slug: 'bridal-editorial-5-shots',
  title_ko: '셀카 한 장으로 찍는 웨딩 화보 5컷',
  title_en: 'Five Bridal Editorial Shots From One Selfie',
  thumbnail: '02_shot_seedream_2k.png',
};

function frames(raw: unknown[] = MANIFEST): ImageFrameSpec[] {
  const parsed = parseImageTemplateManifest(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.frames;
}

describe('image template manifest', () => {
  it('maps a Higgsfield model id to the TWINGS engine and keeps the prompt unchanged', () => {
    const [first] = frames();
    expect(first).toEqual({
      key: 'bridal-01-shot',
      title: 'Bridal shot 1',
      titleKo: '웨딩 컷 1',
      promptText: prompt('Shot 1 by a window.'),
      engine: 'seedream-5.0-pro',
      aspect: '3:4',
      fileName: '01_shot_seedream_2k.png',
    });
  });

  it('refuses the whole manifest when one entry is wrong', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ model_id: 'flux_dev' }, 'unknown model_id'],
      [{ resolution: '4k' }, 'renders at 2k'],
      [{ aspect_ratio: '2:3' }, 'not an image aspect'],
      [{ prompt: ` ${prompt('x')}` }, 'whitespace'],
      [{ template_slug: 'Bridal 01' }, 'slug'],
      [{ file_name: '../01.png' }, 'file name'],
    ];
    for (const [overrides, message] of cases) {
      const parsed = parseImageTemplateManifest([entry(1), entry(2, overrides)]);
      expect(parsed.ok, message).toBe(false);
      if (!parsed.ok) expect(parsed.errors.join('\n')).toContain(message);
    }
    expect(parseImageTemplateManifest([entry(1), entry(1)]).ok).toBe(false);
    expect(parseImageTemplateManifest({}).ok).toBe(false);
  });
});

describe('an image set', () => {
  it('is one carousel recipe whose every frame reaches the engine as the manifest wrote it', () => {
    const built = buildImageTemplateSet(SET, frames());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { set } = built;
    expect(set).toMatchObject({ slug: SET.slug, titleKo: SET.title_ko, title: SET.title_en, engine: 'seedream-5.0-pro', aspect: '3:4', thumbnail: SET.thumbnail });
    expect(outputSteps(set.recipe)).toEqual(['shot1', 'shot2', 'shot3', 'shot4', 'shot5']);
    set.recipe.steps.forEach((step, index) => {
      expect(step).toMatchObject({ kind: 'image', engine: 'seedream-5.0-pro', inputs: ['selfie'], params: { aspect: '3:4' } });
      expect(step.prompt).toContain('Reference {{selfie}} provides only');
      const engineText = engineStepPrompt(set.recipe, step);
      expect(engineText.startsWith(`${MANIFEST[index]!.prompt}\n\n`)).toBe(true);
      expect(engineText).not.toContain('porcelain');
    });
  });

  it('refuses a set it could not make faithfully', () => {
    const cases: Array<[unknown, unknown[], string]> = [
      [{ ...SET, thumbnail: '09_missing.png' }, MANIFEST, 'not one of the manifest'],
      [{ ...SET, slug: 'Bridal Set' }, MANIFEST, 'slug'],
      [SET, [entry(1), entry(2, { prompt: 'A bride by a window, no reference named at all.' })], 'never names the photo'],
      [SET, [entry(1), entry(2, { prompt: `${prompt('x')} Match the veil in Image 2.` })], 'does not carry'],
      [SET, [entry(1), entry(2, { prompt: `${prompt('x')} {{veil}}` })], '"{{"'],
      [SET, [entry(1), entry(2, { aspect_ratio: '4:5' })], 'one aspect'],
      [SET, [entry(2)], '2 to 6 frames'],
    ];
    for (const [descriptor, manifest, message] of cases) {
      const built = buildImageTemplateSet(descriptor, frames(manifest));
      expect(built.ok, message).toBe(false);
      if (!built.ok) expect(built.errors.join('\n')).toContain(message);
    }
  });
});

describe('registering an image set', () => {
  let harness: PromptHarness;
  let set: ImageTemplateSet;
  const image = (fileName: string): PosterImage => ({ bytes: new TextEncoder().encode(`TEST ${fileName}`), mime: 'image/webp', w: 1760, h: 2352 });

  beforeAll(async () => {
    harness = await emptyPromptHarness();
    const built = buildImageTemplateSet(SET, frames());
    if (!built.ok) throw new Error(built.errors.join('\n'));
    set = built.set;
  });
  afterAll(async () => harness.close());

  it('publishes ONE template under the set slug, with its recipe, not for sale', async () => {
    const outcome = await registerImageTemplateSet(harness, set, image);
    expect(outcome.status).toBe('created');

    const row = await loadPromptBySlug(harness.sql, SET.slug);
    expect(row).toMatchObject({
      source: 'yagi',
      status: 'published',
      title: SET.title_en,
      titleKo: SET.title_ko,
      medium: 'image',
      engine: 'seedream-5.0-pro',
      aspectDefault: '3:4',
      models: ['seedream-5.0-pro'],
      priceCents: 0,
      priceKrw: 0,
      textVisibility: 'pro',
      featured: false,
    });
    const recipe = await loadTemplateRecipe(harness.sql, row!.id);
    expect(recipe?.steps.map((step) => engineStepPrompt(recipe, step).split('\n\n')[0])).toEqual(MANIFEST.map((item) => item.prompt));
  });

  it('is one card on the image tab: the chosen thumbnail on the card, all five frames on the page', async () => {
    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: (key) => `/public/${key}` });
    expect(catalog.image.map((card) => card.slug)).toEqual([SET.slug]);
    const card = catalog.image[0]!;
    const gallery = card.gallery ?? [];
    expect(card.modelLabels).toEqual(['SEEDREAM 5.0 PRO']);
    expect(gallery).toHaveLength(5);
    expect(gallery.every((frame) => frame.source === 'public' && frame.w === 1760 && frame.h === 2352)).toBe(true);
    // The thumbnail is frame 2's image, content-addressed: the same published object.
    expect(card.poster?.src).toBe(gallery[1]!.src);
    expect(new Set(gallery.map((frame) => frame.src)).size).toBe(5);
  });

  it('serves the frames through the prompt media route where there is no public bucket URL', async () => {
    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
    const card = catalog.image[0]!;
    expect((card.gallery ?? []).map((frame) => frame.src)).toEqual(
      [1, 2, 3, 4, 5].map((n) => promptMediaPath(promptGalleryRef(card.id, n))),
    );
    expect(parsePromptMediaRef(`${card.id}:gallery-5`)).toEqual({ id: card.id, kind: 'gallery', frame: 5 });
    for (const bad of ['gallery-0', 'gallery-7', 'gallery-01', 'gallery', 'gallery-x']) {
      expect(parsePromptMediaRef(`${card.id}:${bad}`), bad).toBeNull();
    }
  });

  it('keeps the gallery through the media round trip every /admin edit makes', async () => {
    const row = await loadPromptBySlug(harness.sql, SET.slug);
    const before = parsePromptMedia(row!.media);
    const { media: after } = await publishPromptMedia(harness.storage, before);
    expect(after.gallery).toEqual(before.gallery);
    expect(after.poster).toEqual(before.poster);
  });

  it('leaves a slug that is already taken alone on a second run', async () => {
    const again = await registerImageTemplateSet(harness, { ...set, titleKo: '바뀐 제목' }, image);
    expect(again.status).toBe('exists');
    expect((await loadPromptBySlug(harness.sql, SET.slug))?.titleKo).toBe(SET.title_ko);
  });
});
