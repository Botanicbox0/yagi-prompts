import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { splitCampaigns } from '@/lib/campaigns/catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { campaignsListingMetadata } from '@/lib/seo/campaign-metadata';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { CampaignRail, CampaignSteps, CampaignsEmptyState } from '@/components/campaigns/rails';
import { campaignLabels } from '@/components/campaigns/labels';
import { brandsHref } from '@/lib/campaigns/links';
import { FaqSection } from '@/lib/seo/faq-section';
export const revalidate = 3600;
type RouteParams = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return campaignsListingMetadata({ locale, title: dict.meta.campaignsTitle, description: dict.meta.campaignsDescription, siteName: dict.meta.siteName });
}
/** Creator opportunities. Public detail URLs and private application routes keep their boundaries. */
export default async function CampaignsListingPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale), c = dict.campaigns;
  const [catalog, prompts] = await Promise.all([getCampaignCatalog(), getPromptCatalog()]);
  const split = splitCampaigns(catalog), labels = campaignLabels(dict);
  const styles = new Map([...prompts.yagi,...prompts.community].map(card => [card.slug,card]));
  const now = Date.now();
  return <>
    <MarketingNav locale={locale} dict={dict} rest="/campaigns" />
    <main id="main" data-campaigns>
      <section data-section data-theme="light" className="section">
        <div className="audience-shell pt-28 pb-16 lg:pt-36">
          <p className="audience-eyebrow">{dict.audience.creator}</p>
          <h1 className="audience-title mt-6 max-w-4xl">{dict.creatorJourney.campaignHeading}</h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed opacity-60">{c.intro}</p>
          <a href="/campaigns/mine" data-my-campaigns className="mt-8 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{dict.audience.myCampaigns} ↗</a>
          <section id="creators" data-creators className="mt-10 scroll-mt-24">
            {catalog.totals.live === 0 ? <CampaignsEmptyState title={c.emptyTitle} body={c.emptyBody} cta={c.emptyCta} href="/account" /> : <>
              <CampaignRail id="recruiting" heading={c.railRecruiting} lede={c.railRecruitingLede} cards={split.recruiting} styles={styles} locale={locale} labels={labels} now={now} />
              <CampaignRail id="running" heading={c.railRunning} lede={c.railRunningLede} cards={split.running} styles={styles} locale={locale} labels={labels} now={now} />
            </>}
            <CampaignSteps heading={c.stepsHeading} steps={[c.step1,c.step2,c.step3,c.step4,c.step5]} />
          </section>
          <aside id="brands" data-legacy-brand-entry className="mt-16 scroll-mt-24 border-t border-hairline pt-6"><p className="text-sm opacity-60">{dict.brandLanding.legacyBrandLink}</p><a href={brandsHref(locale)} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{dict.brandLanding.legacyBrandCta} ↗</a></aside>
        </div>
      </section>
      <FaqSection dict={dict} locale={locale} placement="campaign" path={`/${locale}/campaigns`} />
    </main>
    <MarketingFooter locale={locale} dict={dict} />
  </>;
}
