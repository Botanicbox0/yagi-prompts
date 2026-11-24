import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPromptCatalog } from '@/lib/prompts/catalog';
import { loadPromptBySlug, loadPromptLook, setPromptLook } from '@/lib/prompts/repo';
import { PROMPT_CATALOG_CACHE_VERSION, promptCatalogCacheKey } from '@/lib/prompts/public-catalog';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the card side. `PromptCard.look` is present ONLY for a template written for one
 * style and only with `TWINGS_TEMPLATE_LOOK=on`; a card for anyone keeps exactly its old key set. With the switch off
 * no query names the new column at all, and a database without 0190 serves every card as before.
 */

describe('PromptCard.look', () => {
  let harness: PromptHarness;
  const seen: string[] = [];

  beforeAll(async () => {
    harness = await promptHarness();
    await harness.sql.query(`update prompt_items set look = 'male' where slug = 'neon-alley-dolly'`);
  });
  afterAll(async () => harness.close());
  afterEach(() => vi.unstubAllEnvs());

  async function cards() {
    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
    return [...catalog.video, ...catalog.image];
  }

  it('switch off: no card carries `look`, and no query selects the column', async () => {
    const spy = { query: async (text: string, params?: unknown[]) => { seen.push(text); return harness.sql.query(text, params as never); } };
    await loadPromptCatalog(spy as never, { publicUrl: () => null });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((text) => /'look'|\blook\b/.test(text))).toBe(false);
    for (const card of await cards()) expect(Object.hasOwn(card, 'look')).toBe(false);
    expect((await loadPromptBySlug(harness.sql, 'neon-alley-dolly'))?.look).toBeUndefined();
  });

  it('switch on: only the labelled card gains the key; every other card keeps its exact key set', async () => {
    const before = new Map((await cards()).map((card) => [card.slug, Object.keys(card).sort()]));
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    for (const card of await cards()) {
      if (card.slug === 'neon-alley-dolly') {
        expect(card.look).toBe('male');
        expect(Object.keys(card).sort()).toEqual([...before.get(card.slug)!, 'look'].sort());
      } else {
        expect(Object.keys(card).sort()).toEqual(before.get(card.slug));
      }
    }
  });

  it('switch on without 0190: every card reads as "for anyone", nothing throws', async () => {
    const other = await promptHarness();
    try {
      await other.sql.query('alter table prompt_items drop column look');
      vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
      const catalog = await loadPromptCatalog(other.sql, { publicUrl: () => null });
      for (const card of [...catalog.video, ...catalog.image]) expect(Object.hasOwn(card, 'look')).toBe(false);
      // The admin read says "no select" and a one-style write refuses with the migration's name.
      const id = catalog.video[0]!.id;
      expect(await loadPromptLook(other.sql, id)).toBeNull();
      await expect(setPromptLook(other.sql, id, 'female')).rejects.toThrow(/0190/);
      await expect(setPromptLook(other.sql, id, 'any')).resolves.toBeUndefined();
    } finally {
      await other.close();
    }
  });

  it('the admin read sees the label whatever the switch says (labelling comes before turning it on)', async () => {
    const row = await loadPromptBySlug(harness.sql, 'neon-alley-dolly');
    expect(await loadPromptLook(harness.sql, row!.id)).toBe('male');
  });

  it('the cache key moved, and the switch is part of it', () => {
    expect(PROMPT_CATALOG_CACHE_VERSION).toBe('v17-template-look');
    expect(promptCatalogCacheKey()).toContain('look-off');
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    expect(promptCatalogCacheKey()).toContain('look-on');
    expect(promptCatalogCacheKey()).toContain(PROMPT_CATALOG_CACHE_VERSION);
  });
});
