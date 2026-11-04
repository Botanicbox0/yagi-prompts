import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { templatesHref } from '@/lib/prompts/links';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { SITE_TWITTER_CARD, siteOgImage } from '@/lib/seo/og';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { DirectSceneStudio } from '@/components/audience/direct-scene-studio';

export const revalidate = 3600;

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const title =
    locale === 'en'
      ? 'Direct Your Scene — Reference Film to Personal Template'
      : '직접 연출 — 레퍼런스 영상으로 내 장면을 만들고 템플릿으로 등판하기';
  const description =
    locale === 'en'
      ? 'Bring a reference video, cast your own face with a clean front photo, and publish your finished scene as a reusable TWINGS template.'
      : '원하는 레퍼런스 영상과 내 정면 실사 사진으로 완성도 높은 장면을 제작하고, 완성된 결과물을 나만의 공식 템플릿으로 등록하는 가이드를 확인하세요.';
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/direct`,
      languages: { en: '/en/direct', ko: '/ko/direct', 'x-default': '/en/direct' }
    },
    openGraph: {
      type: 'website',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}/direct`,
      title: `${dict.meta.siteName} — ${title}`,
      description,
      siteName: dict.meta.siteName,
      images: [siteOgImage(locale)]
    },
    twitter: { card: SITE_TWITTER_CARD }
  };
}

export default async function DirectScenePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest="/direct" />
      <main id="main" data-direct-scene-page>
        <section data-section data-theme="light" className="section">
          <div className="audience-shell pt-28 pb-16 lg:pt-36 lg:pb-24">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-semibold tracking-[0.08em] text-[#3063A7] uppercase tabular-nums">
                {locale === 'en'
                  ? 'DIRECT SCENE STUDIO · REFERENCE FILM TO TEMPLATE'
                  : 'DIRECT SCENE STUDIO · 레퍼런스 영상 연출 & 템플릿 등판'}
              </p>
              <h1 className="audience-title mt-3">
                {locale === 'en'
                  ? 'Bring a reference film.\nStar in it.\nPublish it as a template.'
                  : '원하는 레퍼런스 영상으로\n내 장면을 연출하고,\n그대로 템플릿으로 등판시키세요'}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-black/65">
                {locale === 'en'
                  ? 'Learn how to submit a reference video and your front selfie for maximum facial likeness, and see how your finished scene locks its camera and lighting when promoted to an official template.'
                  : '어떤 레퍼런스 영상과 사진을 넣어야 얼굴 왜곡 없이 가장 완성도 높은 영상이 나오는지 확인하고, 내 사진 기반으로 만든 결과물이 어떤 고정(Lock) 규칙을 거쳐 공식 템플릿으로 등록되는지 직접 설계해 보세요.'}
              </p>
            </div>

            <div className="mt-12">
              <DirectSceneStudio
                locale={locale}
                videoCatalogHref={templatesHref(locale, 'video')}
                creatorWorkspaceHref={`${CREATOR_WORKSPACE_PATH}/formats/new`}
              />
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
