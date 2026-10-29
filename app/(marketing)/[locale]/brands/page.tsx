import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BrandInquiryDialog } from '@/components/campaigns/brand-inquiry-dialog';
import { V7BrandFirst, V7Campaign, V7Closing, V7Hero, V7Problem, V7Production, V7Work, V7Workflow } from '@/components/brand-studio/v7';
import { DemoDock } from '@/components/brand-studio/v7-client';
import { getLandingMedia } from '@/lib/content/landing-media-server';
import v7 from '@/components/brand-studio/v7.module.css';
import { BrandCustomerStory } from '@/components/campaigns/brand-customer-story';
import { brandEnquiryHref, brandsHref, BRAND_INQUIRY_ENDPOINT } from '@/lib/campaigns/links';
import { legalDocument } from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';
import { siteOgImage } from '@/lib/seo/og';
import { JsonLd } from '@/lib/seo/json-ld';
import { brandCaseStudiesStructuredData, campaignServiceStructuredData } from '@/lib/seo/structured-data';
import { siteUrl } from '@/lib/seo/site-url';
import { FaqSection } from '@/lib/seo/faq-section';

/** Public service discovery stays static. Membership and approvals stay on brand.twings.app. */
export const revalidate = 3600;
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const copy = dict.brandLanding.v7;
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
  const c = t.v7;
  const enquiry = brandEnquiryHref(locale);
  // Images the founder replaced in /admin/landing-media; every other slot shows its file.
  const media = await getLandingMedia();
  // The wrapper carries the identity (display: contents), so the nav, form and footer share the one blue.
  return <div data-brand-accent className={v7.identity}>
    <MarketingNav locale={locale} dict={dict} rest="/brands" />
    <JsonLd id="campaign-service-structured-data" data={campaignServiceStructuredData({ origin: siteUrl(), path: brandsHref(locale), locale, name: c.metaTitle, description: c.metaDescription, serviceType: dict.seo.serviceType })} />
    <JsonLd id="brand-case-studies-structured-data" data={brandCaseStudiesStructuredData({ origin: siteUrl(), locale, cases: [{ id: 'morphic', name: t.stories.title, description: t.stories.summary, path: `/${locale}/brands/stories/morphic` }] })} />

    <main id="main" data-brand-landing className={`overflow-clip [word-break:keep-all] ${v7.page}`}>
      <V7Hero copy={c} locale={locale} />
      <div className={v7.over}>
        <V7Problem copy={c} media={media} />
        <V7BrandFirst copy={c} media={media} />
        <V7Workflow copy={c} />
        <V7Work copy={c} studio={t.studio} media={media} />
        <V7Campaign copy={c} proof={t.landing.hero.proofFigures}>
          <div id="morphic-case" data-campaign-proof className="scroll-mt-20">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
              <div className="grid gap-3"><p className={v7.eyebrow}><span className={v7.eyebrowMark} aria-hidden="true" />{t.stories.eyebrow}</p><h3 className={v7.h3}>{t.stories.title}</h3></div>
              <a href={`/${locale}/brands/stories`} className={v7.link}>{t.stories.allCta} ↗</a>
            </div>
            {/* The story card is dark and inherits its type colour. */}
            <div className="text-white"><BrandCustomerStory dict={dict} locale={locale} /></div>
          </div>
        </V7Campaign>
        <V7Production
          copy={c}
          actions={
            <div className={v7.links}>
              <a href="https://pitch.com/v/yagi-production-wokrs-vsrgfd" target="_blank" rel="noopener noreferrer" data-production-deck className={v7.link}>{c.production.decks} ↗</a>
              <a href={t.companyDeckUrl} target="_blank" rel="noopener noreferrer" data-company-deck className={v7.link}>{c.production.company} ↗</a>
              <a data-inquiry-trigger href={`${brandsHref(locale)}?type=production#brands`} className={v7.link}>{c.production.talk} ↗</a>
            </div>
          }
        />
        <V7Closing copy={c} locale={locale}>
          <BrandInquiryDialog endpoint={BRAND_INQUIRY_ENDPOINT} locale={locale} labels={dict.campaigns.brands} privacy={{ href: legalHref(locale, 'privacy'), label: legalDocument('privacy', locale).title }} title={t.inquiryDialogTitle} body={t.inquiryBody} close={t.inquiryClose} />
        </V7Closing>
        <FaqSection dict={dict} locale={locale} placement="brand" path={brandsHref(locale)} />
        <aside data-creator-door className="audience-shell flex flex-wrap items-center justify-between gap-6 border-t border-hairline py-10"><div><h2 className="text-lg font-semibold">{dict.audience.creatorDoor}</h2><p className="mt-2 max-w-xl text-sm text-black/55">{dict.audience.creatorDoorBody}</p></div><a href={`/${locale}`} className="text-sm font-medium underline underline-offset-4">{dict.audience.creatorDoorCta} ↗</a></aside>
      </div>
    </main>
    <DemoDock label={c.hero.eyebrow} cta={c.hero.cta} href={enquiry} />
    <MarketingFooter locale={locale} dict={dict} audience="brand" />
  </div>;
}
