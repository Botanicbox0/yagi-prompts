import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeTossGateway, type FakeTossGateway } from '@/lib/billing/toss-fake';
import { TossError, type TossGateway, type TossPayment } from '@/lib/billing/toss-gateway';
import { confirmTossOrder, createTossOrder, reconcileTossWebhook } from '@/lib/billing/toss-service';
import { createRenderJob } from '@/lib/renders/service';
import { createLocalRenderStore } from '@/lib/renders/store';
import { ADMIN_OPERATION_NAMES, ADMIN_OPERATIONS } from '@/lib/admin/operations';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { ADMIN_VIEWER, formOf, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import type { AdminContext } from '@/lib/admin/context';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  root: { path: '' },
}));
const gate = vi.hoisted(() => ({ mode: 'on' as 'on' | 'review' | 'off' }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/renders/store', async (original) => {
  const actual = await original<typeof import('@/lib/renders/store')>();
  return { ...actual, getRenderStore: async () => actual.createLocalRenderStore(mocks.root.path) };
});
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_PUBLIC() {
    return gate.mode === 'on';
  },
  get RENDER_PIPELINE_MODE() {
    return gate.mode;
  },
}));

import { POST as webhookPost } from '@/app/api/billing/toss/webhook/route';

const buyer = viewerOf('free');
const orderInput = {
  templateSlug: 'static-portrait-window-light',
  aspect: '4:5',
  locale: 'ko' as const,
  photo: { bytes: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg' },
};

interface PaymentRow {
  id: string;
  environment: string;
  status: string;
  failure_code: string | null;
  payment_key: string | null;
  amount_krw: number;
  lease_until: Date | null;
  approved_at: Date | null;
  fulfilled_at: Date | null;
  refunded_at: Date | null;
  refund_attempts: number;
  fulfil_attempts: number;
  input_deleted_at: Date | null;
  render_id: string | null;
}

interface AuditRow {
  actor_id: string | null;
  entity_id: string;
  action: string;
  reason: string;
  details: Record<string, unknown>;
  created_at: Date;
}

describe('billing.payment.recheck admin operation', () => {
  let h: PromptHarness;
  let gateway: FakeTossGateway;
  let clockNow: Date;

  beforeEach(async () => {
    gate.mode = 'on';
    vi.stubEnv('TOSS_CLIENT_KEY', '');
    vi.stubEnv('TOSS_SECRET_KEY', '');
    delete (globalThis as { __twingsFakeToss?: unknown }).__twingsFakeToss;
    clockNow = new Date('2026-11-20T10:00:00.000Z');
    h = await promptHarness();
    gateway = createFakeTossGateway();
    (globalThis as { __twingsFakeToss?: TossGateway }).__twingsFakeToss = gateway;
    mocks.root.path = h.root;
    mocks.sql.mockResolvedValue(h.sql);
  });

  afterEach(async () => {
    delete (globalThis as { __twingsFakeToss?: unknown }).__twingsFakeToss;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await h.close();
  });

  const deps = (gw: TossGateway = gateway, now = clockNow) => ({
    sql: h.sql,
    store: createLocalRenderStore(h.root),
    gateway: gw,
    createRender: createRenderJob,
    now,
  });

  const adminCtx = (gw: TossGateway | null = gateway, now = clockNow, viewer = ADMIN_VIEWER): AdminContext => ({
    sql: h.sql,
    storage: h.storage,
    viewer,
    toss: {
      gateway: gw,
      store: createLocalRenderStore(h.root),
      createRender: createRenderJob,
      now: () => now,
    },
  });

  async function placeAndPay(gw: FakeTossGateway = gateway, now = clockNow) {
    const created = await createTossOrder(deps(gw, now), buyer, orderInput);
    if (!created.ok) throw new Error(created.code);
    gw.authorize(created.order.id, created.order.amountKrw);
    const approved = await confirmTossOrder(deps(gw, now), buyer, {
      orderId: created.order.id,
      paymentKey: gw.keyFor(created.order.id),
      amount: created.order.amountKrw,
      consent: true,
    });
    if (!approved.ok) throw new Error(approved.code);
    return { orderId: created.order.id, renderId: approved.id, amountKrw: created.order.amountKrw };
  }

  async function readPayment(id: string): Promise<PaymentRow> {
    const { rows } = await h.sql.query<PaymentRow>('select * from billing_payments where id=$1', [id]);
    return rows[0]!;
  }

  async function readAudits(entityId: string): Promise<AuditRow[]> {
    const { rows } = await h.sql.query<AuditRow>(
      "select actor_id, entity_id, action, reason, details, created_at from platform_audit where entity_id=$1 and action='billing.payment.recheck' order by created_at asc",
      [entityId],
    );
    return rows;
  }

  it('registers billing.payment.recheck and refuses non-admins and bad ids', async () => {
    expect(ADMIN_OPERATION_NAMES).toContain('billing.payment.recheck');

    const paid = await placeAndPay();
    const retrieveSpy = vi.spyOn(gateway, 'retrieve');

    for (const tier of ['anon', 'free', 'pro'] as const) {
      const outcome = await dispatchAdmin(
        'billing.payment.recheck',
        formOf('billing.payment.recheck', { paymentId: paid.orderId }),
        adminCtx(gateway, clockNow, viewerOf(tier)),
      );
      expect(outcome).toEqual({ ok: false, code: 'forbidden' });
    }

    // Even calling the operation runner directly must refuse non-admins.
    const directOp = ADMIN_OPERATIONS['billing.payment.recheck'];
    expect(await directOp.run(adminCtx(gateway, clockNow, viewerOf('pro')), { paymentId: paid.orderId })).toEqual({
      ok: false,
      code: 'forbidden',
    });

    expect(retrieveSpy).not.toHaveBeenCalled();
    expect(await readAudits(paid.orderId)).toHaveLength(0);

    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: 'not-a-uuid' }), adminCtx()),
    ).toMatchObject({ ok: false, code: 'invalid' });

    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: randomUUID() }), adminCtx()),
    ).toEqual({ ok: false, code: 'notFound' });
  });

  it('when provider says CANCELED, produces side effects identical to the webhook handler and writes an audit row', async () => {
    const paidAt = new Date('2026-11-20T10:00:00.000Z');
    const webhookFixture = await placeAndPay(gateway, paidAt);
    const recheckFixture = await placeAndPay(gateway, paidAt);
    const routeFixture = await placeAndPay(gateway, paidAt);

    await gateway.cancel({
      paymentKey: gateway.keyFor(webhookFixture.orderId),
      reason: 'console cancel webhook',
      idempotencyKey: 'console-webhook',
    });
    await gateway.cancel({
      paymentKey: gateway.keyFor(recheckFixture.orderId),
      reason: 'console cancel recheck',
      idempotencyKey: 'console-recheck',
    });
    await gateway.cancel({
      paymentKey: gateway.keyFor(routeFixture.orderId),
      reason: 'console cancel route',
      idempotencyKey: 'console-route',
    });

    const cancelCallsBefore = gateway.cancelCalls;
    const confirmCallsBefore = gateway.confirmCalls;

    // 1. Webhook handler path on fixture A (pinned to the same timestamp)
    const recheckAt = new Date('2026-11-20T10:15:00.000Z');
    const webhookRes = await reconcileTossWebhook(deps(gateway, recheckAt), { orderId: webhookFixture.orderId });
    expect(webhookRes).toMatchObject({ matched: true, report: { refunded: 1 } });

    // Also verify the HTTP webhook route parses and converges identically on a third fixture
    const httpRes = await webhookPost(
      new NextRequest('https://twings.app/api/billing/toss/webhook', {
        method: 'POST',
        headers: { origin: 'https://api.tosspayments.com', 'content-type': 'application/json' },
        body: JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: routeFixture.orderId } }),
      }),
    );
    expect(httpRes.status).toBe(200);

    // 2. Admin recheck operation on fixture B at recheckAt
    const outcome = await dispatchAdmin(
      'billing.payment.recheck',
      formOf('billing.payment.recheck', { paymentId: recheckFixture.orderId }),
      adminCtx(gateway, recheckAt),
    );
    expect(outcome).toEqual({
      ok: true,
      code: 'paymentRechecked',
      detail: 'paid → CANCELED → refunded',
    });

    // Compare DB side effects identically
    const rowA = await readPayment(webhookFixture.orderId);
    const rowB = await readPayment(recheckFixture.orderId);
    const rowRoute = await readPayment(routeFixture.orderId);

    const normalize = (r: PaymentRow) => ({
      status: r.status,
      failure_code: r.failure_code,
      lease_until: r.lease_until,
      approved_at: r.approved_at?.toISOString() ?? null,
      fulfilled_at: r.fulfilled_at?.toISOString() ?? null,
      refunded_at: r.refunded_at?.toISOString() ?? null,
      refund_attempts: r.refund_attempts,
      fulfil_attempts: r.fulfil_attempts,
      input_deleted_at: r.input_deleted_at?.toISOString() ?? null,
    });

    expect(normalize(rowB)).toEqual(normalize(rowA));
    expect(rowB.status).toBe('refunded');
    expect(rowB.refunded_at?.toISOString()).toBe(recheckAt.toISOString());
    expect(rowRoute.status).toBe('refunded');

    const renderA = (await h.sql.query<{ status: string }>('select status from render_jobs where id=$1', [webhookFixture.renderId])).rows[0]!;
    const renderB = (await h.sql.query<{ status: string }>('select status from render_jobs where id=$1', [recheckFixture.renderId])).rows[0]!;
    expect(renderB).toEqual(renderA);

    // No extra confirm/cancel calls were made by either reconcile or recheck
    expect(gateway.cancelCalls).toBe(cancelCallsBefore);
    expect(gateway.confirmCalls).toBe(confirmCallsBefore);

    // Audit row recorded with actor, timestamp, before/provider/after
    const audits = await readAudits(recheckFixture.orderId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: ADMIN_VIEWER.userId,
      entity_id: recheckFixture.orderId,
      action: 'billing.payment.recheck',
      details: {
        environment: 'fake',
        before: { status: 'paid', failureCode: null },
        provider: { called: true, status: 'CANCELED', balance: 0 },
        after: { status: 'refunded', failureCode: null },
        changed: true,
      },
    });
    expect(new Date(audits[0]!.created_at).toISOString()).toBe(recheckAt.toISOString());
  });

  it('recovers a refund_pending(refund_manual) row when provider says CANCELED', async () => {
    const paid = await placeAndPay();
    await h.sql.query(
      "update billing_payments set status='refund_pending', failure_code='refund_manual', refund_attempts=10 where id=$1",
      [paid.orderId],
    );
    await gateway.cancel({
      paymentKey: gateway.keyFor(paid.orderId),
      reason: 'manual console refund',
      idempotencyKey: 'manual-refund-1',
    });

    const outcome = await dispatchAdmin(
      'billing.payment.recheck',
      formOf('billing.payment.recheck', { paymentId: paid.orderId }),
      adminCtx(),
    );
    expect(outcome).toEqual({
      ok: true,
      code: 'paymentRechecked',
      detail: 'refund_pending(refund_manual) → CANCELED → refunded(refund_manual)',
    });
    expect((await readPayment(paid.orderId)).status).toBe('refunded');
  });

  it('reports no change when provider still says DONE (paid)', async () => {
    const paid = await placeAndPay();
    const outcome = await dispatchAdmin(
      'billing.payment.recheck',
      formOf('billing.payment.recheck', { paymentId: paid.orderId }),
      adminCtx(),
    );
    expect(outcome).toEqual({
      ok: true,
      code: 'paymentUnchanged',
      detail: 'paid → DONE → paid',
    });
    const row = await readPayment(paid.orderId);
    expect(row.status).toBe('paid');
    expect(row.refunded_at).toBeNull();

    const audits = await readAudits(paid.orderId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.details).toMatchObject({
      before: { status: 'paid', failureCode: null },
      provider: { called: true, status: 'DONE', balance: paid.amountKrw },
      after: { status: 'paid', failureCode: null },
      changed: false,
    });
  });

  it('handles provider not found / failed / unreachable according to existing rules', async () => {
    // Case A: paid order whose provider returns null (NOT_FOUND) stays paid
    const paid = await placeAndPay();
    const gwNotFoundPaid: TossGateway = { ...gateway, retrieve: async () => null };
    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: paid.orderId }), adminCtx(gwNotFoundPaid)),
    ).toEqual({
      ok: true,
      code: 'paymentUnchanged',
      detail: 'paid → NOT_FOUND → paid',
    });
    expect((await readPayment(paid.orderId)).status).toBe('paid');

    // Case B1: confirming order (expired lease) whose provider returns null -> failed(unknown_payment)
    const created1 = await createTossOrder(deps(), buyer, orderInput);
    if (!created1.ok) throw new Error(created1.code);
    gateway.authorize(created1.order.id, created1.order.amountKrw);
    const failConfirmGw: TossGateway = {
      ...gateway,
      confirm: async () => {
        throw new TossError('NETWORK_ERROR');
      },
      retrieve: async () => null,
    };
    await confirmTossOrder(deps(failConfirmGw), buyer, {
      orderId: created1.order.id,
      paymentKey: gateway.keyFor(created1.order.id),
      amount: created1.order.amountKrw,
      consent: true,
    });
    const afterLease = new Date(clockNow.getTime() + 65_000);
    expect(
      await dispatchAdmin(
        'billing.payment.recheck',
        formOf('billing.payment.recheck', { paymentId: created1.order.id }),
        adminCtx(failConfirmGw, afterLease),
      ),
    ).toEqual({
      ok: true,
      code: 'paymentRechecked',
      detail: 'confirming → NOT_FOUND → failed(unknown_payment)',
    });
    expect(await readPayment(created1.order.id)).toMatchObject({ status: 'failed', failure_code: 'unknown_payment' });

    // Case B2: confirming order (expired lease) whose provider says ABORTED -> failed(aborted)
    const created2 = await createTossOrder(deps(), buyer, orderInput);
    if (!created2.ok) throw new Error(created2.code);
    const abortedSnapshot: TossPayment = {
      paymentKey: gateway.keyFor(created2.order.id),
      orderId: created2.order.id,
      amount: created2.order.amountKrw,
      currency: 'KRW',
      status: 'ABORTED',
      balance: created2.order.amountKrw,
    };
    const abortedGw: TossGateway = {
      ...gateway,
      confirm: async () => {
        throw new TossError('NETWORK_ERROR');
      },
      retrieve: async () => ({ ...abortedSnapshot }),
    };
    await confirmTossOrder(deps(abortedGw), buyer, {
      orderId: created2.order.id,
      paymentKey: gateway.keyFor(created2.order.id),
      amount: created2.order.amountKrw,
      consent: true,
    });
    expect(
      await dispatchAdmin(
        'billing.payment.recheck',
        formOf('billing.payment.recheck', { paymentId: created2.order.id }),
        adminCtx(abortedGw, afterLease),
      ),
    ).toEqual({
      ok: true,
      code: 'paymentRechecked',
      detail: 'confirming → ABORTED → failed(aborted)',
    });
    expect(await readPayment(created2.order.id)).toMatchObject({ status: 'failed', failure_code: 'aborted' });

    // Case C: provider retrieve throws NETWORK_ERROR -> paymentUnavailable, audit written, row unchanged
    const paid2 = await placeAndPay();
    const networkFailGw: TossGateway = {
      ...gateway,
      retrieve: async () => {
        throw new TossError('NETWORK_ERROR');
      },
    };
    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: paid2.orderId }), adminCtx(networkFailGw)),
    ).toEqual({
      ok: false,
      code: 'paymentUnavailable',
      detail: 'NETWORK_ERROR',
    });
    expect((await readPayment(paid2.orderId)).status).toBe('paid');
    const failAudits = await readAudits(paid2.orderId);
    expect(failAudits).toHaveLength(1);
    expect(failAudits[0]!.details).toMatchObject({
      provider: { called: true, status: null, error: 'NETWORK_ERROR' },
      changed: false,
    });
  });

  it('refuses rows from another environment without calling the provider', async () => {
    const templateId = (await h.sql.query<{ id: string }>("select id from prompt_items where slug='static-portrait-window-light'")).rows[0]!.id;
    const testOrderId = randomUUID();
    const liveOrderId = randomUUID();

    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, payment_key, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, consent_at, approved_at, expires_at)
       values ($1, $2, 'test', 3900, 'paid', $3, $4, 'static-portrait-window-light', 'test row', '4:5', 'ko', $1, 'k/in.jpg', 'image/jpeg', now(), now(), now() + interval '1 day'),
              ($5, $2, 'live', 3900, 'paid', $6, $4, 'static-portrait-window-light', 'live row', '4:5', 'ko', $5, 'k/in.jpg', 'image/jpeg', now(), now(), now() + interval '1 day')`,
      [testOrderId, buyer.userId, `test_${testOrderId}`, templateId, liveOrderId, `live_${liveOrderId}`],
    );

    const liveRetrieve = vi.fn(async () => null);
    const liveGw: TossGateway = { ...gateway, kind: 'live', retrieve: liveRetrieve };

    const testRetrieve = vi.fn(async () => null);
    const testGw: TossGateway = { ...gateway, kind: 'test', retrieve: testRetrieve };

    const fakeRetrieve = vi.fn(async () => null);
    const fakeGw: TossGateway = { ...gateway, kind: 'fake', retrieve: fakeRetrieve };

    // Live gateway refuses test row
    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: testOrderId }), adminCtx(liveGw)),
    ).toMatchObject({ ok: false, code: 'paymentWrongEnvironment' });
    expect(liveRetrieve).not.toHaveBeenCalled();

    // Test gateway refuses live row
    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: liveOrderId }), adminCtx(testGw)),
    ).toMatchObject({ ok: false, code: 'paymentWrongEnvironment' });
    expect(testRetrieve).not.toHaveBeenCalled();

    // Fake gateway refuses both test and live rows
    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: testOrderId }), adminCtx(fakeGw)),
    ).toMatchObject({ ok: false, code: 'paymentWrongEnvironment' });
    expect(
      await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: liveOrderId }), adminCtx(fakeGw)),
    ).toMatchObject({ ok: false, code: 'paymentWrongEnvironment' });
    expect(fakeRetrieve).not.toHaveBeenCalled();

    expect(await readAudits(testOrderId)).toHaveLength(0);
    expect(await readAudits(liveOrderId)).toHaveLength(0);
  });

  it('enforces a 60s per-payment cooldown without blocking other payments', async () => {
    const p1 = await placeAndPay();
    const p2 = await placeAndPay();
    const retrieveSpy = vi.spyOn(gateway, 'retrieve');

    const t0 = new Date('2026-11-20T10:00:00.000Z');
    const first = await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: p1.orderId }), adminCtx(gateway, t0));
    expect(first).toMatchObject({ ok: true, code: 'paymentUnchanged' });
    expect(retrieveSpy).toHaveBeenCalledTimes(1);

    // 30s later: p1 is on cooldown (30s left), provider is NOT called, no extra audit row
    const t30 = new Date(t0.getTime() + 30_000);
    const blocked = await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: p1.orderId }), adminCtx(gateway, t30));
    expect(blocked).toEqual({ ok: false, code: 'paymentCooldown', detail: '30s' });
    expect(retrieveSpy).toHaveBeenCalledTimes(1);
    expect(await readAudits(p1.orderId)).toHaveLength(1);

    // At t0 + 30s, p2 can still be checked independently
    const other = await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: p2.orderId }), adminCtx(gateway, t30));
    expect(other).toMatchObject({ ok: true, code: 'paymentUnchanged' });
    expect(retrieveSpy).toHaveBeenCalledTimes(2);

    // At t0 + 60s, p1 is allowed again
    const t60 = new Date(t0.getTime() + 60_000);
    const again = await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: p1.orderId }), adminCtx(gateway, t60));
    expect(again).toMatchObject({ ok: true, code: 'paymentUnchanged' });
    expect(retrieveSpy).toHaveBeenCalledTimes(3);
    expect(await readAudits(p1.orderId)).toHaveLength(2);
  });

  it('is idempotent when called twice across the cooldown window', async () => {
    const paid = await placeAndPay();
    await gateway.cancel({
      paymentKey: gateway.keyFor(paid.orderId),
      reason: 'console',
      idempotencyKey: 'double-call',
    });

    const t0 = new Date('2026-11-20T10:00:00.000Z');
    const first = await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: paid.orderId }), adminCtx(gateway, t0));
    expect(first).toEqual({
      ok: true,
      code: 'paymentRechecked',
      detail: 'paid → CANCELED → refunded',
    });
    const afterFirst = await readPayment(paid.orderId);
    expect(afterFirst.status).toBe('refunded');
    expect(afterFirst.refunded_at).not.toBeNull();

    const t61 = new Date(t0.getTime() + 61_000);
    const second = await dispatchAdmin('billing.payment.recheck', formOf('billing.payment.recheck', { paymentId: paid.orderId }), adminCtx(gateway, t61));
    expect(second).toMatchObject({
      ok: true,
      code: 'paymentUnchanged',
    });
    const afterSecond = await readPayment(paid.orderId);
    expect(afterSecond.status).toBe('refunded');
    expect(afterSecond.refunded_at?.toISOString()).toBe(afterFirst.refunded_at?.toISOString());
    expect(gateway.cancelCalls).toBe(1); // Only our initial test setup cancel() call
  });
});
