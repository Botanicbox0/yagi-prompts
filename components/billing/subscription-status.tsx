'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { interpolate } from '@/lib/i18n/format';
import type { SubscriptionSummary } from '@/lib/creator-subscriptions/types';

export type SubscriptionCopy = Dictionary['creatorSubscription'];
export function subscriptionActionMessage(code: string | undefined, copy: SubscriptionCopy): string {
  if (code === 'refund_pending') return copy.refundPending;
  if (['authorization_pending', 'payment_pending'].includes(code ?? '')) return copy.paymentPending;
  if (['not_refundable', 'period_used', 'period_expired'].includes(code ?? '')) return copy.refundUnavailable;
  if (code === 'unavailable') return copy.preparing;
  if (code === 'authorization_failed') return copy.registrationFailed;
  if (code === 'expired') return copy.registrationExpired;
  if (code === 'rate_limited') return copy.rateLimited;
  if (code === 'payment_review_required') return copy.paymentReviewRequired;
  if (code === 'key_cleanup_pending') return copy.registrationCleanupPending;
  if (code === 'payment_failed') return copy.paymentFailed;
  return copy.error;
}

function formattedDate(value: string | null, locale: Locale, fallback: string) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return fallback;
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(value));
}

/** Only server ledger percentages enter this component; public plan examples are never reused. */
export function SubscriptionStatus({ initial, copy, locale, unavailable = false }: {
  initial: SubscriptionSummary | null; copy: SubscriptionCopy; locale: Locale; unavailable?: boolean;
}) {
  const [summary, setSummary] = useState(initial);
  const [action, setAction] = useState<'cancel' | 'refund' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const id = summary?.id ?? null;

  async function refresh() {
    if (!id) return;
    const response = await fetch(`/api/creator-subscriptions/${encodeURIComponent(id)}`, { cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json().catch(() => ({})) as { subscription?: SubscriptionSummary | null };
    if (!response.ok || !data.subscription) throw new Error('summary unavailable');
    setSummary(data.subscription);
  }
  useEffect(() => {
    if (!id) return;
    let active = true;
    const reload = async () => {
      try {
        const response = await fetch(`/api/creator-subscriptions/${encodeURIComponent(id)}`, { cache: 'no-store', credentials: 'same-origin' });
        const data = await response.json().catch(() => ({})) as { subscription?: SubscriptionSummary | null };
        if (active && response.ok && data.subscription) setSummary(data.subscription);
      } catch { /* Keep the last confirmed record when a read fails. */ }
    };
    const onFocus = () => { void reload(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => { active = false; window.removeEventListener('focus', onFocus); window.removeEventListener('pageshow', onFocus); };
  }, [id]);

  async function confirmAction() {
    if (!id || !action || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/creator-subscriptions/${encodeURIComponent(id)}/${action}`, { method: 'POST', credentials: 'same-origin' });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; code?: string };
      if (!response.ok || data.ok !== true) {
        setError(subscriptionActionMessage(data.code, copy));
        await refresh().catch(() => {});
        return;
      }
      await refresh();
      setAction(null);
    } catch { setError(copy.error); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (!summary) return <section data-subscription-status={unavailable ? 'unavailable' : 'none'} className="mt-10 max-w-detail border-t border-hairline pt-6">
    <h2 className="text-lg font-semibold">{copy.title}</h2><p className="mt-3 text-sm opacity-70">{unavailable ? copy.statusUnavailable : copy.noSubscription}</p>
    <a className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`/${locale}/pricing#monthly`}>{copy.browsePlans}</a>
  </section>;

  const percent = Math.max(0, Math.min(100, Math.round(summary.remainingPercent)));
  const manageable = ['active', 'past_due'].includes(summary.status);
  const periodDate = formattedDate(summary.periodEnd, locale, copy.datePending);
  return <section data-subscription-status={summary.status} data-subscription-environment={summary.environment} className="mt-10 max-w-detail rounded-2xl border border-hairline p-5 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{copy.title}</h2><span className="rounded-full border border-hairline px-3 py-1 text-xs">{copy.statusLabels[summary.status]}</span></div>
    <p className="mt-4 text-xl font-semibold">{copy.planNames[summary.planId]}</p>
    {summary.environment === 'test' && <p className="mt-3 text-sm text-accent">{copy.testMode}</p>}
    {summary.hasAccess && <div className="mt-5" data-subscription-usage>
      <p className="text-sm font-medium">{interpolate(copy.remaining, { percent: String(percent) })}</p>
      <div role="meter" aria-label={copy.usageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-3 h-2 overflow-hidden rounded-full bg-black/10"><div className="h-full bg-accent" style={{ width: `${percent}%` }} /></div>
    </div>}
    <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
      {summary.periodStart && <div><dt className="opacity-60">{copy.period}</dt><dd className="mt-1">{formattedDate(summary.periodStart, locale, copy.datePending)} – {periodDate}</dd></div>}
      <div><dt className="opacity-60">{summary.cancelAtPeriodEnd || !summary.nextBillingAt ? copy.periodEnd : copy.nextBilling}</dt><dd className="mt-1">{summary.cancelAtPeriodEnd || !summary.nextBillingAt ? periodDate : formattedDate(summary.nextBillingAt, locale, copy.datePending)}</dd></div>
    </dl>
    {summary.cancelAtPeriodEnd && <p data-subscription-cancellation-scheduled className="mt-5 text-sm leading-relaxed">{summary.hasAccess ? copy.cancellationScheduled : copy.renewalStopped}</p>}
    {summary.status === 'past_due' && <p className="mt-5 text-sm leading-relaxed">{copy.pastDue}</p>}
    {!action && manageable && <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-4">
      {!summary.cancelAtPeriodEnd && <button data-subscription-cancel type="button" onClick={() => { setAction('cancel'); setError(''); }} className="min-h-11 text-sm underline underline-offset-4">{copy.cancel}</button>}
      {summary.periodStart && <button data-subscription-refund type="button" onClick={() => { setAction('refund'); setError(''); }} className="min-h-11 text-sm underline underline-offset-4">{copy.refund}</button>}
    </div>}
    {action && <div data-subscription-action={action} className="mt-6 border-t border-hairline pt-5">
      <h3 className="font-semibold">{action === 'cancel' ? copy.cancelConfirmTitle : copy.refundConfirmTitle}</h3>
      <p className="mt-3 text-sm leading-relaxed opacity-75">{action === 'cancel' ? summary.hasAccess ? copy.cancelConfirmBody : copy.cancelNoAccessBody : copy.refundConfirmBody}</p>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void confirmAction()} className="min-h-12 rounded-full bg-black px-5 py-3 text-sm font-medium text-white disabled:opacity-40">{busy ? copy.busy : action === 'cancel' ? copy.confirmCancel : copy.confirmRefund}</button><button type="button" disabled={busy} onClick={() => { setAction(null); setError(''); }} className="min-h-12 px-4 text-sm underline underline-offset-4">{action === 'cancel' ? copy.keepSubscription : copy.back}</button></div>
    </div>}
    {error && <p role="alert" className="mt-4 text-sm text-accent">{error}</p>}
    <a href="/billing/subscription/terms" className="mt-5 inline-flex min-h-11 items-center text-xs underline underline-offset-4">{copy.termsLink}</a>
  </section>;
}
