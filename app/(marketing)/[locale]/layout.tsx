import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from '@/app/fonts';
import { ScrollProvider } from '@/components/motion/scroll-provider';
import { LOCALES, isLocale, DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Root layout for the PUBLIC, locale-prefixed surface (§3.9 / §4).
 *
 * It is a root layout (owns <html>/<body>) so that `lang` can be a real, per-locale attribute
 * without reading headers — reading headers here would opt landing and pricing out of static
 * rendering, and §3.1 requires them static + tagged + TTL. The app and admin groups have their
 * own root layouts for the same reason, in the other direction.
 */

export function generateStaticParams(): Array<{ locale: Locale }> {
  return LOCALES.map((locale) => ({ locale }));
}

/** Anything that is not `en` or `ko` is a 404, not a dynamic render. */
export const dynamicParams = false;

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);

  return {
    metadataBase: new URL(appUrl),
    title: { default: dict.meta.siteName, template: `%s · ${dict.meta.siteName}` },
    description: dict.meta.tagline,
    alternates: {
      canonical: `/${locale}`,
      languages: {
        en: '/en',
        ko: '/ko',
        'x-default': '/en',
      },
    },
  };
}

export default async function MarketingRootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <html lang={locale} className={fontVariables}>
      <head>
        {/* Pretendard ships Korean as a 92-slice unicode-range dynamic subset; it cannot go
            through next/font/local, so it is linked as self-hosted vendor CSS (§5.2). */}
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
      </head>
      <body>
        <ScrollProvider>{children}</ScrollProvider>
      </body>
    </html>
  );
}
