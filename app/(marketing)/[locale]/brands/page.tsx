import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BrandInquiryDialog } from '@/components/campaigns/brand-inquiry-dialog';
import { MorphicFilmPair } from '@/components/campaigns/brand-experience';
import { LandingAssets, LandingCampaign, LandingClosing, LandingContrast, LandingHero, LandingProduction } from '@/components/brand-studio/landing-sections';
import landing from '@/components/brand-studio/landing.module.css';
import { BrandCustomerStory } from '@/components/campaigns/brand-customer-story';
import { brandsHref, BRAND_INQUIRY_ENDPOINT } from '@/lib/campaigns/links';
import { legalDocument } from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';
import { siteOgImage } from '@/lib/seo/og';
import { JsonLd } from '@/lib/seo/json-ld';
import { brandCaseStudiesStructuredData, campaignServiceStructuredData } from '@/lib/seo/structured-data';
import { siteUrl } from '@/lib/seo/site-url';
import { FaqSection } from '@/lib/seo/faq-section';
import { getLandingMedia } from '@/lib/content/landing-media-server';

/** Public service discovery stays static. Membership and approvals stay on brand.twings.app. */
export const revalidate = 3600;
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const copy = dict.brandLanding;
  const image = siteOgImage(locale);
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: { canonical: brandsHref(locale), languages: { ko: brandsHref('ko'), en: brandsHref('en'), 'x-default': brandsHref('en') } },
    openGraph: { type: 'website', locale: locale === 'ko' ? 'ko_KR' : 'en_US', siteName: dict.meta.siteName, title: copy.metaTitle, description: copy.metaDescription, url: brandsHref(locale), images: [image] },
    twitter: { card: 'summary_large_image', title: copy.metaTitle, description: copy.metaDescription, images: [image] },
  };
}

export default async function BrandsPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const t = dict.brandLanding;
  // Images the founder replaced in /admin/landing-media; every other slot shows its file.
  const media = await getLandingMedia();
  return <>
    <MarketingNav locale={locale} dict={dict} rest="/brands" />
    <JsonLd id="campaign-service-structured-data" data={campaignServiceStructuredData({ origin: siteUrl(), path: brandsHref(locale), locale, name: t.metaTitle, description: t.metaDescription, serviceType: dict.seo.serviceType })} />
    <JsonLd id="brand-case-studies-structured-data" data={brandCaseStudiesStructuredData({ origin: siteUrl(), locale, cases: [{ id: 'morphic', name: t.stories.title, description: t.stories.summary, path: `/${locale}/brands/stories/morphic` }] })} />

    <main id="main" data-brand-landing className={`overflow-clip [word-break:keep-all] ${landing.page}`}>
      <LandingHero copy={t.landing} locale={locale} />
      <LandingContrast copy={t.landing} media={media} />
      <LandingAssets copy={t.landing} studio={t.studio} media={media} />
      <LandingCampaign copy={t.landing} trust={t.scalePillars}>
        <div id="morphic-case" data-campaign-proof className="scroll-mt-20">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
            <div className="grid gap-3"><p className={landing.eyebrow}>{t.stories.eyebrow}</p><h3 className={`${landing.title} text-[clamp(1.6rem,3vw,2.4rem)]`}>{t.stories.title}</h3></div>
            <a href={`/${locale}/brands/stories`} className={landing.link}>{t.stories.allCta} ↗</a>
          </div>
          {/* The story card is dark and inherits its type colour, as it did inside the old dark band. */}
          <div className="text-white"><BrandCustomerStory dict={dict} locale={locale} /></div>
        </div>
      </LandingCampaign>
      <LandingProduction
        copy={t.landing}
        actions={
          <div className="grid gap-4">
            <p data-production-collabs className={landing.note}>{t.productionCollabs}</p>
            <div className={landing.actions}>
              <a href="https://pitch.com/v/yagi-production-wokrs-vsrgfd" target="_blank" rel="noopener noreferrer" data-production-deck className={landing.link}>{t.productionDeckCta} ↗</a>
              <a href={t.companyDeckUrl} target="_blank" rel="noopener noreferrer" data-company-deck className={landing.link}>{t.companyDeckCta} ↗</a>
              <a data-inquiry-trigger href={`${brandsHref(locale)}?type=production#brands`} className={landing.link}>{t.productionCta} ↗</a>
              <a href="https://pricing.yagiworkshop.xyz/" target="_blank" rel="noopener noreferrer" data-production-pricing className={landing.link}>{t.pricingCta} ↗</a>
            </div>
            <p className={landing.note}>{t.pricingNote}</p>
          </div>
        }
        films={<MorphicFilmPair media={[{ id: 'production-paris', src: '/reel/brands/production-paris.mp4', poster: '/reel/brands/production-paris.jpg', width: 1280, height: 720 }, { id: 'production-beauty', src: '/reel/campaigns/beauty-rose.mp4', poster: '/reel/campaigns/beauty-rose.jpg', width: 1280, height: 720 }]} labels={{ titles: t.productionFilms, play: t.media.play, pause: t.media.pause }} />}
      />
      <LandingClosing copy={t.landing} locale={locale}>
        <BrandInquiryDialog endpoint={BRAND_INQUIRY_ENDPOINT} locale={locale} labels={dict.campaigns.brands} privacy={{ href: legalHref(locale, 'privacy'), label: legalDocument('privacy', locale).title }} title={t.inquiryDialogTitle} body={t.inquiryBody} close={t.inquiryClose} />
      </LandingClosing>
      <FaqSection dict={dict} locale={locale} placement="brand" path={brandsHref(locale)} />
      <aside data-creator-door className="audience-shell flex flex-wrap items-center justify-between gap-6 border-t border-hairline py-10"><div><h2 className="text-lg font-semibold">{dict.audience.creatorDoor}</h2><p className="mt-2 max-w-xl text-sm text-black/55">{dict.audience.creatorDoorBody}</p></div><a href={`/${locale}`} className="text-sm font-medium underline underline-offset-4">{dict.audience.creatorDoorCta} ↗</a></aside>
    </main>
    <MarketingFooter locale={locale} dict={dict} audience="brand" />
  </>;
}
