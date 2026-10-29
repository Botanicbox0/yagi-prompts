import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { publicContentUrl } from '@/lib/content/asset-url';
import { landingMediaSlot } from '@/lib/content/landing-media';
import { loadLandingMediaRows } from '@/lib/content/landing-media-repo';
import { getStorage, StorageObjectNotFound } from '@/lib/storage';

/**
 * `GET /api/landing-media/<area>/<name>` — a replaced landing image (lib/content/landing-media.ts).
 *
 * The pages link the public bucket directly on a Supabase project; this route is the other half:
 * local mode, where `.storage/` is a folder nothing serves. The object key always comes from the
 * row, never from the request, and a slot without an override is a 404 (the page shows its file).
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  // The page asks for `?v=<content hash>`, so a replaced image is a new URL.
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, immutable',
};

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slot: string[] }> }): Promise<NextResponse> {
  const { slot: parts } = await params;
  const slot = parts.join('/');
  if (!landingMediaSlot(slot)) return notFound();

  const sql = await getSqlRunner();
  if (sql === null) return notFound();
  const row = (await loadLandingMediaRows(sql)).find((candidate) => candidate.slot === slot);
  if (!row) return notFound();

  const cdn = publicContentUrl(row.objectKey);
  if (cdn) return new NextResponse(null, { status: 302, headers: { ...HEADERS, Location: cdn } });

  try {
    const bytes = await (await getStorage()).read('public-content', row.objectKey);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': row.mime, 'Content-Length': String(bytes.byteLength) },
    });
  } catch (error) {
    if (error instanceof StorageObjectNotFound) return notFound();
    console.error('[landing-media] read failed', error);
    return NextResponse.json({ error: 'storage_error' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
