import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runPublicMediaSync } from '@/lib/storage/public-media-runtime';

/**
 * `GET|POST /api/public-media/tick` — the daily check that every public file reached R2
 * (docs/BRAND-MOAT-AND-STORAGE.md). A publish starts the same run right away; this catches what a
 * publish could not finish. Reads and writes nothing until the R2 keys exist.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const BUDGET_MS = 240_000;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

async function tick(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, code: 'unconfigured' }, { status: 503, headers: HEADERS });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401, headers: HEADERS });
  }
  try {
    const report = await runPublicMediaSync(BUDGET_MS);
    if (report === null) return NextResponse.json({ ok: true, configured: false }, { headers: HEADERS });
    return NextResponse.json({
      ok: true,
      configured: true,
      verified: report.verified.length,
      failed: report.failed,
      waiting: report.waiting.length,
      deferred: report.deferred.length,
    }, { headers: HEADERS });
  } catch {
    console.warn('[public-media] daily run failed');
    return NextResponse.json({ ok: false, code: 'sync_failed' }, { status: 503, headers: HEADERS });
  }
}

export const GET = tick;
export const POST = tick;
