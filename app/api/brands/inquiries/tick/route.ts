import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { runLiveBrandInquiryDelivery } from '@/lib/brands/slack-runtime';

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
  try {
    const sql = await getSqlRunner();
    if (!sql) return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
    const report = await runLiveBrandInquiryDelivery(sql, { limit: 5 });
    return NextResponse.json({ ok: true, report }, { headers: HEADERS });
  } catch {
    console.warn('[brands] inquiry Slack recovery pass failed');
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  }
}

export const GET = tick;
export const POST = tick;
