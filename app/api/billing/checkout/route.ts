import { NextResponse } from 'next/server';

/**
 * `POST /api/billing/checkout` — RETIRED (audit P1-4).
 *
 * This route created the $9/month Stripe *subscription* Checkout Session. Subscriptions are on
 * hold by 대표 decision; billing is one payment per template (terms §4.1, AGENTS §5), taken by the
 * Toss one-time flow (`/api/billing/toss/*`). The route answers 410 `subscription_retired` for
 * every caller, signed in or not, so no subscription session can be created from any form, script
 * or cached page.
 *
 * Kept dormant, not deleted: `lib/billing/*` (Stripe gateways, reconcile, `startCheckout`), the
 * webhook (`/api/stripe/webhook`) and the portal route (`/api/billing/portal`) — existing
 * subscribers are still reconciled and can still manage or cancel.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: 'subscription_retired' }, { status: 410, headers: HEADERS });
}
