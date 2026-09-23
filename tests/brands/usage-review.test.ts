import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { usageFixture, kstDay, type UsageFixture } from "@/tests/helpers/brand-usage";
import * as s from "@/lib/brands/workspace/service";
import * as u from "@/lib/brands/usage/service";
import * as pay from "@/lib/brands/usage/payment";
import { activateUsageCase } from "@/lib/brands/usage/core";
import { usagePaymentsOpen, type UsageRuntime } from "@/lib/brands/usage/runtime";
import { createFakeTossGateway, type FakeTossGateway } from "@/lib/billing/toss-fake";
import { TossError, type TossGateway, type TossPayment } from "@/lib/billing/toss-gateway";

/**
 * Regression tests for the 2026-09-23 server and coordinator reviews of secondary usage
 * (docs/SECONDARY-USAGE.md §2). Real PGlite transactions throughout; fixture values only.
 */
let f: UsageFixture, gateway: FakeTossGateway;
const PREVIEW: UsageRuntime = { production: false }, PRODUCTION: UsageRuntime = { production: true };
const deps = (extra: Partial<pay.UsagePaymentDeps> = {}): pay.UsagePaymentDeps => ({ sql: f.sql, gateway, paymentsOpen: true, runtime: PREVIEW, ...extra });
const idOf = (r: { ok: boolean; code?: string; id?: string }) => { if (!r.ok) throw Error(r.code); return r.id!; };
const revision = async (caseId: string) => Number((await f.sql.query("select revision from brand_usage_cases where id=$1", [caseId])).rows[0]!.revision);
const caseRow = async (caseId: string) => (await f.sql.query("select * from brand_usage_cases where id=$1", [caseId])).rows[0]!;
const paymentRow = async (id: string) => (await f.sql.query("select * from brand_usage_payments where id=$1", [id])).rows[0]!;
const grants = async (caseId: string) => (await f.sql.query("select * from brand_usage_grants where case_id=$1", [caseId])).rows;
async function accepted(total = 50000) {
  const q = await f.quoted(total);
  idOf(await u.acceptUsageQuote({ sql: f.sql, paymentsOpen: true }, f.owner, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: await revision(q.caseId), requestId: randomUUID(), confirmed: true }));
  return q;
}
async function ordered(total = 50000, d = deps()) {
  const q = await accepted(total);
  const o = await pay.createUsageOrder(d, f.owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
  if (!o.ok) throw Error(o.code);
  return { ...q, orderId: o.order.id, amount: o.order.amountKrw };
}
/** A gateway whose provider answers are scripted per test: confirm and retrieve outcomes. */
function scripted(confirm: () => TossPayment | Error, retrieve: (key: string) => TossPayment | null | Error): TossGateway & { cancels: number } {
  const g = {
    kind: "fake" as const, cancels: 0,
    async confirm() { const r = confirm(); if (r instanceof Error) throw r; return r; },
    async retrieve(key: string) { const r = retrieve(key); if (r instanceof Error) throw r; return r; },
    async cancel(input: { paymentKey: string }) { g.cancels++; return { ...(retrieve(input.paymentKey) as TossPayment), status: "CANCELED", balance: 0 }; },
  };
  return g;
}
const snap = (o: { orderId: string; amount: number }, key: string, status: string, balance = o.amount): TossPayment => ({ paymentKey: key, orderId: o.orderId, amount: o.amount, currency: "KRW", status, balance });

beforeEach(async () => {
  f = await usageFixture();
  gateway = createFakeTossGateway();
});
afterEach(async () => { vi.unstubAllEnvs(); await f.db.close(); });

describe("1. production never grants from test or fake payments", () => {
  it("opens payments on production only with live Toss keys", () => {
    const env = (extra: Record<string, string>) => ({ BRAND_USAGE_PAYMENTS: "on", ...extra }) as unknown as NodeJS.ProcessEnv;
    expect(usagePaymentsOpen(env({}))).toBe(true);
    expect(usagePaymentsOpen(env({ VERCEL_ENV: "preview", TOSS_CLIENT_KEY: "test_gck_x", TOSS_SECRET_KEY: "test_gsk_x" }))).toBe(true);
    expect(usagePaymentsOpen(env({ VERCEL_ENV: "production", TOSS_CLIENT_KEY: "test_gck_x", TOSS_SECRET_KEY: "test_gsk_x" }))).toBe(false);
    expect(usagePaymentsOpen(env({ VERCEL_ENV: "production" }))).toBe(false);
    expect(usagePaymentsOpen(env({ VERCEL_ENV: "production", TOSS_CLIENT_KEY: "live_gck_x", TOSS_SECRET_KEY: "live_gsk_x" }))).toBe(true);
    expect(usagePaymentsOpen({ VERCEL_ENV: "production", TOSS_CLIENT_KEY: "live_gck_x", TOSS_SECRET_KEY: "live_gsk_x" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it("refuses to open or confirm an order through a non-live gateway on production", async () => {
    const q = await accepted();
    expect(await pay.createUsageOrder(deps({ runtime: PRODUCTION }), f.owner, { caseId: q.caseId, requestId: randomUUID(), consent: true })).toMatchObject({ ok: false, code: "payments_closed" });
    const o = await pay.createUsageOrder(deps(), f.owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!o.ok) throw Error(o.code);
    gateway.authorize(o.order.id, o.order.amountKrw);
    expect(await pay.confirmUsagePayment(deps({ runtime: PRODUCTION }), f.owner, { orderId: o.order.id, paymentKey: gateway.keyFor(o.order.id), amount: o.order.amountKrw })).toMatchObject({ ok: false, code: "payments_closed" });
    expect(gateway.confirmCalls).toBe(0);
  });
  it("a test payment that reached paid is blocked, not granted, by reconcile and by direct activation on production", async () => {
    const o = await ordered();
    gateway.authorize(o.orderId, o.amount);
    gateway.loseConfirmResponse = true;
    expect(await pay.confirmUsagePayment(deps(), f.owner, { orderId: o.orderId, paymentKey: gateway.keyFor(o.orderId), amount: o.amount })).toMatchObject({ ok: false, code: "confirm_pending" });
    await pay.reconcileBrandUsagePayments({ sql: f.sql, gateway, runtime: PRODUCTION, now: new Date(Date.now() + 120000) });
    expect(await caseRow(o.caseId)).toMatchObject({ status: "blocked_after_payment", blocked_reason: "non_live_payment" });
    expect(await grants(o.caseId)).toHaveLength(0);
    // The studio re-check cannot turn it into a grant on production either.
    await f.sql.query("update brand_usage_cases set status='paid' where id=$1", [o.caseId]);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await activateUsageCase(f.sql, o.caseId)).toBe("blocked_after_payment");
    expect(await grants(o.caseId)).toHaveLength(0);
  });
  it("the same fake payment on a preview or local run still activates (explicit runtime injection)", async () => {
    const o = await ordered();
    gateway.authorize(o.orderId, o.amount);
    expect(await pay.confirmUsagePayment(deps(), f.owner, { orderId: o.orderId, paymentKey: gateway.keyFor(o.orderId), amount: o.amount })).toMatchObject({ ok: true, state: "fulfilled" });
    expect(await grants(o.caseId)).toHaveLength(1);
  });
});

describe("2. confirmation failure and recovery", () => {
  it("a made-up payment key is refused by the provider and released at once; the buyer can withdraw or retry", async () => {
    const o = await ordered();
    expect(await pay.confirmUsagePayment(deps(), f.owner, { orderId: o.orderId, paymentKey: "not-a-real-key", amount: o.amount })).toMatchObject({ ok: false, code: "payment_failed" });
    expect(await paymentRow(o.orderId)).toMatchObject({ status: "failed", failure_code: "provider_not_found", lease_until: null });
    const again = await pay.createUsageOrder(deps(), f.owner, { caseId: o.caseId, requestId: randomUUID(), consent: true });
    expect(again.ok && again.order.id).not.toBe(o.orderId);
    expect(await u.withdrawUsageCase({ sql: f.sql }, f.owner, { caseId: o.caseId, expectedRevision: await revision(o.caseId) })).toMatchObject({ ok: true });
  });
  it("network uncertainty keeps the claim; not-found is proof only after the provider window; a retrieve error is never proof", async () => {
    const o = await ordered();
    let retrieveFails = true;
    const g = scripted(() => new TossError("NETWORK_ERROR"), () => retrieveFails ? new TossError("NETWORK_ERROR") : null);
    expect(await pay.confirmUsagePayment(deps({ gateway: g }), f.owner, { orderId: o.orderId, paymentKey: "key-1", amount: o.amount })).toMatchObject({ ok: false, code: "confirm_pending" });
    const later = (ms: number) => ({ sql: f.sql, gateway: g, runtime: PREVIEW, now: new Date(Date.now() + ms) });
    await pay.reconcileBrandUsagePayments(later(3 * 3600000));
    expect((await paymentRow(o.orderId)).status).toBe("confirming");
    retrieveFails = false;
    await pay.reconcileBrandUsagePayments(later(5 * 60000)); // lease still running: untouched
    expect((await paymentRow(o.orderId)).status).toBe("confirming");
    await f.sql.query("update brand_usage_payments set lease_until=now()-interval '1 second' where id=$1", [o.orderId]);
    await pay.reconcileBrandUsagePayments(later(60000)); // not found, but inside the window
    expect((await paymentRow(o.orderId)).status).toBe("confirming");
    await f.sql.query("update brand_usage_payments set lease_until=now()-interval '1 second' where id=$1", [o.orderId]);
    await pay.reconcileBrandUsagePayments(later(2 * 3600000));
    expect(await paymentRow(o.orderId)).toMatchObject({ status: "failed", failure_code: "provider_not_found" });
    expect(await caseRow(o.caseId)).toMatchObject({ status: "accepted" });
  });
  it("maps provider cancellation to a non-grant state and a partial cancel to studio review", async () => {
    const a = await ordered();
    const canceled = scripted(() => new TossError("NETWORK_ERROR"), key => snap(a, key, "CANCELED", 0));
    await pay.confirmUsagePayment(deps({ gateway: canceled }), f.owner, { orderId: a.orderId, paymentKey: "key-a", amount: a.amount });
    await f.sql.query("update brand_usage_payments set lease_until=now()-interval '1 second' where id=$1", [a.orderId]);
    await pay.reconcileBrandUsagePayments({ sql: f.sql, gateway: canceled, runtime: PREVIEW });
    expect(await paymentRow(a.orderId)).toMatchObject({ status: "failed", failure_code: "provider_canceled" });
    expect(await grants(a.caseId)).toHaveLength(0);

    const b = await ordered();
    const partial = scripted(() => snap(b, "key-b", "PARTIAL_CANCELED", b.amount / 2), key => snap(b, key, "PARTIAL_CANCELED", b.amount / 2));
    expect(await pay.confirmUsagePayment(deps({ gateway: partial }), f.owner, { orderId: b.orderId, paymentKey: "key-b", amount: b.amount })).toMatchObject({ ok: false, code: "payment_review" });
    expect(await paymentRow(b.orderId)).toMatchObject({ status: "review", failure_code: "provider_partial_canceled" });
    expect(await grants(b.caseId)).toHaveLength(0);
    // Money may be held: no new order, no withdrawal, and "abandon" is refused.
    expect(await pay.createUsageOrder(deps({ gateway: partial }), f.owner, { caseId: b.caseId, requestId: randomUUID(), consent: true })).toMatchObject({ ok: false, code: "conflict" });
    expect(await u.withdrawUsageCase({ sql: f.sql }, f.owner, { caseId: b.caseId, expectedRevision: await revision(b.caseId) })).toMatchObject({ ok: false, code: "conflict" });
    expect(await pay.resolveUsageCase(deps({ gateway: partial }), f.studio, { caseId: b.caseId, action: "abandon", reason: "x" })).toMatchObject({ ok: false, code: "payment_review" });
    expect((await paymentRow(b.orderId)).status).toBe("review");
    // A provider snapshot for another order is never applied.
    const c = await ordered();
    const wrong = scripted(() => snap({ orderId: randomUUID(), amount: c.amount }, "key-c", "DONE"), () => null);
    expect(await pay.confirmUsagePayment(deps({ gateway: wrong }), f.owner, { orderId: c.orderId, paymentKey: "key-c", amount: c.amount })).toMatchObject({ ok: false, code: "payment_review" });
    expect(await paymentRow(c.orderId)).toMatchObject({ status: "review", failure_code: "provider_mismatch" });
    expect(await grants(c.caseId)).toHaveLength(0);
  });
  it("the studio may release a stuck confirmation only after the provider shows it unpaid", async () => {
    const o = await ordered();
    let answer: TossPayment | null | Error = new TossError("NETWORK_ERROR");
    const g = scripted(() => new TossError("NETWORK_ERROR"), () => answer);
    await pay.confirmUsagePayment(deps({ gateway: g }), f.owner, { orderId: o.orderId, paymentKey: "key-s", amount: o.amount });
    expect(await pay.resolveUsageCase(deps({ gateway: g }), f.studio, { caseId: o.caseId, action: "abandon", reason: "stuck" })).toMatchObject({ ok: false, code: "confirm_pending" });
    answer = snap(o, "key-s", "IN_PROGRESS");
    expect(await pay.resolveUsageCase(deps({ gateway: g }), f.studio, { caseId: o.caseId, action: "abandon", reason: "stuck" })).toMatchObject({ ok: false, code: "payment_review" });
    answer = snap(o, "key-s", "ABORTED");
    expect(await pay.resolveUsageCase(deps({ gateway: g }), f.studio, { caseId: o.caseId, action: "abandon", reason: "stuck" })).toMatchObject({ ok: true });
    expect(await paymentRow(o.orderId)).toMatchObject({ status: "failed", failure_code: "abandoned_unpaid" });
    expect(await pay.resolveUsageCase(deps({ gateway: g }), f.owner, { caseId: o.caseId, action: "abandon", reason: "x" })).toMatchObject({ ok: false, code: "forbidden" });
  });
  it("more than 20 unresolved confirmations never starve activation or a studio refund", async () => {
    // One case paid but not yet activated (e.g. the process stopped between the two steps).
    const paid = await ordered();
    await f.sql.query("update brand_usage_payments set status='paid',payment_key='k-paid',approved_at=now(),updated_at=now()+interval '1 hour' where id=$1", [paid.orderId]);
    await f.sql.query("update brand_usage_cases set status='paid' where id=$1", [paid.caseId]);
    // One refund the studio decided whose first cancel attempt failed.
    const refunded = await ordered();
    gateway.authorize(refunded.orderId, refunded.amount);
    idOf({ ...(await pay.confirmUsagePayment(deps(), f.owner, { orderId: refunded.orderId, paymentKey: gateway.keyFor(refunded.orderId), amount: refunded.amount })), id: "x" });
    gateway.failCancel = true;
    expect(await pay.resolveUsageCase(deps(), f.studio, { caseId: refunded.caseId, action: "refund", reason: "Studio decision" })).toMatchObject({ ok: false, code: "refund_failed" });
    gateway.failCancel = false;
    // 25 confirmations the provider cannot resolve yet, all older than both.
    for (let i = 0; i < 25; i++) {
      const stale = await ordered(1000 + i);
      await f.sql.query("update brand_usage_payments set status='confirming',payment_key=$2,lease_until=now()-interval '2 hours',updated_at=now()-interval '2 hours' where id=$1", [stale.orderId, `unknown-${i}`]);
    }
    const r = await pay.reconcileBrandUsagePayments({ sql: f.sql, gateway, runtime: PREVIEW, now: new Date(Date.now() + 11 * 60000) });
    expect(await caseRow(paid.caseId)).toMatchObject({ status: "fulfilled" });
    expect((await paymentRow(refunded.orderId)).status).toBe("refunded");
    expect(r.checked).toBe(22); // 1 activation + 1 refund + one batch of 20 unresolved
    // The unresolved ones stay claimed (not found inside the window proves nothing) and back off.
    expect((await f.sql.query("select count(*)::int n from brand_usage_payments where status='confirming'")).rows[0]!.n).toBe(25);
  });
});

describe("3. only a final tax-inclusive total can be accepted and charged", () => {
  it("a tax-excluded quote is shown but cannot be accepted, ordered or activated", async () => {
    const q = await f.quoted(100000, "excluded");
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: true }, f.owner, f.projectId))!;
    expect(view.cases[0]!.quote).toMatchObject({ totalKrw: 100000, taxBasis: "excluded" });
    expect(view.cases[0]!.actions).toMatchObject({ accept: false, pay: false });
    expect(await u.acceptUsageQuote({ sql: f.sql, paymentsOpen: true }, f.owner, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: await revision(q.caseId), requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "conflict" });
    // Even if a row were forced to accepted, no order or grant can follow.
    await f.sql.query("update brand_usage_quotes set status='accepted',accepted_by=$2,accepted_at=now(),acceptance_request_id=$3,acceptance_statement='forced' where id=$1", [q.quoteId, f.owner.userId, randomUUID()]);
    await f.sql.query("update brand_usage_cases set status='accepted' where id=$1", [q.caseId]);
    expect(await pay.createUsageOrder(deps(), f.owner, { caseId: q.caseId, requestId: randomUUID(), consent: true })).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("4. no source-file promise while delivery is not built", () => {
  it("rejects source_files on every pin", async () => {
    const caseId = idOf(await u.submitUsageInquiry({ sql: f.sql }, f.editor, { projectId: f.projectId, requestId: randomUUID(), subjects: [{ kind: "post", id: f.postId }], intent: "know_cost" }));
    idOf(await u.triageUsageCase({ sql: f.sql }, f.studio, { caseId, expectedRevision: 0 }));
    const itemId = String((await f.sql.query("select id from brand_usage_case_items where case_id=$1", [caseId])).rows[0]!.id);
    for (const pin of [{ kind: "original_post" }, { kind: "content_version" }, { kind: "master", attachmentId: randomUUID() }])
      expect(await u.defineUsageScope({ sql: f.sql }, f.studio, { caseId, expectedRevision: 1, requestId: randomUUID(), items: [{ itemId, pin, usageKinds: ["source_files"], channels: ["Brand site"], territory: ["KR"], advertiser: null, edits: "none", timing: { kind: "first_use", durationDays: 30 } }] }))
        .toMatchObject({ ok: false, code: "invalid", field: "items.0.usageKinds.0" });
  });
});

describe("5. studio accounts never buy for a customer", () => {
  it("an is_admin owner of the brand cannot accept or pay, and buyers cannot be granted to self or to admins", async () => {
    await f.sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')", [f.orgId, f.studio.userId]);
    const q = await f.quoted(20000);
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: true }, f.studio, f.projectId))!;
    expect(view).toMatchObject({ role: "owner", buyer: false });
    expect(view.cases[0]!.actions).toMatchObject({ accept: false, pay: false, message: true });
    expect(await u.acceptUsageQuote({ sql: f.sql, paymentsOpen: true }, f.studio, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: await revision(q.caseId), requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "forbidden" });
    await f.sql.query("update brand_memberships set role='editor' where organization_id=$1 and user_id=$2", [f.orgId, f.studio.userId]);
    expect(await u.setUsageBuyer({ sql: f.sql }, f.studio, { organizationId: f.orgId, userId: f.studio.userId, grant: true, reason: "self" })).toMatchObject({ ok: false, code: "forbidden" });
    const otherAdmin = randomUUID();
    await f.sql.query("insert into auth.users(id) values($1)", [otherAdmin]);
    await f.sql.query("insert into profiles(id,email,is_admin) values($1,$2,true)", [otherAdmin, `${otherAdmin}@example.test`]);
    await f.sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'editor')", [f.orgId, otherAdmin]);
    expect(await u.setUsageBuyer({ sql: f.sql }, f.studio, { organizationId: f.orgId, userId: otherAdmin, grant: true, reason: "admin" })).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("6. buyer authority ends with the editor seat", () => {
  it("is revoked on removal and on demotion, and a rejoin does not revive it", async () => {
    idOf(await u.setUsageBuyer({ sql: f.sql }, f.studio, { organizationId: f.orgId, userId: f.editor.userId, grant: true, reason: "Owner's written instruction" }));
    await f.sql.query("update brand_memberships set role='viewer' where organization_id=$1 and user_id=$2", [f.orgId, f.editor.userId]);
    await f.sql.query("update brand_memberships set role='editor' where organization_id=$1 and user_id=$2", [f.orgId, f.editor.userId]);
    expect((await f.sql.query("select revoke_reason from brand_usage_buyers where user_id=$1", [f.editor.userId])).rows).toEqual([{ revoke_reason: "role_changed" }]);
    const q = await f.quoted(20000);
    const accept = () => u.acceptUsageQuote({ sql: f.sql, paymentsOpen: true }, f.editor, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true });
    expect(await accept()).toMatchObject({ ok: false, code: "forbidden" });
    idOf(await u.setUsageBuyer({ sql: f.sql }, f.studio, { organizationId: f.orgId, userId: f.editor.userId, grant: true, reason: "Renewed instruction" }));
    idOf(await s.revokeStudioAccess({ sql: f.sql }, f.studio, { organizationId: f.orgId, userId: f.editor.userId, projectId: null }));
    const r = await s.createStudioInvitation({ sql: f.sql }, f.studio, { organizationId: f.orgId, projectId: null, email: f.editor.email, role: "editor", canComment: false, requestId: randomUUID() });
    if (!r.ok) throw Error(r.code);
    expect(await s.acceptBrandInvitation({ sql: f.sql, verifiedEmail: f.editor.email! }, f.editor, { token: r.token })).toMatchObject({ ok: true });
    expect((await f.sql.query("select revoke_reason from brand_usage_buyers where user_id=$1 order by created_at", [f.editor.userId])).rows).toEqual([{ revoke_reason: "role_changed" }, { revoke_reason: "membership_ended" }]);
    expect(await accept()).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("7. no quote or charge for a usage window that is gone", () => {
  it("rejects an ended window and a validity past the window's end", async () => {
    const caseId = idOf(await u.submitUsageInquiry({ sql: f.sql }, f.editor, { projectId: f.projectId, requestId: randomUUID(), subjects: [{ kind: "post", id: f.postId }], intent: "know_cost" }));
    idOf(await u.triageUsageCase({ sql: f.sql }, f.studio, { caseId, expectedRevision: 0 }));
    const itemId = String((await f.sql.query("select id from brand_usage_case_items where case_id=$1", [caseId])).rows[0]!.id);
    const scopeAndQuote = async (startsOn: string, endsOn: string, validUntil: Date) => {
      const r = await u.defineUsageScope({ sql: f.sql }, f.studio, { caseId, expectedRevision: await revision(caseId), requestId: randomUUID(), items: [{ itemId, pin: { kind: "original_post" }, usageKinds: ["organic_repost"], channels: ["Brand Instagram"], territory: ["KR"], advertiser: null, edits: "none", timing: { kind: "fixed", startsOn, endsOn } }] });
      const scopeRevisionId = idOf(r);
      const compensationId = idOf(await u.recordUsageCompensation({ sql: f.sql }, f.studio, { caseId, scopeRevisionId, requestId: randomUUID(), amountKrw: 1, taxBasis: "included", note: "" }));
      idOf(await u.recordUsageConsent({ sql: f.sql }, f.studio, { caseId, itemId, scopeRevisionId, compensationId, requestId: randomUUID(), approverKind: "creator", approvedAt: new Date().toISOString(), evidenceReference: "fixture", rightsChecks: ["ownership", "music", "people", "marks"] }));
      return u.issueUsageQuote({ sql: f.sql }, f.studio, { caseId, expectedRevision: await revision(caseId), requestId: randomUUID(), scopeRevisionId, totalKrw: 1000, taxBasis: "included", validUntil: validUntil.toISOString(), contractId: f.contractId, note: "" });
    };
    expect(await scopeAndQuote(kstDay(-10), kstDay(-1), new Date(Date.now() + 3600000))).toMatchObject({ ok: false, code: "expired" });
    expect(await scopeAndQuote(kstDay(-1), kstDay(1), new Date(Date.now() + 5 * 86400000))).toMatchObject({ ok: false, code: "expired" });
    const quoteId = idOf(await scopeAndQuote(kstDay(-1), kstDay(1), new Date(Date.now() + 3600000)));
    // Past the window, acceptance is refused before anything is charged.
    const after = new Date(Date.now() + 3 * 86400000);
    expect(await u.acceptUsageQuote({ sql: f.sql, paymentsOpen: true, now: after }, f.owner, { caseId, quoteId, expectedRevision: await revision(caseId), requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("8. consent withdrawn after fulfilment", () => {
  it("puts the grants on hold, keeps the history, flags the case and never shows an unqualified license", async () => {
    const o = await ordered();
    gateway.authorize(o.orderId, o.amount);
    await pay.confirmUsagePayment(deps(), f.owner, { orderId: o.orderId, paymentKey: gateway.keyFor(o.orderId), amount: o.amount });
    const consentId = String((await f.sql.query("select id from brand_usage_consents where case_id=$1", [o.caseId])).rows[0]!.id);
    expect(await u.withdrawUsageConsent({ sql: f.sql }, f.studio, { caseId: o.caseId, consentId })).toMatchObject({ ok: true, held: 1 });
    const [grant] = await grants(o.caseId);
    expect((await f.sql.query("select kind,reason from brand_usage_grant_events where grant_id=$1", [grant!.id])).rows).toEqual([{ kind: "suspended", reason: u.CONSENT_WITHDRAWN_HOLD }]);
    expect(await caseRow(o.caseId)).toMatchObject({ status: "fulfilled", blocked_reason: "consent_withdrawn" });
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: true }, f.owner, f.projectId))!;
    expect(view.cases[0]).toMatchObject({ state: "suspended" });
    expect(view.cases[0]!.grants[0]!.state).toBe("suspended");
    expect(JSON.stringify(view)).not.toContain("consent");
    expect((await u.loadStudioUsageQueue({ sql: f.sql }, f.studio))![0]!.id).toBe(o.caseId);
    // It cannot be resumed on the withdrawn consent; terminating clears the flag.
    expect(await u.recordUsageGrantEvent({ sql: f.sql }, f.studio, { grantId: String(grant!.id), requestId: randomUUID(), kind: "resumed", reason: "x" })).toMatchObject({ ok: false, code: "consent_missing" });
    idOf(await u.recordUsageGrantEvent({ sql: f.sql }, f.studio, { grantId: String(grant!.id), requestId: randomUUID(), kind: "terminated", reason: "Creator withdrew" }));
    expect((await caseRow(o.caseId)).blocked_reason).toBeNull();
  });
});

describe("contract unshared after the quote", () => {
  it("disables acceptance and payment until the studio shares terms again", async () => {
    const q = await f.quoted(30000);
    idOf(await s.shareBrandContract({ sql: f.sql }, f.studio, { projectId: f.projectId, contractId: f.contractId, shared: false, expectedRevision: 1 }));
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: true }, f.owner, f.projectId))!;
    expect(view.cases[0]!.quote!.contract).toBeNull();
    expect(view.cases[0]!.actions.accept).toBe(false);
    expect(await u.acceptUsageQuote({ sql: f.sql, paymentsOpen: true }, f.owner, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "conflict" });
  });
});
