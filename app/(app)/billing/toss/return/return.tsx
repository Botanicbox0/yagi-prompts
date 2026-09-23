'use client';
import { useEffect, useRef, useState } from 'react';
import type { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Audit P2-13: the provider parameters leave the URL at once (they carry the payment key), so a
 * reload used to lose the order too. The order id — not a capability, the order page re-checks
 * ownership — is kept for this tab so the reader can still reach its status page.
 */
export const TOSS_RETURN_ORDER_KEY = 'twings.toss.returnOrder';
const ORDER_ID = /^[0-9a-f-]{36}$/i;

function rememberedOrder(): string {
  try {
    const id = window.sessionStorage.getItem(TOSS_RETURN_ORDER_KEY) ?? '';
    return ORDER_ID.test(id) ? id : '';
  } catch {
    return '';
  }
}

export function TossReturn({
  copy: c,
}: {
  copy: ReturnType<typeof getDictionary>['billing']['toss'];
}) {
  const started = useRef(false);
  const [pending, setPending] = useState(false);
  const [orderId, setOrderId] = useState('');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const p = new URLSearchParams(window.location.search);
    const id = p.get('orderId') ?? '';
    if (!ORDER_ID.test(id)) {
      // A reload after the URL was cleaned: never re-confirm, just point at the order.
      setOrderId(rememberedOrder());
      setPending(true);
      return;
    }
    setOrderId(id);
    try {
      window.sessionStorage.setItem(TOSS_RETURN_ORDER_KEY, id);
    } catch {
      /* storage unavailable — the link below still shows for this render */
    }
    const body = {
      orderId: id,
      paymentKey: p.get('paymentKey'),
      amount: Number(p.get('amount')),
    };
    // Remove the provider capability from the URL immediately; never render or log it.
    window.history.replaceState(null, '', window.location.pathname);
    void fetch('/api/billing/toss/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        const result = await r.json();
        if (r.ok && result.ok && typeof result.href === 'string')
          window.location.replace(result.href);
        else window.location.replace(`/billing/toss/${id}`);
      })
      .catch(() => setPending(true));
  }, []);
  return (
    <div data-toss-return>
      <h1 className="font-display text-3xl font-black">
        {pending ? c.pending : c.confirming}
      </h1>
      {orderId && (
        <a
          href={`/billing/toss/${orderId}`}
          className="mt-6 inline-block underline"
        >
          {c.check}
        </a>
      )}
    </div>
  );
}
