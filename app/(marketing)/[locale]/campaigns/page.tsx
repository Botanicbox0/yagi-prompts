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
import { Reveal } from '@/components/motion/reveal';
import { contestMailto } from '@/components/contests/rails';
import { CampaignRail, CampaignSteps, CampaignsEmptyState } from '@/components/campaigns/rails';
import { campaignLabels } from '@/components/campaigns/labels';

/**
 * `/[locale]/campaigns` — docs/CAMPAIGNS.md §6, the listing.
 *
 * Cache mode is the contests listing's: **static + tag `campaigns` + a 1h TTL floor**. Nothing here
 * varies by reader. The clock is read once at render (D-day chips), the two projections it joins
 * (campaigns, and the prompt catalog for each style's poster) are both tagged, and a lost
 * invalidation self-heals within the hour.
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
  const ads = adLabels(dict);
  const styles = new Map<string, PromptCard>([...prompts.yagi, ...prompts.community].map((card) => [card.slug, card]));
  const empty = catalog.totals.live === 0;
  const c = dict.campaigns;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/campaigns" initialTheme="light" />

      <main id="main" data-campaigns data-section data-theme="light" className="section">
        <div id="campaigns-rail-anchor" className="relative">
          <AdRail anchorId="campaigns-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
            <p className="text-accent font-label text-eyebrow uppercase">{c.eyebrow}</p>
            <Reveal
              immediate
              delay={0.05}
              as="h1"
              lines={[c.line1, c.line2]}
              className="mt-6 font-display text-title font-black uppercase"
            />
            <p className="mt-8 max-w-detail text-body opacity-70">{c.intro}</p>

            {empty ? (
              <CampaignsEmptyState title={c.emptyTitle} body={c.emptyBody} cta={c.emptyCta} mailto={contestMailto(locale)} />
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
          </div>
        </div>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
