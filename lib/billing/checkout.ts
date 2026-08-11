import type { Locale } from '@/lib/i18n/config';
import { isEntitled } from './entitlement';
import { checkoutReturnUrls, originPath } from './links';
import {
  loadSubscription,
  reconcileSubscription,
  stripeCustomerIdFor,
  type ReconcileDeps,
} from './reconcile';

/**
 * PLAN §3.4 — Checkout creation, **server-guarded**.
 *
 * "Duplicate-subscription policy: checkout creation is server-guarded (already-entitled users get
 * the portal, not a new checkout)."
 *
 * The guard is not a read of a possibly-stale mirror. If the profile is already linked to a Stripe
 * customer we RECONCILE first — one API call, the same fenced write as everywhere else — and only
 * then decide. So the decision is made against current truth, which is the only way it can actually
 * prevent a second subscription rather than merely usually preventing one.
 */

export interface CheckoutOrigin {
  /** The playbook the reader was on, or null (pricing page / library). */
  slug: string | null;
  locale: Locale;
}

export interface CheckoutDeps extends ReconcileDeps {
  priceId: string;
  /** Absolute origin for Stripe's return URLs, e.g. `https://playbook.example`. */
  appOrigin: string;
}

export interface CheckoutRequest {
  userId: string;
  email: string | null;
  origin: CheckoutOrigin;
}

export type CheckoutStart =
  /** Go to Stripe. */
  | { status: 'checkout'; url: string; sessionId: string }
  /** Already entitled — the portal is where a subscriber changes anything (§3.4 "cancel anytime"). */
  | { status: 'portal'; url: string }
  /** Entitled but with no Stripe customer to open a portal for (fixture/manual rows). */
  | { status: 'already_pro'; returnTo: string };

export async function startCheckout(
  deps: CheckoutDeps,
  request: CheckoutRequest,
): Promise<CheckoutStart> {
  const { sql, gateway } = deps;
  const returnTo = originPath(request.origin);
  const accountUrl = `${deps.appOrigin.replace(/\/$/, '')}/account`;

  const customerId = await stripeCustomerIdFor(sql, request.userId);
  if (customerId !== null) {
    // Current truth before the decision — this is what makes the guard real.
    await reconcileSubscription(deps, request.userId);
    const subscription = await loadSubscription(sql, request.userId);
    if (subscription !== null && isEntitled(subscription.status)) {
      const portal = await gateway.createPortalSession({ customerId, returnUrl: accountUrl });
      return { status: 'portal', url: portal.url };
    }
  } else {
    const subscription = await loadSubscription(sql, request.userId);
    // A subscription row with no linked customer is a seeded/manual fixture: entitled, but there is
    // nothing to open a portal against. Sending them to Stripe would create a SECOND subscription.
    if (subscription !== null && isEntitled(subscription.status)) {
      return { status: 'already_pro', returnTo };
    }
  }

  const { successUrl, cancelUrl } = checkoutReturnUrls(deps.appOrigin, request.origin);
  const session = await gateway.createCheckoutSession({
    userId: request.userId,
    email: request.email,
    customerId,
    priceId: deps.priceId,
    successUrl,
    cancelUrl,
    // §3.4: "origin slug + locale in metadata". `userId` rides along too so a webhook that arrives
    // before the browser returns can still resolve the buyer.
    metadata: {
      userId: request.userId,
      locale: request.origin.locale,
      ...(request.origin.slug === null ? {} : { slug: request.origin.slug }),
    },
  });

  return { status: 'checkout', url: session.url, sessionId: session.id };
}

export type PortalStart =
  | { status: 'portal'; url: string }
  /** Never linked to Stripe — there is no portal to open. */
  | { status: 'no_customer' };

export async function startPortal(
  deps: Pick<CheckoutDeps, 'sql' | 'gateway' | 'appOrigin'>,
  userId: string,
): Promise<PortalStart> {
  const customerId = await stripeCustomerIdFor(deps.sql, userId);
  if (customerId === null) return { status: 'no_customer' };
  const portal = await deps.gateway.createPortalSession({
    customerId,
    returnUrl: `${deps.appOrigin.replace(/\/$/, '')}/account`,
  });
  return { status: 'portal', url: portal.url };
}
