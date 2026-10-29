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
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
const PUBLIC = { 'Cache-Control': 'public, max-age=300, s-maxage=3600', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // `?download=1` (2026-10-29): the recipe's download button. Same file, same access rule, saved as a file.
  const download = new URL(request.url).searchParams.get('download') === '1';
  try {
    const [viewer, sql] = await Promise.all([getViewer(), getSqlRunner()]);
    if (!sql) return new NextResponse(null, { status: 503, headers: PRIVATE });
    const object = await makerFileObject(sql, viewer, file);
    if (!object) return new NextResponse(null, { status: 404, headers: PRIVATE });
    const headers = object.publicCache ? PUBLIC : PRIVATE;
    const store = await getRenderStore();
    // A disclosed file streams from here so its address never changes; a private one may redirect briefly
    // (not for a download, which must carry its own Content-Disposition).
    if (!object.publicCache && !download) {
      const signed = await store.url(object.key, 60);
      if (signed) return new NextResponse(null, { status: 302, headers: { ...headers, Location: signed } });
    }
    const disposition: Record<string, string> = download ? { 'Content-Disposition': `attachment; filename="twings-${file.slice(4, 12)}.${EXTENSION[object.mime] ?? 'bin'}"` } : {};
    return new NextResponse(new Uint8Array(await store.read(object.key)), { headers: { ...headers, ...disposition, 'Content-Type': object.mime } });
  } catch { return new NextResponse(null, { status: 503, headers: PRIVATE }); }
}
