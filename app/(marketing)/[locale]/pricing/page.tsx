import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatCount, interpolate } from '@/lib/i18n/format';
import { formatPrice, isForSale, priceRange } from '@/lib/twings/products';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { SITE_OG_IMAGE, SITE_TWITTER_CARD } from '@/lib/seo/og';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { Faq } from '@/components/landing/faq';
import { Reveal } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * Pricing — docs/TEMPLATES-IA.md §4: one price per template, paid per render, no subscription.
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
      images: [SITE_OG_IMAGE],
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
  const range = priceRange(all);
  const filmRange = range ? { min: formatPrice(range.minCents), max: formatPrice(range.maxCents) } : null;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/pricing" initialTheme="light" />

      <main id="main">
        <section data-section data-theme="light" className="section">
          <div className="band pt-30 pb-20 lg:pt-40 lg:pb-24">
            <p className="text-accent font-label text-eyebrow uppercase">{p.eyebrow}</p>
            <Reveal immediate delay={0.05} as="h1" lines={[p.line1, p.line2]} className="mt-7 font-display text-title font-black uppercase" />
            <p className="mt-8 max-w-detail text-body opacity-70">{p.lede}</p>

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
                        <td className="py-3 text-right font-mono text-code text-accent">{formatPrice(card.priceCents)}</td>
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

        <section data-section data-theme="dark" className="section">
          <Faq
            eyebrow={dict.faq.eyebrow}
            title={dict.faq.title}
            items={[
              { q: dict.faq.q2, a: dict.faq.a2 },
              { q: dict.faq.q4, a: dict.faq.a4 },
              { q: dict.faq.q3, a: dict.faq.a3 },
              { q: dict.faq.q1, a: dict.faq.a1 },
            ]}
          />
        </section>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
