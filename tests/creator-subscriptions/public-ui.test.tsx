import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PublicSubscriptionAvailability } from '@/components/twings/subscription-availability';

const state = vi.hoisted(() => ({
  availability: { status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null } as PublicSubscriptionAvailability,
  termsApproved: false,
}));
const film = vi.hoisted(() => ({
  id: 'film', slug: 'supported-film', title: 'Film', titleKo: '영상', medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 15,
  aspectDefault: '9:16', priceCents: 400, priceKrw: 6900, price1080Cents: 0, price1080Krw: 0,
  source: 'yagi', authorHandle: null, models: [], modelLabels: [], useCase: [], poster: null, video: null, lock: null, featured: false, publishedAt: null,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', () => ({ RENDER_PIPELINE_PUBLIC: false }));
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
vi.mock('@/components/twings/studio', () => ({ TwingsStudio: () => null }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'ko' }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));
vi.mock('@/lib/creator-subscriptions/evidence', () => ({ subscriptionTermsApproved: vi.fn(async () => state.termsApproved) }));
vi.mock('@/components/playbook/markdown', () => ({ Markdown: () => null }));

import LandingPage from '@/app/(marketing)/[locale]/page';
import TemplatePage from '@/app/(marketing)/[locale]/t/[slug]/page';
import SubscriptionTermsPage from '@/app/(app)/billing/subscription/terms/page';

function answers(html: string): string[] {
  const source = html.match(/<script id="faq-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  expect(source).toBeDefined();
  return JSON.parse(source!).mainEntity.map((item: { acceptedAnswer: { text: string } }) => item.acceptedAnswer.text);
}

describe('public subscription SSR state', () => {
  beforeEach(() => {
    state.availability = { status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null };
    state.termsApproved = false;
  });
  it.each(['ko', 'en'] as const)('renders Creator-only readiness and matching visible FAQ/JSON-LD before hydration in %s', async locale => {
    const copy = getDictionary(locale);
    state.availability = { ...state.availability, status: 'open', plans: { creator: { status: 'open' }, premium: { status: 'preparing' } } };
    const landing = renderToStaticMarkup(await LandingPage({ params: Promise.resolve({ locale }) }));
    const template = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
    for (const html of [landing, template]) {
      expect(answers(html)).toContain(copy.faq.subscriptionCreatorOpen.a1);
      expect(answers(html)).toContain(copy.faq.subscriptionCreatorOpen.a2);
      expect(answers(html).some(answer => answer.includes(copy.seo.generationClosed))).toBe(false);
      const prose = html.replaceAll('&#x27;', "'");
      expect(prose).toContain(copy.faq.subscriptionCreatorOpen.a2);
    }
    expect(landing.replaceAll('&#x27;', "'")).toContain(copy.creatorJourney.subscriptionReady);
    expect(template.replaceAll('&#x27;', "'")).toContain(copy.templates.makeBodySubscription);
    expect(template).toContain('data-template-subscription="creator"');
    expect(template.replaceAll('&#x27;', "'")).not.toContain(copy.templates.makeBodyClosed);
    expect(template.replaceAll('&#x27;', "'")).not.toContain(copy.pricing.subscriptionTemplateNote.replace('{count}', '4').replace('{premiumCount}', '8'));
  });
  it('shows the opened Premium estimate and keeps its FAQ in the same state', async () => {
    const copy = getDictionary('ko');
    state.availability = { ...state.availability, status: 'open', plans: { creator: { status: 'open' }, premium: { status: 'open' } }, editing: 'open', premiumEditRequestsPerPeriod: 30 };
    const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale: 'ko', slug: film.slug }) }));
    expect(html).toContain('data-template-subscription="premium"');
    expect(answers(html)).toContain(copy.faq.subscriptionOpen.a2);
    expect(html).toContain(copy.pricing.subscriptionTemplateOpenNote.replace('{count}', '4').replace('{premiumCount}', '8'));
  });
  it('shows a pause without promising new enrollment or calling it a preparation state', async () => {
    const copy = getDictionary('ko');
    state.availability = { ...state.availability, status: 'paused', plans: { creator: { status: 'paused' }, premium: { status: 'paused' } } };
    const landing = renderToStaticMarkup(await LandingPage({ params: Promise.resolve({ locale: 'ko' }) }));
    const template = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale: 'ko', slug: film.slug }) }));
    expect(landing).toContain(copy.creatorJourney.subscriptionPaused);
    expect(template).toContain(copy.templates.makeBodySubscriptionPaused);
    expect(template).toContain('data-template-subscription="paused"');
    expect(answers(landing)).toContain(copy.faq.subscriptionPaused.a2);
    expect(answers(template)).toContain(copy.faq.subscriptionPaused.a2);
  });
  it('uses independent terms approval while enrollment remains preparing', async () => {
    const copy = getDictionary('ko').creatorSubscription;
    state.termsApproved = true;
    const approved = renderToStaticMarkup(await SubscriptionTermsPage());
    expect(approved).toContain('data-subscription-terms-status="approved"');
    expect(approved).not.toContain(copy.termsDraft);
    state.termsApproved = false;
    const draft = renderToStaticMarkup(await SubscriptionTermsPage());
    expect(draft).toContain('data-subscription-terms-status="draft"');
    expect(draft).toContain(copy.termsDraft);
  });
});
