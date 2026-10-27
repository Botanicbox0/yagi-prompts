import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PromptCard } from '@/lib/prompts/catalog';
import { getDictionary } from '@/lib/i18n/dictionaries';

const film = vi.hoisted(() => ({
  id: 'film', slug: 'new-film', title: 'New film', titleKo: '새 영상', medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 25,
  aspectDefault: '4:3', priceCents: 1000, priceKrw: 14900, price1080Cents: 0, price1080Krw: 0,
  source: 'yagi', authorHandle: null, models: [], modelLabels: [], useCase: [], poster: null, video: null, lock: null, featured: false, publishedAt: null,
}));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [{ origin: 'studio', makerProfile: false, ...film } as PromptCard], image: [] }) }));
vi.mock('@/lib/creator-subscriptions/cached-availability', () => ({ cachedSubscriptionAvailability: async () => ({
  status: 'preparing', version: 'creator-monthly-2026-10-09-v1',
  plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null,
}) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/motion/reveal', () => ({ Reveal: ({ lines }: { lines: string[] }) => <h1>{lines.join(' ')}</h1> }));
import PricingPage from '@/app/(marketing)/[locale]/pricing/page';

describe('public subscription design while enrollment is closed', () => {
  it.each(['ko', 'en'] as const)('publishes the price and an honest upcoming state in %s HTML', async locale => {
    const html = renderToStaticMarkup(await PricingPage({ params: Promise.resolve({ locale }) }));
    const prose = html.replaceAll('&#x27;', "'");
    const copy = getDictionary(locale).pricing;
    expect(html).toContain('data-pricing-subscription="preparing"');
    expect(html).toContain('24,900');
    expect(html).toContain('49,000');
    expect(html).toContain('data-subscription-plan="creator"');
    expect(html).toContain('data-subscription-plan="premium"');
    expect(html).toContain('data-prompt-editing="planned"');
    expect(prose).toContain(copy.subscriptionPromptEditingSoon);
    expect(prose).toContain(copy.subscriptionEditingBoundary);
    expect(prose).toContain(copy.subscriptionEditingStatus);
    expect(prose.indexOf(copy.subscriptionEditingStatus)).toBeLessThan(prose.indexOf(copy.subscriptionPromptEditingSoon));
    expect(html).not.toContain('19,000');
    expect(html).toContain(copy.subscriptionUnavailable);
    expect(html).toContain('data-subscription-preview');
    expect(html).toContain('data-plan-film-count="creator"');
    expect(html).toContain('data-plan-film-count="premium"');
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*value="15"/);
    expect(html).toContain('data-faq-catalog="pricing"');
    expect(html).not.toContain('data-pricing-table');
    expect(html).not.toContain('data-pricing-row');
    expect(html).not.toMatch(/14,900|\$10|example-25|<select/);
    expect(html).toContain(`href="/${locale}/video"`);
    expect(html).not.toMatch(/구독 없음|NO SUBSCRIPTION|크레딧|충전|monthlyUnits|\/api\/billing\/subscription/);
    expect(html).not.toContain('"@type":"Product"');
    expect(html).not.toContain('<form');
  });
});
