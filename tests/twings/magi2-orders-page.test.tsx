import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { templateCredits } from '@/lib/twings/credits';
import { formatResolutionPrice, offeredResolutions } from '@/lib/twings/resolution';
import { templateSubscriptionQuote } from '@/lib/twings/subscription-plan';

/**
 * M1 fix 1, finding 1 — the template page of a MAGI-2 template while `TWINGS_PERSONAL_MAGI2_ORDERS` is off: the page
 * renders (no throw), shows the "not for sale" box and no make/buy action. With all three switches on it is an
 * ordinary for-sale page. A Seedance template is untouched by the switch.
 */

const cards = vi.hoisted(() => {
  const base = {
    medium: 'video', runtimeSeconds: 10, aspectDefault: '9:16', price1080Cents: 0, price1080Krw: 0,
    source: 'yagi', origin: 'studio', authorHandle: null, makerProfile: false, recipeOpen: false, models: [], modelLabels: [], useCase: [],
    poster: null, video: null, lock: null, featured: false, publishedAt: null, look: null,
  };
  return {
    magi: { ...base, id: 'neon-film', slug: 'sample-neon-walk', title: 'Neon walk (sample)', titleKo: '네온 워크 (예시)', engine: 'magi-2', priceCents: 300, priceKrw: 4300 },
    seedance: { ...base, id: 'seedance-film', slug: 'sample-seedance-film', title: 'Runway walk (sample)', titleKo: '런웨이 워크 (예시)', engine: 'seedance-2.5', priceCents: 400, priceKrw: 4900 },
  };
});
vi.mock('server-only', () => ({}));
vi.mock('@/lib/creator-subscriptions/cached-availability', () => ({
  cachedSubscriptionAvailability: async () => ({ status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null }),
}));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [cards.magi, cards.seedance], image: [], makers: [] }) }));
vi.mock('@/lib/campaigns/public-catalog', () => ({ getCampaignCatalog: async () => ({ campaigns: [] }) }));
vi.mock('@/lib/recipes/cached-public', () => ({ cachedPublicRecipe: async () => null }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/prompts/detail-media', () => ({ PromptDetailMedia: () => null }));
vi.mock('@/components/prompts/poster', () => ({ TypographicPoster: () => null, posterRatio: () => '9 / 16' }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));

import TemplatePage from '@/app/(marketing)/[locale]/t/[slug]/page';

const page = async (slug: string, locale: 'ko' | 'en' = 'ko') => renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug }) }));

function switches(orders: boolean) {
  vi.stubEnv('TWINGS_PERSONAL_MAGI2', 'on');
  vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on');
  vi.stubEnv('TWINGS_PERSONAL_MAGI2_ORDERS', orders ? 'on' : '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a MAGI-2 template page and the order switch', () => {
  it('switch off: the page renders with the not-for-sale box and no make or buy action, in both languages', async () => {
    switches(false);
    for (const locale of ['ko', 'en'] as const) {
      const html = await page(cards.magi.slug, locale);
      expect(html).toContain('data-template-closed');
      expect(html).not.toContain('data-make-cta');
      expect(html).not.toContain('href="#make"');
      expect(html).not.toContain('data-resolution-standard');
      // No engine or model name on a customer page, whatever the switch.
      expect(html).not.toMatch(/MAGI|magi-2|Sand\.ai|Sunra/i);
    }
  });

  it('switch on: an ordinary for-sale page', async () => {
    switches(true);
    const html = await page(cards.magi.slug);
    expect(html).not.toContain('data-template-closed');
    expect(html).toContain('data-make-cta');
    expect(html).not.toMatch(/MAGI|magi-2|Sand\.ai|Sunra/i);
  });

  it('a Seedance template page is the same with the switch on or off', async () => {
    switches(false);
    const off = await page(cards.seedance.slug);
    switches(true);
    const on = await page(cards.seedance.slug);
    expect(off).toContain('data-make-cta');
    expect(off).not.toContain('data-template-closed');
    expect(on).toBe(off);
  });

  it('the page’s price and credit helpers stay total for a MAGI-2 card with the switch off (no throw)', () => {
    switches(false);
    const card = cards.magi as unknown as Parameters<typeof offeredResolutions>[0] & Parameters<typeof templateCredits>[0];
    expect(offeredResolutions(card)).toEqual([]);
    expect(formatResolutionPrice(card, '1080p', 'ko')).toBe('4,300원');
    expect(templateSubscriptionQuote(card)).toBeNull();
    // Credits are a cost figure for the subscription box, priced from MAGI-2's own row: 0.08 × 10 s × 1.05.
    expect(() => templateCredits(card)).not.toThrow();
  });
});
