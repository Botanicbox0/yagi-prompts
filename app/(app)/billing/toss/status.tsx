'use client';
import { useState } from 'react';
import type { getDictionary } from '@/lib/i18n/dictionaries';

type Copy = ReturnType<typeof getDictionary>['billing']['toss'];
type Reasons = Copy['reasons'];

/**
 * What the reader sees for an order that is not open for payment: its status, and for a failure
 * the reason (docs/PLATFORM-2.0.md §2.2) — with 다시 결제하기 where the same photo may go through,
 * or the template where the order has to be made again. An order an operator holds says so; it
 * is never called refunded or pending.
 */
function sentence(c: Copy, status: string, reason: string | null, render: string | null): string {
  if (status === 'refunded') return c.refunded;
  if (status === 'refund_pending')
    return reason === 'refund_manual' ? c.refundManual : reason === 'partial_balance' ? c.partialBalance : c.refundPending;
  if (status === 'paid') return render ? c.ready : reason === 'fulfil_manual' ? c.fulfilManual : c.paidPreparing;
  if (status === 'failed') {
    if (reason === 'expired') return c.expired;
    return reason !== null && reason in c.reasons ? c.reasons[reason as keyof Reasons] : c.failed;
  }
  return c.pending;
}

export function TossStatus({
  id,
  initialStatus,
  renderId,
  reason: initialReason,
  retry: initialRetry,
  restartHref,
  copy: c,
}: {
  id: string;
  initialStatus: string;
  renderId: string | null;
  reason: string | null;
  retry: boolean;
  restartHref: string;
  copy: Copy;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [render, setRender] = useState(renderId);
  const [reason, setReason] = useState(initialReason);
  const [retry, setRetry] = useState(initialRetry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/billing/toss/orders/${id}`, {
        cache: 'no-store',
      });
      const p = await r.json();
      if (!r.ok || !p.ok) throw new Error();
      setStatus(p.status);
      setRender(p.renderId);
      setReason(p.reason ?? null);
      setRetry(p.retry === true);
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  }
  async function payAgain() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/billing/toss/orders/${id}/retry`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const p = await r.json();
      if (r.ok && p.ok && typeof p.href === 'string') {
        window.location.assign(p.href);
        return;
      }
      setError(p.code === 'rate_limited' ? c.retryLimited : c.retryError);
    } catch {
      setError(c.retryError);
    }
    setBusy(false);
  }
  // A failure with a known reason is settled; nothing a status check could change.
  const settled = status === 'refunded' || (status === 'failed' && reason !== null);
  return (
    <div className="mt-8" data-payment-status={status} data-payment-reason={reason ?? undefined}>
      <p role="status" className="text-lg leading-relaxed">
        {sentence(c, status, reason, render)}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
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
      {status === 'failed' &&
        (retry ? (
          <div className="mt-6">
            <button
              data-toss-retry
              type="button"
              className="rounded-full bg-black px-6 py-3 font-semibold text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void payAgain()}
            >
              {c.retry}
            </button>
            <p className="mt-3 text-sm opacity-60">{c.retryHint}</p>
          </div>
        ) : (
          <a
            href={restartHref}
            data-toss-restart
            className="mt-6 inline-block rounded-full bg-black px-6 py-3 text-white"
          >
            {c.restart}
          </a>
        ))}
      {!settled && (
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
