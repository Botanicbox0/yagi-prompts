import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { requestSurface } from '@/lib/routing/request-surface';
import { ADMIN_ORIGIN } from '@/lib/seo/site-url';
import { adminNoAccessHtml } from '@/lib/admin/no-access';

/**
 * `GET /admin/no-access` (P1-6) — a signed-in account without `is_admin` on admin.twings.app.
 *
 * 403 with a sign-out form, and nothing else. Everywhere else it is the usual 404: the consumer
 * host keeps not confirming that /admin exists, and an anonymous visitor has no account to switch.
 * An admin who lands here is sent back to the dashboard.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const [surface, viewer] = await Promise.all([requestSurface(), getViewer().catch(() => null)]);
  if (!surface.admin || viewer === null || viewer.userId === null) return new NextResponse(null, { status: 404 });
  if (viewer.isAdmin) return NextResponse.redirect(new URL('/admin', surface.origin ?? ADMIN_ORIGIN), { status: 303 });
  const locale = await getLocaleFromHeaders();
  return new NextResponse(adminNoAccessHtml(locale, getDictionary(locale).admin), {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}
