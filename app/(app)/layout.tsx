import '@/app/globals.css';
import '@/app/(admin)/workspace.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from '@/app/fonts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getRequestLocale } from '@/lib/i18n/server';
import { RegisterServiceWorker } from '@/components/pwa/register-sw';
import { requestSurface } from '@/lib/routing/request-surface';

/**
 * Root layout for the authenticated app surface (§4: `/library`, `/account`, `/billing/*`).
 * Unprefixed, `noindex`, and dynamic by contract — §3.4 puts every viewer-shaped route on
 * `force-dynamic` + `private, no-store` (middleware sets the header; this sets the render mode).
 */
export const dynamic = 'force-dynamic';

/** F6 — same browser-chrome color as the marketing tree: separate root, same product. */
export const viewport: Viewport = { themeColor: '#ffffff' };

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
    appleWebApp: { capable: true, title: dict.meta.siteName, statusBarStyle: 'default' },
  };
}

/**
 * `getRequestLocale`, not `getLocaleFromHeaders`: the header exists only where middleware ran,
 * and `/auth/open-in-browser` (F1) skips middleware session refresh after its host check. The full
 * chain reads the same cookie middleware would have — identical answers on every middleware-
 * covered route, and the right `<html lang>` on the one that is not.
 */
export default async function AppRootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const { workspace } = await requestSurface();
  return (
    <html lang={locale} className={fontVariables} data-workspace-admin={workspace || undefined}>
      <head>
        {workspace && <link rel="stylesheet" href="/fonts/helvetica-neue/helvetica-neue.css" />}
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-hangul-mono.css" />
      </head>
      <body>
        {children}
        {!workspace && <RegisterServiceWorker />}
      </body>
    </html>
  );
}
