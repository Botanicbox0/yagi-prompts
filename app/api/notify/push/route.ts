import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import {
  PUSH_BODY_MAX_BYTES,
  parsePushEndpoint,
  parsePushSubscription,
  pushConfigFromEnv,
  revokePushSubscription,
  savePushSubscription,
} from '@/lib/notify/push';
import { resolveRequestUrl } from '@/lib/routing/surfaces';

/**
 * `POST /api/notify/push` — this device says yes to the completion push (docs/PLATFORM-2.0.md §5.3).
 * The body is `PushSubscription.toJSON()`; the row is upserted by endpoint for the signed-in reader.
 *
 * `DELETE /api/notify/push` — `{ endpoint }`: this device says no. The row stays, with `revoked_at`.
 * Works with push switched off here too, so a reader can always take their device back.
 *
 * Session required, our own page only (the Origin must match), a small bounded body, and private.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

/** The browser always sends Origin on a POST/DELETE fetch; a write without one is not from our page. */
function fromOwnPage(request: Request): boolean {
  const origin = request.headers.get('origin');
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  if (origin === null || url === null) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

type Body = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

/** JSON, at most PUSH_BODY_MAX_BYTES — counted while streaming, not trusted from Content-Length. */
async function readBody(request: Request): Promise<Body> {
  if (Number(request.headers.get('content-length') ?? '0') > PUSH_BODY_MAX_BYTES) return { ok: false, status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > PUSH_BODY_MAX_BYTES) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    return { ok: true, value: JSON.parse(text + decoder.decode()) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  if (viewer.userId === null) return json({ ok: false, code: 'sign_in_required' }, 401);
  if (!fromOwnPage(request)) return json({ ok: false, code: 'forbidden' }, 403);
  if (pushConfigFromEnv() === null) return json({ ok: false, code: 'push_unavailable' }, 503);

  const body = await readBody(request);
  if (!body.ok) return json({ ok: false, code: body.status === 413 ? 'too_large' : 'bad_request' }, body.status);
  const subscription = parsePushSubscription(body.value);
  if (subscription === null) return json({ ok: false, code: 'bad_request' }, 400);

  const sql = await getSqlRunner();
  if (sql === null) return json({ ok: false, code: 'unavailable' }, 503);
  try {
    await savePushSubscription(sql, viewer.userId, subscription, request.headers.get('user-agent'));
  } catch (error) {
    // Until 0053 reaches this database the table is missing; say "not here yet", not "broken".
    console.error('[notify/push] save failed', error);
    return json({ ok: false, code: 'unavailable' }, 503);
  }
  return json({ ok: true }, 200);
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  if (viewer.userId === null) return json({ ok: false, code: 'sign_in_required' }, 401);
  if (!fromOwnPage(request)) return json({ ok: false, code: 'forbidden' }, 403);

  const body = await readBody(request);
  if (!body.ok) return json({ ok: false, code: body.status === 413 ? 'too_large' : 'bad_request' }, body.status);
  const endpoint = parsePushEndpoint(body.value);
  if (endpoint === null) return json({ ok: false, code: 'bad_request' }, 400);

  const sql = await getSqlRunner();
  if (sql === null) return json({ ok: false, code: 'unavailable' }, 503);
  try {
    return json({ ok: true, revoked: await revokePushSubscription(sql, viewer.userId, endpoint) }, 200);
  } catch (error) {
    console.error('[notify/push] revoke failed', error);
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
