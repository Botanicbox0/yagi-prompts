import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * The brand host's studio door, hardened (docs/BRAND-STAFF-ACCESS.md "보안"): exact origin AND
 * same-origin fetch metadata, a header a cross-site form cannot send on JSON calls, a short allowlist,
 * a per-admin budget, and an audit row before and after every action. Real PGlite and route.
 */
const route = vi.hoisted(() => ({ viewer: null as unknown, sql: null as unknown }));
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => route.viewer,
  requireAdmin: async () => {
    const viewer = route.viewer as { isAdmin?: boolean } | null;
    if (!viewer?.isAdmin) throw new Error("forbidden: admin only");
    return viewer;
  },
}));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => route.sql }));
vi.mock("@/lib/storage", () => ({ STAGING_BUCKET: "content", getStorage: async () => ({ putStaging: async () => {} }) }));

import * as s from "@/lib/brands/workspace/service";
import * as sl from "@/lib/brands/shortlist/service";
import { BRAND_HOST_STUDIO_OPERATIONS, STUDIO_REQUEST_HEADER } from "@/lib/admin/brand-host-studio";
import { STUDIO_RATE_LIMIT } from "@/lib/admin/brand-host-audit";
import { POST } from "@/app/api/brand-workspace/studio/route";

const HOST = "brand.twings.app", ORIGIN = `https://${HOST}`;
const ids = { admin: randomUUID(), other: randomUUID() };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
const admin = as(ids.admin, true), otherAdmin = as(ids.other, true);
let db: PGlite, sql: SqlRunner, brand: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

type Headers = Record<string, string | null>;
function post(fields: Record<string, string>, headers: Headers = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const base: Headers = { host: HOST, origin: ORIGIN, "sec-fetch-site": "same-origin", accept: "application/json", [STUDIO_REQUEST_HEADER]: "1" };
  const merged = Object.fromEntries(Object.entries({ ...base, ...headers }).filter(([, v]) => v !== null)) as Record<string, string>;
  return POST(new NextRequest(`${ORIGIN}/api/brand-workspace/studio`, { method: "POST", body, headers: merged }));
}
const campaign = (requestId = randomUUID()) => ({ _op: "brandWorkspace.createProject", organizationId: brand, title: "Fixture launch", objective: "Fixture objective", budgetKrw: "", productionMode: "creator", requestId });
const audit = async (actor = ids.admin) => (await sql.query<{ action: string; entity_id: string; state: string; code: string | null; ok: boolean | null }>(
  "select action, entity_id, details->>'state' as state, details->>'code' as code, (details->>'ok')::boolean as ok from platform_audit where actor_id=$1 and action like 'brandHostStudio.%' order by created_at, (details->>'state')", [actor])).rows;
const projects = async () => Number((await sql.query<{ n: number }>("select count(*)::int as n from brand_projects")).rows[0]!.n);

beforeEach(async () => {
  db = await freshDb(); sql = runner(db); route.sql = sql; route.viewer = admin;
  await seedProfile(sql, { id: ids.admin, isAdmin: true, email: admin.email! });
  await seedProfile(sql, { id: ids.other, isAdmin: true, email: otherAdmin.email! });
  brand = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand", requestId: randomUUID() }));
});
afterEach(async () => { await db?.close(); });

describe("request checks before anything runs", () => {
  it.each([
    ["no Origin", { origin: null }],
    ["another Origin", { origin: "https://twings.app" }],
    ["no Sec-Fetch-Site", { "sec-fetch-site": null }],
    ["a same-site (not same-origin) fetch", { "sec-fetch-site": "same-site" }],
    ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
    ["a JSON call without the studio header", { [STUDIO_REQUEST_HEADER]: null }],
    ["a JSON call with a wrong studio header", { [STUDIO_REQUEST_HEADER]: "yes" }],
  ])("refuses %s with a bare 404 and leaves no trace", async (_label, headers) => {
    const response = await post(campaign(), headers as Headers);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(await projects()).toBe(0);
    expect(await audit()).toEqual([]);
  });

  it("no longer opens candidate file import or candidate removal on the brand host", async () => {
    expect(BRAND_HOST_STUDIO_OPERATIONS).not.toContain("brandWorkspace.shortlistImport");
    expect(BRAND_HOST_STUDIO_OPERATIONS).not.toContain("brandWorkspace.shortlistRemove");
    for (const op of ["brandWorkspace.shortlistImport", "brandWorkspace.shortlistRemove", "brandWorkspace.visibility", "brandWorkspace.invite"])
      expect((await post({ _op: op, projectId: randomUUID(), candidateId: randomUUID() })).status, op).toBe(404);
    expect(await audit()).toEqual([]);
  });
});

describe("audit trail", () => {
  it("records who did what, on which campaign, before and after it runs", async () => {
    const body = await (await post(campaign())).json();
    expect(body.ok).toBe(true);
    const project = String(body.to).split("/").pop()!;
    expect(await audit()).toEqual([
      { action: "brandHostStudio.brandWorkspace.createProject", entity_id: brand, state: "attempt", code: null, ok: null },
      { action: "brandHostStudio.brandWorkspace.createProject", entity_id: brand, state: "result", code: "saved", ok: true },
    ]);
    await sl.importShortlist({ sql, storage: { putStaging: async () => {} } }, { kind: "studio", viewer: admin }, { projectId: project, measuredOn: "2026-10-27", candidates: [{ handle: "fixture.creator" }] });
    const shared = await post({ _op: "brandWorkspace.shortlistShare", _back: `/brand/projects/${project}`, projectId: project, shared: "true" }, { accept: null, [STUDIO_REQUEST_HEADER]: null });
    expect(shared.status).toBe(303);
    const rows = (await audit()).slice(2);
    expect(rows).toEqual([
      { action: "brandHostStudio.brandWorkspace.shortlistShare", entity_id: project, state: "attempt", code: null, ok: null },
      { action: "brandHostStudio.brandWorkspace.shortlistShare", entity_id: project, state: "result", code: "saved", ok: true },
    ]);
    const details = (await sql.query<{ details: Record<string, unknown> }>("select details from platform_audit where action='brandHostStudio.brandWorkspace.shortlistShare' and details->>'state'='attempt'")).rows[0]!.details;
    expect(details).toMatchObject({ host: HOST, projectId: project, shared: "true" });
  });

  it("sorts candidates through the door and records how many moved, never which ones", async () => {
    const project = String((await (await post(campaign())).json()).to).split("/").pop()!;
    await sl.importShortlist({ sql, storage: { putStaging: async () => {} } }, { kind: "studio", viewer: admin }, { projectId: project, candidates: [{ handle: "fixture.a" }, { handle: "fixture.b" }, { handle: "fixture.c" }] });
    const id = async (handle: string) => String((await sql.query("select id from brand_shortlist_candidates where handle=$1", [handle])).rows[0]!.id);
    const [a, b, c] = [await id("fixture.a"), await id("fixture.b"), await id("fixture.c")];
    const body = new FormData();
    for (const [key, value] of [["_op", "brandWorkspace.shortlistTriage"], ["_back", `/brand/projects/${project}#studio-tools`], ["projectId", project], ["share", a], ["exclude", b], ["exclude", c]]) body.append(key!, value!);
    const response = await POST(new NextRequest(`${ORIGIN}/api/brand-workspace/studio`, { method: "POST", body, headers: { host: HOST, origin: ORIGIN, "sec-fetch-site": "same-origin", accept: "application/json", [STUDIO_REQUEST_HEADER]: "1" } }));
    expect(response.status).toBe(200);
    expect((await sl.loadStudioShortlist({ sql }, admin, project))!.candidates.map((x) => [x.handle, x.state])).toEqual([["fixture.a", "shared"], ["fixture.b", "excluded"], ["fixture.c", "excluded"]]);
    const details = (await sql.query<{ details: Record<string, unknown> }>("select details from platform_audit where action='brandHostStudio.brandWorkspace.shortlistTriage' and details->>'state'='attempt'")).rows[0]!.details;
    expect(details).toMatchObject({ projectId: project, triage: { share: 1, exclude: 2, wait: 0 } });
    expect(JSON.stringify(details)).not.toContain(b);
    // The campaign's saved ranges go through the same door.
    expect((await post({ _op: "brandWorkspace.shortlistCriteria", _back: `/brand/projects/${project}`, projectId: project, criteria: JSON.stringify({ followers: { min: 1000 } }) })).status).toBe(200);
    expect((await sl.loadStudioShortlist({ sql }, admin, project))!.criteria).toEqual({ followers: { min: 1000 } });
  });

  it("records a refused action with its code", async () => {
    const response = await post({ ...campaign(), title: "" });
    expect(response.status).toBe(400);
    expect((await audit()).map((r) => [r.state, r.code, r.ok])).toEqual([["attempt", null, null], ["result", "invalid", false]]);
  });
});

describe("per-admin budget", () => {
  it(`allows ${STUDIO_RATE_LIMIT.attempts} actions per ${STUDIO_RATE_LIMIT.minutes} minutes, then refuses without running or recording more`, async () => {
    for (let i = 0; i < STUDIO_RATE_LIMIT.attempts; i++) expect((await post({ ...campaign(), title: "" })).status).toBe(400);
    const refused = await post(campaign());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ ok: false, code: "studioRateLimited" });
    expect(await projects()).toBe(0);
    expect((await audit()).filter((r) => r.state === "attempt")).toHaveLength(STUDIO_RATE_LIMIT.attempts);
    // A JS-free form gets the same refusal as a banner on its page.
    const form = await post({ _op: "brandWorkspace.shortlistShare", _back: `/brand/projects/${randomUUID()}`, projectId: randomUUID(), shared: "true" }, { accept: null, [STUDIO_REQUEST_HEADER]: null });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toContain("err=studioRateLimited");
    // Another admin has their own budget; an older window no longer counts.
    route.viewer = otherAdmin;
    expect((await post(campaign())).status).toBe(200);
    route.viewer = admin;
    // The audit table is immutable in every environment; only this test database ages its rows.
    await sql.query("alter table platform_audit disable trigger platform_audit_immutable");
    await sql.query("update platform_audit set created_at = now() - interval '11 minutes' where actor_id=$1", [ids.admin]);
    await sql.query("alter table platform_audit enable trigger platform_audit_immutable");
    expect((await post(campaign())).status).toBe(200);
  });
});
