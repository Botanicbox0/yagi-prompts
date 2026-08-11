import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { publicContentUrl } from '@/lib/content/asset-url';
import { getSqlRunner } from '@/lib/db/connect';
import { authorizeMedia, type MediaObject } from '@/lib/media/authorize';
import { MEDIA_TOKEN_TTL_SECONDS, mintMediaToken, verifyMediaToken } from '@/lib/media/token';
import { getStorage, StorageObjectNotFound } from '@/lib/storage';
import { PublishedBucketSchema, type PublishedBucket } from '@/lib/content/schemas';

/**
 * `/api/media/[blockId]` — the entitlement-checked media gateway (§3.3).
 *
 * Two hits, on purpose:
 *
 *   1. **no `?t=`** — run the FULL authorization chain (lib/media/authorize.ts). On success the
 *      object is either a public CDN object (redirect straight to it) or a private one, in which
 *      case we mint a ≤60s token bound to this ref and redirect to hit 2.
 *   2. **`?t=…`**  — verify the token and deliver the bytes. The token IS the capability, exactly
 *      like a Supabase signed URL: it was only ever minted after step 1 said yes, it expires in
 *      ≤60s, and it is bound to one ref so it cannot be replayed against another object.
 *
 * Status vocabulary (the sweep asserts all four):
 *   404 unknown ref · non-current revision (draft/superseded) · unpublished/archived playbook
 *   401 anonymous viewer who could see this after signing in
 *   403 signed-in viewer below the gate, or an expired/forged token
 *   302 authorized — to the CDN object, or to the token hit
 *
 * Every response is `private, no-store` + `noindex`, including the refusals.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function refuse(status: 401 | 403 | 404 | 500, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

function redirect(location: string): NextResponse {
  // 302, not 307/308: this is a one-off capability URL, never a permanent identity for the object.
  return new NextResponse(null, { status: 302, headers: { ...HEADERS, Location: location } });
}

function attachmentName(filename: string): string {
  // Quoted-string safe; the real name also rides `filename*` for non-ASCII.
  const ascii = filename.replace(/["\\]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function streamObject(
  bucket: PublishedBucket,
  key: string,
  meta: { mime?: string; filename?: string | null },
): Promise<NextResponse> {
  const storage = await getStorage();
  try {
    const bytes = await storage.read(bucket, key);
    const headers: Record<string, string> = {
      ...HEADERS,
      'Content-Type': meta.mime ?? 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
    };
    if (meta.filename) headers['Content-Disposition'] = attachmentName(meta.filename);
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  } catch (err) {
    if (err instanceof StorageObjectNotFound) return refuse(404, 'not_found');
    console.error('[media] read failed', err);
    return refuse(500, 'storage_error');
  }
}

/** Hit 2: the token is the capability. */
async function deliverWithToken(ref: string, token: string): Promise<NextResponse> {
  const verified = verifyMediaToken(token, { ref });
  if (!verified.ok) {
    // Expired and forged are the same answer on purpose — a probe learns nothing from the split.
    return refuse(403, verified.reason === 'expired' ? 'token_expired' : 'token_invalid');
  }
  const { key, exp, mime, filename } = verified.claims;
  const parsedBucket = PublishedBucketSchema.safeParse(verified.claims.bucket);
  if (!parsedBucket.success) return refuse(403, 'token_invalid');
  const bucket = parsedBucket.data;

  const storage = await getStorage();
  if (storage.servesSignedUrls && !filename) {
    const remaining = Math.max(1, exp - Math.floor(Date.now() / 1000));
    return redirect(
      await storage.signedUrl(bucket, key, Math.min(remaining, MEDIA_TOKEN_TTL_SECONDS)),
    );
  }

  return streamObject(bucket, key, { mime, filename });
}

/** Hit 1: authorize, then hand out the narrowest capability that serves the object. */
async function deliverAuthorized(object: MediaObject): Promise<NextResponse> {
  // Workflow files always stream so the attachment disposition is guaranteed (§3.3 download row).
  const forceStream = object.kind === 'workflow_file';

  if (!forceStream && object.bucket === 'public-content') {
    const cdn = publicContentUrl(object.key);
    // A public object with a configured CDN needs no token at all — it is already disclosed (§6
    // disclosure doctrine). With no CDN (§11) it falls through to the token path and is streamed.
    if (cdn) return redirect(cdn);
  }

  const claims = {
    ref: object.ref,
    bucket: object.bucket,
    key: object.key,
    mime: object.mime,
    ...(object.filename ? { filename: object.filename } : {}),
  };
  const { token } = mintMediaToken(claims);
  const target = new URL(`/api/media/${encodeURIComponent(object.ref)}`, 'http://placeholder');
  target.searchParams.set('t', token);
  return redirect(`${target.pathname}${target.search}`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ blockId: string }> },
): Promise<NextResponse> {
  const { blockId } = await params;
  const ref = decodeURIComponent(blockId);
  const token = new URL(request.url).searchParams.get('t');

  if (token) return deliverWithToken(ref, token);

  const [sql, viewer] = await Promise.all([getSqlRunner(), getViewer()]);
  if (sql === null) return refuse(404, 'not_found');

  const decision = await authorizeMedia(sql, viewer, ref);
  switch (decision.status) {
    case 'not_found':
      return refuse(404, 'not_found');
    case 'unauthorized':
      return refuse(401, 'sign_in_required');
    case 'forbidden':
      return refuse(403, 'pro_required');
    case 'ok':
      return deliverAuthorized(decision.object);
  }
}
