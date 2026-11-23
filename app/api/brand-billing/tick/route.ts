import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  DEFAULT_SUBSCRIPTION_TICK_BUDGET_MS,
  runBrandSubscriptionTick,
} from '@/lib/brands/subscriptions';
import { carryTrialGrants, ROUTE_TRIAL_CARRY_BUDGET_MS, type TrialCarryResult } from '@/lib/brands/billing/workspace-approval';
import { getSqlRunner } from '@/lib/db/connect';
import { brandBillingAutoIssueOpen, brandWorkspaceApprovalOpen } from '@/lib/flags';

/**
 * `GET|POST /api/brand-billing/tick` — hourly cron pass (`vercel.json`) for B2B subscriptions.
 *
 * - Authenticated via `CRON_SECRET` Bearer token with `timingSafeEqual` (503 unconfigured / 401 unauthorized).
 * - Both flags off (`BRAND_BILLING_AUTO_ISSUE`, `BRAND_WORKSPACE_APPROVAL`): answers `{ ok: true, skipped: 'disabled' }`
 *   with zero DB queries.
 * - `BRAND_BILLING_AUTO_ISSUE` on: processes subscriptions within time budget and returns counts-only JSON (never IDs or names).
 * - `BRAND_WORKSPACE_APPROVAL` on: also runs the trial carry pass once, after the subscription pass, in its own
 *   try/catch and within about 5 s, and adds its counts as `trialCarry` (the subscription answer keeps its fields; with
 *   the subscription flag off it stays `skipped: 'disabled'`).
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

  // B1b: the trial carry pass (BRAND_WORKSPACE_APPROVAL) runs on its own, whatever the subscription flag says.
  const approvalOpen = brandWorkspaceApprovalOpen();
  if (!brandBillingAutoIssueOpen() && !approvalOpen) {
    return NextResponse.json({ ok: true, skipped: 'disabled' }, { status: 200, headers: HEADERS });
  }

  const sql = await getSqlRunner().catch(() => null);
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  }

  // After the subscription pass, isolated and capped (ROUTE_TRIAL_CARRY_BUDGET_MS): a failing or slow carry pass is
  // reported in `trialCarry` and never takes the subscription pass's time.
  const carry = async (): Promise<{ trialCarry?: TrialCarryResult | { ok: false; code: 'carry_failed' } }> => {
    if (!approvalOpen) return {};
    try {
      return { trialCarry: await carryTrialGrants({ sql, budgetMs: ROUTE_TRIAL_CARRY_BUDGET_MS }) };
    } catch (error) {
      console.warn(
        '[brand-billing-tick] trial_carry_failed',
        JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
      );
      return { trialCarry: { ok: false, code: 'carry_failed' } };
    }
  };
  if (!brandBillingAutoIssueOpen()) {
    return NextResponse.json({ ok: true, skipped: 'disabled', ...(await carry()) }, { status: 200, headers: HEADERS });
  }

  let result: Awaited<ReturnType<typeof runBrandSubscriptionTick>>;
  try {
    result = await runBrandSubscriptionTick({
      sql,
      env: process.env,
      budgetMs: DEFAULT_SUBSCRIPTION_TICK_BUDGET_MS,
    });
  } catch (error) {
    console.warn(
      '[brand-billing-tick] route_failed',
      JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );
    return NextResponse.json({ ok: false, code: 'tick_failed', ...(await carry()) }, { status: 503, headers: HEADERS });
  }
  const trialCarry = await carry();
  if ((result.attempted ?? 0) > 0 && result.errors === result.attempted) {
    return NextResponse.json({ ...result, ok: false, code: 'tick_failed', ...trialCarry }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json({ ...result, ...trialCarry }, { status: 200, headers: HEADERS });
}

export const GET = tick;
export const POST = tick;
