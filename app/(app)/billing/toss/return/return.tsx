'use client';
import { useEffect, useRef, useState } from 'react';
import type { getDictionary } from '@/lib/i18n/dictionaries';
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
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      setPending(true);
      return;
    }
    setOrderId(id);
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
