import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { CampaignShowreel } from '@/components/campaigns/showreel';
import { BrandInquiryForm } from '@/components/campaigns/brand-form';
import { CAMPAIGN_REEL } from '@/lib/campaigns/showreel';
import { CASE_STUDIES } from '@/lib/campaigns/case-studies';
import { brandsHref, brandEnquiryHref, brandWorkspaceHref, BRAND_INQUIRY_ENDPOINT } from '@/lib/campaigns/links';
import { legalDocument } from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';
import { siteOgImage } from '@/lib/seo/og';
import { JsonLd } from '@/lib/seo/json-ld';
import { campaignServiceStructuredData } from '@/lib/seo/structured-data';
import { siteUrl } from '@/lib/seo/site-url';
import { FaqSection } from '@/lib/seo/faq-section';

/** Public service discovery stays static. Membership and approvals stay on brand.twings.app. */
export const revalidate = 3600;
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const copy = getDictionary(locale).brandLanding;
  return { title: copy.metaTitle, description: copy.metaDescription,
    alternates: { canonical: brandsHref(locale), languages: { ko: brandsHref('ko'), en: brandsHref('en'), 'x-default': brandsHref('en') } },
    openGraph: { title: copy.metaTitle, description: copy.metaDescription, url: brandsHref(locale), images: [siteOgImage(locale)] },
  };
}

export default async function BrandsPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale), t = dict.brandLanding, reel = dict.campaigns.landing;
  const prompts = await getPromptCatalog();
  const templates = prompts.video.map(card => ({ slug: card.slug, title: locale === 'ko' ? card.titleKo || card.title : card.title }));
  return <>
    <MarketingNav locale={locale} dict={dict} rest="/brands" />
    <JsonLd id="campaign-service-structured-data" data={campaignServiceStructuredData({ origin: siteUrl(), path: brandsHref(locale), locale, name: t.metaTitle, description: t.metaDescription, serviceType: dict.seo.serviceType })} />
    <main id="main" data-brand-landing>
      <section data-section data-theme="light" data-campaign-hero className="section">
        <div className="audience-shell pt-28 pb-12 lg:pt-36 lg:pb-16">
          <p className="audience-eyebrow">{t.eyebrow}</p>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end lg:gap-14">
            <h1 className="audience-title whitespace-pre-line">{t.title}</h1>
            <div className="max-w-xl"><p className="text-base leading-relaxed opacity-65">{t.body}</p><div className="mt-8 flex flex-wrap items-center gap-5"><a data-campaign-cta-brand href={brandEnquiryHref(locale)} className="audience-button">{t.primaryCta} ↗</a><a href="#work" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.secondaryCta}</a></div></div>
          </div>
        </div>
      </section>

      <section id="work" data-section data-theme="light" data-campaign-reel-section className="section scroll-mt-24">
        <div className="audience-shell pb-16 lg:pb-24">
          <p className="audience-eyebrow mb-5">{t.reelEyebrow}</p>
          <CampaignShowreel items={CAMPAIGN_REEL} captions={reel.reel} labels={{ play: reel.reelPlay, pause: reel.reelPause, unmute: reel.reelUnmute, mute: reel.reelMute }} />
          <div className="mt-6 flex flex-wrap justify-between gap-4"><h2 className="text-lg font-semibold">{t.reelHeading}</h2><p className="max-w-lg text-xs leading-relaxed opacity-55">{t.reelBody}</p></div>
          <p data-campaign-definition className="mt-12 max-w-3xl border-t border-hairline pt-7 text-base leading-relaxed opacity-65">{t.definition}</p>
        </div>
      </section>

      <section data-section data-theme="light" data-campaign-principles className="section border-t border-hairline">
        <div className="audience-shell py-16 lg:py-24"><p className="audience-eyebrow">{t.moatEyebrow}</p><h2 className="audience-heading mt-5 max-w-3xl">{t.moatHeading}</h2><p className="mt-6 max-w-2xl text-sm leading-relaxed opacity-60">{t.moatBody}</p><div className="mt-10 grid gap-8 md:grid-cols-3">{[[t.moat1Title,t.moat1Body],[t.moat2Title,t.moat2Body],[t.moat3Title,t.moat3Body]].map(([heading,body]) => <article key={heading} className="border-t border-hairline pt-5"><h3 className="text-lg font-semibold">{heading}</h3><p className="mt-3 text-sm leading-relaxed opacity-60">{body}</p></article>)}</div></div>
      </section>

      <section id="campaign-types" data-section data-theme="light" data-campaign-use-cases className="section scroll-mt-24 border-y border-hairline">
        <div className="audience-shell py-16 lg:py-24">
          <p className="audience-eyebrow">{t.typesEyebrow}</p><h2 className="audience-heading mt-4">{t.typesHeading}</h2><p className="mt-5 max-w-2xl text-sm leading-relaxed opacity-60">{t.typesBody}</p>
          <div className="mt-10 grid gap-x-10 md:grid-cols-2">
            {Object.entries(t.useCases).map(([key, item], index) => <article key={key} data-campaign-use-case={key} className="border-t border-hairline py-8">
              <div className="flex items-baseline justify-between gap-3"><h3 className="text-2xl font-semibold tracking-tight">{item.title}</h3><span className="text-xs opacity-35">0{index+1}</span></div>
              <dl className="mt-6 grid gap-4 text-sm">{[[t.brandProvides,item.brand],[t.studioMakes,item.studio],[t.creatorPosts,item.creator],[t.report,item.report]].map(([label,body]) => <div key={label} className="grid grid-cols-[7rem_1fr] gap-4"><dt className="opacity-45">{label}</dt><dd className="leading-relaxed">{body}</dd></div>)}</dl>
              <a href={`${brandsHref(locale)}?useCase=${key}#brands`} className="mt-6 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{t.primaryCta} ↗</a>
            </article>)}
          </div>
        </div>
      </section>

      <section data-section data-theme="dark" data-campaign-proof className="section">
        <div className="audience-shell py-16 lg:py-24">
          <p className="audience-eyebrow">{t.caseEyebrow}</p><h2 className="audience-heading mt-5 whitespace-pre-line">{t.caseHeading}</h2>
          {CASE_STUDIES.map(study => <article key={study.id} data-case-study={study.id} className="mt-12">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6"><div><h3 className="text-2xl font-semibold">{t[study.clientKey]}</h3><p className="mt-2 text-sm opacity-60">{t[study.goalKey]} · {t[study.formatKey]}</p></div></div>
            <dl className="grid gap-8 py-9 sm:grid-cols-3">{[[reel.proofStat1Value,reel.proofStat1Label],[reel.proofStat2Value,reel.proofStat2Label],[reel.proofStat3Value,reel.proofStat3Label]].map(([value,label]) => <div key={label}><dd className="text-[clamp(2.8rem,5vw,5rem)] leading-none font-medium tracking-tight">{value}</dd><dt className="mt-4 text-sm opacity-60">{label}</dt></div>)}</dl>
          </article>)}
          <p className="max-w-2xl text-xs leading-relaxed opacity-70">{t.caseNote}</p>
        </div>
      </section>

      <section id="process" data-section data-theme="light" data-campaign-process className="section scroll-mt-24">
        <div className="audience-shell grid gap-12 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20 lg:py-24">
          <div><p className="audience-eyebrow">{t.processEyebrow}</p><h2 className="audience-heading mt-5 whitespace-pre-line">{t.processHeading}</h2><p className="mt-6 text-sm leading-relaxed opacity-60">{t.processBody}</p></div>
          <ol>{Object.entries(t.processSteps).map(([key,step],index) => <li key={key} className="grid grid-cols-[2rem_1fr] gap-4 border-t border-hairline py-6"><span className="pt-1 text-xs opacity-40">0{index+1}</span><div><h3 className="text-lg font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-relaxed opacity-60">{step.body}</p></div></li>)}</ol>
        </div>
      </section>

      <section id="brands" data-section data-theme="light" data-brands className="section scroll-mt-24 border-y border-hairline">
        <div className="audience-shell grid gap-12 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:py-24">
          <div><p className="audience-eyebrow">{t.inquiryEyebrow}</p><h2 className="audience-heading mt-5">{t.inquiryHeading}</h2><p className="mt-6 text-sm leading-relaxed opacity-60">{t.inquiryBody}</p><p className="mt-5 text-xs leading-relaxed opacity-70">{t.inquiryNote}</p>
            <div className="mt-10 border-t border-hairline pt-6"><h3 className="text-sm font-semibold">{t.workspaceHeading}</h3><p className="mt-2 text-xs leading-relaxed opacity-60">{t.workspaceBody}</p><a data-brand-workspace-entry href={brandWorkspaceHref(locale)} className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.workspaceCta} ↗</a></div>
          </div>
          <BrandInquiryForm endpoint={BRAND_INQUIRY_ENDPOINT} locale={locale} labels={dict.campaigns.brands} templates={templates} privacy={{ href: legalHref(locale,'privacy'), label: legalDocument('privacy',locale).title }} />
        </div>
      </section>

      <section data-section data-theme="light" data-production-service className="section">
        <div className="audience-shell flex flex-wrap items-end justify-between gap-8 py-16"><div className="max-w-xl"><p className="audience-eyebrow">{t.productionEyebrow}</p><h2 className="mt-4 text-2xl font-semibold tracking-tight">{t.productionHeading}</h2><p className="mt-4 text-sm leading-relaxed opacity-60">{t.productionBody}</p></div><div className="max-w-sm"><a href={`${brandsHref(locale)}?type=production#brands`} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{t.productionCta} ↗</a><a href="https://pricing.yagiworkshop.xyz/" target="_blank" rel="noopener noreferrer" data-production-pricing className="mt-2 block text-sm underline underline-offset-4">{t.pricingCta} ↗</a><p className="mt-3 text-xs leading-relaxed opacity-70">{t.pricingNote}</p></div></div>
      </section>
      <FaqSection dict={dict} locale={locale} placement="brand" path={brandsHref(locale)} />
      <aside data-creator-door className="audience-shell flex flex-wrap items-center justify-between gap-6 border-t border-hairline py-10"><div><h2 className="text-lg font-semibold">{dict.audience.creatorDoor}</h2><p className="mt-2 max-w-xl text-sm opacity-60">{dict.audience.creatorDoorBody}</p></div><a href={`/${locale}`} className="text-sm font-medium underline underline-offset-4">{dict.audience.creatorDoorCta} ↗</a></aside>
    </main>
    <MarketingFooter locale={locale} dict={dict} audience="brand" />
  </>;
}
