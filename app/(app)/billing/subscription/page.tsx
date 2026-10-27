import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getRequestLocale } from '@/lib/i18n/server';
import { isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatKrw } from '@/lib/i18n/format';
import { getSubscriptionContext, liveSubscriptionAvailability, subscriptionLiveQaReady } from '@/lib/creator-subscriptions/runtime';
import { mayEnrollSubscription } from '@/lib/creator-subscriptions/access';
import { isSubscriptionPlan, SUBSCRIPTION_PLANS } from '@/lib/creator-subscriptions/plans';
import { SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { SubscriptionCheckout } from '@/components/billing/subscription-checkout';
import { StoreCheckoutNote, StoreShellGate } from '@/components/pwa/store-shell';

export const dynamic = 'force-dynamic';
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ plan?: string; locale?: string }> }) {
  const params = await searchParams;
  const planId = isSubscriptionPlan(params.plan) ? params.plan : 'creator';
  const viewer = await getViewer();
  const locale = isLocale(params.locale) ? params.locale : viewer.locale ?? await getRequestLocale();
  if (!viewer.userId) redirect(`/auth/choose?next=${encodeURIComponent(`/billing/subscription?plan=${planId}&locale=${locale}`)}`);
  const dict = getDictionary(locale);
  const copy = dict.creatorSubscription;
  const store = dict.appShell.store;
  const [deps, availability] = await Promise.all([getSubscriptionContext(), liveSubscriptionAvailability()]);
  const liveQa = Boolean(deps && viewer.isAdmin && deps.environment === 'live' && process.env.CREATOR_SUBSCRIPTION_LIVE_QA === 'on' && await subscriptionLiveQaReady(deps.sql));
  const available = Boolean(deps && mayEnrollSubscription(viewer, planId, availability, deps.environment, process.env, liveQa));
  return <main id="main" data-subscription-enrollment className="mx-auto min-h-screen max-w-2xl px-5 py-24 sm:px-8">
    <p className="text-sm font-semibold text-accent">TWINGS</p>
    <h1 className="mt-4 text-3xl font-semibold tracking-tight">{copy.enrollTitle}</h1>
    <p className="mt-4 text-sm leading-relaxed opacity-70">{copy.enrollBody}</p>
    {availability.status === 'paused' && <p role="status" className="mt-5 text-sm">{copy.paused}</p>}
    {/* Inside the Google Play app the payment window never opens (docs/PLATFORM-2.0.md §5.1). */}
    <StoreShellGate fallback={<StoreCheckoutNote title={store.checkoutTitle} body={store.checkoutBody} />}>
      <SubscriptionCheckout planId={planId} locale={locale} copy={copy} price={formatKrw(SUBSCRIPTION_PLANS[planId].amountKrw, locale)} consentVersion={SUBSCRIPTION_TERMS_VERSION} available={available} testMode={deps?.environment === 'test' && available} liveQa={liveQa && availability.status !== 'open'} premiumEditLimit={planId === 'premium' ? deps?.premiumEditLimit : null} />
    </StoreShellGate>
    <a href={`/${locale}/pricing#monthly`} className="mt-7 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.browsePlans}</a>
  </main>;
}
