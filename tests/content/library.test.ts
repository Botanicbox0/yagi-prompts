import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import {
  filterLibraryCards,
  isFiltered,
  libraryFacets,
  libraryHref,
  loadLibrary,
  parseLibraryQuery,
  type LibraryCard,
} from '@/lib/content/library';
import { loadPublicCatalog } from '@/lib/content/catalog';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { seed, seedEdgeFixtures } from '@/scripts/seed';
import { freshDb, runner } from '../helpers/pglite';

/**
 * PLAN §3.2 / §7 — the authenticated library projection and its server-rendered filters.
 */

describe('library read model (§3.2)', () => {
  let db: PGlite;
  let sql: SqlRunner;
  let storageRoot: string;
  let cards: LibraryCard[];

  beforeAll(async () => {
    db = await freshDb();
    storageRoot = await mkdtemp(join(tmpdir(), 'playbook-library-'));
    const storage = createLocalStorageDriver(storageRoot);
    sql = runner(db);
    await seed({ sql, storage, createAuthUsers: true });
    await seedEdgeFixtures({ sql, storage });
    cards = (await loadLibrary(sql, parseLibraryQuery({}))).all;
  });

  afterAll(async () => {
    await db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('lists every PUBLISHED playbook, newest first, and nothing else', () => {
    expect(cards.map((c) => c.slug)).toEqual([
      'character-lora-training',
      'talking-character-clip',
      'character-sheet-generation',
    ]);
    // draft and archived playbooks are not library content
    expect(cards.map((c) => c.slug)).not.toContain('insta-toon-pipeline');
    expect(cards.map((c) => c.slug)).not.toContain('voice-identity-setup');
  });

  it('carries the ids the grid needs to address hero media through the gateway', () => {
    for (const card of cards) {
      expect(card.revisionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(card.playbookId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('keeps those ids OUT of the cached public projection (§7)', async () => {
    const publicCatalog = await loadPublicCatalog(sql);
    for (const card of publicCatalog.cards) {
      expect(card).not.toHaveProperty('revisionId');
      expect(card).not.toHaveProperty('playbookId');
    }
  });

  it('counts pro blocks per card — the §3.2 "N pro blocks" indicator', () => {
    const bySlug = Object.fromEntries(cards.map((c) => [c.slug, c]));
    expect(bySlug['talking-character-clip']!.proBlockCount).toBe(6);
    expect(bySlug['character-sheet-generation']!.proBlockCount).toBe(3);
    for (const card of cards) expect(card.proBlockCount).toBeLessThanOrEqual(card.blockCount);
  });

  it('builds its facets from the data, not from a hard-coded list', () => {
    const facets = libraryFacets(cards);
    expect(facets.categories).toEqual(['video', 'character', 'pipeline']);
    expect(facets.difficulties).toEqual(['beginner', 'intermediate', 'advanced']);
    expect(facets.tags).toContain('ComfyUI');
    expect(facets.tags).toContain('Z-Image');
    // a category with no published playbook is not offered as a filter
    expect(facets.categories).not.toContain('music');
    expect(facets.categories).not.toContain('voice');
  });

  it('filters by category, difficulty and tool/model tag', () => {
    const byCategory = filterLibraryCards(cards, parseLibraryQuery({ category: 'video' }));
    expect(byCategory.map((c) => c.slug)).toEqual(['talking-character-clip']);

    const byDifficulty = filterLibraryCards(cards, parseLibraryQuery({ difficulty: 'beginner' }));
    expect(byDifficulty.map((c) => c.slug)).toEqual(['character-lora-training']);

    const byTag = filterLibraryCards(cards, parseLibraryQuery({ tag: 'ComfyUI' }));
    expect(byTag).toHaveLength(3);

    const byModel = filterLibraryCards(cards, parseLibraryQuery({ tag: 'Kling 3.0' }));
    expect(byModel.map((c) => c.slug)).toEqual(['talking-character-clip']);
  });

  it('combines filters rather than replacing them', () => {
    const both = filterLibraryCards(
      cards,
      parseLibraryQuery({ category: 'video', difficulty: 'beginner' }),
    );
    expect(both).toEqual([]);
  });

  it('searches title + summary in BOTH locales (§3.9: the catalog is bilingual, readers are not)', () => {
    expect(filterLibraryCards(cards, parseLibraryQuery({ q: 'lipsync' })).map((c) => c.slug)).toEqual(
      ['talking-character-clip'],
    );
    expect(filterLibraryCards(cards, parseLibraryQuery({ q: '립싱크' })).map((c) => c.slug)).toEqual([
      'talking-character-clip',
    ]);
    // case-insensitive, and it reaches the summary as well as the title
    expect(filterLibraryCards(cards, parseLibraryQuery({ q: 'MULTI POSE' }))).toHaveLength(0);
    expect(filterLibraryCards(cards, parseLibraryQuery({ q: 'multi-pose' })).map((c) => c.slug)).toEqual(
      ['character-sheet-generation'],
    );
  });
});

describe('library query parsing (the URL is the state)', () => {
  it('drops unknown categories and difficulties instead of emptying the grid', () => {
    const query = parseLibraryQuery({ category: 'nonsense', difficulty: 'expert', q: '  hi  ' });
    expect(query.category).toBeNull();
    expect(query.difficulty).toBeNull();
    expect(query.q).toBe('hi');
  });

  it('takes the first value of a repeated param and caps the search length', () => {
    expect(parseLibraryQuery({ category: ['image', 'video'] }).category).toBe('image');
    expect(parseLibraryQuery({ q: 'x'.repeat(500) }).q).toHaveLength(120);
  });

  it('knows when nothing is filtered', () => {
    expect(isFiltered(parseLibraryQuery({}))).toBe(false);
    expect(isFiltered(parseLibraryQuery({ q: 'a' }))).toBe(true);
    expect(isFiltered(parseLibraryQuery({ tag: 'ComfyUI' }))).toBe(true);
  });

  it('round-trips through the query string', () => {
    expect(libraryHref({})).toBe('/library');
    expect(libraryHref({ category: 'video', q: 'kling' })).toBe('/library?q=kling&category=video');
    expect(parseLibraryQuery({ q: 'kling', category: 'video' })).toMatchObject({
      q: 'kling',
      category: 'video',
    });
  });
});
