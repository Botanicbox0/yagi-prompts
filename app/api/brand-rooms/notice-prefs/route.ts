import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { studioJson } from '@/lib/brand-studio/http';
import { roomErrorStatus } from '@/lib/brand-rooms/message-contracts';
import { loadRoomNoticePrefs, saveRoomNoticePrefs } from '@/lib/brand-rooms/notice-prefs';
import { roomNoticesOpen } from '@/lib/brand-rooms/notices';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';

/**
 * The project room mail switch of the signed-in member (docs/BRAND-ROOMS-FEEDBACK.md §2.2, §10): the
 * "이메일 알림" switch in the messages inbox. One row per person and organization (`brand_room_notice_prefs`).
 *
 * Checks, in the order of `../messages/route.ts`: same origin for a write (403), the switches
 * (`BRAND_ROOM_NOTIFY` and `BRAND_ROOMS`, 404 `rooms_closed`: while notices are off this route answers as
 * if it did not exist), sign-in (401), then inside the service the room seat (membership or a project
 * invitation -> the sandbox hardline and the generation policy, 404 for another or a closed brand).
 *
 *   GET  ?organizationId=…                     { ok, emailEnabled }
 *   POST { organizationId, emailEnabled }       { ok, emailEnabled }
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 1_024;

function log(event: string, error: unknown): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
}

export async function GET(request: NextRequest) {
  if (!roomNoticesOpen()) return studioJson({ ok: false, code: 'rooms_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const result = await loadRoomNoticePrefs(sql, viewer, request.nextUrl.searchParams.get('organizationId') ?? '');
    return studioJson(result, result.ok ? 200 : roomErrorStatus(result.code));
  } catch (error) {
    log('room_notice_prefs_get_failed', error);
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!roomNoticesOpen()) return studioJson({ ok: false, code: 'rooms_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const result = await saveRoomNoticePrefs(sql, viewer, body);
    return studioJson(result, result.ok ? 200 : roomErrorStatus(result.code));
  } catch (error) {
    log('room_notice_prefs_post_failed', error);
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
