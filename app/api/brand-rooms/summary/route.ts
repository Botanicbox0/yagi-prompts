import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { studioJson } from '@/lib/brand-studio/http';
import { loadRoomSummary } from '@/lib/brand-rooms/messages';
import { roomErrorStatus } from '@/lib/brand-rooms/message-contracts';

/**
 * What the rail's unread badges and the inbox's channel list read (docs/BRAND-ROOMS.md §4): every
 * channel this person may open, with its unread count, last activity and last line. Read only.
 *
 * Checks, in the order of `../messages/route.ts`: the flag (`rooms_closed`, 404), sign-in, then inside the
 * service: the room seat (membership or a project invitation -> sandbox hardline + generation policy, 404).
 *
 *   GET ?organizationId=…   RoomSummary (components/brand-rooms/seams.ts)
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'rooms_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const result = await loadRoomSummary({ sql }, viewer, request.nextUrl.searchParams.get('organizationId') ?? '');
    return studioJson(result, result.ok ? 200 : roomErrorStatus(result.code));
  } catch (error) {
    console.warn('[brand-rooms] room_summary_failed', JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
