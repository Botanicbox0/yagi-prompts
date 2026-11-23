import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  DEFAULT_SUBSCRIPTION_TICK_BUDGET_MS,
  runBrandSubscriptionTick,
} from '@/lib/brands/subscriptions';
import { getSqlRunner } from '@/lib/db/connect';
import { brandBillingAutoIssueOpen } from '@/lib/flags';

/**
 * `GET|POST /api/brand-billing/tick` — hourly cron pass (`vercel.json`) for B2B subscriptions.
 *
 * - Authenticated via `CRON_SECRET` Bearer token with `timingSafeEqual` (503 unconfigured / 401 unauthorized).
 * - Flag off (`BRAND_BILLING_AUTO_ISSUE !== 'on'`): answers `{ ok: true, skipped: 'disabled' }` with zero DB queries.
 * - Flag on: processes subscriptions within time budget and returns counts-only JSON (never IDs or names).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

async function tick(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: false, code: 'unconfigured' }, { status: 503, headers: HEADERS });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401, headers: HEADERS });
  }

  if (!brandBillingAutoIssueOpen()) {
    return NextResponse.json({ ok: true, skipped: 'disabled' }, { status: 200, headers: HEADERS });
  }

  const sql = await getSqlRunner().catch(() => null);
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  }

  try {
    const result = await runBrandSubscriptionTick({
      sql,
      env: process.env,
      budgetMs: DEFAULT_SUBSCRIPTION_TICK_BUDGET_MS,
    });
    if ((result.attempted ?? 0) > 0 && result.errors === result.attempted) {
      return NextResponse.json({ ...result, ok: false, code: 'tick_failed' }, { status: 503, headers: HEADERS });
    }
    return NextResponse.json(result, { status: 200, headers: HEADERS });
  } catch (error) {
    console.warn(
      '[brand-billing-tick] route_failed',
      JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );
    return NextResponse.json({ ok: false, code: 'tick_failed' }, { status: 503, headers: HEADERS });
  }
}

export const GET = tick;
export const POST = tick;
