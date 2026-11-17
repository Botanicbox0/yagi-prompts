import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { roomNoticesOpen, runLiveRoomNoticePass } from '@/lib/brand-rooms/notices';

/**
 * `GET|POST /api/brand-rooms/notices/tick` — one pass of the project room notices
 * (docs/BRAND-ROOMS-FEEDBACK.md §2.2): pushes not yet pushed, mails that are due. Vercel Cron calls it
 * every 10 minutes (`vercel.json`); the request that queued a notice also kicks one pass after its answer.
 *
 * Private like `/api/brands/inquiries/tick`: without `CRON_SECRET` it answers 503, a missing or wrong
 * bearer 401, and it never takes input. With `BRAND_ROOM_NOTIFY` (or rooms) off it returns at once.
 * Counts only in the answer: no address, no project, no line.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

async function tick(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, code: 'unconfigured' }, { status: 503, headers: HEADERS });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401, headers: HEADERS });
  }
  if (!roomNoticesOpen()) return NextResponse.json({ ok: true, ran: false }, { headers: HEADERS });
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  try {
    const report = await runLiveRoomNoticePass(sql);
    return NextResponse.json({ ok: true, ...report }, { headers: HEADERS });
  } catch (error) {
    console.warn('[brand-rooms] room_notice_tick_failed', JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return NextResponse.json({ ok: false, code: 'pass_failed' }, { status: 503, headers: HEADERS });
  }
}

export const GET = tick;
export const POST = tick;
