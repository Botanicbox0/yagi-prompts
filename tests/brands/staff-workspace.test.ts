import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * The TWINGS team's read-only view of every brand workspace: DB admins and accounts whose email the
 * auth server confirmed on exactly @yagiworkshop.xyz. Real PGlite, the real service and the real
 * routes; only the session (`getViewer`, `getSessionUser`), the database handle and storage are
 * injected. Fixture names only.
 */
const route = vi.hoisted(() => ({ viewer: null as unknown, session: null as unknown, sql: null as unknown, objects: new Map<string, Uint8Array>() }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => route.viewer }));
vi.mock("@/lib/supabase/auth-client", () => ({ getSessionUser: async () => route.session }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => route.sql }));
vi.mock("@/lib/storage", () => ({ STAGING_BUCKET: "content", getStorage: async () => storage }));
const storage = {
  servesSignedUrls: false,
  putStaging: async (key: string, bytes: Uint8Array) => { route.objects.set(key, new Uint8Array(bytes)); },
  read: async (_bucket: string, key: string) => { const b = route.objects.get(key); if (!b) throw Error("missing"); return b; },
};

import * as s from "@/lib/brands/workspace/service";
import { isStaffEmail, verifiedEmailOf, TWINGS_STAFF_EMAIL_DOMAIN } from "@/lib/brands/workspace/staff";
import { resolveWorkspaceSelection } from "@/lib/brands/workspace/selection";
import { createProductionContract, loadProductionWorkspace, reserveProduction, loadProductionOutput } from "@/lib/brands/production/service";
import { GET as readLogo } from "@/app/api/brand-workspace/organizations/[id]/logo/route";
import { GET as readAttachment } from "@/app/api/brand-workspace/attachments/[id]/route";
import { GET as readSupport, POST as workspaceApi } from "@/app/api/brand-workspace/route";

const STAFF_EMAIL = `ops@${TWINGS_STAFF_EMAIL_DOMAIN}`;
const ids = { admin: randomUUID(), staff: randomUUID(), spoof: randomUUID(), owner: randomUUID(), customer: randomUUID(), outsider: randomUUID() };
const as = (userId: string, email: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email, locale: "ko" });
const admin = as(ids.admin, "admin@example.test", true);
const staff = as(ids.staff, STAFF_EMAIL);
// Display/profile email on the team domain, but the auth server never confirmed it.
const spoof = as(ids.spoof, `lead@${TWINGS_STAFF_EMAIL_DOMAIN}`);
const owner = as(ids.owner, `${ids.owner}@example.test`);
const customer = as(ids.customer, `${ids.customer}@example.test`);
const outsider = as(ids.outsider, `${ids.outsider}@example.test`);
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(56)]);
const PDF = Buffer.from("%PDF-1.7 fixture");
let db: PGlite, sql: SqlRunner;
let brandA: string, brandB: string, bare: string, sharedA: string, hiddenA: string, sharedB: string;
let fileA: string, contractFileA: string, sharedContractFileA: string, fileB: string, contentA: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };
const staffDeps = () => ({ sql, verifiedEmail: STAFF_EMAIL });

async function campaign(organizationId: string, title: string, visible: boolean) {
  const id = idOf(await s.createStudioProject({ sql }, admin, { organizationId, title, objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  let revision = 0;
  if (visible) { idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId: id, visible: true, expectedRevision: revision })); revision++; }
  idOf(await s.activateBrandProject({ sql }, admin, { projectId: id, expectedRevision: revision, status: "active" }));
  return id;
}
async function file(projectId: string, mime: "image/png" | "application/pdf", purpose: "workspace" | "contract") {
  const bytes = mime === "image/png" ? PNG : PDF;
  const r = await s.reserveBrandAttachment({ sql }, admin, { projectId, requestId: randomUUID(), name: mime === "image/png" ? "fixture.png" : "fixture.pdf", mime, sizeBytes: bytes.length, purpose });
  if (!r.ok) throw Error(r.code);
  route.objects.set(r.storageKey, bytes);
  idOf(await s.completeBrandAttachment({ sql, storage: { read: async () => bytes } }, admin, r.id));
  return r.id;
}
async function invite(user: Viewer, organizationId: string, role: "owner" | "editor" | "viewer") {
  const r = await s.createStudioInvitation({ sql }, admin, { organizationId, projectId: null, email: user.email, role, canComment: false, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: user.email! }, user, { token: r.token })).toMatchObject({ ok: true });
}
/** Signs `viewer` in for the real routes. `confirmed` is the auth server's `email_confirmed_at`. */
function signIn(viewer: Viewer, confirmed: boolean, email = viewer.email) {
  route.viewer = viewer;
  route.session = { id: viewer.userId, email, email_confirmed_at: confirmed ? "2026-09-01T00:00:00Z" : null };
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string) => new NextRequest(`https://brand.twings.app${path}`);
const membershipCount = async (userId: string) => Number((await sql.query<{ n: number }>("select (select count(*) from brand_memberships where user_id=$1)+(select count(*) from brand_project_members where user_id=$1) as n", [userId])).rows[0]!.n);

beforeEach(async () => {
  db = await freshDb(); sql = runner(db);
  route.sql = sql; route.objects.clear(); route.viewer = null; route.session = null;
  for (const [key, id] of Object.entries(ids)) {
    const email = key === "staff" ? STAFF_EMAIL : key === "spoof" ? spoof.email! : key === "admin" ? admin.email! : `${id}@example.test`;
    await seedProfile(sql, { id, isAdmin: key === "admin", email });
  }
  brandA = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand A", requestId: randomUUID() }));
  brandB = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand B", requestId: randomUUID() }));
  bare = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand C (empty)", requestId: randomUUID() }));
  sharedA = await campaign(brandA, "Shared campaign A", true);
  hiddenA = await campaign(brandA, "Unshared campaign A", false);
  sharedB = await campaign(brandB, "Shared campaign B", true);
  fileA = await file(sharedA, "image/png", "workspace");
  contentA = idOf(await s.addBrandContentVersion({ sql }, admin, { projectId: sharedA, requestId: randomUUID(), slotKey: "hero", title: "Hero", attachmentId: fileA, caption: "", usageRights: "Organic social" }));
  contractFileA = await file(sharedA, "application/pdf", "contract");
  idOf(await s.addBrandContract({ sql }, admin, { projectId: sharedA, attachmentId: contractFileA, documentKey: "main", title: "Unshared contract", requestId: randomUUID() }));
  sharedContractFileA = await file(sharedA, "application/pdf", "contract");
  const shared = idOf(await s.addBrandContract({ sql }, admin, { projectId: sharedA, attachmentId: sharedContractFileA, documentKey: "signed", title: "Shared contract", requestId: randomUUID() }));
  idOf(await s.shareBrandContract({ sql }, admin, { projectId: sharedA, contractId: shared, shared: true, expectedRevision: 0 }));
  fileB = await file(sharedB, "image/png", "workspace");
  expect(await s.storeBrandOrganizationLogo({ sql, storage }, admin, { organizationId: brandA, requestId: randomUUID(), expectedRevision: 0, bytes: PNG })).toMatchObject({ ok: true });
  await invite(owner, brandA, "owner");
  await invite(customer, brandB, "editor");
});
afterEach(async () => { await db?.close(); });

describe("who counts as the TWINGS team", () => {
  it("matches the exact team domain only", () => {
    for (const ok of [STAFF_EMAIL, " Ops@YagiWorkshop.XYZ "]) expect(isStaffEmail(ok)).toBe(true);
    for (const bad of [undefined, null, "", "ops@example.test", `ops@sub.${TWINGS_STAFF_EMAIL_DOMAIN}`, `ops@${TWINGS_STAFF_EMAIL_DOMAIN}.evil.test`,
      `ops@evil${TWINGS_STAFF_EMAIL_DOMAIN}`, `${TWINGS_STAFF_EMAIL_DOMAIN}@example.test`, `a@b@${TWINGS_STAFF_EMAIL_DOMAIN}`, `@${TWINGS_STAFF_EMAIL_DOMAIN}`, `o ps@${TWINGS_STAFF_EMAIL_DOMAIN}`])
      expect(isStaffEmail(bad)).toBe(false);
  });

  it("takes the email only from a confirmed session of the same user", () => {
    expect(verifiedEmailOf({ id: ids.staff, email: STAFF_EMAIL, email_confirmed_at: "2026-09-01" }, ids.staff)).toBe(STAFF_EMAIL);
    expect(verifiedEmailOf({ id: ids.staff, email: STAFF_EMAIL, email_confirmed_at: null }, ids.staff)).toBeUndefined();
    expect(verifiedEmailOf({ id: ids.spoof, email: STAFF_EMAIL, email_confirmed_at: "2026-09-01" }, ids.staff)).toBeUndefined();
    expect(verifiedEmailOf(null, ids.staff)).toBeUndefined();
  });
});

describe("admin and verified team accounts browse every brand", () => {
  it("lists every brand, empty ones included, as studio and maps unshared campaigns (admin, no memberships)", async () => {
    const scope = await s.loadBrandWorkspaceScope({ sql }, admin);
    expect(scope.choices.map((c) => [c.name, c.role])).toEqual([["Fixture brand A", "studio"], ["Fixture brand B", "studio"], ["Fixture brand C (empty)", "studio"]]);
    expect(scope.choices[0]!.logoUrl).toBe(`/api/brand-workspace/organizations/${brandA}/logo?v=1`);
    expect(scope.projectOrganizations).toEqual({ [sharedA]: brandA, [hiddenA]: brandA, [sharedB]: brandB });
    // The URL picks the brand; an unknown id is unavailable, never another brand.
    expect(resolveWorkspaceSelection(scope.choices, { query: bare })).toMatchObject({ state: "selected", choice: { id: bare, role: "studio" } });
    expect(resolveWorkspaceSelection(scope.choices, { routeOrganizationId: scope.projectOrganizations[hiddenA] })).toMatchObject({ choice: { id: brandA } });
    expect(resolveWorkspaceSelection(scope.choices, { query: randomUUID() })).toEqual({ state: "unavailable" });
    expect(await membershipCount(ids.admin)).toBe(0);
  });

  it("gives a verified exact-domain non-admin the same read scope, without admin or membership", async () => {
    const adminScope = await s.loadBrandWorkspaceScope({ sql }, admin);
    expect(await s.loadBrandWorkspaceScope(staffDeps(), staff)).toEqual(adminScope);
    for (const [who, deps] of [[admin, { sql }], [staff, staffDeps()]] as const) {
      const a = await s.loadBrandWorkspace(deps, who, { organizationId: brandA, includeAllContent: true });
      expect(a.organizations).toEqual([]);
      expect(a.projects.map((p) => [p.id, p.clientVisible]).sort()).toEqual([[hiddenA, false], [sharedA, true]].sort());
      expect(await s.loadBrandWorkspace(deps, who, { organizationId: bare })).toEqual({ organizations: [], projects: [] });
      const hidden = await s.loadBrandProject(deps, who, hiddenA);
      expect(hidden).toMatchObject({ id: hiddenA, role: "studio", canComment: false });
      const detail = await s.loadBrandProject(deps, who, sharedA);
      expect(detail!.contracts!.map((c) => [c.title, c.shared]).sort()).toEqual([["Shared contract", true], ["Unshared contract", false]]);
      expect(await s.loadBrandSettings(deps, who, bare)).toMatchObject({ id: bare, role: "studio" });
      expect(await s.loadBrandMembers(deps, who, brandA)).toMatchObject({ organization: { id: brandA } });
      expect(await s.loadBrandSupport(deps, who, brandB)).toEqual([]);
      expect(await s.loadBrandOrganizationLogoAccess(deps, who, brandA)).toMatchObject({ mime: "image/png" });
      expect(await s.loadBrandAttachmentAccess(deps, who, contractFileA)).toMatchObject({ contract: true });
      expect(await s.loadBrandAttachmentAccess(deps, who, fileB)).toMatchObject({ mime: "image/png" });
    }
    const profile = (await sql.query("select is_admin from profiles where id=$1", [ids.staff])).rows[0]!;
    expect(profile.is_admin).toBe(false);
    expect(await membershipCount(ids.staff)).toBe(0);
    // Global studio screens stay admin-only.
    expect(await s.loadStudioWorkspace(staffDeps(), staff)).toEqual({ organizations: [], projects: [] });
    expect(await s.loadStudioBrandAccess(staffDeps(), staff, brandA)).toBeNull();
    expect(await s.loadStudioProject(staffDeps(), staff, hiddenA)).toBeNull();
  });

  it("keeps a team member's own customer membership as that role, with the rest as studio", async () => {
    await invite({ ...staff }, brandB, "viewer");
    const scope = await s.loadBrandWorkspaceScope(staffDeps(), staff);
    expect(scope.choices.map((c) => [c.id, c.role])).toEqual([[brandB, "viewer"], [brandA, "studio"], [bare, "studio"]]);
    // Where it is a member it sees what that member sees, not the internal view.
    expect((await s.loadBrandProject(staffDeps(), staff, sharedB))!.role).toBe("viewer");
  });
});

describe("unverified, spoofed and customer accounts stay in their own brands", () => {
  it("denies a team-domain profile or Viewer email the auth server never confirmed", async () => {
    const forgedViewer = { ...spoof, isAdmin: true, tier: "admin" as const };
    for (const [who, deps] of [
      [spoof, { sql }],
      [spoof, { sql, verifiedEmail: `lead@${TWINGS_STAFF_EMAIL_DOMAIN}.evil.test` }],
      [spoof, { sql, verifiedEmail: `lead@sub.${TWINGS_STAFF_EMAIL_DOMAIN}` }],
      [forgedViewer, { sql }],
      [outsider, { sql, verifiedEmail: outsider.email! }],
    ] as const) {
      expect((await s.loadBrandWorkspaceScope(deps, who)).choices).toEqual([]);
      expect(await s.loadBrandWorkspace(deps, who, { organizationId: brandA })).toEqual({ organizations: [], projects: [] });
      expect(await s.loadBrandProject(deps, who, sharedA)).toBeNull();
      expect(await s.loadBrandSettings(deps, who, brandA)).toBeNull();
      expect(await s.loadBrandMembers(deps, who, brandA)).toBeNull();
      expect(await s.loadBrandSupport(deps, who, brandA)).toBeNull();
      expect(await s.loadBrandOrganizationLogoAccess(deps, who, brandA)).toBeNull();
      expect(await s.loadBrandAttachmentAccess(deps, who, fileA)).toBeNull();
    }
  });

  it("the real routes read the team email from the confirmed session only", async () => {
    signIn(spoof, false);
    expect((await readLogo(get(`/api/brand-workspace/organizations/${brandA}/logo`), params(brandA))).status).toBe(404);
    expect((await readAttachment(get(`/api/brand-workspace/attachments/${fileA}`), params(fileA))).status).toBe(404);
    // Confirmed, but on a different user than the one resolved for the request.
    route.viewer = spoof; route.session = { id: ids.staff, email: STAFF_EMAIL, email_confirmed_at: "2026-09-01" };
    expect((await readLogo(get(`/api/brand-workspace/organizations/${brandA}/logo`), params(brandA))).status).toBe(404);
    signIn(staff, true);
    expect((await readLogo(get(`/api/brand-workspace/organizations/${brandA}/logo`), params(brandA))).status).toBe(200);
    const unshared = await readAttachment(get(`/api/brand-workspace/attachments/${contractFileA}`), params(contractFileA));
    expect(unshared.status).toBe(200);
    expect(Buffer.from(await unshared.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const support = await readSupport(get(`/api/brand-workspace?organizationId=${brandB}`));
    expect(support.status).toBe(200);
    signIn(staff, false);
    expect((await readLogo(get(`/api/brand-workspace/organizations/${brandA}/logo`), params(brandA))).status).toBe(404);
    expect((await readSupport(get(`/api/brand-workspace?organizationId=${brandB}`))).status).toBe(404);
  });

  it("an external customer sees only its own brand, and nothing after it is revoked", async () => {
    const scope = await s.loadBrandWorkspaceScope({ sql }, customer);
    expect(scope.choices.map((c) => [c.id, c.role])).toEqual([[brandB, "editor"]]);
    expect(scope.projectOrganizations).toEqual({ [sharedB]: brandB });
    for (const id of [sharedA, hiddenA]) expect(await s.loadBrandProject({ sql }, customer, id)).toBeNull();
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, customer, brandA)).toBeNull();
    expect(await s.loadBrandAttachmentAccess({ sql }, customer, fileA)).toBeNull();
    expect(await s.loadBrandAttachmentAccess({ sql }, customer, fileB)).toMatchObject({ mime: "image/png" });
    // The brand A owner never sees the unshared campaign or the unshared contract file.
    expect(await s.loadBrandProject({ sql }, owner, hiddenA)).toBeNull();
    expect(await s.loadBrandAttachmentAccess({ sql }, owner, contractFileA)).toBeNull();
    expect(await s.loadBrandAttachmentAccess({ sql }, owner, sharedContractFileA)).toMatchObject({ contract: true });
    signIn(customer, true);
    expect((await readLogo(get(`/api/brand-workspace/organizations/${brandA}/logo`), params(brandA))).status).toBe(404);
    expect((await readAttachment(get(`/api/brand-workspace/attachments/${fileA}`), params(fileA))).status).toBe(404);
    idOf(await s.revokeStudioAccess({ sql }, admin, { organizationId: brandB, userId: ids.customer, projectId: null }));
    expect((await s.loadBrandWorkspaceScope({ sql }, customer)).choices).toEqual([]);
    expect(await s.loadBrandProject({ sql }, customer, sharedB)).toBeNull();
    expect((await readAttachment(get(`/api/brand-workspace/attachments/${fileB}`), params(fileB))).status).toBe(404);
  });
});

describe("the team view writes nothing as the customer", () => {
  it("blocks every customer mutation for a verified team account and creates no membership", async () => {
    const deps = staffDeps();
    const refused = [
      await s.approveBrandContent(deps, staff, { projectId: sharedA, contentVersionId: contentA, decision: "approved", comment: "", expectedRevision: 0, requestId: randomUUID() }),
      await s.sendBrandMessage(deps, staff, { projectId: sharedA, body: "Fixture", requestId: randomUUID() }),
      await s.reserveBrandAttachment(deps, staff, { projectId: sharedA, requestId: randomUUID(), name: "x.png", mime: "image/png", sizeBytes: PNG.length, purpose: "workspace" }),
      await s.createBrandProject(deps, staff, { organizationId: brandA, title: "Fixture", objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }),
      await s.updateBrandSettings(deps, staff, { organizationId: brandA, name: "Renamed", website: "", description: "", contactEmail: "", expectedRevision: 0 }),
      await s.storeBrandOrganizationLogo({ ...deps, storage }, staff, { organizationId: bare, requestId: randomUUID(), expectedRevision: 0, bytes: PNG }),
      await s.createBrandInvitation(deps, staff, { organizationId: brandA, email: "new@example.test", role: "viewer", requestId: randomUUID() }),
      await s.revokeBrandMember(deps, staff, { organizationId: brandA, userId: ids.owner }),
      await s.sendBrandSupport(deps, staff, { organizationId: brandA, body: "Fixture", requestId: randomUUID() }),
      await s.createStudioOrganization(deps, staff, { name: "Fixture", requestId: randomUUID() }),
      await s.setBrandProjectVisibility(deps, staff, { projectId: hiddenA, visible: true, expectedRevision: 1 }),
    ];
    for (const r of refused) expect(r.ok).toBe(false);
    expect(await s.loadBrandAttachmentUploadAccess(deps, staff, fileA)).toBeNull();
    expect(await membershipCount(ids.staff)).toBe(0);
    expect((await sql.query("select client_visible from brand_projects where id=$1", [hiddenA])).rows[0]).toMatchObject({ client_visible: false });
    expect((await sql.query("select name,logo_id from brand_organizations where id=$1", [brandA])).rows[0]).toMatchObject({ name: "Fixture brand A" });
    expect((await sql.query("select logo_id from brand_organizations where id=$1", [bare])).rows[0]).toMatchObject({ logo_id: null });
    expect((await sql.query("select count(*)::int as n from brand_content_decisions")).rows[0]).toMatchObject({ n: 0 });
    // The real API refuses the same approval (404: this account has no customer seat here).
    signIn(staff, true);
    const res = await workspaceApi(new NextRequest("https://brand.twings.app/api/brand-workspace", {
      method: "POST", headers: { origin: "https://brand.twings.app", "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ operation: "content.decide", input: { projectId: sharedA, contentVersionId: contentA, decision: "approved", comment: "", expectedRevision: 0, requestId: randomUUID() } }),
    }));
    expect(res.status).toBe(404);
  });

  it("an admin browsing a brand cannot approve as its customer, and its studio messages stay studio", async () => {
    expect(await s.approveBrandContent({ sql }, admin, { projectId: sharedA, contentVersionId: contentA, decision: "approved", comment: "", expectedRevision: 0, requestId: randomUUID() }))
      .toMatchObject({ ok: false, code: "not_found" });
    idOf(await s.sendBrandMessage({ sql }, admin, { projectId: sharedA, body: "Studio note", requestId: randomUUID() }));
    expect((await s.loadBrandProject({ sql }, owner, sharedA))!.messages.map((m) => m.authorRole)).toEqual(["studio"]);
    expect(await membershipCount(ids.admin)).toBe(0);
  });

  it("reads a brand's production page without being able to generate or consume its quota", async () => {
    const contractId = idOf(await createProductionContract({ sql }, admin, { organizationId: brandA, projectId: sharedA, title: "Fixture scope", startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", limit: 3, requestId: randomUUID() }) as s.BrandOutcome);
    const view = await loadProductionWorkspace(staffDeps(), staff, brandA);
    expect(view).toMatchObject({ role: "studio", contracts: [{ id: contractId, remaining: 3 }] });
    expect(await loadProductionWorkspace({ sql }, spoof, brandA)).toBeNull();
    expect(await loadProductionWorkspace({ sql }, customer, brandA)).toBeNull();
    const enqueue = vi.fn(async () => ({ ok: true as const, id: randomUUID(), held: false }));
    for (const [who, deps] of [[staff, staffDeps()], [admin, { sql }]] as const)
      expect(await reserveProduction(deps, who, { contractId, templateId: randomUUID(), requestId: randomUUID(), fingerprint: "fixture" }, enqueue)).toMatchObject({ ok: false, code: "not_found" });
    expect(enqueue).not.toHaveBeenCalled();
    expect((await sql.query("select count(*)::int as n from brand_production_reservations")).rows[0]).toMatchObject({ n: 0 });
    expect(await loadProductionOutput(staffDeps(), staff, randomUUID())).toBeNull();
  });
});
