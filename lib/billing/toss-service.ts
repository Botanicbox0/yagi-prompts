import { createHash, randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { purchaseOpenFor } from '@/lib/auth/purchase-gate';
import { isLocale } from '@/lib/i18n/config';
import { aspectsForMedium } from '@/lib/images/engines';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { isForSale } from '@/lib/twings/products';
import { chargeKrwFor, chooseResolution, isCreatorResolution } from '@/lib/twings/resolution';
import type {
  CreateRenderInput,
  CreateRenderOutcome,
  RenderServiceDeps,
} from '@/lib/renders/service';
import { extensionFor } from '@/lib/renders/store';
import { useSavedSelfie } from '@/lib/identity/selfie-service';
import { loadTemplateRecipe } from '@/lib/recipes/repo';
import { parseDirectorSpecInput } from '@/lib/template-director/schema';
import { parseSelectedFrames, selectiveOrderKrw } from '@/lib/twings/selective-frames';
import { TossError, type TossGateway, type TossPayment } from './toss-gateway';

export const TOSS_CONSENT_VERSION = 'refund-2026-09-14-section-2';
/** docs/PLATFORM-2.0.md §2.2-4: one pass settles at most this many orders… */
export const TOSS_RECONCILE_BATCH = 50;
/** …and each automatic recovery (the refund, the render creation) hands over to an operator after this many tries. */
export const TOSS_RETRY_CAP = 10;
const LEASE_MS = 60_000;

/**
 * Why an order ended where it did — `billing_payments.failure_code`, and what the order page says.
 * Older rows may carry `provider_declined` or `refund_retry`; those read as the generic failure.
 */
export const TOSS_REASONS = [
  'declined',
  'price_changed',
  'not_open',
  'expired',
  'canceled',
  'aborted',
  'unknown_payment',
  'provider_mismatch',
  'partial_balance',
  'refund_manual',
  'fulfil_manual',
] as const;
export type TossReason = (typeof TOSS_REASONS)[number];
/** The card's or the provider's refusal: a fresh order with the same photo may well go through. */
const RETRY_REASONS: ReadonlySet<string> = new Set<TossReason>(['declined', 'aborted', 'unknown_payment']);

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
  /** '720p' | '1080p' for a film bought after 0039; NULL = image, or a film ordered before it (720p). */
  resolution: string | null;
  locale: 'ko' | 'en';
  render_ref: string;
  input_key: string;
  input_mime: string;
  render_id: string | null;
  fulfilled_at: string | Date | null;
  lease_until: string | Date | null;
  expires_at: string | Date;
  failure_code: string | null;
  identity_portrait_id: string | null;
  /** 0050: the saved photo this order copied its input from (docs/IDENTITY-SELFIE.md §4). */
  identity_selfie_id: string | null;
  /** 0052: the order's own photo copy is gone (it never became a render). */
  input_deleted_at: string | Date | null;
  /** 0052: the order 다시 결제하기 made from this one. */
  retried_by: string | null;
  /** 0087: selected 0-based frame indices for selective image-set purchase; null = all frames. */
  selected_frames?: number[] | null;
  /** 0087: Hydrogen director customization spec + Seedance native audio mode. */
  director_spec?: unknown;
}
type TossRow = TossOrder & { render_status: string | null };
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
/** What one reconcile settled — the render pass prints it (lib/renders/runtime.ts). */
export interface TossReconcileReport {
  confirmed: number;
  refunded: number;
  failed: number;
  manual: number;
}
export const emptyTossReport = (): TossReconcileReport => ({ confirmed: 0, refunded: 0, failed: 0, manual: 0 });
export function addTossReport(into: TossReconcileReport, from: TossReconcileReport): void {
  into.confirmed += from.confirmed;
  into.refunded += from.refunded;
  into.failed += from.failed;
  into.manual += from.manual;
}
const fail = (code: string): TossFailure => ({ ok: false, code });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_KEY = /^[A-Za-z0-9_-]{1,200}$/;
const clock = (d: { now?: Date }) => d.now ?? new Date();

type LogValue = string | number | boolean | null;
/** One structured line per payment event — never a key, a payment key, a request body or a customer value. */
export function logBilling(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, LogValue> = {}): void {
  const line = `[billing] ${JSON.stringify({ event, ...fields })}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
/** A loggable name for a failure: the provider error's code or the error class, never its message. */
export function billingErrorCode(error: unknown): string {
  return error instanceof TossError ? error.code : error instanceof Error ? error.name : 'unknown';
}

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

export interface TossOrderView {
  status: TossOrder['status'];
  reason: TossReason | null;
  /** 다시 결제하기 applies: a failure the reader can try again with the same photo. */
  retry: boolean;
  renderId: string | null;
}
/** What the order page and the status poll may show: the reason as a known code, nothing internal. */
export function tossOrderView(
  o: Pick<TossOrder, 'status' | 'failure_code' | 'input_deleted_at' | 'retried_by' | 'render_id'>,
): TossOrderView {
  const reason = (TOSS_REASONS as readonly string[]).includes(o.failure_code ?? '')
    ? (o.failure_code as TossReason)
    : null;
  return {
    status: o.status,
    reason,
    retry:
      o.status === 'failed' &&
      reason !== null &&
      RETRY_REASONS.has(reason) &&
      (o.retried_by !== null || o.input_deleted_at === null),
    renderId: o.render_id,
  };
}

export async function createTossOrder(
  deps: TossServiceDeps,
  viewer: Viewer,
  input: CreateRenderInput,
): Promise<
  | { ok: true; order: { id: string; amountKrw: number; name: string; resolution: string | null } }
  | TossFailure
> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!purchaseOpenFor(viewer)) return fail('not_open');
  if (viewer.isAdmin) return fail('admin_free');
  const t = await loadPromptBySlug(deps.sql, input.templateSlug);
  if (!t || t.status !== 'published' || t.audience === 'brand') return fail('not_found');
  // Charge the stored KRW price for the chosen resolution, never a browser amount or an
  // exchange-rate fallback. The browser names a resolution; the row names its price.
  if (!isForSale(t) || !Number.isSafeInteger(t.priceKrw) || t.priceKrw <= 0)
    return fail('not_for_sale');
  if (!(aspectsForMedium(t.medium) as readonly string[]).includes(input.aspect))
    return fail('bad_aspect');
  const choice = chooseResolution(t, input.resolution);
  if (!choice.ok) return fail('bad_resolution');
  const recipe = t.medium === 'image' ? await loadTemplateRecipe(deps.sql, t.id) : null;
  const pricing = selectiveOrderKrw(t, recipe, input.selectedFrames, choice.resolution);
  const amountKrw = pricing.amountKrw;
  if (amountKrw === null) return fail('not_for_sale');
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
  const directorSpec = parseDirectorSpecInput(input.directorSpec);
  // A 1080p order or partial image set selection says so in the name the buyer sees at Toss.
  const hd = choice.resolution === '1080p' ? ' · 1080p' : '';
  const framesTag = pricing.normalizedFrames
    ? locale === 'ko'
      ? ` · ${pricing.normalizedFrames.length}장 선택`
      : ` · ${pricing.normalizedFrames.length} frames`
    : '';
  const suffix = `${hd}${framesTag}`;
  const title = `TWINGS · ${locale === 'ko' ? t.titleKo || t.title : t.title}`;
  const name = `${title.slice(0, 100 - suffix.length)}${suffix}`;
  await deps.store.put(inputKey, input.photo.bytes, input.photo.mime);
  await deps.sql.query(
    `insert into billing_payments
    (id,user_id,environment,amount_krw,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,expires_at,identity_selfie_id,resolution,selected_frames,director_spec)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::integer[],$17::jsonb)`,
    [
      id,
      viewer.userId,
      deps.gateway.kind,
      amountKrw,
      t.id,
      t.slug,
      name,
      input.aspect,
      locale,
      renderRef,
      inputKey,
      input.photo.mime,
      new Date(clock(deps).getTime() + 30 * 60_000),
      input.selfieId ?? null,
      choice.resolution,
      pricing.normalizedFrames,
      directorSpec ? JSON.stringify(directorSpec) : null,
    ],
  );
  return { ok: true, order: { id, amountKrw, name, resolution: choice.resolution } };
}

/**
 * 다시 결제하기 (docs/PLATFORM-2.0.md §2.2-1): a new `pending` order for the same reader, template,
 * options and stored photo. The failed order stays failed and remembers the new one, so a second
 * press answers with the same order; the daily order limit applies as to any order.
 */
export async function retryTossOrder(
  deps: TossServiceDeps,
  viewer: Viewer,
  id: string,
): Promise<{ ok: true; order: { id: string } } | TossFailure> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!purchaseOpenFor(viewer)) return fail('not_open');
  if (!uuid.test(id)) return fail('not_found');
  const used: { order?: TossOrder } = {};
  const outcome = await deps.sql.transaction(
    async (tx): Promise<{ ok: true; order: { id: string } } | TossFailure> => {
      const { rows } = await tx.query<TossOrder>(
        "select * from billing_payments where id=$1 and user_id=$2 and payment_type='NORMAL' for update",
        [id, viewer.userId],
      );
      const o = rows[0];
      if (!o) return fail('not_found');
      if (o.retried_by) return { ok: true, order: { id: o.retried_by } };
      if (!tossOrderView(o).retry) return fail('not_retryable');
      // A new order only on a photo the reader still keeps: replaced or deleted since → selfie_required.
      if (o.identity_selfie_id && !(await useSavedSelfie(tx, o.user_id!, o.identity_selfie_id, clock(deps)))) return fail('selfie_required');
      let bytes: Uint8Array;
      try {
        bytes = await deps.store.read(o.input_key);
      } catch {
        return fail('photo_gone');
      }
      const created = await createTossOrder({ ...deps, sql: tx }, viewer, {
        templateSlug: o.template_slug,
        aspect: o.aspect,
        resolution: o.resolution ?? '',
        locale: o.locale,
        selfieId: o.identity_selfie_id ?? undefined,
        photo: { bytes, mime: o.input_mime },
        selectedFrames: parseSelectedFrames(o.selected_frames),
        directorSpec: parseDirectorSpecInput(o.director_spec),
      });
      if (!created.ok) return created;
      await tx.query('update billing_payments set retried_by=$2 where id=$1', [o.id, created.order.id]);
      used.order = o;
      return { ok: true, order: { id: created.order.id } };
    },
  );
  // The new order holds its own copy; the failed one's is no longer needed.
  if (used.order) await dropPhoto(deps, used.order);
  return outcome;
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
  if (!input.consent) return fail('consent_required');
  if (
    !uuid.test(input.orderId) ||
    !input.paymentKey ||
    input.paymentKey.length > 200
  )
    return fail('bad_request');
  const open = purchaseOpenFor(viewer);
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
      // Each refusal below ENDS the order (docs/PLATFORM-2.0.md §2.2-2): left pending, the order page
      // would open the same window again — at an old price or into a closed sale — until it expired.
      if (!open) return endOrder(tx, o, 'pending', 'not_open', emptyTossReport());
      if (!Number.isSafeInteger(input.amount) || input.amount !== o.amount_krw)
        return fail('amount_mismatch');
      if (new Date(o.expires_at) <= clock(deps))
        return endOrder(tx, o, 'pending', 'expired', emptyTossReport());
      const t = await loadPromptBySlug(tx, o.template_slug);
      const selectedFrames = parseSelectedFrames(o.selected_frames);
      const recipe = t && selectedFrames?.length && t.medium === 'image' ? await loadTemplateRecipe(tx, t.id) : null;
      const expectedPricing = t
        ? selectiveOrderKrw(t, recipe, selectedFrames, isCreatorResolution(o.resolution) ? o.resolution : null)
        : null;
      // Re-derive the price for the resolution and selected frames ON THE ORDER.
      if (
        !t ||
        t.status !== 'published' ||
        !isForSale(t) ||
        (o.resolution !== null && !isCreatorResolution(o.resolution)) ||
        expectedPricing?.amountKrw !== o.amount_krw
      )
        return endOrder(tx, o, 'pending', 'price_changed', emptyTossReport());
      // The consent recorded before the window opened is the one that counts (§2.2-7): only fill a gap.
      await tx.query(
        `update billing_payments set status='confirming', payment_key=$2, consent_at=coalesce(consent_at,$3),
      consent_version=coalesce(consent_version,$4), lease_until=$5 where id=$1`,
        [
          o.id,
          input.paymentKey,
          clock(deps),
          TOSS_CONSENT_VERSION,
          new Date(clock(deps).getTime() + LEASE_MS),
        ],
      );
      return { ...o, status: 'confirming', payment_key: input.paymentKey };
    },
  );
  if ('ok' in claimed) {
    if (claimed.code === 'expired') {
      const { rows } = await deps.sql.query<TossOrder>('select * from billing_payments where id=$1', [input.orderId]);
      if (rows[0]) await dropPhoto(deps, rows[0]);
    }
    return claimed;
  }
  let p: TossPayment;
  try {
    p = await deps.gateway.confirm({
      paymentKey: input.paymentKey,
      orderId: claimed.id,
      amount: claimed.amount_krw,
      idempotencyKey: `confirm-${claimed.id}`,
    });
  } catch (error) {
    // A 4xx is the provider's answer; only the network, a 5xx or a timeout leave the outcome unknown.
    if (error instanceof TossError && !error.retryable) return refuse(deps, claimed, error);
    // The approval may already have happened. Keep the durable claim and resolve by GET later.
    return fail('confirm_pending');
  }
  try {
    return await settleConfirming(deps, claimed, p, emptyTossReport());
  } catch {
    return fail('confirm_pending');
  }
}

/** A definitive refusal ends the order — after one read, because a payment the provider already holds wins. */
async function refuse(deps: TossServiceDeps, o: TossOrder, error: TossError): Promise<TossApproval> {
  logBilling('warn', 'toss_confirm_refused', { order: o.id, status: error.code, provider: error.providerCode ?? null });
  let p: TossPayment | null = null;
  try {
    p = await deps.gateway.retrieve(o.payment_key!);
  } catch {
    /* the provider's refusal stands */
  }
  if (p && matches(p, o) && p.status === 'DONE' && p.balance === o.amount_krw)
    return settleConfirming(deps, o, p, emptyTossReport());
  return endOrder(deps.sql, o, 'confirming', 'declined', emptyTossReport());
}

async function endOrder(
  sql: SqlRunner,
  o: TossOrder,
  from: TossOrder['status'],
  reason: TossReason,
  report: TossReconcileReport,
): Promise<TossFailure> {
  const { rows } = await sql.query(
    "update billing_payments set status='failed', failure_code=$3, lease_until=null where id=$1 and status=$2 returning id",
    [o.id, from, reason],
  );
  if (rows.length) report.failed += 1;
  return fail(reason);
}

/** Money moved but not all of it (a partial cancellation at the console): an operator decides. */
async function holdPartial(
  deps: TossServiceDeps,
  o: TossOrder,
  from: 'confirming' | 'paid',
  report: TossReconcileReport,
): Promise<TossFailure> {
  const { rows } = await deps.sql.query(
    `update billing_payments set status='refund_pending', failure_code='partial_balance',
    approved_at=coalesce(approved_at,$3), lease_until=null where id=$1 and status=$2 returning id`,
    [o.id, from, clock(deps)],
  );
  if (rows.length) {
    report.manual += 1;
    logBilling('error', 'toss_partial_balance', { order: o.id });
  }
  return fail('partial_balance');
}

/**
 * The terminal rules for an order whose approval was sent (docs/PLATFORM-2.0.md §2.2-4). `p` is the
 * provider's own record; null = the provider does not know the payment key.
 */
async function settleConfirming(
  deps: TossServiceDeps,
  o: TossOrder,
  p: TossPayment | null,
  report: TossReconcileReport,
): Promise<TossApproval> {
  if (p === null) return endOrder(deps.sql, o, 'confirming', 'unknown_payment', report);
  if (!matches(p, o)) return endOrder(deps.sql, o, 'confirming', 'provider_mismatch', report);
  if (p.status === 'DONE' && p.balance === o.amount_krw) {
    const { rows } = await deps.sql.query(
      "update billing_payments set status='paid', approved_at=$2,lease_until=null where id=$1 and status='confirming' returning id",
      [o.id, clock(deps)],
    );
    if (!rows.length) return fail('confirm_pending');
    report.confirmed += 1;
    return fulfill(deps, { ...o, status: 'paid' }, report);
  }
  if (p.status === 'CANCELED' && p.balance === 0) return endOrder(deps.sql, o, 'confirming', 'canceled', report);
  if (p.status === 'ABORTED') return endOrder(deps.sql, o, 'confirming', 'aborted', report);
  if (p.status === 'EXPIRED') return endOrder(deps.sql, o, 'confirming', 'expired', report);
  if (['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(p.status)) return holdPartial(deps, o, 'confirming', report);
  if (p.status === 'WAITING_FOR_DEPOSIT' && new Date(o.expires_at) <= clock(deps))
    return endOrder(deps.sql, o, 'confirming', 'expired', report);
  // READY, IN_PROGRESS, a deposit still inside the order's window, or a status unknown here: the
  // claim stays and a later pass reads again.
  return fail('confirm_pending');
}

async function fulfill(
  deps: TossServiceDeps,
  o: TossOrder,
  report: TossReconcileReport,
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
      selectedFrames: parseSelectedFrames(o.selected_frames),
      directorSpec: parseDirectorSpecInput(o.director_spec),
    });
    if (result.ok) return result;
    await queueRefund(deps.sql, o.id);
    await refund(deps, o.id, report);
    return fail('render_unavailable');
  } catch {
    // Database/storage faults can recover. The paid row is durable and the maintenance pass retries,
    // backing off so a damaged photo cannot occupy every recovery pass ahead of other payments — and
    // after TOSS_RETRY_CAP tries an operator takes it (`fulfil_manual`) instead of a pass, forever.
    const { rows } = await deps.sql.query<{ failure_code: string | null }>(
      `update billing_payments set fulfil_attempts=fulfil_attempts+1,
        failure_code=case when fulfil_attempts+1 >= $3 then 'fulfil_manual' else failure_code end,
        lease_until=case when fulfil_attempts+1 >= $3 then null
          else $2::timestamptz + least(3600, 60 * power(2, fulfil_attempts))::int * interval '1 second' end
      where id=$1 and status='paid' and fulfilled_at is null returning failure_code`,
      [o.id, clock(deps), TOSS_RETRY_CAP],
    );
    if (rows[0]?.failure_code === 'fulfil_manual') {
      report.manual += 1;
      logBilling('error', 'toss_fulfil_manual', { order: o.id });
    }
    return fail('confirm_pending');
  }
}

async function queueRefund(sql: SqlRunner, id: string) {
  await sql.query(
    "update billing_payments set status='refund_pending',lease_until=null where id=$1 and status='paid'",
    [id],
  );
}
async function refund(deps: TossServiceDeps, id: string, report: TossReconcileReport): Promise<void> {
  // A refund an operator holds (`refund_manual`, `partial_balance`) is never retried automatically.
  const { rows } = await deps.sql.query<TossOrder>(
    `update billing_payments set lease_until=$2
    where id=$1 and status='refund_pending' and failure_code is distinct from 'refund_manual'
      and failure_code is distinct from 'partial_balance' and (lease_until is null or lease_until <= $3) returning *`,
    [id, new Date(clock(deps).getTime() + LEASE_MS), clock(deps)],
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
    const { rows: done } = await deps.sql.query(
      "update billing_payments set status='refunded',refunded_at=$2,lease_until=null where id=$1 and status='refund_pending' returning id",
      [o.id, clock(deps)],
    );
    if (done.length) report.refunded += 1;
  } catch {
    // The first three failures retry on the next pass (a dropped connection, a provider blip); later
    // ones back off from a minute to an hour. At the cap an operator takes the refund, and the
    // failure email goes out then, once (renderPaymentStatus).
    const { rows: after } = await deps.sql.query<{ failure_code: string | null }>(
      `update billing_payments set refund_attempts=refund_attempts+1,
        failure_code=case when refund_attempts+1 >= $3 then 'refund_manual' else 'refund_retry' end,
        lease_until=case when refund_attempts+1 >= $3 or refund_attempts < 3 then null
          else $2::timestamptz + least(3600, 60 * power(2, refund_attempts - 3))::int * interval '1 second' end
      where id=$1 and status='refund_pending' returning failure_code`,
      [o.id, clock(deps), TOSS_RETRY_CAP],
    );
    if (after[0]?.failure_code === 'refund_manual') {
      report.manual += 1;
      logBilling('error', 'toss_refund_manual', { order: o.id });
    }
  }
}

/**
 * The order's own copy of the photo, once nothing can need it: never paid, no render, past its
 * window or retried (§2.2-6). Marked first, so a concurrent approval can never lose its input.
 */
async function dropPhoto(deps: TossServiceDeps, o: Pick<TossOrder, 'id'>): Promise<void> {
  if (!deps.store.delete) return;
  const { rows } = await deps.sql.query<{ input_key: string }>(
    `update billing_payments set input_deleted_at=$2
    where id=$1 and status='failed' and render_id is null and input_deleted_at is null returning input_key`,
    [o.id, clock(deps)],
  );
  const key = rows[0]?.input_key;
  if (!key) return;
  try {
    await deps.store.delete(key);
  } catch {
    // Storage refused: unmark, and a later pass tries again.
    await deps.sql.query('update billing_payments set input_deleted_at=null where id=$1', [o.id]);
  }
}

async function recoverApproval(deps: TossServiceDeps, o: TossOrder, report: TossReconcileReport): Promise<void> {
  const claimed = await deps.sql.query(
    `update billing_payments set lease_until=$2
    where id=$1 and status='confirming' and lease_until <= $3 returning id`,
    [o.id, new Date(clock(deps).getTime() + LEASE_MS), clock(deps)],
  );
  if (!claimed.rows.length || !o.payment_key) return;
  let p: TossPayment | null;
  try {
    p = await deps.gateway.retrieve(o.payment_key);
  } catch {
    return; /* Unknown outcome: retain the claim for a later pass, never issue a new order. */
  }
  if (p && matches(p, o) && p.status === 'IN_PROGRESS') {
    try {
      p = await deps.gateway.confirm({
        paymentKey: o.payment_key,
        orderId: o.id,
        amount: o.amount_krw,
        idempotencyKey: `confirm-${o.id}`,
      });
    } catch (error) {
      // The same idempotency key replays the provider's first answer: a refusal is final.
      if (error instanceof TossError && !error.retryable) await endOrder(deps.sql, o, 'confirming', 'declined', report);
      return;
    }
  }
  await settleConfirming(deps, o, p, report);
}

async function settleDue(deps: TossServiceDeps, o: TossRow, report: TossReconcileReport): Promise<void> {
  switch (o.status) {
    case 'pending': {
      // Never paid inside its window (§2.2-6): end it and drop the photo it was holding.
      const { rows } = await deps.sql.query(
        "update billing_payments set status='failed', failure_code='expired', lease_until=null where id=$1 and status='pending' and expires_at <= $2 returning id",
        [o.id, clock(deps)],
      );
      if (rows.length) report.failed += 1;
      await dropPhoto(deps, o);
      return;
    }
    case 'failed':
      await dropPhoto(deps, o);
      return;
    case 'confirming':
      await recoverApproval(deps, o, report);
      return;
    case 'paid': {
      const claimed = await deps.sql.query(
        "update billing_payments set lease_until=$2 where id=$1 and status='paid' and (lease_until is null or lease_until <= $3) returning id",
        [o.id, new Date(clock(deps).getTime() + LEASE_MS), clock(deps)],
      );
      if (!claimed.rows.length) return;
      if (o.fulfilled_at === null) await fulfill(deps, o, report);
      else {
        await queueRefund(deps.sql, o.id);
        await refund(deps, o.id, report);
      }
      return;
    }
    case 'refund_pending':
      await refund(deps, o.id, report);
      return;
    default:
      return;
  }
}

/**
 * Called by the existing render pass (callback, owner page and daily cron), also while the public
 * gate is closed — and, scoped to ONE order, by that order's status poll and the provider's webhook
 * (§2.2-8: a poll never settles other people's payments). Every order it selects leaves in a named
 * state or with a lease for a later pass; `TOSS_RECONCILE_BATCH` bounds the work of one call.
 */
export async function reconcileTossPayments(
  deps: TossServiceDeps,
  options: { orderId?: string } = {},
): Promise<TossReconcileReport> {
  const report = emptyTossReport();
  if (options.orderId !== undefined && !uuid.test(options.orderId)) return report;
  const params: unknown[] = [deps.gateway.kind, clock(deps)];
  if (options.orderId !== undefined) params.push(options.orderId);
  const { rows } = await deps.sql.query<TossRow>(
    `select p.*, r.status as render_status from billing_payments p
    left join render_jobs r on r.id=p.render_id
    where p.environment=$1 and p.payment_type='NORMAL' ${options.orderId !== undefined ? 'and p.id=$3' : ''} and (
      (p.status='pending' and p.expires_at <= $2) or
      (p.status='failed' and p.input_deleted_at is null and p.render_id is null and p.expires_at <= $2
        and not exists (select 1 from render_jobs j where j.id=p.render_ref)) or
      (p.status='confirming' and p.lease_until <= $2) or
      (p.status='paid' and p.failure_code is distinct from 'fulfil_manual' and (p.lease_until is null or p.lease_until <= $2)
        and (p.fulfilled_at is null or r.status='failed')) or
      (p.status='refund_pending' and p.failure_code is distinct from 'refund_manual'
        and p.failure_code is distinct from 'partial_balance' and (p.lease_until is null or p.lease_until <= $2)))
    order by case when p.status='refund_pending' or r.status='failed' then 0
      when p.status in ('confirming','paid') then 1 else 2 end,
      coalesce(p.lease_until,p.expires_at) limit ${TOSS_RECONCILE_BATCH}`,
    params,
  );
  for (const o of rows) await settleDue(deps, o, report);
  return report;
}

/**
 * The webhook's hint checked at the source (§2.2-5): re-read the order's OWN payment — never the
 * hint's key — and apply what the provider holds. A console cancellation becomes `refunded`; a
 * partial one waits for an operator; money held for an order already called failed goes back.
 */
async function refreshFromProvider(deps: TossServiceDeps, o: TossOrder, report: TossReconcileReport): Promise<void> {
  if (!o.payment_key || !['paid', 'failed', 'refund_pending'].includes(o.status)) return;
  const p = await deps.gateway.retrieve(o.payment_key);
  if (!p || !matches(p, o)) return;
  if (p.status === 'CANCELED' && p.balance === 0) {
    if (o.status === 'failed') return;
    const { rows } = await deps.sql.query(
      'update billing_payments set status=\'refunded\', refunded_at=$2, lease_until=null where id=$1 and status=$3 returning id',
      [o.id, clock(deps), o.status],
    );
    if (rows.length) report.refunded += 1;
    return;
  }
  if (!['DONE', 'PARTIAL_CANCELED'].includes(p.status) || p.balance <= 0) return;
  if (o.status === 'failed') {
    // The reader was told it failed, yet the provider holds the money: the due pass below refunds it.
    const { rows } = await deps.sql.query(
      `update billing_payments set status='refund_pending', failure_code=null, approved_at=coalesce(approved_at,$2),
      lease_until=null where id=$1 and status='failed' and consent_at is not null returning id`,
      [o.id, clock(deps)],
    );
    if (rows.length) logBilling('warn', 'toss_captured_after_failure', { order: o.id });
    return;
  }
  if (o.status === 'paid' && p.balance < o.amount_krw) await holdPartial(deps, o, 'paid', report);
}

export interface TossWebhookHint {
  orderId?: string;
  paymentKey?: string;
  status?: string;
}
/** The fields a Toss webhook may name — `data` of PAYMENT_STATUS_CHANGED, or the top level of a deposit callback. */
export function tossWebhookHint(body: unknown): TossWebhookHint | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const data =
    b.data && typeof b.data === 'object' && !Array.isArray(b.data)
      ? (b.data as Record<string, unknown>)
      : b;
  const text = (value: unknown) => (typeof value === 'string' && value.length <= 200 ? value : undefined);
  const hint = { orderId: text(data.orderId), paymentKey: text(data.paymentKey), status: text(data.status) };
  return hint.orderId || hint.paymentKey ? hint : null;
}

export async function reconcileTossWebhook(
  deps: TossServiceDeps,
  hint: TossWebhookHint,
): Promise<{ matched: false } | { matched: true; report: TossReconcileReport }> {
  const find = async (column: 'id' | 'payment_key', value: string) =>
    (
      await deps.sql.query<TossOrder>(
        `select * from billing_payments where environment=$1 and payment_type='NORMAL' and ${column}=$2`,
        [deps.gateway.kind, value],
      )
    ).rows[0];
  let o: TossOrder | undefined;
  if (hint.orderId && uuid.test(hint.orderId)) o = await find('id', hint.orderId);
  if (!o && hint.paymentKey && PAYMENT_KEY.test(hint.paymentKey)) o = await find('payment_key', hint.paymentKey);
  if (!o) return { matched: false };
  const report = emptyTossReport();
  await refreshFromProvider(deps, o, report);
  addTossReport(report, await reconcileTossPayments(deps, { orderId: o.id }));
  return { matched: true, report };
}

/** Warm-instance defence for the unauthenticated webhook; per sender and in total, per minute. */
export const TOSS_WEBHOOK_LIMIT = { perClient: 30, total: 120 } as const;
const webhookBuckets = new Map<string, { count: number; until: number }>();
/** Bounded memory; only a hash of the sender is kept, never the address. */
export function allowTossWebhook(client: string, now = Date.now()): boolean {
  for (const [key, bucket] of webhookBuckets) if (bucket.until <= now) webhookBuckets.delete(key);
  const limits: Array<[string, number]> = [
    ['total', TOSS_WEBHOOK_LIMIT.total],
    [`client:${createHash('sha256').update(client).digest('hex')}`, TOSS_WEBHOOK_LIMIT.perClient],
  ];
  if (webhookBuckets.size > 4096 || limits.some(([key, limit]) => (webhookBuckets.get(key)?.count ?? 0) >= limit))
    return false;
  for (const [key] of limits) {
    const current = webhookBuckets.get(key);
    webhookBuckets.set(key, { count: (current?.count ?? 0) + 1, until: current?.until ?? now + 60_000 });
  }
  return true;
}
export function resetTossWebhookLimit(): void {
  webhookBuckets.clear();
}

/** The `/admin` dashboard's "결제 확인 필요": what automation handed to an operator. */
export async function countManualTossPayments(sql: SqlRunner): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int n from billing_payments where payment_type='NORMAL' and (
      (status='refund_pending' and failure_code in ('refund_manual','partial_balance')) or
      (status='paid' and failure_code='fulfil_manual'))`,
  );
  return rows[0]?.n ?? 0;
}

export async function renderPaymentStatus(
  sql: SqlRunner,
  renderId: string,
): Promise<string | null> {
  const { rows } = await sql.query<{ status: string; failure_code: string | null }>(
    'select status, failure_code from billing_payments where render_id=$1',
    [renderId],
  );
  const p = rows[0];
  if (!p) return null;
  // An operator holds the refund now: the failure email goes out once, without saying it is done.
  if (p.status === 'refund_pending' && (p.failure_code === 'refund_manual' || p.failure_code === 'partial_balance'))
    return 'refund_manual';
  return p.status;
}
