import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { SITE_TWITTER_CARD, siteOgImage } from '@/lib/seo/og';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { FaqSection } from '@/lib/seo/faq-section';
import { CREATOR_PLANS, quoteSubscriptionVideo, type CreatorPlanId } from '@/lib/twings/subscription-plan';
import { SubscriptionPlanComparison, SubscriptionPricingText, SubscriptionEditingPreview, type PublicCreatorPlan } from '@/components/twings/subscription-plan-comparison';
import { SubscriptionAvailabilityProvider } from '@/components/twings/subscription-availability';
import { CreatorPreview } from '@/components/audience/creator-preview';
import { formatKrw } from '@/lib/twings/products';
import { cachedSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';
import { storefrontOpen } from '@/lib/auth/purchase-gate';

/**
 * Single purchases plus the upcoming Creator and Premium subscription designs.
 * No enrollment or billing authorization until the separate launch requirements are met.
 *
 * Static, like the landing. What is actually sold comes first (docs/PLATFORM-2.0.md §15.3-3): single
 * films while `storefrontOpen()`, with the monthly plans below as a "준비 중" teaser — and the monthly
 * comparison first only when it is the one that is open. Individual prices stay on the template pages.
 * The comparison receives display counts only, never an account allowance.
 */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return {
    title: dict.meta.pricingTitle,
    description: dict.meta.pricingDescription,
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: { en: '/en/pricing', ko: '/ko/pricing', 'x-default': '/en/pricing' },
    },
    openGraph: {
      type: 'website',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}/pricing`,
      title: `${dict.meta.pricingTitle} — ${dict.meta.siteName}`,
      description: dict.meta.pricingDescription,
      siteName: dict.meta.siteName,
      images: [siteOgImage(locale)],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const p = dict.pricing;

  const [catalog, availability] = await Promise.all([getPromptCatalog(), cachedSubscriptionAvailability()]);
  const plans: PublicCreatorPlan[] = (Object.keys(CREATOR_PLANS) as CreatorPlanId[]).map(id => ({
    id,
    price: locale === 'ko' ? formatKrw(CREATOR_PLANS[id].priceKrw) : `₩${CREATOR_PLANS[id].priceKrw.toLocaleString('en-US')}`,
    filmCounts: {
      10: quoteSubscriptionVideo({ seconds: 10, resolution: '720p', aspect: '9:16' }, id)!.maxPerMonth,
      15: quoteSubscriptionVideo({ seconds: 15, resolution: '720p', aspect: '9:16' }, id)!.maxPerMonth,
      30: quoteSubscriptionVideo({ seconds: 30, resolution: '720p', aspect: '9:16' }, id)!.maxPerMonth,
    },
  }));
  const examples = catalog.video.filter(card => card.poster && card.video).slice(0, 3);
  // Deliberately exclude legacy dictionary entries from the public client payload.
  const comparisonCopy = {
    subscriptionDurationLabel: p.subscriptionDurationLabel, subscriptionDuration: p.subscriptionDuration,
    subscriptionPlans: p.subscriptionPlans, subscriptionPeriod: p.subscriptionPeriod,
    subscriptionTax: p.subscriptionTax, subscriptionFilmCount: p.subscriptionFilmCount,
    subscriptionFilmLength: p.subscriptionFilmLength, subscriptionEditingTitle: p.subscriptionEditingTitle,
    subscriptionEditingStatus: p.subscriptionEditingStatus, subscriptionMore: p.subscriptionMore,
    subscriptionBrowse: p.subscriptionBrowse, subscriptionCountBasis: p.subscriptionCountBasis,
    subscriptionTitle: p.subscriptionTitle, subscriptionStatus: p.subscriptionStatus,
    subscriptionUnavailable: p.subscriptionUnavailable, subscriptionUnavailableSingleOpen: p.subscriptionUnavailableSingleOpen, subscriptionOpenTitle: p.subscriptionOpenTitle,
    subscriptionOpenStatus: p.subscriptionOpenStatus, subscriptionOpenBody: p.subscriptionOpenBody,
    subscriptionPausedStatus: p.subscriptionPausedStatus, subscriptionPausedBody: p.subscriptionPausedBody,
    subscriptionStart: p.subscriptionStart, subscriptionEditingOpenStatus: p.subscriptionEditingOpenStatus,
    subscriptionEditRequestLimit: p.subscriptionEditRequestLimit, subscriptionEditCountNotice: p.subscriptionEditCountNotice,
  };
  const textCopy = { lede: p.lede, subscriptionOpenLede: p.subscriptionOpenLede, singleLede: p.singleLede, filmsBody: p.filmsBody, filmsOpenBody: p.filmsOpenBody, singleOpenBody: p.singleOpenBody };
  const shopOpen = storefrontOpen();
  const singleFirst = shopOpen || availability.status !== 'open';
  const editingCopy = { subscriptionEditingStatus: p.subscriptionEditingStatus, subscriptionEditingOpenStatus: p.subscriptionEditingOpenStatus, subscriptionEditingTitle: p.subscriptionEditingTitle, subscriptionPromptEditingSoon: p.subscriptionPromptEditingSoon, subscriptionEditingOpenBody: p.subscriptionEditingOpenBody, subscriptionEditingExample: p.subscriptionEditingExample, subscriptionEditingBoundary: p.subscriptionEditingBoundary };

  // Single films: what a reader can buy today when the storefront is open — a card on top, then.
  const singleBlock = (
    <aside data-pricing-films data-pricing-films-open={shopOpen ? 'true' : 'false'} className={singleFirst ? 'rounded-2xl border border-hairline p-6 sm:p-8' : 'mt-9 flex flex-wrap items-center justify-between gap-5'}>
      <div className="max-w-2xl">
        <h2 className={singleFirst ? 'text-xl font-semibold sm:text-2xl' : 'text-lg font-semibold'}>{singleFirst ? p.singleTitle : p.filmsTitle}</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/65"><SubscriptionPricingText copy={textCopy} field="single" oneTimeAvailable={shopOpen} /></p>
        {singleFirst && shopOpen && <p data-pricing-refund className="mt-2 text-sm leading-relaxed text-black/65">{dict.renders.notCharged}</p>}
      </div>
      <a href={templatesHref(locale)} className={singleFirst ? 'mt-5 inline-flex min-h-12 items-center gap-3 rounded-full bg-black px-6 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent' : 'inline-flex min-h-12 items-center gap-3 text-sm font-medium underline underline-offset-4'}>{p.filmsCta}<span aria-hidden="true">↗</span></a>
    </aside>
  );
  // Monthly plans: below as a "준비 중" teaser while preparing; first only when they are the open offer.
  const monthlyBlock = (
    <section id="monthly" className={`${singleFirst ? 'mt-10' : ''} scroll-mt-24`}>
      {/* Google Play app only (PLATFORM-2.0 §5.1): the plan buttons step aside for one sentence. */}
      <p data-store-note className="mb-5 text-sm leading-relaxed text-black/75">{dict.appShell.store.note}</p>
      <SubscriptionPlanComparison plans={plans} copy={comparisonCopy} browseHref={templatesHref(locale)} oneTimeAvailable={shopOpen} />
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <p className="font-semibold">{p.subscriptionShared}</p>
        {[p.subscriptionFeatureFace, p.subscriptionFeatureVideo].map(feature => <p key={feature}><span aria-hidden="true" className="mr-2 text-accent">✓</span>{feature}</p>)}
      </div>
      <details className="group mt-6 border-y border-hairline py-1">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium [&::-webkit-details-marker]:hidden">{p.subscriptionMixedLabel}<span aria-hidden="true" className="text-accent group-open:hidden">+</span><span aria-hidden="true" className="hidden text-accent group-open:block">−</span></summary>
        <p className="max-w-3xl pb-5 text-sm leading-relaxed text-black/65">{p.subscriptionMixed}</p>
      </details>
    </section>
  );

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/pricing" initialTheme="light" />

      <SubscriptionAvailabilityProvider initialAvailability={availability}>
      <main id="main" data-creator-pricing>
        <section data-section data-theme="light" className="section">
          <div className="audience-shell pt-24 pb-14 lg:pt-28 lg:pb-20">
            <header className="max-w-3xl">
              <p className="audience-eyebrow">{p.eyebrow}</p>
              <h1 className="mt-4 font-display text-[clamp(2rem,3.5vw,3rem)] leading-[1.12] font-bold tracking-tight">{p.line1}<br />{shopOpen && availability.status !== 'open' ? p.singleLine2 : p.line2}</h1>
              <p data-service-definition className="mt-3 max-w-2xl text-sm leading-relaxed text-black/65"><SubscriptionPricingText copy={textCopy} field="lede" oneTimeAvailable={shopOpen} /></p>
            </header>
            {/* Reading order is selling order: what can be bought first (docs/PLATFORM-2.0.md §15.3-3). */}
            <div data-pricing-order={singleFirst ? 'single-first' : 'monthly-first'} className="mt-6">
              {singleFirst ? <>{singleBlock}{monthlyBlock}</> : <>{monthlyBlock}{singleBlock}</>}
            </div>
          </div>
        </section>

        <SubscriptionEditingPreview copy={editingCopy} />

        <section data-section data-theme="light" data-pricing-examples className="section">
          <div className="audience-shell py-14 lg:py-20">
            <div className="flex flex-wrap items-end justify-between gap-5"><div><h2 className="text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">{p.examplesTitle}</h2><p className="mt-3 text-sm leading-relaxed text-black/65">{p.examplesBody}</p></div><a href={templatesHref(locale)} className="inline-flex min-h-11 items-center gap-3 text-sm underline underline-offset-4">{p.filmsCta}<span aria-hidden="true">↗</span></a></div>
            {examples.length ? <div className="mt-7 grid gap-6 sm:grid-cols-3">{examples.map(card => {
              const title = locale === 'ko' ? card.titleKo || card.title : card.title;
              return <article key={card.slug} data-pricing-example={card.slug} className="min-w-0">
                <CreatorPreview poster={card.poster} video={card.video} title={title} href={templateHref(locale, card.slug)} ratio="4 / 3" priority={false} fallback={null} labels={{ play: dict.creatorJourney.playPreview, pause: dict.creatorJourney.pausePreview }} />
                <div className="mt-3 flex items-start justify-between gap-4"><a href={templateHref(locale, card.slug)} className="min-w-0 text-sm leading-relaxed font-medium">{title} ↗</a>{card.runtimeSeconds && <span className="shrink-0 text-xs leading-6 text-black/60">{interpolate(dict.studio.runtimeLabel, { seconds: String(card.runtimeSeconds) })}</span>}</div>
              </article>;
            })}</div> : <p className="mt-7 text-sm text-black/65">{p.examplesEmpty}</p>}
            <aside data-pricing-photo-guide className="mt-10 border-t border-hairline pt-6"><h3 className="text-base font-semibold">{p.photoTitle}</h3><p className="mt-2 max-w-3xl text-sm leading-relaxed text-black/65">{p.photoBody}</p></aside>
          </div>
        </section>

        <FaqSection dict={dict} locale={locale} placement="pricing" path={`/${locale}/pricing`} availability={availability} />
      </main>
      </SubscriptionAvailabilityProvider>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
