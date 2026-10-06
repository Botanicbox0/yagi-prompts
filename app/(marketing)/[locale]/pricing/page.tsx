import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatCount, interpolate } from '@/lib/i18n/format';
import { formatTemplatePrice, isForSale, priceRangeFor } from '@/lib/twings/products';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { SITE_TWITTER_CARD, siteOgImage } from '@/lib/seo/og';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { FaqSection } from '@/lib/seo/faq-section';
import { Reveal } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';
import { CREATOR_PLAN, quoteSubscriptionVideo, templateSubscriptionQuote } from '@/lib/twings/subscription-plan';
import { SubscriptionUsagePreview } from '@/components/twings/subscription-usage-preview';
import { formatKrw } from '@/lib/twings/products';

/**
 * Single purchases plus the upcoming 19,000 won subscription design.
 * No enrollment or billing authorization until the separate launch requirements are met.
 *
 * The cookie model (§15.3) left this page with the prompts it priced (2026-09-05); `lib/cookies` and
 * the Stripe pack stay in the codebase as the credit ledger a consumable in-app purchase will need.
 * Static, like the landing — nothing here may know the viewer, which is exactly why the page can
 * present the prices but never a balance.
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

  const catalog = await getPromptCatalog();
  const all = [...catalog.video, ...catalog.image];
  const forSale = all.filter(isForSale);
  const pending = all.length - forSale.length;
  // The range and the table in the reader's currency: won on /ko, dollars on /en (2026-09-07).
  const filmRange = priceRangeFor(all, locale);
  const subscriptionOptions = [
    ...[
      { seconds: 10, resolution: '720p' as const, aspect: '9:16' },
      { seconds: 15, resolution: '720p' as const, aspect: '9:16' },
      { seconds: 25, resolution: '720p' as const, aspect: '4:3' },
      { seconds: 30, resolution: '720p' as const, aspect: '9:16' },
      { seconds: 10, resolution: '1080p' as const, aspect: '9:16' },
    ].map(input => ({ id: `example-${input.seconds}-${input.resolution}-${input.aspect}`, label: interpolate(p.subscriptionExample, { seconds: String(input.seconds), resolution: input.resolution, aspect: input.aspect }), monthlyPercent: quoteSubscriptionVideo(input)!.monthlyPercent })),
    ...forSale.flatMap(card => {
      const quote = templateSubscriptionQuote(card);
      return quote ? [{ id: card.slug, label: `${locale === 'ko' && card.titleKo ? card.titleKo : card.title} · 720p`, monthlyPercent: quote.monthlyPercent }] : [];
    }),
  ];
  const planPrice = locale === 'ko' ? formatKrw(CREATOR_PLAN.priceKrw) : `KRW ${CREATOR_PLAN.priceKrw.toLocaleString('en-US')}`;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/pricing" initialTheme="light" />

      <main id="main">
        <section data-section data-theme="light" className="section">
          <div className="band pt-30 pb-20 lg:pt-40 lg:pb-24">
            <p className="text-accent font-label text-eyebrow uppercase">{p.eyebrow}</p>
            <Reveal immediate delay={0.05} as="h1" lines={[p.line1, p.line2]} className="mt-7 font-display text-title font-black uppercase" />
            <p className="mt-8 max-w-detail text-body opacity-70">{p.lede}</p>
            {!RENDER_PIPELINE_PUBLIC && <p data-generation-availability className="mt-6 max-w-detail border-l-2 border-current pl-4 text-sm leading-relaxed">{dict.seo.generationClosed}</p>}
            <p data-service-definition className="mt-6 max-w-detail text-body opacity-70">{dict.seo.definition}</p>

            <section id="monthly" data-pricing-subscription="preparing" className="mt-12 grid gap-8 border border-hairline p-6 sm:p-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div>
                <p className="font-label text-eyebrow text-accent">{p.subscriptionStatus}</p>
                <h2 className="mt-4 font-display text-2xl font-black">{p.subscriptionTitle}</h2>
                <p data-subscription-price className="mt-6 font-display text-[clamp(2rem,5vw,3.5rem)] leading-none font-black">{interpolate(p.subscriptionPrice, { price: planPrice })}</p>
                <p className="mt-3 text-xs opacity-60">{p.subscriptionTax}</p>
                <p className="mt-8 font-display text-xl font-black">{p.subscriptionHeadline}</p>
                <p className="mt-3 text-sm leading-relaxed opacity-75">{p.subscriptionDescription}</p>
                <p className="mt-3 text-sm leading-relaxed opacity-75">{p.subscriptionMixed}</p>
                <p data-subscription-unavailable className="mt-6 border-l-2 border-accent pl-4 text-sm leading-relaxed">{p.subscriptionUnavailable}</p>
              </div>
              <div>
                <ul className="space-y-3 text-sm leading-relaxed opacity-75">
                  <li>{p.subscriptionReset}</li>
                  <li>{p.subscriptionOverflow}</li>
                </ul>
                <SubscriptionUsagePreview options={subscriptionOptions} copy={p} />
              </div>
            </section>

            <div data-pricing-films className="mt-10 flex flex-wrap items-end justify-between gap-6 border border-hairline p-6">
              <div>
                <p className="font-label text-label uppercase">{p.filmsTitle}</p>
                <p className="mt-2 max-w-detail text-body opacity-70">
                  {filmRange ? interpolate(p.filmsBody, filmRange) : p.noneForSale}
                </p>
              </div>
              <a href={templatesHref(locale, 'video')} className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
                <TextSwap>{p.filmsCta} →</TextSwap>
              </a>
            </div>

            {/* Every template for sale, its own price — a table, because that is what the question is. */}
            <h2 className="mt-14 font-display text-[clamp(1.6rem,3vw,2.4rem)] leading-[0.95] font-black uppercase">{p.tableHeading}</h2>
            {forSale.length === 0 ? (
              <p className="mt-6 max-w-detail text-body opacity-70">{p.noneForSale}</p>
            ) : (
              <div className="mt-6 overflow-x-auto">
                <table data-pricing-table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-hairline font-label text-eyebrow uppercase opacity-60">
                      <th scope="col" className="py-3 pr-4">{p.colTemplate}</th>
                      <th scope="col" className="py-3 pr-4">{p.colMedium}</th>
                      <th scope="col" className="py-3 pr-4">{p.colRuntime}</th>
                      <th scope="col" className="py-3 text-right">{p.colPrice}</th>
                      <th scope="col" className="py-3 pl-5">{p.colSubscription}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forSale.map((card) => (
                      <tr key={card.slug} data-pricing-row={card.slug} className="border-b border-hairline">
                        <td className="py-3 pr-4">
                          <a href={templateHref(locale, card.slug)} className="font-display text-[1.05rem] leading-none font-black uppercase">
                            {locale === 'ko' && card.titleKo ? card.titleKo : card.title}
                          </a>
                        </td>
                        <td className="py-3 pr-4 font-label text-eyebrow uppercase opacity-60">{dict.nav[card.medium]}</td>
                        <td className="py-3 pr-4 font-mono text-code opacity-70">
                          {card.medium === 'video' && card.runtimeSeconds ? interpolate(dict.studio.runtimeLabel, { seconds: String(card.runtimeSeconds) }) : '—'}
                        </td>
                        <td className="py-3 text-right font-mono text-code text-accent">{formatTemplatePrice(card, locale)}</td>
                        <td data-subscription-template={card.slug} className="py-3 pl-5 text-sm opacity-70">{templateSubscriptionQuote(card) ? interpolate(p.subscriptionTemplateNote, { count: String(templateSubscriptionQuote(card)!.maxPerMonth) }) : p.subscriptionNotIncluded}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pending > 0 && (
              <p className="mt-4 font-mono text-code opacity-60">{interpolate(p.pendingNote, { count: formatCount(pending, locale) })}</p>
            )}
            <p className="mt-6 font-mono text-code opacity-60">{p.note}</p>
          </div>
        </section>

        <FaqSection dict={dict} locale={locale} placement="template" path={`/${locale}/pricing`} theme="dark" />
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
