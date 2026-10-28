import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { makerFileObject } from '@/lib/recipes/media';
import { extensionFor, getRenderStore } from '@/lib/renders/store';

/**
 * `GET /api/makers/files/{ast_…}[?download=1]` — a creative's source file: to its owner and the
 * studio, or to any signed-in member once the template is published with the creative's "show my
 * files" choice (lib/recipes/media.ts, docs/PLATFORM-2.0.md §20.3). Never cached outside the
 * member's browser and never a public bucket URL; `download=1` names the file and asks the browser
 * to save it instead of showing it.
 */
export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const download = new URL(request.url).searchParams.get('download') === '1';
  try {
    const [viewer, sql] = await Promise.all([getViewer(), getSqlRunner()]);
    if (!sql) return new NextResponse(null, { status: 503, headers: PRIVATE });
    const object = await makerFileObject(sql, viewer, file);
    if (!object) return new NextResponse(null, { status: viewer.userId ? 404 : 401, headers: PRIVATE });
    const name = `twings-${file.slice(4, 12)}.${extensionFor(object.mime)}`;
    const store = await getRenderStore();
    const signed = await store.url(object.key, 60, download ? { download: name } : {});
    if (signed) return new NextResponse(null, { status: 302, headers: { ...PRIVATE, Location: signed } });
    return new NextResponse(new Uint8Array(await store.read(object.key)), {
      headers: { ...PRIVATE, 'Content-Type': object.mime, ...(download ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}) },
    });
  } catch { return new NextResponse(null, { status: 503, headers: PRIVATE }); }
}
