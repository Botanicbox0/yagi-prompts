import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from '@/app/fonts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getRequestLocale } from '@/lib/i18n/server';

/**
 * Root layout for the authenticated app surface (§4: `/library`, `/account`, `/billing/*`).
 * Unprefixed, `noindex`, and dynamic by contract — §3.4 puts every viewer-shaped route on
 * `force-dynamic` + `private, no-store` (middleware sets the header; this sets the render mode).
 */
export const dynamic = 'force-dynamic';

/**
 * A separate root layout means nothing is inherited from the marketing group — including the
 * `<title>`. Without this the browser tab on `/account` reads as a bare URL. The brand token comes
 * from the dictionary (`meta.siteName`), the one place M7 renamed.
 */
export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getRequestLocale());
  return {
    title: { default: dict.meta.siteName, template: `%s · ${dict.meta.siteName}` },
    robots: { index: false, follow: false },
  };
}

/**
 * `getRequestLocale`, not `getLocaleFromHeaders`: the header exists only where middleware ran,
 * and `/auth/open-in-browser` (F1) lives under the matcher's `/auth/*` exclusion. The full
 * chain reads the same cookie middleware would have — identical answers on every middleware-
 * covered route, and the right `<html lang>` on the one that is not.
 */
export default async function AppRootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} className={fontVariables}>
      <head>
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
