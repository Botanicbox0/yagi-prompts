import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { signInHref } from '@/lib/billing/links';
import { toCampaignCard } from '@/lib/campaigns/catalog';
import { MY_CAMPAIGNS_PATH } from '@/lib/campaigns/links';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { OPEN_CAMPAIGNS_PATH } from '@/lib/influencers/rules';
import { loadVisibleCampaigns, type VisibleCampaign, type VisibleCampaigns } from '@/lib/influencers/visibility';
import { AppHeader } from '@/components/app/app-header';
import { CampaignCardView } from '@/components/campaigns/card';
import { campaignLabels } from '@/components/campaigns/labels';
import { SocialTeaser } from '@/components/identity/social-teaser';

/**
 * `/campaigns/open` — the campaigns THIS member can join (docs/PLATFORM-2.0.md §17.2): per viewer,
 * never cached. Influencer and invited campaigns first, then the ones open to everyone. A member
 * who is not an influencer yet gets one line pointing at `/identity/social` (only while
 * TWINGS_INFLUENCERS is on). The public `/{locale}/campaigns` keeps showing `public` only.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function OpenCampaignsPage() {
  const [locale, viewer] = await Promise.all([getLocaleFromHeaders(), getViewer()]);
  const dict = getDictionary(locale);
  const copy = dict.social;
  const labels = campaignLabels(dict);
  const sql = await getSqlRunner();
  let list: VisibleCampaigns | null = null;
  if (viewer.userId && sql) {
    try { list = await loadVisibleCampaigns(sql, viewer.userId); } catch { list = null; }
  }
  const prompts = await getPromptCatalog();
  const styles = new Map([...prompts.yagi, ...prompts.community].map(card => [card.slug, card]));
  const now = Date.now();
  const grid = (items: VisibleCampaign[], id: string) => (
    <ul role="list" data-open-campaigns={id} className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(item => (
        <li key={item.row.id} data-campaign-item data-audience={item.audience} className="relative flex">
          {item.audience === 'invited' ? <span className="absolute top-3 right-3 z-10 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-white">{copy.invited}</span> : null}
          <CampaignCardView card={toCampaignCard(item.row, item.slotsTaken)} style={item.row.styleSlug ? (styles.get(item.row.styleSlug) ?? null) : null} locale={locale} labels={labels} now={now} />
        </li>
      ))}
    </ul>
  );
  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={OPEN_CAMPAIGNS_PATH} />
      <main id="main" data-campaigns-open data-influencer={list?.influencer ? 'true' : 'false'} className="band py-12 lg:py-16">
        <p className="text-accent font-label text-eyebrow uppercase">{dict.campaigns.eyebrow}</p>
        <h1 className="mt-4 font-display text-title font-black">{copy.campaignsTitle}</h1>
        <p className="mt-4 max-w-detail text-body opacity-70">{copy.campaignsLede}</p>
        <a href={MY_CAMPAIGNS_PATH} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{copy.myCampaigns} →</a>
        {viewer.userId === null ? (
          <a href={signInHref(OPEN_CAMPAIGNS_PATH, locale)} className="mt-8 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">{dict.auth.signIn} →</a>
        ) : list === null ? (
          <p role="status" className="mt-8 text-sm">{copy.errors.unavailable}</p>
        ) : (
          <>
            {list.open && !list.influencer ? <div className="mt-8 max-w-detail"><SocialTeaser copy={copy} /></div> : null}
            {list.forYou.length ? (
              <section data-campaigns-for-you className="mt-12">
                <h2 className="border-b border-hairline pb-3 text-xl font-semibold">{copy.forYouTitle}</h2>
                <p className="mt-3 text-sm opacity-60">{copy.forYouLede}</p>
                {grid(list.forYou, 'for-you')}
              </section>
            ) : null}
            <section data-campaigns-public className="mt-12">
              <h2 className="border-b border-hairline pb-3 text-xl font-semibold">{copy.publicTitle}</h2>
              {list.public.length ? grid(list.public, 'public') : <p className="mt-6 text-sm opacity-60">{copy.campaignsEmpty}</p>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
