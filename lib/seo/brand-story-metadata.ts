import type { Metadata } from 'next';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { siteOgImage } from './og';

export function brandStoryMetadata(locale: Locale, slug?: string): Metadata {
  const dict = getDictionary(locale), copy = dict.brandLanding.stories;
  const rest = `/brands/stories${slug ? `/${slug}` : ''}`;
  const title = slug ? copy.metaTitle : copy.indexMetaTitle;
  const description = slug ? copy.metaDescription : copy.indexBody;
  return {
    title, description,
    alternates: { canonical: `/${locale}${rest}`, languages: { ko: `/ko${rest}`, en: `/en${rest}`, 'x-default': `/en${rest}` } },
    openGraph: { type: 'website', siteName: dict.meta.siteName, title, description, url: `/${locale}${rest}`, locale: locale === 'ko' ? 'ko_KR' : 'en_US', images: [siteOgImage(locale)] },
    twitter: { card: 'summary_large_image', title, description, images: [siteOgImage(locale)] },
  };
}
