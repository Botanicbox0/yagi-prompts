import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  countUnprocessedEvents,
  ingestEvent,
  isHandledEventType,
  retryUnprocessedEvents,
  HANDLED_EVENT_TYPES,
} from '@/lib/billing/ledger';
import { linkStripeCustomer, reconcileSubscription } from '@/lib/billing/reconcile';
import { createFakeStripeGateway, type FakeStripeGateway } from '@/lib/billing/stripe-fake';
import type { StripeWebhookEvent } from '@/lib/billing/stripe-gateway';
import { billingDb, readState, seedProfile, CUSTOMER, T, USER, type BillingHarness } from '../helpers/billing';

/**
 * PLAN §3.4 / §8 M3 — the `stripe_events` ledger.
 *
 *   "insert event id PK with processed_at NULL, skip only if exists with processed_at NOT NULL,
 *    process = reconcile then stamp processed_at; failures leave NULL; a retry sweep reprocesses."
 *
 * Every assertion below is about DELIVERY, not about payload contents — the whole design rests on
 * webhooks being triggers, so a test that trusted a payload would be testing the wrong system.
 */

/**
 * The payload is DERIVED from the flattened fields rather than fixed, because the retry sweep
 * re-extracts identifiers from the stored payload — a fixture whose payload disagreed with its own
 * `customerId` would make the sweep look correct while reconciling the wrong user.
 */
const event = (over: Partial<StripeWebhookEvent> = {}): StripeWebhookEvent => {
  const base: Omit<StripeWebhookEvent, 'payload'> & { payload?: unknown } = {
    id: 'evt_1',
    type: 'customer.subscription.updated',
    created: Math.floor(Date.parse(T.middle) / 1000),
    customerId: CUSTOMER.buyer,
    clientReferenceId: null,
    ...over,
  };
  return {
    ...base,
    payload:
      base.payload ??
      {
        id: base.id,
        type: base.type,
        data: {
          object: { customer: base.customerId, client_reference_id: base.clientReferenceId },
        },
      },
  } as StripeWebhookEvent;
};

async function processedAt(sql: SqlRunner, id: string): Promise<string | null> {
  const { rows } = await sql.query<{ processed_at: string | null }>(
    'select processed_at::text as processed_at from stripe_events where id = $1',
    [id],
  );
  return rows[0]?.processed_at ?? null;
}

describe('ledger semantics (§3.4)', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;
  let gateway: FakeStripeGateway;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
  });
  afterAll(async () => harness.close());

  beforeEach(async () => {
    await sql.query('delete from stripe_events');
    await sql.query('delete from subscriptions');
    gateway = createFakeStripeGateway();
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer });
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
  });

  const deps = (iso: string = T.middle) => ({ sql, gateway, now: () => new Date(iso) });

  it('handles exactly the four event types §3.4 lists', () => {
    expect([...HANDLED_EVENT_TYPES]).toEqual([
      'checkout.session.completed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ]);
    expect(isHandledEventType('customer.subscription.created')).toBe(false);
  });

  it('records, reconciles and stamps a first delivery', async () => {
    const outcome = await ingestEvent(deps(), event());
    expect(outcome).toEqual({ status: 'processed', userId: USER.buyer });
    expect(await processedAt(sql, 'evt_1')).not.toBeNull();
    expect((await readState(sql, USER.buyer))?.status).toBe('active');
    expect(gateway.fetchCount(CUSTOMER.buyer)).toBe(1);
  });

  it('skips a replay — "only if it exists with processed_at NOT NULL"', async () => {
    await ingestEvent(deps(), event());
    const replay = await ingestEvent(deps(), event());

    expect(replay).toEqual({ status: 'skipped' });
    // The decisive assertion: a skipped event does NOT re-hit Stripe.
    expect(gateway.fetchCount(CUSTOMER.buyer)).toBe(1);
  });

  it('ledgers an unknown type and stamps it, without erroring', async () => {
    const outcome = await ingestEvent(deps(), event({ id: 'evt_x', type: 'invoice.created' }));
    expect(outcome).toEqual({ status: 'ignored' });
    expect(await processedAt(sql, 'evt_x')).not.toBeNull();
    expect(gateway.fetchCount()).toBe(0);
  });

  it('leaves processed_at NULL when the handler throws', async () => {
    gateway.failNext(new Error('stripe is down'));
    const outcome = await ingestEvent(deps(), event({ id: 'evt_fail' }));

    expect(outcome.status).toBe('failed');
    expect(await processedAt(sql, 'evt_fail')).toBeNull();
    expect(await countUnprocessedEvents(sql)).toBe(1);
    // Nothing was written, so the failure did not half-apply anything either.
    expect(await readState(sql, USER.buyer)).toMatchObject({ plan: 'free' });
  });

  it('reprocesses the failed row on the retry sweep, from the stored payload alone', async () => {
    gateway.failNext();
    await ingestEvent(deps(), event({ id: 'evt_fail' }));
    expect(await countUnprocessedEvents(sql)).toBe(1);

    const report = await retryUnprocessedEvents(deps(T.late));

    expect(report).toEqual({ attempted: 1, processed: 1, unresolved: 0, failed: 0 });
    expect(await processedAt(sql, 'evt_fail')).not.toBeNull();
    expect(await countUnprocessedEvents(sql)).toBe(0);
    expect((await readState(sql, USER.buyer))?.plan).toBe('pro');
  });

  it('leaves an unmappable customer pending, and finishes it once the map exists', async () => {
    const orphan = event({ id: 'evt_orphan', customerId: 'cus_unknown_yet' });
    const first = await ingestEvent(deps(), orphan);

    expect(first).toEqual({ status: 'unresolved', customerId: 'cus_unknown_yet' });
    expect(await processedAt(sql, 'evt_orphan')).toBeNull();

    // …the browser comes back from Checkout and the link is written.
    await seedProfile(sql, { id: USER.other, customerId: null });
    await linkStripeCustomer(sql, USER.other, 'cus_unknown_yet');
    gateway.setSubscription('cus_unknown_yet', { subscriptionId: 'sub_2', status: 'active' });

    const report = await retryUnprocessedEvents(deps(T.late));
    expect(report.processed).toBe(1);
    expect((await readState(sql, USER.other))?.plan).toBe('pro');
  });

  it('closes the customer↔user map from checkout.session.completed itself', async () => {
    await seedProfile(sql, { id: USER.other, customerId: null });
    gateway.setSubscription('cus_fresh', { subscriptionId: 'sub_3', status: 'active' });

    const outcome = await ingestEvent(
      deps(),
      event({
        id: 'evt_checkout',
        type: 'checkout.session.completed',
        customerId: 'cus_fresh',
        clientReferenceId: USER.other,
      }),
    );

    expect(outcome).toEqual({ status: 'processed', userId: USER.other });
    expect((await readState(sql, USER.other))?.plan).toBe('pro');
  });

  it('refuses a client_reference_id that is not a real profile', async () => {
    const outcome = await ingestEvent(
      deps(),
      event({
        id: 'evt_forged',
        type: 'checkout.session.completed',
        customerId: 'cus_forged',
        clientReferenceId: '00000000-0000-4000-8000-000000000999',
      }),
    );
    expect(outcome.status).toBe('unresolved');
  });
});

/**
 * §8 M3's named race: "replay + out-of-order webhook after success-reconcile → no state
 * regression". `/billing/success` reconciles the moment the browser returns; the webhook for the
 * SAME purchase then arrives late, carrying a view of the world from before the newer state.
 */
describe('out-of-order webhook after the success route reconciled (§8 M3)', () => {
  let harness: BillingHarness;
  let sql: SqlRunner;

  beforeAll(async () => {
    harness = await billingDb();
    sql = harness.sql;
  });
  afterAll(async () => harness.close());

  beforeEach(async () => {
    await sql.query('delete from stripe_events');
    await sql.query('delete from subscriptions');
    await seedProfile(sql, { id: USER.buyer, customerId: CUSTOMER.buyer });
  });

  it('cannot regress the state the success route already wrote', async () => {
    const gateway = createFakeStripeGateway();
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });

    // 1. the browser returns from Checkout — /billing/success reconciles at t=late.
    const success = await reconcileSubscription(
      { sql, gateway, now: () => new Date(T.late) },
      USER.buyer,
    );
    expect(success.status).toBe('applied');
    expect((await readState(sql, USER.buyer))?.plan).toBe('pro');

    // 2. the `checkout.session.completed` webhook finally lands, holding an older fetch time. Even
    //    if Stripe now answered something stale, the fence rejects the write.
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'incomplete' });
    const late = await ingestEvent(
      { sql, gateway, now: () => new Date(T.early) },
      event({ id: 'evt_late', type: 'checkout.session.completed' }),
    );

    expect(late.status).toBe('processed');
    // The ledger row is finished — the delivery succeeded, it simply had nothing newer to say.
    expect(await processedAt(sql, 'evt_late')).not.toBeNull();
    const state = await readState(sql, USER.buyer);
    expect(state?.status).toBe('active');
    expect(state?.plan).toBe('pro');
  });

  it('still applies a genuinely newer webhook (the fence is not a freeze)', async () => {
    const gateway = createFakeStripeGateway();
    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'active' });
    await reconcileSubscription({ sql, gateway, now: () => new Date(T.early) }, USER.buyer);

    gateway.setSubscription(CUSTOMER.buyer, { subscriptionId: 'sub_1', status: 'canceled' });
    await ingestEvent(
      { sql, gateway, now: () => new Date(T.late) },
      event({ id: 'evt_deleted', type: 'customer.subscription.deleted' }),
    );

    const state = await readState(sql, USER.buyer);
    expect(state?.status).toBe('canceled');
    expect(state?.plan).toBe('free');
  });
});
