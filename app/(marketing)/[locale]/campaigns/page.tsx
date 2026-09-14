import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { splitCampaigns } from '@/lib/campaigns/catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import type { PromptCard } from '@/lib/prompts/catalog';
import { campaignsListingMetadata } from '@/lib/seo/campaign-metadata';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail } from '@/components/ad/ad-rail';
import { AdCard } from '@/components/ad/ad-card';
import { CampaignRail, CampaignSteps, CampaignsEmptyState } from '@/components/campaigns/rails';
import { BrandSection } from '@/components/campaigns/brand-section';
import { CREATORS_ANCHOR, CampaignHero, CampaignPrinciples, CampaignProof, CampaignReelSection } from '@/components/campaigns/brand-landing';
import { campaignLabels } from '@/components/campaigns/labels';
import { BRANDS_ANCHOR } from '@/lib/campaigns/links';
import { legalDocument } from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';

/**
 * `/[locale]/campaigns` — docs/CAMPAIGNS.md §6 + §13.
 *
 * Since 2026-09-14 this is the BRAND landing first (founder: "브랜드가 보고 캠페인 의뢰하는
 * 랜딩페이지"): what a campaign is, four studio formats playing, the three-part mechanism that is
 * the moat, the one campaign that has run, and the enquiry form. The creator half — recruiting and
 * running rails, the five steps — follows under `#creators`, because creators still arrive here
 * from the nav and from recruiting mails.
 *
 * Cache mode is unchanged: **static + tag `campaigns` + a 1h TTL floor**. Nothing here varies by
 * reader. The clock is read once at render (D-day chips), the two projections it joins are both
 * tagged, and a lost invalidation self-heals within the hour.
 */
export const revalidate = 3600;

interface RouteParams {
  params: Promise<{ locale: string }>;
}

function localeOf(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  return campaignsListingMetadata({
    locale,
    title: dict.meta.campaignsTitle,
    description: dict.meta.campaignsDescription,
    siteName: dict.meta.siteName,
  });
}

export default async function CampaignsListingPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const [catalog, prompts] = await Promise.all([getCampaignCatalog(), getPromptCatalog()]);

  const now = Date.now();
  const split = splitCampaigns(catalog);
  const labels = campaignLabels(dict);
  const ads = adLabels(dict, locale);
  const styles = new Map<string, PromptCard>([...prompts.yagi, ...prompts.community].map((card) => [card.slug, card]));
  const empty = catalog.totals.live === 0;
  const c = dict.campaigns;
  // The brand form's format picker: every published video template, in the reader's language.
  const formatOptions = prompts.video.map((card) => ({ slug: card.slug, title: locale === 'ko' && card.titleKo ? card.titleKo : card.title }));
  const privacy = { href: legalHref(locale, 'privacy'), label: legalDocument('privacy', locale).title };

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/campaigns" initialTheme="light" />

      <main id="main" data-campaigns className="relative">
        <div id="campaigns-rail-anchor" className="relative">
          <AdRail anchorId="campaigns-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          {/* Brand half — docs/CAMPAIGNS.md §13 */}
          <CampaignHero copy={c.landing} brandHref={`#${BRANDS_ANCHOR}`} creatorHref={`#${CREATORS_ANCHOR}`} />
          <CampaignReelSection copy={c.landing} />
          <CampaignPrinciples copy={c.landing} />
          <CampaignProof copy={c.landing} />

          <section data-section data-theme="light" className="section">
            <div className="band pb-24 lg:pb-32">
              <BrandSection locale={locale} copy={c.brands} templates={formatOptions} privacy={privacy} />

              {/* Creator half — the rails and the five steps, under one anchor the hero's second door points at. */}
              <section id={CREATORS_ANCHOR} data-creators className="mt-24 scroll-mt-24 border-t border-hairline pt-12 lg:mt-32 lg:pt-16">
                <p className="text-accent font-label text-eyebrow uppercase">{c.landing.creatorsEyebrow}</p>
                <h2 className="mt-6 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.92] font-black uppercase">
                  {c.line1}
                  <br />
                  {c.line2}
                </h2>
                <p className="mt-8 max-w-detail text-body opacity-70">{c.intro}</p>

                {empty ? (
                  <CampaignsEmptyState title={c.emptyTitle} body={c.emptyBody} cta={c.emptyCta} href="/account" />
                ) : (
                  <div className="mt-10 border-t border-hairline pt-6">
                    <CampaignRail
                      id="recruiting"
                      heading={c.railRecruiting}
                      lede={c.railRecruitingLede}
                      cards={split.recruiting}
                      styles={styles}
                      locale={locale}
                      labels={labels}
                      now={now}
                    />
                    <CampaignRail
                      id="running"
                      heading={c.railRunning}
                      lede={c.railRunningLede}
                      cards={split.running}
                      styles={styles}
                      locale={locale}
                      labels={labels}
                      now={now}
                    />
                  </div>
                )}

                <CampaignSteps heading={c.stepsHeading} steps={[c.step1, c.step2, c.step3, c.step4, c.step5]} />
              </section>
            </div>
          </section>
        </div>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
