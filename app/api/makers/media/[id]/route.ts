import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { makerMediaObject } from '@/lib/makers/works';
import { getRenderStore } from '@/lib/renders/store';

/**
 * `GET /api/makers/media/{wrk_…|avatar-{handle}|avatar-me|cover-{handle}|cover-me}` — an AI creative's
 * representative work, avatar or cover (lib/makers/works.ts, docs/PLATFORM-2.0.md §20). Public and cacheable while the profile
 * is public; the creative's own studio preview otherwise. Streamed from here so the address never
 * changes and the bucket stays private — a version query (`?v=`) moves the cache when it changes.
 */
export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
const PUBLIC = { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800', 'X-Content-Type-Options': 'nosniff' };

/** Safari plays a film only from a server that answers byte ranges; one range is all it asks for. */
function ranged(request: Request, bytes: Uint8Array<ArrayBuffer>, base: Record<string, string>): NextResponse {
  const headers: Record<string, string> = { ...base, 'Accept-Ranges': 'bytes' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return new NextResponse(bytes, { headers: { ...headers, 'Content-Length': String(bytes.byteLength) } });
  const size = bytes.byteLength;
  const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] !== '' && match[2] !== '' ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  return new NextResponse(bytes.subarray(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(wrk_[0-9a-f]{32}|(?:avatar|cover)-(?:[a-z0-9_]{3,20}|me))$/.test(id)) return new NextResponse(null, { status: 404, headers: PRIVATE });
  try {
    const sql = await getSqlRunner();
    if (!sql) return new NextResponse(null, { status: 503, headers: PRIVATE });
    // A public object needs no session: only the private fallback reads one.
    let object = await makerMediaObject(sql, null, id);
    if (!object) object = await makerMediaObject(sql, (await getViewer()).userId, id);
    if (!object) return new NextResponse(null, { status: 404, headers: PRIVATE });
    const bytes = new Uint8Array(await (await getRenderStore()).read(object.key));
    return ranged(request, bytes, { ...(object.publicCache ? PUBLIC : PRIVATE), 'Content-Type': object.mime });
  } catch { return new NextResponse(null, { status: 503, headers: PRIVATE }); }
}
