import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';
import { isLocale } from '@/lib/i18n/config';
import { aspectsForMedium } from '@/lib/images/engines';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { isForSale } from '@/lib/twings/products';
import type {
  CreateRenderInput,
  CreateRenderOutcome,
  RenderServiceDeps,
} from '@/lib/renders/service';
import { extensionFor } from '@/lib/renders/store';
import type { TossGateway, TossPayment } from './toss-gateway';

export const TOSS_CONSENT_VERSION = 'refund-2026-09-14-section-2';
export interface TossOrder {
  id: string;
  user_id: string | null;
  environment: 'test' | 'live' | 'fake';
  amount_krw: number;
  status:
    | 'pending'
    | 'confirming'
    | 'paid'
    | 'refund_pending'
    | 'refunded'
    | 'failed';
  payment_key: string | null;
  template_slug: string;
  order_name: string;
  aspect: string;
  locale: 'ko' | 'en';
  render_ref: string;
  input_key: string;
  input_mime: string;
  render_id: string | null;
  fulfilled_at: string | Date | null;
  lease_until: string | Date | null;
  expires_at: string | Date;
}
export interface TossServiceDeps extends RenderServiceDeps {
  gateway: TossGateway;
  createRender: (
    deps: RenderServiceDeps,
    viewer: Viewer,
    input: CreateRenderInput,
  ) => Promise<CreateRenderOutcome>;
}
export type TossFailure = { ok: false; code: string };
export type TossApproval =
  | { ok: true; id: string; held: boolean }
  | TossFailure;
const fail = (code: string): TossFailure => ({ ok: false, code });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clock = (d: { now?: Date }) => d.now ?? new Date();

/** Server-only record. Routes must project fields instead of serialising this object. */
export async function loadOwnTossOrder(
  sql: SqlRunner,
  viewer: Viewer,
  id: string,
): Promise<TossOrder | null> {
  if (!viewer.userId || !uuid.test(id)) return null;
  const { rows } = await sql.query<TossOrder>(
    "select * from billing_payments where id=$1 and user_id=$2 and payment_type='NORMAL'",
    [id, viewer.userId],
  );
  return rows[0] ?? null;
}

export async function createTossOrder(
  deps: TossServiceDeps,
  viewer: Viewer,
  input: CreateRenderInput,
): Promise<
  | { ok: true; order: { id: string; amountKrw: number; name: string } }
  | TossFailure
> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!RENDER_PIPELINE_PUBLIC) return fail('not_open');
  if (viewer.isAdmin) return fail('admin_free');
  const t = await loadPromptBySlug(deps.sql, input.templateSlug);
  if (!t || t.status !== 'published' || t.audience === 'brand') return fail('not_found');
  // Charge the stored KRW price, never a browser amount or an exchange-rate fallback.
  if (!isForSale(t) || !Number.isSafeInteger(t.priceKrw) || t.priceKrw <= 0)
    return fail('not_for_sale');
  if (!(aspectsForMedium(t.medium) as readonly string[]).includes(input.aspect))
    return fail('bad_aspect');
  if (
    !input.photo ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(input.photo.mime) ||
    input.photo.bytes.length === 0
  )
    return fail('bad_photo');
  if (input.photo.bytes.length > 8 * 1024 * 1024)
    return fail('photo_too_large');
  const { rows } = await deps.sql.query<{ n: number }>(
    'select count(*)::int n from billing_payments where user_id=$1 and created_at > $2',
    [viewer.userId, new Date(clock(deps).getTime() - 86400_000)],
  );
  if ((rows[0]?.n ?? 0) >= 20) return fail('rate_limited');
  const id = randomUUID();
  const renderRef = randomUUID();
  const inputKey = `${renderRef}/input.${extensionFor(input.photo.mime)}`;
  const locale = isLocale(input.locale)
    ? input.locale
    : (viewer.locale ?? 'en');
  const name =
    `TWINGS · ${locale === 'ko' ? t.titleKo || t.title : t.title}`.slice(
      0,
      100,
    );
  await deps.store.put(inputKey, input.photo.bytes, input.photo.mime);
  await deps.sql.query(
    `insert into billing_payments
    (id,user_id,environment,amount_krw,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,expires_at,identity_portrait_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      viewer.userId,
      deps.gateway.kind,
      t.priceKrw,
      t.id,
      t.slug,
      name,
      input.aspect,
      locale,
      renderRef,
      inputKey,
      input.photo.mime,
      new Date(clock(deps).getTime() + 30 * 60_000),
      input.portraitId ?? null,
    ],
  );
  return { ok: true, order: { id, amountKrw: t.priceKrw, name } };
}

function matches(p: TossPayment, o: TossOrder): boolean {
  return (
    p.orderId === o.id &&
    p.paymentKey === o.payment_key &&
    p.amount === o.amount_krw &&
    p.currency === 'KRW'
  );
}

/** Claim durably before crossing the provider boundary. The same order never gets two approvals. */
export async function confirmTossOrder(
  deps: TossServiceDeps,
  viewer: Viewer,
  input: {
    orderId: string;
    paymentKey: string;
    amount: number;
    consent: boolean;
  },
): Promise<TossApproval> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!RENDER_PIPELINE_PUBLIC) return fail('not_open');
  if (!input.consent) return fail('consent_required');
  if (
    !uuid.test(input.orderId) ||
    !input.paymentKey ||
    input.paymentKey.length > 200
  )
    return fail('bad_request');
  const claimed = await deps.sql.transaction(
    async (tx): Promise<TossOrder | TossFailure> => {
      const { rows } = await tx.query<TossOrder>(
        "select * from billing_payments where id=$1 and user_id=$2 and payment_type='NORMAL' for update",
        [input.orderId, viewer.userId],
      );
      const o = rows[0];
      if (!o) return fail('not_found');
      if (o.environment !== deps.gateway.kind) return fail('unavailable');
      if (o.status !== 'pending') return fail('already_processed');
      if (!Number.isSafeInteger(input.amount) || input.amount !== o.amount_krw)
        return fail('amount_mismatch');
      if (new Date(o.expires_at) <= clock(deps)) return fail('expired');
      const t = await loadPromptBySlug(tx, o.template_slug);
      if (
        !t ||
        t.status !== 'published' ||
        !isForSale(t) ||
        t.priceKrw !== o.amount_krw
      )
        return fail('price_changed');
      await tx.query(
        `update billing_payments set status='confirming', payment_key=$2, consent_at=$3,
      consent_version=$4, lease_until=$5 where id=$1`,
        [
          o.id,
          input.paymentKey,
          clock(deps),
          TOSS_CONSENT_VERSION,
          new Date(clock(deps).getTime() + 60_000),
        ],
      );
      return { ...o, status: 'confirming', payment_key: input.paymentKey };
    },
  );
  if ('ok' in claimed) return claimed;
  try {
    const p = await deps.gateway.confirm({
      paymentKey: input.paymentKey,
      orderId: claimed.id,
      amount: claimed.amount_krw,
      idempotencyKey: `confirm-${claimed.id}`,
    });
    return await acceptPayment(deps, claimed, p);
  } catch {
    // The approval may already have happened. Keep the durable claim and resolve by GET later.
    return fail('confirm_pending');
  }
}

async function acceptPayment(
  deps: TossServiceDeps,
  o: TossOrder,
  p: TossPayment,
): Promise<TossApproval> {
  if (!matches(p, o)) return fail('provider_mismatch');
  if (p.status !== 'DONE' || p.balance !== o.amount_krw) {
    if (['ABORTED', 'EXPIRED'].includes(p.status))
      await deps.sql.query(
        "update billing_payments set status='failed',failure_code='provider_declined',lease_until=null where id=$1 and status='confirming'",
        [o.id],
      );
    return fail('confirm_pending');
  }
  await deps.sql.query(
    "update billing_payments set status='paid', approved_at=$2,lease_until=null where id=$1 and status='confirming'",
    [o.id, clock(deps)],
  );
  return fulfill(deps, { ...o, status: 'paid' });
}

async function fulfill(
  deps: TossServiceDeps,
  o: TossOrder,
): Promise<TossApproval> {
  if (!o.user_id) {
    await queueRefund(deps.sql, o.id);
    return fail('refund_pending');
  }
  const viewer: Viewer = {
    userId: o.user_id,
    email: null,
    isAdmin: false,
    tier: 'free',
    locale: o.locale,
  };
  try {
    const result = await deps.createRender(deps, viewer, {
      templateSlug: o.template_slug,
      aspect: o.aspect,
      locale: o.locale,
      holdForIdentity: true,
      photo: { bytes: await deps.store.read(o.input_key), mime: o.input_mime },
      paymentOrderId: o.id,
    });
    if (result.ok) return result;
    await queueRefund(deps.sql, o.id);
    await refund(deps, o.id);
    return fail('render_unavailable');
  } catch {
    // Database/storage faults can recover. The paid row is durable and the maintenance pass retries.
    // Back off so a damaged photo cannot occupy every recovery pass ahead of other payments.
    await deps.sql.query(
      "update billing_payments set lease_until=$2 where id=$1 and status='paid' and fulfilled_at is null",
      [o.id, new Date(clock(deps).getTime() + 60_000)],
    );
    return fail('confirm_pending');
  }
}

async function queueRefund(sql: SqlRunner, id: string) {
  await sql.query(
    "update billing_payments set status='refund_pending',lease_until=null where id=$1 and status='paid'",
    [id],
  );
}
async function refund(deps: TossServiceDeps, id: string): Promise<void> {
  const { rows } = await deps.sql.query<TossOrder>(
    `update billing_payments set lease_until=$2
    where id=$1 and status='refund_pending' and (lease_until is null or lease_until <= $3) returning *`,
    [id, new Date(clock(deps).getTime() + 60_000), clock(deps)],
  );
  const o = rows[0];
  if (!o || !o.payment_key || o.environment !== deps.gateway.kind) return;
  try {
    let p = await deps.gateway.retrieve(o.payment_key);
    if (!p || !matches(p, o)) throw new Error('Payment not verified');
    if (p.status !== 'CANCELED' || p.balance !== 0)
      p = await deps.gateway.cancel({
        paymentKey: o.payment_key,
        reason: 'TWINGS render failed',
        idempotencyKey: `refund-${o.id}`,
      });
    if (!matches(p, o) || p.status !== 'CANCELED' || p.balance !== 0)
      throw new Error('Refund not confirmed');
    await deps.sql.query(
      "update billing_payments set status='refunded',refunded_at=$2,lease_until=null where id=$1 and status='refund_pending'",
      [o.id, clock(deps)],
    );
  } catch {
    await deps.sql.query(
      "update billing_payments set lease_until=null,failure_code='refund_retry' where id=$1 and status='refund_pending'",
      [o.id],
    );
  }
}

/** Called by the existing render pass (callback, owner page and daily cron), also while the public gate is closed. */
export async function reconcileTossPayments(
  deps: TossServiceDeps,
): Promise<void> {
  const { rows } = await deps.sql.query<TossOrder>(
    `select p.* from billing_payments p
    left join render_jobs r on r.id=p.render_id
    where p.environment=$1 and p.payment_type='NORMAL' and (
      (p.status='confirming' and p.lease_until <= $2) or
      (p.status='paid' and (p.lease_until is null or p.lease_until <= $2) and (p.fulfilled_at is null or r.status='failed')) or
      (p.status='refund_pending' and (p.lease_until is null or p.lease_until <= $2)))
    order by case when p.status='refund_pending' or r.status='failed' then 0 else 1 end,
      coalesce(p.lease_until,p.updated_at) limit 20`,
    [deps.gateway.kind, clock(deps)],
  );
  for (const o of rows) {
    if (o.status === 'confirming' && o.payment_key) {
      const claimed = await deps.sql.query(
        `update billing_payments set lease_until=$2
        where id=$1 and status='confirming' and lease_until <= $3 returning id`,
        [o.id, new Date(clock(deps).getTime() + 60_000), clock(deps)],
      );
      if (!claimed.rows.length) continue;
      try {
        let p = await deps.gateway.retrieve(o.payment_key);
        if (p && matches(p, o) && p.status === 'IN_PROGRESS')
          p = await deps.gateway.confirm({
            paymentKey: o.payment_key,
            orderId: o.id,
            amount: o.amount_krw,
            idempotencyKey: `confirm-${o.id}`,
          });
        if (p) await acceptPayment(deps, o, p);
      } catch {
        /* Unknown outcome: retain the claim for a later pass, never issue a new order. */
      }
    } else if (o.status === 'paid' && o.fulfilled_at === null) {
      await fulfill(deps, o);
    } else {
      if (o.status === 'paid') await queueRefund(deps.sql, o.id);
      await refund(deps, o.id);
    }
  }
}

export async function renderPaymentStatus(
  sql: SqlRunner,
  renderId: string,
): Promise<string | null> {
  const { rows } = await sql.query<{ status: string }>(
    'select status from billing_payments where render_id=$1',
    [renderId],
  );
  return rows[0]?.status ?? null;
}
