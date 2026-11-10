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
      ? 'Make Your Own Video & Earn 80% as a Template Maker'
      : '나만의 영상 제작하기 — 내 영상을 만들고 템플릿으로 올려 80% 수익 받기';
  const description =
    locale === 'en'
      ? 'Upload a saved reference video and your front selfie to make your own video. Publish it as a template and earn 80% of the net profit every time someone makes it.'
      : '저장해 둔 영상과 내 정면 사진으로 나만의 영상을 만들고, 그대로 템플릿으로 등록해 누군가 만들 때마다 순이익의 80%를 수익으로 정산받으세요.';
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
                  ? 'MAKE YOUR OWN VIDEO · EARN 80% WHEN OTHERS USE YOUR TEMPLATE'
                  : '나만의 영상 제작하기 · 내 영상을 템플릿으로 올리고 수익까지'}
              </p>
              <h1 className="audience-title mt-3">
                {locale === 'en'
                  ? 'Make your own video,\npublish it as a template,\nand earn 80% every make.'
                  : '저장해 둔 영상으로 내 장면을 만들고,\n템플릿으로 올려\n수익도 받으세요'}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-black/65">
                {locale === 'en'
                  ? 'Have a video clip you saved on Instagram or TikTok? Upload it with one front selfie to star in your own video. Love how it turned out? Publish it as a template — whenever someone makes a video with your template, 80% of the net profit goes to you.'
                  : '인스타그램이나 틱톡에서 저장해 둔 멋진 영상이 있나요? 내 정면 사진 한 장만 올리면 내가 주인공인 영상이 완성됩니다. 완성된 영상이 마음에 들면 템플릿으로 올려보세요 — 누군가 내 템플릿으로 만들 때마다 순이익의 80%가 내 수익으로 쌓입니다.'}
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
