import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import {
  adminTokenRef,
  authorizeAdminMedia,
  type AdminMediaObject,
} from '@/lib/media/admin-authorize';
import { mintMediaToken, verifyMediaToken } from '@/lib/media/token';
import { publicMediaBaseUrl } from '@/lib/runtime-mode';
import { getStorage, STAGING_BUCKET, StorageObjectNotFound } from '@/lib/storage';

/**
 * `/api/admin/media/[ref]` — admin preview media (§3.8 preview-as; the item M2 flagged).
 *
 * Shaped exactly like `/api/media/[blockId]` so there is one mental model, and deliberately
 * SEPARATE from it so the public gateway's "draft/superseded refuse, for everyone" property — which
 * `npm run sweep:anon` asserts — stays literally true and untouched.
 *
 *   hit 1 (no `?t=`)  authorize `is_admin` + resolve the ref to one revision's STAGING object
 *                     (lib/media/admin-authorize.ts), then mint a ≤60s token bound to `admin:{ref}`
 *   hit 2 (`?t=…`)    verify the token and stream the bytes
 *
 * Status vocabulary: 404 unknown/unresolvable ref · 401 nobody signed in · 403 signed in but not an
 * admin, or an expired/forged token · 302 authorized. Every response is `private, no-store` +
 * noindex, refusals included — this is not middleware-covered surface (`/api/*` is excluded from
 * the matcher), so the route sets its own headers exactly like the public gateway does.
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
  return new NextResponse(null, { status: 302, headers: { ...HEADERS, Location: location } });
}

function attachmentName(filename: string): string {
  const ascii = filename.replace(/["\\]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function stream(
  key: string,
  meta: { mime?: string; filename?: string | null },
): Promise<NextResponse> {
  const storage = await getStorage();
  try {
    const bytes = await storage.read(STAGING_BUCKET, key);
    const headers: Record<string, string> = {
      ...HEADERS,
      'Content-Type': meta.mime ?? 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
    };
    if (meta.filename) headers['Content-Disposition'] = attachmentName(meta.filename);
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  } catch (err) {
    if (err instanceof StorageObjectNotFound) return refuse(404, 'not_found');
    console.error('[admin-media] read failed', err);
    return refuse(500, 'storage_error');
  }
}

/** Hit 2. The token is the capability, and it is bound to `admin:{ref}` — never to a public one. */
async function deliverWithToken(ref: string, token: string): Promise<NextResponse> {
  const verified = verifyMediaToken(token, { ref: adminTokenRef(ref) });
  if (!verified.ok) {
    return refuse(403, verified.reason === 'expired' ? 'token_expired' : 'token_invalid');
  }
  // Staging objects only: a token naming any other bucket did not come from this route.
  if (verified.claims.bucket !== STAGING_BUCKET) return refuse(403, 'token_invalid');
  // Vercel refuses a function response over ~4.5MB, so a real clip can never stream through here.
  // Named files keep streaming: their attachment name is a header this route has to set itself.
  if (!verified.claims.filename) {
    const storage = await getStorage();
    if (storage.servesSignedUrls) {
      try {
        const signed = await storage.signedStagingUrl?.(verified.claims.key, 60);
        if (signed) return redirect(signed);
      } catch (err) {
        if (err instanceof StorageObjectNotFound) return refuse(404, 'not_found');
        console.error('[admin-media] signing failed', err);
        return refuse(500, 'storage_error');
      }
    }
  }
  return stream(verified.claims.key, {
    ...(verified.claims.mime === undefined ? {} : { mime: verified.claims.mime }),
    ...(verified.claims.filename === undefined ? {} : { filename: verified.claims.filename }),
  });
}

/** Hit 1. */
function handOut(object: AdminMediaObject): NextResponse {
  const { token } = mintMediaToken({
    ref: adminTokenRef(object.ref),
    bucket: object.bucket,
    key: object.key,
    mime: object.mime,
    ...(object.filename ? { filename: object.filename } : {}),
  });
  const target = new URL(`/api/admin/media/${encodeURIComponent(object.ref)}`, 'http://placeholder');
  target.searchParams.set('t', token);
  return redirect(`${target.pathname}${target.search}`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<NextResponse> {
  const { ref: raw } = await params;
  const ref = decodeURIComponent(raw);
  const token = new URL(request.url).searchParams.get('t');

  if (token) return deliverWithToken(ref, token);

  const [sql, viewer] = await Promise.all([getSqlRunner(), getViewer()]);
  if (sql === null) return refuse(404, 'not_found');

  const decision = await authorizeAdminMedia(sql, viewer, ref);
  switch (decision.status) {
    case 'not_found':
      return refuse(404, 'not_found');
    case 'unauthorized':
      return refuse(401, 'sign_in_required');
    case 'forbidden':
      return refuse(403, 'admin_only');
    case 'ok': {
      if (decision.object.publishedKey) {
        const storage = await getStorage();
        const stillInStaging = await storage.exists(STAGING_BUCKET, decision.object.key).catch(() => false);
        if (!stillInStaging) {
          const mediaBase = publicMediaBaseUrl();
          const location = mediaBase
            ? `${mediaBase.replace(/\/$/, '')}/${decision.object.publishedKey}`
            : storage.publicUrl(decision.object.publishedKey);
          return redirect(location);
        }
      }
      return handOut(decision.object);
    }
  }
}
