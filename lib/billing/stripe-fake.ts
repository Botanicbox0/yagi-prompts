import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  StripeSignatureError,
  type CheckoutSessionSnapshot,
  type CreateCheckoutArgs,
  type CreatePortalArgs,
  type StripeGateway,
  type StripeWebhookEvent,
  type SubscriptionSnapshot,
} from './stripe-gateway';

/**
 * The deterministic half of the §3.4 boundary.
 *
 * It exists because M3's acceptance criteria are all about ORDERING — fencing races, replayed
 * events, an out-of-order webhook landing after the success route already reconciled. Those are
 * only testable if "what Stripe currently says" is a value a test can set and change between two
 * interleaved reconciles. A network mock could not express that; this can.
 *
 * It also drives local flow-walking (`npm run dev:free`, see `scripts/dev-as.ts`), which is the
 * only way to render-verify lock → checkout → unlock on a machine with no Stripe account. That path
 * is fenced off from production twice over — see `fakeBillingEnabled()` in `stripe-gateway.ts`.
 *
 * Ids are deterministic (`cus_fake_1`, `sub_fake_1`, …) so a failing test names the same object on
 * every run.
 */

export interface FakeStripeOptions {
  /**
   * Local dev: a created session is already complete, so `/billing/success` unlocks immediately and
   * the whole loop is walkable with no hosted page. Tests leave this false and call
   * `completeCheckout()` explicitly, which is what makes ordering testable.
   */
  autoComplete?: boolean;
  /** Where a created checkout session sends the browser. `{CHECKOUT_SESSION_ID}` is substituted. */
  webhookSecret?: string;
}

export interface FakeStripeGateway extends StripeGateway {
  readonly kind: 'fake';
  /** Set (or overwrite) the current truth for a customer. Returns the snapshot Stripe will report. */
  setSubscription(customerId: string, patch?: Partial<SubscriptionSnapshot>): SubscriptionSnapshot;
  /** Stripe forgets the customer's subscriptions entirely (the `null` answer). */
  clearSubscription(customerId: string): void;
  /** Drive the hosted-page step a test cannot click: the session completes and the sub goes live. */
  completeCheckout(sessionId: string): CheckoutSessionSnapshot;
  /** Build a signed webhook body for the ledger tests (no signature semantics — see stripe-live). */
  signedEvent(event: {
    id: string;
    type: string;
    customerId: string | null;
    clientReferenceId?: string | null;
    created?: number;
  }): { body: string; signature: string };
  /** How many times the reconciler asked Stripe for truth — the fetch fence's observable input. */
  fetchCount(customerId?: string): number;
  /** Injectable latency, so two reconciles can be interleaved deterministically. */
  beforeFetch: ((customerId: string) => void | Promise<void>) | null;
  /** Make the next call of any kind throw — the "handler failed, ledger stays NULL" path. */
  failNext(error?: Error): void;
}

const FAKE_WEBHOOK_SECRET = 'whsec_fake_deterministic';

export function createFakeStripeGateway(options: FakeStripeOptions = {}): FakeStripeGateway {
  const subscriptions = new Map<string, SubscriptionSnapshot>();
  const sessions = new Map<string, CheckoutSessionSnapshot>();
  const fetches: string[] = [];
  const secret = options.webhookSecret ?? FAKE_WEBHOOK_SECRET;
  let counter = 0;
  let pendingFailure: Error | null = null;

  const nextId = (prefix: string) => `${prefix}_fake_${(counter += 1)}`;

  function throwIfArmed(): void {
    if (pendingFailure === null) return;
    const err = pendingFailure;
    pendingFailure = null;
    throw err;
  }

  const gateway: FakeStripeGateway = {
    kind: 'fake',
    beforeFetch: null,

    setSubscription(customerId, patch = {}) {
      const existing = subscriptions.get(customerId);
      const snapshot: SubscriptionSnapshot = {
        subscriptionId: patch.subscriptionId ?? existing?.subscriptionId ?? nextId('sub'),
        status: patch.status ?? existing?.status ?? 'active',
        cancelAtPeriodEnd: patch.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
        currentPeriodEnd:
          patch.currentPeriodEnd ??
          existing?.currentPeriodEnd ??
          new Date(Date.UTC(2026, 8, 12)).toISOString(),
      };
      subscriptions.set(customerId, snapshot);
      return snapshot;
    },

    clearSubscription(customerId) {
      subscriptions.delete(customerId);
    },

    completeCheckout(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`fake stripe: unknown checkout session ${sessionId}`);
      const customerId = session.customerId ?? nextId('cus');
      const subscription = gateway.setSubscription(customerId, { status: 'active' });
      const completed: CheckoutSessionSnapshot = {
        ...session,
        customerId,
        subscriptionId: subscription.subscriptionId,
        status: 'complete',
        paymentStatus: 'paid',
      };
      sessions.set(sessionId, completed);
      return completed;
    },

    fetchCount(customerId) {
      return customerId === undefined
        ? fetches.length
        : fetches.filter((id) => id === customerId).length;
    },

    failNext(error = new Error('fake stripe: injected failure')) {
      pendingFailure = error;
    },

    signedEvent(event) {
      const created = event.created ?? Math.floor(Date.UTC(2026, 7, 12) / 1000);
      const body = JSON.stringify({
        id: event.id,
        type: event.type,
        created,
        data: {
          object: {
            customer: event.customerId,
            client_reference_id: event.clientReferenceId ?? null,
          },
        },
      });
      const timestamp = created;
      const signature = createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
      return { body, signature: `t=${timestamp},v1=${signature}` };
    },

    async fetchSubscription(customerId) {
      throwIfArmed();
      if (gateway.beforeFetch) await gateway.beforeFetch(customerId);
      fetches.push(customerId);
      return subscriptions.get(customerId) ?? null;
    },

    async retrieveCheckoutSession(sessionId) {
      throwIfArmed();
      return sessions.get(sessionId) ?? null;
    },

    async createCheckoutSession(args: CreateCheckoutArgs) {
      throwIfArmed();
      const id = nextId('cs');
      const session: CheckoutSessionSnapshot = {
        id,
        customerId: args.customerId,
        subscriptionId: null,
        clientReferenceId: args.userId,
        metadata: args.metadata,
        status: 'open',
        paymentStatus: 'unpaid',
      };
      sessions.set(id, session);
      if (options.autoComplete === true) gateway.completeCheckout(id);
      // Stripe substitutes this placeholder in the real hosted flow; so does the fake, so the
      // caller's URL contract is identical against either implementation.
      return { id, url: args.successUrl.replace('{CHECKOUT_SESSION_ID}', id) };
    },

    async createPortalSession(args: CreatePortalArgs) {
      throwIfArmed();
      const url = new URL(args.returnUrl);
      url.searchParams.set('portal', 'fake');
      return { url: url.toString() };
    },

    async constructWebhookEvent(payload, signature): Promise<StripeWebhookEvent> {
      if (!signature) throw new StripeSignatureError('missing stripe-signature header');
      const timestamp = /t=(\d+)/.exec(signature)?.[1];
      const provided = /v1=([0-9a-f]+)/.exec(signature)?.[1];
      if (!timestamp || !provided) throw new StripeSignatureError('malformed stripe-signature');
      const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
      const a = Buffer.from(provided, 'hex');
      const b = Buffer.from(expected, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new StripeSignatureError('no signatures found matching the expected signature');
      }

      let parsed: { id?: unknown; type?: unknown; created?: unknown; data?: unknown };
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new StripeSignatureError('payload is not json');
      }
      const object = (
        parsed.data as { object?: { customer?: unknown; client_reference_id?: unknown } } | undefined
      )?.object;
      return {
        id: String(parsed.id ?? ''),
        type: String(parsed.type ?? ''),
        created: typeof parsed.created === 'number' ? parsed.created : 0,
        customerId: typeof object?.customer === 'string' ? object.customer : null,
        clientReferenceId:
          typeof object?.client_reference_id === 'string' ? object.client_reference_id : null,
        payload: parsed,
      };
    },
  };

  return gateway;
}
