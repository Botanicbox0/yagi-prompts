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
      ? 'Make Your Own Video'
      : '나만의 영상 제작하기';
  const description =
    locale === 'en'
      ? 'Become the star of any video with one selfie, then share it as your own template.'
      : '셀카 한 장으로 내가 주인공인 영상을 만들고, 나만의 템플릿으로 공유해 보세요.';
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
              <p className="text-xs font-semibold text-[#3063A7]">
                {locale === 'en'
                  ? 'Make Your Own Video'
                  : '나만의 영상 제작하기'}
              </p>
              <h1 className="audience-title mt-3">
                {locale === 'en'
                  ? 'Become the star\nof any video'
                  : '영상 속 주인공,\n이제 내가 되어보세요'}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-black/65">
                {locale === 'en'
                  ? 'All you need is a reference video and one selfie. Like how it turned out? Publish it as a template so others can make their own.'
                  : '레퍼런스 영상과 셀카 한 장이면 충분해요. 마음에 들면 템플릿으로 공개해서 다른 사람도 만들 수 있게 해 보세요.'}
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
