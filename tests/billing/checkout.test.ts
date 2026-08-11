import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { startCheckout, startPortal } from '@/lib/billing/checkout';
import { reconcileSubscription } from '@/lib/billing/reconcile';
import { createFakeStripeGateway, type FakeStripeGateway } from '@/lib/billing/stripe-fake';
import { billingDb, readState, seedProfile, CUSTOMER, T, USER, type BillingHarness } from '../helpers/billing';

/**
 * PLAN §3.4 — "checkout creation is server-guarded (already-entitled users get the portal, not a
 * new checkout)". The duplicate-subscription policy is the whole subject of this file.
 *
 * The guard is only real if it decides against CURRENT truth, so the interesting case is the one
 * where the local row is stale and Stripe already has an active subscription: a guard that read the
 * mirror would happily start a second one.
 */
describe('startCheckout — the duplicate-subscription guard', () => {
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
  });

  const deps = () => ({
    sql,
    gateway,
    priceId: 'price_pro_monthly',
    appOrigin: 'https://playbook.test',
    now: () => new Date(T.middle),
  });

  const request = (userId: string, slug: string | null = 'character-sheet-generation') => ({
    userId,
    email: 'buyer@playbook.test',
    origin: { slug, locale: 'ko' as const },
  });

  it('sends a free user to Stripe with the §3.4 metadata and return URLs', async () => {
    await seedProfile(sql, { id: USER.buyer, customerId: null });

    const result = await startCheckout(deps(), request(USER.buyer));
    expect(result.status).toBe('checkout');
    if (result.status !== 'checkout') return;

    const session = await gateway.retrieveCheckoutSession(result.sessionId);
    expect(session?.clientReferenceId).toBe(USER.buyer);
    expect(session?.metadata).toEqual({
      userId: USER.buyer,
      locale: 'ko',
      slug: 'character-sheet-generation',
    });
    // The success URL carries the origin back, and Stripe's own session-id placeholder.
    expect(result.url).toContain('https://playbook.test/billing/success');
    expect(result.url).toContain('locale=ko');
    expect(result.url).toContain('slug=character-sheet-generation');
    expect(result.url).not.toContain('{CHECKOUT_SESSION_ID}');
  });

  it('omits the slug when the purchase started somewhere with no playbook', async () => {
    await seedProfile(sql, { id: USER.buyer, customerId: null });
    const result = await startCheckout(deps(), request(USER.buyer, null));
    expect(result.status).toBe('checkout');
    if (result.status !== 'checkout') return;
    const session = await gateway.retrieveCheckoutSession(result.sessionId);
    expect(session?.metadata.slug).toBeUndefined();
  });

  it('sends an entitled user to the customer portal instead of a second checkout', async () => {
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer });
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    await reconcileSubscription(deps(), USER.buyer);

    const result = await startCheckout(deps(), request(USER.buyer));
    expect(result.status).toBe('portal');
    if (result.status !== 'portal') return;
    expect(result.url).toContain('https://playbook.test/account');
    expect(result.url).toContain('portal=fake');
  });

  /**
   * The case a mirror-reading guard would get wrong: nothing local says "entitled", but Stripe
   * already has an active subscription for this customer. `startCheckout` reconciles first, so it
   * sees the truth and refuses to create a second one.
   */
  it('reconciles BEFORE deciding, so a stale local row cannot cause a duplicate', async () => {
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer, plan: 'free' });
    expect(await readState(sql, USER.buyer)).toMatchObject({ plan: 'free' });

    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_live', status: 'active' });

    const result = await startCheckout(deps(), request(USER.buyer));
    expect(result.status).toBe('portal');
    // …and the local state has been brought up to date as a side effect of asking.
    expect((await readState(sql, USER.buyer))?.plan).toBe('pro');
  });

  it('still starts checkout when the linked customer has no live subscription', async () => {
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer });
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_old', status: 'canceled' });

    const result = await startCheckout(deps(), request(USER.buyer));
    expect(result.status).toBe('checkout');
    if (result.status !== 'checkout') return;
    // Reusing the known customer keeps one Stripe customer per person.
    const session = await gateway.retrieveCheckoutSession(result.sessionId);
    expect(session?.customerId).toBe(CUSTOMER.buyer);
  });

  it('refuses to send an entitled-but-unlinked user to Stripe at all', async () => {
    // The seeded/fixture shape: an entitlement with no Stripe customer behind it. Sending them to
    // Checkout would create a real subscription for someone who already has one on paper.
    await seedProfile(sql, { id: USER.other, customerId: null });
    await sql.query(
      `insert into subscriptions
         (user_id, stripe_subscription_id, status, cancel_at_period_end, stripe_fetched_at)
       values ($1, 'sub_fixture', 'active', false, now())`,
      [USER.other],
    );

    const result = await startCheckout(deps(), {
      userId: USER.other,
      email: null,
      origin: { slug: 'x', locale: 'en' },
    });
    expect(result.status).toBe('already_pro');
    if (result.status !== 'already_pro') return;
    expect(result.returnTo).toBe('/en/p/x');
  });
});

describe('startPortal', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
  });
  afterAll(async () => harness.close());

  it('opens the portal for a linked customer and returns to /account', async () => {
    const gateway = createFakeStripeGateway();
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer });
    const result = await startPortal({ sql, gateway, appOrigin: 'https://playbook.test' }, USER.buyer);
    expect(result.status).toBe('portal');
    if (result.status !== 'portal') return;
    expect(result.url).toContain('https://playbook.test/account');
  });

  it('says so honestly when there is no Stripe customer to open one for', async () => {
    const gateway = createFakeStripeGateway();
    await seedProfile(sql, { id: USER.other, customerId: null });
    const result = await startPortal({ sql, gateway, appOrigin: 'https://playbook.test' }, USER.other);
    expect(result.status).toBe('no_customer');
  });
});
