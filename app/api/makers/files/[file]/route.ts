import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { makerFileObject } from '@/lib/recipes/media';
import { getRenderStore } from '@/lib/renders/store';

/**
 * `GET /api/makers/files/{ast_…}` — a maker's file: to its owner and the studio, or to anyone once the
 * template is published with the maker's "show my files" choice (lib/recipes/media.ts). The disclosed
 * case is the only cacheable one, and it is still served from here, never by a public bucket URL.
 */
export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
const PUBLIC = { 'Cache-Control': 'public, max-age=300, s-maxage=3600', 'X-Content-Type-Options': 'nosniff' };

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  try {
    const [viewer, sql] = await Promise.all([getViewer(), getSqlRunner()]);
    if (!sql) return new NextResponse(null, { status: 503, headers: PRIVATE });
    const object = await makerFileObject(sql, viewer, file);
    if (!object) return new NextResponse(null, { status: 404, headers: PRIVATE });
    const headers = object.publicCache ? PUBLIC : PRIVATE;
    const store = await getRenderStore();
    // A disclosed file streams from here so its address never changes; a private one may redirect briefly.
    if (!object.publicCache) {
      const signed = await store.url(object.key, 60);
      if (signed) return new NextResponse(null, { status: 302, headers: { ...headers, Location: signed } });
    }
    return new NextResponse(new Uint8Array(await store.read(object.key)), { headers: { ...headers, 'Content-Type': object.mime } });
  } catch { return new NextResponse(null, { status: 503, headers: PRIVATE }); }
}
