import { NextResponse, type NextRequest } from 'next/server';
import { brandStudioV2Open } from '@/lib/flags';
import { createStudioMediaStore, isStudioMediaKey, mimeForStudioKey } from '@/lib/brand-studio/media-store';
import { STUDIO_HEADERS } from '@/lib/brand-studio/http';

/**
 * Studio media gateway (docs/BRAND-STUDIO-V2.md §6). Locally it serves `.storage/content/st/…`.
 * In production the files live on R2 behind PUBLIC_MEDIA_BASE_URL and pages load them from there; this
 * route then serves PICTURES only, for the layer editor, which must draw them from its own origin to
 * export a canvas (the media host sends no CORS headers). Video and audio stay 404 here in production.
 * Like the R2 objects, a file is reachable by its unguessable 256-bit key only; nothing lists or searches.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ key: string[] }> };
const missing = () => new NextResponse(null, { status: 404, headers: STUDIO_HEADERS });

async function serve(request: NextRequest, context: Context, head: boolean) {
  if (!brandStudioV2Open()) return missing();
  const key = (await context.params).key.join('/');
  if (!isStudioMediaKey(key)) return missing();
  const media = createStudioMediaStore();
  if (media.kind !== 'local' && !mimeForStudioKey(key).startsWith('image/')) return missing();
  let bytes: Uint8Array;
  try {
    bytes = await media.read(key);
  } catch {
    return missing();
  }
  const headers = { ...STUDIO_HEADERS, 'Content-Type': mimeForStudioKey(key), 'Accept-Ranges': 'bytes', 'Content-Security-Policy': "sandbox; default-src 'none'" };
  const total = bytes.byteLength;
  const range = /^bytes=(\d*)-(\d*)$/i.exec(request.headers.get('range')?.trim() ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start > end || start >= total) return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` } });
    const slice = bytes.subarray(start, end + 1);
    return new NextResponse(head ? null : Buffer.from(slice), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(slice.byteLength) },
    });
  }
  return new NextResponse(head ? null : Buffer.from(bytes), { headers: { ...headers, 'Content-Length': String(total) } });
}

export const GET = (request: NextRequest, context: Context) => serve(request, context, false);
export const HEAD = (request: NextRequest, context: Context) => serve(request, context, true);
