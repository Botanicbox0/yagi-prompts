import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPublicCatalog } from '@/lib/content/public-catalog';
import { featuredCards } from '@/lib/content/catalog';
import { marqueeItems } from '@/lib/marquee';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import {
  Featured,
  Hero,
  MarqueeStrip,
  Premise,
  PricingSummary,
} from '@/components/landing/sections';
import { HowItReads } from '@/components/landing/how-it-reads';
import { CircleWipe } from '@/components/landing/circle-wipe';
import { Faq } from '@/components/landing/faq';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';

/**
 * Landing — PLAN §3.1, in the §5 register.
 *
 * Cache mode per §3.1/§4: STATIC + tag `catalog` + a 1h TTL floor. No `headers()`, no `cookies()`,
 * no session read anywhere on this page or the mode silently degrades to dynamic — which is why
 * the nav's "Sign in" is an unconditional link rather than authed chrome.
 *
 * Section rhythm (§5.1, hard inversions): hero dark · premise light · marquee dark ·
 * how-it-reads light · [circle wipe] · featured dark · pricing light · FAQ dark · footer dark.
 */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return {
    title: dict.meta.siteName,
    description: dict.meta.landingDescription,
    alternates: { canonical: `/${locale}`, languages: { en: '/en', ko: '/ko', 'x-default': '/en' } },
    openGraph: {
      type: 'website',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}`,
      title: `${dict.meta.siteName} — ${dict.meta.tagline}`,
      description: dict.meta.landingDescription,
    },
  };
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);

  const catalog = await getPublicCatalog();
  const cards = featuredCards(catalog);
  const ticker = marqueeItems(catalog.totals);
  const ads = adLabels(dict);

  return (
    <>
      {/* The hero is dark, so the bar starts inverted rather than flashing light on first paint. */}
      <MarketingNav locale={locale} dict={dict} rest="/" initialTheme="dark" />

      <main id="main">
        <Hero locale={locale} dict={dict} />

        {/* §3.6: the rail runs from below the hero to the end of the content. */}
        <div id="rail-anchor" className="relative">
          <AdRail anchorId="rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <Premise dict={dict} totals={catalog.totals} />

          <MarqueeStrip dict={dict} items={ticker} />

          <HowItReads
            eyebrow={dict.howItReads.eyebrow}
            title={dict.howItReads.title}
            panels={[
              {
                index: dict.howItReads.stepsIndex,
                title: dict.howItReads.stepsTitle,
                body: dict.howItReads.stepsBody,
              },
              {
                index: dict.howItReads.blocksIndex,
                title: dict.howItReads.blocksTitle,
                body: dict.howItReads.blocksBody,
              },
              {
                index: dict.howItReads.unlockIndex,
                title: dict.howItReads.unlockTitle,
                body: dict.howItReads.unlockBody,
              },
            ]}
          />

          {/* §5.3-2: the page's one circular wipe, on its one true inversion (light → dark). */}
          <CircleWipe />

          <Featured locale={locale} dict={dict} cards={cards} />

          {/* §3.6: below 1440 this is the single ad; the rail owns the tier above it. */}
          <section data-section data-theme="dark" className="section rail:hidden">
            <div className="band pb-24">
              <AdBanner labels={ads} />
            </div>
          </section>

          <PricingSummary locale={locale} dict={dict} totals={catalog.totals} />

          <section data-section data-theme="dark" className="section">
            <Faq
              eyebrow={dict.faq.eyebrow}
              title={dict.faq.title}
              items={[
                { q: dict.faq.q1, a: dict.faq.a1 },
                { q: dict.faq.q2, a: dict.faq.a2 },
                { q: dict.faq.q3, a: dict.faq.a3 },
                { q: dict.faq.q4, a: dict.faq.a4 },
                { q: dict.faq.q5, a: dict.faq.a5 },
                { q: dict.faq.q6, a: dict.faq.a6 },
              ]}
            />
          </section>
        </div>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
