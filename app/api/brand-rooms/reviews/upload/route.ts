import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/viewer';
import { brandRoomsOpen } from '@/lib/flags';
import { getStorage } from '@/lib/storage';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { STUDIO_HEADERS } from '@/lib/brand-studio/http';
import { mimeForStudioKey } from '@/lib/brand-studio/media-store';
import { DELIVERY_LIMITS, deliveryRefusal, deliveryUploadAddress, isDeliveryKey } from '@/lib/brand-rooms/deliveries';
import { INGEST_SECRET_ENV, ingestSecretMatches, presentedSecret, readCappedBody } from '@/lib/brand-rooms/ingest';

/**
 * Where a deliverable's bytes go before `brand_rooms.delivery.add` (docs/BRAND-ROOMS.md §6). Team only:
 * the admin session (`requireAdmin()`, re-read from the profile) or, for the command line, the ingest
 * secret. Anyone else, and the flag off, get a bare 404 (the admin surface does not confirm itself).
 *
 *   POST { mime, size, name }   a fresh staging key and where to put the file (a signed URL in the cloud)
 *   PUT  ?key=<staging key>     local mode only: the file itself (cloud storage takes the signed PUT)
 *
 * The key is minted on the server, so a caller cannot choose where in the bucket it writes. The type and
 * the size limits (film 500 MB, image 50 MB) are checked here and again on the bytes at delivery.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: STUDIO_HEADERS });

async function team(request: NextRequest, allowSecret: boolean): Promise<boolean> {
  if (allowSecret && ingestSecretMatches(process.env[INGEST_SECRET_ENV], presentedSecret(request.headers))) return true;
  try {
    await requireAdmin();
  } catch {
    return false;
  }
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  return Boolean(origin && sameOriginMutation(origin, request.headers));
}

export async function POST(request: NextRequest) {
  if (!brandRoomsOpen()) return notFound();
  if (!(await team(request, false))) return notFound();
  let input: { mime?: unknown; size?: unknown };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  const mime = typeof input.mime === 'string' ? input.mime : '';
  const size = typeof input.size === 'number' ? input.size : -1;
  const refusal = deliveryRefusal(mime, size);
  if (refusal) return json({ ok: false, error: refusal }, 400);
  const address = await deliveryUploadAddress(await getStorage(), mime);
  return json({ ok: true, ...address });
}

export async function PUT(request: NextRequest) {
  if (!brandRoomsOpen()) return notFound();
  if (!(await team(request, true))) return notFound();
  const staging = await getStorage();
  if (staging.servesSignedUrls) return json({ ok: false, error: 'bad_request' }, 405);
  const key = request.nextUrl.searchParams.get('key');
  if (!isDeliveryKey(key)) return notFound();
  const mime = mimeForStudioKey(key.replace(/^brand-rooms\/deliveries\//, 'st/'));
  const body = await readCappedBody(request, mime.startsWith('image/') ? DELIVERY_LIMITS.imageBytesMax : DELIVERY_LIMITS.videoBytesMax, false);
  if (!body.ok) return json({ ok: false, error: body.code === 'file_too_large' ? 'too_large' : 'bad_request' }, body.code === 'file_too_large' ? 413 : 400);
  if (!body.bytes.byteLength) return json({ ok: false, error: 'bad_request' }, 400);
  await staging.putStaging(key, body.bytes, mime);
  return json({ ok: true });
}
