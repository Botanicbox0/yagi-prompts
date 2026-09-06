import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { canStartRender } from '@/lib/renders/service';

/**
 * `GET /api/renders/access` — may THIS viewer start a real render? The template page is static
 * (one HTML for everyone), so the studio asks at mount time and switches from the demo to the
 * live make loop on the answer. The same rule the enqueue route applies; a viewer who forges
 * `true` here only reaches the 403 there.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const viewer = await getViewer();
  return NextResponse.json(
    { live: canStartRender(viewer) },
    { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } },
  );
}
