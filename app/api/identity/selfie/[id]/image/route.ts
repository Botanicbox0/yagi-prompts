import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { ownSelfie } from '@/lib/identity/selfie-service';

/**
 * A saved photo's bytes, for its owner only. Replaced photos still answer (an order's history shows
 * them); a deleted one is gone for its owner too, even though its file stays until account deletion.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer.userId) return new Response(null, { status: 401, headers });
  try {
    const sql = await getSqlRunner();
    if (!sql) return new Response(null, { status: 503, headers });
    const row = await ownSelfie(sql, viewer.userId, (await params).id);
    if (!row) return new Response(null, { status: 404, headers });
    const bytes = await (await getRenderStore()).read(row.input_key);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'image/png' } });
  } catch { return new Response(null, { status: 404, headers }); }
}
