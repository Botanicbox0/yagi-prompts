import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { templatesHref } from '@/lib/prompts/links';
import { campaignsHref } from '@/lib/campaigns/links';
import { promptLabels } from '@/components/prompts/labels';
import { campaignLabels } from '@/components/campaigns/labels';
import { SITE_TWITTER_CARD, siteOgImage } from '@/lib/seo/og';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { FaqSection } from '@/lib/seo/faq-section';
import { PromptRail } from '@/components/prompts/rails';
import { CampaignRail } from '@/components/campaigns/rails';
import { CreatorHero, CreatorHowItWorks, CreatorCampaignDoor, BrandDoor } from '@/components/audience/creator-home';
import { cachedSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';
import { SubscriptionAvailabilityProvider } from '@/components/twings/subscription-availability';
import { DEFAULT_HERO_EVIDENCE, heroEvidence } from '@/lib/content/slots';
export const revalidate = 3600;
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return {
    title: dict.meta.siteName, description: dict.meta.landingDescription,
    alternates: { canonical: `/${locale}`, languages: { en: '/en', ko: '/ko', 'x-default': '/en' } },
    openGraph: { type: 'website', locale: locale === 'ko' ? 'ko_KR' : 'en_US', url: `/${locale}`,
      title: `${dict.meta.siteName} — ${dict.meta.tagline}`, description: dict.meta.landingDescription,
      siteName: dict.meta.siteName, images: [siteOgImage(locale)] },
    twitter: { card: SITE_TWITTER_CARD },
  };
}
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale), t = dict.templates;
  const [templates, campaigns, availability] = await Promise.all([getPromptCatalog(), getCampaignCatalog(), cachedSubscriptionAvailability()]);
  const labels = promptLabels(dict);
  const recruiting = campaigns.campaigns.filter(campaign => campaign.status === 'recruiting');
  const styles = new Map([...templates.video, ...templates.image].map(card => [card.slug, card]));
  // §7.5·§14.1: the home rails are TWINGS 오리지널; maker templates get their own rail after them, only when there are any.
  const studioVideo = templates.video.filter(card => card.origin !== 'maker');
  const studioImage = templates.image.filter(card => card.origin !== 'maker');
  const makerCards = [...templates.video, ...templates.image].filter(card => card.origin === 'maker');
  const featured = studioVideo.find(card => card.slug === 'you-are-a-prom-queen') ?? studioVideo.find(card => card.video && card.poster) ?? studioVideo[0] ?? templates.video[0];
  return <>
    <MarketingNav locale={locale} dict={dict} rest="/" />
    <SubscriptionAvailabilityProvider initialAvailability={availability}>
    <main id="main" data-creator-home>
      <CreatorHero locale={locale} dict={dict} featured={featured} evidence={{ ...DEFAULT_HERO_EVIDENCE, ...heroEvidence() }} />
      <section id="gallery" data-section data-theme="light" className="section">
        <div className="audience-shell pb-16 lg:pb-24">
          <div className="mb-8 border-t border-hairline pt-8">
            <h2 className="audience-heading">{dict.creatorJourney.libraryHeading}</h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed opacity-60">{dict.creatorJourney.libraryBody}</p>
          </div>
          <PromptRail id="video" origin="studio" heading={t.video.rail} lede={t.video.railLede} cards={studioVideo} locale={locale} labels={labels} emptyLabel={t.video.emptyTitle} topClassName="mt-0" />
          <a href={templatesHref(locale,'video')} data-all-video className="mt-8 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{t.allVideo} ↗</a>
          {studioImage.length > 0 ? <PromptRail id="image" origin="studio" heading={t.image.rail} lede={t.image.railLede} cards={studioImage} locale={locale} labels={labels} emptyLabel={t.image.emptyTitle} />
            : <aside data-image-soon className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-6"><p className="max-w-xl text-sm opacity-55">{t.imageSoonTitle}</p><a href={templatesHref(locale,'image')} className="text-sm underline underline-offset-4">{t.ctaImage} ↗</a></aside>}
          {makerCards.length > 0 && <PromptRail id="makers" origin="maker" heading={t.makerRail} lede={t.makerRailLede} cards={makerCards} locale={locale} labels={labels} emptyLabel={t.makerRail} />}
        </div>
      </section>
      <CreatorHowItWorks dict={dict} />
      {recruiting.length > 0 ? <section data-section data-theme="light" className="section"><div className="audience-shell py-16"><CampaignRail id="campaigns" heading={dict.campaigns.railRecruiting} lede={dict.campaigns.railRecruitingLede} cards={recruiting} styles={styles} locale={locale} labels={campaignLabels(dict)} now={Date.now()} /><a href={campaignsHref(locale)} className="mt-8 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{dict.creatorJourney.campaignCta} ↗</a></div></section> : <CreatorCampaignDoor dict={dict} locale={locale} />}
      <FaqSection dict={dict} locale={locale} placement="landing" path={`/${locale}`} availability={availability} />
      <BrandDoor dict={dict} locale={locale} />
    </main>
    </SubscriptionAvailabilityProvider>
    <MarketingFooter locale={locale} dict={dict} />
  </>;
}
