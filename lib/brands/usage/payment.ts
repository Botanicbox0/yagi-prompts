import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { TossError, type TossGateway, type TossPayment } from '@/lib/billing/toss-gateway';
import { UsageResolveSchema } from './schemas';
import {
  Denied, type Row, uuid, stamp, fail, clock, studio, mutation, buyer, lockCase, setStatus, usageEvent,
  checkQuoteBasis, recordOutcome, activateUsageCase,
} from './core';
import { usageRuntimeFromEnv, type UsageRuntime } from './runtime';
import type { UsageOutcome } from './types';

/**
 * One-time payment for an accepted secondary-usage quote. docs/SECONDARY-USAGE.md.
 *
 * Reuses the Toss gateway seam and the claim → confirm → accept/lease pattern of render checkout, but
 * NOT its table or service: nothing here reads `RENDER_PIPELINE_PUBLIC`, writes `billing_payments`,
 * or creates a render. The amount always comes from the accepted quote; the browser's amount must
 * only match it. Refunds happen only through an administrator's explicit decision.
 *
 * Provider outcomes, on every path (claim, confirm, reconcile, studio release):
 *   · a snapshot that does not match the order (id, key, amount, currency)     → `review`, never a grant
 *   · DONE with the full balance                                             → `paid` → activation guard
 *   · ABORTED / EXPIRED, or CANCELED with nothing held                       → `failed` (no money moved)
 *   · PARTIAL_CANCELED, WAITING_FOR_DEPOSIT, CANCELED/DONE with an odd balance → `review` (studio decides)
 *   · IN_PROGRESS / READY                                                    → still pending at the provider
 *   · not found: proof of non-payment only once the approval window is over, or right after the provider
 *     itself refused the confirm. A timeout or network error proves nothing and keeps the claim.
 */
export interface UsagePaymentDeps { sql: SqlRunner; gateway: TossGateway; paymentsOpen: boolean; now?: Date; runtime?: UsageRuntime }
export const USAGE_PAYMENT_CONSENT_VERSION = 'usage-payment-2026-09-23';
const LEASE_MS = 60_000;
/** An unknown outcome is retried later, never at the head of every pass. */
const BACKOFF_MS = 10 * 60_000;
const ORDER_WINDOW_MS = 30 * 60_000;
/** After an order's window, the provider's own approval window (10 minutes) plus margin. */
const PROVIDER_WINDOW_MS = 30 * 60_000;
const BATCH = 20;
const runtimeOf = (deps: { runtime?: UsageRuntime }) => deps.runtime ?? usageRuntimeFromEnv();
/** On production only live keys can take a binding payment; test keys and the fake stay on previews/local. */
const liveEnough = (deps: { gateway: TossGateway; runtime?: UsageRuntime }) => !runtimeOf(deps).production || deps.gateway.kind === 'live';

const CreateSchema = z.object({ caseId: z.string().uuid(), requestId: z.string().uuid(), consent: z.boolean() });
/**
 * Create (or return the one live) order for the case's accepted quote. The buyer confirmed the full
 * terms (`consent`) and every term is already fixed: nothing about the price or scope is decided here.
 */
export async function createUsageOrder(deps: UsagePaymentDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome<{ order: { id: string; amountKrw: number; name: string } }>> {
  if (deps.paymentsOpen !== true || !liveEnough(deps)) return fail('payments_closed');
  const parsed = CreateSchema.safeParse(input);
  if (parsed.success && parsed.data.consent !== true) return fail('invalid');
  return mutation(deps.sql, viewer, CreateSchema, input, async (sql, userId, v) => {
    const c = await lockCase(sql, v.caseId);
    const { project: p } = await buyer(sql, userId, String(c.project_id));
    if (c.status !== 'accepted') throw new Denied('conflict');
    const quote = (await sql.query("select * from brand_usage_quotes where case_id=$1 and status='accepted'", [c.id])).rows[0];
    const now = clock(deps);
    // Only a final tax-inclusive total is ever charged; a tax-excluded amount is not what the brand pays.
    if (!quote || now >= new Date(stamp(quote.valid_until)) || quote.tax_basis !== 'included') throw new Denied('conflict');
    await sql.query("update brand_usage_payments set status='expired',updated_at=now() where quote_id=$1 and status='pending' and (expires_at<=$2 or environment<>$3)", [quote.id, now, deps.gateway.kind]);
    const live = (await sql.query("select * from brand_usage_payments where quote_id=$1 and status in ('pending','confirming','paid','refund_pending','refunded','review')", [quote.id])).rows[0];
    if (live) {
      if (live.status !== 'pending') throw new Denied('conflict');
      return { id: String(live.id), order: { id: String(live.id), amountKrw: Number(live.amount_krw), name: String(live.order_name) } };
    }
    const attempts = (await sql.query<{ n: number }>('select count(*)::int n from brand_usage_payments where case_id=$1', [c.id])).rows[0]!.n;
    if (attempts >= 10) throw new Denied('rate_limited');
    const id = randomUUID();
    // Server-built, no creator name: the brand's own campaign and the quote revision.
    const name = `TWINGS 2차 활용 · ${String(p.title)}`.slice(0, 90) + ` #${Number(quote.revision)}`;
    const expires = new Date(Math.min(+now + ORDER_WINDOW_MS, +new Date(stamp(quote.valid_until))));
    await sql.query(`insert into brand_usage_payments(id,organization_id,project_id,case_id,quote_id,environment,amount_krw,order_name,expires_at,consent_version,consent_at,created_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, c.organization_id, c.project_id, c.id, quote.id, deps.gateway.kind, quote.total_krw, name, expires, USAGE_PAYMENT_CONSENT_VERSION, now, userId, v.requestId]);
    await usageEvent(sql, c.id, 'order_created', 'brand', userId, quote.id);
    return { id, order: { id, amountKrw: Number(quote.total_krw), name } };
  });
}

/** The buyer's own order on a campaign they still hold a buyer seat in; null otherwise. Server-only row. */
export async function loadOwnUsageOrder(sql: SqlRunner, viewer: Viewer, orderId: string): Promise<Row | null> {
  if (!uuid(viewer.userId) || !uuid(orderId)) return null;
  try { return await sql.transaction(async tx => {
    const o = (await tx.query('select * from brand_usage_payments where id=$1', [orderId])).rows[0];
    if (!o) return null;
    await buyer(tx, viewer.userId!, String(o.project_id));
    return o;
  }); } catch (error) { if (error instanceof Denied) return null; throw error; }
}

function matches(p: TossPayment, o: Row): boolean {
  return p.orderId === o.id && p.paymentKey === o.payment_key && p.amount === Number(o.amount_krw) && p.currency === 'KRW';
}
type Settled = { ok: true; id: string; state: string; projectId: string } | { ok: false; code: 'payment_failed' | 'payment_review' | 'confirm_pending' };

/** Leave the claim for a later pass, pushed behind every other row. Never proof of anything. */
async function keep(deps: { sql: SqlRunner; now?: Date }, o: Row): Promise<Settled> {
  await deps.sql.query("update brand_usage_payments set lease_until=$2,updated_at=now() where id=$1 and status='confirming'", [o.id, new Date(+clock(deps) + BACKOFF_MS)]);
  return { ok: false, code: 'confirm_pending' };
}
/** Provider-verified non-payment: the claim is released; the case stays accepted so the buyer may retry. */
async function release(deps: { sql: SqlRunner }, o: Row, code: string, from = 'confirming'): Promise<Settled> {
  const done = (await deps.sql.query("update brand_usage_payments set status='failed',failure_code=$2,lease_until=null,updated_at=now() where id=$1 and status=$3 returning id", [o.id, code, from])).rows[0];
  if (done) await usageEvent(deps.sql, o.case_id, 'payment_failed', 'system', null, o.quote_id);
  return { ok: false, code: 'payment_failed' };
}
/** Neither approved nor provably unpaid: never granted, blocks new orders, the studio decides. */
async function review(deps: { sql: SqlRunner }, o: Row, code: string): Promise<Settled> {
  await deps.sql.query("update brand_usage_payments set status='review',failure_code=$2,lease_until=null,updated_at=now() where id=$1 and status='confirming'", [o.id, code.slice(0, 40)]);
  return { ok: false, code: 'payment_review' };
}

/**
 * Apply one provider snapshot to a `confirming` order. `null` means the provider has no payment for the
 * key; that is proof of non-payment only when `notFoundIsFinal` (the window is over, or the provider
 * just refused the confirm).
 */
async function settle(deps: Omit<UsagePaymentDeps, 'paymentsOpen'>, o: Row, p: TossPayment | null, notFoundIsFinal: boolean): Promise<Settled> {
  if (p === null) return notFoundIsFinal ? release(deps, o, 'provider_not_found') : keep(deps, o);
  if (!matches(p, o)) return review(deps, o, 'provider_mismatch');
  const amount = Number(o.amount_krw);
  switch (p.status) {
    case 'DONE':
      return p.balance === amount ? accept(deps, o) : review(deps, o, 'provider_balance');
    case 'ABORTED': case 'EXPIRED':
      return release(deps, o, 'provider_declined');
    case 'CANCELED':
      return p.balance === 0 ? release(deps, o, 'provider_canceled') : review(deps, o, 'provider_canceled_balance');
    case 'IN_PROGRESS': case 'READY':
      return notFoundIsFinal && p.status === 'READY' ? release(deps, o, 'provider_not_approved') : keep(deps, o);
    default:
      return review(deps, o, `provider_${p.status.toLowerCase()}`);
  }
}

const ConfirmSchema = z.object({ orderId: z.string().uuid(), paymentKey: z.string().min(1).max(200), amount: z.number() });
/**
 * Claim durably, then cross the provider boundary once. A lost response keeps the claim and its lease;
 * recovery is `reconcileBrandUsagePayments` (the daily tick, the admin op, or a status read).
 * Everything the brand agreed to is re-checked BEFORE the charge, so a withdrawn consent, a superseded
 * quote or an elapsed usage window is refused without charging anyone.
 */
export async function confirmUsagePayment(deps: UsagePaymentDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome<{ id: string; state: string; projectId: string }>> {
  if (!uuid(viewer.userId)) return fail('sign_in_required');
  const parsed = ConfirmSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');
  const v = parsed.data;
  const now = clock(deps);
  let claimed: Row;
  try {
    claimed = await deps.sql.transaction(async sql => {
      const found = (await sql.query('select case_id from brand_usage_payments where id=$1', [v.orderId])).rows[0];
      if (!found) throw new Denied('not_found');
      // Same lock order as every case operation: the case row first, then the payment.
      const c = await lockCase(sql, String(found.case_id));
      try { await buyer(sql, viewer.userId!, String(c.project_id)); } catch { throw new Denied('not_found'); }
      const o = (await sql.query('select * from brand_usage_payments where id=$1 for update', [v.orderId])).rows[0]!;
      if (o.environment !== deps.gateway.kind) throw new Denied('unavailable');
      if (o.status !== 'pending') throw new Denied('already_processed');
      if (!Number.isSafeInteger(v.amount) || v.amount !== Number(o.amount_krw)) throw new Denied('amount_mismatch');
      if (deps.paymentsOpen !== true || !liveEnough(deps)) throw new Denied('payments_closed');
      const quote = (await sql.query('select * from brand_usage_quotes where id=$1', [o.quote_id])).rows[0]!;
      const stale = new Date(stamp(o.expires_at)) <= now || c.status !== 'accepted' || quote.status !== 'accepted'
        || now >= new Date(stamp(quote.valid_until)) || quote.tax_basis !== 'included';
      let basisOk = !stale;
      if (basisOk) { try { await checkQuoteBasis(sql, quote, now); } catch (error) { if (!(error instanceof Denied)) throw error; basisOk = false; } }
      if (!basisOk) {
        await sql.query("update brand_usage_payments set status='expired',updated_at=now() where id=$1", [o.id]);
        return { refused: true };
      }
      await sql.query("update brand_usage_payments set status='confirming',payment_key=$2,lease_until=$3,updated_at=now() where id=$1", [o.id, v.paymentKey, new Date(+now + LEASE_MS)]);
      return { ...o, status: 'confirming', payment_key: v.paymentKey };
    });
  } catch (error) {
    if (error instanceof Denied) return fail(error.code);
    if ((error as { code?: string }).code === '23505') return fail('conflict');
    throw error;
  }
  if (claimed.refused) return fail('conflict');
  let result: Settled;
  try {
    const p = await deps.gateway.confirm({ paymentKey: v.paymentKey, orderId: String(claimed.id), amount: Number(claimed.amount_krw), idempotencyKey: `confirm-${claimed.id}` });
    result = await settle(deps, claimed, p, false);
  } catch (error) {
    // The provider refused outright (4xx). Ask it what it holds for this key before releasing anything:
    // not found right after a refusal is proof of non-payment; any other answer is applied as is.
    if (error instanceof TossError && !error.retryable) {
      try { result = await settle(deps, claimed, await deps.gateway.retrieve(v.paymentKey), true); }
      catch { result = { ok: false, code: 'confirm_pending' }; }
    } else {
      // Timeout or network: the approval may already have happened. Keep the claim for reconcile.
      result = { ok: false, code: 'confirm_pending' };
    }
  }
  return result.ok ? result : fail(result.code);
}

/** Record a verified approval, then hand the case to the activation guard (the only grant writer). */
async function accept(deps: Omit<UsagePaymentDeps, 'paymentsOpen'>, o: Row): Promise<Settled> {
  await deps.sql.transaction(async sql => {
    const c = await lockCase(sql, String(o.case_id));
    const updated = (await sql.query("update brand_usage_payments set status='paid',approved_at=$2,lease_until=null,updated_at=now() where id=$1 and status='confirming' returning id", [o.id, clock(deps)])).rows[0];
    if (!updated) return;
    // Paid is not licensed: the case moves to `paid` and only the activation guard can grant.
    if (c.status === 'accepted') await setStatus(sql, c, 'paid');
    await usageEvent(sql, c.id, 'paid', 'system', null, o.quote_id);
    const quote = (await sql.query('select * from brand_usage_quotes where id=$1', [o.quote_id])).rows[0]!;
    await recordOutcome(sql, quote, 'paid');
  });
  const state = await activateUsageCase(deps.sql, o.case_id, 'system', null, runtimeOf(deps));
  return { ok: true, id: String(o.id), state, projectId: String(o.project_id) };
}

/**
 * Durable recovery with no page load: called by the existing daily `/api/renders/tick`, by the admin
 * `brandUsage.reconcile` op and opportunistically by the buyer's status read. Every step is idempotent.
 * Activation and refunds run first, each with its own batch, so no number of unresolved confirmations
 * can starve them; each unresolved confirmation is pushed back by `BACKOFF_MS` after every attempt.
 */
export async function reconcileBrandUsagePayments(deps: Omit<UsagePaymentDeps, 'paymentsOpen'>): Promise<{ checked: number }> {
  const now = clock(deps);
  let checked = 0;
  await deps.sql.query("update brand_usage_payments set status='expired',updated_at=now() where status='pending' and expires_at<=$1", [now]);
  const activation = (await deps.sql.query(`select p.case_id from brand_usage_payments p join brand_usage_cases c on c.id=p.case_id
    where p.status='paid' and c.status='paid' order by p.updated_at limit ${BATCH}`)).rows;
  for (const r of activation) { checked++; await activateUsageCase(deps.sql, r.case_id, 'system', null, runtimeOf(deps)); }
  const refunds = (await deps.sql.query(`select id from brand_usage_payments where environment=$1 and status='refund_pending'
    and (lease_until is null or lease_until<=$2) order by coalesce(lease_until,updated_at) limit ${BATCH}`, [deps.gateway.kind, now])).rows;
  for (const r of refunds) { checked++; await refund(deps, String(r.id)); }
  const confirming = (await deps.sql.query(`select * from brand_usage_payments where environment=$1 and status='confirming' and payment_key is not null
    and lease_until<=$2 order by lease_until limit ${BATCH}`, [deps.gateway.kind, now])).rows;
  for (const o of confirming) {
    checked++;
    const claimed = (await deps.sql.query("update brand_usage_payments set lease_until=$2,updated_at=now() where id=$1 and status='confirming' and lease_until<=$3 returning id", [o.id, new Date(+now + BACKOFF_MS), now])).rows[0];
    if (!claimed) continue;
    try {
      let p = await deps.gateway.retrieve(String(o.payment_key));
      // Only an authorised-but-unapproved payment is approved again, under the same idempotency key.
      if (p && matches(p, o) && p.status === 'IN_PROGRESS')
        p = await deps.gateway.confirm({ paymentKey: String(o.payment_key), orderId: String(o.id), amount: Number(o.amount_krw), idempotencyKey: `confirm-${o.id}` });
      await settle(deps, o, p, now >= new Date(+new Date(stamp(o.expires_at)) + PROVIDER_WINDOW_MS));
    } catch { /* Unknown outcome: the claim stays, backed off; never a new order, never a release. */ }
  }
  return { checked };
}

async function refund(deps: Omit<UsagePaymentDeps, 'paymentsOpen'>, paymentId: string): Promise<boolean> {
  const now = clock(deps);
  const o = (await deps.sql.query(`update brand_usage_payments set lease_until=$2,updated_at=now() where id=$1 and status='refund_pending' and (lease_until is null or lease_until<=$3) returning *`,
    [paymentId, new Date(+now + BACKOFF_MS), now])).rows[0];
  if (!o || !o.payment_key || o.environment !== deps.gateway.kind) return false;
  try {
    let p = await deps.gateway.retrieve(String(o.payment_key));
    if (!p || !matches(p, o)) throw new Error('Payment not verified');
    if (p.status !== 'CANCELED' || p.balance !== 0)
      p = await deps.gateway.cancel({ paymentKey: String(o.payment_key), reason: 'TWINGS secondary usage refund', idempotencyKey: `refund-${o.id}` });
    if (!matches(p, o) || p.status !== 'CANCELED' || p.balance !== 0) throw new Error('Refund not confirmed');
    await deps.sql.transaction(async sql => {
      const c = await lockCase(sql, String(o.case_id));
      const done = (await sql.query("update brand_usage_payments set status='refunded',refunded_at=$2,lease_until=null,updated_at=now() where id=$1 and status='refund_pending' returning id", [o.id, now])).rows[0];
      if (!done) return;
      await sql.query("update brand_usage_outcomes set outcome='refunded' where case_id=$1 and outcome='paid'", [c.id]);
      await setStatus(sql, c, 'closed', { closeReason: 'refunded' });
      await usageEvent(sql, c.id, 'refunded', 'system', null, o.quote_id);
    });
    return true;
  } catch {
    await deps.sql.query("update brand_usage_payments set failure_code='refund_retry',updated_at=now() where id=$1 and status='refund_pending'", [o.id]);
    return false;
  }
}

/**
 * Studio resolution of a paid or stuck case. `reverify` re-runs the activation guard on the SAME accepted
 * terms (e.g. after a terms file was re-shared by mistake); it never changes a term. `refund` is the only
 * path to a refund: an administrator's explicit decision, which terminates any grant of the case first.
 * `abandon` releases a `confirming`/`review` order only when the provider itself shows it was never paid;
 * an unreachable provider, a pending approval or any held balance refuses (lease expiry is not proof).
 */
export async function resolveUsageCase(deps: UsagePaymentDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  let refundId: string | null = null;
  let abandon: Row | null = null;
  const result = await mutation(deps.sql, viewer, UsageResolveSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    const payment = (await sql.query("select * from brand_usage_payments where case_id=$1 and status in ('paid','refund_pending','confirming','review') order by created_at desc limit 1", [c.id])).rows[0];
    if (v.action === 'reverify') {
      if (c.status !== 'blocked_after_payment' || payment?.status !== 'paid') throw new Denied('conflict');
      const quote = (await sql.query("select * from brand_usage_quotes where id=$1 and status='accepted'", [payment.quote_id])).rows[0];
      if (!quote) throw new Denied('conflict');
      await checkQuoteBasis(sql, quote);
      await setStatus(sql, c, 'paid');
      await usageEvent(sql, c.id, 'reverified', 'studio', userId, quote.id);
      return { id: String(c.id) };
    }
    if (v.action === 'abandon') {
      if (!payment || !['confirming', 'review'].includes(String(payment.status)) || !payment.payment_key) throw new Denied('conflict');
      abandon = payment;
      return { id: String(c.id) };
    }
    // Refund: a paid case, or money the provider holds on an order under review.
    if (!payment || !(['paid', 'refund_pending'].includes(String(payment.status)) && ['blocked_after_payment', 'fulfilled', 'paid'].includes(String(c.status)) || payment.status === 'review')) throw new Denied('conflict');
    if (payment.status !== 'refund_pending') {
      await sql.query("update brand_usage_payments set status='refund_pending',lease_until=null,updated_at=now() where id=$1", [payment.id]);
      const grants = (await sql.query('select id from brand_usage_grants where case_id=$1', [c.id])).rows;
      for (const g of grants)
        await sql.query("insert into brand_usage_grant_events(grant_id,kind,reason,created_by,request_id) values($1,'terminated',$2,$3,$4)", [g.id, v.reason, userId, randomUUID()]);
    }
    refundId = String(payment.id);
    return { id: String(c.id) };
  });
  if (!result.ok) return result;
  if (refundId) return await refund(deps, refundId) ? result : fail('refund_failed');
  if (abandon) {
    const o: Row = abandon;
    if (o.environment !== deps.gateway.kind) return fail('unavailable');
    let p: TossPayment | null;
    try { p = await deps.gateway.retrieve(String(o.payment_key)); } catch { return fail('confirm_pending'); }
    const unpaid = p === null || (matches(p, o) && (['ABORTED', 'EXPIRED'].includes(p.status) || (p.status === 'CANCELED' && p.balance === 0)));
    if (!unpaid) return fail('payment_review');
    await release(deps, o, p === null ? 'abandoned_not_found' : 'abandoned_unpaid', String(o.status));
    return result;
  }
  const state = await activateUsageCase(deps.sql, result.id, 'studio', viewer.userId, runtimeOf(deps));
  return state === 'fulfilled' ? result : fail('conflict');
}
