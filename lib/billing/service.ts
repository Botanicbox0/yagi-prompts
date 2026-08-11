import 'server-only';
import { getSqlRunner } from '@/lib/db/connect';
import type { CheckoutDeps } from './checkout';
import { createFakeStripeGateway } from './stripe-fake';
import { createLiveStripeGateway } from './stripe-live';
import {
  fakeBillingEnabled,
  stripeConfigFromEnv,
  type StripeGateway,
} from './stripe-gateway';

/**
 * Resolve the two dependencies every billing operation needs — a `SqlRunner` and a `StripeGateway`
 * — exactly the way `lib/content/facade.ts` resolves its own.
 *
 * Resolution order, and each answer's meaning:
 *   1. real `STRIPE_*` config           → the live gateway. Always wins.
 *   2. `PLAYBOOK_FAKE_BILLING=1` (dev)  → the deterministic fake, so the lock → checkout → unlock
 *                                         loop is walkable and render-verifiable on a machine with
 *                                         no Stripe account. Impossible in a production build (see
 *                                         `fakeBillingEnabled`).
 *   3. neither                          → `null`. Every caller then renders the designed
 *                                         "billing not connected" state instead of crashing.
 *
 * `null` is a first-class answer here for the same reason it is in `lib/db/connect.ts`: an
 * unconfigured deployment must degrade honestly, never throw a 500 at a paying customer's CTA.
 */

const FAKE_PRICE_ID = 'price_fake_pro_monthly';

/**
 * On `globalThis` for the same reason as `lib/db/connect.ts`: `next dev` gives each route its own
 * module registry, and a per-route fake gateway would forget the Checkout Session that
 * `/api/billing/checkout` just created before `/billing/success` could retrieve it — making the
 * local flow-walk unusable. Production is unaffected.
 */
interface GatewayCache {
  gateway: StripeGateway | null;
  key: string | null;
}

const cache: GatewayCache = (((globalThis as Record<string, unknown>).__playbookStripeGateway ??= {
  gateway: null,
  key: null,
}) as GatewayCache);

function gatewayKey(): string | null {
  const config = stripeConfigFromEnv();
  if (config !== null) return `live:${config.pricePro}`;
  if (fakeBillingEnabled()) return 'fake';
  return null;
}

/** Memoised per process — the live client keeps an agent pool, the fake keeps dev state. */
export function getStripeGateway(): StripeGateway | null {
  const key = gatewayKey();
  if (key === null) {
    cache.gateway = null;
    cache.key = null;
    return null;
  }
  if (cache.gateway !== null && cache.key === key) return cache.gateway;

  const config = stripeConfigFromEnv();
  cache.gateway =
    config !== null
      ? createLiveStripeGateway(config)
      : // autoComplete: the dev loop has no hosted page to click through, so a created session is
        // already paid by the time `/billing/success` reads it.
        createFakeStripeGateway({ autoComplete: true });
  cache.key = key;
  return cache.gateway;
}

export function billingPriceId(): string {
  return stripeConfigFromEnv()?.pricePro ?? FAKE_PRICE_ID;
}

/**
 * The absolute origin Stripe should return to.
 *
 * Prefers the actual request (correct on every preview deployment without configuration) and falls
 * back to `NEXT_PUBLIC_APP_URL` for callers with no request in hand.
 */
export function appOrigin(request?: Request): string {
  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      // fall through
    }
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.startsWith('http')) return configured.replace(/\/$/, '');
  return 'http://localhost:3000';
}

export type BillingContext = CheckoutDeps;

/** `null` when either half is missing: no database, or no Stripe. */
export async function getBillingContext(request?: Request): Promise<BillingContext | null> {
  const gateway = getStripeGateway();
  if (gateway === null) return null;
  const sql = await getSqlRunner();
  if (sql === null) return null;
  return { sql, gateway, priceId: billingPriceId(), appOrigin: appOrigin(request) };
}
