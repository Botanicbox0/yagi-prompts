import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeTossGateway } from '@/lib/billing/toss-fake';
import {
  createTossOrder,
  confirmTossOrder,
  reconcileTossPayments,
  loadOwnTossOrder,
} from '@/lib/billing/toss-service';
import { createRenderJob, runRenderPass } from '@/lib/renders/service';
import { createLocalRenderStore } from '@/lib/renders/store';
import { createFakeMailer } from '@/lib/notify/mailer-fake';
import { createEmailRenderNotifier } from '@/lib/renders/notify';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

const gate = vi.hoisted(() => ({ open: true }));
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_PUBLIC() {
    return gate.open;
  },
  // The gate the purchase now reads (lib/auth/purchase-gate.ts); `on` is the public sale this
  // suite exercises, and closing it must close both.
  get RENDER_PIPELINE_MODE() {
    return gate.open ? 'on' : 'off';
  },
}));

const buyer = viewerOf('free');
const input = {
  templateSlug: 'static-portrait-window-light',
  aspect: '4:5',
  locale: 'ko',
  photo: { bytes: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg' },
};

describe('Toss one-time checkout on the real database', () => {
  let h: PromptHarness;
  let gateway: ReturnType<typeof createFakeTossGateway>;
  beforeEach(async () => {
    gate.open = true;
    h = await promptHarness();
    gateway = createFakeTossGateway();
  });
  afterEach(async () => {
    await h.close();
  });
  const deps = () => ({
    sql: h.sql,
    store: createLocalRenderStore(h.root),
    gateway,
    createRender: createRenderJob,
  });
  const order = () => createTossOrder(deps(), buyer, input);
  async function pay() {
    const created = await order();
    if (!created.ok) throw new Error(created.code);
    gateway.authorize(created.order.id, created.order.amountKrw);
    const result = await confirmTossOrder(deps(), buyer, {
      orderId: created.order.id,
      paymentKey: gateway.keyFor(created.order.id),
      amount: created.order.amountKrw,
      consent: true,
    });
    return { created, result };
  }

  it('stores an order and photo, approves the server price, and creates exactly one render', async () => {
    const { created, result } = await pay();
    expect(result).toMatchObject({ ok: true, held: false });
    expect(gateway.confirmCalls).toBe(1);
    expect(
      (await loadOwnTossOrder(h.sql, buyer, created.order.id))?.status,
    ).toBe('paid');
    expect((await h.sql.query('select * from render_jobs')).rows).toHaveLength(
      1,
    );
    const again = await confirmTossOrder(deps(), buyer, {
      orderId: created.order.id,
      paymentKey: gateway.keyFor(created.order.id),
      amount: created.order.amountKrw,
      consent: true,
    });
    expect(again).toEqual({ ok: false, code: 'already_processed' });
    expect(gateway.confirmCalls).toBe(1);
    expect((await h.sql.query('select * from render_jobs')).rows).toHaveLength(
      1,
    );
  });

  it('pins a selected portrait to its order and render after the user changes selection', async () => {
    const first = '10000000-0000-4000-8000-000000000001';
    const second = '10000000-0000-4000-8000-000000000002';
    for (const [index, id] of [first, second].entries()) {
      await h.sql.query(`insert into identity_portrait_attempts
        (id,user_id,request_id,slot,status,model,prompt_version,input_key,result_key,consent_at,completed_at)
        values($1,$2,$1,$3,'succeeded','gpt-image-2.5-sunburst','studio-identity-v1',$4,$5,now(),now())`,
        [id, buyer.userId, index === 0 ? 1 : 3, `${id}/input.png`, `${id}/result.png`]);
    }
    await h.sql.query('insert into identity_portrait_selections(user_id,attempt_id) values($1,$2)', [buyer.userId, first]);
    const created = await createTossOrder(deps(), buyer, { ...input, portraitId: first });
    if (!created.ok) throw new Error(created.code);
    await h.sql.query('update identity_portrait_selections set attempt_id=$2 where user_id=$1', [buyer.userId, second]);
    gateway.authorize(created.order.id, created.order.amountKrw);
    const result = await confirmTossOrder(deps(), buyer, {
      orderId: created.order.id, paymentKey: gateway.keyFor(created.order.id),
      amount: created.order.amountKrw, consent: true,
    });
    if (!result.ok) throw new Error(result.code);
    const payment = (await h.sql.query<{identity_portrait_id:string;input_key:string}>(
      'select identity_portrait_id,input_key from billing_payments where id=$1', [created.order.id])).rows[0];
    const render = (await h.sql.query<{identity_portrait_id:string;input_key:string}>(
      'select identity_portrait_id,input_key from render_jobs where id=$1', [result.id])).rows[0];
    if (!payment || !render) throw new Error('Missing payment or render');
    expect(payment.identity_portrait_id).toBe(first);
    expect(render.identity_portrait_id).toBe(first);
    expect(await deps().store.read(render.input_key)).toEqual(input.photo.bytes);
  });

  it('rejects a forged amount and an order whose server price changed before approval', async () => {
    const c = await order();
    if (!c.ok) throw new Error(c.code);
    gateway.authorize(c.order.id, c.order.amountKrw);
    const args = {
      orderId: c.order.id,
      paymentKey: gateway.keyFor(c.order.id),
      amount: 1,
      consent: true,
    };
    expect(await confirmTossOrder(deps(), buyer, args)).toEqual({
      ok: false,
      code: 'amount_mismatch',
    });
    await h.sql.query(
      'update prompt_items set price_krw = price_krw + 1000 where slug = $1',
      [input.templateSlug],
    );
    expect(
      await confirmTossOrder(deps(), buyer, {
        ...args,
        amount: c.order.amountKrw,
      }),
    ).toEqual({ ok: false, code: 'price_changed' });
    await h.sql.query(
      'update prompt_items set price_cents = 0 where slug = $1',
      [input.templateSlug],
    );
    expect(await order()).toEqual({ ok: false, code: 'not_for_sale' });
    expect(gateway.confirmCalls).toBe(0);
  });

  it('requires consent, owner authentication, and the open gate before accepting money', async () => {
    const c = await order();
    if (!c.ok) throw new Error(c.code);
    const args = {
      orderId: c.order.id,
      paymentKey: 'untrusted',
      amount: c.order.amountKrw,
      consent: false,
    };
    expect(await confirmTossOrder(deps(), buyer, args)).toEqual({
      ok: false,
      code: 'consent_required',
    });
    expect(
      await confirmTossOrder(deps(), viewerOf('pro'), {
        ...args,
        consent: true,
      }),
    ).toEqual({ ok: false, code: 'not_found' });
    expect(await order()).toMatchObject({ ok: true });
    gate.open = false;
    expect(await order()).toEqual({ ok: false, code: 'not_open' });
    expect(
      await confirmTossOrder(deps(), buyer, { ...args, consent: true }),
    ).toEqual({ ok: false, code: 'not_open' });
    expect(gateway.confirmCalls).toBe(0);
  });

  it('does not let a reader bypass checkout by posting directly to the render service', async () => {
    expect(await createRenderJob(deps(), buyer, input)).toEqual({
      ok: false,
      code: 'not_open',
    });
    const result = await createRenderJob(deps(), ADMIN_VIEWER, input);
    expect(result.ok).toBe(true);
    expect(
      (await h.sql.query('select * from billing_payments')).rows,
    ).toHaveLength(0);
    expect(gateway.confirmCalls).toBe(0);
  });

  it('refunds terminal render failure once and includes the confirmed refund in the failure email', async () => {
    const { result } = await pay();
    if (!result.ok) throw new Error(result.code);
    const mailer = createFakeMailer();
    const forcedFailure = async () => {
      throw new Error('forced terminal failure');
    };
    const pass = {
      ...deps(),
      tossGateway: gateway,
      siteUrl: 'https://twings.test',
      notifier: createEmailRenderNotifier(mailer),
      engines: { openai: { edit: forcedFailure, generate: forcedFailure } },
    };
    await runRenderPass(pass as Parameters<typeof runRenderPass>[0], {
      jobId: result.id,
    });
    await runRenderPass(pass as Parameters<typeof runRenderPass>[0]);
    expect(gateway.cancelCalls).toBe(1);
    expect(
      (
        await h.sql.query<{ status: string }>(
          'select status from billing_payments',
        )
      ).rows[0]?.status,
    ).toBe('refunded');
    expect(mailer.sent[0]?.text).toContain('refunded in full');
    expect(mailer.sent[0]?.html).not.toContain('Nothing was charged');
  });

  it('keeps a failed cancellation retryable and never says it was refunded before confirmation', async () => {
    const { result } = await pay();
    if (!result.ok) throw new Error(result.code);
    await h.sql.query(
      "update render_jobs set status='failed', error_code='engine_error', finished_at=now() where id=$1",
      [result.id],
    );
    gateway.failCancel = true;
    await reconcileTossPayments(deps());
    expect(
      (
        await h.sql.query<{ status: string }>(
          'select status from billing_payments',
        )
      ).rows[0]?.status,
    ).toBe('refund_pending');
    const mailer = createFakeMailer();
    const pass = {
      ...deps(),
      tossGateway: gateway,
      siteUrl: 'https://twings.test',
      notifier: createEmailRenderNotifier(mailer),
    };
    await runRenderPass(pass);
    expect(mailer.sent).toHaveLength(0);
    gateway.failCancel = false;
    await runRenderPass(pass);
    expect(
      (
        await h.sql.query<{ status: string }>(
          'select status from billing_payments',
        )
      ).rows[0]?.status,
    ).toBe('refunded');
    expect(mailer.sent[0]?.text).toContain('refunded in full');
  });

  it('recovers an approval whose response was lost without a second charge', async () => {
    const c = await order();
    if (!c.ok) throw new Error(c.code);
    gateway.authorize(c.order.id, c.order.amountKrw);
    gateway.loseConfirmResponse = true;
    await confirmTossOrder(deps(), buyer, {
      orderId: c.order.id,
      paymentKey: gateway.keyFor(c.order.id),
      amount: c.order.amountKrw,
      consent: true,
    });
    await h.sql.query(
      "update billing_payments set lease_until=now()-interval '1 minute' where id=$1",
      [c.order.id],
    );
    await reconcileTossPayments(deps());
    expect(gateway.confirmCalls).toBe(1);
    expect((await h.sql.query('select * from render_jobs')).rows).toHaveLength(
      1,
    );
  });

  it('continues paid fulfillment and refunds after the public gate closes', async () => {
    const c = await order();
    if (!c.ok) throw new Error(c.code);
    gateway.authorize(c.order.id, c.order.amountKrw);
    gateway.loseConfirmResponse = true;
    await confirmTossOrder(deps(), buyer, {
      orderId: c.order.id,
      paymentKey: gateway.keyFor(c.order.id),
      amount: c.order.amountKrw,
      consent: true,
    });
    gate.open = false;
    await h.sql.query(
      "update billing_payments set lease_until=now()-interval '1 minute' where id=$1",
      [c.order.id],
    );
    await reconcileTossPayments(deps());
    const paid = await loadOwnTossOrder(h.sql, buyer, c.order.id);
    expect(paid?.status).toBe('paid');
    expect(paid?.render_id).toBeTruthy();
    await h.sql.query(
      "update render_jobs set status='failed', error_code='engine_error', finished_at=now() where id=$1",
      [paid!.render_id],
    );
    await reconcileTossPayments(deps());
    expect((await loadOwnTossOrder(h.sql, buyer, c.order.id))?.status).toBe(
      'refunded',
    );
    expect(gateway.confirmCalls).toBe(1);
    expect(gateway.cancelCalls).toBe(1);
  });

  it('does not let a temporarily unreadable photo monopolize the recovery batch', async () => {
    const c = await order();
    if (!c.ok) throw new Error(c.code);
    gateway.authorize(c.order.id, c.order.amountKrw);
    const broken = {
      ...deps(),
      store: {
        ...deps().store,
        read: async () => {
          throw new Error('temporary storage outage');
        },
      },
    };
    await confirmTossOrder(broken, buyer, {
      orderId: c.order.id,
      paymentKey: gateway.keyFor(c.order.id),
      amount: c.order.amountKrw,
      consent: true,
    });
    const pending = await loadOwnTossOrder(h.sql, buyer, c.order.id);
    expect(pending?.status).toBe('paid');
    expect(pending?.lease_until).not.toBeNull();
    expect((await h.sql.query('select * from render_jobs')).rows).toHaveLength(
      0,
    );
    await h.sql.query(
      "update billing_payments set lease_until=now()-interval '1 minute' where id=$1",
      [c.order.id],
    );
    await reconcileTossPayments(deps());
    expect((await h.sql.query('select * from render_jobs')).rows).toHaveLength(
      1,
    );
  });

  it('rejects a concurrent approval while the first request owns the durable claim', async () => {
    const c = await order();
    if (!c.ok) throw new Error(c.code);
    gateway.authorize(c.order.id, c.order.amountKrw);
    const original = gateway.confirm.bind(gateway);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    gateway.confirm = async (i) => {
      entered();
      await barrier;
      return original(i);
    };
    const args = {
      orderId: c.order.id,
      paymentKey: gateway.keyFor(c.order.id),
      amount: c.order.amountKrw,
      consent: true,
    };
    const first = confirmTossOrder(deps(), buyer, args);
    await waiting;
    expect(await confirmTossOrder(deps(), buyer, args)).toEqual({
      ok: false,
      code: 'already_processed',
    });
    release();
    expect((await first).ok).toBe(true);
    expect(gateway.confirmCalls).toBe(1);
  });
});
