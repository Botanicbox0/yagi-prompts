import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_PROMPT_CATALOG, landingPromptCards, loadPromptCatalog } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL } from '@/lib/prompts/schemas';
import { promptLock } from '@/lib/prompts/lock';
import { badgeFor } from '@/lib/content/badges';
import { PROMPT_SENTINELS } from '../../scripts/prompt-fixtures';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * PLAN §13.2 — "cards carry NO prompt text".
 *
 * The gallery is STATIC and cached, which means one HTML document is served to an anonymous
 * visitor, a free reader and a Pro subscriber alike. That is only safe if the projection those
 * cards are built from cannot contain gated text — so the load-bearing assertion here is on the
 * exact KEY SET, not on the absence of a particular string.
 */
describe('prompt catalog projection (§13.2)', () => {
  let harness: PromptHarness;
  let catalog: Awaited<ReturnType<typeof loadPromptCatalog>>;

  beforeAll(async () => {
    harness = await promptHarness();
    catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
  });
  afterAll(async () => harness.close());

  it('exposes exactly the §13.2 card fields — and `text` is not one of them', () => {
    const card = catalog.yagi[0]!;
    expect(Object.keys(card).sort()).toEqual([
      'aspectDefault',
      'authorHandle',
      'engine',
      'featured',
      'id',
      'lock',
      'medium',
      'modelLabels',
      'models',
      'poster',
      'priceCents',
      'publishedAt',
      'runtimeSeconds',
      'slug',
      'source',
      'title',
      'titleKo',
      'useCase',
      'video',
    ]);
    for (const key of ['text', 'promptText', 'prompt_text']) {
      expect(Object.hasOwn(card, key), key).toBe(false);
    }
  });

  /** The end-to-end version of the same claim: no sentinel of any kind survives the projection. */
  it('carries no prompt sentinel at all, public ones included', () => {
    const serialised = JSON.stringify(catalog);
    for (const sentinel of PROMPT_SENTINELS) {
      expect(serialised.includes(sentinel.token), sentinel.token).toBe(false);
    }
  });

  /** docs/TEMPLATES-IA.md — the two tabs: every published card lands in exactly one of them. */
  it('splits published templates by medium, with the priced ones carrying their numbers', () => {
    const all = [...catalog.yagi, ...catalog.community];
    expect(catalog.video.length + catalog.image.length).toBe(all.length);
    expect(catalog.video.every((card) => card.medium === 'video')).toBe(true);
    expect(catalog.image.every((card) => card.medium === 'image' && card.runtimeSeconds === null)).toBe(true);
    expect(catalog.image.map((card) => card.slug)).toEqual(['static-portrait-window-light']);
    const priced = all.find((card) => card.slug === 'neon-alley-dolly')!;
    expect(priced).toMatchObject({ medium: 'video', priceCents: 400, runtimeSeconds: 15 });
    expect(all.filter((card) => card.priceCents === 0).length).toBeGreaterThan(0);
  });

  it('splits the two rails and counts them (§13.2)', () => {
    expect(catalog.yagi.every((card) => card.source === 'yagi')).toBe(true);
    expect(catalog.community.every((card) => card.source === 'community')).toBe(true);
    expect(catalog.totals).toMatchObject({
      yagi: 8,
      community: 3,
      published: 11,
      modelLabel: PROMPT_MODEL_LABEL,
    });
    // The pending and rejected submissions are not in either rail.
    expect(catalog.community.map((card) => card.slug)).not.toContain('pending-underwater-drift');
    expect(catalog.community.map((card) => card.slug)).not.toContain('rejected-stock-lookalike');
  });

  /**
   * The chip names the ACTION (founder report, 2026-08-15: "90s interview는 free인데 왜 cookie
   * 요구?"). A boolean could only say "gated", so a `free` prompt — opened by signing in, charged
   * nothing — wore the COOKIE chip and quoted a price the server refuses to take.
   */
  it('marks the lock chip from text visibility, and names the right action', () => {
    const locked = catalog.yagi.filter((card) => card.lock !== null);
    const open = catalog.yagi.filter((card) => card.lock === null);
    expect(locked).toHaveLength(6);
    // Nothing in the fixtures is free-gated, so the mapping itself is asserted directly.
    expect(promptLock('public')).toBeNull();
    expect(promptLock('free')).toBe('signin');
    expect(promptLock('pro')).toBe('cookie');
    expect(promptLock('hidden')).toBe('cookie');
    expect(locked.every((card) => card.lock === 'cookie')).toBe(true);
    // §13.3-2: the two deliberate public teasers.
    expect(open.map((card) => card.slug).sort()).toEqual([
      'short-film-establishing-rooftop',
      'static-portrait-window-light',
    ]);
    // §13.3-1: community text is public by definition, so no community card ever wears the chip.
    expect(catalog.community.every((card) => card.lock === null)).toBe(true);
  });

  it('offers only the use cases that are actually present, sorted', () => {
    const present = catalog.totals.useCases;
    expect(present).toEqual([...present].sort());
    expect(present).toContain('cinematic');
    // Nothing in the fixtures is tagged `tutorial` AND unpublished-only, so this is a real filter.
    expect(present.every((value) => value.length > 0)).toBe(true);
  });

  it('resolves media through the public route when no CDN is configured (§11)', () => {
    const withMedia = catalog.yagi.find((card) => card.poster !== null)!;
    expect(withMedia.poster!.source).toBe('route');
    expect(withMedia.poster!.src).toContain('/api/prompts/media/');
    expect(JSON.stringify(catalog)).not.toContain('content/prompt/');
  });

  it('falls back to no media for the text-only community item (§13.3-4)', () => {
    const textOnly = catalog.community.find((card) => card.slug === 'talking-head-brand-read')!;
    expect(textOnly.poster).toBeNull();
    expect(textOnly.video).toBeNull();
  });

  it('gives the landing the YAGI rail, featured first, capped', () => {
    const cards = landingPromptCards(catalog);
    expect(cards.length).toBeLessThanOrEqual(6);
    expect(cards.every((card) => card.source === 'yagi')).toBe(true);
    expect(cards[0]!.featured).toBe(true);
  });

  /**
   * §3.5 badge windows, applied to a prompt's publication rather than a playbook's debut.
   *
   * The clock is derived from each fixture's OWN date rather than pinned to a calendar day. The
   * pinned version passed until the fixtures — which are seeded relative to the real clock — drifted
   * past it (2026-08-16), and a test that fails with the passage of time tests the calendar, not the
   * window it claims to.
   */
  it('drives the NEW badge from publishedAt on the 14-day window', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const card = catalog.yagi.find((item) => item.publishedAt !== null)!;
    const published = Date.parse(card.publishedAt!);

    const inside = new Date(published + 13 * DAY);
    const outside = new Date(published + 15 * DAY);
    expect(badgeFor({ firstPublishedAt: card.publishedAt, updatedAt: null, now: inside })).toBe('new');
    expect(badgeFor({ firstPublishedAt: card.publishedAt, updatedAt: null, now: outside })).toBeNull();
  });

  it('has an honest empty state', () => {
    expect(EMPTY_PROMPT_CATALOG.yagi).toEqual([]);
    expect(EMPTY_PROMPT_CATALOG.community).toEqual([]);
    expect(EMPTY_PROMPT_CATALOG.totals.published).toBe(0);
    expect(landingPromptCards(EMPTY_PROMPT_CATALOG)).toEqual([]);
  });
});
