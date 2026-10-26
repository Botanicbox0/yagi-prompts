import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BrandInquiryDialog } from '@/components/campaigns/brand-inquiry-dialog';
import { BrandFormatExplorer, BrandCraftShowcase, HeroCinemaGrid, MorphicFilmPair } from '@/components/campaigns/brand-experience';
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
  const ko = locale === 'ko';
  return <>
    <MarketingNav locale={locale} dict={dict} rest="/brands" />
    <JsonLd id="campaign-service-structured-data" data={campaignServiceStructuredData({ origin: siteUrl(), path: brandsHref(locale), locale, name: t.metaTitle, description: t.metaDescription, serviceType: dict.seo.serviceType })} />
    <JsonLd id="brand-case-studies-structured-data" data={brandCaseStudiesStructuredData({ origin: siteUrl(), locale, cases: [{ id: 'morphic', name: t.stories.title, description: t.stories.summary, path: `/${locale}/brands/stories/morphic` }] })} />

    <main id="main" data-brand-landing className="overflow-clip bg-white text-[#0A0A0A] [word-break:keep-all]">
      <section data-section data-theme="dark" data-campaign-hero className="section bg-[#0A0A0A] text-white">
        <div className="audience-shell pb-14 pt-28 lg:pb-20 lg:pt-36">
          <p className="audience-eyebrow text-white/45">{t.eyebrow}</p>
          <div className="mt-8 grid gap-12 lg:grid-cols-[0.94fr_1.06fr] lg:items-center lg:gap-16">
            <div>
              <h1 className="audience-title max-w-[13ch] whitespace-pre-line text-balance text-[clamp(2.35rem,10vw,6.2rem)] leading-[0.96] tracking-[-0.055em] sm:text-[clamp(3.2rem,6.5vw,5.6rem)] lg:text-[clamp(3.6rem,4.7vw,5.1rem)]">{t.title}</h1>
              <p className="mt-7 max-w-lg whitespace-pre-line text-pretty text-base leading-[1.7] text-white/60 sm:text-lg">{t.body}</p>
              <div className="mt-10 flex flex-wrap items-center gap-7">
                <a data-campaign-cta-brand data-inquiry-trigger="hero" href={brandEnquiryHref(locale)} className="inline-flex min-h-12 items-center rounded-full bg-white px-7 text-sm font-medium text-black transition-colors hover:bg-white/90">{t.primaryCta} ↗</a>
                <a href="#morphic-case" className="inline-flex min-h-11 items-center text-sm text-white/70 underline decoration-white/25 underline-offset-8 transition-colors hover:text-white">{t.secondaryCta}</a>
              </div>
            </div>
            <HeroCinemaGrid
              items={[
                { id: 'beauty', src: '/reel/campaigns/beauty-rose.mp4', poster: '/reel/campaigns/beauty-rose.jpg', width: 1280, height: 720, title: t.heroCinema.beautyTitle },
                { id: 'interview', src: '/reel/campaigns/highteen.mp4', poster: '/reel/campaigns/highteen.jpg', width: 1280, height: 720, title: t.heroCinema.interviewTitle },
                { id: 'paris', src: '/reel/brands/production-paris.mp4#t=2.2', poster: '/reel/brands/production-paris.jpg', width: 1280, height: 720, title: t.heroCinema.parisTitle },
                { id: 'creator', src: '/reel/brands/y2k-flip-phone.mp4', poster: '/reel/brands/y2k-flip-phone.jpg', width: 720, height: 1280, title: t.heroCinema.creatorTitle },
              ]}
            />
          </div>
          <div data-brand-formula className="mt-16 grid gap-10 border-t border-white/12 pt-8 lg:grid-cols-3 lg:gap-10">
            {[
              { index: '01', title: t.formula.item1Title, body: t.formula.item1Body, images: ['/reel/brands/production-paris.jpg'] },
              { index: '02', title: t.formula.item2Title, body: t.formula.item2Body, images: ['/reel/studio-demo/reference-selfie.jpeg', '/reel/studio-demo/different-person.jpg'] },
              { index: '03', title: t.formula.item3Title, body: t.formula.item3Body, images: ['/reel/brands/y2k-flip-phone.jpg', '/reel/brands/morphic-september-01.jpg'] },
            ].map((item) => (
              <div key={item.index} className="group">
                <span className="font-mono text-[11px] tracking-[0.14em] text-white/40">{item.index}</span>
                <div className="mt-4 flex items-start gap-5">
                  <div className="grid h-20 w-32 shrink-0 grid-flow-col gap-px overflow-hidden bg-white/12">
                    {item.images.map((src) => (
                      <img key={src} src={src} alt="" width={160} height={112} loading="lazy" decoding="async" className="h-full w-full bg-[#0A0A0A] object-cover object-[50%_22%] transition-transform duration-700 motion-safe:group-hover:scale-[1.03]" />
                    ))}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium tracking-[-0.02em] text-white">{item.title}</p>
                    <p className="mt-1.5 text-pretty text-[13px] leading-[1.6] text-white/50">{item.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="work" data-section data-theme="light" data-campaign-reel-section className="section scroll-mt-24 bg-white">
        <div className="audience-shell py-16 lg:py-24">
          <div className="mb-10 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div><p className="audience-eyebrow text-[#8A8780]">{t.reelEyebrow}</p><h2 className="audience-heading mt-4 max-w-xl">{t.reelHeading}</h2></div>
            <p className="max-w-lg text-pretty text-sm leading-[1.7] text-black/55 lg:justify-self-end">{t.reelBody}</p>
          </div>
          <BrandFormatExplorer items={CAMPAIGN_REEL} captions={t.formats} labels={t.media} />

          <BrandCraftShowcase copy={t.craftStrip} locale={locale} />
        </div>
      </section>

      <section id="process" data-section data-theme="light" data-campaign-principles data-campaign-process className="section scroll-mt-24 border-t border-black/10 bg-[#F7F6F2]">
        <div className="audience-shell py-20 lg:py-28">
          <p className="audience-eyebrow text-[#8A8780]">{t.moatEyebrow}</p>

          <ol className="mt-10 grid gap-14 lg:grid-cols-3 lg:gap-10">
            {[
              { index: '01', heading: t.moat1Title, body: t.moat1Body, img: '/reel/brands/production-paris.jpg', position: 'object-center' },
              { index: '02', heading: t.moat2Title, body: t.moat2Body, img: '/reel/studio-demo/different-person.jpg', position: 'object-[50%_22%]' },
              { index: '03', heading: t.moat3Title, body: t.moat3Body, img: '/reel/brands/morphic-september-01.jpg', position: 'object-center' },
            ].map((step) => (
              <li key={step.index} className="group border-t border-black/12 pt-6">
                <span className="font-mono text-xs text-black/40">{step.index}</span>
                <div className="mt-5 aspect-[16/10] overflow-hidden bg-black/[0.05]">
                  <img
                    src={step.img}
                    alt=""
                    width={640}
                    height={400}
                    loading="lazy"
                    decoding="async"
                    className={`h-full w-full object-cover ${step.position} transition-transform duration-700 motion-safe:group-hover:scale-[1.03]`}
                  />
                </div>
                <h2 className="mt-7 text-xl font-semibold tracking-[-0.025em] text-[#0A0A0A]">{step.heading}</h2>
                <p className="mt-2.5 max-w-[42ch] text-pretty text-sm leading-[1.7] text-black/60">{step.body}</p>
              </li>
            ))}
          </ol>

          <div data-brand-markets className="mt-24 grid gap-10 border-t border-black/12 pt-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <h2 className="whitespace-pre-line text-balance text-[clamp(1.75rem,3.2vw,2.85rem)] font-semibold leading-[1.14] tracking-[-0.035em]">{t.marketsHeading}</h2>
              <p className="mt-5 max-w-lg text-pretty text-sm leading-[1.7] text-black/60 sm:text-base">{t.marketsBody}</p>
            </div>
            <div className="grid gap-px self-start bg-black/10 sm:grid-cols-2">
              {[
                { market: 'KR', title: ko ? '한국 크리에이터 피드 동시 확산' : 'Korea Creator Feed Rollout', body: ko ? 'Instagram Reels · TikTok · YouTube Shorts 동시 게시 및 표시광고 검수' : 'Simultaneous Instagram Reels, TikTok & Shorts publishing' },
                { market: 'JP', title: ko ? '일본 크리에이터 피드 동시 확산' : 'Japan Creator Feed Rollout', body: ko ? '별도 현지 로케이션 촬영 없이 일본 타깃 타임라인 동시 진입' : 'Direct Tokyo timeline entry with zero local production overhead' },
              ].map((market) => (
                <div key={market.market} className="bg-[#F7F6F2] py-6 sm:px-7 sm:first:pl-0">
                  <p className="flex items-center gap-2 font-mono text-xs tracking-[0.14em] text-black/40">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-[#ED1E1E]" />
                    {market.market}
                  </p>
                  <p className="mt-4 text-base font-semibold tracking-tight text-[#0A0A0A]">{market.title}</p>
                  <p className="mt-1.5 text-pretty text-[13px] leading-[1.65] text-black/55">{market.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-16 bg-[#0A0A0A] p-8 text-white sm:p-12">
            <p className="audience-eyebrow text-white/45">{t.scalePillars.eyebrow}</p>
            <dl data-brand-scale-pillars className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-10">
              {[
                { code: '01', value: t.scalePillars.networkValue, label: t.scalePillars.networkLabel },
                { code: '02', value: t.scalePillars.shootsValue, label: t.scalePillars.shootsLabel },
                { code: '03', value: t.scalePillars.complianceValue, label: t.scalePillars.complianceLabel },
              ].map((pillar) => (
                <div key={pillar.code} className="border-t border-white/12 pt-5">
                  <span className="font-mono text-[11px] tracking-[0.14em] text-white/40">{pillar.code}</span>
                  <dt className="mt-3 text-lg font-semibold leading-[1.3] tracking-[-0.03em] text-white sm:text-xl">{pillar.value}</dt>
                  <dd className="mt-2 text-pretty text-sm leading-[1.65] text-white/55">{pillar.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section id="morphic-case" data-section data-theme="dark" data-campaign-proof className="section scroll-mt-20 bg-[#0A0A0A] text-white">
        <div className="audience-shell py-20 lg:py-28">
          <p className="audience-eyebrow text-white/45">{t.stories.eyebrow}</p>
          <div className="mb-12 mt-5 flex flex-wrap items-end justify-between gap-7"><h2 className="audience-heading whitespace-pre-line">{t.stories.title}</h2><a href={`/${locale}/brands/stories`} className="inline-flex min-h-11 items-center text-sm text-white/70 underline decoration-white/25 underline-offset-6 transition-colors hover:text-white">{t.stories.allCta} ↗</a></div>
          <BrandCustomerStory dict={dict} locale={locale} />
        </div>
      </section>

      <section id="campaign-types" data-section data-theme="light" data-campaign-use-cases className="section scroll-mt-24 bg-white">
        <div className="audience-shell py-20 lg:py-28">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-5"><div><p className="audience-eyebrow text-[#8A8780]">{t.typesEyebrow}</p><h2 className="audience-heading mt-4">{t.typesHeading}</h2></div><p className="max-w-md text-sm leading-relaxed text-black/55">{t.typesBody}</p></div>
          <div data-brand-service-examples className="grid gap-10 sm:grid-cols-3 sm:gap-6">
            {(['launch', 'app_platform', 'beauty_fashion'] as const).map((id) => {
              const example = t.examples[id];
              const image = {
                launch: { src: '/reel/brands/y2k-flip-phone.jpg', width: 720, height: 1280 },
                app_platform: { src: '/reel/brands/morphic-september-01.jpg', width: 960, height: 720 },
                beauty_fashion: { src: '/reel/brands/city-fashion.jpg', width: 1280, height: 960 },
              }[id];
              return <a key={id} data-service-example={id} data-inquiry-trigger href={`${brandsHref(locale)}?useCase=${id}#brands`} className="group block focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-black">
                <div className="aspect-[4/3] overflow-hidden bg-black/[0.05]"><img src={image.src} alt="" width={image.width} height={image.height} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-[1.03]" /></div>
                <div className="border-t border-black/10 pt-5 mt-5"><h3 className="flex items-center justify-between gap-4 text-lg font-semibold tracking-tight">{example.title}<span aria-hidden="true" className="text-black/30 transition-colors group-hover:text-black">↗</span></h3><p className="mt-2.5 text-sm leading-relaxed text-black/55">{example.body}</p></div>
              </a>;
            })}
          </div>
        </div>
      </section>

      <section id="brands" data-section data-theme="light" data-brands className="section scroll-mt-24 border-y border-black/10 bg-[#F7F6F2]">
        <div className="audience-shell grid gap-12 py-20 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20 lg:py-28">
          <div><p className="audience-eyebrow text-[#8A8780]">{t.inquiryEyebrow}</p><h2 className="audience-heading mt-5 whitespace-pre-line">{t.inquiryHeading}</h2><p className="mt-6 max-w-md text-sm leading-relaxed text-black/55">{t.inquiryBody}</p>
          </div>
          <div className="flex items-center lg:justify-end"><a data-inquiry-trigger href={brandEnquiryHref(locale)} className="inline-flex min-h-14 items-center gap-10 rounded-full bg-[#0A0A0A] px-8 py-4 text-base font-medium text-white transition-colors hover:bg-black/85">{t.primaryCta} <span aria-hidden="true">↗</span></a></div>
          <BrandInquiryDialog endpoint={BRAND_INQUIRY_ENDPOINT} locale={locale} labels={dict.campaigns.brands} privacy={{ href: legalHref(locale, 'privacy'), label: legalDocument('privacy', locale).title }} title={t.inquiryDialogTitle} body={t.inquiryBody} close={t.inquiryClose} />
        </div>
      </section>

      <section data-section data-theme="dark" data-production-service className="section bg-[#0A0A0A] text-white">
        <div className="audience-shell grid gap-12 py-20 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:py-28">
          <div><p className="audience-eyebrow text-white/45">{t.productionEyebrow}</p><h2 className="mt-5 text-[clamp(2rem,4vw,4rem)] whitespace-pre-line font-semibold leading-tight tracking-tight">{t.productionHeading}</h2><p className="mt-5 max-w-md text-sm leading-relaxed text-white/55">{t.productionBody}</p>
            <p data-production-collabs className="mt-5 border-t border-white/12 pt-4 text-xs leading-relaxed text-white/55">{t.productionCollabs}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="https://pitch.com/v/yagi-production-wokrs-vsrgfd" target="_blank" rel="noopener noreferrer" data-production-deck className="inline-flex min-h-12 items-center gap-4 rounded-full bg-white px-6 text-sm font-medium text-black transition-colors hover:bg-white/90">{t.productionDeckCta} ↗</a>
              <a href={t.companyDeckUrl} target="_blank" rel="noopener noreferrer" data-company-deck className="inline-flex min-h-12 items-center gap-3 rounded-full border border-white/20 px-5 text-sm font-medium text-white transition-colors hover:border-white/45">{t.companyDeckCta} ↗</a>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2"><a data-inquiry-trigger href={`${brandsHref(locale)}?type=production#brands`} className="inline-flex min-h-11 items-center text-sm text-white/70 underline decoration-white/25 underline-offset-6 transition-colors hover:text-white">{t.productionCta} ↗</a><a href="https://pricing.yagiworkshop.xyz/" target="_blank" rel="noopener noreferrer" data-production-pricing className="inline-flex min-h-11 items-center text-sm text-white/70 underline decoration-white/25 underline-offset-6 transition-colors hover:text-white">{t.pricingCta} ↗</a></div><p className="mt-3 max-w-md text-xs leading-relaxed text-white/45">{t.pricingNote}</p>
          </div>
          <div data-production-films><MorphicFilmPair media={[{ id: 'production-paris', src: '/reel/brands/production-paris.mp4', poster: '/reel/brands/production-paris.jpg', width: 1280, height: 720 }, { id: 'production-beauty', src: '/reel/campaigns/beauty-rose.mp4', poster: '/reel/campaigns/beauty-rose.jpg', width: 1280, height: 720 }]} labels={{ titles: t.productionFilms, play: t.media.play, pause: t.media.pause }} /></div>
        </div>
      </section>
      <FaqSection dict={dict} locale={locale} placement="brand" path={brandsHref(locale)} />
      <aside data-creator-door className="audience-shell flex flex-wrap items-center justify-between gap-6 border-t border-hairline py-10"><div><h2 className="text-lg font-semibold">{dict.audience.creatorDoor}</h2><p className="mt-2 max-w-xl text-sm text-black/55">{dict.audience.creatorDoorBody}</p></div><a href={`/${locale}`} className="text-sm font-medium underline underline-offset-4">{dict.audience.creatorDoorCta} ↗</a></aside>
    </main>
    <MarketingFooter locale={locale} dict={dict} audience="brand" />
  </>;
}
