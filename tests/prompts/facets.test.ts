import { describe, expect, it } from 'vitest';
import type { PromptCard } from '@/lib/prompts/catalog';
import { cardFacets, facetsFromDataset, lengthBand, listFacets, matchesFilter } from '@/lib/prompts/facets';

/**
 * 2026-11-24 (founder, second time): the video list is grouped by what a buyer knows about the film
 * — its length, whether it is new — not by the genre chips the image side uses. The image list keeps
 * its use-case chips exactly as they were.
 */

const NOW = new Date('2026-11-24T00:00:00.000Z');
const OLD = '2026-09-01T00:00:00.000Z';
const FRESH = '2026-11-20T00:00:00.000Z';

function card(overrides: Partial<PromptCard> = {}): PromptCard {
  return {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'neon-alley-dolly',
    title: 'Neon alley dolly',
    titleKo: null,
    authorHandle: null,
    origin: 'studio',
    makerProfile: false,
    source: 'yagi',
    models: [],
    modelLabels: [],
    useCase: ['cinematic'],
    medium: 'video',
    priceCents: 0,
    priceKrw: 0,
    price1080Cents: 0,
    price1080Krw: 0,
    runtimeSeconds: 15,
    engine: null,
    aspectDefault: '9:16',
    poster: null,
    video: null,
    lock: null,
    featured: false,
    publishedAt: OLD,
    ...overrides,
  };
}

describe('length bands', () => {
  it('cuts at 10 and 15 seconds', () => {
    expect(lengthBand(4)).toBe('short');
    expect(lengthBand(8)).toBe('short');
    expect(lengthBand(10)).toBe('short');
    expect(lengthBand(11)).toBe('mid');
    expect(lengthBand(15)).toBe('mid');
    expect(lengthBand(16)).toBe('long');
    expect(lengthBand(30)).toBe('long');
  });

  it('has no band for an unknown or meaningless length', () => {
    expect(lengthBand(null)).toBeNull();
    expect(lengthBand(undefined)).toBeNull();
    expect(lengthBand(0)).toBeNull();
    expect(lengthBand(-5)).toBeNull();
    expect(lengthBand(Number.NaN)).toBeNull();
  });

  it('gives an image no length even if a runtime slipped onto the row', () => {
    expect(cardFacets(card({ medium: 'image', runtimeSeconds: 8 }), NOW).length).toBeNull();
    expect(cardFacets(card({ runtimeSeconds: null }), NOW).length).toBeNull();
  });
});

describe('card facets', () => {
  it('reads NEW from the same 14-day window as the badge, against the injected clock', () => {
    expect(cardFacets(card({ publishedAt: FRESH }), NOW).new).toBe(true);
    expect(cardFacets(card({ publishedAt: OLD }), NOW).new).toBe(false);
    expect(cardFacets(card({ publishedAt: null }), NOW).new).toBe(false);
    // Fourteen days later the same card is no longer new.
    expect(cardFacets(card({ publishedAt: FRESH }), new Date('2026-12-10T00:00:00.000Z')).new).toBe(false);
  });

  it('carries use cases and cast (absent cast reads as solo)', () => {
    expect(cardFacets(card({ useCase: ['mv', 'vlog'], cast: 'pet' }), NOW)).toMatchObject({ useCase: ['mv', 'vlog'], cast: 'pet' });
    expect(cardFacets(card(), NOW).cast).toBe('solo');
  });

  it('round-trips through the DOM attributes the rail writes', () => {
    const facets = cardFacets(card({ runtimeSeconds: 8, publishedAt: FRESH, useCase: ['mv', 'vlog'] }), NOW);
    expect(facetsFromDataset({ length: 'short', new: 'true', useCase: 'mv vlog', cast: 'solo' })).toEqual(facets);
    expect(facetsFromDataset({ length: '', new: 'false', useCase: '' })).toMatchObject({ length: null, new: false, useCase: [], cast: 'solo' });
    expect(facetsFromDataset({ length: 'forever' }).length).toBeNull();
  });
});

describe('list facets', () => {
  const groups = (cards: PromptCard[], medium: 'video' | 'image' = 'video') => listFacets(cards, medium, NOW).map((facet) => facet.group);

  it('never offers genre chips on the video list', () => {
    const mixed = [
      card({ slug: 'a', useCase: ['cinematic'], runtimeSeconds: 8 }),
      card({ slug: 'b', useCase: ['mv'], runtimeSeconds: 15 }),
      card({ slug: 'c', useCase: ['brand-ad', 'ugc'], runtimeSeconds: 30 }),
    ];
    expect(groups(mixed)).not.toContain('useCase');
    expect(groups(mixed)).toEqual(['length']);
  });

  it('offers only the length bands that have cards, in band order, with their counts', () => {
    const length = listFacets([card({ slug: 'a', runtimeSeconds: 30 }), card({ slug: 'b', runtimeSeconds: 8 }), card({ slug: 'c', runtimeSeconds: 10 })], 'video', NOW)
      .find((facet) => facet.group === 'length');
    expect(length?.options).toEqual([{ value: 'short', count: 2 }, { value: 'long', count: 1 }]);
  });

  it('drops the length group when fewer than two bands are populated', () => {
    expect(groups([card({ slug: 'a', runtimeSeconds: 10 }), card({ slug: 'b', runtimeSeconds: 8 })])).toEqual([]);
    // Unknown lengths do not make a band of their own.
    expect(groups([card({ slug: 'a', runtimeSeconds: 10 }), card({ slug: 'b', runtimeSeconds: null })])).toEqual([]);
  });

  it('offers NEW only when some, but not all, cards are new', () => {
    const lengths = { a: 8, b: 15 } as const;
    const none = [card({ slug: 'a', runtimeSeconds: lengths.a }), card({ slug: 'b', runtimeSeconds: lengths.b })];
    const all = none.map((item) => ({ ...item, publishedAt: FRESH }));
    const some = [all[0]!, none[1]!];
    expect(groups(none)).toEqual(['length']);
    expect(groups(all)).toEqual(['length']);
    expect(groups(some)).toEqual(['new', 'length']);
    expect(listFacets(some, 'video', NOW)[0]).toEqual({ group: 'new', options: [{ value: '1', count: 1 }] });
  });

  it('keeps the image list on its use-case chips only', () => {
    const images = [
      card({ slug: 'a', medium: 'image', runtimeSeconds: null, useCase: ['mv'], publishedAt: FRESH }),
      card({ slug: 'b', medium: 'image', runtimeSeconds: null, useCase: ['cinematic', 'mv'] }),
    ];
    const facets = listFacets(images, 'image', NOW);
    expect(facets.map((facet) => facet.group)).toEqual(['useCase']);
    // The catalogue's own use-case order, not the order the cards happen to list them in.
    expect(facets[0]!.options).toEqual([{ value: 'cinematic', count: 1 }, { value: 'mv', count: 2 }]);
    // One use case across every image is not a choice.
    expect(groups([images[0]!, { ...images[0]!, slug: 'c' }], 'image')).toEqual([]);
    // A value that is not a use case is never offered.
    expect(groups([card({ slug: 'x', medium: 'image', useCase: ['not-a-use-case'] }), card({ slug: 'y', medium: 'image', useCase: ['mv'] })], 'image')).toEqual([]);
  });

  it('is empty for an empty list', () => {
    expect(listFacets([], 'video', NOW)).toEqual([]);
    expect(listFacets([], 'image', NOW)).toEqual([]);
  });
});

describe('matching', () => {
  const short = cardFacets(card({ runtimeSeconds: 8, publishedAt: FRESH, useCase: ['mv'] }), NOW);
  const mid = cardFacets(card({ runtimeSeconds: 15, publishedAt: OLD }), NOW);
  const unknown = cardFacets(card({ runtimeSeconds: null, publishedAt: FRESH }), NOW);

  it('shows everything with no choice made', () => {
    for (const facets of [short, mid, unknown]) expect(matchesFilter(facets, {})).toBe(true);
  });

  it('matches one choice per group', () => {
    expect(matchesFilter(short, { length: 'short' })).toBe(true);
    expect(matchesFilter(mid, { length: 'short' })).toBe(false);
    expect(matchesFilter(short, { new: '1' })).toBe(true);
    expect(matchesFilter(mid, { new: '1' })).toBe(false);
    expect(matchesFilter(short, { useCase: 'mv' })).toBe(true);
    expect(matchesFilter(mid, { useCase: 'mv' })).toBe(false);
  });

  it('ANDs the groups together', () => {
    expect(matchesFilter(short, { new: '1', length: 'short' })).toBe(true);
    expect(matchesFilter(unknown, { new: '1', length: 'short' })).toBe(false);
    expect(matchesFilter(mid, { new: '1', length: 'mid' })).toBe(false);
  });

  it('shows an unknown length only under "all", never under a length chip', () => {
    for (const band of ['short', 'mid', 'long']) expect(matchesFilter(unknown, { length: band })).toBe(false);
    expect(matchesFilter(unknown, { new: '1' })).toBe(true);
  });
});
