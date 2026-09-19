'use client';
import { useState } from 'react';
import type { getDictionary } from '@/lib/i18n/dictionaries';
export function TossStatus({
  id,
  initialStatus,
  renderId,
  copy: c,
}: {
  id: string;
  initialStatus: string;
  renderId: string | null;
  copy: ReturnType<typeof getDictionary>['billing']['toss'];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [render, setRender] = useState(renderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function refresh() {
    setBusy(true);
    setError(false);
    try {
      const r = await fetch(`/api/billing/toss/orders/${id}`, {
        cache: 'no-store',
      });
      const p = await r.json();
      if (!r.ok || !p.ok) throw new Error();
      setStatus(p.status);
      setRender(p.renderId);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-8" data-payment-status={status}>
      <p role="status" className="text-lg leading-relaxed">
        {status === 'refunded'
          ? c.refunded
          : status === 'refund_pending'
            ? c.refundPending
            : status === 'paid' && render
              ? c.ready
              : status === 'failed'
                ? c.failed
                : c.pending}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {c.error}
        </p>
      )}
      {render && (
        <a
          className="mt-6 inline-block rounded-full bg-black px-6 py-3 text-white"
          href={`/renders/${render}`}
        >
          {c.openRender}
        </a>
      )}
      {status !== 'refunded' && (
        <button
          className="mt-6 block text-sm underline disabled:opacity-50"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {c.check}
        </button>
      )}
    </div>
  );
}
