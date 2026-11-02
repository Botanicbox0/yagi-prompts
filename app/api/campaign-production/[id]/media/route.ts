import { getViewer } from '@/lib/auth/viewer';
import { getVerifiedEmail } from '@/lib/auth/verified-email';
import { getSqlRunner } from '@/lib/db/connect';
import { loadCampaignOutput } from '@/lib/campaigns/production-output';
import { getRenderStore } from '@/lib/renders/store';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
async function serve(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer, sql] = await Promise.all([params, getViewer(), getSqlRunner()]);
  if (!sql) return new Response(null, { status: 404, headers: HEADERS });
  const job = await loadCampaignOutput({ sql, verifiedEmail: await getVerifiedEmail(viewer.userId) }, viewer, id);
  if (!job || job.status !== 'succeeded' || !job.resultKey || job.resultMime !== 'video/mp4') return new Response(null, { status: 404, headers: HEADERS });
  const store = await getRenderStore();
  const download = new URL(request.url).searchParams.get('download') === '1';
  try {
    const signed = await store.url(job.resultKey, 600, download ? { download: `twings-campaign-${id}.mp4` } : undefined);
    if (signed) return new Response(null, { status: 302, headers: { ...HEADERS, Location: signed } });
    const bytes = await store.read(job.resultKey);
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { status: 200, headers: { ...HEADERS, 'Content-Type': job.resultMime, 'Content-Length': String(bytes.length), ...(download ? { 'Content-Disposition': `attachment; filename="twings-campaign-${id}.mp4"` } : {}) } });
  } catch { return new Response(null, { status: 404, headers: HEADERS }); }
}
export const GET = serve;
export const HEAD = serve;
