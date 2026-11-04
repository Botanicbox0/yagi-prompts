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
      ? 'Freestyle Yourself — Turn Any Reference Film Into Your Own Template'
      : 'Freestyle Yourself · 나만의 템플릿 — 레퍼런스 영상으로 내 장면을 찍고 템플릿으로 등판하기';
  const description =
    locale === 'en'
      ? 'Bring a saved reference video, cast your own face with a clean front photo, and launch your finished scene as an official TWINGS template.'
      : '저장해 둔 레퍼런스 영상과 내 정면 실사 사진으로 세상에 없던 장면을 연출하고, 완성된 결과물을 나만의 공식 템플릿으로 등판시키세요.';
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
                  ? 'FREESTYLE YOURSELF · REFERENCE FILM TO OFFICIAL TEMPLATE'
                  : 'FREESTYLE YOURSELF · 나만의 장면에서 나만의 템플릿까지'}
              </p>
              <h1 className="audience-title mt-3">
                {locale === 'en'
                  ? 'Freestyle Yourself.\nDirect your scene,\nthen launch your template.'
                  : '세상에 없던 내 장면을 찍고,\n그대로 나만의 템플릿으로\n등판시키세요'}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-black/65">
                {locale === 'en'
                  ? 'Have a reference clip you love? Cast yourself in it with a single front selfie. When the film comes out right, lock its camera and lighting in one click so anyone on TWINGS can star in your scene.'
                  : '평소 저장해 두었던 레퍼런스 영상에 내 정면 사진 한 장을 입혀 단 하나뿐인 장면을 완성해 보세요. 결과물이 마음에 들면 카메라와 조명을 그대로 잠가, 다른 사람들도 내 연출로 주인공이 되는 공식 템플릿으로 출시할 수 있습니다.'}
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
