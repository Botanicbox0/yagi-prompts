import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getStorage, STAGING_BUCKET } from '@/lib/storage';
import { loadCampaignPreview } from '@/lib/campaigns/production-preview';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
async function serve(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer, sql] = await Promise.all([params, getViewer(), getSqlRunner()]);
  const missing = () => new Response(null, { status: 404, headers: HEADERS });
  if (!sql) return missing();
  const row = await loadCampaignPreview(sql, viewer, id); if (!row) return missing();
  const storage = await getStorage();
  try {
    const signed = await storage.signedStagingUrl?.(row.storage_key, 60);
    if (signed) return new Response(null, { status: 302, headers: { ...HEADERS, Location: signed } });
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...HEADERS, 'Content-Type': row.mime, 'Content-Length': String(row.size_bytes) } });
    const bytes = await storage.read(STAGING_BUCKET, row.storage_key);
    return new Response(new Uint8Array(bytes), { headers: { ...HEADERS, 'Content-Type': row.mime, 'Content-Length': String(bytes.length) } });
  } catch { return missing(); }
}
export const GET = serve;
export const HEAD = serve;
