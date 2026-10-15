import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { Viewer } from "@/lib/auth/identity";
import {
  TossError,
  type TossGateway,
  type TossPayment,
} from "@/lib/billing/toss-gateway";
import {
  issueFundingQuote,
  acceptFundingQuote,
  loadFundingProject,
  proposeCampaignReward,
  reviewCampaignReward,
  voidExpiredFundingQuote,
} from "@/lib/campaigns/funding/service";
import {
  createFundingOrder,
  confirmFundingPayment,
  reconcileFunding,
  refundFundingPayment,
  releaseUnpaidFundingOrder,
} from "@/lib/campaigns/funding/payment";
let db: PGlite, sql: SqlRunner;
const adminId = randomUUID(),
  ownerId = randomUUID(),
  otherId = randomUUID();
const viewer = (userId: string): Viewer => ({
  userId,
  isAdmin: userId === adminId,
  email: null,
  locale: "ko",
  tier: "free",
});
const admin = viewer(adminId),
  owner = viewer(ownerId),
  other = viewer(otherId),
  now = new Date("2026-10-16T00:00:00Z");
const snapshot = (id: string, key: string): TossPayment => ({
  orderId: id,
  paymentKey: key,
  amount: 120000,
  currency: "KRW",
  balance: 120000,
  status: "DONE",
});
const provider = new Map<string, TossPayment>();
let confirms = 0,
  cancels = 0,
  timeout = false;
const gateway: TossGateway = {
  kind: "fake",
  async confirm(v) {
    confirms++;
    const p = snapshot(v.orderId, v.paymentKey);
    provider.set(v.paymentKey, p);
    if (timeout) throw Error("timeout");
    return p;
  },
  async retrieve(key) {
    return provider.get(key) ?? null;
  },
  async cancel(v) {
    cancels++;
    const p = provider.get(v.paymentKey)!;
    const result = { ...p, status: "CANCELED", balance: 0 };
    provider.set(v.paymentKey, result);
    if (timeout) throw Error("timeout");
    return result;
  },
};
const deps = () => ({
  sql,
  gateway,
  enabled: true,
  policyReady: true,
  production: false,
  now,
});
beforeAll(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, otherId])
    await seedProfile(sql, { id, isAdmin: id === adminId });
});
afterAll(async () => {
  await db?.close();
});
async function fixture() {
  const org = randomUUID(),
    project = randomUUID(),
    campaign = randomUUID();
  await sql.query(
    "insert into brand_organizations(id,name,created_by,request_id) values($1,$2,$3,$4)",
    [org, "Funding test", adminId, randomUUID()],
  );
  await sql.query(
    "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [org, ownerId],
  );
  await sql.query(
    "insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Campaign project','Testing','creator','active',true,$3,$4)",
    [project, org, adminId, randomUUID()],
  );
  await sql.query(
    `insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots) values($1,$2,'draft',$3::jsonb,$3::jsonb,'Test brand',array['instagram'],2)`,
    [
      campaign,
      `funding-${campaign}`,
      JSON.stringify({ en: "Test", ko: "테스트" }),
    ],
  );
  await sql.query(
    "insert into campaign_collaboration_links(campaign_id,project_id,created_by) values($1,$2,$3)",
    [campaign, project, adminId],
  );
  const q = await issueFundingQuote({ sql, now }, admin, {
    campaignId: campaign,
    requestId: randomUUID(),
    totalKrw: 120000,
    taxBasis: "Tax basis supplied by accountant",
    termsSummary: "Agreed campaign service scope and refund terms",
    termsRef: "agreement-v1",
    validUntil: "2026-10-20T00:00:00.000Z",
  });
  if (!q.ok) throw Error(q.code);
  return {
    org,
    project,
    campaign,
    caseId: q.caseId,
    quoteId: q.id,
    revision: q.revision,
  };
}
async function accepted() {
  const f = await fixture();
  expect(
    await acceptFundingQuote(deps(), owner, {
      quoteId: f.quoteId,
      revision: f.revision,
      consent: true,
    }),
  ).toMatchObject({ ok: true });
  return f;
}
async function ordered() {
  const f = await accepted();
  const r = await createFundingOrder(deps(), owner, {
    caseId: f.caseId,
    requestId: randomUUID(),
  });
  if (!r.ok) throw Error(r.code);
  return { ...f, order: r.order };
}
describe("campaign funding boundary", () => {
  it("rejects verified foreign keys before binding or confirming and leaves the correct order usable", async () => {
    const f = await ordered(),
      foreignId = randomUUID(),
      foreignKey = "foreign-" + f.order.id,
      foreign = snapshot(foreignId, foreignKey),
      before = confirms;
    const different: TossGateway = {
      ...gateway,
      async retrieve() {
        return foreign;
      },
    };
    expect(
      await confirmFundingPayment({ ...deps(), gateway: different }, owner, {
        orderId: f.order.id,
        amount: 120000,
        paymentKey: foreignKey,
      }),
    ).toMatchObject({ ok: false, code: "payment_review" });
    expect(confirms).toBe(before);
    expect(
      (
        await sql.query(
          "select status,payment_key from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0],
    ).toEqual({ status: "pending", payment_key: null });
    expect(foreign).toEqual(snapshot(foreignId, foreignKey));
    expect(
      await confirmFundingPayment(deps(), owner, {
        orderId: f.order.id,
        amount: 120000,
        paymentKey: f.order.id,
      }),
    ).toMatchObject({ ok: true });
  });
  it("recovers legacy foreign-order bindings by provider proof without canceling foreign funds", async () => {
    const f = await ordered(),
      foreignKey = "legacy-" + f.order.id,
      foreign = snapshot(randomUUID(), foreignKey),
      before = cancels;
    await sql.query(
      "update campaign_funding_payments set status='confirming',payment_key=$2,lease_until=$3 where id=$1",
      [f.order.id, foreignKey, new Date(+now - 1)],
    );
    await reconcileFunding(
      {
        ...deps(),
        gateway: {
          ...gateway,
          async retrieve() {
            return foreign;
          },
        },
      },
      f.order.id,
    );
    expect(
      (
        await sql.query(
          "select status from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0]?.status,
    ).toBe("failed");
    expect(cancels).toBe(before);
    expect(
      await createFundingOrder(deps(), owner, {
        caseId: f.caseId,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
  });
  it("denies reward proposal callers before acquiring a campaign row lock", async () => {
    const f = await fixture(),
      statements: string[] = [];
    const observe = (base: SqlRunner): SqlRunner => ({
      query<T>(statement: string, values?: unknown[]) {
        statements.push(statement);
        return base.query<T>(statement, values);
      },
      transaction: (fn) => base.transaction((tx) => fn(observe(tx))),
    });
    expect(
      await proposeCampaignReward({ sql: observe(sql) }, other, {
        campaignId: f.campaign,
        projectId: f.project,
        requestId: randomUUID(),
        amountKrw: 1,
        conditions: "Foreign request",
      }),
    ).toMatchObject({ ok: false });
    expect(statements.some((statement) => /for update/i.test(statement))).toBe(
      false,
    );
  });
  it("shows quote expiry as a KST date and exact time in both locales", () => {
    for (const locale of ["ko", "en"]) {
      const result = formatBrandTimestamp("2026-10-16T15:45:00.000Z", locale);
      expect(result).toContain("17");
      expect(result).toContain("00:45 KST");
    }
  });

  it("releases only a definitive provider refusal with not-found proof, preserving unknown money", async () => {
    const f = await ordered(),
      reject: TossGateway = {
        ...gateway,
        async confirm() {
          throw new TossError("HTTP_400", false);
        },
        async retrieve() {
          return null;
        },
      };
    expect(
      await confirmFundingPayment({ ...deps(), gateway: reject }, owner, {
        orderId: f.order.id,
        amount: 120000,
        paymentKey: "rejected-key-" + f.order.id,
      }),
    ).toMatchObject({ ok: false, code: "payment_failed" });
    expect(
      await createFundingOrder(deps(), owner, {
        caseId: f.caseId,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const unknown = await ordered(),
      lost: TossGateway = {
        ...gateway,
        async confirm() {
          throw new TossError("NETWORK_ERROR");
        },
        async retrieve() {
          return null;
        },
      };
    await confirmFundingPayment({ ...deps(), gateway: lost }, owner, {
      orderId: unknown.order.id,
      amount: 120000,
      paymentKey: "unknown-" + unknown.order.id,
    });
    expect(
      await releaseUnpaidFundingOrder(
        { ...deps(), gateway: lost, now: new Date(+now + 120000) },
        admin,
        {
          paymentId: unknown.order.id,
          reason: "Check provider",
          confirmed: true,
        },
      ),
    ).toMatchObject({ ok: false, code: "confirm_pending" });
    expect(
      (
        await sql.query(
          "select status from campaign_funding_payments where id=$1",
          [unknown.order.id],
        )
      ).rows[0]?.status,
    ).toBe("confirming");
  });
  it("voids expired accepted unpaid quotes deliberately, preserving acceptance evidence; uncertain orders block void", async () => {
    const f = await accepted(),
      later = new Date("2026-10-21");
    expect(
      await voidExpiredFundingQuote({ sql, now: later }, admin, {
        caseId: f.caseId,
        reason: "Expired without payment",
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
    const old = (
      await sql.query(
        "select status,accepted_by,accepted_at,total_krw from campaign_funding_quotes where id=$1",
        [f.quoteId],
      )
    ).rows[0]!;
    expect(old.status).toBe("voided");
    expect(old.accepted_by).toBe(ownerId);
    expect(old.total_krw).toBe(120000);
    expect(
      await issueFundingQuote({ sql, now: later }, admin, {
        campaignId: f.campaign,
        requestId: randomUUID(),
        totalKrw: 130000,
        taxBasis: "Accountant supplied basis",
        termsSummary: "New separately accepted scope",
        termsRef: "agreement-v2",
        validUntil: "2026-10-25T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: true, revision: 2 });
    const uncertain = await ordered();
    timeout = true;
    await confirmFundingPayment(deps(), owner, {
      orderId: uncertain.order.id,
      amount: 120000,
      paymentKey: uncertain.order.id,
    });
    timeout = false;
    expect(
      await voidExpiredFundingQuote({ sql, now: later }, admin, {
        caseId: uncertain.caseId,
        reason: "Cannot clear uncertain money",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
  });
  it("supports asynchronous deposit receipts and recovery while acquisition flags are off", async () => {
    const f = await ordered(),
      key = "deposit-" + f.order.id,
      asyncGateway: TossGateway = {
        ...gateway,
        async confirm(v) {
          const p = {
            ...snapshot(v.orderId, v.paymentKey),
            status: "WAITING_FOR_DEPOSIT",
          };
          provider.set(v.paymentKey, p);
          return p;
        },
      };
    expect(
      await confirmFundingPayment({ ...deps(), gateway: asyncGateway }, owner, {
        orderId: f.order.id,
        amount: 120000,
        paymentKey: key,
      }),
    ).toMatchObject({ ok: false, code: "confirm_pending" });
    expect(
      (
        await sql.query(
          "select status from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0]?.status,
    ).toBe("awaiting_deposit");
    provider.set(key, snapshot(f.order.id, key));
    await reconcileFunding(
      {
        ...deps(),
        enabled: false,
        policyReady: false,
        now: new Date(+now + 120000),
      },
      f.order.id,
    );
    expect(
      (
        await sql.query(
          "select status from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0]?.status,
    ).toBe("paid");
    expect(
      await refundFundingPayment(
        {
          ...deps(),
          enabled: false,
          policyReady: false,
          now: new Date(+now + 180000),
        },
        admin,
        {
          paymentId: f.order.id,
          reason: "Agreed recovery refund",
          confirmed: true,
        },
      ),
    ).toMatchObject({ ok: true });
  });
  it("refund preflight failures preserve the paid state and do not mark a cancellation as started", async () => {
    const f = await ordered();
    await confirmFundingPayment(deps(), owner, {
      orderId: f.order.id,
      amount: 120000,
      paymentKey: f.order.id,
    });
    const offline: TossGateway = {
      ...gateway,
      async retrieve() {
        throw Error("offline");
      },
    };
    expect(
      await refundFundingPayment({ ...deps(), gateway: offline }, admin, {
        paymentId: f.order.id,
        reason: "Check refund",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, code: "confirm_pending" });
    expect(
      (
        await sql.query(
          "select status,refund_started_at from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0],
    ).toEqual({ status: "paid", refund_started_at: null });
    expect(
      (
        await sql.query(
          "select status from campaign_funding_cases where id=$1",
          [f.caseId],
        )
      ).rows[0]?.status,
    ).toBe("paid");
  });

  it("records a nonbinding brand reward proposal without changing campaign payout, and rejects viewer/foreign tenants", async () => {
    const f = await fixture(),
      requestId = randomUUID(),
      input = {
        campaignId: f.campaign,
        projectId: f.project,
        requestId,
        amountKrw: 54321,
        conditions:
          "Per participant; agreed posting scope remains subject to studio review",
      };
    const before = (
      await sql.query("select payout from campaigns where id=$1", [f.campaign])
    ).rows[0];
    const result = await proposeCampaignReward({ sql }, owner, input);
    expect(result.ok).toBe(true);
    expect(await proposeCampaignReward({ sql }, owner, input)).toEqual(result);
    expect(
      await proposeCampaignReward({ sql }, owner, { ...input, amountKrw: 1 }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await proposeCampaignReward({ sql }, other, {
        ...input,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    await sql.query(
      "update brand_memberships set role='viewer' where organization_id=$1 and user_id=$2",
      [f.org, ownerId],
    );
    expect(
      await proposeCampaignReward({ sql }, owner, {
        ...input,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    if (!result.ok) return;
    expect(
      await reviewCampaignReward({ sql }, admin, {
        proposalId: result.id,
        state: "reviewed",
        note: "Review recorded; campaign terms remain unchanged",
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await sql.query("select payout from campaigns where id=$1", [
          f.campaign,
        ])
      ).rows[0],
    ).toEqual(before);
    await expect(
      sql.query(
        "update campaign_funding_reward_proposals set amount_krw=1 where id=$1",
        [result.id],
      ),
    ).rejects.toThrow("immutable");
  });
  it("refund preflight mismatch and replaced leases preserve the original receipt", async () => {
    const f = await ordered();
    await confirmFundingPayment(deps(), owner, {
      orderId: f.order.id,
      amount: 120000,
      paymentKey: f.order.id,
    });
    const mismatch: TossGateway = {
      ...gateway,
      async retrieve() {
        return { ...snapshot(f.order.id, f.order.id), amount: 1 };
      },
    };
    expect(
      await refundFundingPayment({ ...deps(), gateway: mismatch }, admin, {
        paymentId: f.order.id,
        reason: "Check mismatched provider",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, code: "payment_review" });
    expect(
      (
        await sql.query(
          "select status,refund_started_at from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0],
    ).toEqual({ status: "paid", refund_started_at: null });
    const stolen: TossGateway = {
      ...gateway,
      async retrieve(key) {
        await sql.query(
          "update campaign_funding_payments set lease_token=$2 where id=$1",
          [f.order.id, randomUUID()],
        );
        return provider.get(key)!;
      },
    };
    expect(
      await refundFundingPayment({ ...deps(), gateway: stolen }, admin, {
        paymentId: f.order.id,
        reason: "Lost preflight lease",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, code: "confirm_pending" });
    expect(
      (
        await sql.query(
          "select status,refund_started_at from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0],
    ).toEqual({ status: "paid", refund_started_at: null });
  });
  it("requires current owner, prevents admin buyer impersonation and protects immutable quote totals", async () => {
    const f = await fixture();
    const input = { quoteId: f.quoteId, revision: f.revision, consent: true };
    expect(await acceptFundingQuote(deps(), other, input)).toMatchObject({
      ok: false,
    });
    expect(await acceptFundingQuote(deps(), admin, input)).toMatchObject({
      ok: false,
    });
    await expect(
      sql.query("update campaign_funding_quotes set total_krw=1 where id=$1", [
        f.quoteId,
      ]),
    ).rejects.toThrow("immutable");
    expect(
      await acceptFundingQuote(deps(), owner, { ...input, revision: 999 }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await acceptFundingQuote(
        { ...deps(), now: new Date("2026-10-21") },
        owner,
        input,
      ),
    ).toMatchObject({ ok: false });
  });
  it("returns one order for concurrent creation and refuses client amount manipulation before provider access", async () => {
    const f = await accepted(),
      input = { caseId: f.caseId, requestId: randomUUID() };
    const results = await Promise.all([
      createFundingOrder(deps(), owner, input),
      createFundingOrder(deps(), owner, { ...input, requestId: randomUUID() }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = results.map((r) => (r.ok ? r.order.id : null));
    expect(new Set(ids).size).toBe(1);
    const before = confirms;
    expect(
      await confirmFundingPayment(deps(), owner, {
        orderId: ids[0],
        amount: 1,
        paymentKey: "manipulated",
      }),
    ).toMatchObject({ ok: false, code: "amount_mismatch" });
    expect(confirms).toBe(before);
  });
  it("keeps unknown confirmation claimed, reconciles provider truth, and never creates production or creator payouts", async () => {
    const f = await ordered();
    timeout = true;
    expect(
      await confirmFundingPayment(deps(), owner, {
        orderId: f.order.id,
        amount: 120000,
        paymentKey: f.order.id,
      }),
    ).toMatchObject({ ok: false, code: "confirm_pending" });
    timeout = false;
    await reconcileFunding({ ...deps(), now: new Date(+now + 120000) });
    expect(
      (
        await sql.query(
          "select status from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0]?.status,
    ).toBe("paid");
    expect(
      (
        await sql.query("select status from campaigns where id=$1", [
          f.campaign,
        ])
      ).rows[0]?.status,
    ).toBe("draft");
    expect(
      (
        await sql.query(
          "select * from campaign_render_jobs where campaign_id=$1",
          [f.campaign],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql.query(
          "select * from campaign_applications where campaign_id=$1",
          [f.campaign],
        )
      ).rows,
    ).toHaveLength(0);
    const dto = JSON.stringify(
      await loadFundingProject({ sql }, owner, f.project),
    );
    expect(dto).not.toContain("payment_key");
    expect(dto).not.toContain(f.order.id + "secret");
  });
  it("isolates environments and requires both policy and rollout gates", async () => {
    const f = await accepted(),
      input = { caseId: f.caseId, requestId: randomUUID() };
    for (const overrides of [
      { enabled: false },
      { policyReady: false },
      { production: true },
    ])
      expect(
        await createFundingOrder({ ...deps(), ...overrides }, owner, input),
      ).toMatchObject({ ok: false, code: "payments_closed" });
  });
  it("rechecks current membership and order environment before confirming", async () => {
    const f = await ordered(),
      input = { orderId: f.order.id, amount: 120000, paymentKey: f.order.id };
    expect(
      await confirmFundingPayment(
        { ...deps(), gateway: { ...gateway, kind: "test" } },
        owner,
        input,
      ),
    ).toMatchObject({ ok: false, code: "payments_closed" });
    await sql.query(
      "update brand_memberships set status='revoked' where organization_id=$1 and user_id=$2",
      [f.org, ownerId],
    );
    expect(await confirmFundingPayment(deps(), owner, input)).toMatchObject({
      ok: false,
    });
    expect(await loadFundingProject({ sql }, owner, f.project)).toBeNull();
  });
  it("does not report a receipt when the confirmation lease was replaced before settlement", async () => {
    const f = await ordered();
    const changed: TossGateway = {
      ...gateway,
      async confirm(v) {
        await sql.query(
          "update campaign_funding_payments set lease_token=$2 where id=$1",
          [v.orderId, randomUUID()],
        );
        return snapshot(v.orderId, v.paymentKey);
      },
    };
    expect(
      await confirmFundingPayment({ ...deps(), gateway: changed }, owner, {
        orderId: f.order.id,
        amount: 120000,
        paymentKey: f.order.id,
      }),
    ).toMatchObject({ ok: false, code: "confirm_pending" });
    expect(
      (
        await sql.query(
          "select status from campaign_funding_cases where id=$1",
          [f.caseId],
        )
      ).rows[0]?.status,
    ).toBe("accepted");
  });
  it("moves mismatching provider truth to review and does not treat it as a receipt", async () => {
    const f = await ordered(),
      bad: TossGateway = {
        ...gateway,
        async confirm(v) {
          return { ...snapshot(v.orderId, v.paymentKey), amount: 1 };
        },
      };
    expect(
      await confirmFundingPayment({ ...deps(), gateway: bad }, owner, {
        orderId: f.order.id,
        amount: 120000,
        paymentKey: f.order.id,
      }),
    ).toMatchObject({ ok: false, code: "payment_review" });
    expect(
      (
        await sql.query(
          "select status from campaign_funding_cases where id=$1",
          [f.caseId],
        )
      ).rows[0]?.status,
    ).toBe("review");
  });
  it("refunds only after explicit admin reason and reconciles timeout without another cancel", async () => {
    const f = await ordered();
    await confirmFundingPayment(deps(), owner, {
      orderId: f.order.id,
      amount: 120000,
      paymentKey: f.order.id,
    });
    expect(
      await refundFundingPayment(deps(), owner, {
        paymentId: f.order.id,
        reason: "Client request",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await refundFundingPayment(deps(), admin, {
        paymentId: f.order.id,
        reason: "",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false });
    const before = cancels;
    timeout = true;
    expect(
      await refundFundingPayment(deps(), admin, {
        paymentId: f.order.id,
        reason: "Agreed full refund",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, code: "confirm_pending" });
    timeout = false;
    await reconcileFunding({ ...deps(), now: new Date(+now + 120000) });
    expect(cancels).toBe(before + 1);
    expect(
      (
        await sql.query(
          "select status from campaign_funding_payments where id=$1",
          [f.order.id],
        )
      ).rows[0]?.status,
    ).toBe("refunded");
  });
});
