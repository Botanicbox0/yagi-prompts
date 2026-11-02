import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Viewer } from "@/lib/auth/identity";
import { TossError, type TossPayment } from "@/lib/billing/toss-gateway";
import { fundingProviderMethodSupported } from "./payment-method";
import {
  Denied,
  run,
  seat,
  studio,
  lockCase,
  event,
  clock,
  stamp,
  open,
  schemaReady,
  environmentMatches,
  uuid,
  type FundingDeps,
  type Row,
  type Outcome,
} from "./core";
const LEASE = 60000,
  MAX_WINDOW = 30 * 60000,
  BATCH = 20;
const Create = z
  .object({ caseId: z.string().uuid(), requestId: z.string().uuid() })
  .strict();
export async function createFundingOrder(
  deps: FundingDeps,
  viewer: Viewer,
  input: unknown,
) {
  if (!open(deps))
    return { ok: false as const, code: "payments_closed" as const };
  return run(deps.sql, viewer, Create, input, async (sql, id, v) => {
    const c = await lockCase(sql, v.caseId);
    await seat(sql, id, String(c.project_id), true);
    if (c.status !== "accepted") throw new Denied("conflict");
    const q = (
      await sql.query(
        "select * from campaign_funding_quotes where case_id=$1 and status='accepted'",
        [c.id],
      )
    ).rows[0];
    const now = clock(deps);
    if (!q || new Date(stamp(q.valid_until)) <= now)
      throw new Denied("conflict");
    await sql.query(
      "update campaign_funding_payments set status='expired',updated_at=$2 where case_id=$1 and status='pending' and expires_at<=$2",
      [c.id, now],
    );
    const replay = (
      await sql.query(
        "select * from campaign_funding_payments where created_by=$1 and request_id=$2",
        [id, v.requestId],
      )
    ).rows[0];
    if (
      replay &&
      (replay.case_id !== c.id ||
        replay.environment !== deps.gateway.kind ||
        replay.status !== "pending")
    )
      throw new Denied("conflict");
    const existing =
      replay ??
      (
        await sql.query(
          "select * from campaign_funding_payments where case_id=$1 and status in ('pending','confirming','awaiting_deposit','paid','review','refund_pending','refunded')",
          [c.id],
        )
      ).rows[0];
    if (existing) {
      if (
        existing.status !== "pending" ||
        existing.environment !== deps.gateway.kind
      )
        throw new Denied("conflict");
      return {
        order: {
          id: String(existing.id),
          amountKrw: Number(existing.amount_krw),
          name: String(existing.order_name),
        },
      };
    }
    if (
      Number(
        (
          await sql.query(
            "select count(*)::int as n from campaign_funding_payments where case_id=$1",
            [c.id],
          )
        ).rows[0]!.n,
      ) >= 10
    )
      throw new Denied("rate_limited");
    const paymentId = randomUUID(),
      name = `TWINGS #${Number(q.revision)}`;
    await sql.query(
      "insert into campaign_funding_payments(id,case_id,quote_id,environment,amount_krw,order_name,expires_at,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        paymentId,
        c.id,
        q.id,
        deps.gateway.kind,
        q.total_krw,
        name,
        new Date(Math.min(+now + MAX_WINDOW, +new Date(stamp(q.valid_until)))),
        id,
        v.requestId,
      ],
    );
    await event(sql, c.id, q.id, "order_created", id);
    return { order: { id: paymentId, amountKrw: Number(q.total_krw), name } };
  });
}
const matches = (p: TossPayment, o: Row) =>
  p.orderId === o.id &&
  p.paymentKey === o.payment_key &&
  p.amount === Number(o.amount_krw) &&
  p.currency === "KRW";
async function settle(
  deps: FundingDeps,
  o: Row,
  p: TossPayment | null,
  definitiveRejection = false,
): Promise<Outcome<{ id: string; state: string }>> {
  let status: string,
    caseState: string | null = null,
    code: "confirm_pending" | "payment_failed" | "payment_review" | null = null;
  if (!p) {
    const rejected =
      definitiveRejection || o.failure_code === "confirm_rejected";
    code = rejected ? "payment_failed" : "confirm_pending";
    status = rejected ? "failed" : "confirming";
  } else if (p.paymentKey === o.payment_key && p.orderId !== o.id) {
    // Provider proof that this key belongs to another order. Never confirm/cancel that order.
    status = "failed";
    caseState = "accepted";
    code = "payment_failed";
  } else if (!matches(p, o)) {
    status = "review";
    caseState = "review";
    code = "payment_review";
  } else if (p.status === "DONE" && p.balance === Number(o.amount_krw)) {
    status = "paid";
    caseState = "paid";
  } else if (
    ["ABORTED", "EXPIRED"].includes(p.status) ||
    (p.status === "CANCELED" && p.balance === 0)
  ) {
    status = "failed";
    code = "payment_failed";
  } else if (p.status === "WAITING_FOR_DEPOSIT") {
    status = "awaiting_deposit";
    code = "confirm_pending";
  } else if (["IN_PROGRESS", "READY"].includes(p.status)) {
    status = "confirming";
    code = "confirm_pending";
  } else {
    status = "review";
    caseState = "review";
    code = "payment_review";
  }
  const applied = await deps.sql.transaction(async (sql) => {
    await lockCase(sql, String(o.case_id));
    const updated = (
      await sql.query(
        `update campaign_funding_payments set status=$3,lease_until=$4,lease_token=null,failure_code=$5,approved_at=case when $3='paid' then $6 else approved_at end,updated_at=$6 where id=$1 and status in ('confirming','awaiting_deposit') and lease_token=$2 returning id`,
        [
          o.id,
          o.lease_token,
          status,
          ["confirming", "awaiting_deposit"].includes(status)
            ? new Date(+clock(deps) + LEASE)
            : null,
          code,
          clock(deps),
        ],
      )
    ).rows[0];
    if (!updated) return false;
    if (caseState)
      await sql.query(
        "update campaign_funding_cases set status=$2 where id=$1",
        [o.case_id, caseState],
      );
    if (!["confirming", "awaiting_deposit"].includes(status))
      await event(sql, o.case_id, o.quote_id, status, null);
    return true;
  });
  if (!applied) return { ok: false, code: "confirm_pending" };
  return code
    ? { ok: false, code }
    : { ok: true, id: String(o.id), state: "paid" };
}
const Confirm = z
  .object({
    orderId: z.string().uuid(),
    paymentKey: z.string().min(1).max(200),
    amount: z.number().int().positive(),
  })
  .strict();
export async function confirmFundingPayment(
  deps: FundingDeps,
  viewer: Viewer,
  input: unknown,
): Promise<Outcome<{ id: string; state: string }>> {
  if (!open(deps)) return { ok: false, code: "payments_closed" };
  const preflight = await run(
    deps.sql,
    viewer,
    Confirm,
    input,
    async (sql, id, v) => {
      const o = (
        await sql.query(
          "select o.*,c.project_id from campaign_funding_payments o join campaign_funding_cases c on c.id=o.case_id where o.id=$1",
          [v.orderId],
        )
      ).rows[0];
      if (!o) throw new Denied("not_found");
      await seat(sql, id, String(o.project_id), true);
      if (o.environment !== deps.gateway.kind)
        throw new Denied("payments_closed");
      if (Number(o.amount_krw) !== v.amount)
        throw new Denied("amount_mismatch");
      return {
        pending: o.status === "pending",
        orderId: v.orderId,
        paymentKey: v.paymentKey,
      };
    },
  );
  if (!preflight.ok) return preflight;
  if (preflight.pending) {
    try {
      const p = await deps.gateway.retrieve(preflight.paymentKey);
      if (
        p &&
        (p.paymentKey !== preflight.paymentKey ||
          p.orderId !== preflight.orderId)
      )
        return { ok: false, code: "payment_review" };
      // Refuse unsupported/unknown real methods before any approval call.
      // Existing issued orders still reconcile their provider truth separately.
      if (deps.gateway.kind !== "fake" && !fundingProviderMethodSupported(p))
        return { ok: false, code: "payment_review" };
    } catch {
      return { ok: false, code: "confirm_pending" };
    }
  }
  const result = await run(
    deps.sql,
    viewer,
    Confirm,
    input,
    async (sql, id, v) => {
      const found = (
        await sql.query(
          "select case_id from campaign_funding_payments where id=$1",
          [v.orderId],
        )
      ).rows[0];
      if (!found) throw new Denied("not_found");
      const c = await lockCase(sql, String(found.case_id));
      await seat(sql, id, String(c.project_id), true);
      const o = (
        await sql.query(
          "select * from campaign_funding_payments where id=$1 for update",
          [v.orderId],
        )
      ).rows[0]!;
      if (o.environment !== deps.gateway.kind)
        throw new Denied("payments_closed");
      if (Number(o.amount_krw) !== v.amount)
        throw new Denied("amount_mismatch");
      if (o.status !== "pending") {
        if (o.payment_key !== v.paymentKey) throw new Denied("conflict");
        if (o.status === "paid")
          return { order: o, claimed: false, state: "paid" };
        if (["confirming", "awaiting_deposit"].includes(String(o.status)))
          return { order: o, claimed: false, state: "confirming" };
        throw new Denied("conflict");
      }
      const q = (
        await sql.query("select * from campaign_funding_quotes where id=$1", [
          o.quote_id,
        ])
      ).rows[0];
      if (
        c.status !== "accepted" ||
        q?.status !== "accepted" ||
        new Date(stamp(q.valid_until)) <= clock(deps) ||
        new Date(stamp(o.expires_at)) <= clock(deps)
      )
        throw new Denied("conflict");
      const token = randomUUID();
      await sql.query(
        "update campaign_funding_payments set status='confirming',payment_key=$2,lease_token=$3,lease_until=$4,updated_at=$5 where id=$1",
        [
          o.id,
          v.paymentKey,
          token,
          new Date(+clock(deps) + LEASE),
          clock(deps),
        ],
      );
      return {
        order: { ...o, payment_key: v.paymentKey, lease_token: token },
        claimed: true,
        state: "confirming",
      };
    },
  );
  if (!result.ok) return result;
  if (!result.claimed)
    return result.state === "paid"
      ? { ok: true, id: String(result.order.id), state: "paid" }
      : { ok: false, code: "confirm_pending" };
  try {
    return await settle(
      deps,
      result.order,
      await deps.gateway.confirm({
        paymentKey: String(result.order.payment_key),
        orderId: String(result.order.id),
        amount: Number(result.order.amount_krw),
        idempotencyKey: `campaign-confirm-${result.order.id}`,
      }),
    );
  } catch (error) {
    if (error instanceof TossError && !error.retryable) {
      await deps.sql.query(
        "update campaign_funding_payments set failure_code='confirm_rejected' where id=$1 and status='confirming' and lease_token=$2",
        [result.order.id, result.order.lease_token],
      );
      try {
        return await settle(
          deps,
          result.order,
          await deps.gateway.retrieve(String(result.order.payment_key)),
          true,
        );
      } catch {
        /* definitive refusal persisted, but provider lookup still unavailable */
      }
    }
    return { ok: false, code: "confirm_pending" };
  }
}

/**
 * Retrieve-only recovery: an unknown approval or cancellation is never blindly repeated. A receipt is
 * read at the provider again only on the webhook's hint (`reconcileFundingWebhook`).
 */
export async function reconcileFunding(deps: FundingDeps, paymentId?: string) {
  if (!(await schemaReady(deps.sql)) || !environmentMatches(deps))
    return { checked: 0 };
  let checked = 0;
  const now = clock(deps);
  const rows = (
    await deps.sql.query(
      `select id from campaign_funding_payments where environment=$1 and status in ('confirming','awaiting_deposit','refund_pending') and (lease_until is null or lease_until<=$2) ${paymentId ? "and id=$3" : ""} order by updated_at limit ${BATCH}`,
      [deps.gateway.kind, now, ...(paymentId ? [paymentId] : [])],
    )
  ).rows;
  for (const row of rows) {
    const token = randomUUID();
    const o = (
      await deps.sql.query(
        "update campaign_funding_payments set lease_token=$2,lease_until=$3,updated_at=$4 where id=$1 and status in ('confirming','awaiting_deposit','refund_pending') and (lease_until is null or lease_until<=$4) returning *",
        [row.id, token, new Date(+now + LEASE), now],
      )
    ).rows[0];
    if (!o?.payment_key) continue;
    checked++;
    try {
      const p = await deps.gateway.retrieve(String(o.payment_key));
      if (["confirming", "awaiting_deposit"].includes(String(o.status)))
        await settle(deps, o, p);
      else await settleRefund(deps, o, p);
    } catch {
      /* durable claim stays leased; no retry charge or cancellation */
    }
  }
  return { checked };
}
async function settleRefund(deps: FundingDeps, o: Row, p: TossPayment | null) {
  if (!p || !matches(p, o) || p.status !== "CANCELED" || p.balance !== 0)
    return false;
  return deps.sql.transaction(async (sql) => {
    await lockCase(sql, String(o.case_id));
    const updated = (
      await sql.query(
        "update campaign_funding_payments set status='refunded',refunded_at=$3,lease_until=null,lease_token=null,updated_at=$3 where id=$1 and status='refund_pending' and lease_token=$2 returning id",
        [o.id, o.lease_token, clock(deps)],
      )
    ).rows[0];
    if (!updated) return false;
    await sql.query(
      "update campaign_funding_cases set status='refunded' where id=$1",
      [o.case_id],
    );
    await event(sql, o.case_id, o.quote_id, "refunded", null);
    return true;
  });
}

/**
 * A receipt the provider changed after payment: a cancellation in the merchant console, whole or in
 * part (docs/PLATFORM-2.0.md §2.2-5), read with the order's OWN key under the same lease as every other
 * step. Money that was received and went back in full is recorded as `refunded` — a receipt only
 * (0049), so nothing else to undo and nothing to cancel again; a partial cancellation goes to `review`.
 */
async function settleAfterPayment(deps: FundingDeps, paymentId: string) {
  const now = clock(deps),
    token = randomUUID();
  const o = (
    await deps.sql.query(
      "update campaign_funding_payments set lease_token=$2,lease_until=$3 where id=$1 and status in ('paid','review') and approved_at is not null and payment_key is not null and (lease_until is null or lease_until<=$4) returning *",
      [paymentId, token, new Date(+now + LEASE), now],
    )
  ).rows[0];
  if (!o) return;
  const release = () =>
    deps.sql.query(
      "update campaign_funding_payments set lease_token=null,lease_until=null where id=$1 and lease_token=$2",
      [o.id, token],
    );
  let p: TossPayment | null;
  try {
    p = await deps.gateway.retrieve(String(o.payment_key));
  } catch (error) {
    // Unknown, not unpaid: the webhook answers 503 and the provider delivers the hint again.
    await release();
    throw error;
  }
  const next = !p || !matches(p, o)
    ? null
    : p.status === "CANCELED" && p.balance === 0
      ? "refunded"
      : o.status === "paid" &&
          !(p.status === "DONE" && p.balance === Number(o.amount_krw))
        ? "review"
        : null;
  if (!next) {
    await release();
    return;
  }
  await deps.sql.transaction(async (sql) => {
    await lockCase(sql, String(o.case_id));
    const updated = (
      await sql.query(
        `update campaign_funding_payments set ${next === "refunded" ? "status='refunded',refunded_at=$3" : "status='review',failure_code='payment_review'"},lease_until=null,lease_token=null,updated_at=$3 where id=$1 and status in ('paid','review') and lease_token=$2 returning id`,
        [o.id, token, clock(deps)],
      )
    ).rows[0];
    if (!updated) return;
    await sql.query("update campaign_funding_cases set status=$2 where id=$1", [
      o.case_id,
      next,
    ]);
    await event(sql, o.case_id, o.quote_id, next, null);
  });
}
/**
 * The Toss webhook's hint for this table (app/api/billing/toss/webhook): the body only names an order.
 * That one order, in this environment, is read again with its OWN stored key — the receipt rule above,
 * then the usual recovery — and an unknown order reads nothing.
 */
export async function reconcileFundingWebhook(
  deps: FundingDeps,
  hint: { orderId?: string; paymentKey?: string },
): Promise<{ matched: false } | { matched: true; status: string }> {
  if (!(await schemaReady(deps.sql)) || !environmentMatches(deps))
    return { matched: false };
  const find = async (column: "id" | "payment_key", value: string) =>
    (
      await deps.sql.query(
        `select id from campaign_funding_payments where environment=$1 and ${column}=$2`,
        [deps.gateway.kind, value],
      )
    ).rows[0];
  let o = uuid(hint.orderId) ? await find("id", hint.orderId) : undefined;
  if (!o && hint.paymentKey) o = await find("payment_key", hint.paymentKey);
  if (!o) return { matched: false };
  await settleAfterPayment(deps, String(o.id));
  await reconcileFunding(deps, String(o.id));
  const after = (
    await deps.sql.query(
      "select status from campaign_funding_payments where id=$1",
      [o.id],
    )
  ).rows[0]!;
  return { matched: true, status: String(after.status) };
}
const Refund = z
  .object({
    paymentId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
  })
  .strict();
export async function refundFundingPayment(
  deps: FundingDeps,
  viewer: Viewer,
  input: unknown,
): Promise<Outcome> {
  if (!environmentMatches(deps)) return { ok: false, code: "payments_closed" };
  const result = await run(
    deps.sql,
    viewer,
    Refund,
    input,
    async (sql, id, v) => {
      await studio(sql, id);
      const found = (
        await sql.query(
          "select case_id from campaign_funding_payments where id=$1",
          [v.paymentId],
        )
      ).rows[0];
      if (!found) throw new Denied("not_found");
      await lockCase(sql, String(found.case_id));
      const o = (
        await sql.query(
          "select * from campaign_funding_payments where id=$1 for update",
          [v.paymentId],
        )
      ).rows[0]!;
      if (
        o.environment !== deps.gateway.kind ||
        !["paid", "review"].includes(String(o.status)) ||
        !o.payment_key ||
        o.refund_started_at ||
        (o.lease_until && new Date(stamp(o.lease_until)) > clock(deps))
      )
        throw new Denied("conflict");
      // A preflight lease does not claim that a refund was sent or change the receipt state.
      const token = randomUUID();
      await sql.query(
        "update campaign_funding_payments set lease_token=$2,lease_until=$3 where id=$1",
        [o.id, token, new Date(+clock(deps) + LEASE)],
      );
      return {
        order: { ...o, lease_token: token } as Row,
        reason: v.reason,
        actorId: id,
      };
    },
  );
  if (!result.ok) return result;
  const o = result.order;
  let crossed = false;
  try {
    let p = await deps.gateway.retrieve(String(o.payment_key));
    if (!p || !matches(p, o)) return { ok: false, code: "payment_review" };
    const alreadyCanceled = p.status === "CANCELED" && p.balance === 0;
    if (
      !alreadyCanceled &&
      (p.status !== "DONE" || p.balance !== Number(o.amount_krw))
    )
      return { ok: false, code: "payment_review" };
    const started = await deps.sql.transaction(async (sql) => {
      await studio(sql, result.actorId);
      await lockCase(sql, String(o.case_id));
      const updated = (
        await sql.query(
          "update campaign_funding_payments set status='refund_pending',refund_reason=$3,refund_requested_by=$4,refund_started_at=$5,updated_at=$5 where id=$1 and status in ('paid','review') and lease_token=$2 and lease_until>$5 and refund_started_at is null returning id",
          [o.id, o.lease_token, result.reason, result.actorId, clock(deps)],
        )
      ).rows[0];
      if (!updated) return false;
      await sql.query(
        "update campaign_funding_cases set status='refund_pending' where id=$1",
        [o.case_id],
      );
      await event(
        sql,
        o.case_id,
        o.quote_id,
        "refund_requested",
        result.actorId,
        result.reason,
      );
      return true;
    });
    if (!started) return { ok: false, code: "confirm_pending" };
    crossed = true;
    if (!alreadyCanceled)
      p = await deps.gateway.cancel({
        paymentKey: String(o.payment_key),
        reason: result.reason.slice(0, 200),
        idempotencyKey: `campaign-refund-${o.id}`,
      });
    return (await settleRefund(deps, o, p))
      ? { ok: true }
      : { ok: false, code: "payment_review" };
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    return { ok: false, code: "confirm_pending" };
  } finally {
    if (!crossed)
      await deps.sql.query(
        "update campaign_funding_payments set lease_token=null,lease_until=null where id=$1 and status in ('paid','review') and lease_token=$2",
        [o.id, o.lease_token],
      );
  }
}

const Release = z
  .object({
    paymentId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
  })
  .strict();
/** Administrator recovery requires provider proof of non-payment; an empty/failed lookup alone proves nothing. */
export async function releaseUnpaidFundingOrder(
  deps: FundingDeps,
  viewer: Viewer,
  input: unknown,
): Promise<Outcome> {
  if (!environmentMatches(deps)) return { ok: false, code: "payments_closed" };
  const claim = await run(
    deps.sql,
    viewer,
    Release,
    input,
    async (sql, id, v) => {
      await studio(sql, id);
      const found = (
        await sql.query(
          "select case_id from campaign_funding_payments where id=$1",
          [v.paymentId],
        )
      ).rows[0];
      if (!found) throw new Denied("not_found");
      await lockCase(sql, String(found.case_id));
      const o = (
        await sql.query(
          "select * from campaign_funding_payments where id=$1 for update",
          [v.paymentId],
        )
      ).rows[0]!;
      if (
        o.environment !== deps.gateway.kind ||
        !["confirming", "review", "awaiting_deposit"].includes(
          String(o.status),
        ) ||
        !o.payment_key ||
        (o.lease_until && new Date(stamp(o.lease_until)) > clock(deps))
      )
        throw new Denied("conflict");
      const token = randomUUID();
      await sql.query(
        "update campaign_funding_payments set lease_token=$2,lease_until=$3 where id=$1",
        [o.id, token, new Date(+clock(deps) + LEASE)],
      );
      return {
        order: { ...o, lease_token: token } as Row,
        actorId: id,
        reason: v.reason,
      };
    },
  );
  if (!claim.ok) return claim;
  const o = claim.order;
  try {
    const p = await deps.gateway.retrieve(String(o.payment_key));
    const proven = p
      ? (p.paymentKey === o.payment_key && p.orderId !== o.id) ||
        (matches(p, o) &&
          (["ABORTED", "EXPIRED"].includes(p.status) ||
            (p.status === "CANCELED" && p.balance === 0)))
      : o.failure_code === "confirm_rejected";
    if (!proven) return { ok: false, code: "confirm_pending" };
    return await deps.sql.transaction(async (sql) => {
      await studio(sql, claim.actorId);
      const c = await lockCase(sql, String(o.case_id));
      const changed = (
        await sql.query(
          "update campaign_funding_payments set status='failed',failure_code='provider_unpaid',lease_token=null,lease_until=null where id=$1 and lease_token=$2 and status in ('confirming','review','awaiting_deposit') returning id",
          [o.id, o.lease_token],
        )
      ).rows[0];
      if (!changed)
        return { ok: false as const, code: "confirm_pending" as const };
      if (c.status === "review")
        await sql.query(
          "update campaign_funding_cases set status='accepted' where id=$1",
          [c.id],
        );
      await event(
        sql,
        o.case_id,
        o.quote_id,
        "unpaid_order_released",
        claim.actorId,
        claim.reason,
      );
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    return { ok: false, code: "confirm_pending" };
  } finally {
    await deps.sql.query(
      "update campaign_funding_payments set lease_token=null,lease_until=null where id=$1 and lease_token=$2 and status in ('confirming','review','awaiting_deposit')",
      [o.id, o.lease_token],
    );
  }
}
