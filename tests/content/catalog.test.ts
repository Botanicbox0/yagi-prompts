import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import {
  EMPTY_CATALOG,
  FEATURED_MAX,
  featuredCards,
  loadPublicCatalog,
  type PublicCatalog,
} from '@/lib/content/catalog';
import { isSupabaseConfigured, publicContentUrl } from '@/lib/content/asset-url';
import { seed } from '@/scripts/seed';
import { freshDb, runner } from '../helpers/pglite';

/**
 * PLAN §7 catalog projection, read over the M0 seed through the real prepare → copy → publish flow.
 * This is the read model M1's featured cards, marquee and pricing counts all hang off.
 */
describe('public catalog projection (§3.1 / §7)', () => {
  let db: PGlite;
  let storageRoot: string;
  let catalog: PublicCatalog;

  beforeAll(async () => {
    db = await freshDb();
    storageRoot = await mkdtemp(join(tmpdir(), 'playbook-catalog-'));
    await seed({
      sql: runner(db),
      storage: createLocalStorageDriver(storageRoot),
      createAuthUsers: true,
    });
    catalog = await loadPublicCatalog(runner(db));
  });

  afterAll(async () => {
    await db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('lists every published playbook, newest first', () => {
    // §3.1 public-metadata rule: card metadata of every published playbook is marketing surface,
    // showcase or not. Only the link target differs.
    expect(catalog.cards.map((c) => c.slug)).toEqual([
      'talking-character-clip',
      'character-sheet-generation',
    ]);
    expect(catalog.cards.map((c) => c.isShowcase)).toEqual([false, true]);
    expect(catalog.cards.every((c) => c.publishedAt !== null)).toBe(true);
  });

  it('carries both locales on every card', () => {
    for (const card of catalog.cards) {
      expect(card.title.en.length, card.slug).toBeGreaterThan(0);
      expect(card.title.ko.length, card.slug).toBeGreaterThan(0);
      expect(card.summary.en.length, card.slug).toBeGreaterThan(0);
      expect(card.summary.ko.length, card.slug).toBeGreaterThan(0);
    }
  });

  it('counts blocks, pro blocks and advertisable prompts per playbook', () => {
    const byslug = Object.fromEntries(catalog.cards.map((c) => [c.slug, c]));

    // 4 visibility steps × 6 kinds; the whole `pro` step is 6 pro blocks; 1 of the 4 prompts is
    // `hidden` and must NOT be advertised.
    expect(byslug['talking-character-clip']).toMatchObject({
      stepCount: 4,
      blockCount: 24,
      proBlockCount: 6,
      promptCount: 3,
    });

    // Default policy: prompt/params/workflow_file → pro, note/asset → free, link → public.
    expect(byslug['character-sheet-generation']).toMatchObject({
      stepCount: 2,
      blockCount: 7,
      proBlockCount: 3,
      promptCount: 1,
    });
  });

  it('totals what the pricing page advertises', () => {
    expect(catalog.totals).toMatchObject({
      playbooks: 2,
      steps: 6,
      blocks: 31,
      proBlocks: 9,
      prompts: 4,
    });
  });

  it('collects the real tool + model names the marquee shows', () => {
    for (const tool of ['ComfyUI', 'Photoshop', 'ffmpeg']) {
      expect(catalog.totals.tools).toContain(tool);
    }
    for (const model of ['GPT Image 2', 'InsightFace', 'Kling 3.0', 'Qwen3-TTS']) {
      expect(catalog.totals.models).toContain(model);
    }
  });

  it('emits public-bucket hero keys only — never a staging or private key', () => {
    for (const card of catalog.cards) {
      expect(card.hero, card.slug).not.toBeNull();
      expect(card.hero!.key).toMatch(/^[a-f0-9]{64}\./);
    }
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain('staging_key');
    expect(serialized).not.toContain('content/rev/');
    expect(serialized).not.toContain('content-published');
    expect(serialized).not.toContain('artifacts-published');
  });

  it('caps the featured strip at 6 (§3.1 "latest 4–6")', () => {
    expect(featuredCards(catalog).length).toBeLessThanOrEqual(FEATURED_MAX);
    expect(featuredCards(catalog)).toEqual(catalog.cards);

    const many: PublicCatalog = {
      ...catalog,
      cards: Array.from({ length: 9 }, (_, i) => ({ ...catalog.cards[0]!, slug: `p-${i}` })),
    };
    expect(featuredCards(many)).toHaveLength(FEATURED_MAX);
  });

  it('has an empty state that is shaped like a real catalog', () => {
    expect(EMPTY_CATALOG.cards).toEqual([]);
    expect(EMPTY_CATALOG.totals.playbooks).toBe(0);
    expect(featuredCards(EMPTY_CATALOG)).toEqual([]);
  });
});

describe('public asset URLs (§11 open item: no Supabase project yet)', () => {
  it('resolves against a configured project', () => {
    expect(publicContentUrl('abc.jpg', 'https://proj.supabase.co')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/public-content/abc.jpg',
    );
    expect(publicContentUrl('abc.jpg', 'https://proj.supabase.co/')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/public-content/abc.jpg',
    );
  });

  it('returns null rather than a broken URL when nothing is configured', () => {
    expect(isSupabaseConfigured(undefined)).toBe(false);
    expect(isSupabaseConfigured('https://YOUR-PROJECT.supabase.co')).toBe(false);
    expect(publicContentUrl('abc.jpg', undefined)).toBeNull();
    expect(publicContentUrl('abc.jpg', 'https://YOUR-PROJECT.supabase.co')).toBeNull();
    expect(publicContentUrl('abc.jpg', '')).toBeNull();
  });
});
