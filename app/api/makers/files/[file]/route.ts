import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { makerFileObject } from '@/lib/recipes/media';
import { getRenderStore } from '@/lib/renders/store';

/**
 * `GET /api/makers/files/{ast_…}[?download=1]` — a creative's source file: to its owner and the
 * studio, or to any signed-in member once the template is published with the creative's "show my
 * files" choice (lib/recipes/media.ts, docs/PLATFORM-2.0.md §20.3). Never cached outside the
 * member's browser and never a public bucket URL; `download=1` names the file and asks the browser
 * to save it instead of showing it.
 */
export const dynamic = 'force-dynamic';
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
};
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // `?download=1` (2026-10-29): the recipe's download button. Same file, same access rule, saved as a file.
  const download = new URL(request.url).searchParams.get('download') === '1';
  try {
    const [viewer, sql] = await Promise.all([getViewer(), getSqlRunner()]);
    if (!sql) return new NextResponse(null, { status: 503, headers: PRIVATE });
    const object = await makerFileObject(sql, viewer, file);
    if (!object) return new NextResponse(null, { status: 404, headers: PRIVATE });
    if (download && object.containsPerson) {
      return NextResponse.json(
        { ok: false, code: 'person_reference_download_forbidden' },
        { status: 403, headers: PRIVATE },
      );
    }
    const name = `twings-${file.slice(4, 12)}.${EXTENSION[object.mime] ?? 'bin'}`;
    const store = await getRenderStore();
    // To look at, a short-lived signed address; to save, the bytes from here under their own name
    // (main's download test pins this: an attachment never depends on the bucket honouring a name).
    if (!download) {
      const signed = await store.url(object.key, 60);
      if (signed) return new NextResponse(null, { status: 302, headers: { ...PRIVATE, Location: signed } });
    }
    return new NextResponse(new Uint8Array(await store.read(object.key)), {
      headers: { ...PRIVATE, 'Content-Type': object.mime, ...(download ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}) },
    });
  } catch { return new NextResponse(null, { status: 503, headers: PRIVATE }); }
}
