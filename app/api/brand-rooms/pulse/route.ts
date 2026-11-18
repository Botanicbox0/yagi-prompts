import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { studioJson } from '@/lib/brand-studio/http';
import { roomPulse } from '@/lib/brand-rooms/pulse';
import { roomErrorStatus } from '@/lib/brand-rooms/message-contracts';

/**
 * A project room's pulse (docs/BRAND-ROOMS-FEEDBACK.md §11): one short stamp per part (chat, reviews,
 * storyboards, and the share links for those who manage them). An open room tab asks every 5 seconds
 * while it is on screen and re-reads only the part whose stamp moved. Read only; no content.
 *
 * Checks, in the order of `../summary/route.ts`: the flag (`rooms_closed`, 404), sign-in, then inside the
 * service the room seat (membership or a project invitation -> sandbox hardline + generation policy) and
 * the project. Anything closed is a 404 that names nothing. Team notes never move this stamp.
 *
 *   GET ?organizationId=…&projectId=…   { ok, stamp: { chat, reviews, storyboards, shares } }
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'rooms_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  const params = request.nextUrl.searchParams;
  try {
    const result = await roomPulse({ sql }, viewer, { organizationId: params.get('organizationId') ?? '', projectId: params.get('projectId') ?? '' });
    return studioJson(result, result.ok ? 200 : roomErrorStatus(result.code));
  } catch (error) {
    console.warn('[brand-rooms] room_pulse_failed', JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
