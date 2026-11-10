import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { staffLoadRoomMessages } from '@/lib/brand-rooms/messages';
import { roomErrorStatus } from '@/lib/brand-rooms/message-contracts';

/**
 * The team's read of one organization's conversations (`/admin/brand-rooms/[organizationId]`): the same
 * pages the brand reads (stream, thread, the lines about one thing, `since` polls), every channel of the
 * organization. Writes go through `/admin/do` (`brand_rooms.*`). Not an admin: 404, like every admin
 * surface; the service re-reads the admin flag on the profile row and refuses a sandboxed or
 * generation-closed organization as missing.
 *
 *   GET ?projectId=(id|general)[&before=|&since=][&limit=][&thread=][&ref=]
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!brandRoomsOpen()) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  let viewer;
  try {
    viewer = await requireAdmin();
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const { organizationId } = await context.params;
    const params = request.nextUrl.searchParams;
    const query = { organizationId, ...Object.fromEntries(['projectId', 'since', 'before', 'limit', 'thread', 'ref'].map((key) => [key, params.get(key)])) };
    const result = await staffLoadRoomMessages({ sql, media: createStudioMediaStore() }, viewer, query);
    return studioJson(result, result.ok ? 200 : roomErrorStatus(result.code));
  } catch (error) {
    console.warn('[brand-rooms] staff_room_feed_failed', JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
