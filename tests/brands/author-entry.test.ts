import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { AdminContext } from "@/lib/admin/context";

/**
 * Who a campaign comment or support message is from follows the server entry it came through, not
 * `is_admin`: the brand API (`client`) writes as the customer seat, the admin console (`studio`) as the
 * studio. Real PGlite, the real brand API route and the real admin operations; fixture data only.
 */
const route = vi.hoisted(() => ({ viewer: null as unknown, session: null as unknown, sql: null as unknown }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => route.viewer }));
vi.mock("@/lib/supabase/auth-client", () => ({ getSessionUser: async () => route.session }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => route.sql }));

import * as s from "@/lib/brands/workspace/service";
import { POST as workspaceApi } from "@/app/api/brand-workspace/route";
import { BRAND_WORKSPACE_OPERATIONS } from "@/lib/admin/brand-workspace-operations";

const ids = { admin: randomUUID(), memberAdmin: randomUUID(), staff: randomUUID(), owner: randomUUID() };
const as = (userId: string, email: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email, locale: "ko" });
const admin = as(ids.admin, "admin@example.test", true);
const memberAdmin = as(ids.memberAdmin, "member-admin@example.test", true);
const staff = as(ids.staff, "ops@yagiworkshop.xyz");
const owner = as(ids.owner, "owner@example.test");
let db: PGlite, sql: SqlRunner, brand: string, shared: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

function signIn(viewer: Viewer) {
  route.viewer = viewer;
  route.session = { id: viewer.userId, email: viewer.email, email_confirmed_at: "2026-09-01T00:00:00Z" };
}
async function brandApi(viewer: Viewer, operation: string, input: Record<string, unknown>) {
  signIn(viewer);
  return workspaceApi(new NextRequest("https://brand.twings.app/api/brand-workspace", {
    method: "POST", headers: { origin: "https://brand.twings.app", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ operation, input }),
  }));
}
async function adminOp(viewer: Viewer, name: "brandWorkspace.message" | "brandWorkspace.support", fields: Record<string, string>) {
  const op = BRAND_WORKSPACE_OPERATIONS[name];
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const parsed = op.parse(form);
  if (!parsed.ok) throw Error("parse");
  return op.run({ sql, viewer } as unknown as AdminContext, parsed.value as never);
}
const lastMessageRole = async () => (await s.loadStudioProject({ sql }, admin, shared))!.messages.at(-1)?.authorRole;
const lastSupportRole = async () => (await s.loadBrandSupport({ sql }, admin, brand, true))!.at(-1)?.authorRole;
const receivedEvents = async () => Number((await sql.query<{ n: number }>("select count(*)::int as n from brand_workspace_events where project_id=$1 and kind='message_received'", [shared])).rows[0]!.n);
const messageCount = async () => Number((await sql.query<{ n: number }>("select (select count(*) from brand_messages)+(select count(*) from brand_support_messages) as n")).rows[0]!.n);

beforeEach(async () => {
  db = await freshDb(); sql = runner(db); route.sql = sql;
  for (const v of [admin, memberAdmin, staff, owner]) await seedProfile(sql, { id: v.userId!, isAdmin: v.isAdmin, email: v.email! });
  brand = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand", requestId: randomUUID() }));
  shared = idOf(await s.createStudioProject({ sql }, admin, { organizationId: brand, title: "Fixture campaign", objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId: shared, visible: true, expectedRevision: 0 }));
  idOf(await s.activateBrandProject({ sql }, admin, { projectId: shared, expectedRevision: 1, status: "active" }));
  // The member admin also holds an ordinary editor seat in the brand.
  const invite = await s.createStudioInvitation({ sql }, admin, { organizationId: brand, projectId: null, email: memberAdmin.email, role: "editor", canComment: false, requestId: randomUUID() });
  if (!invite.ok) throw Error(invite.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: memberAdmin.email! }, memberAdmin, { token: invite.token })).toMatchObject({ ok: true });
});
afterEach(async () => { await db?.close(); });

describe("author role follows the server entry path", () => {
  it("an admin who is a member writes as the brand through the brand API, and the studio is notified", async () => {
    expect((await brandApi(memberAdmin, "message.send", { projectId: shared, body: "Client comment", requestId: randomUUID() })).status).toBe(200);
    expect(await lastMessageRole()).toBe("brand");
    expect(await receivedEvents()).toBe(1);
    expect((await brandApi(memberAdmin, "support.send", { organizationId: brand, body: "Client support", requestId: randomUUID() })).status).toBe(200);
    expect(await lastSupportRole()).toBe("brand");
  });

  it("the same admin writes as the studio through the admin console", async () => {
    expect(await adminOp(memberAdmin, "brandWorkspace.message", { projectId: shared, body: "Studio reply", requestId: randomUUID() })).toMatchObject({ ok: true });
    expect(await lastMessageRole()).toBe("studio");
    expect(await receivedEvents()).toBe(0);
    expect(await adminOp(memberAdmin, "brandWorkspace.support", { organizationId: brand, body: "Studio support", requestId: randomUUID() })).toMatchObject({ ok: true });
    expect(await lastSupportRole()).toBe("studio");
  });

  it("a non-member admin still writes as the studio through the brand API (unchanged)", async () => {
    expect((await brandApi(admin, "message.send", { projectId: shared, body: "Studio note", requestId: randomUUID() })).status).toBe(200);
    expect(await lastMessageRole()).toBe("studio");
    expect(await receivedEvents()).toBe(0);
    expect((await brandApi(admin, "support.send", { organizationId: brand, body: "Studio support", requestId: randomUUID() })).status).toBe(200);
    expect(await lastSupportRole()).toBe("studio");
  });

  it("an ordinary member cannot write as the studio through the studio entry", async () => {
    expect(await s.sendBrandMessage({ sql }, owner, { projectId: shared, body: "x", requestId: randomUUID() }, "studio")).toMatchObject({ ok: false, code: "forbidden" });
    expect(await s.sendBrandSupport({ sql }, owner, { organizationId: brand, body: "x", requestId: randomUUID() }, "studio")).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("domain-only staff are refused on both entries and write nothing", async () => {
    expect((await brandApi(staff, "message.send", { projectId: shared, body: "x", requestId: randomUUID() })).status).toBe(404);
    expect((await brandApi(staff, "support.send", { organizationId: brand, body: "x", requestId: randomUUID() })).status).toBe(404);
    expect(await adminOp(staff, "brandWorkspace.message", { projectId: shared, body: "x", requestId: randomUUID() })).toMatchObject({ ok: false });
    expect(await adminOp(staff, "brandWorkspace.support", { organizationId: brand, body: "x", requestId: randomUUID() })).toMatchObject({ ok: false });
    expect(await messageCount()).toBe(0);
  });
});
