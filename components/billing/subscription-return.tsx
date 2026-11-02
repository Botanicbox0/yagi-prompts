'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { subscriptionActionMessage, type SubscriptionCopy } from './subscription-status';

interface AuthorizationReturn { subscriptionId: string; authKey: string; customerKey: string }

/** Scrub the URL before any asynchronous work. Authorization values exist only in this page's memory. */
export function readSubscriptionReturn(href: string, replaceUrl: (href: string) => void): AuthorizationReturn | null {
  const url = new URL(href);
  const subscriptionId = url.searchParams.get('state');
  const authKey = url.searchParams.get('authKey');
  const customerKey = url.searchParams.get('customerKey');
  for (const key of ['state', 'authKey', 'customerKey', 'code', 'message']) url.searchParams.delete(key);
  replaceUrl(`${url.pathname}${url.search}${url.hash}`);
  return subscriptionId && authKey && customerKey ? { subscriptionId, authKey, customerKey } : null;
}

export function SubscriptionReturn({ locale, copy }: { locale: Locale; copy: SubscriptionCopy }) {
  const captured = useRef(false);
  const authorization = useRef<AuthorizationReturn | null>(null);
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<'confirming' | 'success' | 'error' | 'missing'>('confirming');
  const [error, setError] = useState('');
  async function confirm() {
    if (!authorization.current || inFlight.current) return;
    inFlight.current = true;
    setPhase('confirming');
    setError('');
    try {
      const response = await fetch('/api/creator-subscriptions/confirm', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authorization.current),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; code?: string };
      if (response.ok && data.ok === true) { authorization.current = null; setPhase('success'); return; }
      setError(data.code ? subscriptionActionMessage(data.code, copy) : copy.returnError);
      setPhase('error');
    } catch { setError(copy.returnError); setPhase('error'); }
    finally { inFlight.current = false; }
  }
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    authorization.current = readSubscriptionReturn(window.location.href, href => window.history.replaceState(window.history.state, '', href));
    if (!authorization.current) { setPhase('missing'); return; }
    void confirm();
  }, []);
  return <section data-subscription-return={phase} className="mt-7 max-w-xl rounded-2xl border border-hairline p-5 sm:p-7">
    {phase === 'confirming' && <p role="status" className="text-sm leading-relaxed">{copy.confirming}</p>}
    {phase === 'success' && <><h2 className="text-2xl font-semibold">{copy.confirmedTitle}</h2><p className="mt-4 text-sm leading-relaxed opacity-75">{copy.confirmedBody}</p><a href={`/${locale}/video`} className="mt-6 inline-flex min-h-12 items-center rounded-full bg-black px-6 py-3 text-sm font-semibold text-white">{copy.chooseTemplate}</a></>}
    {phase === 'error' && <><p role="alert" className="text-sm leading-relaxed">{error || copy.returnError}</p><button type="button" onClick={() => void confirm()} className="mt-5 min-h-12 rounded-full border border-current px-5 py-3 text-sm">{copy.retryConfirm}</button></>}
    {phase === 'missing' && <p role="alert" className="text-sm leading-relaxed">{copy.returnMissing}</p>}
    <a href="/account" className="mt-5 flex min-h-11 items-center text-sm underline underline-offset-4">{copy.account}</a>
  </section>;
}
