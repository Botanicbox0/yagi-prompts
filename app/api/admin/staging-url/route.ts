import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/viewer';
import { getStorage } from '@/lib/storage';
import { MEDIA_KINDS, type MediaKind } from '@/lib/prompts/schemas';
import { checkUpload, directUploadKey } from '@/lib/prompts/media';

/**
 * `POST /api/admin/staging-url` — mint a one-shot URL the browser uploads a file to directly.
 *
 * Founder report (2026-08-15): a 57.7MB clip came back as Vercel's own `413 PAYLOAD_TOO_LARGE`
 * page, from `/admin/do`, before a line of our code ran. The platform caps a serverless request
 * body at ~4.5MB, so "raise our own limit" was never going to help — the bytes could not reach the
 * function at all. The only fix is for them not to go through the function: the browser asks for a
 * signed URL (a few hundred bytes each way) and PUTs the file straight to storage.
 *
 * Note for a later reader wondering whether a different storage vendor would have avoided this:
 * no. The 4.5MB ceiling is Vercel's request limit, not Supabase's write limit — routing the same
 * bytes through the same function to R2 or S3 would 413 identically. What matters is the HOP that
 * is removed, not the destination.
 *
 * Guard posture is `/admin/do`'s, deliberately: `requireAdmin()` first, 404 rather than 403 (§3.7),
 * and a same-origin check because this is a route handler rather than a server action. The caps are
 * re-applied here — the client is not trusted to have checked its own file — and the KEY is minted
 * server-side, so a caller cannot choose where in the bucket to write.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

function isKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch {
    return notFound();
  }
  if (!sameOrigin(request)) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const kind = input.kind;
  const mime = typeof input.mime === 'string' ? input.mime : '';
  const size = typeof input.size === 'number' ? input.size : -1;
  const filename = typeof input.filename === 'string' ? input.filename : '';

  if (!isKind(kind) || size < 0) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
  }

  // The same caps the inline path applies. Duration is unknowable without the bytes, so it is
  // checked where the bytes are — at publish, and by the human who watches every clip.
  const rejection = checkUpload({ kind, mime, sizeBytes: size, durationSeconds: null });
  if (rejection !== null) {
    return NextResponse.json({ error: rejection }, { status: 400, headers: NO_STORE });
  }

  const storage = await getStorage();
  const key = directUploadKey(filename, mime);
  const url = await storage.signedUploadUrl(key, mime);
  if (url === null) {
    // A driver with no upload service (local). The client posts the file inline instead.
    return NextResponse.json({ direct: false }, { headers: NO_STORE });
  }

  return NextResponse.json({ direct: true, key, url }, { headers: NO_STORE });
}
