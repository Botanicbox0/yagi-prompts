/**
 * PLAN §15 — the cookie economy's numbers and pure decisions, in one dependency-free module.
 *
 * Same reason `lib/billing/links.ts` and `lib/contests/phase.ts` are pure: the detail page, the
 * account page, the pricing copy and the tests all have to agree on what a cookie is worth, and a
 * constant that lived inside a server module could not be asserted from a UI test.
 */

/** §15.1-2 — what a new account starts with. The DB default on `profiles.cookie_balance` is the
 *  enforcement; this constant is what everything above the database says about it. */
export const SIGNUP_COOKIES = 3;

/** §15.1-3 — the weekly grant. */
export const WEEKLY_COOKIES = 1;

/** §15.1-1 — one prompt, one cookie. */
export const UNLOCK_COST = 1;

/** §15.1-5 — the $4 one-time pack. NOT a subscription; the M8 MoR webhook credits it. */
export const PACK_PRICE_USD = 4;
export const PACK_COOKIES = 5;

/**
 * The grant window as a SQL interval literal. The DATABASE clock decides whether a week has passed
 * (the contests lesson: an app-clock comparison drifts from the `now()` that stamps the row), so
 * this string is interpolated into the one locked SELECT in `lib/cookies/repo.ts` and nowhere else.
 */
export const WEEKLY_INTERVAL = '7 days';

// ---------------------------------------------------------------------------
// the §15.3 lock-panel funnel
// ---------------------------------------------------------------------------

/**
 * What the locked prompt page offers, as a pure function of (identity × wallet):
 *
 *   'signin'  anonymous — the funnel starts at Google and returns to this prompt;
 *   'spend'   signed in with a cookie — one press unlocks the prompt forever;
 *   'empty'   signed in at zero — the wallet panel: the weekly line and the $4/5 pack.
 *
 * A `null` balance for a signed-in viewer means the wallet could not be read (no profile row, no
 * database). That reader is shown 'empty' rather than a spend button that would refuse them:
 * fail closed, never a control that lies about being available.
 */
export type UnlockPanel =
  | { state: 'signin' }
  | { state: 'spend'; balance: number }
  | { state: 'empty' };

export function decideUnlockPanel(userId: string | null, balance: number | null): UnlockPanel {
  if (userId === null) return { state: 'signin' };
  if (balance !== null && balance >= UNLOCK_COST) return { state: 'spend', balance };
  return { state: 'empty' };
}
