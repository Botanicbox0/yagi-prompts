import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PublicSubscriptionAvailability } from '@/components/twings/subscription-availability';

/**
 * The decision screen (docs/PLATFORM-2.0.md §15.3-1·3): the template page is where money changes
 * hands, so it says ONE thing with ONE button — and the three public sentences about whether a film
 * can be bought (home hero, template, pricing) all come from the same `storefrontOpen()`.
 */

const state = vi.hoisted(() => ({
  mode: 'off' as 'off' | 'review' | 'on',
  availability: null as unknown as PublicSubscriptionAvailability,
}));
const film = vi.hoisted(() => ({
  id: 'film', slug: 'supported-film', title: 'Film', titleKo: '영상', medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 15,
  aspectDefault: '9:16', priceCents: 400, priceKrw: 6900, price1080Cents: 0, price1080Krw: 0,
  source: 'yagi', authorHandle: null, models: [], modelLabels: ['Seedance 2.5'], useCase: [], poster: null, video: null, lock: null, featured: false, publishedAt: null,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', () => ({
  get RENDER_PIPELINE_MODE() { return state.mode; },
  get RENDER_PIPELINE_PUBLIC() { return state.mode === 'on'; },
}));
vi.mock('@/lib/creator-subscriptions/cached-availability', () => ({ cachedSubscriptionAvailability: vi.fn(async () => state.availability) }));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [film], image: [] }) }));
vi.mock('@/lib/campaigns/public-catalog', () => ({ getCampaignCatalog: async () => ({ campaigns: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null, adLabels: () => ({}) }));
vi.mock('@/components/prompts/rails', () => ({ PromptRail: () => null }));
vi.mock('@/components/prompts/detail', () => ({ RelatedPrompts: () => null }));
vi.mock('@/components/prompts/detail-media', () => ({ PromptDetailMedia: () => null }));
vi.mock('@/components/prompts/poster', () => ({ TypographicPoster: () => null, posterRatio: () => '16 / 9' }));
vi.mock('@/components/ad/ad-rail', () => ({ AdRail: () => null }));
vi.mock('@/components/ad/ad-card', () => ({ AdCard: () => null, AdBanner: () => null }));
vi.mock('@/components/ui/text-swap', () => ({ TextSwap: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));

import LandingPage from '@/app/(marketing)/[locale]/page';
import TemplatePage from '@/app/(marketing)/[locale]/t/[slug]/page';
import PricingPage from '@/app/(marketing)/[locale]/pricing/page';

const prose = (html: string) => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
/** What a reader sees: the document minus its JSON-LD (the structured data may name the engine). */
const visible = (html: string) => prose(html.replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/g, ''));
const count = (html: string, needle: string) => html.split(needle).length - 1;

async function pages(locale: 'ko' | 'en') {
  const landing = renderToStaticMarkup(await LandingPage({ params: Promise.resolve({ locale }) }));
  const template = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
  const pricing = renderToStaticMarkup(await PricingPage({ params: Promise.resolve({ locale }) }));
  return { landing, template, pricing };
}

beforeEach(() => {
  state.mode = 'off';
  state.availability = { status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null };
});

describe('the template page as a decision screen', () => {
  for (const locale of ['ko', 'en'] as const) {
    const dict = getDictionary(locale);

    it(`has one make card and no second heading or link button above it (${locale})`, async () => {
      state.mode = 'review';
      const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
      const text = visible(html);
      expect(html).not.toContain('data-template-make-cta');
      expect(text).not.toContain(locale === 'ko' ? '이 장면을 내 얼굴로 만들어보세요' : 'Make this scene your own');
      expect(text).not.toContain(locale === 'ko' ? '이 장면을 내 얼굴로 만들어보세요.' : 'Put your face in this scene.');
      expect(count(html, 'id="make"')).toBe(1);
      // Before the access call answers, the only button is the sticky bar's — the card is a skeleton.
      expect(count(html, 'data-make-cta=')).toBe(1);
      expect(count(text, dict.templates.makeCta)).toBe(1);
    });

    it(`gathers the price, the facts, the wait, the AI limit and the refund in the make card (${locale})`, async () => {
      state.mode = 'review';
      const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
      const card = visible(html.slice(html.indexOf('id="make"'), html.indexOf('data-template-description')));
      expect(html.indexOf('data-template-description')).toBeGreaterThan(html.indexOf('id="make"'));
      expect(html).toMatch(/<section[^>]*id="make"[^>]*data-template-price-box/);
      expect(card).toContain(locale === 'ko' ? '6,900원' : '$4');
      expect(card).toContain(dict.studio.runtimeLabel.replace('{seconds}', '15'));
      expect(card).toContain('9:16');
      expect(card).toContain('720p');
      expect(card).toContain(dict.templates.waitValue.replace('{minutes}', '5'));
      expect(card).toContain(dict.templates.aiLimit);
      expect(card).toContain(dict.renders.notCharged);
      expect(card).toContain('data-studio-ai-note');
      expect(card).toContain('data-template-refund');
    });

    it(`draws a neutral skeleton first, never the closed panel (${locale})`, async () => {
      state.mode = 'review';
      const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
      expect(html).toContain('data-phase="pending"');
      expect(html).toContain('data-studio-pending');
      expect(html).not.toContain('data-studio-closed');
      expect(html).not.toContain('data-studio-signed-out');
    });

    it(`puts a safe-area sticky bar (price + one CTA) on phones that hides the app tabs (${locale})`, async () => {
      state.mode = 'review';
      const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
      const bar = html.match(/<div[^>]*data-make-sticky[^>]*>[\s\S]*?<\/a><\/div><\/div>/)?.[0] ?? '';
      expect(bar).toContain('data-hide-tabs');
      expect(bar).toContain('md:hidden');
      expect(bar).toContain('pb-safe');
      expect(bar).toContain('href="#make"');
      expect(bar).toContain('data-make-cta="sticky"');
      expect(prose(bar)).toContain(locale === 'ko' ? '6,900원' : '$4');
      expect(prose(bar)).toContain(dict.templates.makeCta);
    });

    it(`keeps the engine name off the consumer page (${locale})`, async () => {
      state.mode = 'review';
      const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
      expect(html).not.toContain('data-engine-chip');
      expect(visible(html).toLowerCase()).not.toContain('seedance');
      const pricing = renderToStaticMarkup(await PricingPage({ params: Promise.resolve({ locale }) }));
      expect(visible(pricing).toLowerCase()).not.toContain('seedance');
    });
  }
});

describe('one sale-state source: storefrontOpen() decides all three sentences', () => {
  for (const locale of ['ko', 'en'] as const) {
    const dict = getDictionary(locale);

    it(`says "closed" in the hero, on the template and on pricing together (${locale})`, async () => {
      state.mode = 'off';
      const { landing, template, pricing } = await pages(locale);
      expect(visible(landing)).toContain(dict.creatorJourney.preparing);
      expect(visible(landing)).not.toContain(dict.creatorJourney.ready);
      expect(visible(template)).toContain(dict.templates.makeBodyClosed);
      expect(visible(template)).not.toContain(dict.templates.makeBody);
      expect(visible(template.slice(template.indexOf('data-make-sticky')))).toContain(dict.templates.makeCtaClosed);
      expect(visible(pricing)).toContain(dict.pricing.filmsBody);
      expect(visible(pricing)).toContain(dict.pricing.subscriptionUnavailable);
      expect(visible(pricing)).not.toContain(dict.pricing.singleOpenBody);
    });

    for (const mode of ['review', 'on'] as const) {
      it(`says "one film at a time, now" in all three when the storefront is open (${mode}, ${locale})`, async () => {
        state.mode = mode;
        const { landing, template, pricing } = await pages(locale);
        expect(visible(landing)).toContain(dict.creatorJourney.ready);
        expect(visible(landing)).not.toContain(dict.creatorJourney.preparing);
        expect(visible(template)).toContain(dict.templates.makeBody);
        expect(visible(template)).not.toContain(dict.templates.makeBodyClosed);
        expect(visible(pricing)).toContain(dict.pricing.singleOpenBody);
        expect(visible(pricing)).toContain(dict.pricing.subscriptionUnavailableSingleOpen);
        expect(visible(pricing)).not.toContain(dict.pricing.filmsBody);
        expect(visible(pricing)).not.toContain(dict.pricing.subscriptionUnavailable);
      });
    }

    it(`puts what is actually sold first on pricing: single films above the monthly teaser (${locale})`, async () => {
      state.mode = 'review';
      const open = renderToStaticMarkup(await PricingPage({ params: Promise.resolve({ locale }) }));
      expect(open.indexOf('data-pricing-films')).toBeGreaterThan(-1);
      expect(open.indexOf('data-pricing-films')).toBeLessThan(open.indexOf('data-subscription-preview'));
      expect(open).toContain('data-pricing-order="single-first"');
      // A monthly plan that is really open, with single films closed, leads instead.
      state.mode = 'off';
      state.availability = { ...state.availability, status: 'open', plans: { creator: { status: 'open' }, premium: { status: 'preparing' } } };
      const monthly = renderToStaticMarkup(await PricingPage({ params: Promise.resolve({ locale }) }));
      expect(monthly).toContain('data-pricing-order="monthly-first"');
      expect(monthly.indexOf('data-subscription-preview')).toBeLessThan(monthly.indexOf('data-pricing-films'));
    });
  }
});
