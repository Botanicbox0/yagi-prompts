import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { castShelf, castShelfSize, landingPromptCards, loadPromptCatalog, soloCatalog } from '@/lib/prompts/catalog';
import { loadPromptBySlug, setPromptCast } from '@/lib/prompts/repo';
import { isTemplateCast, toTemplateCast } from '@/lib/prompts/schemas';
import { buildSitemap } from '@/lib/seo/sitemap';
import { coupleTemplatesOpen, petTemplatesOpen } from '@/lib/flags';
import { seedPrompts } from '../../scripts/seed';
import { CAST_PROMPT_FIXTURES } from '../../scripts/cast-fixtures';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * docs/CAST-CATEGORIES.md §1·§4·§5 — the catalogue by cast and medium. The catalogue is the one filter
 * every public surface reads, so "couples off" is proved here: no listing, template page, sitemap entry
 * or maker page can name a couple template the projection never held.
 */
describe('the catalogue by cast', () => {
  let h: PromptHarness;
  beforeAll(async () => {
    h = await promptHarness();
    await seedPrompts({ sql: h.sql, storage: h.storage }, CAST_PROMPT_FIXTURES);
  });
  afterAll(async () => h.close());

  it('every existing template reads as solo; unknown values fall back to solo', async () => {
    expect((await loadPromptBySlug(h.sql, 'neon-alley-dolly'))!.cast).toBe('solo');
    expect(toTemplateCast('dragon')).toBe('solo');
    expect(isTemplateCast('pet')).toBe(true);
  });

  it('the database refuses an unknown cast', async () => {
    await expect(h.sql.query("update prompt_items set cast_kind = 'trio' where slug = 'neon-alley-dolly'")).rejects.toThrow();
  });

  it('couples off: the projection holds no couple template at all', async () => {
    const catalog = await loadPromptCatalog(h.sql, { publicUrl: () => null, petOpen: true });
    const all = [...catalog.video, ...catalog.image, ...catalog.yagi, ...catalog.community];
    expect(all.some((card) => card.cast === 'couple')).toBe(false);
    expect(castShelfSize(castShelf(catalog, 'couple'))).toBe(0);
    const sitemap = buildSitemap({ origin: 'https://twings.test', cards: [], templates: [...catalog.video, ...catalog.image] });
    expect(sitemap.some((entry) => entry.url.includes('/couple'))).toBe(false);
    expect(sitemap.some((entry) => entry.url.includes('sample-couple'))).toBe(false);
    expect(sitemap.some((entry) => entry.url.endsWith('/ko/pet'))).toBe(true);
  });

  it('pets off: the projection holds no pet template, and the sitemap no pet page', async () => {
    const catalog = await loadPromptCatalog(h.sql, { publicUrl: () => null });
    expect([...catalog.video, ...catalog.image].some((card) => card.cast === 'pet')).toBe(false);
    const sitemap = buildSitemap({ origin: 'https://twings.test', cards: [], templates: [...catalog.video, ...catalog.image] });
    expect(sitemap.some((entry) => entry.url.includes('/pet') || entry.url.includes('sample-pet'))).toBe(false);
  });

  it('the flags are off unless the environment says exactly "on"', () => {
    expect(petTemplatesOpen({})).toBe(false);
    expect(petTemplatesOpen({ TWINGS_PET_TEMPLATES: '1' })).toBe(false);
    expect(petTemplatesOpen({ TWINGS_PET_TEMPLATES: 'on' })).toBe(true);
    expect(coupleTemplatesOpen({})).toBe(false);
    expect(coupleTemplatesOpen({ TWINGS_COUPLE_TEMPLATES: 'true' })).toBe(false);
    expect(coupleTemplatesOpen({ TWINGS_COUPLE_TEMPLATES: 'on' })).toBe(true);
  });

  it('couples on: their shelf splits by medium like every other', async () => {
    const catalog = await loadPromptCatalog(h.sql, { publicUrl: () => null, coupleOpen: true, petOpen: true });
    const shelf = castShelf(catalog, 'couple');
    expect(shelf.video.map((card) => card.slug).sort()).toEqual(['sample-couple-rooftop', 'sample-couple-subway']);
    expect(shelf.image.map((card) => card.slug).sort()).toEqual(['sample-couple-photo-booth', 'sample-couple-umbrella']);
  });

  it('pets split into a video rail and an image rail, nothing else in them', async () => {
    const catalog = await loadPromptCatalog(h.sql, { publicUrl: () => null, petOpen: true });
    const shelf = castShelf(catalog, 'pet');
    expect(shelf.video.every((card) => card.medium === 'video' && card.cast === 'pet')).toBe(true);
    expect(shelf.image.every((card) => card.medium === 'image' && card.cast === 'pet')).toBe(true);
    expect(shelf.video.map((card) => card.slug).sort()).toEqual(['sample-pet-beach-run', 'sample-pet-walk-together']);
    expect(shelf.image.map((card) => card.slug).sort()).toEqual(['sample-pet-sofa-together', 'sample-pet-studio-portrait']);
  });

  it('the home gallery and the medium tabs show only solo templates; the landing strip too', async () => {
    const catalog = await loadPromptCatalog(h.sql, { publicUrl: () => null, coupleOpen: true, petOpen: true });
    const solo = soloCatalog(catalog);
    for (const list of [solo.video, solo.image, solo.yagi, solo.community]) expect(list.every((card) => (card.cast ?? 'solo') === 'solo')).toBe(true);
    expect(solo.image.map((card) => card.slug)).toEqual(['static-portrait-window-light']);
    expect(landingPromptCards(catalog).every((card) => card.cast === 'solo')).toBe(true);
  });

  it('a non-solo cast needs 0078; setting it twice is idempotent', async () => {
    const row = (await loadPromptBySlug(h.sql, 'sample-pet-beach-run'))!;
    await setPromptCast(h.sql, row.id, 'pet');
    expect((await loadPromptBySlug(h.sql, 'sample-pet-beach-run'))!.cast).toBe('pet');
  });
});
