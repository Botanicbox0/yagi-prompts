import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomInvitesOpen, brandRoomsOpen } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson } from '@/lib/brand-studio/http';
import { getMailer } from '@/lib/notify/service';
import { loadRoomAccess, runRoomPeopleOperation } from '@/lib/brand-rooms/invites';
import { roomInviteHttpStatus } from '@/lib/brand-rooms/invite-contracts';

/**
 * Who has access to a project room, and inviting people to it (docs/BRAND-ROOMS-FEEDBACK.md §12).
 * Guard order: the switches (`BRAND_ROOMS` and `BRAND_ROOM_INVITES`, 404) -> sign-in (401) -> inside the
 * service: the room seat (sandbox hardline and generation policy, 404) -> this project (404) -> owners
 * and editors only (403).
 *
 *   GET  ?organizationId=&projectId=           members, guests and pending invitations
 *   POST { operation: 'invite.send', input }   invite up to 10 addresses; mails go out after the commit
 *   POST { operation: 'invite.resend' | 'invite.cancel' | 'guest.permission' | 'guest.remove', input }
 *
 * A token appears in an answer only as the link to pass on when its mail did not go out.
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 8_192;

function log(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify(detail).slice(0, 600));
}

const open = () => brandRoomsOpen() && brandRoomInvitesOpen();

export async function GET(request: NextRequest) {
  if (!open()) return studioJson({ ok: false, code: 'not_found' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const params = request.nextUrl.searchParams;
    const result = await loadRoomAccess({ sql }, viewer, {
      organizationId: params.get('organizationId') ?? '',
      projectId: params.get('projectId') ?? '',
    });
    return studioJson(result, result.ok ? 200 : roomInviteHttpStatus(result.code));
  } catch (error) {
    log('room_people_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!open()) return studioJson({ ok: false, code: 'not_found' }, 404);
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
    const result = await runRoomPeopleOperation({ sql, mailer: getMailer() }, viewer, body.operation, body.input);
    if (!result.ok) return studioJson(result, roomInviteHttpStatus(result.code));
    return studioJson(result, 200);
  } catch (error) {
    log('room_people_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
