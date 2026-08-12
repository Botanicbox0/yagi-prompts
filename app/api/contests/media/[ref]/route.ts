import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { publicContentUrl } from '@/lib/content/asset-url';
import { loadContestById } from '@/lib/contests/repo';
import { parseContestMediaRef } from '@/lib/contests/links';
import { parseContestMedia } from '@/lib/contests/schemas';
import { getStorage, StorageObjectNotFound } from '@/lib/storage';

/**
 * `/api/contests/media/[ref]` — posters and hero clips of PUBLISHED contests.
 *
 * The §13 prompt-media route's twin, and it exists for the same reason: these bytes have **no gate
 * at all**. A contest poster is marketing surface by definition, the copier writes it to the PUBLIC
 * `public-content` bucket at publish, and the cached listing links it for every tier alike. Serving
 * it through the entitlement gateway would be a lie about what it is — and would 401 the crawler
 * that fetches the OG image.
 *
 * What makes it safe is that there is no key parameter. The ref names a ROW; the object key is read
 * from that row's `media` jsonb and from nowhere else, and the row must be `published`. So:
 *
 *   · a DRAFT contest's poster is unreachable here (404) — it lives in private staging and has no
 *     `published_key` at all, which is exactly what §14.1's "publishing is the founder's act"
 *     requires of an unannounced prize;
 *   · an archived contest stops being served (the bytes stay disclosed, §6 disclosure doctrine);
 *   · nothing outside `public-content` is ever readable through this route.
 *
 * With a CDN configured (§11) it simply redirects there and never touches the app server.
 */
export const dynamic = 'force-dynamic';

/**
 * The alias is MUTABLE, so it is never cached immutably (M9 review, finding 3).
 *
 * `{contestId}:{kind}` is a pointer, not an object: unpublishing a contest, archiving it or
 * replacing its poster all change what the ref resolves to — or whether it resolves at all. The
 * first version of this route answered with `immutable, s-maxage=86400`, which meant a withdrawn
 * poster kept being served from a CDN for a day after the contest came down. That is the same
 * mistake the §6 disclosure doctrine exists to avoid making twice.
 *
 * So the split is:
 *   · the ALIAS (this route) → `no-store` on the redirect, `must-revalidate` on the streamed
 *     fallback. Every request re-checks the row;
 *   · the OBJECT it points at → the content-addressed `{sha256}.{ext}` URL on the public bucket,
 *     which is immutable in the only sense that matters: the key IS the hash, so the bytes behind
 *     it can never change and the CDN may keep them forever.
 */
const REDIRECT_HEADERS: Record<string, string> = { 'Cache-Control': 'no-store' };

/**
 * The no-CDN fallback streams the bytes itself, so it must be revalidated too — but it may still be
 * stored, which keeps a local render fast without ever serving a withdrawn poster from cache.
 */
const STREAM_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
};

function refuse(status: 404 | 500, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<NextResponse> {
  const { ref: rawRef } = await params;
  const ref = parseContestMediaRef(decodeURIComponent(rawRef));
  if (ref === null) return refuse(404, 'not_found');

  const sql = await getSqlRunner();
  if (sql === null) return refuse(404, 'not_found');

  const row = await loadContestById(sql, ref.id);
  if (row === null || row.status !== 'published') return refuse(404, 'not_found');

  const asset = parseContestMedia(row.media)[ref.kind];
  // No published key ⇒ the copier has not run for this asset ⇒ it is not public yet ⇒ 404.
  if (!asset || asset.bucket !== 'public-content' || !asset.published_key) {
    return refuse(404, 'not_found');
  }

  // 302 to the content-addressed object: THAT url is the immutable one, and it is the CDN's to
  // cache. This hop is not.
  const cdn = publicContentUrl(asset.published_key);
  if (cdn) {
    return new NextResponse(null, { status: 302, headers: { ...REDIRECT_HEADERS, Location: cdn } });
  }

  try {
    const storage = await getStorage();
    const bytes = await storage.read('public-content', asset.published_key);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...STREAM_HEADERS,
        // The content hash, so a revalidating client gets a cheap 304 while the row stays the
        // authority on whether it may have the bytes at all.
        ETag: `"${asset.sha256}"`,
        'Content-Type': asset.mime,
        'Content-Length': String(bytes.byteLength),
      },
    });
  } catch (err) {
    if (err instanceof StorageObjectNotFound) return refuse(404, 'not_found');
    console.error('[contest-media] read failed', err);
    return refuse(500, 'storage_error');
  }
}
