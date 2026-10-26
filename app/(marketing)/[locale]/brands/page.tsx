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
              <p className="mt-6 max-w-xl whitespace-pre-line text-pretty text-base leading-[1.68] text-white/78 sm:text-lg">{t.body}</p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <a data-campaign-cta-brand data-inquiry-trigger href={brandEnquiryHref(locale)} className="inline-flex min-h-12 items-center rounded-full bg-blue px-6 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">{t.primaryCta} ↗</a>
                <a href="#morphic-case" className="inline-flex min-h-11 items-center text-sm underline decoration-white/35 underline-offset-8">{t.secondaryCta}</a>
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
          <div data-brand-formula className="mt-12 grid gap-4 border-t border-white/14 pt-8 lg:grid-cols-3">
            {/* Stage 01: Master Brand Film */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/14 bg-white/[0.03] p-5 transition-colors hover:border-white/28 hover:bg-white/[0.05]">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px] tracking-[0.12em] text-brand-blue-light">
                <span>01 // MASTER FILM</span>
                <span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-0.5 text-[10px] text-white/75">1 BESPOKE CUT</span>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black">
                  <img src="/reel/brands/production-paris.jpg" alt="" width={160} height={112} decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-white/90">YAGI 4K</span>
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-tight text-white">{t.formula.item1Title}</p>
                  <p className="mt-1.5 text-pretty text-xs leading-[1.6] text-white/66">{t.formula.item1Body}</p>
                </div>
              </div>
            </div>

            {/* Stage 02: Infinite Creator Scale (Selfie -> Scene visual equation) */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/14 bg-white/[0.03] p-5 transition-colors hover:border-white/28 hover:bg-white/[0.05]">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px] tracking-[0.12em] text-brand-blue-light">
                <span>02 // AI CREATOR EXPANSION</span>
                <span className="rounded-full border border-brand-blue-light/35 bg-blue/20 px-2.5 py-0.5 text-[10px] text-brand-blue-light">1 SELFIE → N× CUTS</span>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex shrink-0 items-center gap-1.5">
                  <img src="/reel/studio-demo/fashion-selfie.jpg" alt="" width={64} height={80} decoding="async" className="h-20 w-14 rounded-xl object-cover object-top ring-1 ring-white/20" />
                  <span aria-hidden="true" className="font-mono text-xs text-brand-blue-light">→</span>
                  <img src="/reel/studio-demo/fashion-scene.jpg" alt="" width={64} height={80} decoding="async" className="h-20 w-14 rounded-xl object-cover object-top ring-1 ring-brand-blue-light/45" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-tight text-white">{t.formula.item2Title}</p>
                  <p className="mt-1.5 text-pretty text-xs leading-[1.6] text-white/66">{t.formula.item2Body}</p>
                </div>
              </div>
            </div>

            {/* Stage 03: Simultaneous KR & JP Feed Rollout */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/14 bg-white/[0.03] p-5 transition-colors hover:border-white/28 hover:bg-white/[0.05]">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px] tracking-[0.12em] text-brand-blue-light">
                <span>03 // LIVE FEED ROLLOUT</span>
                <span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-0.5 text-[10px] text-white/75">KR · JP SYNC</span>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex shrink-0 items-center -space-x-2.5">
                  <img src="/reel/brands/y2k-flip-phone.jpg" alt="" width={64} height={80} decoding="async" className="h-20 w-14 rounded-xl object-cover object-top ring-2 ring-brand-night" />
                  <img src="/reel/studio-demo/different-person.jpg" alt="" width={64} height={80} decoding="async" className="h-20 w-14 rounded-xl object-cover object-top ring-2 ring-brand-night" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-tight text-white">{t.formula.item3Title}</p>
                  <p className="mt-1.5 text-pretty text-xs leading-[1.6] text-white/66">{t.formula.item3Body}</p>
                </div>
              </div>
            </div>
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

          <BrandCraftShowcase copy={t.craftStrip} locale={locale} />
        </div>
      </section>

      <section id="process" data-section data-theme="light" data-campaign-principles data-campaign-process className="section scroll-mt-24 border-t border-black/10 bg-white">
        <div className="audience-shell py-16 lg:py-24">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/12 pb-6">
            <div>
              <p className="audience-eyebrow">{t.moatEyebrow}</p>
              <p className="mt-2 font-mono text-xs tracking-[0.1em] text-black/45">
                {locale === 'ko' ? 'END-TO-END AI CAMPAIGN ARCHITECTURE // 01 → 03' : 'END-TO-END AI CAMPAIGN ARCHITECTURE // 01 → 03'}
              </p>
            </div>
            <span className="rounded-full border border-black/12 bg-black/[0.03] px-3.5 py-1.5 font-mono text-[11px] tracking-[0.08em] text-black/70">
              {locale === 'ko' ? 'OFFLINE SHOOTS: 0 · PRODUCT SHIPPING: 0' : 'OFFLINE SHOOTS: 0 · PRODUCT SHIPPING: 0'}
            </span>
          </div>

          <ol className="mt-8 grid gap-6 lg:grid-cols-3">
            {[
              {
                index: '01',
                code: 'STEP 01 // FORMAT DIRECTION',
                deliverable: locale === 'ko' ? '마스터 필름 1편' : '1 Master Film',
                heading: t.moat1Title,
                body: t.moat1Body,
                img: '/reel/brands/production-paris.jpg',
                subImg: '/reel/campaigns/beauty-rose.jpg',
                caption: locale === 'ko' ? 'YAGI 인하우스 아트디렉션 · 4K 마스터' : 'YAGI In-House Direction · 4K Master',
              },
              {
                index: '02',
                code: 'STEP 02 // CREATOR EXPANSION',
                deliverable: locale === 'ko' ? '크리에이터 N편 생성' : 'N× Creator Cuts',
                heading: t.moat2Title,
                body: t.moat2Body,
                img: '/reel/studio-demo/fashion-scene.jpg',
                subImg: '/reel/studio-demo/fashion-selfie.jpg',
                caption: locale === 'ko' ? '셀카 1장 → 동일 조명·무빙 무한 확장' : '1 Selfie → Identical Lighting & Camera',
              },
              {
                index: '03',
                code: 'STEP 03 // LIVE FEED & REPORT',
                deliverable: locale === 'ko' ? '한·일 피드 게시 + 리포트' : 'KR·JP Posts + Report',
                heading: t.moat3Title,
                body: t.moat3Body,
                img: '/reel/brands/morphic-september-01.jpg',
                subImg: '/reel/brands/y2k-flip-phone.jpg',
                caption: locale === 'ko' ? '실제 계정 업로드 링크 · 성과 대시보드' : 'Verified Live Post Links & Performance',
              },
            ].map((step) => (
              <li
                key={step.heading}
                className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-black/12 bg-[#FAFAFA] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-black/30 hover:bg-white"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 border-b border-black/10 pb-4">
                    <span className="font-mono text-xs font-semibold tracking-wider text-blue">{step.code}</span>
                    <span className="rounded-full border border-black/12 bg-white px-2.5 py-0.5 font-mono text-[10px] font-medium text-black/75">
                      {step.deliverable}
                    </span>
                  </div>
                  <div className="relative mt-5 aspect-[16/10] overflow-hidden rounded-xl border border-black/10 bg-brand-night">
                    <img
                      src={step.img}
                      alt=""
                      width={640}
                      height={400}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" aria-hidden="true" />
                    <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] tracking-wider text-white/90">{step.caption}</span>
                      <img
                        src={step.subImg}
                        alt=""
                        width={48}
                        height={48}
                        loading="lazy"
                        decoding="async"
                        className="h-9 w-9 rounded-lg border border-white/30 object-cover"
                      />
                    </div>
                  </div>
                  <div className="mt-6 flex items-baseline gap-3">
                    <span className="font-mono text-2xl font-semibold tracking-tighter text-blue">{step.index}</span>
                    <h2 className="text-xl font-semibold tracking-[-0.025em] text-brand-ink">{step.heading}</h2>
                  </div>
                  <p className="mt-2.5 text-pretty text-sm leading-[1.68] text-brand-ink/72">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div data-brand-markets className="mt-14 overflow-hidden rounded-2xl border border-black/12 bg-[#F6F6F4] p-7 sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
              <div>
                <p className="font-mono text-xs font-semibold tracking-[0.12em] text-blue">CROSS-BORDER DISPATCH // KR ↔ JP</p>
                <h2 className="mt-3 whitespace-pre-line text-balance text-[clamp(1.75rem,3.2vw,2.85rem)] font-semibold leading-[1.14] tracking-[-0.035em]">{t.marketsHeading}</h2>
                <p className="mt-4 max-w-xl text-pretty text-sm leading-[1.68] text-brand-ink/72 sm:text-base">{t.marketsBody}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-black/12 bg-white p-5">
                  <div className="flex items-center justify-between font-mono text-xs text-black/55">
                    <span className="font-semibold text-blue">KR // SEOUL</span>
                    <span>ACTIVE POOL</span>
                  </div>
                  <p className="mt-3 text-base font-semibold tracking-tight text-brand-ink">
                    {locale === 'ko' ? '한국 크리에이터 피드 동시 확산' : 'Korea Creator Feed Rollout'}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/65">
                    {locale === 'ko' ? 'Instagram Reels · TikTok · YouTube Shorts 동시 게시 및 표시광고 검수' : 'Simultaneous Instagram Reels, TikTok & Shorts publishing'}
                  </p>
                </div>
                <div className="rounded-xl border border-black/12 bg-white p-5">
                  <div className="flex items-center justify-between font-mono text-xs text-black/55">
                    <span className="font-semibold text-blue">JP // TOKYO</span>
                    <span>ACTIVE POOL</span>
                  </div>
                  <p className="mt-3 text-base font-semibold tracking-tight text-brand-ink">
                    {locale === 'ko' ? '일본 크리에이터 피드 동시 확산' : 'Japan Creator Feed Rollout'}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/65">
                    {locale === 'ko' ? '별도 현지 로케이션 촬영 없이 일본 타깃 타임라인 동시 진입' : 'Direct Tokyo timeline entry with zero local production overhead'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-black/15 bg-brand-night p-7 text-white sm:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/12 pb-5">
              <p className="audience-eyebrow text-brand-blue-light">{t.scalePillars.eyebrow}</p>
              <span className="font-mono text-[11px] tracking-[0.12em] text-white/50">ENTERPRISE LIKENESS & DATA GOVERNANCE</span>
            </div>
            <dl data-brand-scale-pillars className="mt-6 grid gap-7 sm:grid-cols-3 sm:gap-10">
              {[
                { code: '01 // ZERO AI TRAINING', value: t.scalePillars.networkValue, label: t.scalePillars.networkLabel },
                { code: '02 // ISOLATED VAULT', value: t.scalePillars.shootsValue, label: t.scalePillars.shootsLabel },
                { code: '03 // AUTO-PURGE', value: t.scalePillars.complianceValue, label: t.scalePillars.complianceLabel },
              ].map((pillar) => (
                <div key={pillar.value} className="border-t border-white/14 pt-5 first:border-t-0 first:pt-0 sm:border-t sm:first:border-t sm:first:pt-5">
                  <span className="font-mono text-[11px] tracking-[0.1em] text-brand-blue-light">{pillar.code}</span>
                  <dt className="mt-2.5 text-lg font-semibold leading-[1.3] tracking-[-0.03em] text-white sm:text-xl">{pillar.value}</dt>
                  <dd className="mt-2 text-pretty text-sm leading-[1.65] text-white/68">{pillar.label}</dd>
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
