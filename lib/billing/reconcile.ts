import type { SqlRunner } from '@/lib/db/sql-runner';
import { ENTITLED_STATUSES, isEntitled } from './entitlement';
import type { StripeGateway, SubscriptionSnapshot } from './stripe-gateway';

/**
 * PLAN §3.4 — `reconcileSubscription(userId)`, the ONE writer of `subscriptions`.
 *
 *   1. Fetch CURRENT truth from Stripe (never trust an event payload as state). Record `t`.
 *   2. One atomic upsert of `subscriptions` + the `profiles.plan` mirror, guarded by a fence:
 *      the write applies only if `stripe_fetched_at IS NULL OR stripe_fetched_at < t`.
 *
 * Callers: `/billing/success`, every webhook, the retry sweep, and (M4) an admin action. Because
 * every one of them re-fetches, they are interchangeable and ORDER-INDEPENDENT — which is the whole
 * point: a webhook that overtakes the success route cannot regress the state it finds.
 *
 * Two decisions worth naming:
 *
 * · **`t` is stamped BEFORE the API call**, not after. A fetch that started earlier cannot have
 *   seen newer truth than one that started later, so stamping at the start makes a slow in-flight
 *   request lose to a fast newer one — the safe direction. Stamping on return would let a straggler
 *   win with stale data.
 *
 * · **The fence lives in the SQL**, in the `ON CONFLICT … DO UPDATE … WHERE` clause, so it is one
 *   statement and therefore atomic without an explicit transaction. There is no read-then-write
 *   window for a concurrent reconcile to slip through, and no row lock to hold. A missing row is
 *   created by the same upsert (§3.4: "no lock-on-missing-row; interleavings converge").
 */

export interface ReconcileDeps {
  sql: SqlRunner;
  gateway: StripeGateway;
  /** Injectable clock — the fence is a timestamp comparison and the tests drive it directly. */
  now?: () => Date;
}

export type ReconcileOutcome =
  /** The fence accepted this fetch: `subscriptions` + `profiles.plan` now reflect it. */
  | { status: 'applied'; entitled: boolean; snapshot: SubscriptionSnapshot; fetchedAt: string }
  /** A newer fetch already landed. Nothing was written, and that is success, not failure. */
  | { status: 'stale'; entitled: boolean; snapshot: SubscriptionSnapshot; fetchedAt: string }
  /** Stripe reports no subscription at all for this customer. Any existing row is cancelled. */
  | { status: 'absent'; entitled: false; applied: boolean; fetchedAt: string }
  /** The profile has never been linked to a Stripe customer — nothing to reconcile yet. */
  | { status: 'no_customer'; entitled: false };

export async function stripeCustomerIdFor(
  sql: SqlRunner,
  userId: string,
): Promise<string | null> {
  const { rows } = await sql.query<{ stripe_customer_id: string | null }>(
    'select stripe_customer_id from profiles where id = $1',
    [userId],
  );
  return rows[0]?.stripe_customer_id ?? null;
}

/** The reverse map, used by the webhook route: a Stripe customer → our user. */
export async function userIdForStripeCustomer(
  sql: SqlRunner,
  customerId: string,
): Promise<string | null> {
  const { rows } = await sql.query<{ id: string }>(
    'select id from profiles where stripe_customer_id = $1',
    [customerId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Record the customer id learned from a completed Checkout Session.
 *
 * Idempotent and non-destructive: it only fills a NULL. A profile already pointing at a different
 * customer is left alone and reported, because silently repointing it would orphan a live
 * subscription — that is an admin runbook case (§3.4 duplicate-subscription policy), not something
 * a request handler should decide.
 */
export async function linkStripeCustomer(
  sql: SqlRunner,
  userId: string,
  customerId: string,
): Promise<'linked' | 'already' | 'conflict'> {
  const { rows } = await sql.query<{ stripe_customer_id: string | null }>(
    `update profiles set stripe_customer_id = $2
      where id = $1 and stripe_customer_id is null
      returning stripe_customer_id`,
    [userId, customerId],
  );
  if (rows.length > 0) return 'linked';
  const current = await stripeCustomerIdFor(sql, userId);
  return current === customerId ? 'already' : 'conflict';
}

// ---------------------------------------------------------------------------
// the fenced write
// ---------------------------------------------------------------------------

/**
 * The entitled set, inlined as SQL literals rather than bound as a `text[]` parameter.
 *
 * Two reasons: array parameter serialisation differs between the `pg` driver and PGlite, and this
 * keeps the query byte-identical on both; and the values are our own compile-time constants, so
 * there is nothing user-supplied to inject.
 */
const ENTITLED_SQL_LIST = ENTITLED_STATUSES.map((status) => `'${status}'`).join(', ');

/**
 * One statement, therefore one transaction. `fenced` performs the guarded upsert; `mirror` writes
 * `profiles.plan` from the row `fenced` actually wrote, so the mirror can never disagree with the
 * truth — and when the fence rejects the write, `fenced` returns no rows and the mirror is a no-op.
 */
const FENCED_UPSERT = `
with fenced as (
  insert into subscriptions
    (user_id, stripe_subscription_id, status, cancel_at_period_end, current_period_end,
     stripe_fetched_at)
  values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
  on conflict (user_id) do update
     set stripe_subscription_id = excluded.stripe_subscription_id,
         status                 = excluded.status,
         cancel_at_period_end   = excluded.cancel_at_period_end,
         current_period_end     = excluded.current_period_end,
         stripe_fetched_at      = excluded.stripe_fetched_at
   where subscriptions.stripe_fetched_at is null
      or subscriptions.stripe_fetched_at < excluded.stripe_fetched_at
  returning user_id, status
),
mirror as (
  update profiles p
     set plan = case when f.status in (${ENTITLED_SQL_LIST}) then 'pro' else 'free' end
    from fenced f
   where p.id = f.user_id
  returning p.id
)
select count(*)::int as applied from fenced
`;

/** The same fence, for the case where Stripe reports nothing: cancel what we have, mirror to free. */
const FENCED_ABSENT = `
with fenced as (
  update subscriptions
     set status = 'canceled',
         cancel_at_period_end = false,
         stripe_fetched_at = $2::timestamptz
   where user_id = $1
     and (stripe_fetched_at is null or stripe_fetched_at < $2::timestamptz)
  returning user_id
),
mirror as (
  update profiles p
     set plan = 'free'
    from fenced f
   where p.id = f.user_id
  returning p.id
)
select count(*)::int as applied from fenced
`;

async function applied(sql: SqlRunner, text: string, params: unknown[]): Promise<boolean> {
  const { rows } = await sql.query<{ applied: number | string }>(text, params);
  return Number(rows[0]?.applied ?? 0) > 0;
}

export async function reconcileSubscription(
  deps: ReconcileDeps,
  userId: string,
): Promise<ReconcileOutcome> {
  const { sql, gateway } = deps;
  const clock = deps.now ?? (() => new Date());

  const customerId = await stripeCustomerIdFor(sql, userId);
  if (customerId === null) return { status: 'no_customer', entitled: false };

  // Stamped before the call — see the header note on why the direction matters.
  const fetchedAt = clock().toISOString();
  const snapshot = await gateway.fetchSubscription(customerId);

  if (snapshot === null) {
    const wrote = await applied(sql, FENCED_ABSENT, [userId, fetchedAt]);
    return { status: 'absent', entitled: false, applied: wrote, fetchedAt };
  }

  const wrote = await applied(sql, FENCED_UPSERT, [
    userId,
    snapshot.subscriptionId,
    snapshot.status,
    snapshot.cancelAtPeriodEnd,
    snapshot.currentPeriodEnd,
    fetchedAt,
  ]);

  return {
    status: wrote ? 'applied' : 'stale',
    entitled: isEntitled(snapshot.status),
    snapshot,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// read model
// ---------------------------------------------------------------------------

export interface SubscriptionRecord {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeFetchedAt: string;
  entitled: boolean;
}

/** What `/account` renders: the stored row, with entitlement derived (never read from the mirror). */
export async function loadSubscription(
  sql: SqlRunner,
  userId: string,
): Promise<SubscriptionRecord | null> {
  const { rows } = await sql.query<{
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: string | Date | null;
    stripe_fetched_at: string | Date;
  }>(
    `select status, cancel_at_period_end, current_period_end, stripe_fetched_at
       from subscriptions where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const iso = (value: string | Date | null) =>
    value === null ? null : value instanceof Date ? value.toISOString() : value;
  return {
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    currentPeriodEnd: iso(row.current_period_end),
    stripeFetchedAt: iso(row.stripe_fetched_at) as string,
    entitled: isEntitled(row.status),
  };
}
