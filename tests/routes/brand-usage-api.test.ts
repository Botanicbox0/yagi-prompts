import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { usageFixture, type UsageFixture } from "@/tests/helpers/brand-usage";

/**
 * The real routes over a real (PGlite) database: the brand API operations and the secondary-usage
 * payment route with the local fake gateway. docs/SECONDARY-USAGE.md.
 */
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: mocks.viewer }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: mocks.sql }));
import { POST as workspace } from "@/app/api/brand-workspace/route";
import { POST as usage, GET as usageStatus } from "@/app/api/brand-workspace/usage/route";
import { brandRouteAllowed } from "@/lib/routing/surfaces";

const headers = { host: "brand.twings.app", origin: "https://brand.twings.app", "sec-fetch-site": "same-origin", "content-type": "application/json" };
const post = (path: string, body: unknown) => new NextRequest(`https://brand.twings.app${path}`, { method: "POST", headers, body: JSON.stringify(body) });
let f: UsageFixture;
beforeEach(async () => {
  vi.stubEnv("BRAND_USAGE_PAYMENTS", "on");
  vi.stubEnv("TOSS_CLIENT_KEY", "");
  vi.stubEnv("TOSS_SECRET_KEY", "");
  // A fresh fake per test: the gateway module keeps one on globalThis for local runs.
  delete (globalThis as { __twingsFakeToss?: unknown }).__twingsFakeToss;
  f = await usageFixture();
  mocks.sql.mockResolvedValue(f.sql);
});
afterEach(async () => { vi.unstubAllEnvs(); await f.db.close(); });

describe("brand usage routes", () => {
  it("registers the payment route on the brand host for same-origin POST and GET only", () => {
    expect(brandRouteAllowed("/api/brand-workspace/usage", "POST")).toBe(true);
    expect(brandRouteAllowed("/api/brand-workspace/usage", "GET")).toBe(true);
    expect(brandRouteAllowed("/api/brand-workspace/usage", "DELETE")).toBe(false);
    expect(brandRouteAllowed("/api/brand-workspace/usage/other", "POST")).toBe(false);
  });
  it("an editor sends a cost-only inquiry; a viewer is refused", async () => {
    mocks.viewer.mockResolvedValue(f.editor);
    const ok = await workspace(post("/api/brand-workspace", { operation: "usage.inquire", input: { projectId: f.projectId, subjects: [{ kind: "post", id: f.postId }], intent: "know_cost", hints: [], requestId: randomUUID() } }));
    expect(ok.status).toBe(200);
    mocks.viewer.mockResolvedValue(f.viewer);
    const refused = await workspace(post("/api/brand-workspace", { operation: "usage.inquire", input: { projectId: f.projectId, subjects: [{ kind: "post", id: f.postId }], intent: "know_cost", requestId: randomUUID() } }));
    expect(refused.status).toBe(403);
  });
  it("accept, pay with the local fake, and read the status without any internal field", async () => {
    const { caseId, quoteId } = await f.quoted(330000);
    mocks.viewer.mockResolvedValue(f.owner);
    const accepted = await workspace(post("/api/brand-workspace", { operation: "usage.accept", input: { caseId, quoteId, expectedRevision: 3, confirmed: true, requestId: randomUUID() } }));
    expect(accepted.status).toBe(200);
    const created = await usage(post("/api/brand-workspace/usage", { operation: "order.create", input: { caseId, requestId: randomUUID(), consent: true } }));
    const order = await created.json();
    expect(created.status).toBe(200);
    expect(order).toMatchObject({ ok: true, kind: "fake", order: { amountKrw: 330000 } });
    // The browser amount must match the quote; the fake window is bound to the stored amount.
    const tampered = await usage(post("/api/brand-workspace/usage", { operation: "order.confirm", input: { orderId: order.order.id, amount: 1 } }));
    expect(tampered.status).toBe(400);
    const confirmed = await usage(post("/api/brand-workspace/usage", { operation: "order.confirm", input: { orderId: order.order.id, amount: 330000 } }));
    const body = await confirmed.json();
    expect(body).toEqual({ ok: true, state: "fulfilled", href: `/brand/projects/${f.projectId}#usage` });
    const status = await usageStatus(new NextRequest(`https://brand.twings.app/api/brand-workspace/usage?orderId=${order.order.id}`, { headers }));
    const statusBody = await status.json();
    expect(statusBody).toMatchObject({ ok: true, status: "paid" });
    expect(JSON.stringify([order, body, statusBody])).not.toMatch(/fake_|payment_?key|compensation|consent/i);
    expect((await f.sql.query("select count(*)::int n from billing_payments")).rows[0]!.n).toBe(0);
  });
  it("payments closed: acceptance and ordering are refused, and an editor cannot pay", async () => {
    const { caseId, quoteId } = await f.quoted(10000);
    vi.stubEnv("BRAND_USAGE_PAYMENTS", "off");
    mocks.viewer.mockResolvedValue(f.owner);
    expect((await workspace(post("/api/brand-workspace", { operation: "usage.accept", input: { caseId, quoteId, expectedRevision: 3, confirmed: true, requestId: randomUUID() } }))).status).toBe(409);
    expect((await usage(post("/api/brand-workspace/usage", { operation: "order.create", input: { caseId, requestId: randomUUID(), consent: true } }))).status).toBe(403);
    vi.stubEnv("BRAND_USAGE_PAYMENTS", "on");
    mocks.viewer.mockResolvedValue(f.editor);
    expect((await usage(post("/api/brand-workspace/usage", { operation: "order.create", input: { caseId, requestId: randomUUID(), consent: true } }))).status).toBe(403);
  });
  it("a deployment without Toss keys has no gateway and never fakes a payment", async () => {
    vi.stubEnv("VERCEL", "1");
    const { caseId } = await f.quoted(10000);
    mocks.viewer.mockResolvedValue(f.owner);
    expect((await usage(post("/api/brand-workspace/usage", { operation: "order.create", input: { caseId, requestId: randomUUID(), consent: true } }))).status).toBe(503);
  });
  it("refuses cross-origin posts", async () => {
    mocks.viewer.mockResolvedValue(f.owner);
    const r = await usage(new NextRequest("https://brand.twings.app/api/brand-workspace/usage", { method: "POST", headers: { ...headers, origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: "{}" }));
    expect(r.status).toBe(403);
  });
});
