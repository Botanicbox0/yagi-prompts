'use client';

import Script from 'next/script';
import { useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { formatCount, interpolate } from '@/lib/i18n/format';
import type { SubscriptionPlanId } from '@/lib/creator-subscriptions/types';
import { subscriptionActionMessage, type SubscriptionCopy } from './subscription-status';

function SubscriptionEditLimit({ limit, locale, copy }: { limit?: number | null; locale: Locale; copy: SubscriptionCopy }) {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) return null;
  return <div data-subscription-edit-limit className="mt-4 space-y-2 rounded-xl border border-hairline p-4">
    <p className="text-sm font-medium">{interpolate(copy.premiumEditRequestLimit, { limit: formatCount(limit, locale) })}</p>
    <p className="text-xs leading-relaxed opacity-75">{copy.premiumEditCountNotice}</p>
  </div>;
}

export function SubscriptionCheckout({ planId, locale, copy, price, consentVersion, available, testMode = false, liveQa = false, premiumEditLimit }: {
  planId: SubscriptionPlanId; locale: Locale; copy: SubscriptionCopy; price: string;
  consentVersion: string; available: boolean; testMode?: boolean; liveQa?: boolean; premiumEditLimit?: number | null;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function begin() {
    if (!available || !consent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/creator-subscriptions', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, locale, consent: true, consentVersion }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; href?: string; code?: string };
      if (response.ok && data.ok === true && typeof data.href === 'string' && /^\/billing\/subscription\/[a-zA-Z0-9-]+$/.test(data.href)) {
        window.location.assign(data.href);
        return;
      }
      if (data.code === 'sign_in_required') { window.location.assign(`/auth/choose?next=${encodeURIComponent(`/billing/subscription?plan=${planId}`)}`); return; }
      if (data.code === 'subscription_exists') { window.location.assign('/account'); return; }
      setError(subscriptionActionMessage(data.code, copy));
    } catch { setError(copy.error); }
    inFlight.current = false;
    setBusy(false);
  }
  return <section data-subscription-checkout data-subscription-plan={planId} className="mt-7 max-w-xl rounded-2xl border border-hairline p-5 sm:p-7">
    <h2 className="text-xl font-semibold">{copy.planNames[planId]}</h2>
    <p className="mt-3 text-2xl font-semibold">{interpolate(copy.monthlyPrice, { price })}</p>
    {liveQa ? <p data-subscription-live-qa className="mt-4 text-sm font-medium text-accent">{copy.liveQaMode}</p> : testMode && <p className="mt-4 text-sm text-accent">{copy.testMode}</p>}
    {planId === 'premium' && <SubscriptionEditLimit limit={premiumEditLimit} locale={locale} copy={copy} />}
    <p className="mt-5 text-sm leading-relaxed opacity-75">{copy.renewalNotice}</p>
    <p className="mt-3 text-sm leading-relaxed opacity-75">{copy.noRollover}</p>
    <a href="/billing/subscription/terms" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.termsLink}</a>
    {!available ? <p role="status" className="mt-4 text-sm leading-relaxed">{copy.preparing}</p> : <>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><input data-subscription-consent type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} className="mt-1 size-4 shrink-0 accent-black" /><span>{copy.consent}</span></label>
      <button data-subscription-enroll type="button" disabled={!consent || busy} onClick={() => void begin()} className="mt-6 min-h-12 w-full rounded-full bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-35">{busy ? copy.busy : copy.start}</button>
    </>}
    {error && <p role="alert" className="mt-4 text-sm text-accent">{error}</p>}
  </section>;
}

interface BillingPayment {
  requestBillingAuth(input: { method: 'CARD'; successUrl: string; failUrl: string }): Promise<void>;
}
type BillingWindow = Window & { TossPayments?: (key: string) => { payment(input: { customerKey: string }): BillingPayment } };

/** The public SDK client key is supplied by the server; secret keys and billing keys stay there. */
export function SubscriptionAuthorization({ subscriptionId, clientKey, customerKey, locale, copy, price, planName, testMode = false, liveQa = false, premiumEditLimit }: {
  subscriptionId: string; clientKey: string; customerKey: string; locale: Locale; copy: SubscriptionCopy;
  price: string; planName: string; testMode?: boolean; liveQa?: boolean; premiumEditLimit?: number | null;
}) {
  const payment = useRef<BillingPayment | null>(null);
  const inFlight = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function initialize() {
    try {
      const sdk = (window as BillingWindow).TossPayments;
      if (!sdk || !clientKey || !customerKey) throw new Error('sdk unavailable');
      payment.current = sdk(clientKey).payment({ customerKey });
      setReady(true);
    } catch { setError(copy.error); }
  }
  async function register() {
    if (!payment.current || !ready || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const success = new URL('/billing/subscription/return', window.location.origin);
      success.searchParams.set('state', subscriptionId);
      success.searchParams.set('locale', locale);
      const failure = new URL(`/billing/subscription/${encodeURIComponent(subscriptionId)}`, window.location.origin);
      failure.searchParams.set('failed', '1');
      await payment.current.requestBillingAuth({ method: 'CARD', successUrl: success.href, failUrl: failure.href });
    } catch { setError(copy.error); inFlight.current = false; setBusy(false); }
  }
  return <section data-subscription-authorization className="mt-7 max-w-xl rounded-2xl border border-hairline p-5 sm:p-7">
    <Script src="https://js.tosspayments.com/v2/standard" onReady={initialize} onError={() => setError(copy.error)} />
    <h2 className="text-xl font-semibold">{planName}</h2><p className="mt-3 text-2xl font-semibold">{interpolate(copy.monthlyPrice, { price })}</p>
    {liveQa ? <p data-subscription-live-qa className="mt-4 text-sm font-medium text-accent">{copy.liveQaMode}</p> : testMode && <p className="mt-4 text-sm text-accent">{copy.testMode}</p>}
    <SubscriptionEditLimit limit={premiumEditLimit} locale={locale} copy={copy} />
    <p className="mt-5 text-sm leading-relaxed opacity-75">{copy.registerBody}</p>
    {!ready && !error && <p role="status" className="mt-4 text-sm">{copy.sdkLoading}</p>}
    <button data-subscription-register type="button" disabled={!ready || busy} onClick={() => void register()} className="mt-6 min-h-12 w-full rounded-full bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-35">{busy ? copy.busy : copy.register}</button>
    {error && <p role="alert" className="mt-4 text-sm text-accent">{error}</p>}
    <a href="/account" className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.account}</a>
  </section>;
}
