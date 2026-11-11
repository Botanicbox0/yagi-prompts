import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { splitCampaigns } from '@/lib/campaigns/catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { campaignsListingMetadata } from '@/lib/seo/campaign-metadata';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { CampaignRail, CampaignSteps, CampaignsEmptyState } from '@/components/campaigns/rails';
import { CreatorCampaignHub } from '@/components/campaigns/creator-campaign-hub';
import { campaignLabels } from '@/components/campaigns/labels';
import { brandsHref } from '@/lib/campaigns/links';
import { FaqSection } from '@/lib/seo/faq-section';
import { PersonalIdentity } from '@/components/audience/personal-identity';

export const revalidate = 3600;
type RouteParams = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return campaignsListingMetadata({ locale, title: dict.meta.campaignsTitle, description: dict.meta.campaignsDescription, siteName: dict.meta.siteName });
}

/** Creator opportunities & monetization hub. Public detail URLs and private application routes keep their boundaries. */
export default async function CampaignsListingPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale), c = dict.campaigns;
  const [catalog, prompts] = await Promise.all([getCampaignCatalog(), getPromptCatalog()]);
  const split = splitCampaigns(catalog), labels = campaignLabels(dict);
  const styles = new Map([...prompts.yagi, ...prompts.community].map((card) => [card.slug, card]));
  const featuredFormats = (prompts.video ?? []).slice(0, 3);
  const now = Date.now();

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest="/campaigns" />
      <main id="main" data-campaigns>
        <section data-section data-theme="light" className="section">
          <div className="audience-shell pt-28 pb-16 lg:pt-36">
            <div className="max-w-4xl">
              <p className="audience-eyebrow">{dict.audience.creator}</p>
              <h1 className="audience-title mt-4 max-w-4xl">{dict.creatorJourney.campaignHeading}</h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-black/65">{c.intro}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a
                  href="/campaigns/mine"
                  data-my-campaigns
                  className="inline-flex min-h-11 items-center rounded-full bg-[#3875C5] px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#3063A7]"
                >
                  {dict.audience.myCampaigns} ↗
                </a>
                <a
                  href={`/${locale}/direct`}
                  className="inline-flex min-h-11 items-center rounded-full border border-hairline bg-white px-5 py-2.5 text-xs font-semibold text-[#0E1013] transition-colors hover:border-[#3875C5]"
                >
                  {c.directEarnCta}
                </a>
              </div>
            </div>

            {/* Creator Campaign Monetization Hub: 2 Ways to Earn (Official Format vs Guided Custom Video) + Checklist */}
            <CreatorCampaignHub
              locale={locale}
              copy={c.hub}
              featuredFormats={featuredFormats}
              myCampaignsHref="/campaigns/mine"
              directVideoHref={`/${locale}/direct`}
            />

            <section id="creators" data-creators className="mt-12 scroll-mt-24">
              {catalog.totals.live === 0 ? (
                <CampaignsEmptyState title={c.emptyTitle} body={c.emptyBody} cta={c.emptyCta} href="/account" />
              ) : (
                <>
                  <CampaignRail id="recruiting" heading={c.railRecruiting} lede={c.railRecruitingLede} cards={split.recruiting} styles={styles} locale={locale} labels={labels} now={now} />
                  <CampaignRail id="running" heading={c.railRunning} lede={c.railRunningLede} cards={split.running} styles={styles} locale={locale} labels={labels} now={now} />
                </>
              )}
              <CampaignSteps heading={c.stepsHeading} steps={[c.step1, c.step2, c.step3, c.step4, c.step5]} />
            </section>

            <aside id="brands" data-legacy-brand-entry className="mt-16 scroll-mt-24 border-t border-hairline pt-6">
              <p className="text-sm opacity-60">{dict.brandLanding.legacyBrandLink}</p>
              <a href={brandsHref(locale)} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
                {dict.brandLanding.legacyBrandCta} ↗
              </a>
            </aside>
          </div>
        </section>
        <FaqSection dict={dict} locale={locale} placement="campaign" path={`/${locale}/campaigns`} />
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
