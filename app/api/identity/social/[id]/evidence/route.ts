import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { ownSocialEvidence } from '@/lib/influencers/service';

/** A linked account's follower screenshot, for its owner only (docs/PLATFORM-2.0.md §17.1). */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer.userId) return new Response(null, { status: 401, headers });
  try {
    const sql = await getSqlRunner();
    if (!sql) return new Response(null, { status: 503, headers });
    const key = await ownSocialEvidence(sql, viewer.userId, (await params).id);
    if (!key) return new Response(null, { status: 404, headers });
    const bytes = await (await getRenderStore()).read(key);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
  } catch { return new Response(null, { status: 404, headers }); }
}
