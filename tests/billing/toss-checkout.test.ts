import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeTossGateway } from '@/lib/billing/toss-fake';
import { TossError, type TossPayment } from '@/lib/billing/toss-gateway';
import {
  countManualTossPayments,
  createTossOrder,
  confirmTossOrder,
  reconcileTossPayments,
  reconcileTossWebhook,
  retryTossOrder,
  loadOwnTossOrder,
  TOSS_RECONCILE_BATCH,
  TOSS_RETRY_CAP,
} from '@/lib/billing/toss-service';
import { createRenderJob, runRenderPass } from '@/lib/renders/service';
import { createLocalRenderStore } from '@/lib/renders/store';
import { createFakeMailer } from '@/lib/notify/mailer-fake';
import { createEmailRenderNotifier } from '@/lib/renders/notify';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { deleteSelfie, saveSelfie, savedSelfiePhoto } from '@/lib/identity/selfie-service';
import sharp from 'sharp';

const selfiePng = async (color: string) => ({ bytes: new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: color } }).png().toBuffer()) });

// The three states of RENDER_PIPELINE_PUBLIC (lib/flags.ts). `on` is the public sale most of this
// suite exercises; `review` opens the purchase to the server-marked 심사 계정 only; `off` closes both.
const gate = vi.hoisted(() => ({ mode: 'on' as 'on' | 'review' | 'off' }));
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_PUBLIC() {
    return gate.mode === 'on';
  },
  // The gate the purchase reads (lib/auth/purchase-gate.ts).
  get RENDER_PIPELINE_MODE() {
    return gate.mode;
  },
}));

const buyer = viewerOf('free');
const input = {
  templateSlug: 'static-portrait-window-light',
  aspect: '4:5',
  locale: 'ko',
  photo: { bytes: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg' },
};

interface PaymentRow {
  id: string;
  user_id: string;
  status: string;
  failure_code: string | null;
  payment_key: string | null;
  template_slug: string;
  aspect: string;
  resolution: string | null;
  locale: string;
  amount_krw: number;
  input_key: string;
  input_mime: string;
  identity_portrait_id: string | null;
  identity_selfie_id: string | null;
  lease_until: Date | null;
  consent_at: Date | null;
  consent_version: string | null;
  approved_at: Date | null;
  refunded_at: Date | null;
  expires_at: Date;
  refund_attempts: number;
  fulfil_attempts: number;
  input_deleted_at: Date | null;
  retried_by: string | null;
}

describe('Toss one-time checkout on the real database', () => {
  let h: PromptHarness;
  let gateway: ReturnType<typeof createFakeTossGateway>;
  beforeEach(async () => {
    gate.mode = 'on';
    h = await promptHarness();
    gateway = createFakeTossGateway();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await h.close();
  });
  const deps = () => ({
    sql: h.sql,
    store: createLocalRenderStore(h.root),
    gateway,
    createRender: createRenderJob,
  });
  const order = () => createTossOrder(deps(), buyer, input);
  const row = async (id: string) =>
    (await h.sql.query<PaymentRow>('select * from billing_payments where id=$1', [id])).rows[0]!;
  const renders = async () => (await h.sql.query('select * from render_jobs')).rows;
  const approval = (o: { id: string; amountKrw: number }) => ({
    orderId: o.id,
    paymentKey: gateway.keyFor(o.id),
    amount: o.amountKrw,
    consent: true,
  });
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
  /** An order Toss refused at approval: card declined, nothing charged. */
  async function declined(viewer = buyer, template = input) {
    const created = await createTossOrder(deps(), viewer, template);
    if (!created.ok) throw new Error(created.code);
    gateway.authorize(created.order.id, created.order.amountKrw);
    const original = gateway.confirm;
    gateway.confirm = async () => {
      throw new TossError('HTTP_403', false, 'REJECT_CARD_COMPANY');
    };
    const result = await confirmTossOrder(deps(), viewer, {
      orderId: created.order.id,
      paymentKey: gateway.keyFor(created.order.id),
      amount: created.order.amountKrw,
      consent: true,
    });
    gateway.confirm = original;
    return { order: created.order, result };
  }
  /** An approval whose answer never arrived: the order holds a durable claim, its lease spent. */
  async function confirming() {
    const created = await order();
    if (!created.ok) throw new Error(created.code);
    gateway.authorize(created.order.id, created.order.amountKrw);
    const original = gateway.confirm;
    gateway.confirm = async () => {
      throw new TossError('NETWORK_ERROR');
    };
    expect(await confirmTossOrder(deps(), buyer, approval(created.order))).toEqual({
      ok: false,
      code: 'confirm_pending',
    });
    gateway.confirm = original;
    await h.sql.query(
      "update billing_payments set lease_until=now()-interval '1 minute' where id=$1",
      [created.order.id],
    );
    return created.order;
  }
  /** What the provider would answer for an order — the scripted reads below swap one field. */
  const snapshot = (
    o: { id: string; amountKrw: number },
    status: string,
    balance = o.amountKrw,
  ): TossPayment => ({
    paymentKey: gateway.keyFor(o.id),
    orderId: o.id,
    amount: o.amountKrw,
    currency: 'KRW',
    status,
    balance,
  });

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

  it('pins the saved selfie to its order and render even after the person replaces it', async () => {
    const { bytes: selfieBytes } = await selfiePng('#d6d6d6');
    const first = await saveSelfie(deps(), buyer.userId, { bytes: selfieBytes, mime: 'image/png', consent: true });
    if (!first.ok) throw new Error(first.code);
    const photo = await savedSelfiePhoto(h.sql, deps().store, buyer.userId!, first.id);
    if (!photo) throw new Error('selfie missing');
    const created = await createTossOrder(deps(), buyer, { ...input, selfieId: first.id, photo });
    if (!created.ok) throw new Error(created.code);
    // A replacement between order and approval changes nothing about the paid job.
    const second = await saveSelfie(deps(), buyer.userId, { ...(await selfiePng('#aaaaaa')), mime: 'image/png', consent: true, replaceId: first.id });
    if (!second.ok) throw new Error(second.code);
    expect(second.id).not.toBe(first.id);
    gateway.authorize(created.order.id, created.order.amountKrw);
    const result = await confirmTossOrder(deps(), buyer, {
      orderId: created.order.id, paymentKey: gateway.keyFor(created.order.id),
      amount: created.order.amountKrw, consent: true,
    });
    if (!result.ok) throw new Error(result.code);
    const payment = (await h.sql.query<{identity_selfie_id:string;input_key:string}>(
      'select identity_selfie_id,input_key from billing_payments where id=$1', [created.order.id])).rows[0];
    const render = (await h.sql.query<{identity_selfie_id:string;input_key:string}>(
      'select identity_selfie_id,input_key from render_jobs where id=$1', [result.id])).rows[0];
    if (!payment || !render) throw new Error('Missing payment or render');
    expect(payment.identity_selfie_id).toBe(first.id);
    expect(render.identity_selfie_id).toBe(first.id);
    expect(await deps().store.read(render.input_key)).toEqual(photo.bytes);
    // The replaced selfie no longer answers for a NEW order: the studio must ask for a photo again.
    expect(await savedSelfiePhoto(h.sql, deps().store, buyer.userId!, first.id)).toBeNull();
  });

  it('lets any active photo of the owner pay, stamps last_used_at, and refuses a deleted one', async () => {
    // docs/IDENTITY-SELFIE.md §4 (2.0): up to N photos; the order names one, the server copies its bytes.
    const library = { ...deps(), limit: 3, now: new Date('2026-10-22T09:00:00Z') };
    const a = await saveSelfie(library, buyer.userId, { ...(await selfiePng('#d6d6d6')), mime: 'image/png', consent: true });
    const b = await saveSelfie(library, buyer.userId, { ...(await selfiePng('#a0a0a0')), mime: 'image/png', consent: true });
    if (!a.ok || !b.ok) throw new Error('selfie not saved');
    // b is not the default and still pays: "the owner's active photo", not "the one current photo".
    const photo = await savedSelfiePhoto(h.sql, deps().store, buyer.userId!, b.id);
    if (!photo) throw new Error('selfie missing');
    const created = await createTossOrder(deps(), buyer, { ...input, selfieId: b.id, photo });
    if (!created.ok) throw new Error(created.code);
    const used = async (id: string) => (await h.sql.query<{ last_used_at: Date | null; is_default: boolean }>('select last_used_at,is_default from identity_selfies where id=$1', [id])).rows[0];
    expect(await used(b.id)).toMatchObject({ is_default: false });
    expect((await used(b.id))?.last_used_at).toBeInstanceOf(Date);
    expect((await used(a.id))?.last_used_at).toBeNull();
    expect((await h.sql.query('select identity_selfie_id from billing_payments where id=$1', [created.order.id])).rows[0]).toEqual({ identity_selfie_id: b.id });
    // Deleting the default hands the default to b; a's id never pays again.
    expect(await deleteSelfie(library, buyer.userId, a.id)).toEqual({ ok: true });
    expect(await savedSelfiePhoto(h.sql, deps().store, buyer.userId!, a.id)).toBeNull();
    expect(await used(b.id)).toMatchObject({ is_default: true });
    // Deleting the photo an order was made with is soft: the order keeps its lineage and its own byte copy.
    expect(await deleteSelfie(library, buyer.userId, b.id)).toEqual({ ok: true });
    expect(await savedSelfiePhoto(h.sql, deps().store, buyer.userId!, b.id)).toBeNull();
    const payment = (await h.sql.query<{ identity_selfie_id: string; input_key: string }>('select identity_selfie_id,input_key from billing_payments where id=$1', [created.order.id])).rows[0];
    expect(payment?.identity_selfie_id).toBe(b.id);
    expect(await deps().store.read(payment!.input_key)).toEqual(photo.bytes);
  });

  it('lets the PG review account save a selfie and reach the checkout under RENDER_PIPELINE_PUBLIC=review', async () => {
    // docs/qa/toss-checkout/PG-REVIEW-MODE.md: the reviewer logs in, uploads the one photo, pays with test keys.
    gate.mode = 'review';
    const reviewer = { ...viewerOf('free'), review: true };
    const saved = await saveSelfie(deps(), reviewer.userId, { ...(await selfiePng('#cccccc')), mime: 'image/png', consent: true });
    if (!saved.ok) throw new Error(saved.code);
    const photo = await savedSelfiePhoto(h.sql, deps().store, reviewer.userId!, saved.id);
    if (!photo) throw new Error('selfie missing');
    const created = await createTossOrder(deps(), reviewer, { ...input, selfieId: saved.id, photo });
    expect(created.ok).toBe(true);
    // An ordinary customer with the same selfie is still refused: review mode is not the public sale.
    // (Same account in this fixture, so the new photo replaces the reviewer's under the default limit of 1.)
    const customer = await saveSelfie(deps(), buyer.userId, { ...(await selfiePng('#bbbbbb')), mime: 'image/png', consent: true, replaceId: saved.id });
    if (!customer.ok) throw new Error(customer.code);
    expect(await createTossOrder(deps(), buyer, { ...input, selfieId: customer.id, photo })).toEqual({ ok: false, code: 'not_open' });
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
    gate.mode = 'off';
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
    gate.mode = 'off';
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

  describe('an approval that cannot succeed ends the order (docs/PLATFORM-2.0.md §2.2-1, -2, -7)', () => {
    it('fails a definitive refusal at once, with its reason, and charges nothing', async () => {
      const { order: o, result } = await declined();
      expect(result).toEqual({ ok: false, code: 'declined' });
      expect(await row(o.id)).toMatchObject({ status: 'failed', failure_code: 'declined', lease_until: null });
      expect(await renders()).toHaveLength(0);
      // The provider still holds an unapproved authorization; nothing is ever confirmed for it.
      expect(gateway.confirmCalls).toBe(0);
      // A second return of the same window cannot restart it.
      expect(await confirmTossOrder(deps(), buyer, approval(o))).toEqual({ ok: false, code: 'already_processed' });
    });

    it('accepts a refusal the provider had in fact approved, instead of failing a captured payment', async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      gateway.authorize(c.order.id, c.order.amountKrw);
      const original = gateway.confirm.bind(gateway);
      gateway.confirm = async (i) => {
        await original(i);
        throw new TossError('HTTP_400', false, 'ALREADY_PROCESSED_PAYMENT');
      };
      expect(await confirmTossOrder(deps(), buyer, approval(c.order))).toMatchObject({ ok: true });
      expect(await row(c.order.id)).toMatchObject({ status: 'paid' });
      expect(await renders()).toHaveLength(1);
    });

    it('keeps the durable claim only for an outcome it cannot know: network, 5xx, timeout', async () => {
      for (const error of [new TossError('NETWORK_ERROR'), new TossError('HTTP_503', true), new Error('socket hang up')]) {
        const c = await order();
        if (!c.ok) throw new Error(c.code);
        gateway.authorize(c.order.id, c.order.amountKrw);
        const original = gateway.confirm;
        gateway.confirm = async () => {
          throw error;
        };
        expect(await confirmTossOrder(deps(), buyer, approval(c.order))).toEqual({ ok: false, code: 'confirm_pending' });
        gateway.confirm = original;
        expect(await row(c.order.id)).toMatchObject({ status: 'confirming', failure_code: null });
      }
    });

    it('fails an order whose price changed, without ever reaching the provider', async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      gateway.authorize(c.order.id, c.order.amountKrw);
      await h.sql.query('update prompt_items set price_krw = price_krw + 1000 where slug = $1', [input.templateSlug]);
      expect(await confirmTossOrder(deps(), buyer, approval(c.order))).toEqual({ ok: false, code: 'price_changed' });
      expect(await row(c.order.id)).toMatchObject({ status: 'failed', failure_code: 'price_changed', payment_key: null });
      expect(gateway.confirmCalls).toBe(0);
    });

    it('fails an order the closed gate can no longer take', async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      gate.mode = 'off';
      expect(await confirmTossOrder(deps(), buyer, approval(c.order))).toEqual({ ok: false, code: 'not_open' });
      expect(await row(c.order.id)).toMatchObject({ status: 'failed', failure_code: 'not_open' });
      expect(gateway.confirmCalls).toBe(0);
    });

    it('fails an order returned after its window and removes its photo', async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      await h.sql.query("update billing_payments set expires_at=now()-interval '1 minute' where id=$1", [c.order.id]);
      expect(await confirmTossOrder(deps(), buyer, approval(c.order))).toEqual({ ok: false, code: 'expired' });
      const r = await row(c.order.id);
      expect(r).toMatchObject({ status: 'failed', failure_code: 'expired' });
      expect(r.input_deleted_at).not.toBeNull();
      await expect(deps().store.read(r.input_key)).rejects.toThrow();
    });

    it('keeps the consent recorded before the window opened', async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      const consented = new Date('2026-10-22T01:02:03.000Z');
      await h.sql.query("update billing_payments set consent_at=$2, consent_version='before-window' where id=$1", [c.order.id, consented]);
      gateway.authorize(c.order.id, c.order.amountKrw);
      expect(await confirmTossOrder(deps(), buyer, approval(c.order))).toMatchObject({ ok: true });
      const r = await row(c.order.id);
      expect(new Date(r.consent_at!).toISOString()).toBe(consented.toISOString());
      expect(r.consent_version).toBe('before-window');
    });

    it('lets the server-marked review account order and pay under review mode, and nobody else', async () => {
      gate.mode = 'review';
      const reviewer = { ...buyer, review: true };
      expect(await createTossOrder(deps(), buyer, input)).toEqual({ ok: false, code: 'not_open' });
      expect(await createTossOrder(deps(), viewerOf('pro'), input)).toEqual({ ok: false, code: 'not_open' });
      const created = await createTossOrder(deps(), reviewer, input);
      if (!created.ok) throw new Error(created.code);
      gateway.authorize(created.order.id, created.order.amountKrw);
      expect(await confirmTossOrder(deps(), reviewer, approval(created.order))).toMatchObject({ ok: true });
      expect(await row(created.order.id)).toMatchObject({ status: 'paid' });
      expect(await renders()).toHaveLength(1);
    });
  });

  describe('다시 결제하기: a new order from a failed one', () => {
    it('keeps the owner, template, options and photo, leaves the original failed, and answers a second press with the same order', async () => {
      const { order: o } = await declined();
      const retried = await retryTossOrder(deps(), buyer, o.id);
      if (!retried.ok) throw new Error(retried.code);
      expect(retried.order.id).not.toBe(o.id);
      const [old, fresh] = [await row(o.id), await row(retried.order.id)];
      expect(old).toMatchObject({ status: 'failed', failure_code: 'declined', retried_by: retried.order.id });
      expect(fresh).toMatchObject({
        status: 'pending',
        user_id: buyer.userId,
        template_slug: old.template_slug,
        aspect: old.aspect,
        resolution: old.resolution,
        locale: old.locale,
        identity_portrait_id: old.identity_portrait_id,
        amount_krw: old.amount_krw,
        payment_key: null,
        consent_at: null,
      });
      expect(fresh.input_key).not.toBe(old.input_key);
      expect(await deps().store.read(fresh.input_key)).toEqual(input.photo.bytes);
      // The failed order's own copy is no longer needed once its retry holds one.
      expect(old.input_deleted_at).not.toBeNull();
      expect(await retryTossOrder(deps(), buyer, o.id)).toMatchObject({ ok: true, order: { id: retried.order.id } });
      expect((await h.sql.query('select id from billing_payments')).rows).toHaveLength(2);
    });

    it('carries a film order’s resolution and its price for that resolution', async () => {
      const film = { templateSlug: 'neon-alley-dolly', aspect: '9:16', locale: 'ko', resolution: '1080p', photo: input.photo };
      await h.sql.query('update prompt_items set price_krw = 5900 where slug = $1', [film.templateSlug]);
      const { order: o } = await declined(buyer, film);
      const retried = await retryTossOrder(deps(), buyer, o.id);
      if (!retried.ok) throw new Error(retried.code);
      expect(await row(retried.order.id)).toMatchObject({ resolution: '1080p', amount_krw: o.amountKrw, aspect: '9:16' });
    });

    it('serves only the owner’s failed, retryable order, through the open gate and the daily order limit', async () => {
      const { order: o } = await declined();
      expect(await retryTossOrder(deps(), viewerOf('pro'), o.id)).toEqual({ ok: false, code: 'not_found' });
      expect(await retryTossOrder(deps(), viewerOf('anon'), o.id)).toEqual({ ok: false, code: 'sign_in_required' });
      const pending = await order();
      if (!pending.ok) throw new Error(pending.code);
      expect(await retryTossOrder(deps(), buyer, pending.order.id)).toEqual({ ok: false, code: 'not_retryable' });
      gate.mode = 'off';
      expect(await retryTossOrder(deps(), buyer, o.id)).toEqual({ ok: false, code: 'not_open' });
      gate.mode = 'on';
      for (let i = 0; i < 18; i++) expect((await order()).ok).toBe(true);
      expect(await retryTossOrder(deps(), buyer, o.id)).toEqual({ ok: false, code: 'rate_limited' });
      expect(await row(o.id)).toMatchObject({ status: 'failed', retried_by: null, input_deleted_at: null });
    });

    it('keeps the saved photo’s lineage, and never buys again a photo replaced or deleted since', async () => {
      // docs/IDENTITY-SELFIE.md §4: a retry is a NEW order, so its photo must still be one of the reader's active ones.
      const library = { ...deps(), limit: 3 };
      const kept = await saveSelfie(library, buyer.userId, { ...(await selfiePng('#d6d6d6')), mime: 'image/png', consent: true });
      const gone = await saveSelfie(library, buyer.userId, { ...(await selfiePng('#a0a0a0')), mime: 'image/png', consent: true });
      if (!kept.ok || !gone.ok) throw new Error('selfie not saved');
      const withSelfie = async (selfieId: string) => {
        const photo = await savedSelfiePhoto(h.sql, deps().store, buyer.userId!, selfieId);
        if (!photo) throw new Error('selfie missing');
        return { ...input, selfieId, photo: { bytes: new Uint8Array(photo.bytes), mime: photo.mime } };
      };
      const onKept = await declined(buyer, await withSelfie(kept.id));
      const onGone = await declined(buyer, await withSelfie(gone.id));
      const onReplaced = await declined(buyer, await withSelfie(kept.id));
      await h.sql.query('update identity_selfies set last_used_at=null where id=$1', [kept.id]);
      const retried = await retryTossOrder(deps(), buyer, onKept.order.id);
      if (!retried.ok) throw new Error(retried.code);
      expect(await row(retried.order.id)).toMatchObject({ status: 'pending', identity_selfie_id: kept.id });
      expect((await h.sql.query<{ last_used_at: Date | null }>('select last_used_at from identity_selfies where id=$1', [kept.id])).rows[0]?.last_used_at).toBeInstanceOf(Date);
      // Deleted after the card was declined: 다시 결제하기 answers selfie_required and the failed order stays as it was.
      expect(await deleteSelfie(library, buyer.userId, gone.id)).toEqual({ ok: true });
      expect(await retryTossOrder(deps(), buyer, onGone.order.id)).toEqual({ ok: false, code: 'selfie_required' });
      expect(await row(onGone.order.id)).toMatchObject({ status: 'failed', retried_by: null, input_deleted_at: null });
      // Replaced after the card was declined: the same answer.
      const fresh = await saveSelfie(library, buyer.userId, { ...(await selfiePng('#707070')), mime: 'image/png', consent: true, replaceId: kept.id });
      expect(fresh).toMatchObject({ ok: true, replaced: true });
      expect(await retryTossOrder(deps(), buyer, onReplaced.order.id)).toEqual({ ok: false, code: 'selfie_required' });
      expect(await row(onReplaced.order.id)).toMatchObject({ status: 'failed', retried_by: null });
    });

    it('does not offer a new order where the reason is not the card’s: a changed price starts again from the template', async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      await h.sql.query('update prompt_items set price_krw = price_krw + 1000 where slug = $1', [input.templateSlug]);
      await confirmTossOrder(deps(), buyer, approval(c.order));
      expect(await retryTossOrder(deps(), buyer, c.order.id)).toEqual({ ok: false, code: 'not_retryable' });
    });
  });

  describe('every order ends in a named state (docs/PLATFORM-2.0.md §2.2-4, -6)', () => {
    const scripted = (answer: (key: string) => TossPayment | null) => {
      gateway.retrieve = async (key) => answer(key);
    };

    it.each([
      ['CANCELED', 0, 'failed', 'canceled'],
      ['ABORTED', undefined, 'failed', 'aborted'],
      ['EXPIRED', undefined, 'failed', 'expired'],
    ])('a confirming order the provider reports %s ends %s(%s)', async (status, balance, ours, reason) => {
      const o = await confirming();
      scripted(() => snapshot(o, status, balance ?? o.amountKrw));
      const report = await reconcileTossPayments(deps());
      expect(await row(o.id)).toMatchObject({ status: ours, failure_code: reason, lease_until: null });
      expect(report).toMatchObject({ failed: 1, confirmed: 0 });
      expect(await renders()).toHaveLength(0);
    });

    it('a payment key the provider does not know ends failed(unknown_payment)', async () => {
      const o = await confirming();
      scripted(() => null);
      await reconcileTossPayments(deps());
      expect(await row(o.id)).toMatchObject({ status: 'failed', failure_code: 'unknown_payment' });
    });

    it('a refusal the provider replays at recovery ends failed(declined)', async () => {
      const o = await confirming();
      gateway.confirm = async () => {
        throw new TossError('HTTP_403', false, 'REJECT_CARD_COMPANY');
      };
      await reconcileTossPayments(deps());
      expect(await row(o.id)).toMatchObject({ status: 'failed', failure_code: 'declined' });
    });

    it('a record that belongs to another order is never accepted', async () => {
      const o = await confirming();
      scripted(() => ({ ...snapshot(o, 'DONE'), orderId: '00000000-0000-4000-8000-000000000000' }));
      await reconcileTossPayments(deps());
      expect(await row(o.id)).toMatchObject({ status: 'failed', failure_code: 'provider_mismatch' });
      expect(await renders()).toHaveLength(0);
    });

    it('a partial balance waits for an operator, approved and never refunded automatically', async () => {
      const o = await confirming();
      scripted(() => snapshot(o, 'PARTIAL_CANCELED', o.amountKrw - 1000));
      expect(await reconcileTossPayments(deps())).toMatchObject({ manual: 1 });
      const r = await row(o.id);
      expect(r).toMatchObject({ status: 'refund_pending', failure_code: 'partial_balance' });
      expect(r.approved_at).not.toBeNull();
      await reconcileTossPayments(deps());
      expect(gateway.cancelCalls).toBe(0);
      expect(await countManualTossPayments(h.sql)).toBe(1);
    });

    it('waits for a deposit only until the order’s window, then ends failed(expired)', async () => {
      const o = await confirming();
      scripted(() => snapshot(o, 'WAITING_FOR_DEPOSIT'));
      await reconcileTossPayments(deps());
      expect(await row(o.id)).toMatchObject({ status: 'confirming' });
      await h.sql.query(
        "update billing_payments set expires_at=now()-interval '1 minute', lease_until=now()-interval '1 minute' where id=$1",
        [o.id],
      );
      await reconcileTossPayments(deps());
      expect(await row(o.id)).toMatchObject({ status: 'failed', failure_code: 'expired' });
    });

    it('an unpaid order past its window ends failed(expired) and its photo is deleted', async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      const before = await row(c.order.id);
      expect(await deps().store.read(before.input_key)).toEqual(input.photo.bytes);
      await h.sql.query("update billing_payments set expires_at=now()-interval '1 minute' where id=$1", [c.order.id]);
      expect(await reconcileTossPayments(deps())).toMatchObject({ failed: 1 });
      const after = await row(c.order.id);
      expect(after).toMatchObject({ status: 'failed', failure_code: 'expired' });
      expect(after.input_deleted_at).not.toBeNull();
      await expect(deps().store.read(after.input_key)).rejects.toThrow();
    });

    it('keeps a declined order’s photo for its retry until the window passes, then deletes it', async () => {
      const { order: o } = await declined();
      await reconcileTossPayments(deps());
      const kept = await row(o.id);
      expect(await deps().store.read(kept.input_key)).toEqual(input.photo.bytes);
      await h.sql.query("update billing_payments set expires_at=now()-interval '1 minute' where id=$1", [o.id]);
      await reconcileTossPayments(deps());
      expect((await row(o.id)).input_deleted_at).not.toBeNull();
      await expect(deps().store.read(kept.input_key)).rejects.toThrow();
    });

    it(`stops refunding after ${TOSS_RETRY_CAP} failed tries: refund_manual, one failure email, no further provider calls`, async () => {
      const { result } = await pay();
      if (!result.ok) throw new Error(result.code);
      await h.sql.query(
        "update render_jobs set status='failed', error_code='engine_error', finished_at=now() where id=$1",
        [result.id],
      );
      gateway.failCancel = true;
      let attempts = 0;
      const cancel = gateway.cancel.bind(gateway);
      gateway.cancel = async (i) => {
        attempts += 1;
        return cancel(i);
      };
      let now = new Date();
      let manual = 0;
      for (let i = 0; i < TOSS_RETRY_CAP + 3; i++) {
        manual += (await reconcileTossPayments({ ...deps(), now })).manual;
        now = new Date(now.getTime() + 2 * 3600_000);
      }
      expect(attempts).toBe(TOSS_RETRY_CAP);
      expect(manual).toBe(1);
      expect((await h.sql.query<PaymentRow>('select * from billing_payments')).rows[0]).toMatchObject({
        status: 'refund_pending',
        failure_code: 'refund_manual',
        refund_attempts: TOSS_RETRY_CAP,
        lease_until: null,
      });
      expect(await countManualTossPayments(h.sql)).toBe(1);
      const mailer = createFakeMailer();
      const pass = { ...deps(), now, tossGateway: gateway, siteUrl: 'https://twings.test', notifier: createEmailRenderNotifier(mailer) };
      await runRenderPass(pass);
      await runRenderPass(pass);
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.text).not.toContain('refunded in full');
      expect(attempts).toBe(TOSS_RETRY_CAP);
    });

    it('backs off between refund tries instead of spending them on every page refresh', async () => {
      const { result } = await pay();
      if (!result.ok) throw new Error(result.code);
      await h.sql.query("update render_jobs set status='failed', error_code='engine_error', finished_at=now() where id=$1", [result.id]);
      gateway.failCancel = true;
      for (let i = 0; i < 8; i++) await reconcileTossPayments(deps());
      // The first three failures retry at once (a dropped connection, a provider blip); later ones wait.
      const after = (await h.sql.query<PaymentRow>('select * from billing_payments')).rows[0]!;
      expect(after).toMatchObject({ refund_attempts: 4, status: 'refund_pending', failure_code: 'refund_retry' });
      expect(new Date(after.lease_until!).getTime()).toBeGreaterThan(Date.now() + 30_000);
    });

    it(`stops creating the render after ${TOSS_RETRY_CAP} failed tries: fulfil_manual, excluded from later passes`, async () => {
      const c = await order();
      if (!c.ok) throw new Error(c.code);
      gateway.authorize(c.order.id, c.order.amountKrw);
      const broken = {
        ...deps(),
        store: {
          ...deps().store,
          read: async () => {
            throw new Error('photo unreadable');
          },
        },
      };
      await confirmTossOrder(broken, buyer, approval(c.order));
      let now = new Date();
      for (let i = 0; i < TOSS_RETRY_CAP + 3; i++) {
        await reconcileTossPayments({ ...broken, now });
        now = new Date(now.getTime() + 2 * 3600_000);
      }
      expect(await row(c.order.id)).toMatchObject({
        status: 'paid',
        failure_code: 'fulfil_manual',
        fulfil_attempts: TOSS_RETRY_CAP,
        lease_until: null,
      });
      await reconcileTossPayments({ ...deps(), now });
      expect(await renders()).toHaveLength(0);
      expect(await countManualTossPayments(h.sql)).toBe(1);
    });

    it(`handles at most ${TOSS_RECONCILE_BATCH} orders a pass`, async () => {
      const template = (await h.sql.query<{ id: string }>('select id from prompt_items where slug=$1', [input.templateSlug])).rows[0]!;
      for (let i = 0; i < TOSS_RECONCILE_BATCH + 10; i++) {
        const id = crypto.randomUUID();
        await h.sql.query(
          `insert into billing_payments (id,user_id,environment,amount_krw,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,expires_at)
           values ($1,$2,'fake',2500,$3,$4,'TWINGS',$5,'ko',$6,$7,'image/jpeg',now()-interval '1 minute')`,
          [id, buyer.userId, template.id, input.templateSlug, input.aspect, id, `${id}/input.jpg`],
        );
      }
      expect(await reconcileTossPayments(deps())).toMatchObject({ failed: TOSS_RECONCILE_BATCH });
      expect((await h.sql.query("select id from billing_payments where status='pending'")).rows).toHaveLength(10);
      expect(await reconcileTossPayments(deps())).toMatchObject({ failed: 10 });
    });

    it('counts what it settled: confirmed, refunded, failed, manual', async () => {
      const lost = await order();
      if (!lost.ok) throw new Error(lost.code);
      gateway.authorize(lost.order.id, lost.order.amountKrw);
      gateway.loseConfirmResponse = true;
      await confirmTossOrder(deps(), buyer, approval(lost.order));
      await h.sql.query("update billing_payments set lease_until=now()-interval '1 minute' where id=$1", [lost.order.id]);
      const { result } = await pay();
      if (!result.ok) throw new Error(result.code);
      await h.sql.query("update render_jobs set status='failed', error_code='engine_error', finished_at=now() where id=$1", [result.id]);
      const stale = await order();
      if (!stale.ok) throw new Error(stale.code);
      await h.sql.query("update billing_payments set expires_at=now()-interval '1 minute' where id=$1", [stale.order.id]);
      expect(await reconcileTossPayments(deps())).toEqual({ confirmed: 1, refunded: 1, failed: 1, manual: 0 });
    });

    it('settles only the order a status poll names', async () => {
      const mine = await order();
      const theirs = await createTossOrder(deps(), viewerOf('pro'), input);
      if (!mine.ok || !theirs.ok) throw new Error('order');
      await h.sql.query("update billing_payments set expires_at=now()-interval '1 minute'");
      await reconcileTossPayments(deps(), { orderId: mine.order.id });
      expect(await row(mine.order.id)).toMatchObject({ status: 'failed', failure_code: 'expired' });
      expect(await row(theirs.order.id)).toMatchObject({ status: 'pending' });
    });

    it('keeps rendering when the Toss key configuration is broken, with one log line and no key in it', async () => {
      const { result } = await pay();
      if (!result.ok) throw new Error(result.code);
      vi.stubEnv('TOSS_CLIENT_KEY', 'test_ck_wrongkindprobe');
      vi.stubEnv('TOSS_SECRET_KEY', 'test_sk_wrongkindprobe');
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const forcedFailure = async () => {
        throw new Error('forced terminal failure');
      };
      const report = await runRenderPass(
        { ...deps(), siteUrl: 'https://twings.test', notifier: null, engines: { openai: { edit: forcedFailure, generate: forcedFailure } } } as Parameters<typeof runRenderPass>[0],
        { jobId: result.id },
      );
      expect(report.claimed).toBe(1);
      const lines = errors.mock.calls.map((call) => call.map(String).join(' '));
      expect(lines.filter((line) => line.includes('toss_gateway_unavailable'))).toHaveLength(1);
      expect(lines.join('\n')).not.toContain('wrongkindprobe');
    });
  });

  describe('the webhook is a hint: the provider is read again (docs/PLATFORM-2.0.md §2.2-5)', () => {
    it('learns a console cancellation of a paid order', async () => {
      const { created } = await pay();
      await gateway.cancel({ paymentKey: gateway.keyFor(created.order.id), reason: 'console', idempotencyKey: 'console-1' });
      const outcome = await reconcileTossWebhook(deps(), { orderId: created.order.id, paymentKey: 'forged', status: 'DONE' });
      expect(outcome.matched).toBe(true);
      const r = await row(created.order.id);
      expect(r).toMatchObject({ status: 'refunded' });
      expect(r.refunded_at).not.toBeNull();
    });

    it('finds the order by its payment key when the hint carries no order id', async () => {
      const { created } = await pay();
      await gateway.cancel({ paymentKey: gateway.keyFor(created.order.id), reason: 'console', idempotencyKey: 'console-2' });
      expect(await reconcileTossWebhook(deps(), { paymentKey: gateway.keyFor(created.order.id) })).toMatchObject({ matched: true });
      expect(await row(created.order.id)).toMatchObject({ status: 'refunded' });
    });

    it('leaves a partial console cancellation to an operator', async () => {
      const { created } = await pay();
      gateway.retrieve = async () => snapshot(created.order, 'PARTIAL_CANCELED', created.order.amountKrw - 1000);
      await reconcileTossWebhook(deps(), { orderId: created.order.id });
      expect(await row(created.order.id)).toMatchObject({ status: 'refund_pending', failure_code: 'partial_balance' });
      await reconcileTossPayments(deps());
      expect(gateway.cancelCalls).toBe(0);
    });

    it('refunds money the provider captured for an order we had already called failed', async () => {
      const { order: o } = await declined();
      await gateway.confirm({ paymentKey: gateway.keyFor(o.id), orderId: o.id, amount: o.amountKrw, idempotencyKey: 'elsewhere' });
      await reconcileTossWebhook(deps(), { orderId: o.id });
      expect(await row(o.id)).toMatchObject({ status: 'refunded' });
      expect(gateway.cancelCalls).toBe(1);
    });

    it('changes nothing for a record that does not match, and reads nothing for an unknown order', async () => {
      const { created } = await pay();
      let reads = 0;
      gateway.retrieve = async () => {
        reads += 1;
        return { ...snapshot(created.order, 'CANCELED', 0), orderId: '00000000-0000-4000-8000-000000000000' };
      };
      await reconcileTossWebhook(deps(), { orderId: created.order.id });
      expect(await row(created.order.id)).toMatchObject({ status: 'paid' });
      reads = 0;
      expect(await reconcileTossWebhook(deps(), { orderId: '00000000-0000-4000-8000-000000000009' })).toEqual({ matched: false });
      expect(await reconcileTossWebhook(deps(), { paymentKey: 'nobody' })).toEqual({ matched: false });
      expect(await reconcileTossWebhook(deps(), {})).toEqual({ matched: false });
      expect(reads).toBe(0);
    });
  });
});
