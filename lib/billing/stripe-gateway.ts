/**
 * PLAN §3.4 / §7 — the ONE boundary every Stripe call crosses.
 *
 * Why a boundary at all: there are no Stripe keys on this machine (execution reality, M3 brief), so
 * an implementation that reached for the SDK inline would be untestable and unrunnable here. This
 * interface is the seam instead — a live implementation wraps the pinned `stripe` SDK
 * (`lib/billing/stripe-live.ts`), a deterministic fake drives vitest and local flow-walking
 * (`lib/billing/stripe-fake.ts`), and `lib/billing/gateway.ts` picks one.
 *
 * The interface is deliberately NARROW. It speaks in plain snapshots, not Stripe objects, so that:
 *   · the reconciler can never accidentally trust an event payload as state — the only way to learn
 *     the current subscription is `fetchSubscription(customerId)`, which is a *fetch* by name;
 *   · nothing downstream has to know a Stripe type, so the SDK version stays a detail of one file.
 *
 * Types only, plus env plumbing. No `server-only` guard: tests import this directly.
 */

// ---------------------------------------------------------------------------
// snapshots
// ---------------------------------------------------------------------------

/** Current truth for one customer's subscription, as of `fetchSubscription`. */
export interface SubscriptionSnapshot {
  subscriptionId: string;
  /** Stripe status verbatim (§6): active | past_due | canceled | incomplete | trialing | … */
  status: string;
  cancelAtPeriodEnd: boolean;
  /** ISO-8601, or null when Stripe reports none. */
  currentPeriodEnd: string | null;
}

/** What `/billing/success` needs from a completed Checkout Session. */
export interface CheckoutSessionSnapshot {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  /** We always set this to the buyer's `profiles.id` — it is how a session maps back to a user. */
  clientReferenceId: string | null;
  /** `{ origin slug, locale }` per §3.4, plus the user id for defence in depth. */
  metadata: Record<string, string>;
  /** 'complete' | 'open' | 'expired' — Stripe's own vocabulary. */
  status: string | null;
  /** 'paid' | 'unpaid' | 'no_payment_required'. */
  paymentStatus: string | null;
}

export interface CreateCheckoutArgs {
  userId: string;
  email: string | null;
  /** Reuse the customer when we already know it — otherwise Stripe creates one. */
  customerId: string | null;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** §3.4: origin slug + locale ride in metadata so the return trip lands where it started. */
  metadata: Record<string, string>;
}

export interface CreatedCheckoutSession {
  id: string;
  url: string;
}

export interface CreatePortalArgs {
  customerId: string;
  returnUrl: string;
}

/**
 * A verified webhook event, flattened.
 *
 * `customerId` is extracted here rather than downstream because every event type nests it
 * differently — and because it is the ONLY thing we take from a payload. Everything else about the
 * subscription is re-fetched (§3.4: "webhooks are triggers only").
 */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  /** Unix seconds, as Stripe sends it. */
  created: number;
  customerId: string | null;
  /**
   * `checkout.session.completed` only: the `profiles.id` we set at checkout creation. It closes the
   * customer↔user mapping without waiting for `/billing/success`, so a webhook that overtakes the
   * browser still reconciles the right user. Like `customerId` this is an IDENTIFIER, not state.
   */
  clientReferenceId: string | null;
  /** The raw event, stored verbatim in `stripe_events.payload` for forensics. */
  payload: unknown;
}

/** Thrown by `constructWebhookEvent` for a missing, malformed or forged signature. */
export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

// ---------------------------------------------------------------------------
// the gateway
// ---------------------------------------------------------------------------

export interface StripeGateway {
  /** Which implementation answered — surfaced in `/account` diagnostics and the retry script. */
  readonly kind: 'live' | 'fake';
  /**
   * Current truth for a customer. `null` = Stripe knows of no subscription at all, which is a
   * real answer (a customer who never completed checkout, or whose subscription was purged).
   * Implementations pick the NEWEST when several exist (§3.4 duplicate-subscription policy).
   */
  fetchSubscription(customerId: string): Promise<SubscriptionSnapshot | null>;
  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionSnapshot | null>;
  createCheckoutSession(args: CreateCheckoutArgs): Promise<CreatedCheckoutSession>;
  createPortalSession(args: CreatePortalArgs): Promise<{ url: string }>;
  /** Verifies the signature and flattens the event. Throws `StripeSignatureError` on failure. */
  constructWebhookEvent(payload: string, signature: string | null): Promise<StripeWebhookEvent>;
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  pricePro: string;
}

/** `.env.example` ships `sk_test_...`-style placeholders; a copied-but-unfilled env is NOT configured. */
function filled(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 12) return false;
  return !trimmed.endsWith('...') && !trimmed.startsWith('YOUR-');
}

/**
 * Read the live configuration, or `null` when any part of it is missing.
 *
 * Fails CLOSED in the only direction that matters: with no config there is no live gateway, so
 * checkout and portal degrade to the designed "billing not connected" state (§ M3 brief) instead of
 * crashing — and no code path can mistake an unconfigured deployment for a working one.
 */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const pricePro = env.STRIPE_PRICE_PRO;
  if (!filled(secretKey) || !filled(webhookSecret) || !filled(pricePro)) return null;
  return { secretKey, webhookSecret, pricePro };
}

export function isBillingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return stripeConfigFromEnv(env) !== null || fakeBillingEnabled(env);
}

/**
 * DEV-ONLY escape hatch so the whole lock → checkout → unlock loop is walkable on a machine with no
 * Stripe account (which is this one, and the Director's).
 *
 * Two independent conditions, both required:
 *   · `NODE_ENV !== 'production'` — `next build` inlines `'production'` here, so in a production
 *     bundle this function is dead code that returns false;
 *   · an explicit `PLAYBOOK_FAKE_BILLING=1`, set only by `scripts/dev-as.ts`.
 * A real `STRIPE_SECRET_KEY` always wins (see `lib/billing/gateway.ts`).
 */
export function fakeBillingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return env.PLAYBOOK_FAKE_BILLING === '1';
}
