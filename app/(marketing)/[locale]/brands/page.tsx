import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BrandInquiryForm } from '@/components/campaigns/brand-form';
import { BrandFormatExplorer, BrandUseCaseExplorer, MorphicFilmPair, type UseCaseItem } from '@/components/campaigns/brand-experience';
import { CAMPAIGN_REEL } from '@/lib/campaigns/showreel';
import { CASE_STUDIES, formatCampaignMetric } from '@/lib/campaigns/case-studies';
import { brandsHref, brandEnquiryHref, brandWorkspaceHref, BRAND_INQUIRY_ENDPOINT } from '@/lib/campaigns/links';
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
  const prompts = await getPromptCatalog();
  const templates = prompts.video.map((card) => ({ slug: card.slug, title: locale === 'ko' ? card.titleKo || card.title : card.title }));
  const launchCase = CASE_STUDIES.find((study) => study.id === 'morphic-90s-interview');
  const septemberCase = CASE_STUDIES.find((study) => study.id === 'morphic-september-kr-jp');
  if (!launchCase || !septemberCase) throw new Error('The approved Morphic cases are incomplete.');
  const launchCopy = t.cases[launchCase.copyKey];
  const septemberCopy = t.cases[septemberCase.copyKey];
  const useCases: readonly UseCaseItem[] = Object.entries(t.useCases).map(([id, item]) => ({
    id,
    title: item.title,
    statement: item.statement,
    steps: [item.brand, item.studio, item.creator, item.report],
  }));

  return <>
    <MarketingNav locale={locale} dict={dict} rest="/brands" />
    <JsonLd id="campaign-service-structured-data" data={campaignServiceStructuredData({ origin: siteUrl(), path: brandsHref(locale), locale, name: t.metaTitle, description: t.metaDescription, serviceType: dict.seo.serviceType })} />
    <JsonLd id="brand-case-studies-structured-data" data={brandCaseStudiesStructuredData({ origin: siteUrl(), locale, cases: [
      { id: launchCase.id, name: launchCopy.eyebrow, description: launchCopy.body },
      { id: septemberCase.id, name: septemberCopy.eyebrow, description: septemberCopy.body },
    ] })} />

    <main id="main" data-brand-landing className="overflow-clip bg-brand-paper text-brand-ink">
      <section data-section data-theme="dark" data-campaign-hero className="section bg-brand-night text-white">
        <div className="audience-shell pb-10 pt-28 lg:pb-16 lg:pt-36">
          <p className="audience-eyebrow text-brand-lime">{t.eyebrow}</p>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.18fr_0.82fr] lg:items-end lg:gap-16">
            <h1 className="audience-title max-w-[13ch] whitespace-pre-line text-[clamp(2.35rem,11vw,7.5rem)] leading-[0.94] tracking-[-0.065em] sm:text-[clamp(3.3rem,7.4vw,7.5rem)] lg:text-[clamp(4.6rem,6.5vw,6rem)]">{t.title}</h1>
            <div className="max-w-xl pb-2">
              <p className="text-base leading-relaxed text-white/68 sm:text-lg">{t.body}</p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <a data-campaign-cta-brand href={brandEnquiryHref(locale)} className="inline-flex min-h-12 items-center rounded-full bg-brand-lime px-6 text-sm font-semibold text-black transition-transform hover:-translate-y-0.5">{t.primaryCta} ↗</a>
                <a href="#morphic-case" className="inline-flex min-h-11 items-center text-sm underline decoration-white/35 underline-offset-8">{t.secondaryCta}</a>
              </div>
            </div>
          </div>
          <p data-campaign-definition className="mt-14 max-w-3xl border-l border-brand-lime pl-5 text-sm leading-relaxed text-white/62 lg:mt-20">{t.definition}</p>
        </div>
      </section>

      <section id="work" data-section data-theme="light" data-campaign-reel-section className="section scroll-mt-24 bg-brand-paper">
        <div className="audience-shell py-12 lg:py-20">
          <div className="mb-8 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div><p className="audience-eyebrow">{t.reelEyebrow}</p><h2 className="audience-heading mt-4 max-w-xl">{t.reelHeading}</h2></div>
            <p className="max-w-xl text-sm leading-relaxed opacity-60 lg:justify-self-end">{t.reelBody}</p>
          </div>
          <BrandFormatExplorer items={CAMPAIGN_REEL} captions={t.formats} labels={t.media} />
        </div>
      </section>

      <section data-section data-theme="light" data-campaign-principles className="section border-t border-black/10 bg-white">
        <div className="audience-shell py-16 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div><p className="audience-eyebrow">{t.moatEyebrow}</p><h2 className="audience-heading mt-5 max-w-2xl">{t.moatHeading}</h2><p className="mt-6 max-w-xl text-sm leading-relaxed opacity-60">{t.moatBody}</p></div>
            <div className="grid gap-px overflow-hidden rounded-3xl bg-black/10 sm:grid-cols-3 lg:grid-cols-1">
              {[[t.moat1Title, t.moat1Body], [t.moat2Title, t.moat2Body], [t.moat3Title, t.moat3Body]].map(([heading, body], index) => <article key={heading} className="grid gap-3 bg-brand-paper p-6 lg:grid-cols-[3rem_0.7fr_1.3fr] lg:items-start lg:gap-6 lg:p-7"><span className="font-mono text-xs opacity-35">0{index + 1}</span><h3 className="text-lg font-semibold tracking-tight">{heading}</h3><p className="text-sm leading-relaxed opacity-60">{body}</p></article>)}
            </div>
          </div>
        </div>
      </section>

      <section id="morphic-case" data-section data-theme="dark" data-campaign-proof className="section scroll-mt-20 bg-brand-night text-white">
        <div className="audience-shell py-16 lg:py-28">
          <p className="audience-eyebrow text-brand-lime">{t.caseEyebrow}</p>
          <h2 className="audience-heading mt-5 max-w-4xl whitespace-pre-line text-[clamp(2.4rem,5vw,5rem)] leading-[1.02]">{t.caseHeading}</h2>

          <article id={launchCase.id} data-case-study={launchCase.id} className="mt-16 scroll-mt-24 overflow-hidden rounded-[clamp(1.25rem,2.5vw,2.5rem)] border border-white/16 bg-brand-ink">
            <div className="grid gap-10 p-6 sm:p-9 lg:grid-cols-[0.85fr_1.15fr] lg:p-14">
              <div>
                <p className="font-label text-[0.68rem] tracking-[0.15em] text-brand-pink">{launchCopy.eyebrow}</p>
                <h3 className="mt-5 whitespace-pre-line text-[clamp(2.3rem,5.2vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.06em]">{launchCopy.title}</h3>
              </div>
              <div className="flex flex-col justify-end"><h4 className="text-sm font-semibold text-white/90">{launchCopy.question}</h4><p className="mt-4 max-w-2xl text-base leading-relaxed text-white/66">{launchCopy.body}</p><a href={launchCase.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-7 inline-flex min-h-11 w-fit items-center text-sm font-semibold underline decoration-white/35 underline-offset-6">{launchCopy.sourceCta} ↗</a></div>
            </div>
            <dl className="grid border-t border-white/14 sm:grid-cols-3">
              {launchCase.metrics.map((metric, index) => {
                const copy = launchCopy.metrics[metric.id];
                return <div key={metric.id} data-case-metric={metric.id} className="flex flex-col border-b border-white/14 p-6 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 lg:p-10"><dt className="order-2 mt-4 text-sm text-white/60">{copy.label}</dt><dd className={index === 2 ? 'order-1 text-[clamp(3.2rem,7vw,7rem)] leading-none font-semibold tracking-[-0.065em] text-brand-lime' : 'order-1 text-[clamp(3.2rem,7vw,7rem)] leading-none font-semibold tracking-[-0.065em]'}>{formatCampaignMetric(metric, locale)}</dd></div>;
              })}
            </dl>
            <p className="border-t border-white/14 px-6 py-4 text-xs leading-relaxed text-white/60 sm:px-9 lg:px-14">{launchCopy.note}</p>
          </article>

          <article id={septemberCase.id} data-case-study={septemberCase.id} className="mt-6 grid scroll-mt-24 gap-10 rounded-[clamp(1.25rem,2.5vw,2.5rem)] bg-brand-warm p-6 text-black sm:p-9 lg:grid-cols-[0.78fr_1.22fr] lg:p-14">
            <div className="flex flex-col justify-between">
              <div><p className="font-label text-[0.68rem] tracking-[0.15em] text-brand-violet">{septemberCopy.eyebrow}</p><h3 className="mt-5 whitespace-pre-line text-[clamp(2.2rem,4.6vw,4.8rem)] font-semibold leading-[1.01] tracking-[-0.055em]">{septemberCopy.title}</h3><h4 className="mt-7 text-sm font-semibold">{septemberCopy.question}</h4><p className="mt-4 max-w-xl text-sm leading-relaxed opacity-62">{septemberCopy.body}</p></div>
              <ul className="mt-10 grid grid-cols-2 gap-2">{septemberCopy.operations.map((item, index) => <li key={item} className="rounded-full border border-black/15 px-3 py-2 text-xs"><span className="mr-2 font-mono opacity-35">0{index + 1}</span>{item}</li>)}</ul>
            </div>
            <div><MorphicFilmPair media={septemberCase.media} labels={{ titles: septemberCopy.films, play: t.media.play, pause: t.media.pause }} /><p className="mt-4 text-xs leading-relaxed opacity-65">{septemberCopy.note}</p></div>
          </article>
        </div>
      </section>

      <section id="campaign-types" data-section data-theme="light" data-campaign-use-cases className="section scroll-mt-24 bg-brand-paper">
        <div className="audience-shell py-16 lg:py-24">
          <div className="mb-10 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-end"><div><p className="audience-eyebrow">{t.typesEyebrow}</p><h2 className="audience-heading mt-4">{t.typesHeading}</h2></div><p className="max-w-xl text-sm leading-relaxed opacity-60 lg:justify-self-end">{t.typesBody}</p></div>
          <BrandUseCaseExplorer items={useCases} labels={{ tabs: t.typesHeading, brief: t.brandProvides, format: t.studioMakes, publish: t.creatorPosts, result: t.report, cta: t.primaryCta }} enquiryHref={brandsHref(locale)} />
        </div>
      </section>

      <section id="process" data-section data-theme="light" data-campaign-process className="section scroll-mt-24 border-t border-black/10 bg-white">
        <div className="audience-shell py-16 lg:py-24">
          <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20"><div><p className="audience-eyebrow">{t.processEyebrow}</p><h2 className="audience-heading mt-5 whitespace-pre-line">{t.processHeading}</h2><p className="mt-6 max-w-md text-sm leading-relaxed opacity-60">{t.processBody}</p></div>
            <ol className="grid gap-px overflow-hidden rounded-3xl bg-black/10">{Object.entries(t.processSteps).map(([key, step], index) => <li key={key} className="grid gap-4 bg-brand-paper p-6 sm:grid-cols-[3rem_0.8fr_1.2fr] sm:items-start"><span className="font-mono text-xs opacity-35">0{index + 1}</span><h3 className="text-base font-semibold">{step.title}</h3><p className="text-sm leading-relaxed opacity-60">{step.body}</p></li>)}</ol>
          </div>
        </div>
      </section>

      <section id="brands" data-section data-theme="light" data-brands className="section scroll-mt-24 border-y border-black/10 bg-brand-warm">
        <div className="audience-shell grid gap-12 py-16 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20 lg:py-24">
          <div><p className="audience-eyebrow">{t.inquiryEyebrow}</p><h2 className="audience-heading mt-5">{t.inquiryHeading}</h2><p className="mt-6 text-sm leading-relaxed opacity-60">{t.inquiryBody}</p><p className="mt-5 text-xs leading-relaxed opacity-65">{t.inquiryNote}</p>
            <div className="mt-10 rounded-2xl border border-black/15 bg-white/45 p-5"><h3 className="text-sm font-semibold">{t.workspaceHeading}</h3><p className="mt-2 text-xs leading-relaxed opacity-60">{t.workspaceBody}</p><a data-brand-workspace-entry href={brandWorkspaceHref(locale)} className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.workspaceCta} ↗</a></div>
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.08)] sm:p-9"><BrandInquiryForm endpoint={BRAND_INQUIRY_ENDPOINT} locale={locale} labels={dict.campaigns.brands} templates={templates} privacy={{ href: legalHref(locale, 'privacy'), label: legalDocument('privacy', locale).title }} /></div>
        </div>
      </section>

      <section data-section data-theme="dark" data-production-service className="section bg-brand-night text-white">
        <div className="audience-shell grid gap-8 py-14 lg:grid-cols-[1fr_auto] lg:items-end lg:py-18"><div className="max-w-2xl"><p className="audience-eyebrow text-brand-pink">{t.productionEyebrow}</p><h2 className="mt-4 text-[clamp(1.8rem,3vw,3.2rem)] font-semibold tracking-tight">{t.productionHeading}</h2><p className="mt-4 text-sm leading-relaxed text-white/58">{t.productionBody}</p></div><div className="max-w-sm"><a href={`${brandsHref(locale)}?type=production#brands`} className="inline-flex min-h-11 items-center text-sm font-medium underline decoration-white/35 underline-offset-6">{t.productionCta} ↗</a><a href="https://pricing.yagiworkshop.xyz/" target="_blank" rel="noopener noreferrer" data-production-pricing className="mt-2 block text-sm underline decoration-white/35 underline-offset-6">{t.pricingCta} ↗</a><p className="mt-3 text-xs leading-relaxed text-white/60">{t.pricingNote}</p></div></div>
      </section>
      <FaqSection dict={dict} locale={locale} placement="brand" path={brandsHref(locale)} />
      <aside data-creator-door className="audience-shell flex flex-wrap items-center justify-between gap-6 border-t border-hairline py-10"><div><h2 className="text-lg font-semibold">{dict.audience.creatorDoor}</h2><p className="mt-2 max-w-xl text-sm opacity-60">{dict.audience.creatorDoorBody}</p></div><a href={`/${locale}`} className="text-sm font-medium underline underline-offset-4">{dict.audience.creatorDoorCta} ↗</a></aside>
    </main>
    <MarketingFooter locale={locale} dict={dict} audience="brand" />
  </>;
}
