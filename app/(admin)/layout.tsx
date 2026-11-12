import '@/app/globals.css';
import './workspace.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { fontVariables } from '@/app/fonts';
import { getViewer, requireAdmin } from '@/lib/auth/viewer';
import { requestSurface } from '@/lib/routing/request-surface';
import { ADMIN_NO_ACCESS_PATH } from '@/lib/admin/no-access';
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
 *
 * P1-6 (2026-09-23): the one exception is a SIGNED-IN non-admin on the dedicated admin host, who
 * already knows the host exists and would otherwise be stuck on a bare 404 with no way to switch
 * accounts. They are redirected (307) to `/admin/no-access`, a route handler that answers 403 with a
 * sign-out form. A redirect rather than rendering the notice here: Next renders the page segment's
 * RSC payload alongside this layout, so a layout that merely swapped `children` out would still ship
 * the admin page's data. On the consumer host, and for anonymous visitors, nothing changes.
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
    const [surface, viewer] = await Promise.all([requestSurface(), getViewer().catch(() => null)]);
    if (surface.admin && viewer !== null && viewer.userId !== null) redirect(ADMIN_NO_ACCESS_PATH);
    notFound();
  }

  const locale = await getLocaleFromHeaders();
  return (
    // `data-admin-console` scopes the console's own styles (docs/ADMIN.md §5): the creator
    // workspace in `app/(app)` also sets `data-workspace-admin`, and must not inherit them.
    <html lang={locale} className={fontVariables} data-workspace-admin data-admin-console>
      <head>
        <link rel="stylesheet" href="/fonts/geist/geist.css" />
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-hangul-mono.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
