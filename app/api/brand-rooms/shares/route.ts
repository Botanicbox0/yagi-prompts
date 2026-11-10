import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { createShare, listShares, revokeShare, type ShareDeps } from '@/lib/brand-rooms/shares';
import { shareHttpStatus } from '@/lib/brand-rooms/share-contracts';

/**
 * Share links, the brand side (docs/BRAND-ROOMS.md §6, §9-3). Guard order: the flag (404) -> sign-in
 * (401) -> inside the service: the room seat (sandbox hardline and generation policy, 404) -> owners and
 * editors only (403) -> the item is live and in a room this seat may open (404).
 *
 *   GET  ?organizationId=&kind=&targetId=   the item's links (never a token)
 *   POST { operation: 'share.create', input }   a new link; the ONLY answer that carries its token
 *   POST { operation: 'share.revoke', input }   the kill switch
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 8_192;

function log(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify(detail).slice(0, 600));
}

const deps = (sql: NonNullable<Awaited<ReturnType<typeof getSqlRunner>>>): ShareDeps => ({ sql, media: createStudioMediaStore() });

export async function GET(request: NextRequest) {
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'not_found' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const params = request.nextUrl.searchParams;
    const result = await listShares(deps(sql), viewer, {
      organizationId: params.get('organizationId') ?? '',
      kind: params.get('kind') ?? '',
      targetId: params.get('targetId') ?? '',
    });
    return studioJson(result, result.ok ? 200 : shareHttpStatus(result.code));
  } catch (error) {
    log('share_list_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'not_found' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
  let body: { operation?: unknown; input?: unknown };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || !body.input || typeof body.input !== 'object') throw new Error('shape');
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const result =
      body.operation === 'share.create'
        ? await createShare(deps(sql), viewer, body.input)
        : body.operation === 'share.revoke'
          ? await revokeShare(deps(sql), viewer, body.input)
          : ({ ok: false, code: 'invalid' } as const);
    if (!result.ok) return studioJson(result, shareHttpStatus(result.code));
    return studioJson(result, body.operation === 'share.create' ? 201 : 200);
  } catch (error) {
    log('share_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
