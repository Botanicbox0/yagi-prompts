import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { makerHandleOf } from '@/lib/makers/profile';
import { makerBlogOpen } from '@/lib/posts/flag';
import { loadMemberPostBlocks } from '@/lib/posts/public';
import { POST_SLUG_PATTERN } from '@/lib/posts/schema';

/**
 * `GET /api/posts/access?handle=&slug=` — signed-in member access to full prompt blocks on a
 * published maker blog post. Static post HTML contains only prompt titles; this endpoint is the
 * one gate that delivers prompt bodies, condition lines, and tips once signed in.
 */
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: Request): Promise<NextResponse> {
  if (!makerBlogOpen()) {
    return NextResponse.json({ code: 'not_open' }, { status: 404, headers: HEADERS });
  }

  const { searchParams } = new URL(request.url);
  const handle = makerHandleOf(searchParams.get('handle'));
  const rawSlug = searchParams.get('slug')?.trim().toLowerCase() ?? '';
  if (!handle || !POST_SLUG_PATTERN.test(rawSlug)) {
    return NextResponse.json({ code: 'not_found' }, { status: 404, headers: HEADERS });
  }

  const viewer = await getViewer();
  if (!viewer.userId) {
    return NextResponse.json({ signedIn: false, blocks: null, prompts: null }, { status: 200, headers: HEADERS });
  }

  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ code: 'unavailable' }, { status: 503, headers: HEADERS });
  }

  const loaded = await loadMemberPostBlocks(sql, handle, rawSlug).catch(() => null);
  if (!loaded) {
    return NextResponse.json({ code: 'not_found' }, { status: 404, headers: HEADERS });
  }

  return NextResponse.json(
    { signedIn: true, blocks: loaded.blocks, prompts: loaded.prompts },
    { status: 200, headers: HEADERS },
  );
}
