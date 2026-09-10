import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPublicCatalog } from '@/lib/content/public-catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { USE_CASES } from '@/lib/prompts/schemas';
import { templatesHref } from '@/lib/prompts/links';
import { campaignsHref } from '@/lib/campaigns/links';
import { marqueeItems } from '@/lib/marquee';
import { promptLabels, presentUseCases, useCaseLabel } from '@/components/prompts/labels';
import { campaignLabels } from '@/components/campaigns/labels';
import { SITE_OG_IMAGE, SITE_TWITTER_CARD } from '@/lib/seo/og';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { Hero, HeroLede, MarqueeStrip } from '@/components/landing/sections';
import { CircleWipe } from '@/components/landing/circle-wipe';
import { Faq } from '@/components/landing/faq';
import { PromptRail } from '@/components/prompts/rails';
import { UseCaseFilter } from '@/components/prompts/filter-chips';
import { CampaignRail } from '@/components/campaigns/rails';
import { TextSwap } from '@/components/ui/text-swap';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';

/**
 * Landing — docs/TEMPLATES-IA.md: the template site's front door.
 *
 * Hero (one photo, you are the lead) → the VIDEO templates, immediately → the IMAGE templates (or
 * the honest "preparing" strip while there are none) → the campaigns recruiting right now → the
 * marquee → FAQ. Two loops, in the order a visitor meets them: make, then earn.
 *
 * Cache mode per §3.1/§4: STATIC + tags (`prompts`, `campaigns`, `catalog`) + a 1h TTL floor. No
 * `headers()`, no `cookies()`, no session read anywhere on this page or the mode silently degrades
 * to dynamic — which is why the nav's "Sign in" is an unconditional link rather than authed chrome.
 */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

/** Below this many video templates the use-case filter stays hidden (founder, 2026-09-11). */
const FILTER_MIN_TEMPLATES = 6;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
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
      siteName: dict.meta.siteName,
      images: [SITE_OG_IMAGE],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const t = dict.templates;

  // Three tagged projections, three invalidation events: a template published, a campaign moved,
  // a playbook published (the marquee still lists the studio's tools from the playbook catalog).
  const [templates, campaigns] = await Promise.all([getPromptCatalog(), getCampaignCatalog()]);
  // Founder, 2026-09-11: the strip names the engine the templates run on and the use cases they
  // carry — never the playbook catalog's tool list, which advertised software TWINGS does not run.
  const ticker = marqueeItems({
    models: [templates.totals.modelLabel],
    tools: USE_CASES.map((value) => useCaseLabel(dict, value)),
  });
  const ads = adLabels(dict, locale);
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const filterOptions = presentUseCases([...new Set(templates.video.flatMap((card) => card.useCase))].sort()).map(
    (value) => [value, useCaseLabels[value]!] as [string, string],
  );

  const recruiting = campaigns.campaigns.filter((campaign) => campaign.status === 'recruiting');
  const styles = new Map([...templates.video, ...templates.image].map((card) => [card.slug, card]));

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/" initialTheme="light" />

      <main id="main">
        <Hero locale={locale} dict={dict} showImage={templates.image.length > 0} />

        {/* §3.6: the rail runs from below the hero to the end of the content. */}
        <div id="rail-anchor" className="relative">
          <AdRail anchorId="rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          {/* The catalogue, immediately — the templates are the first scroll. */}
          <section id="gallery" data-section data-theme="light" className="section">
            <div className="band pb-24">
              <div className="border-t border-hairline pt-3 lg:pt-6">
                {/* A filter over two cards is furniture, not a tool: it appears once there is a catalogue to narrow. */}
                {filterOptions.length > 0 && templates.video.length >= FILTER_MIN_TEMPLATES && (
                  <UseCaseFilter options={filterOptions} labels={{ heading: dict.prompts.filterHeading, all: dict.prompts.filterAll }} />
                )}
              </div>

              <PromptRail
                id="video"
                heading={t.video.rail}
                lede={t.video.railLede}
                cards={templates.video}
                locale={locale}
                labels={labels}
                useCaseLabels={useCaseLabels}
                emptyLabel={t.video.emptyTitle}
                filteredEmptyLabel={dict.prompts.filterEmpty}
                topClassName="mt-4 first:mt-0 lg:mt-24"
              />
              <a href={templatesHref(locale, 'video')} data-all-video className="text-accent mt-8 inline-block font-label text-label uppercase">
                <TextSwap>{t.allVideo} →</TextSwap>
              </a>

              {/* F3 — the hero's lede, re-homed below lg after the first rail. */}
              <HeroLede dict={dict} />

              {templates.image.length > 0 ? (
                <PromptRail
                  id="image"
                  heading={t.image.rail}
                  lede={t.image.railLede}
                  cards={templates.image}
                  locale={locale}
                  labels={labels}
                  useCaseLabels={useCaseLabels}
                  emptyLabel={t.image.emptyTitle}
                  filteredEmptyLabel={dict.prompts.filterEmpty}
                />
              ) : (
                <aside data-image-soon className="mt-16 border border-hairline p-8 sm:p-10">
                  <p className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[0.95] font-black uppercase">{t.imageSoonTitle}</p>
                  <p className="mt-4 max-w-detail text-body opacity-70">{t.imageSoonBody}</p>
                  <a href={templatesHref(locale, 'image')} className="text-accent mt-7 inline-block font-label text-label uppercase">
                    <TextSwap>{t.ctaImage} →</TextSwap>
                  </a>
                </aside>
              )}
            </div>
          </section>

          {/* The earn loop: what is recruiting right now, straight under the templates it uses. */}
          {recruiting.length > 0 && (
            <section data-section data-theme="dark" className="section">
              <div className="band py-24 lg:py-32">
                <CampaignRail
                  id="campaigns"
                  heading={dict.campaigns.railRecruiting}
                  lede={dict.campaigns.railRecruitingLede}
                  cards={recruiting}
                  styles={styles}
                  locale={locale}
                  labels={campaignLabels(dict)}
                  now={Date.now()}
                />
                <a href={campaignsHref(locale)} className="text-accent mt-12 inline-block font-label text-label uppercase">
                  <TextSwap>{dict.nav.campaigns} →</TextSwap>
                </a>
              </div>
            </section>
          )}

          <MarqueeStrip dict={dict} items={ticker} />

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
                // Founder, 2026-09-10: the brand side of a campaign has to be visible here too.
                { q: dict.faq.q7, a: dict.faq.a7 },
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
