import '@/app/globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { fontVariables } from '@/app/fonts';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { JsonLd } from '@/lib/seo/json-ld';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { productionStructuredData, productionUrl, YAGI_ORIGIN } from '@/lib/yagi/seo';

export const dynamicParams = false;
export const revalidate = 3600;
export const viewport: Viewport = { themeColor: '#f7f6f2' };
export const generateStaticParams = () => LOCALES.map(locale => ({ locale }));

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = getDictionary(locale).yagi;
  return {
    metadataBase: new URL(YAGI_ORIGIN), title: t.title, description: t.description,
    alternates: { canonical: productionUrl(locale), languages: { en: productionUrl('en'), ko: productionUrl('ko'), 'x-default': productionUrl('en') } },
    icons: { icon: '/yagi/yagi-mark.png', apple: '/yagi/yagi-mark.png' },
    openGraph: { type: 'website', siteName: t.brand, url: productionUrl(locale), title: t.title, description: t.description,
      locale: locale === 'ko' ? 'ko_KR' : 'en_US', alternateLocale: locale === 'ko' ? 'en_US' : 'ko_KR',
      images: [{ url: '/reel/campaigns/beauty-rose.jpg', width: 1280, height: 720, alt: t.work.beauty.alt }] },
    twitter: { card: 'summary_large_image', title: t.title, description: t.description, images: ['/reel/campaigns/beauty-rose.jpg'] },
  };
}

export default async function ProductionLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  return <html lang={locale} className={fontVariables}><head>
    <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
  </head><body className="yagi-site">
    <JsonLd id="yagi-structured-data" data={productionStructuredData(locale, getDictionary(locale))} />
    {children}
  </body></html>;
}
