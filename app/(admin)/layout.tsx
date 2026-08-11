import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { fontVariables } from '@/app/fonts';
import { requireAdmin } from '@/lib/auth/viewer';
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

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    notFound();
  }

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
