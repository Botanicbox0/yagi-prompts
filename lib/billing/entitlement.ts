/**
 * PLAN §3.4 — **the** entitlement definition, in one file, with no dependencies.
 *
 *   Pro iff `subscriptions.status IN ('active','past_due')`
 *
 * Stripe owns the retry window, so `past_due` is still entitled; `canceled` is not.
 * `cancel_at_period_end = true` changes nothing on its own — the row stays `active` until Stripe
 * transitions it, which is what the `customer.subscription.deleted` event reports. No clock
 * arithmetic anywhere: the only authority on "has the period closed" is Stripe's own status.
 *
 * `profiles.plan` is a DISPLAY MIRROR written in the same transaction as the subscription row
 * (`lib/billing/reconcile.ts`). Nothing gates on it — every gate reads `subscriptions.status`
 * through `isEntitled` below, including `lib/auth/viewer.ts`.
 *
 * Deliberately dependency-free (no `server-only`, no db, no env) so the one definition is
 * importable from the viewer, the reconciler, the account page and the tests alike.
 */

export const ENTITLED_STATUSES = ['active', 'past_due'] as const;
export type EntitledStatus = (typeof ENTITLED_STATUSES)[number];

/** The display mirror's two values (`profiles.plan` CHECK). */
export type PlanMirror = 'free' | 'pro';

export function isEntitled(status: string | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  return (ENTITLED_STATUSES as readonly string[]).includes(status);
}

/** The mirror value implied by a Stripe status — derived, never stored independently. */
export function planFor(status: string | null | undefined): PlanMirror {
  return isEntitled(status) ? 'pro' : 'free';
}
