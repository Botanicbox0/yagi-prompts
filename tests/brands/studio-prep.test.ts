import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * The studio's campaign preparation on brand.twings.app (docs/BRAND-STAFF-ACCESS.md "운영자 캠페인 준비"):
 * real PGlite, the real registry, dispatcher and route. Only the session, the database handle and
 * storage are injected. Fixture names only.
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
import { ADMIN_OPERATIONS } from "@/lib/admin/operations";
import { BRAND_HOST_STUDIO_OPERATIONS, brandHostDestination, brandHostOutcomeUrl } from "@/lib/admin/brand-host-studio";
import { POST } from "@/app/api/brand-workspace/studio/route";

const HOST = "brand.twings.app";
const ids = { admin: randomUUID(), staff: randomUUID(), owner: randomUUID() };
const as = (userId: string, email: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email, locale: "ko" });
const admin = as(ids.admin, "admin@example.test", true);
// A team-domain account reads every brand but is not a DB admin.
const staff = as(ids.staff, "ops@yagiworkshop.xyz");
const owner = as(ids.owner, `${ids.owner}@example.test`);
let db: PGlite, sql: SqlRunner, brandA: string, brandB: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

function post(fields: Record<string, string | File>, { json = true, origin = `https://${HOST}` } = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const sameSite = origin === `https://${HOST}`;
  return POST(new NextRequest(`https://${HOST}/api/brand-workspace/studio`, {
    method: "POST", body,
    headers: { host: HOST, origin, "sec-fetch-site": sameSite ? "same-origin" : "cross-site", ...(json ? { accept: "application/json" } : {}) },
  }));
}
const campaign = (organizationId: string, requestId = randomUUID()) => ({
  _op: "brandWorkspace.createProject", organizationId, title: "Fixture launch", objective: "Find creators for the launch", budgetKrw: "", productionMode: "creator", requestId,
});
const count = async (table: string) => Number((await sql.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);

beforeEach(async () => {
  db = await freshDb(); sql = runner(db); route.sql = sql; route.viewer = null;
  await seedProfile(sql, { id: ids.admin, isAdmin: true, email: admin.email! });
  await seedProfile(sql, { id: ids.staff, email: staff.email! });
  await seedProfile(sql, { id: ids.owner, email: owner.email! });
  brandA = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand A", requestId: randomUUID() }));
  brandB = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand B", requestId: randomUUID() }));
  const r = await s.createStudioInvitation({ sql }, admin, { organizationId: brandB, projectId: null, email: owner.email, role: "owner", canComment: false, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: owner.email! }, owner, { token: r.token })).toMatchObject({ ok: true });
});
afterEach(async () => { await db?.close(); });

describe("who may use the brand host's studio door", () => {
  it("answers 404 to everyone but a DB admin, before any operation runs", async () => {
    for (const viewer of [null, staff, owner]) {
      route.viewer = viewer;
      const response = await post(campaign(brandB));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).toBe("");
    }
    expect(await count("brand_projects")).toBe(0);
  });

  it("refuses a cross-site post from an admin's browser", async () => {
    route.viewer = admin;
    expect((await post(campaign(brandA), { origin: "https://evil.example" })).status).toBe(404);
    expect(await count("brand_projects")).toBe(0);
  });

  it("opens only its own registered operations, never the rest of the admin registry", async () => {
    for (const name of BRAND_HOST_STUDIO_OPERATIONS) expect(Object.keys(ADMIN_OPERATIONS)).toContain(name);
    route.viewer = admin;
    const invites = await count("brand_invites");
    const project = idOf(await s.createStudioProject({ sql }, admin, { organizationId: brandA, title: "Fixture hidden", objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
    for (const fields of [
      { _op: "brandWorkspace.visibility", projectId: project, expectedRevision: "0", visible: "true" } as Record<string, string>,
      { _op: "brandWorkspace.invite", organizationId: brandA, email: "fixture@example.test", role: "owner", access: "brand", requestId: randomUUID() },
      { _op: "caches.refresh" },
      { _op: "" },
    ]) expect((await post(fields)).status, fields._op).toBe(404);
    expect((await sql.query("select client_visible from brand_projects where id=$1", [project])).rows[0]).toEqual({ client_visible: false });
    expect(await count("brand_invites")).toBe(invites);
  });
});

describe("preparing a campaign from brand.twings.app", () => {
  beforeEach(() => { route.viewer = admin; });

  it("creates the campaign under the chosen brand, hidden from that brand's people, and lands on its page", async () => {
    const requestId = randomUUID();
    const response = await post(campaign(brandB, requestId));
    expect(response.status).toBe(200);
    const body = await response.json();
    const row = (await sql.query("select id, organization_id, client_visible, status, created_by from brand_projects")).rows;
    expect(row).toEqual([{ id: expect.any(String), organization_id: brandB, client_visible: false, status: "requested", created_by: ids.admin }]);
    expect(body).toEqual({ ok: true, to: `/brand/projects/${row[0]!.id}` });
    // The brand's own owner does not see it until the studio shares it; their rights are unchanged.
    expect(await s.loadBrandProject({ sql }, owner, String(row[0]!.id))).toBeNull();
    // A retried post (same request id) is the same campaign, not a second one.
    expect(await (await post(campaign(brandB, requestId))).json()).toEqual(body);
    expect(await count("brand_projects")).toBe(1);
    // The admin is still nobody's member.
    expect(Number((await sql.query("select count(*)::int as n from brand_memberships where user_id=$1", [ids.admin])).rows[0]!.n)).toBe(0);
  });

  it("states a refusal with the admin code instead of saving half a campaign", async () => {
    const response = await post({ ...campaign(brandA), title: "" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid" });
    expect(await count("brand_projects")).toBe(0);
  });

  it("registers a client brand without a membership and returns to the campaign form with it selected", async () => {
    const requestId = randomUUID();
    const body = await (await post({ _op: "brandWorkspace.organization", name: "Fixture new client", requestId })).json();
    const org = (await sql.query("select id, studio_managed from brand_organizations where name='Fixture new client'")).rows;
    expect(org).toEqual([{ id: expect.any(String), studio_managed: true }]);
    expect(body).toEqual({ ok: true, to: `/brand/projects/new?organizationId=${org[0]!.id}` });
    expect(Number((await sql.query("select count(*)::int as n from brand_memberships where organization_id=$1", [org[0]!.id])).rows[0]!.n)).toBe(0);
  });

  it("imports a shortlist from the campaign page and returns to its panel, candidates still hidden", async () => {
    const project = (await (await post(campaign(brandA))).json()).to.split("/").pop();
    const file = new File([JSON.stringify({ measuredOn: "2026-10-27", candidates: [{ handle: "fixture.creator", metrics: { followers: 12000 } }] })], "shortlist.json", { type: "application/json" });
    const response = await post({ _op: "brandWorkspace.shortlistImport", _back: `/brand/projects/${project}#shortlist-admin`, projectId: project, file }, { json: false });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://${HOST}/brand/projects/${project}?ok=saved#shortlist-admin`);
    expect((await sl.loadStudioShortlist({ sql }, admin, project))?.candidates.map((c) => [c.handle, c.shared])).toEqual([["fixture.creator", false]]);
    const share = await post({ _op: "brandWorkspace.shortlistShare", _back: `/brand/projects/${project}#shortlist-admin`, projectId: project, shared: "true" }, { json: false });
    expect(share.headers.get("location")).toBe(`https://${HOST}/brand/projects/${project}?ok=saved#shortlist-admin`);
    expect((await sl.loadStudioShortlist({ sql }, admin, project))?.candidates.map((c) => c.shared)).toEqual([true]);
  });
});

describe("where the brand host's studio door returns", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  it("maps admin destinations to the brand page that shows the same campaign", () => {
    expect(brandHostDestination(`/admin/brand-workspace/${id}`)).toBe(`/brand/projects/${id}`);
    expect(brandHostDestination(`/admin/brand-workspace/${id}#shortlist-admin`)).toBe(`/brand/projects/${id}#shortlist-admin`);
    expect(brandHostDestination("/admin/brand-workspace", id)).toBe(`/brand/projects/new?organizationId=${id}`);
    for (const to of [undefined, "/admin/brand-workspace", "/admin", `/admin/brand-workspace/organizations/${id}`, "https://evil.example/x"]) expect(brandHostDestination(to)).toBe("/brand");
    expect(brandHostDestination("/admin/brand-workspace", "not-a-uuid")).toBe("/brand");
  });

  it("returns JS-free forms to a brand campaign page only, with the outcome in the query", () => {
    const saved = { ok: true as const, code: "saved" as const };
    expect(brandHostOutcomeUrl(`/brand/projects/${id}?ok=old#shortlist-admin`, saved)).toBe(`/brand/projects/${id}?ok=saved#shortlist-admin`);
    expect(brandHostOutcomeUrl(`/brand/projects/${id}`, { ok: false, code: "invalid", detail: "invalid: candidates.0.metrics" }))
      .toBe(`/brand/projects/${id}?err=invalid&detail=invalid%3A+candidates.0.metrics`);
    for (const back of ["https://evil.example/brand/projects/new", "//evil.example", "/admin/brand-workspace", "/brand/../admin", "/brand/members", ""])
      expect(brandHostOutcomeUrl(back, saved), back).toBe("/brand?ok=saved");
  });
});
