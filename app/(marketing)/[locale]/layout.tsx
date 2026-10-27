import '@/app/globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from '@/app/fonts';
import { ScrollProvider } from '@/components/motion/scroll-provider';
import { Notice } from '@/components/marketing/notice';
import { RegisterServiceWorker } from '@/components/pwa/register-sw';
import { StoreShellScript } from '@/components/pwa/store-shell-script';
import { BottomTabs } from '@/components/app/bottom-tabs';
import { noticeLabels } from '@/components/marketing/notice-codes';
import { LOCALES, isLocale, DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { siteUrl } from '@/lib/seo/site-url';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteStructuredData } from '@/lib/seo/structured-data';

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

/**
 * F6 — the browser chrome color. White: §5.1's base surface, and what the nav sits on — in a tab and
 * in the installed app alike. `viewport-fit: cover` (docs/PLATFORM-2.0.md §5.2) hands the installed
 * app the whole screen; app/globals.css pads the page by the safe areas.
 */
export const viewport: Viewport = { themeColor: '#ffffff', viewportFit: 'cover' };

/** Anything that is not `en` or `ko` is a 404, not a dynamic render. */
export const dynamicParams = false;

/**
 * M7: through `siteUrl()`, not a raw env read. Same origin the sitemap, robots.txt and every
 * notification email resolve — so `APP_URL` alone works, a trailing slash is stripped, and an
 * unfilled `.env.example` placeholder falls back to localhost instead of becoming the OG host of a
 * production deployment.
 */
const appUrl = siteUrl();

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
    // docs/TEMPLATES-IA.md §5 — installable (PWA first); the manifest is served from app/manifest.ts.
    appleWebApp: { capable: true, title: dict.meta.siteName, statusBarStyle: 'default' },
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
  const dict = getDictionary(locale);

  return (
    <html lang={locale} className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Google Play app only: hides purchase surfaces before first paint (PLATFORM-2.0 §5.1). */}
        <StoreShellScript />
        {/* Pretendard ships Korean as a 92-slice unicode-range dynamic subset; it cannot go
            through next/font/local, so it is linked as self-hosted vendor CSS (§5.2). */}
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
        {/* The Hangul-only alias for the KO mono stack — generated, see
            scripts/pretendard-hangul-mono.ts. */}
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-hangul-mono.css" />
      </head>
      <body>
        <JsonLd id="site-structured-data" data={siteStructuredData(appUrl)} />
        <ScrollProvider>
          {/* F2 — the auth redirects' `?error=…` / `?signin=1` outcomes, rendered instead of
              silent. Client-only read of location.search, so the tree stays static (§3.1). */}
          <Notice labels={noticeLabels(dict)} locale={locale} />
          {children}
        </ScrollProvider>
        <RegisterServiceWorker />
        {/* Standalone only — renders nothing in a browser tab or in this static HTML. */}
        <BottomTabs locale={locale} labels={dict.appShell.tabs} />
      </body>
    </html>
  );
}
