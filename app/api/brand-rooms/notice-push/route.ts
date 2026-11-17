import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioJson } from '@/lib/brand-studio/http';
import { RoomDenied, roomSeat } from '@/lib/brand-rooms/access';
import { roomErrorStatus } from '@/lib/brand-rooms/message-contracts';
import { roomNoticesOpen } from '@/lib/brand-rooms/notices';
import {
  PUSH_BODY_MAX_BYTES,
  parsePushEndpoint,
  parsePushSubscription,
  pushConfigFromEnv,
  revokePushSubscription,
  savePushSubscription,
} from '@/lib/notify/push';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';

/**
 * This browser's push for project room notices (docs/BRAND-ROOMS-FEEDBACK.md §2.2, §10): the "푸시 알림"
 * switch in the messages inbox on the brand host. A thin door to the same storage as
 * `/api/notify/push` (`savePushSubscription` / `revokePushSubscription`, `push_subscriptions` 0053), which
 * stays closed on the brand host: unlike it, this door is shut while room notices are off and opens only
 * for someone seated in the brand they are looking at.
 *
 * A push subscription belongs to the browser and its origin, so one made here (brand.twings.app) is a
 * device row of its own beside any made on twings.app; both receive every push of the person
 * (lib/notify/push.ts `sendPushToUser`), and public/sw.js opens each link on the host that serves it.
 *
 * Checks: same origin (403), the switches (`BRAND_ROOM_NOTIFY` + `BRAND_ROOMS`, 404 `rooms_closed`),
 * sign-in (401), the room seat for `?organizationId=` (404 for another or a closed brand), then for a
 * subscription the VAPID keys (503 `push_unavailable`) and the body (400, 413).
 *
 *   POST   ?organizationId=…   PushSubscription.toJSON()   this browser says yes
 *   DELETE ?organizationId=…   { endpoint }                 this browser says no (the row keeps `revoked_at`)
 */
export const dynamic = 'force-dynamic';

type Gate = { ok: true; sql: SqlRunner; userId: string; body: unknown } | { ok: false; response: Response };

async function gate(request: NextRequest): Promise<Gate> {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return { ok: false, response: studioJson({ ok: false, code: 'forbidden' }, 403) };
  if (!roomNoticesOpen()) return { ok: false, response: studioJson({ ok: false, code: 'rooms_closed' }, 404) };
  const viewer = await getViewer();
  if (!viewer.userId) return { ok: false, response: studioJson({ ok: false, code: 'sign_in_required' }, 401) };
  const sql = await getSqlRunner();
  if (!sql) return { ok: false, response: studioJson({ ok: false, code: 'provider_unavailable' }, 503) };
  try {
    await roomSeat(sql, viewer.userId, request.nextUrl.searchParams.get('organizationId') ?? '');
  } catch (error) {
    if (error instanceof RoomDenied) return { ok: false, response: studioJson({ ok: false, code: error.code }, roomErrorStatus(error.code)) };
    throw error;
  }
  if (Number(request.headers.get('content-length') ?? 0) > PUSH_BODY_MAX_BYTES) return { ok: false, response: studioJson({ ok: false, code: 'invalid' }, 413) };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > PUSH_BODY_MAX_BYTES) return { ok: false, response: studioJson({ ok: false, code: 'invalid' }, 413) };
    return { ok: true, sql, userId: viewer.userId, body: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: studioJson({ ok: false, code: 'invalid' }, 400) };
  }
}

function log(event: string, error: unknown): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
}

export async function POST(request: NextRequest) {
  try {
    const checked = await gate(request);
    if (!checked.ok) return checked.response;
    if (pushConfigFromEnv() === null) return studioJson({ ok: false, code: 'push_unavailable' }, 503);
    const subscription = parsePushSubscription(checked.body);
    if (subscription === null) return studioJson({ ok: false, code: 'invalid' }, 400);
    await savePushSubscription(checked.sql, checked.userId, subscription, request.headers.get('user-agent'));
    return studioJson({ ok: true }, 200);
  } catch (error) {
    log('room_notice_push_save_failed', error);
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const checked = await gate(request);
    if (!checked.ok) return checked.response;
    const endpoint = parsePushEndpoint(checked.body);
    if (endpoint === null) return studioJson({ ok: false, code: 'invalid' }, 400);
    return studioJson({ ok: true, revoked: await revokePushSubscription(checked.sql, checked.userId, endpoint) }, 200);
  } catch (error) {
    log('room_notice_push_revoke_failed', error);
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
