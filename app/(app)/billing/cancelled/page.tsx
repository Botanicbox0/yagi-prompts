/** `/billing/cancelled` — returns the visitor unchanged (§3.4). */
export const dynamic = 'force-dynamic';

export default function BillingCancelledPage() {
  return (
    <main className="min-h-screen bg-white px-gutter py-24 text-black">
      <h1 className="font-display text-title uppercase">Checkout cancelled</h1>
      <p className="mt-6 text-body">Nothing was charged.</p>
    </main>
  );
}
