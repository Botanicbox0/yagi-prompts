import { NextResponse } from 'next/server';

/**
 * `/api/stripe/webhook` — signature-verified Stripe events (§3.4). M3 implements it.
 *
 * Ledger semantics it must honour:
 *   · insert the event id (PK) with `processed_at = NULL`;
 *   · skip an event ONLY if it already exists with `processed_at NOT NULL`;
 *   · webhooks are TRIGGERS ONLY — never trust the payload as state. Run
 *     `reconcileSubscription(userId)`, which refetches truth from the Stripe API and applies a
 *     fetch-time fenced upsert, then stamp `processed_at`;
 *   · a failed handler leaves `processed_at` NULL so the retry sweep reprocesses it.
 * Events handled: checkout.session.completed, customer.subscription.updated|deleted,
 * invoice.payment_failed.
 */
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'not_implemented', milestone: 'M3' },
    {
      status: 501,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}
