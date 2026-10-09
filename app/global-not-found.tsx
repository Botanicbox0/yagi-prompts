import './globals.css';
import type { Metadata, Viewport } from 'next';
import { fontVariables } from '@/app/fonts';
import MarketingNotFound from '@/app/(marketing)/[locale]/not-found';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteStructuredData } from '@/lib/seo/structured-data';
import { siteUrl } from '@/lib/seo/site-url';

const copy = getDictionary(DEFAULT_LOCALE);

export const metadata: Metadata = {
  title: `${copy.notFound.title} · ${copy.meta.siteName}`,
  description: copy.notFound.body,
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#ffffff' };

/**
 * Unmatched URLs bypass the application's multiple root layouts. Keep this document static
 * and bilingual: a global 404 receives no URL params and must never read an account/session.
 */
export default function GlobalNotFound() {
  return (
    <html lang={DEFAULT_LOCALE} className={fontVariables}>
      <head>
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-hangul-mono.css" />
      </head>
      <body>
        <JsonLd id="site-structured-data" data={siteStructuredData(siteUrl())} />
        <MarketingNotFound />
      </body>
    </html>
  );
}
