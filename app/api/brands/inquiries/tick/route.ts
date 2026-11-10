import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { runLiveBrandInquiryDelivery } from '@/lib/brands/slack-runtime';
import { sweepStudioLive } from '@/lib/brand-studio/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** Recovery is private even when not configured. It never accepts a destination or inquiry body. */
async function tick(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, code: 'unconfigured' }, { status: 503, headers: HEADERS });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401, headers: HEADERS });
  }
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  let report: Awaited<ReturnType<typeof runLiveBrandInquiryDelivery>> | null = null;
  try {
    report = await runLiveBrandInquiryDelivery(sql, { limit: 5 });
  } catch {
    console.warn('[brands] inquiry Slack recovery pass failed');
  }
  // Brand studio v2 daily sweep (docs/BRAND-STUDIO-V2.md §7): stale leases, lane failover, expiry.
  // Hobby allows two crons, so it rides here. Each pass is isolated: one failing (or the studio tables
  // not migrated yet) never stops the other.
  let studio: unknown = null;
  try {
    studio = await sweepStudioLive(sql);
  } catch {
    console.warn('[brand-studio] daily sweep failed');
  }
  if (!report) return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  return NextResponse.json({ ok: true, report, studio }, { headers: HEADERS });
}

export const GET = tick;
export const POST = tick;
