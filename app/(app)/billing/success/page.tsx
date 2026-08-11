/**
 * `/billing/success` — M0 placeholder. M3 wires `reconcileSubscription(userId)` here with the
 * Checkout session id, then redirects back to the origin slug + locale carried in metadata (§3.4).
 */
export const dynamic = 'force-dynamic';

export default function BillingSuccessPage() {
  return (
    <main className="min-h-screen bg-white px-gutter py-24 text-black">
      <h1 className="font-display text-title uppercase">Confirming payment…</h1>
      <p className="mt-6 text-body">M0 placeholder — reconciliation lands in M3.</p>
    </main>
  );
}
