import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BrandInquiryDialog } from '@/components/campaigns/brand-inquiry-dialog';
import { BrandFormatExplorer, HeroCinemaGrid, MorphicFilmPair } from '@/components/campaigns/brand-experience';
import { CAMPAIGN_REEL } from '@/lib/campaigns/showreel';
import { BrandCustomerStory } from '@/components/campaigns/brand-customer-story';
import { brandsHref, brandEnquiryHref, BRAND_INQUIRY_ENDPOINT } from '@/lib/campaigns/links';
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
  return <>
    <MarketingNav locale={locale} dict={dict} rest="/brands" />
    <JsonLd id="campaign-service-structured-data" data={campaignServiceStructuredData({ origin: siteUrl(), path: brandsHref(locale), locale, name: t.metaTitle, description: t.metaDescription, serviceType: dict.seo.serviceType })} />
    <JsonLd id="brand-case-studies-structured-data" data={brandCaseStudiesStructuredData({ origin: siteUrl(), locale, cases: [{ id: 'morphic', name: t.stories.title, description: t.stories.summary, path: `/${locale}/brands/stories/morphic` }] })} />

    <main id="main" data-brand-landing className="overflow-clip bg-white text-brand-ink [word-break:keep-all]">
      <section data-section data-theme="dark" data-campaign-hero className="section bg-brand-night text-white">
        <div className="audience-shell pb-12 pt-28 lg:pb-16 lg:pt-32">
          <p className="audience-eyebrow text-brand-blue-light">{t.eyebrow}</p>
          <div className="mt-6 grid gap-10 lg:grid-cols-[0.94fr_1.06fr] lg:items-center lg:gap-12">
            <div>
              <h1 className="audience-title max-w-[13ch] whitespace-pre-line text-balance text-[clamp(2.35rem,10vw,6.2rem)] leading-[0.96] tracking-[-0.055em] sm:text-[clamp(3.2rem,6.5vw,5.6rem)] lg:text-[clamp(3.6rem,4.7vw,5.1rem)]">{t.title}</h1>
              <p className="mt-6 max-w-xl text-pretty text-base leading-[1.65] text-white/74 sm:text-lg">{t.body}</p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <a data-campaign-cta-brand data-inquiry-trigger href={brandEnquiryHref(locale)} className="inline-flex min-h-12 items-center rounded-full bg-blue px-6 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">{t.primaryCta} ↗</a>
                <a href="#morphic-case" className="inline-flex min-h-11 items-center text-sm underline decoration-white/35 underline-offset-8">{t.secondaryCta}</a>
              </div>
              <p data-campaign-definition className="mt-8 max-w-xl border-l border-white/20 pl-4 text-pretty text-xs leading-[1.6] text-white/56 sm:text-sm">{t.definition}</p>
            </div>
            <HeroCinemaGrid
              items={[
                { id: 'beauty', src: '/reel/campaigns/beauty-rose.mp4', poster: '/reel/campaigns/beauty-rose.jpg', width: 1280, height: 720, title: t.heroCinema.beautyTitle },
                { id: 'interview', src: '/reel/campaigns/highteen.mp4', poster: '/reel/campaigns/highteen.jpg', width: 1280, height: 720, title: t.heroCinema.interviewTitle },
                { id: 'paris', src: '/reel/brands/production-paris.mp4#t=2.2', poster: '/reel/brands/production-paris.jpg', width: 1280, height: 720, title: t.heroCinema.parisTitle },
                { id: 'creator', src: '/reel/campaigns/retro-phone-01.mp4', poster: '/reel/campaigns/retro-phone-01.jpg', width: 720, height: 1280, title: t.heroCinema.creatorTitle },
              ]}
            />
          </div>
          <div data-brand-formula className="mt-10 grid gap-3 border-t border-white/12 pt-8 sm:grid-cols-3 sm:gap-4">
            {[
              { title: t.formula.item1Title, body: t.formula.item1Body, img: '/reel/studio-demo/reference-selfie.jpeg' },
              { title: t.formula.item2Title, body: t.formula.item2Body, img: '/reel/brands/city-fashion.jpg' },
              { title: t.formula.item3Title, body: t.formula.item3Body, img: '/reel/studio-demo/different-person.jpg' },
            ].map((item) => (
              <div key={item.title} className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <img src={item.img} alt="" width={72} height={90} decoding="async" className="h-18 w-14 shrink-0 rounded-lg object-cover object-top ring-1 ring-white/15" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight text-white sm:text-base">{item.title}</p>
                  <p className="mt-1 text-pretty text-xs leading-[1.55] text-white/62">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="work" data-section data-theme="light" data-campaign-reel-section className="section scroll-mt-24 bg-white">
        <div className="audience-shell py-14 lg:py-22">
          <div className="mb-8 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div><p className="audience-eyebrow">{t.reelEyebrow}</p><h2 className="audience-heading mt-4 max-w-xl">{t.reelHeading}</h2></div>
            <p className="max-w-xl text-pretty text-sm leading-[1.65] opacity-65 lg:justify-self-end">{t.reelBody}</p>
          </div>
          <BrandFormatExplorer items={CAMPAIGN_REEL} captions={t.formats} labels={t.media} />

          <div data-production-craft-strip className="mt-12 overflow-hidden rounded-2xl bg-brand-night p-7 text-white sm:p-10 lg:mt-16 lg:p-12">
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-14">
              <div>
                <h3 className="whitespace-pre-line text-balance text-[clamp(1.6rem,3vw,2.6rem)] font-semibold leading-[1.18] tracking-[-0.035em] text-white">{t.craftStrip.heading}</h3>
                <p className="mt-4 max-w-xl text-pretty text-sm leading-[1.68] text-white/70 sm:text-base">{t.craftStrip.body}</p>
              </div>
              <dl className="divide-y divide-white/12 border-y border-white/12">
                {[
                  { title: t.craftStrip.lightTitle, body: t.craftStrip.lightBody },
                  { title: t.craftStrip.scaleTitle, body: t.craftStrip.scaleBody },
                  { title: t.craftStrip.liveTitle, body: t.craftStrip.liveBody },
                ].map((item) => (
                  <div key={item.title} className="py-5 first:pt-4 last:pb-4">
                    <dt className="text-base font-semibold tracking-[-0.025em] text-white sm:text-lg">{item.title}</dt>
                    <dd className="mt-1.5 text-pretty text-xs leading-[1.6] text-white/64 sm:text-sm">{item.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section id="process" data-section data-theme="light" data-campaign-principles data-campaign-process className="section scroll-mt-24 border-t border-black/10 bg-white">
        <div className="audience-shell py-14 lg:py-20">
          <p className="audience-eyebrow">{t.moatEyebrow}</p>
          <ol className="mt-7 grid gap-8 sm:grid-cols-3 sm:gap-10">
            {[[t.moat1Title, t.moat1Body], [t.moat2Title, t.moat2Body], [t.moat3Title, t.moat3Body]].map(([heading, body], index) => <li key={heading} className="border-t border-black/15 pt-5"><span className="font-mono text-xs text-blue">0{index + 1}</span><h2 className="mt-3 text-xl font-semibold tracking-[-0.025em]">{heading}</h2><p className="mt-2.5 max-w-sm text-pretty text-sm leading-[1.65] opacity-68">{body}</p></li>)}
          </ol>
          <div data-brand-markets className="mt-14 grid gap-5 border-t border-black/15 pt-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-16">
            <h2 className="whitespace-pre-line text-balance text-[clamp(1.7rem,3.2vw,3rem)] font-semibold leading-[1.18] tracking-[-0.035em]">{t.marketsHeading}</h2>
            <p className="max-w-xl text-pretty text-sm leading-[1.65] opacity-68 lg:justify-self-end">{t.marketsBody}</p>
          </div>
          <div className="mt-14 rounded-2xl border border-black/[0.08] bg-[#F7F7F5] p-7 sm:p-10">
            <p className="audience-eyebrow text-blue">{t.scalePillars.eyebrow}</p>
            <dl data-brand-scale-pillars className="mt-6 grid gap-7 sm:grid-cols-3 sm:gap-10">
              {[
                { value: t.scalePillars.networkValue, label: t.scalePillars.networkLabel },
                { value: t.scalePillars.shootsValue, label: t.scalePillars.shootsLabel },
                { value: t.scalePillars.complianceValue, label: t.scalePillars.complianceLabel },
              ].map((pillar) => (
                <div key={pillar.value} className="border-t border-black/12 pt-5">
                  <dt className="text-lg font-semibold leading-[1.3] tracking-[-0.03em] text-brand-ink sm:text-xl">{pillar.value}</dt>
                  <dd className="mt-2.5 text-pretty text-sm leading-[1.65] text-brand-ink/70">{pillar.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section id="morphic-case" data-section data-theme="dark" data-campaign-proof className="section scroll-mt-20 bg-brand-night text-white">
        <div className="audience-shell py-16 lg:py-24">
          <p className="audience-eyebrow text-brand-blue-light">{t.stories.eyebrow}</p>
          <div className="mb-10 mt-5 flex flex-wrap items-end justify-between gap-7"><h2 className="audience-heading whitespace-pre-line">{t.stories.title}</h2><a href={`/${locale}/brands/stories`} className="inline-flex min-h-11 items-center text-sm underline decoration-white/35 underline-offset-6">{t.stories.allCta} ↗</a></div>
          <BrandCustomerStory dict={dict} locale={locale} />
        </div>
      </section>

      <section id="campaign-types" data-section data-theme="light" data-campaign-use-cases className="section scroll-mt-24 bg-white">
        <div className="audience-shell py-16 lg:py-24">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-5"><div><p className="audience-eyebrow">{t.typesEyebrow}</p><h2 className="audience-heading mt-4">{t.typesHeading}</h2></div><p className="max-w-md text-sm leading-relaxed opacity-65">{t.typesBody}</p></div>
          <div data-brand-service-examples className="grid gap-5 sm:grid-cols-3">
            {(['launch', 'app_platform', 'beauty_fashion'] as const).map((id) => {
              const example = t.examples[id];
              const image = {
                launch: { src: '/reel/brands/y2k-flip-phone.jpg', width: 720, height: 1280 },
                app_platform: { src: '/reel/brands/morphic-september-01.jpg', width: 960, height: 720 },
                beauty_fashion: { src: '/reel/brands/city-fashion.jpg', width: 1280, height: 960 },
              }[id];
              return <a key={id} data-service-example={id} data-inquiry-trigger href={`${brandsHref(locale)}?useCase=${id}#brands`} className="group block overflow-hidden rounded-2xl bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue">
                <div className="aspect-[4/3] overflow-hidden bg-brand-ink"><img src={image.src} alt="" width={image.width} height={image.height} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105" /></div>
                <div className="p-6"><h3 className="flex items-center justify-between gap-4 text-xl font-semibold tracking-tight">{example.title}<span aria-hidden="true" className="text-blue">↗</span></h3><p className="mt-3 text-sm leading-relaxed opacity-65">{example.body}</p></div>
              </a>;
            })}
          </div>
        </div>
      </section>

      <section id="brands" data-section data-theme="light" data-brands className="section scroll-mt-24 border-y border-black/10 bg-white">
        <div className="audience-shell grid gap-12 py-16 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20 lg:py-24">
          <div><p className="audience-eyebrow">{t.inquiryEyebrow}</p><h2 className="audience-heading mt-5 whitespace-pre-line">{t.inquiryHeading}</h2><p className="mt-6 text-sm leading-relaxed opacity-60">{t.inquiryBody}</p>
          </div>
          <div className="flex items-center lg:justify-end"><a data-inquiry-trigger href={brandEnquiryHref(locale)} className="inline-flex min-h-14 items-center gap-10 rounded-full bg-blue px-8 py-4 text-base font-semibold text-white">{t.primaryCta} <span aria-hidden="true">↗</span></a></div>
          <BrandInquiryDialog endpoint={BRAND_INQUIRY_ENDPOINT} locale={locale} labels={dict.campaigns.brands} privacy={{ href: legalHref(locale, 'privacy'), label: legalDocument('privacy', locale).title }} title={t.inquiryDialogTitle} body={t.inquiryBody} close={t.inquiryClose} />
        </div>
      </section>

      <section data-section data-theme="dark" data-production-service className="section bg-brand-night text-white">
        <div className="audience-shell grid gap-10 py-16 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:py-24">
          <div><p className="audience-eyebrow text-brand-blue-light">{t.productionEyebrow}</p><h2 className="mt-5 text-[clamp(2rem,4vw,4rem)] whitespace-pre-line font-semibold leading-tight tracking-tight">{t.productionHeading}</h2><p className="mt-5 max-w-md text-sm leading-relaxed text-white/65">{t.productionBody}</p>
            <p data-production-collabs className="mt-4 inline-block rounded-lg border border-white/12 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-white/80">{t.productionCollabs}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="https://pitch.com/v/yagi-production-wokrs-vsrgfd" target="_blank" rel="noopener noreferrer" data-production-deck className="inline-flex min-h-12 items-center gap-4 rounded-full bg-blue px-6 text-sm font-semibold text-white">{t.productionDeckCta} ↗</a>
              <a href={t.companyDeckUrl} target="_blank" rel="noopener noreferrer" data-company-deck className="inline-flex min-h-12 items-center gap-3 rounded-full border border-white/25 bg-white/[0.04] px-5 text-sm font-medium text-white transition-colors hover:bg-white/10">{t.companyDeckCta} ↗</a>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2"><a data-inquiry-trigger href={`${brandsHref(locale)}?type=production#brands`} className="inline-flex min-h-11 items-center text-sm underline decoration-white/35 underline-offset-6">{t.productionCta} ↗</a><a href="https://pricing.yagiworkshop.xyz/" target="_blank" rel="noopener noreferrer" data-production-pricing className="inline-flex min-h-11 items-center text-sm underline decoration-white/35 underline-offset-6">{t.pricingCta} ↗</a></div><p className="mt-3 max-w-md text-xs leading-relaxed text-white/60">{t.pricingNote}</p>
          </div>
          <div data-production-films><MorphicFilmPair media={[{ id: 'production-paris', src: '/reel/brands/production-paris.mp4', poster: '/reel/brands/production-paris.jpg', width: 1280, height: 720 }, { id: 'production-beauty', src: '/reel/campaigns/beauty-rose.mp4', poster: '/reel/campaigns/beauty-rose.jpg', width: 1280, height: 720 }]} labels={{ titles: t.productionFilms, play: t.media.play, pause: t.media.pause }} /></div>
        </div>
      </section>
      <FaqSection dict={dict} locale={locale} placement="brand" path={brandsHref(locale)} />
      <aside data-creator-door className="audience-shell flex flex-wrap items-center justify-between gap-6 border-t border-hairline py-10"><div><h2 className="text-lg font-semibold">{dict.audience.creatorDoor}</h2><p className="mt-2 max-w-xl text-sm opacity-60">{dict.audience.creatorDoorBody}</p></div><a href={`/${locale}`} className="text-sm font-medium underline underline-offset-4">{dict.audience.creatorDoorCta} ↗</a></aside>
    </main>
    <MarketingFooter locale={locale} dict={dict} audience="brand" />
  </>;
}
