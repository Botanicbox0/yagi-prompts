import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { reconcileSubscription, linkStripeCustomer, loadSubscription } from '@/lib/billing/reconcile';
import { createFakeStripeGateway, type FakeStripeGateway } from '@/lib/billing/stripe-fake';
import { resolveViewer, sqlIdentitySource } from '@/lib/auth/identity';
import { billingDb, readState, seedProfile, CUSTOMER, T, USER, type BillingHarness } from '../helpers/billing';

/**
 * PLAN §3.4 / §8 M3 — `reconcileSubscription` against a REAL Postgres (PGlite), with Stripe's
 * answers supplied by the deterministic fake.
 *
 * The subject is the FENCE. Everything below is an ordering question: which of two fetches wins,
 * what happens when a write arrives out of order, and whether the `profiles.plan` mirror can ever
 * disagree with the `subscriptions` row it was written beside.
 */
describe('reconcileSubscription — fetch-time fencing (§3.4)', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;
  let gateway: FakeStripeGateway;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql.query('delete from subscriptions');
    gateway = createFakeStripeGateway();
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer });
  });

  const at = (iso: string) => ({ sql, gateway, now: () => new Date(iso) });

  it('creates the missing row on the first reconcile, mirror included', async () => {
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });

    expect(await loadSubscription(sql, USER.buyer)).toBeNull();
    const result = await reconcileSubscription(at(T.middle), USER.buyer);

    expect(result.status).toBe('applied');
    expect(result.entitled).toBe(true);
    const state = await readState(sql, USER.buyer);
    expect(state?.status).toBe('active');
    expect(state?.stripe_subscription_id).toBe('sub_1');
    // "profiles.plan is a display mirror updated in the same write" — one statement, so it cannot lag.
    expect(state?.plan).toBe('pro');
  });

  it('does nothing at all when the profile was never linked to Stripe', async () => {
    await seedProfile(sql, { id: USER.other, customerId: null });
    const result = await reconcileSubscription(at(T.middle), USER.other);
    expect(result.status).toBe('no_customer');
    expect(gateway.fetchCount()).toBe(0);
    expect(await loadSubscription(sql, USER.other)).toBeNull();
  });

  /**
   * §8 M3's fencing acceptance, stated as an interleaving rather than as two sequential calls:
   * reconcile A starts FIRST (older `t`) but is still in flight when B starts, fetches and writes.
   * A must then lose — and the state must be B's, not a merge of the two.
   */
  it('rejects an in-flight OLD fetch that lands after a newer one', async () => {
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'incomplete' });

    let releaseA: () => void = () => {};
    const aReachedStripe = new Promise<void>((resolve) => {
      gateway.beforeFetch = async () => {
        gateway.beforeFetch = null;
        resolve();
        await new Promise<void>((release) => {
          releaseA = release;
        });
      };
    });

    // A: the older fetch. It blocks inside the gateway, holding the answer Stripe gave it.
    const a = reconcileSubscription(at(T.early), USER.buyer);
    await aReachedStripe;

    // B: a newer fetch, start to finish, while A is still holding a stale answer.
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    const bResult = await reconcileSubscription(at(T.late), USER.buyer);
    expect(bResult.status).toBe('applied');

    releaseA();
    const aResult = await a;

    expect(aResult.status).toBe('stale');
    const state = await readState(sql, USER.buyer);
    expect(state?.status).toBe('active');
    expect(state?.stripe_fetched_at).toContain('10:00:10');
    expect(state?.plan).toBe('pro');
  });

  it('converges on the newest fetch whatever order the writes arrive in', async () => {
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    await reconcileSubscription(at(T.late), USER.buyer);

    // A straggler carrying older truth — the exact shape of a replayed/late webhook.
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'canceled' });
    const straggler = await reconcileSubscription(at(T.early), USER.buyer);

    expect(straggler.status).toBe('stale');
    // …and the entitlement it *observed* is still reported honestly, it just was not written.
    expect(straggler.entitled).toBe(false);
    const state = await readState(sql, USER.buyer);
    expect(state?.status).toBe('active');
    expect(state?.plan).toBe('pro');
  });

  it('applies a fetch with the same timestamp as no-op (strictly newer wins)', async () => {
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    await reconcileSubscription(at(T.middle), USER.buyer);

    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'canceled' });
    const same = await reconcileSubscription(at(T.middle), USER.buyer);

    expect(same.status).toBe('stale');
    expect((await readState(sql, USER.buyer))?.status).toBe('active');
  });
});

describe('the statuses the fence writes (§3.4 entitlement)', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;
  let gateway: FakeStripeGateway;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
  });
  afterAll(async () => harness.close());

  beforeEach(async () => {
    await sql.query('delete from subscriptions');
    gateway = createFakeStripeGateway();
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer });
  });

  const at = (iso: string) => ({ sql, gateway, now: () => new Date(iso) });

  it.each([
    ['active', true, 'pro'],
    ['past_due', true, 'pro'],
    ['canceled', false, 'free'],
    ['incomplete', false, 'free'],
    ['unpaid', false, 'free'],
  ] as const)('%s ⇒ entitled=%s, mirror=%s', async (status, entitled, plan) => {
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status });
    const result = await reconcileSubscription(at(T.middle), USER.buyer);
    expect(result.status).toBe('applied');
    expect(result.entitled).toBe(entitled);
    const state = await readState(sql, USER.buyer);
    expect(state?.status).toBe(status);
    expect(state?.plan).toBe(plan);
  });

  /**
   * The clock-free half of §8 M3's "cancel-at-period-end downgrade". Both sides asserted, because
   * the bug this prevents is a UI that downgrades on the FLAG rather than on Stripe's transition —
   * cutting a paying subscriber off before the period they paid for has closed.
   */
  it('stays entitled with a cancellation scheduled, and flips only when Stripe says so', async () => {
    gateway.setSubscription(CUSTOMER.buyer, {
      subscriptionId: 'sub_1',
      status: 'active',
      cancelAtPeriodEnd: true,
    });
    const scheduled = await reconcileSubscription(at(T.early), USER.buyer);
    expect(scheduled.entitled).toBe(true);

    let state = await readState(sql, USER.buyer);
    expect(state?.cancel_at_period_end).toBe(true);
    expect(state?.status).toBe('active');
    expect(state?.plan).toBe('pro');

    // …the period closes. Stripe transitions the subscription and sends `customer.subscription.deleted`.
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'canceled' });
    const closed = await reconcileSubscription(at(T.late), USER.buyer);
    expect(closed.status).toBe('applied');
    expect(closed.entitled).toBe(false);

    state = await readState(sql, USER.buyer);
    expect(state?.status).toBe('canceled');
    expect(state?.plan).toBe('free');
  });

  it('cancels the stored row when Stripe reports no subscription at all', async () => {
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    await reconcileSubscription(at(T.early), USER.buyer);

    gateway.clearSubscription(CUSTOMER.buyer);
    const gone = await reconcileSubscription(at(T.late), USER.buyer);

    expect(gone.status).toBe('absent');
    expect(gone.entitled).toBe(false);
    const state = await readState(sql, USER.buyer);
    expect(state?.status).toBe('canceled');
    expect(state?.plan).toBe('free');
  });

  it('fences the absent path too — an old "nothing here" cannot cancel a newer active row', async () => {
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    await reconcileSubscription(at(T.late), USER.buyer);

    gateway.clearSubscription(CUSTOMER.buyer);
    const straggler = await reconcileSubscription(at(T.early), USER.buyer);

    expect(straggler.status).toBe('absent');
    if (straggler.status !== 'absent') return;
    expect(straggler.applied).toBe(false);
    expect((await readState(sql, USER.buyer))?.status).toBe('active');
  });
});

describe('customer linking (§3.4 customer ↔ user map)', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
  });
  afterAll(async () => harness.close());

  it('fills a NULL, is idempotent, and never silently repoints a linked profile', async () => {
    await seedProfile(sql, { id: USER.other, customerId: null });
    expect(await linkStripeCustomer(sql, USER.other, CUSTOMER.other)).toBe('linked');
    expect(await linkStripeCustomer(sql, USER.other, CUSTOMER.other)).toBe('already');
    // Repointing would orphan a live subscription — that is an admin runbook case, not a request.
    expect(await linkStripeCustomer(sql, USER.other, 'cus_someone_else')).toBe('conflict');
  });
});

/**
 * §8 M3 acceptance, viewer half: "pro subscription row ⇒ tier `pro`". Driven through the real
 * derivation (`resolveViewer` + `sqlIdentitySource`), against rows the reconciler actually wrote —
 * not against a hand-inserted fixture, so a change to either half shows up here.
 */
describe('viewer tier follows the reconciled row (§3.4)', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
  });
  afterAll(async () => harness.close());

  it('walks free → pro → free as Stripe transitions the subscription', async () => {
    const gateway = createFakeStripeGateway();
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer, email: 'buyer@x.test' });
    const source = sqlIdentitySource(sql);
    const viewer = async () => resolveViewer({ id: USER.buyer }, await source.load(USER.buyer));

    expect((await viewer()).tier).toBe('free');

    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    await reconcileSubscription({ sql, gateway, now: () => new Date(T.early) }, USER.buyer);
    const pro = await viewer();
    expect(pro.tier).toBe('pro');
    expect(pro.email).toBe('buyer@x.test');

    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'canceled' });
    await reconcileSubscription({ sql, gateway, now: () => new Date(T.late) }, USER.buyer);
    expect((await viewer()).tier).toBe('free');
  });

  it('keeps admin above entitlement, and never reads the plan mirror', async () => {
    await seedProfile(sql, { id: USER.other, isAdmin: true, plan: 'free' });
    const identity = await sqlIdentitySource(sql).load(USER.other);
    expect(resolveViewer({ id: USER.other }, identity).tier).toBe('admin');

    // A mirror that lies (plan='pro' with no subscription) must not grant anything.
    await seedProfile(sql, { id: USER.buyer, plan: 'pro', customerId: null });
    await sql.query('delete from subscriptions where user_id = $1', [USER.buyer]);
    const lying = await sqlIdentitySource(sql).load(USER.buyer);
    expect(resolveViewer({ id: USER.buyer }, lying).tier).toBe('free');
  });
});
