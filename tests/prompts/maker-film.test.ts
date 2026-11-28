import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPromptCatalog } from '@/lib/prompts/catalog';
import { buildMakerFilm, registerMakerFilm, type FilmMedia, type MakerFilm } from '@/lib/prompts/maker-film';
import * as pricing from '@/lib/recipes/pricing';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { loadPublicRecipe } from '@/lib/recipes/public';
import { loadTemplateRecipe } from '@/lib/recipes/repo';
import { engineStepPrompt, MAX_STEP_PROMPT_CHARS } from '@/lib/recipes/schema';
import { loadPublicMakerRows, makerBioFor, saveMakerProfile } from '@/lib/makers/profile';
import { FIXTURE_USERS } from '@/scripts/fixtures';
import { emptyPromptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * A creative's film as their template (lib/prompts/maker-film.ts, 2026-10-29 @yunseolfromseoul):
 * the post's prompt reaches the template page and the engine unchanged but for the photo slot, the
 * row is the creative's (credit, accepted format, royalty), and the catalogue says its recipe is open.
 */

const FILE = JSON.parse(readFileSync(join(process.cwd(), 'content/templates/aquarium-goldfish-daydream.json'), 'utf8')) as Record<string, unknown>;
const PROMPT = [
  'Reference authority:',
  "- @Image 1 supplies ONLY the sole female protagonist's facial identity.",
  '',
  "0.0–0.4s: Tight close-up of @Image 1 seen through storefront aquarium glass. Hard cut.",
  "8.4–10.0s: @Image 1 tilts her head with softly closed lips and a serene 2mm corner smile.",
].join('\n');
const labels = { selfie: 'My photo', reference: 'Reference {n}', step: 'Step {n} result' };

describe('a maker film', () => {
  it('turns @Image 1 into the photo slot and leaves every other character of the prompt alone', () => {
    const built = buildMakerFilm(FILE, PROMPT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const step = built.film.recipe.steps[0]!;
    expect(step.prompt).toBe(PROMPT.replaceAll('@Image 1', '{{selfie}}'));
    expect(step).toMatchObject({ kind: 'video', engine: 'seedance-2.5', params: { aspect: '4:3', duration: 10, resolution: '720p' } });
    // The engine reads the slot back as "Image 1", then the recipe path's one identity line.
    expect(engineStepPrompt(built.film.recipe, step).split('\n\nImage 1 shows')[0]).toBe(PROMPT.replaceAll('@Image 1', 'Image 1'));
  });

  it('refuses a prompt without the photo, one naming another input, or one past the step limit', () => {
    expect(buildMakerFilm(FILE, 'A woman among goldfish, no reference at all.')).toMatchObject({ ok: false });
    expect(buildMakerFilm(FILE, `${PROMPT}\n@Image 2 supplies the umbrella.`)).toMatchObject({ ok: false });
    expect(buildMakerFilm(FILE, `${PROMPT}\n${'x'.repeat(MAX_STEP_PROMPT_CHARS)}`)).toMatchObject({ ok: false });
  });

  it('refuses a price under the 720p cost floor, and a 1080p price under its own', () => {
    expect(buildMakerFilm({ ...FILE, price_krw: 3900 }, PROMPT)).toMatchObject({ ok: false });
    // What the film was written at no longer sets the price: the order names the resolution it renders at.
    expect(buildMakerFilm({ ...FILE, resolution: '1080p' }, PROMPT)).toMatchObject({ ok: true });
    // 10 s 4:3 at 1080p costs 7,972원 to make; its floor is 9,800원.
    expect(buildMakerFilm({ ...FILE, price_1080_krw: 9700 }, PROMPT)).toMatchObject({ ok: false });
    expect(buildMakerFilm({ ...FILE, price_1080_krw: 9800 }, PROMPT)).toMatchObject({ ok: true });
  });

  it('returns a typed refusal instead of throwing when pricing fails', () => {
    const spy = vi.spyOn(pricing, 'quoteRecipeBase').mockImplementationOnce(() => {
      throw new pricing.RecipePricingError('unquotable_step', 'film', 'seedance-2.5');
    });
    try {
      expect(buildMakerFilm(FILE, PROMPT)).toEqual({
        ok: false,
        errors: ['recipe: unquotable_step (film: seedance-2.5)'],
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('registering a maker film', () => {
  let harness: PromptHarness;
  let film: MakerFilm;
  const maker = FIXTURE_USERS.pro.id;
  const media: FilmMedia = {
    video: { bytes: new TextEncoder().encode('TEST film'), mime: 'video/mp4', w: 1664, h: 1248, seconds: 10.04 },
    poster: { bytes: new TextEncoder().encode('TEST poster'), mime: 'image/jpeg', w: 1664, h: 1248 },
  };

  beforeAll(async () => {
    harness = await emptyPromptHarness();
    const built = buildMakerFilm(FILE, PROMPT);
    if (!built.ok) throw new Error(built.errors.join('\n'));
    film = built.film;
  });
  afterAll(async () => harness.close());

  it('needs the creative to be an active maker with a public profile', async () => {
    await expect(registerMakerFilm(harness, film, media)).rejects.toThrow('not an active maker');
    await harness.sql.query(`insert into platform_creators(user_id, active, contract_version) values ($1, true, 'test')`, [maker]);
    await saveMakerProfile(harness.sql, maker, { handle: 'yunseolfromseoul', bio: '서울의 AI 크리에이티브.', publicProfile: true });
    await harness.sql.query(`update platform_creators set bio_en = 'Seoul-based AI creative.' where user_id = $1`, [maker]);
  });

  it("publishes the creative's template: their credit, the recipe and page choices, an accepted format", async () => {
    const outcome = await registerMakerFilm(harness, film, media);
    expect(outcome.status).toBe('created');
    const row = await loadPromptBySlug(harness.sql, film.slug);
    expect(row).toMatchObject({
      status: 'published', source: 'yagi', authorId: maker, authorHandle: 'yunseolfromseoul', textVisibility: 'hidden',
      medium: 'video', priceKrw: 4100, runtimeSeconds: 10, engine: 'seedance-2.5', aspectDefault: '4:3', titleKo: '어항 속 금붕어 백일몽',
    });
    expect(row!.media).toMatchObject({ video: { mime: 'video/mp4', w: 1664, h: 1248 }, poster: { mime: 'image/jpeg' } });
    expect((await loadTemplateRecipe(harness.sql, row!.id))?.steps[0]?.prompt).toBe(film.recipe.steps[0]!.prompt);
    const format = (await harness.sql.query<{ status: string; royalty_krw: number; user_id: string; presentation: string }>(
      'select status, royalty_krw, user_id, presentation from platform_formats where template_id = $1', [row!.id])).rows;
    expect(format).toEqual([{ status: 'accepted', royalty_krw: 1500, user_id: maker, presentation: 'story-first' }]);
  });

  it('shows the prompt on the page with [My photo], and the catalogue marks the card and the maker', async () => {
    const row = await loadPromptBySlug(harness.sql, film.slug);
    const recipe = await loadPublicRecipe(harness.sql, row!.id, labels);
    expect(recipe).toMatchObject({ presentation: 'story-first', files: null });
    expect(recipe!.steps![0]!.prompt).toBe(PROMPT.replaceAll('@Image 1', '[My photo]'));

    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: (key) => `/public/${key}` });
    const card = catalog.video.find((item) => item.slug === film.slug)!;
    expect(card).toMatchObject({ origin: 'maker', makerProfile: true, authorHandle: 'yunseolfromseoul', recipeOpen: true });
    expect(catalog.makers).toEqual([expect.objectContaining({ handle: 'yunseolfromseoul', templateCount: 1, openRecipeCount: 1, bio: '서울의 AI 크리에이티브.', bioEn: 'Seoul-based AI creative.' })]);
    expect(catalog.video.filter((item) => item.slug !== film.slug).every((item) => !item.recipeOpen)).toBe(true);
  });

  it('leaves a slug that is already taken alone on a second run', async () => {
    expect(await registerMakerFilm(harness, film, media)).toEqual({ slug: film.slug, status: 'exists' });
  });
});

describe('the English bio (0069)', () => {
  it('is what /en shows when the maker wrote one; every other page shows the bio', () => {
    const maker = { bio: '서울의 AI 크리에이티브.', bioEn: 'Seoul-based AI creative.' };
    expect(makerBioFor(maker, 'en')).toBe('Seoul-based AI creative.');
    expect(makerBioFor(maker, 'ko')).toBe('서울의 AI 크리에이티브.');
    expect(makerBioFor({ bio: '서울의 AI 크리에이티브.', bioEn: null }, 'en')).toBe('서울의 AI 크리에이티브.');
  });

  it('reads as null on a database without 0069, so older schemas keep answering', async () => {
    const harness = await emptyPromptHarness();
    try {
      await harness.sql.query('alter table platform_creators drop column bio_en');
      await harness.sql.query(`insert into platform_creators(user_id, active, contract_version) values ($1, true, 'test')`, [FIXTURE_USERS.pro.id]);
      await saveMakerProfile(harness.sql, FIXTURE_USERS.pro.id, { handle: 'jun', bio: '소개', publicProfile: true });
      expect(await loadPublicMakerRows(harness.sql)).toEqual([expect.objectContaining({ userId: FIXTURE_USERS.pro.id, handle: 'jun', bio: '소개', bioEn: null })]);
    } finally {
      await harness.close();
    }
  });
});
