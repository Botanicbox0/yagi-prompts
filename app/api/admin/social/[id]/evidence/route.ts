import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { adminSocialEvidence } from '@/lib/influencers/admin';

/** The "SNS 확인" queue's screenshot preview: administrators only, never cached (§17.1). */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer.isAdmin) return new Response(null, { status: 404, headers });
  try {
    const sql = await getSqlRunner();
    if (!sql) return new Response(null, { status: 503, headers });
    const key = await adminSocialEvidence(sql, (await params).id);
    if (!key) return new Response(null, { status: 404, headers });
    const bytes = await (await getRenderStore()).read(key);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
  } catch { return new Response(null, { status: 404, headers }); }
}
