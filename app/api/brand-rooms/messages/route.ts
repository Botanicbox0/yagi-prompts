import { after, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { notifySlackBrandConcierge } from '@/lib/brands/concierge-slack';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { getStorage } from '@/lib/storage';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { loadRoomMessages, runRoomOperation, type RoomMessageDeps, type RoomNotice } from '@/lib/brand-rooms/messages';
import { roomErrorStatus } from '@/lib/brand-rooms/message-contracts';
import { purgeStagingObject } from '@/lib/brand-rooms/staging-cleanup';
import { getMailer } from '@/lib/notify/service';

/**
 * Project room conversations (docs/BRAND-ROOMS.md §4). Checks, in order: the flag (`rooms_closed`, 404),
 * sign-in, then inside the service: the room seat (membership or a project invitation -> the sandbox
 * hardline and the generation policy, 404) -> for a project channel, that project -> role.
 *
 *   GET  ?organizationId=&projectId=(id|general)[&before=|&since=][&limit=]   one page of the stream
 *   GET  …&thread=<messageId>[&since=]                                          one thread
 *   GET  …&ref=<storyboard|review>:<id>[:<sub>][&since=]                        the lines about one thing
 *   POST { operation, input }                                                    one of ROOM_OPERATIONS
 *
 * A brand member's new line is passed to the team notifier after the answer has gone out. A notifier
 * failure is logged and never reaches the customer.
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 32_768;

function log(event: string, detail: Record<string, unknown>): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify(detail).slice(0, 600));
}

async function depsOf(sql: RoomMessageDeps['sql'], withStaging: boolean): Promise<RoomMessageDeps> {
  return { sql, media: createStudioMediaStore(), ...(withStaging ? { staging: await getStorage(), purgeStagingKey: purgeStagingObject } : {}) };
}

function tellTheTeam(sql: RoomMessageDeps['sql'], notice: RoomNotice | null): void {
  if (!notice) return;
  after(async () => {
    try {
      await notifySlackBrandConcierge(sql, { ...notice, kind: 'room_message' });
    } catch (error) {
      log('room_notice_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    }
  });
}

export async function GET(request: NextRequest) {
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'rooms_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const params = request.nextUrl.searchParams;
    const query = Object.fromEntries(['organizationId', 'projectId', 'since', 'before', 'limit', 'thread', 'ref'].map((key) => [key, params.get(key)]));
    const result = await loadRoomMessages(await depsOf(sql, false), viewer, query);
    return studioJson(result, result.ok ? 200 : roomErrorStatus(result.code));
  } catch (error) {
    log('room_messages_get_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'rooms_closed' }, 404);
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
    const uploads = body.operation === 'attachment.reserve' || body.operation === 'attachment.complete';
    // 초대하고 보내기 (slice 4c): a line that invites someone sends the existing invitation mail after its commit.
    const inviting = (body.operation === 'send.post' || body.operation === 'send.reply') && Array.isArray((body.input as { invites?: unknown }).invites);
    const deps = await depsOf(sql, uploads);
    const { result, notice } = await runRoomOperation(inviting ? { ...deps, mailer: getMailer() } : deps, viewer, body.operation, body.input);
    if (!result.ok) return studioJson(result, roomErrorStatus(result.code));
    tellTheTeam(sql, notice);
    return studioJson(result, notice ? 201 : 200);
  } catch (error) {
    log('room_messages_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
