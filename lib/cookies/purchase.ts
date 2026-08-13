import type { SqlRunner } from '@/lib/db/sql-runner';
import { grantPurchase, type PurchaseOutcome } from './repo';
import { PACK_COOKIES } from './wallet';

/**
 * PLAN §15.1-5 — the $4/5 pack's gateway seam, connected to NOTHING yet on purpose.
 *
 * Stripe cannot serve a KR-registered merchant (M7 execution log), so the M8 plan is a
 * merchant-of-record (Paddle-class) provider. This module is the shape that provider snaps into,
 * structured exactly like `lib/billing/stripe-gateway.ts`: one `isConfigured` question the UI
 * branches on (form when true, the designed §11 unavailable panel when false), one
 * checkout-starting call the server action makes, and one credit function the provider's webhook
 * calls — `creditCookiePack`, which is `grantPurchase` (§15.1-6 transactional, tested in
 * tests/cookies/repo.test.ts) with the pack size pinned so a webhook cannot be talked into a
 * different number.
 *
 * Until M8 supplies a gateway, `cookiePackGateway()` returns null, `isCookiePackPurchasable()`
 * is therefore false, and no surface renders a live buy button — a fact, not a dead control.
 */

export interface CookiePackGateway {
  /** Mint a hosted one-time checkout for the pack; the URL is where the buyer is sent. */
  createPackCheckout(args: {
    profileId: string;
    cookies: number;
    returnPath: string;
  }): Promise<{ url: string }>;
}

/** M8 swaps this for the MoR adapter (env-keyed, like the Stripe boundary). */
export function cookiePackGateway(): CookiePackGateway | null {
  return null;
}

export function isCookiePackPurchasable(): boolean {
  return cookiePackGateway() !== null;
}

export type PackPurchaseStart =
  /** No gateway connected (§11/§15.1-5) — the caller renders the designed unavailable state. */
  | { status: 'unavailable' }
  /** M8: the hosted checkout the MoR minted. */
  | { status: 'redirect'; url: string };

/** What the purchase server action calls; today it can only answer honestly. */
export async function startCookiePackPurchase(
  profileId: string,
  returnPath: string,
): Promise<PackPurchaseStart> {
  const gateway = cookiePackGateway();
  if (gateway === null) return { status: 'unavailable' };
  const { url } = await gateway.createPackCheckout({
    profileId,
    cookies: PACK_COOKIES,
    returnPath,
  });
  return { status: 'redirect', url };
}

/**
 * The M8 webhook's one write: always the pack size, never a caller-supplied count — and always
 * under the PROVIDER'S event id, so a redelivered webhook answers 'duplicate' instead of crediting
 * one payment twice (M10 review R1, finding 2).
 */
export async function creditCookiePack(
  sql: SqlRunner,
  profileId: string,
  providerEventId: string,
): Promise<PurchaseOutcome> {
  return grantPurchase(sql, profileId, PACK_COOKIES, providerEventId);
}
