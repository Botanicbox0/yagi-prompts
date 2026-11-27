import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { templatesHref } from '@/lib/prompts/links';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { SITE_TWITTER_CARD, siteOgImage } from '@/lib/seo/og';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { DirectSceneStudio } from '@/components/audience/direct-scene-studio';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { heroEvidence } from '@/lib/content/slots';

export const revalidate = 3600;

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const ds = dict.creatorJourney.directScene;
  const title = ds.metaTitle;
  const description = ds.metaDescription;
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
  const catalog = await getPromptCatalog();
  const evidence = heroEvidence();

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest="/direct" />
      <main id="main" data-direct-scene-page>
        <section data-section data-theme="light" className="section">
          <DirectSceneStudio
            locale={locale}
            videoCatalogHref={templatesHref(locale, 'video')}
            creatorWorkspaceHref={`${CREATOR_WORKSPACE_PATH}/formats/new`}
            catalog={catalog}
            evidence={evidence}
          />
        </section>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
