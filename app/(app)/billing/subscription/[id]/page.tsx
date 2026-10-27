import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatKrw } from '@/lib/i18n/format';
import { isLocale } from '@/lib/i18n/config';
import { getSubscriptionContext } from '@/lib/creator-subscriptions/runtime';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { loadSubscription, getSubscriptionSummary } from '@/lib/creator-subscriptions/repo';
import { SubscriptionAuthorization } from '@/components/billing/subscription-checkout';
import { StoreCheckoutNote, StoreShellGate } from '@/components/pwa/store-shell';
import { SubscriptionStatus } from '@/components/billing/subscription-status';

export const dynamic = 'force-dynamic';
export default async function SubscriptionAuthorizationPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer(); if (!viewer.userId) notFound();
  const deps = await getSubscriptionContext(); if (!deps) notFound();
  if (deps.environment === 'test' && !subscriptionQaAllowed(viewer)) notFound();
  const subscription = await loadSubscription(deps.sql, (await params).id);
  if (!subscription || subscription.user_id !== viewer.userId || subscription.environment !== deps.environment) notFound();
  const locale = isLocale(subscription.locale) ? subscription.locale : 'ko';
  const dict = getDictionary(locale);
  const copy = dict.creatorSubscription;
  const store = dict.appShell.store;
  if (subscription.status === 'active') redirect('/account');
  const canRegister = subscription.status === 'awaiting_auth' && !subscription.cancel_at_period_end && new Date(subscription.expires_at) > new Date();
  return <main id="main" className="mx-auto min-h-screen max-w-2xl px-5 py-24 sm:px-8">
    <p className="text-sm font-semibold text-accent">TWINGS</p><h1 className="mt-4 text-3xl font-semibold tracking-tight">{copy.registerTitle}</h1>
    {canRegister ? <StoreShellGate fallback={<StoreCheckoutNote title={store.checkoutTitle} body={store.checkoutBody} />}><SubscriptionAuthorization subscriptionId={subscription.id} clientKey={deps.clientKey} customerKey={subscription.customer_key} locale={locale} copy={copy} price={formatKrw(subscription.amount_krw, locale)} planName={copy.planNames[subscription.plan_id]} testMode={deps.environment === 'test'} liveQa={deps.environment === 'live' && viewer.isAdmin && process.env.CREATOR_SUBSCRIPTION_LIVE_QA === 'on'} premiumEditLimit={subscription.premium_edit_limit} /></StoreShellGate> : <>
      <p role="status" className="mt-5 text-sm leading-relaxed">{subscription.status === 'authorizing' ? copy.paymentPending : copy.registrationExpired}</p>
      <SubscriptionStatus initial={await getSubscriptionSummary(deps.sql, viewer.userId, { environment: deps.environment, subscriptionId:subscription.id })} locale={locale} copy={copy} />
    </>}
    <a href="/account" className="mt-7 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.account}</a>
  </main>;
}
