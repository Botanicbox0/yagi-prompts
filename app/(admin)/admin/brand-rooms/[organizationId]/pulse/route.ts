import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { studioJson } from '@/lib/brand-studio/http';
import { staffRoomPulse } from '@/lib/brand-rooms/pulse';
import { roomErrorStatus } from '@/lib/brand-rooms/message-contracts';

/**
 * The team's pulse for one project's desk or one review page (docs/BRAND-ROOMS-FEEDBACK.md §11), beside
 * `../feed/route.ts`: a short stamp per part, team notes included. Not an admin: 404, like every admin
 * surface; the service re-reads the admin flag on the profile row and answers a sandboxed or
 * generation-closed organization as missing.
 *
 *   GET ?projectId=…   { ok, stamp: { chat, reviews, storyboards, shares } }
 *   GET ?review=…      { ok, stamp: { reviews } } over that review's whole stack
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ organizationId: string }> };

const gone = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: NextRequest, context: Context) {
  if (!brandRoomsOpen()) return gone();
  let viewer;
  try {
    viewer = await requireAdmin();
  } catch {
    return gone();
  }
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const { organizationId } = await context.params;
    const params = request.nextUrl.searchParams;
    const result = await staffRoomPulse({ sql }, viewer, { organizationId, projectId: params.get('projectId'), reviewId: params.get('review') });
    return studioJson(result, result.ok ? 200 : roomErrorStatus(result.code));
  } catch (error) {
    console.warn('[brand-rooms] staff_room_pulse_failed', JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
