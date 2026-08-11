import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from '@/app/fonts';
import { getLocaleFromHeaders } from '@/lib/i18n/server';

/**
 * Root layout for the authenticated app surface (§4: `/library`, `/account`, `/billing/*`).
 * Unprefixed, `noindex`, and dynamic by contract — §3.4 puts every viewer-shaped route on
 * `force-dynamic` + `private, no-store` (middleware sets the header; this sets the render mode).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppRootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocaleFromHeaders();
  return (
    <html lang={locale} className={fontVariables}>
      <head>
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
