import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getVerifiedEmail } from '@/lib/auth/verified-email';
import { getSqlRunner } from '@/lib/db/connect';
import { loadBrandWorkspaceScope } from '@/lib/brands/workspace/service';
import { BRAND_LANDING_PATH, brandLandingPath } from '@/lib/brands/workspace/home';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl } from '@/lib/routing/surfaces';

/**
 * `GET /brand/start` — the brand host's default landing (docs/BRAND-STUDIO-V3.md §12).
 *
 * Sign-in without a `next`, the bare host and a refused `next` all come here. A brand whose workspace
 * opens on the studio goes to the home (`/brand/home`); everyone else (a sandboxed or generation-closed
 * brand, a project-only brand, a campaign-only guest, an account with no brand yet, a deployment with
 * studio v2 off) goes to `/brand`, exactly where they landed before. An explicit `next` never comes
 * here, so deep links are unchanged.
 */
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(request: Request): Promise<Response> {
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  if (!url) return new Response(null, { status: 404, headers: HEADERS });
  const viewer = await getViewer();
  if (!viewer.userId) {
    const chooser = new URL('/auth/choose', url.origin);
    chooser.searchParams.set('next', BRAND_LANDING_PATH);
    return NextResponse.redirect(chooser, { status: 307, headers: HEADERS });
  }
  let target = '/brand';
  try {
    const sql = await getSqlRunner();
    if (sql) {
      const scope = await loadBrandWorkspaceScope({ sql, verifiedEmail: await getVerifiedEmail(viewer.userId) }, viewer);
      target = brandLandingPath(scope.choices, brandStudioV2Open());
    }
  } catch {
    // The workspace could not be read: `/brand` shows its own unavailable state, as it always has.
    target = '/brand';
  }
  return NextResponse.redirect(new URL(target, url.origin), { status: 307, headers: HEADERS });
}
