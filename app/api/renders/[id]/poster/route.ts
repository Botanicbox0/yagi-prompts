import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { getSqlRunner } from '@/lib/db/connect';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { POSTER_MAX_BYTES, savePosterFrame } from '@/lib/renders/poster';
import { isRenderId } from '@/lib/renders/share';
import { getRenderStore } from '@/lib/renders/store';

/**
 * `POST /api/renders/[id]/poster` — one frame of the owner's finished film, drawn in their browser
 * (`components/renders/poster-capture.tsx`), becomes the share card's image (`lib/renders/poster.ts`).
 *
 * Same origin first (403), then a session (401), then the body: `image/jpeg`, at most
 * `POSTER_MAX_BYTES` counted as it arrives (413). Someone else's render is "not found". A render
 * that already has its frame answers 204 without reading further work into it; a new one 201.
 * Every answer is `private, no-store`.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const STATUS = { sign_in_required: 401, not_found: 404, not_ready: 409, bad_image: 422, unavailable: 503 } as const;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isSameOrigin(request)) return json({ ok: false, code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (viewer.userId === null) return json({ ok: false, code: 'sign_in_required' }, 401);
  const { id } = await params;
  if (!isRenderId(id)) return json({ ok: false, code: 'not_found' }, 404);
  if ((request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() !== 'image/jpeg') return json({ ok: false, code: 'bad_image' }, 415);
  const bytes = await readBoundedBody(request, POSTER_MAX_BYTES);
  if (bytes === null) return json({ ok: false, code: 'too_large' }, 413);
  if (bytes.byteLength === 0) return json({ ok: false, code: 'bad_image' }, 422);
  try {
    const sql = await getSqlRunner();
    if (sql === null) return json({ ok: false, code: 'unavailable' }, 503);
    const outcome = await savePosterFrame({ sql, store: await getRenderStore() }, viewer, id, bytes);
    if (!outcome.ok) return json(outcome, STATUS[outcome.code]);
    if (!outcome.stored) return new NextResponse(null, { status: 204, headers: HEADERS });
    return json({ ok: true }, 201);
  } catch (error) {
    console.error('[renders] poster save failed', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
