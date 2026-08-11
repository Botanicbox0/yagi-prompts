import { NextResponse } from 'next/server';
import { ingestEvent } from '@/lib/billing/ledger';
import { getBillingContext } from '@/lib/billing/service';
import { StripeSignatureError } from '@/lib/billing/stripe-gateway';

/**
 * `/api/stripe/webhook` — signature-verified Stripe events (§3.4).
 *
 * The route is deliberately thin. It does three things and delegates the rest:
 *   1. read the RAW body (signature verification is over bytes — `request.text()`, never `.json()`);
 *   2. verify through the gateway, which owns the SDK;
 *   3. hand the flattened event to the ledger (`lib/billing/ledger.ts`), which owns the semantics:
 *      insert with `processed_at = NULL` → skip only if already stamped → reconcile → stamp.
 *
 * Webhooks are TRIGGERS ONLY. Nothing in the payload is trusted as state: `reconcileSubscription`
 * re-fetches current truth from Stripe and applies the fetch-time fenced upsert, so a replayed or
 * out-of-order delivery cannot regress anything.
 *
 * Status vocabulary:
 *   400 bad/missing signature — nothing written
 *   200 processed · replayed · unknown type (ledgered as a no-op)
 *   202 known type whose customer maps to no profile yet — left NULL for the retry sweep
 *   500 handler threw — `processed_at` stays NULL, so Stripe retries AND `npm run stripe:retry` will
 *   503 no Stripe configured on this deployment
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getBillingContext(request);
  if (context === null) {
    return json({ error: 'billing_not_configured' }, 503);
  }

  const payload = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event;
  try {
    event = await context.gateway.constructWebhookEvent(payload, signature);
  } catch (err) {
    if (err instanceof StripeSignatureError) {
      return json({ error: 'invalid_signature' }, 400);
    }
    throw err;
  }

  const outcome = await ingestEvent(context, event);
  switch (outcome.status) {
    case 'processed':
      return json({ received: true, status: 'processed' }, 200);
    case 'skipped':
      return json({ received: true, status: 'skipped' }, 200);
    case 'ignored':
      return json({ received: true, status: 'ignored', type: event.type }, 200);
    case 'unresolved':
      console.warn(`[stripe] ${event.id} (${event.type}): no profile for customer`, outcome.customerId);
      return json({ received: true, status: 'unresolved' }, 202);
    case 'failed':
      console.error(`[stripe] ${event.id} (${event.type}) failed`, outcome.error);
      return json({ received: false, status: 'failed' }, 500);
  }
}

/** A GET here is a misconfigured endpoint, not a resource. Say so rather than 404ing silently. */
export async function GET(): Promise<NextResponse> {
  return json({ error: 'method_not_allowed', hint: 'stripe posts here' }, 405);
}
