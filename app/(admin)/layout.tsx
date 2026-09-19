import '@/app/globals.css';
import './workspace.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { fontVariables } from '@/app/fonts';
import { requireAdmin } from '@/lib/auth/viewer';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';

/**
 * Root layout for `/admin/*` (§3.8). Dense utilitarian surface: no ad rail, no scroll theatrics,
 * therefore no ScrollProvider.
 *
 * The gate is two-layered (§3.7): middleware refuses anyone without a session at the edge, and
 * `requireAdmin()` verifies `profiles.is_admin` here with the service-role client — the anon
 * client cannot read it, because RLS is deny-all. A non-admin gets a 404, not a 403: the admin
 * surface should not confirm its own existence.
 */
export const dynamic = 'force-dynamic';

/** F6 — same browser-chrome color as the other two roots. */
export const viewport: Viewport = { themeColor: '#ffffff' };

/** Same reasoning as `app/(app)/layout.tsx`: own root layout, so own `<title>`. */
export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocaleFromHeaders());
  return {
    title: { default: dict.admin.brand, template: `%s · ${dict.admin.brand}` },
    robots: { index: false, follow: false },
  };
}

export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    notFound();
  }

  const locale = await getLocaleFromHeaders();
  return (
    <html lang={locale} className={fontVariables} data-workspace-admin>
      <head>
        <link rel="stylesheet" href="/fonts/helvetica-neue/helvetica-neue.css" />
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-hangul-mono.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
