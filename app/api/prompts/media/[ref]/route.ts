import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { publicContentUrl } from '@/lib/content/asset-url';
import { loadPromptById } from '@/lib/prompts/repo';
import { parsePromptMediaRef } from '@/lib/prompts/links';
import { parsePromptMedia } from '@/lib/prompts/schemas';
import { getStorage, StorageObjectNotFound } from '@/lib/storage';

/**
 * `/api/prompts/media/[ref]` — posters and result clips of PUBLISHED prompts.
 *
 * This is deliberately NOT `/api/media/[blockId]`. That gateway exists to gate bytes behind an
 * entitlement chain; this one exists because these bytes have **no gate at all**: §13.1 puts
 * posters and videos on the public marketing surface (§3.1), the copier writes them to the PUBLIC
 * `public-content` bucket at publish/approval, and the cached gallery HTML links them for every
 * tier alike. Serving them through the entitlement gateway would be a lie about what they are —
 * and would 401 for the crawler that fetches the OG image.
 *
 * What makes it safe is that there is no key parameter. The ref names a ROW; the object key is read
 * from that row's `media` jsonb and from nowhere else, and the row must be `published`. So:
 *
 *   · a pending or rejected submission's video is unreachable here (404) — it lives in private
 *     staging and has no `published_key` at all;
 *   · an archived prompt stops being served (the bytes stay disclosed, §6 disclosure doctrine);
 *   · nothing outside `public-content` is ever readable through this route.
 *
 * With a CDN configured (§11) it simply redirects there and never touches the app server. Without
 * one it streams, which is what makes the gallery render on a laptop with no Supabase project.
 */
export const dynamic = 'force-dynamic';

/**
 * Public bytes, content-addressed keys, no per-viewer variation — so this is the ONE response in
 * the app that may be cached, and immutability is a fact about the key rather than a hope.
 */
const HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, immutable',
};

function refuse(status: 404 | 500, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<NextResponse> {
  const { ref: rawRef } = await params;
  const ref = parsePromptMediaRef(decodeURIComponent(rawRef));
  if (ref === null) return refuse(404, 'not_found');

  const sql = await getSqlRunner();
  if (sql === null) return refuse(404, 'not_found');

  const row = await loadPromptById(sql, ref.id);
  if (row === null || row.status !== 'published' || row.audience === 'brand') return refuse(404, 'not_found');

  const asset = parsePromptMedia(row.media)[ref.kind];
  // No published key ⇒ the copier has not run for this asset ⇒ it is not public yet ⇒ 404.
  if (!asset || asset.bucket !== 'public-content' || !asset.published_key) {
    return refuse(404, 'not_found');
  }

  // Founder direction (2026-08-13): audio results download in one press. `?download=1` answers
  // with `Content-Disposition: attachment` — REQUIRED cross-origin, where the anchor `download`
  // attribute is ignored. The filename is the slug (human) + the key's extension (true), and the
  // CDN redirect is deliberately skipped on this branch: a 302 cannot carry the disposition.
  const download = new URL(request.url).searchParams.get('download') === '1';

  const cdn = publicContentUrl(asset.published_key);
  if (cdn && !download) {
    return new NextResponse(null, { status: 302, headers: { ...HEADERS, Location: cdn } });
  }

  try {
    const storage = await getStorage();
    const bytes = await storage.read('public-content', asset.published_key);
    const ext = /\.[A-Za-z0-9]+$/.exec(asset.published_key)?.[0] ?? '';
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': asset.mime,
        'Content-Length': String(bytes.byteLength),
        ...(download
          ? { 'Content-Disposition': `attachment; filename="${row.slug}${ext}"` }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof StorageObjectNotFound) return refuse(404, 'not_found');
    console.error('[prompt-media] read failed', err);
    return refuse(500, 'storage_error');
  }
}
