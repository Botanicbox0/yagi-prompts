import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPublicCatalog } from '@/lib/content/public-catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { USE_CASES } from '@/lib/prompts/schemas';
import { marqueeItems } from '@/lib/marquee';
import { UPGRADE_PATH, signInHref } from '@/lib/billing/links';
import { promptLabels, presentUseCases, useCaseLabel } from '@/components/prompts/labels';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { Hero, MarqueeStrip, Premise } from '@/components/landing/sections';
import { CircleWipe } from '@/components/landing/circle-wipe';
import { Faq } from '@/components/landing/faq';
import { PromptRail } from '@/components/prompts/rails';
import { UseCaseFilter } from '@/components/prompts/filter-chips';
import { SubmitStrip } from '@/components/prompts/detail';
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

  // Two tagged projections, two invalidation events (§13.2): `prompts` moves whenever a prompt is
  // published or approved, `catalog` whenever a playbook is. The landing reads both, so either one
  // refreshes it.
  const [catalog, prompts] = await Promise.all([getPublicCatalog(), getPromptCatalog()]);
  // §13.2: "marquee items can include SEEDANCE 2.5 + use-case vocab". The model leads, the
  // use cases follow, and the studio's real tool list from the playbook catalog tops it up.
  const ticker = marqueeItems({
    models: [prompts.totals.modelLabel, ...catalog.totals.models],
    tools: [...USE_CASES.map((value) => useCaseLabel(dict, value)), ...catalog.totals.tools],
  });
  const ads = adLabels(dict);

  // Founder pass (2026-08-13): gallery-first. The landing carries the FULL rails one scroll under
  // the hero — the reference form — so it shares the gallery's static-safe plumbing verbatim.
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(
    USE_CASES.map((value) => [value, useCaseLabel(dict, value)]),
  );
  const filterOptions = presentUseCases(prompts.totals.useCases).map(
    (value) => [value, useCaseLabels[value]!] as [string, string],
  );
  const signin = signInHref(`/${locale}`, locale);
  const upgrade = `${UPGRADE_PATH}?locale=${locale}`;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/" initialTheme="light" />

      <main id="main">
        <Hero locale={locale} dict={dict} />

        {/* §3.6: the rail runs from below the hero to the end of the content. */}
        <div id="rail-anchor" className="relative">
          <AdRail anchorId="rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          {/* The gallery, immediately — cards and result clips are the first scroll. */}
          <section id="gallery" data-section data-theme="light" className="section">
            <div className="band pb-24">
              <div className="border-t border-hairline pt-6">
                <UseCaseFilter
                  options={filterOptions}
                  labels={{ heading: dict.prompts.filterHeading, all: dict.prompts.filterAll }}
                />
              </div>

              <PromptRail
                id="yagi"
                heading={dict.prompts.railYagi}
                lede={dict.prompts.railYagiLede}
                cards={prompts.yagi}
                locale={locale}
                labels={labels}
                useCaseLabels={useCaseLabels}
                emptyLabel={dict.prompts.emptyYagi}
                filteredEmptyLabel={dict.prompts.filterEmpty}
                signinHref={signin}
                upgradeHref={upgrade}
              />

              <PromptRail
                id="community"
                heading={dict.prompts.railCommunity}
                lede={dict.prompts.railCommunityLede}
                cards={prompts.community}
                locale={locale}
                labels={labels}
                useCaseLabels={useCaseLabels}
                emptyLabel={dict.prompts.emptyCommunity}
                filteredEmptyLabel={dict.prompts.filterEmpty}
                signinHref={signin}
                upgradeHref={upgrade}
              />

              <SubmitStrip
                title={dict.prompts.submitStripTitle}
                body={dict.prompts.submitStripBody}
                cta={dict.prompts.submitCta}
              />
            </div>
          </section>

          <MarqueeStrip dict={dict} items={ticker} />

          <Premise dict={dict} totals={prompts.totals} />

          {/* §3.6: below 1440 this is the single ad; the rail owns the tier above it. */}
          <section data-section data-theme="light" className="section rail:hidden">
            <div className="band pb-24">
              <AdBanner labels={ads} />
            </div>
          </section>

          {/* §5.3-2: the page's one circular wipe, on its one true inversion (light → dark). */}
          <CircleWipe />

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
