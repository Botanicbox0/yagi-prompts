import Stripe from 'stripe';
import {
  StripeSignatureError,
  type CheckoutSessionSnapshot,
  type CreateCheckoutArgs,
  type CreatePortalArgs,
  type CreatedCheckoutSession,
  type StripeConfig,
  type StripeGateway,
  type StripeWebhookEvent,
  type SubscriptionSnapshot,
} from './stripe-gateway';

/**
 * The live half of the §3.4 boundary: the pinned `stripe` SDK (22.5.0, docs/VERSIONS.md), and the
 * only file in the repo that imports it.
 *
 * Config is passed IN rather than read from `process.env` here, for two reasons: the webhook
 * signature path is genuinely testable offline (vitest builds one of these with a test secret and
 * signs a payload with `generateTestHeaderStringAsync`), and a route that forgot to check
 * `isBillingConfigured()` cannot construct a half-configured client by accident.
 */

// The SDK pins its own API version; passing `apiVersion` would fight the type. Nothing here depends
// on a version-specific field except `current_period_end`, which is handled explicitly below.
function client(config: StripeConfig): Stripe {
  return new Stripe(config.secretKey, {
    // Identifies our traffic in the Stripe dashboard's request log.
    appInfo: { name: 'YAGI PROMPTS', url: 'https://yagiworkshop.xyz' },
    maxNetworkRetries: 2,
  });
}

/**
 * Since Stripe's 2025 billing API the period window lives on the subscription ITEM, not on the
 * subscription (verified against the pinned typings). One price per subscription in v1 (§3.4), so
 * the first item is the period.
 */
function periodEnd(subscription: Stripe.Subscription): string | null {
  const seconds = subscription.items?.data?.[0]?.current_period_end;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function snapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    currentPeriodEnd: periodEnd(subscription),
  };
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value.id;
}

/** Every event we handle nests the customer in `data.object`. Identifiers only — never state. */
function customerOf(event: Stripe.Event): string | null {
  const object = event.data?.object as { customer?: unknown } | undefined;
  const customer = object?.customer;
  if (typeof customer === 'string') return customer;
  if (customer && typeof customer === 'object' && 'id' in customer) {
    const id = (customer as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function clientReferenceOf(event: Stripe.Event): string | null {
  const object = event.data?.object as { client_reference_id?: unknown } | undefined;
  return typeof object?.client_reference_id === 'string' ? object.client_reference_id : null;
}

export function createLiveStripeGateway(config: StripeConfig): StripeGateway {
  const stripe = client(config);

  return {
    kind: 'live',

    async fetchSubscription(customerId) {
      // `status: 'all'` so a just-cancelled subscription is still reported as `canceled` rather than
      // vanishing — a disappearing row would look identical to "never subscribed" to the reconciler.
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 10,
      });
      if (list.data.length === 0) return null;
      // §3.4 duplicate-subscription policy: keep the NEWEST. (Cancelling the older one is the
      // admin runbook step, not something an entitlement read should do as a side effect.)
      const newest = [...list.data].sort((a, b) => b.created - a.created)[0]!;
      return snapshot(newest);
    },

    async retrieveCheckoutSession(sessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        return {
          id: session.id,
          customerId: idOf(session.customer),
          subscriptionId: idOf(session.subscription),
          clientReferenceId: session.client_reference_id ?? null,
          metadata: (session.metadata ?? {}) as Record<string, string>,
          status: session.status ?? null,
          paymentStatus: session.payment_status ?? null,
        } satisfies CheckoutSessionSnapshot;
      } catch (err) {
        if (err instanceof Stripe.errors.StripeInvalidRequestError) return null;
        throw err;
      }
    },

    async createCheckoutSession(args: CreateCheckoutArgs): Promise<CreatedCheckoutSession> {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: args.priceId, quantity: 1 }],
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        // The map back to a user. Set on the session AND in metadata so a webhook that arrives
        // before `/billing/success` can still resolve the buyer.
        client_reference_id: args.userId,
        metadata: args.metadata,
        subscription_data: { metadata: args.metadata },
        ...(args.customerId
          ? { customer: args.customerId }
          : args.email
            ? { customer_email: args.email }
            : {}),
        allow_promotion_codes: true,
      });
      if (!session.url) {
        throw new Error('stripe returned a checkout session with no url');
      }
      return { id: session.id, url: session.url };
    },

    async createPortalSession(args: CreatePortalArgs) {
      const session = await stripe.billingPortal.sessions.create({
        customer: args.customerId,
        return_url: args.returnUrl,
      });
      return { url: session.url };
    },

    async constructWebhookEvent(payload, signature) {
      if (!signature) throw new StripeSignatureError('missing stripe-signature header');
      let event: Stripe.Event;
      try {
        // The ASYNC form on purpose: it works with both the Node and the WebCrypto providers, so the
        // route keeps verifying correctly whichever runtime Next hands it.
        event = await stripe.webhooks.constructEventAsync(
          payload,
          signature,
          config.webhookSecret,
        );
      } catch (err) {
        throw new StripeSignatureError(
          err instanceof Error ? err.message : 'signature verification failed',
        );
      }
      return {
        id: event.id,
        type: event.type,
        created: event.created,
        customerId: customerOf(event),
        clientReferenceId: clientReferenceOf(event),
        payload: event,
      } satisfies StripeWebhookEvent;
    },
  };
}

/**
 * Test-only: sign a payload exactly the way Stripe does, so the signature path can be verified for
 * real rather than mocked. Lives here because this is the file that owns the SDK import.
 */
export async function signWebhookPayload(
  payload: string,
  secret: string,
  options: { timestamp?: number } = {},
): Promise<string> {
  const stripe = new Stripe('sk_test_offline_signing_only');
  return stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
  });
}
