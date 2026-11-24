import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore, RenderObjectNotFound } from '@/lib/renders/store';
import { ownSelfie } from '@/lib/identity/selfie-service';

/**
 * A saved photo's bytes, for its owner only. Replaced photos still answer (an order's history shows
 * them); a deleted one is gone for its owner too, even though its file stays until account deletion.
 * 404 means no such photo, or its file is gone; any other failure (storage, database) is a 500.
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
  } catch (error) {
    if (error instanceof RenderObjectNotFound) return new Response(null, { status: 404, headers });
    // The store's messages carry the object key and an HTTP status, never a credential.
    console.error('[identity] selfie image failed', error instanceof Error ? `${error.name}: ${error.message}` : typeof error);
    return new Response(null, { status: 500, headers });
  }
}
