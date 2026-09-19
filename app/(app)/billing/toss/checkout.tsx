'use client';
import Script from 'next/script';
import { useRef, useState } from 'react';
import type { getDictionary } from '@/lib/i18n/dictionaries';

type Copy = ReturnType<typeof getDictionary>['billing']['toss'];
interface Widgets {
  setAmount(input: { currency: string; value: number }): Promise<void>;
  renderPaymentMethods(input: { selector: string }): Promise<unknown>;
  renderAgreement(input: {
    selector: string;
  }): Promise<{
    on(
      event: 'agreementStatusChange',
      cb: (status: { agreedRequiredTerms: boolean }) => void,
    ): void;
  }>;
  requestPayment(input: {
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
  }): Promise<unknown>;
}
type TossWindow = Window & {
  TossPayments?: (key: string) => {
    widgets(input: { customerKey: string }): Widgets;
  };
};

export function TossCheckout(props: {
  id: string;
  amount: number;
  name: string;
  customerKey: string;
  clientKey: string | null;
  kind: string;
  locale: string;
  copy: Copy;
}) {
  const { copy: c } = props;
  const widgets = useRef<Widgets | null>(null);
  const initialized = useRef(false);
  const [ready, setReady] = useState(props.kind === 'fake');
  // The SDK may render preselected terms before the change listener is attached.
  // Until a change arrives, requestPayment itself validates its current agreement state.
  const [terms, setTerms] = useState<boolean | null>(
    props.kind === 'fake' ? true : null,
  );
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const amount =
    props.locale === 'ko'
      ? `${props.amount.toLocaleString('ko-KR')}원`
      : `₩${props.amount.toLocaleString('en-US')}`;
  async function initialize() {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const init = (window as TossWindow).TossPayments;
      if (!init || !props.clientKey) throw new Error();
      const w = init(props.clientKey).widgets({
        customerKey: props.customerKey,
      });
      widgets.current = w;
      await w.setAmount({ currency: 'KRW', value: props.amount });
      await w.renderPaymentMethods({ selector: '#toss-methods' });
      const a = await w.renderAgreement({ selector: '#toss-agreement' });
      a.on('agreementStatusChange', (s) => setTerms(s.agreedRequiredTerms));
      setReady(true);
    } catch {
      setError(true);
    }
  }
  async function pay() {
    if (!consent || terms === false || busy) return;
    setBusy(true);
    setError(false);
    try {
      const accepted = await fetch(`/api/billing/toss/orders/${props.id}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      });
      if (!accepted.ok) throw new Error();
      if (props.kind === 'fake') {
        const response = await fetch('/api/billing/toss/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: props.id, amount: props.amount }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error();
        window.location.assign(result.href);
      } else {
        await widgets.current!.requestPayment({
          orderId: props.id,
          orderName: props.name,
          successUrl: `${window.location.origin}/billing/toss/return?locale=${props.locale}`,
          failUrl: `${window.location.origin}/billing/toss/${props.id}?failed=1`,
        });
      }
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <div data-toss-checkout className="mt-8">
      {props.kind !== 'fake' && (
        <Script
          src="https://js.tosspayments.com/v2/standard"
          onReady={() => void initialize()}
          onError={() => setError(true)}
        />
      )}
      {props.kind !== 'live' && (
        <p className="mb-5 border border-accent p-3 text-sm text-accent">
          {props.kind === 'fake' ? c.fake : c.test}
        </p>
      )}
      <div id="toss-methods" />
      <div id="toss-agreement" />
      {!ready && !error && (
        <p role="status" className="py-6">
          {c.preparing}
        </p>
      )}
      <div className="mt-6 border-t border-hairline pt-6">
        <p
          data-withdrawal-notice
          className="text-sm leading-relaxed opacity-70"
        >
          {c.notice}
        </p>
        <a
          className="mt-3 inline-block text-sm underline"
          href={`/${props.locale}/legal/refund`}
          target="_blank"
          rel="noreferrer"
        >
          {c.refundPolicy}
        </a>
        <label className="my-6 flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input
            data-toss-consent
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-black"
          />
          <span>{c.consent}</span>
        </label>
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {c.error}
          </p>
        )}
        <button
          data-toss-pay
          type="button"
          onClick={() => void pay()}
          disabled={!ready || terms === false || !consent || busy}
          className="w-full rounded-full bg-black px-6 py-4 font-semibold text-white disabled:opacity-35"
        >
          {busy ? c.confirming : c.pay.replace('{amount}', amount)}
        </button>
      </div>
    </div>
  );
}
