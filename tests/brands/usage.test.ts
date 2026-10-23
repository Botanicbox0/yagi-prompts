import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner, expectReject } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import * as s from "@/lib/brands/workspace/service";
import * as u from "@/lib/brands/usage/service";
import * as pay from "@/lib/brands/usage/payment";
import { createFakeTossGateway, type FakeTossGateway } from "@/lib/billing/toss-fake";
import { koreaMidnight } from "@/lib/brands/usage/schemas";
import { kstDay } from "@/tests/helpers/brand-usage";

/**
 * Brand secondary usage (docs/SECONDARY-USAGE.md). Fixture values only: no real brand, creator,
 * handle, price or contract appears here. Amounts are arbitrary test integers, not prices.
 */
const ids = { studio: randomUUID(), owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), guest: randomUUID(), outsider: randomUUID(), staff: randomUUID() };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
const studio = as(ids.studio, true), owner = as(ids.owner), editor = as(ids.editor), viewer = as(ids.viewer), guest = as(ids.guest), outsider = as(ids.outsider), staff = as(ids.staff);
const STAFF_EMAIL = "someone@yagiworkshop.xyz";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PDF = Buffer.from("%PDF-1.7");
const COMP = 424242, EVIDENCE = "fixture-thread-7f3a", TOTAL = 900000;
/** Korea calendar day `offset` days from now: fixture windows always lie in the future. */
const START = kstDay(8), END = kstDay(99);
let db: PGlite, sql: SqlRunner, orgId: string, projectId: string, otherProjectId: string, importedPostId: string, contentId: string, approvedPostId: string, contractId: string, masterId: string;
let gateway: FakeTossGateway, now: Date;
const idOf = (r: { ok: boolean; code?: string; id?: string }) => { if (!r.ok) throw Error(r.code); return r.id!; };
const open = () => ({ sql, paymentsOpen: true, now });
const payDeps = () => ({ sql, gateway, paymentsOpen: true, now });

async function file(project: string, mime: "image/png" | "application/pdf", purpose: "workspace" | "contract" = "workspace") {
  const bytes = mime === "image/png" ? PNG : PDF;
  const r = await s.reserveBrandAttachment({ sql }, studio, { projectId: project, requestId: randomUUID(), name: mime === "image/png" ? "master.png" : "terms.pdf", mime, sizeBytes: bytes.length, purpose });
  if (!r.ok) throw Error(r.code);
  idOf(await s.completeBrandAttachment({ sql, storage: { read: async () => bytes } }, studio, r.id));
  return r.id;
}
async function invite(user: Viewer, project: string | null, role: "owner" | "editor" | "viewer") {
  const r = await s.createStudioInvitation({ sql }, studio, { organizationId: orgId, projectId: project, email: user.email, role, canComment: project !== null, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: user.email! }, user, { token: r.token })).toMatchObject({ ok: true });
}
async function campaign(organizationId: string, title: string) {
  const id = idOf(await s.createStudioProject({ sql }, studio, { organizationId, title, objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId: id, visible: true, expectedRevision: 0 }));
  idOf(await s.activateBrandProject({ sql }, studio, { projectId: id, expectedRevision: 1, status: "active" }));
  return id;
}

beforeEach(async () => {
  now = new Date();
  gateway = createFakeTossGateway();
  db = await freshDb(); sql = runner(db);
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "studio", email: `${id}@example.test` });
  orgId = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand", requestId: randomUUID() }));
  const otherOrg = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Other fixture brand", requestId: randomUUID() }));
  projectId = await campaign(orgId, "Fixture campaign");
  otherProjectId = await campaign(otherOrg, "Other campaign");
  await invite(owner, null, "owner"); await invite(editor, null, "editor"); await invite(viewer, null, "viewer"); await invite(guest, projectId, "viewer");
  idOf(await s.importBrandExternalPosts({ sql }, studio, { projectId, requestId: randomUUID(), posts: [{ url: "https://www.instagram.com/p/FIXTURE1/", publishedAt: null }] }));
  importedPostId = String((await sql.query("select id from brand_posts where project_id=$1", [projectId])).rows[0]!.id);
  const media = await file(projectId, "image/png");
  contentId = idOf(await s.addBrandContentVersion({ sql }, studio, { projectId, requestId: randomUUID(), slotKey: "main", title: "Fixture cut", attachmentId: media, caption: "", usageRights: "Campaign posting only", creatorConsentConfirmed: false }));
  idOf(await s.approveBrandContent({ sql }, owner, { projectId, contentVersionId: contentId, decision: "approved", comment: "", expectedRevision: 0, requestId: randomUUID() }));
  approvedPostId = idOf(await s.recordBrandPost({ sql }, studio, { projectId, contentVersionId: contentId, url: "https://www.instagram.com/p/FIXTURE2/", verification: "manual", metricsSource: "unavailable", measuredAt: null, views: null, likes: null, comments: null, shares: null, saves: null, publishedAt: new Date(Date.now() - 86400000).toISOString(), requestId: randomUUID() }));
  masterId = await file(projectId, "image/png");
  const terms = await file(projectId, "application/pdf", "contract");
  contractId = idOf(await s.addBrandContract({ sql }, studio, { projectId, attachmentId: terms, documentKey: "usage-terms", title: "Usage terms", requestId: randomUUID() }));
  idOf(await s.shareBrandContract({ sql }, studio, { projectId, contractId, shared: true, expectedRevision: 0 }));
});
afterEach(async () => { await db?.close(); });

const inquire = (who: Viewer, subjects: Array<{ kind: "content_version" | "post"; id: string }>, extra: Record<string, unknown> = {}) =>
  u.submitUsageInquiry({ sql }, who, { projectId, requestId: randomUUID(), subjects, intent: "know_cost", ...extra });
const caseRow = async (id: string) => (await sql.query("select * from brand_usage_cases where id=$1", [id])).rows[0]!;
const revisionOf = async (id: string) => Number((await caseRow(id)).revision);
const count = async (table: string) => Number((await sql.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0]!.n);
const itemsOf = async (caseId: string) => (await sql.query<{ id: string; post_id: string | null; content_version_id: string | null }>("select id,post_id,content_version_id from brand_usage_case_items where case_id=$1 order by position", [caseId])).rows;
const scopeItem = (itemId: string, pin: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  itemId, pin, usageKinds: ["organic_repost"], channels: ["Brand Instagram"], territory: ["KR"], advertiser: null, edits: "none",
  timing: { kind: "fixed", startsOn: START, endsOn: END }, ...extra,
});

/** inquiry → triage → scope → compensation → consent → quote, all by the studio. */
async function quoted(subject: { kind: "content_version" | "post"; id: string } = { kind: "post", id: importedPostId }, pin: Record<string, unknown> = { kind: "original_post" }, validUntil = new Date(now.getTime() + 7 * 86400000)) {
  const caseId = idOf(await inquire(editor, [subject]));
  idOf(await u.triageUsageCase({ sql }, studio, { caseId, expectedRevision: await revisionOf(caseId) }));
  const [item] = await itemsOf(caseId);
  idOf(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: await revisionOf(caseId), requestId: randomUUID(), items: [scopeItem(item!.id, pin)] }));
  const scopeRevisionId = String((await sql.query("select id from brand_usage_scope_revisions where case_id=$1 order by revision desc", [caseId])).rows[0]!.id);
  const compensationId = idOf(await u.recordUsageCompensation({ sql }, studio, { caseId, scopeRevisionId, requestId: randomUUID(), amountKrw: COMP, taxBasis: "included", note: "fixture" }));
  idOf(await u.recordUsageConsent({ sql }, studio, { caseId, itemId: item!.id, scopeRevisionId, compensationId, requestId: randomUUID(), approverKind: "creator", approvedAt: now.toISOString(), evidenceReference: EVIDENCE, rightsChecks: ["ownership", "music", "people", "marks"] }));
  const quoteId = idOf(await u.issueUsageQuote(open(), studio, { caseId, expectedRevision: await revisionOf(caseId), requestId: randomUUID(), scopeRevisionId, totalKrw: TOTAL, taxBasis: "included", validUntil: validUntil.toISOString(), contractId, note: "" }));
  return { caseId, itemId: item!.id, scopeRevisionId, compensationId, quoteId };
}
async function accepted() {
  const q = await quoted();
  idOf(await u.acceptUsageQuote(open(), owner, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: await revisionOf(q.caseId), requestId: randomUUID(), confirmed: true }));
  return q;
}
async function paid() {
  const q = await accepted();
  const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
  if (!order.ok) throw Error(order.code);
  gateway.authorize(order.order.id, order.order.amountKrw);
  const confirmed = await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: order.order.amountKrw });
  return { ...q, orderId: order.order.id, confirmed };
}

describe("inquiry first: cost only, nothing granted", () => {
  it("an editor asks about an imported post with no channel, term, territory or budget", async () => {
    const r = await inquire(editor, [{ kind: "post", id: importedPostId }]);
    expect(r).toMatchObject({ ok: true });
    const row = await caseRow(idOf(r));
    expect(row).toMatchObject({ status: "inquiry", intent: "know_cost", hints: null, duration_hint: null, budget_krw: null, timing_text: null });
    for (const table of ["brand_usage_quotes", "brand_usage_payments", "brand_usage_grants", "brand_usage_scope_revisions", "brand_usage_consents"]) expect(await count(table), table).toBe(0);
    const view = await u.loadBrandUsage(open(), editor, projectId);
    expect(view!.cases[0]).toMatchObject({ state: "submitted", quote: null, payment: null, grants: [], availability: null });
    expect(view!.cases[0]!.actions).toMatchObject({ accept: false, pay: false, withdraw: true, message: true });
    expect(view!.cases[0]!.subjects[0]).toMatchObject({ kind: "post", origin: "external_import" });
  });
  it("works the same on an approved content version, and an empty hint list is stored as unknown", async () => {
    const r = await inquire(owner, [{ kind: "content_version", id: contentId }], { hints: [], durationHint: "", budgetKrw: "", timingText: " " });
    expect(await caseRow(idOf(r))).toMatchObject({ hints: null, duration_hint: null, budget_krw: null, timing_text: null });
  });
  it("a question intent needs the question; unknown subjects and other campaigns' posts are refused", async () => {
    expect(await inquire(editor, [{ kind: "post", id: importedPostId }], { intent: "question", question: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await inquire(editor, [{ kind: "post", id: randomUUID() }])).toMatchObject({ ok: false, code: "not_found" });
    const otherPost = await s.importBrandExternalPosts({ sql }, studio, { projectId: otherProjectId, requestId: randomUUID(), posts: [{ url: "https://www.instagram.com/p/OTHER1/", publishedAt: null }] });
    expect(otherPost.ok).toBe(true);
    const foreign = String((await sql.query("select id from brand_posts where project_id=$1", [otherProjectId])).rows[0]!.id);
    expect(await inquire(editor, [{ kind: "post", id: foreign }])).toMatchObject({ ok: false, code: "not_found" });
  });
  it("a content version that is not the current approved one is not eligible", async () => {
    const media = await file(projectId, "image/png");
    const pending = idOf(await s.addBrandContentVersion({ sql }, studio, { projectId, requestId: randomUUID(), slotKey: "second", title: "Pending cut", attachmentId: media, caption: "", usageRights: "Campaign posting only", creatorConsentConfirmed: false }));
    expect(await inquire(editor, [{ kind: "content_version", id: pending }])).toMatchObject({ ok: false, code: "not_found" });
  });
  it("retrying the same request returns the same case", async () => {
    const input = { projectId, requestId: randomUUID(), subjects: [{ kind: "post", id: importedPostId }], intent: "recommend_terms" };
    const first = idOf(await u.submitUsageInquiry({ sql }, editor, input));
    expect(idOf(await u.submitUsageInquiry({ sql }, editor, input))).toBe(first);
    expect(await count("brand_usage_cases")).toBe(1);
  });
  it("the studio can answer and close a cost-only inquiry without any quote", async () => {
    const caseId = idOf(await inquire(editor, [{ kind: "post", id: importedPostId }]));
    idOf(await u.sendUsageMessage({ sql }, studio, { caseId, body: "Studio answer", requestId: randomUUID() }, "studio"));
    idOf(await u.closeUsageCase({ sql }, studio, { caseId, expectedRevision: await revisionOf(caseId), reason: "answered_only" }));
    const view = await u.loadBrandUsage(open(), editor, projectId);
    expect(view!.cases[0]).toMatchObject({ state: "closed", quote: null });
    expect(view!.cases[0]!.messages.map(m => m.authorRole)).toEqual(["studio"]);
    expect(await count("brand_usage_outcomes")).toBe(0);
  });
});

describe("who may do what", () => {
  it("viewers, campaign guests, TWINGS staff and outsiders cannot inquire; guests and outsiders cannot even read", async () => {
    const subject = [{ kind: "post" as const, id: importedPostId }];
    expect(await inquire(viewer, subject)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await inquire(guest, subject)).toMatchObject({ ok: false, code: "not_found" });
    expect(await inquire(outsider, subject)).toMatchObject({ ok: false, code: "not_found" });
    // An is_admin account without a customer seat never writes as the brand on the client path.
    expect(await inquire(studio, subject)).toMatchObject({ ok: false, code: "not_found" });
    expect(await u.loadBrandUsage(open(), guest, projectId)).toBeNull();
    expect(await u.loadBrandUsage(open(), outsider, projectId)).toBeNull();
    const viewerView = await u.loadBrandUsage(open(), viewer, projectId);
    expect(viewerView).toMatchObject({ role: "viewer", buyer: false });
    const staffView = await u.loadBrandUsage({ ...open(), verifiedEmail: STAFF_EMAIL }, staff, projectId);
    expect(staffView).toMatchObject({ role: "studio", buyer: false });
  });
  it("studio operations refuse customers, and customer operations refuse the studio console", async () => {
    const caseId = idOf(await inquire(editor, [{ kind: "post", id: importedPostId }]));
    expect(await u.triageUsageCase({ sql }, owner, { caseId, expectedRevision: 0 })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await u.withdrawUsageCase({ sql }, viewer, { caseId, expectedRevision: 0 })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await u.withdrawUsageCase({ sql }, outsider, { caseId, expectedRevision: 0 })).toMatchObject({ ok: false, code: "not_found" });
    expect(await u.sendUsageMessage({ sql }, guest, { caseId, body: "hi", requestId: randomUUID() }, "client")).toMatchObject({ ok: false, code: "not_found" });
  });
  it("only an owner or a studio-designated buyer accepts; an admin never accepts as the brand", async () => {
    const q = await quoted();
    const accept = (who: Viewer) => u.acceptUsageQuote(open(), who, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true });
    expect(await revisionOf(q.caseId)).toBe(3);
    expect(await accept(editor)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await accept(viewer)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await accept(studio)).toMatchObject({ ok: false, code: "not_found" });
    expect(await u.setUsageBuyer({ sql }, owner, { organizationId: orgId, userId: ids.editor, grant: true, reason: "x" })).toMatchObject({ ok: false, code: "forbidden" });
    idOf(await u.setUsageBuyer({ sql }, studio, { organizationId: orgId, userId: ids.editor, grant: true, reason: "Purchasing authority confirmed by the owner in writing" }));
    expect(await accept(editor)).toMatchObject({ ok: true });
  });
  it("a viewer cannot be made a buyer, and a revoked member loses buyer authority", async () => {
    expect(await u.setUsageBuyer({ sql }, studio, { organizationId: orgId, userId: ids.viewer, grant: true, reason: "x" })).toMatchObject({ ok: false, code: "invalid" });
    idOf(await u.setUsageBuyer({ sql }, studio, { organizationId: orgId, userId: ids.editor, grant: true, reason: "documented" }));
    const q = await quoted();
    await s.revokeStudioAccess({ sql }, studio, { organizationId: orgId, userId: ids.editor, projectId: null });
    expect(await u.acceptUsageQuote(open(), editor, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("scope, consent and quote", () => {
  it("an imported post cannot be quoted without a pin, and 'content version' is not a pin for it", async () => {
    const caseId = idOf(await inquire(editor, [{ kind: "post", id: importedPostId }]));
    idOf(await u.triageUsageCase({ sql }, studio, { caseId, expectedRevision: 1 - 1 }));
    const [item] = await itemsOf(caseId);
    expect(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: 1, requestId: randomUUID(), items: [scopeItem(item!.id, { kind: "content_version" })] })).toMatchObject({ ok: false, code: "subject_unpinned" });
    expect(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: 1, requestId: randomUUID(), items: [scopeItem(item!.id, { kind: "original_post" }, { usageKinds: ["source_files"] })] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: 1, requestId: randomUUID(), items: [scopeItem(item!.id, { kind: "master", attachmentId: masterId })] })).toMatchObject({ ok: true });
    const scope = (await sql.query("select scope from brand_usage_scope_revisions where case_id=$1", [caseId])).rows[0]!.scope as { items: Array<{ subject: { kind: string; assetSha256: string } }> };
    expect(scope.items[0]!.subject).toMatchObject({ kind: "master" });
    expect(scope.items[0]!.subject.assetSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("a scope must be complete: territory, channels, timing and the advertiser for ads", async () => {
    const caseId = idOf(await inquire(editor, [{ kind: "content_version", id: contentId }]));
    idOf(await u.triageUsageCase({ sql }, studio, { caseId, expectedRevision: 0 }));
    const [item] = await itemsOf(caseId);
    const define = (extra: Record<string, unknown>) => u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: 1, requestId: randomUUID(), items: [scopeItem(item!.id, { kind: "content_version" }, extra)] });
    expect(await define({ territory: [] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await define({ channels: [] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await define({ timing: undefined })).toMatchObject({ ok: false, code: "invalid" });
    expect(await define({ usageKinds: ["paid_ads"], advertiser: null })).toMatchObject({ ok: false, code: "invalid" });
    expect(await define({ usageKinds: ["paid_ads"], advertiser: "Fixture brand" })).toMatchObject({ ok: true });
  });
  it("a quote needs consent on the exact scope; re-scoping after consent blocks the quote until re-consent", async () => {
    const caseId = idOf(await inquire(editor, [{ kind: "post", id: approvedPostId }]));
    idOf(await u.triageUsageCase({ sql }, studio, { caseId, expectedRevision: 0 }));
    const [item] = await itemsOf(caseId);
    idOf(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: 1, requestId: randomUUID(), items: [scopeItem(item!.id, { kind: "content_version" })] }));
    const first = String((await sql.query("select id from brand_usage_scope_revisions where case_id=$1", [caseId])).rows[0]!.id);
    const quote = (scopeRevisionId: string) => u.issueUsageQuote(open(), studio, { caseId, expectedRevision: 2, requestId: randomUUID(), scopeRevisionId, totalKrw: TOTAL, taxBasis: "excluded", validUntil: new Date(now.getTime() + 86400000).toISOString(), contractId, note: "" });
    expect(await quote(first)).toMatchObject({ ok: false, code: "consent_missing" });
    // A metric verification (the post is `manual`) is not consent.
    expect((await sql.query("select verification from brand_posts where id=$1", [approvedPostId])).rows[0]!.verification).toBe("manual");
    const comp = idOf(await u.recordUsageCompensation({ sql }, studio, { caseId, scopeRevisionId: first, requestId: randomUUID(), amountKrw: COMP, taxBasis: "excluded", note: "" }));
    idOf(await u.recordUsageConsent({ sql }, studio, { caseId, itemId: item!.id, scopeRevisionId: first, compensationId: comp, requestId: randomUUID(), approverKind: "creator", approvedAt: now.toISOString(), evidenceReference: EVIDENCE, rightsChecks: ["ownership", "music", "people", "marks"] }));
    // The studio changes the territory: a new revision, whose hash no consent matches.
    idOf(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: 2, requestId: randomUUID(), items: [scopeItem(item!.id, { kind: "content_version" }, { territory: ["KR", "JP"] })] }));
    const second = String((await sql.query("select id from brand_usage_scope_revisions where case_id=$1 and revision=2", [caseId])).rows[0]!.id);
    expect(await u.issueUsageQuote(open(), studio, { caseId, expectedRevision: 3, requestId: randomUUID(), scopeRevisionId: first, totalKrw: TOTAL, taxBasis: "excluded", validUntil: new Date(now.getTime() + 86400000).toISOString(), contractId, note: "" })).toMatchObject({ ok: false, code: "conflict" });
    expect(await u.issueUsageQuote(open(), studio, { caseId, expectedRevision: 3, requestId: randomUUID(), scopeRevisionId: second, totalKrw: TOTAL, taxBasis: "excluded", validUntil: new Date(now.getTime() + 86400000).toISOString(), contractId, note: "" })).toMatchObject({ ok: false, code: "consent_missing" });
    // A compensation of another revision cannot back consent for this one.
    expect(await u.recordUsageConsent({ sql }, studio, { caseId, itemId: item!.id, scopeRevisionId: second, compensationId: comp, requestId: randomUUID(), approverKind: "creator", approvedAt: now.toISOString(), evidenceReference: EVIDENCE, rightsChecks: ["ownership", "music", "people", "marks"] })).toMatchObject({ ok: false, code: "conflict" });
  });
  it("an incomplete rights check or an unshared contract refuses", async () => {
    const caseId = idOf(await inquire(editor, [{ kind: "content_version", id: contentId }]));
    idOf(await u.triageUsageCase({ sql }, studio, { caseId, expectedRevision: 0 }));
    const [item] = await itemsOf(caseId);
    idOf(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: 1, requestId: randomUUID(), items: [scopeItem(item!.id, { kind: "content_version" })] }));
    const scopeRevisionId = String((await sql.query("select id from brand_usage_scope_revisions where case_id=$1", [caseId])).rows[0]!.id);
    const comp = idOf(await u.recordUsageCompensation({ sql }, studio, { caseId, scopeRevisionId, requestId: randomUUID(), amountKrw: COMP, taxBasis: "included", note: "" }));
    expect(await u.recordUsageConsent({ sql }, studio, { caseId, itemId: item!.id, scopeRevisionId, compensationId: comp, requestId: randomUUID(), approverKind: "creator", approvedAt: now.toISOString(), evidenceReference: EVIDENCE, rightsChecks: ["ownership"] })).toMatchObject({ ok: false, code: "invalid" });
    idOf(await u.recordUsageConsent({ sql }, studio, { caseId, itemId: item!.id, scopeRevisionId, compensationId: comp, requestId: randomUUID(), approverKind: "creator", approvedAt: now.toISOString(), evidenceReference: EVIDENCE, rightsChecks: ["ownership", "music", "people", "marks"] }));
    idOf(await s.shareBrandContract({ sql }, studio, { projectId, contractId, shared: false, expectedRevision: 1 }));
    expect(await u.issueUsageQuote(open(), studio, { caseId, expectedRevision: 2, requestId: randomUUID(), scopeRevisionId, totalKrw: TOTAL, taxBasis: "excluded", validUntil: new Date(now.getTime() + 86400000).toISOString(), contractId, note: "" })).toMatchObject({ ok: false, code: "terms_unavailable" });
  });
  it("the brand sees the final price and scope, never the creator amount, evidence or consent", async () => {
    const q = await quoted();
    const view = await u.loadBrandUsage(open(), owner, projectId);
    const c = view!.cases[0]!;
    expect(c).toMatchObject({ state: "quoted", availability: "confirmed" });
    expect(c.quote).toMatchObject({ totalKrw: TOTAL, taxBasis: "included", expired: false, status: "open" });
    expect(c.quote!.contract).toMatchObject({ title: "Usage terms", version: 1 });
    expect(c.actions).toMatchObject({ accept: true, requestChanges: true });
    const json = JSON.stringify(view);
    for (const secret of [String(COMP), EVIDENCE, "compensation", "consent", "evidence", "margin", "payout", q.compensationId, "rightsChecks", "assetSha256", "platformPostId"]) expect(json, secret).not.toContain(secret);
    // Viewers read the quote but cannot act on it.
    expect((await u.loadBrandUsage(open(), viewer, projectId))!.cases[0]!.actions).toMatchObject({ accept: false, pay: false, withdraw: false, message: false });
  });
});

describe("acceptance", () => {
  it("an expired quote cannot be accepted", async () => {
    const q = await quoted(undefined, undefined, new Date(now.getTime() + 60000));
    const later = new Date(now.getTime() + 120000);
    expect(await u.acceptUsageQuote({ sql, paymentsOpen: true, now: later }, owner, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "conflict" });
    expect((await u.loadBrandUsage({ sql, paymentsOpen: true, now: later }, owner, projectId))!.cases[0]!.state).toBe("quote_expired");
  });
  it("accept and a studio re-quote race on the case revision: exactly one wins", async () => {
    const q = await quoted();
    idOf(await u.reopenUsageCase({ sql }, studio, { caseId: q.caseId, expectedRevision: 3 }));
    expect(await u.acceptUsageQuote(open(), owner, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "conflict" });
    expect((await sql.query("select status from brand_usage_quotes where id=$1", [q.quoteId])).rows[0]!.status).toBe("superseded");
    const other = await quoted();
    idOf(await u.acceptUsageQuote(open(), owner, { caseId: other.caseId, quoteId: other.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true }));
    expect(await u.reopenUsageCase({ sql }, studio, { caseId: other.caseId, expectedRevision: 3 })).toMatchObject({ ok: false, code: "conflict" });
  });
  it("a repeated request returns the same acceptance; payments closed refuses acceptance", async () => {
    const q = await quoted();
    expect(await u.acceptUsageQuote({ sql, paymentsOpen: false, now }, owner, { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId: randomUUID(), confirmed: true })).toMatchObject({ ok: false, code: "conflict" });
    const requestId = randomUUID();
    const input = { caseId: q.caseId, quoteId: q.quoteId, expectedRevision: 3, requestId, confirmed: true as const };
    expect(await u.acceptUsageQuote(open(), owner, input)).toEqual({ ok: true, id: q.quoteId });
    expect(await u.acceptUsageQuote(open(), owner, input)).toEqual({ ok: true, id: q.quoteId });
    expect(await u.acceptUsageQuote(open(), owner, { ...input, requestId: randomUUID() })).toMatchObject({ ok: false, code: "conflict" });
  });
  it("the brand can ask for changes on a quote, which supersedes it", async () => {
    const q = await quoted();
    idOf(await u.requestUsageChanges({ sql }, editor, { caseId: q.caseId, expectedRevision: 3, body: "Please add JP", requestId: randomUUID() }));
    expect(await caseRow(q.caseId)).toMatchObject({ status: "scoping" });
    expect((await sql.query("select status from brand_usage_quotes where id=$1", [q.quoteId])).rows[0]!.status).toBe("superseded");
  });
});

describe("payment", () => {
  it("pays with the fake gateway and activates grants from the quote's own dates", async () => {
    const r = await paid();
    expect(r.confirmed).toMatchObject({ ok: true, state: "fulfilled" });
    const grants = (await sql.query("select * from brand_usage_grants where case_id=$1", [r.caseId])).rows;
    expect(grants).toHaveLength(1);
    expect(new Date(String(grants[0]!.starts_at)).toISOString()).toBe(koreaMidnight(START).toISOString());
    expect(new Date(String(grants[0]!.ends_at)).toISOString()).toBe(new Date(+koreaMidnight(END) + 86400000).toISOString());
    const view = await u.loadBrandUsage(open(), owner, projectId);
    expect(view!.cases[0]).toMatchObject({ state: "licensed", payment: { status: "paid", amountKrw: TOTAL } });
    expect(view!.cases[0]!.grants[0]!.state).toBe("scheduled");
    // Never render billing, never a render job.
    expect(await count("billing_payments")).toBe(0);
    expect(await count("render_jobs")).toBe(0);
    const outcomes = (await sql.query("select * from brand_usage_outcomes")).rows;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ outcome: "paid", quote_id: r.quoteId });
    expect(JSON.stringify(outcomes)).not.toContain(String(COMP));
  });
  it("payments closed, missing consent to the notice, non-buyers and tampered amounts are refused", async () => {
    const q = await accepted();
    expect(await pay.createUsageOrder({ ...payDeps(), paymentsOpen: false }, owner, { caseId: q.caseId, requestId: randomUUID(), consent: true })).toMatchObject({ ok: false, code: "payments_closed" });
    expect(await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: false })).toMatchObject({ ok: false, code: "invalid" });
    expect(await pay.createUsageOrder(payDeps(), editor, { caseId: q.caseId, requestId: randomUUID(), consent: true })).toMatchObject({ ok: false, code: "forbidden" });
    const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!order.ok) throw Error(order.code);
    expect(order.order.amountKrw).toBe(TOTAL);
    expect(order.order.name).not.toMatch(/@|FIXTURE/);
    // One live order per quote: asking again returns the same one.
    const again = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    expect(again.ok && again.order.id).toBe(order.order.id);
    gateway.authorize(order.order.id, TOTAL);
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: 1 })).toMatchObject({ ok: false, code: "amount_mismatch" });
    expect(await pay.confirmUsagePayment(payDeps(), editor, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: false, code: "not_found" });
    expect(gateway.confirmCalls).toBe(0);
  });
  it("a lost confirm response is recovered by the scheduled reconcile, without any page load", async () => {
    const q = await accepted();
    const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!order.ok) throw Error(order.code);
    gateway.authorize(order.order.id, TOTAL);
    gateway.loseConfirmResponse = true;
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: false, code: "confirm_pending" });
    expect((await sql.query("select status from brand_usage_payments where id=$1", [order.order.id])).rows[0]!.status).toBe("confirming");
    // Within the lease nothing is retried.
    await pay.reconcileBrandUsagePayments(payDeps());
    expect(gateway.confirmCalls).toBe(1);
    await pay.reconcileBrandUsagePayments({ ...payDeps(), now: new Date(now.getTime() + 120000) });
    expect(gateway.confirmCalls).toBe(1); // retrieve saw DONE: no second approval
    expect(await caseRow(q.caseId)).toMatchObject({ status: "fulfilled" });
    // A second confirm of the same order is refused.
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: false, code: "already_processed" });
  });
  it("consent withdrawn before the charge: refused without charging anyone", async () => {
    const q = await accepted();
    const consentId = String((await sql.query("select id from brand_usage_consents where case_id=$1", [q.caseId])).rows[0]!.id);
    idOf(await u.withdrawUsageConsent({ sql }, studio, { caseId: q.caseId, consentId }));
    const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!order.ok) throw Error(order.code);
    gateway.authorize(order.order.id, TOTAL);
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: false, code: "conflict" });
    expect(gateway.confirmCalls).toBe(0);
    expect((await sql.query("select status from brand_usage_payments where id=$1", [order.order.id])).rows[0]!.status).toBe("expired");
  });
  it("consent withdrawn while the approval was in flight: paid but blocked, no grant; refund only through the admin op, idempotently", async () => {
    const q = await accepted();
    const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!order.ok) throw Error(order.code);
    gateway.authorize(order.order.id, TOTAL);
    gateway.loseConfirmResponse = true;
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: false, code: "confirm_pending" });
    const consentId = String((await sql.query("select id from brand_usage_consents where case_id=$1", [q.caseId])).rows[0]!.id);
    idOf(await u.withdrawUsageConsent({ sql }, studio, { caseId: q.caseId, consentId }));
    await pay.reconcileBrandUsagePayments({ ...payDeps(), now: new Date(now.getTime() + 120000) });
    expect(await caseRow(q.caseId)).toMatchObject({ status: "blocked_after_payment", blocked_reason: "consent_missing" });
    expect(await count("brand_usage_grants")).toBe(0);
    const brand = await u.loadBrandUsage(open(), owner, projectId);
    expect(brand!.cases[0]!.state).toBe("needs_attention");
    expect(JSON.stringify(brand)).not.toContain("consent_withdrawn");
    expect(await pay.resolveUsageCase(payDeps(), owner, { caseId: q.caseId, action: "refund", reason: "x" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await pay.resolveUsageCase(payDeps(), studio, { caseId: q.caseId, action: "reverify", reason: "checked again" })).toMatchObject({ ok: false, code: "consent_missing" });
    expect(await pay.resolveUsageCase(payDeps(), studio, { caseId: q.caseId, action: "refund", reason: "Rights could not be confirmed" })).toMatchObject({ ok: true });
    expect(await pay.resolveUsageCase(payDeps(), studio, { caseId: q.caseId, action: "refund", reason: "again" })).toMatchObject({ ok: false, code: "conflict" });
    expect(gateway.cancelCalls).toBe(1);
    expect((await sql.query("select status from brand_usage_payments where id=$1", [order.order.id])).rows[0]!.status).toBe("refunded");
    expect(await caseRow(q.caseId)).toMatchObject({ status: "closed", close_reason: "refunded" });
    expect((await sql.query("select outcome from brand_usage_outcomes where case_id=$1", [q.caseId])).rows[0]!.outcome).toBe("refunded");
    expect((await u.loadBrandUsage(open(), owner, projectId))!.cases[0]!.state).toBe("refunded");
  });
  it("a payment for a quote the studio superseded is refused before charging", async () => {
    const q = await accepted();
    const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!order.ok) throw Error(order.code);
    idOf(await u.reopenUsageCase({ sql }, studio, { caseId: q.caseId, expectedRevision: 4 }));
    gateway.authorize(order.order.id, TOTAL);
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: false });
    expect(gateway.confirmCalls).toBe(0);
  });
  it("a from-first-use grant waits for the studio to record the start", async () => {
    const q = await quoted({ kind: "content_version", id: contentId }, { kind: "content_version" });
    // Replace the fixed timing with first use: new scope, consent and quote.
    idOf(await u.reopenUsageCase({ sql }, studio, { caseId: q.caseId, expectedRevision: 3 }));
    idOf(await u.defineUsageScope({ sql }, studio, { caseId: q.caseId, expectedRevision: 4, requestId: randomUUID(), items: [scopeItem(q.itemId, { kind: "content_version" }, { timing: { kind: "first_use", durationDays: 30 } })] }));
    const scopeRevisionId = String((await sql.query("select id from brand_usage_scope_revisions where case_id=$1 and revision=2", [q.caseId])).rows[0]!.id);
    const comp = idOf(await u.recordUsageCompensation({ sql }, studio, { caseId: q.caseId, scopeRevisionId, requestId: randomUUID(), amountKrw: COMP, taxBasis: "excluded", note: "" }));
    idOf(await u.recordUsageConsent({ sql }, studio, { caseId: q.caseId, itemId: q.itemId, scopeRevisionId, compensationId: comp, requestId: randomUUID(), approverKind: "agency", approvedAt: now.toISOString(), evidenceReference: EVIDENCE, rightsChecks: ["ownership", "music", "people", "marks"] }));
    const quoteId = idOf(await u.issueUsageQuote(open(), studio, { caseId: q.caseId, expectedRevision: 5, requestId: randomUUID(), scopeRevisionId, totalKrw: TOTAL, taxBasis: "included", validUntil: new Date(now.getTime() + 86400000).toISOString(), contractId, note: "" }));
    idOf(await u.acceptUsageQuote(open(), owner, { caseId: q.caseId, quoteId, expectedRevision: 6, requestId: randomUUID(), confirmed: true }));
    const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!order.ok) throw Error(order.code);
    gateway.authorize(order.order.id, TOTAL);
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: true, state: "fulfilled" });
    const grant = (await sql.query("select * from brand_usage_grants where case_id=$1", [q.caseId])).rows[0]!;
    expect(grant).toMatchObject({ starts_at: null, ends_at: null, duration_days: 30 });
    expect((await u.loadBrandUsage(open(), owner, projectId))!.cases[0]!.grants[0]!.state).toBe("pending_start");
    idOf(await u.startUsageGrant({ sql }, studio, { grantId: String(grant.id), requestId: randomUUID(), startsOn: "2026-11-01", reason: "Brand confirmed first posting" }));
    const started = (await sql.query("select starts_at,ends_at from brand_usage_grants where id=$1", [grant.id])).rows[0]!;
    expect(new Date(String(started.ends_at)).toISOString()).toBe("2026-11-30T15:00:00.000Z"); // 30 days: Nov 1-30, exclusive end Dec 1 00:00 KST
    expect(await u.startUsageGrant({ sql }, studio, { grantId: String(grant.id), requestId: randomUUID(), startsOn: "2026-11-02", reason: "again" })).toMatchObject({ ok: false, code: "conflict" });
    // One outcome for the case: the final quote only, never the superseded first one.
    const outcomes = (await sql.query("select quote_id from brand_usage_outcomes where case_id=$1", [q.caseId])).rows;
    expect(outcomes).toEqual([{ quote_id: quoteId }]);
  });
  it("suspending a grant shows it as suspended to the brand", async () => {
    const r = await paid();
    const grantId = String((await sql.query("select id from brand_usage_grants where case_id=$1", [r.caseId])).rows[0]!.id);
    idOf(await u.recordUsageGrantEvent({ sql }, studio, { grantId, requestId: randomUUID(), kind: "suspended", reason: "Report under review" }));
    expect((await u.loadBrandUsage(open(), owner, projectId))!.cases[0]!.grants[0]!.state).toBe("suspended");
    idOf(await u.recordUsageGrantEvent({ sql }, studio, { grantId, requestId: randomUUID(), kind: "resumed", reason: "Cleared" }));
    expect((await u.loadBrandUsage(open(), owner, projectId))!.cases[0]!.grants[0]!.state).not.toBe("suspended");
  });
});

describe("a cancellation in the Toss merchant console (the webhook hint)", () => {
  const paymentRow = async (id: string) => (await sql.query("select status,failure_code from brand_usage_payments where id=$1", [id])).rows[0]!;
  async function lostConfirm(q: { caseId: string }) {
    const order = await pay.createUsageOrder(payDeps(), owner, { caseId: q.caseId, requestId: randomUUID(), consent: true });
    if (!order.ok) throw Error(order.code);
    gateway.authorize(order.order.id, TOTAL);
    gateway.loseConfirmResponse = true;
    expect(await pay.confirmUsagePayment(payDeps(), owner, { orderId: order.order.id, paymentKey: gateway.keyFor(order.order.id), amount: TOTAL })).toMatchObject({ ok: false, code: "confirm_pending" });
    return order.order.id;
  }

  it("is learned only from the hint, by reading the order's own key: review, top of the studio queue, and a refund that never cancels twice", async () => {
    const r = await paid();
    await gateway.cancel({ paymentKey: gateway.keyFor(r.orderId), reason: "console", idempotencyKey: "console" });
    // The scheduled pass never reads a settled order at the provider again.
    await pay.reconcileBrandUsagePayments({ ...payDeps(), now: new Date(now.getTime() + 120000) });
    expect(await paymentRow(r.orderId)).toMatchObject({ status: "paid" });
    expect(await pay.reconcileBrandUsageWebhook(payDeps(), { orderId: r.orderId, paymentKey: "hint_key_never_read" })).toEqual({ matched: true, status: "review" });
    expect(await paymentRow(r.orderId)).toEqual({ status: "review", failure_code: "provider_canceled_after_paid" });
    // The license ends only by the studio's decision, with its termination events; until then the case leads the queue.
    expect(await caseRow(r.caseId)).toMatchObject({ status: "fulfilled", blocked_reason: "payment_canceled" });
    expect((await u.loadBrandUsage(open(), owner, projectId))!.cases[0]!.payment).toMatchObject({ status: "review" });
    expect(await pay.resolveUsageCase(payDeps(), studio, { caseId: r.caseId, action: "refund", reason: "Canceled in the Toss console" })).toMatchObject({ ok: true });
    expect(gateway.cancelCalls).toBe(1);
    expect(await paymentRow(r.orderId)).toMatchObject({ status: "refunded" });
    expect(await caseRow(r.caseId)).toMatchObject({ status: "closed", close_reason: "refunded", blocked_reason: null });
    const brand = (await u.loadBrandUsage(open(), owner, projectId))!.cases[0]!;
    expect(brand.state).toBe("refunded");
    expect(brand.grants.map((g) => g.state)).toEqual(["terminated"]);
  });

  it("a partial cancellation goes to review as well; a case still waiting for activation is blocked and never granted", async () => {
    const q = await accepted();
    const orderId = await lostConfirm(q);
    // Approval recorded, activation not run yet: the step the scheduled pass resumes.
    await sql.query("update brand_usage_payments set status='paid',approved_at=now(),lease_until=null where id=$1", [orderId]);
    await sql.query("update brand_usage_cases set status='paid' where id=$1", [q.caseId]);
    const retrieve = gateway.retrieve;
    gateway.retrieve = async (key) => { const p = await retrieve(key); return p && { ...p, status: "PARTIAL_CANCELED", balance: TOTAL - 100000 }; };
    expect(await pay.reconcileBrandUsageWebhook(payDeps(), { paymentKey: gateway.keyFor(orderId) })).toEqual({ matched: true, status: "review" });
    expect(await paymentRow(orderId)).toEqual({ status: "review", failure_code: "provider_partial_canceled_after_paid" });
    expect(await caseRow(q.caseId)).toMatchObject({ status: "blocked_after_payment", blocked_reason: "payment_canceled" });
    await pay.reconcileBrandUsagePayments({ ...payDeps(), now: new Date(now.getTime() + 120000) });
    expect(await count("brand_usage_grants")).toBe(0);
    // The studio's refund returns what the provider still holds.
    expect(await pay.resolveUsageCase(payDeps(), studio, { caseId: q.caseId, action: "refund", reason: "Partly canceled in the Toss console" })).toMatchObject({ ok: true });
    expect(gateway.cancelCalls).toBe(1);
    expect(await paymentRow(orderId)).toMatchObject({ status: "refunded" });
  });

  it("settles only the order it names, in this environment; an unknown or malformed hint reads nothing at the provider", async () => {
    const a = await accepted();
    const other = await quoted({ kind: "content_version", id: contentId }, { kind: "content_version" });
    idOf(await u.acceptUsageQuote(open(), owner, { caseId: other.caseId, quoteId: other.quoteId, expectedRevision: await revisionOf(other.caseId), requestId: randomUUID(), confirmed: true }));
    const [named, untouched] = [await lostConfirm(a), await lostConfirm(other)];
    let reads = 0;
    const retrieve = gateway.retrieve;
    gateway.retrieve = async (key) => { reads += 1; return retrieve(key); };
    const later = { ...payDeps(), now: new Date(now.getTime() + 120000) };
    for (const hint of [{}, { orderId: "not-an-order" }, { orderId: randomUUID() }, { paymentKey: "unknown" }])
      expect(await pay.reconcileBrandUsageWebhook(later, hint)).toEqual({ matched: false });
    expect(await pay.reconcileBrandUsageWebhook({ ...later, gateway: { ...gateway, kind: "test" } }, { orderId: named })).toEqual({ matched: false });
    expect(reads).toBe(0);
    expect(await pay.reconcileBrandUsageWebhook(later, { orderId: named })).toEqual({ matched: true, status: "paid" });
    expect(await caseRow(a.caseId)).toMatchObject({ status: "fulfilled" });
    expect(await paymentRow(untouched)).toMatchObject({ status: "confirming" });
    expect(gateway.confirmCalls).toBe(2);
  });
});

describe("database guards", () => {
  it("quotes, consents and grants cannot be rewritten", async () => {
    const r = await paid();
    expect(await expectReject(() => sql.query("update brand_usage_quotes set total_krw=1 where id=$1", [r.quoteId]))).toMatch(/immutable/);
    expect(await expectReject(() => sql.query("update brand_usage_consents set scope_sha256=repeat('0',64) where case_id=$1", [r.caseId]))).toMatch(/immutable/);
    expect(await expectReject(() => sql.query("update brand_usage_grants set ends_at=ends_at+interval '1 year' where case_id=$1", [r.caseId]))).toMatch(/immutable/);
    expect(await expectReject(() => sql.query("delete from brand_usage_events where case_id=$1", [r.caseId]))).toMatch(/immutable/);
  });
});
