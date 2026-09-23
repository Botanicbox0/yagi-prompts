import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * Brand identity in the workspace: which brands an account may select, that a selection scopes data
 * to one brand, and the private logo path (who may write, who may read, which bytes are accepted).
 * Real PGlite + the real service and route; only the session, database handle and storage are
 * injected. Fixture names only: no customer name, handle, image or figure appears here.
 */
const route = vi.hoisted(() => ({ viewer: null as unknown, sql: null as unknown, objects: new Map<string, Uint8Array>(), puts: 0 }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => route.viewer }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => route.sql }));
vi.mock("@/lib/storage", () => ({
  STAGING_BUCKET: "content",
  getStorage: async () => storage,
}));
const storage = {
  putStaging: async (key: string, bytes: Uint8Array) => { route.puts++; route.objects.set(key, new Uint8Array(bytes)); },
  read: async (_bucket: string, key: string) => { const b = route.objects.get(key); if (!b) throw Error("missing"); return b; },
};

import * as s from "@/lib/brands/workspace/service";
import { BRAND_WORKSPACE_OPERATIONS } from "@/lib/admin/brand-workspace-operations";
import { GET as readLogo, POST as uploadLogo } from "@/app/api/brand-workspace/organizations/[id]/logo/route";

const ids = { studio: randomUUID(), owner: randomUUID(), editor: randomUUID(), guest: randomUUID(), outsider: randomUUID() };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
const studio = as(ids.studio, true), owner = as(ids.owner), editor = as(ids.editor), guest = as(ids.guest), outsider = as(ids.outsider);
const pad = (head: number[] | Buffer, length = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, length - Buffer.from(head).length))]);
const PNG = pad([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG = pad([255, 216, 255, 224]);
const WEBP = pad(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]));
const GIF = pad(Buffer.from("GIF89a"));
let db: PGlite, sql: SqlRunner, brandA: string, brandB: string, bare: string, projectA: string, projectB: string, hiddenB: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

async function campaign(organizationId: string, title: string, visible = true) {
  const id = idOf(await s.createStudioProject({ sql }, studio, { organizationId, title, objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  if (visible) idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId: id, visible: true, expectedRevision: 0 }));
  return id;
}
async function invite(user: Viewer, organizationId: string, projectId: string | null, role: "owner" | "editor" | "viewer") {
  const r = await s.createStudioInvitation({ sql }, studio, { organizationId, projectId, email: user.email, role, canComment: false, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: user.email! }, user, { token: r.token })).toMatchObject({ ok: true });
}
const logo = (who: Viewer, organizationId: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) =>
  s.storeBrandOrganizationLogo({ sql, storage }, who, { organizationId, requestId: randomUUID(), expectedRevision: 0, bytes, ...extra });

beforeEach(async () => {
  db = await freshDb(); sql = runner(db);
  route.sql = sql; route.objects.clear(); route.puts = 0;
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "studio", email: `${id}@example.test` });
  brandA = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand A", requestId: randomUUID() }));
  brandB = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand B", requestId: randomUUID() }));
  bare = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand without campaigns", requestId: randomUUID() }));
  projectA = await campaign(brandA, "Campaign A");
  projectB = await campaign(brandB, "Campaign B");
  hiddenB = await campaign(brandB, "Hidden campaign B", false);
  await invite(owner, brandA, null, "owner");
  await invite(owner, brandB, null, "viewer");
  await invite(editor, brandA, null, "editor");
  await invite(guest, brandB, projectB, "viewer");
});
afterEach(async () => { await db?.close(); });

describe("workspace choices", () => {
  it("lists memberships with their own role, and campaign-only brands as guest", async () => {
    const mine = await s.loadBrandWorkspaceScope({ sql }, owner);
    expect(mine.choices.map((c) => [c.id, c.role])).toEqual([[brandA, "owner"], [brandB, "viewer"]]);
    expect(mine.projectOrganizations).toEqual({ [projectA]: brandA, [projectB]: brandB });
    const shared = await s.loadBrandWorkspaceScope({ sql }, guest);
    expect(shared.choices).toEqual([{ id: brandB, name: "Fixture brand B", role: "guest", logoUrl: null }]);
    // A hidden campaign is not visible, so it neither maps nor makes a brand selectable.
    expect(shared.projectOrganizations).toEqual({ [projectB]: brandB });
    expect(shared.projectOrganizations[hiddenB]).toBeUndefined();
    expect((await s.loadBrandWorkspaceScope({ sql }, outsider)).choices).toEqual([]);
  });

  it("gives a listed guest no membership, team, settings or brand-wide data", async () => {
    expect(await s.loadBrandMembers({ sql }, guest, brandB)).toBeNull();
    expect(await s.loadBrandSettings({ sql }, guest, brandB)).toBeNull();
    const w = await s.loadBrandWorkspace({ sql }, guest, { organizationId: brandB });
    expect(w.organizations).toEqual([]);
    expect(w.projects.map((p) => p.id)).toEqual([projectB]);
    expect(await s.loadBrandProject({ sql }, guest, hiddenB)).toBeNull();
  });

  it("drops a brand from the choices when the only campaign access is revoked or hidden", async () => {
    idOf(await s.revokeStudioAccess({ sql }, studio, { organizationId: brandB, userId: ids.guest, projectId: projectB }));
    expect((await s.loadBrandWorkspaceScope({ sql }, guest)).choices).toEqual([]);
    await invite(guest, brandB, projectB, "viewer");
    expect((await s.loadBrandWorkspaceScope({ sql }, guest)).choices).toHaveLength(1);
    idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId: projectB, visible: false, expectedRevision: 1 }));
    expect((await s.loadBrandWorkspaceScope({ sql }, guest)).choices).toEqual([]);
  });

  it("scopes home and library data to the selected brand only", async () => {
    const a = await s.loadBrandWorkspace({ sql }, owner, { organizationId: brandA, includeAllContent: true });
    expect(a.organizations.map((o) => [o.id, o.role])).toEqual([[brandA, "owner"]]);
    expect(a.projects.map((p) => p.id)).toEqual([projectA]);
    const b = await s.loadBrandWorkspace({ sql }, owner, { organizationId: brandB });
    expect(b.organizations.map((o) => [o.id, o.role])).toEqual([[brandB, "viewer"]]);
    expect(b.projects.map((p) => p.id)).toEqual([projectB]);
    // A brand the account cannot see, or a malformed id, yields nothing rather than everything.
    for (const forged of [bare, randomUUID(), "not-a-uuid"])
      expect(await s.loadBrandWorkspace({ sql }, owner, { organizationId: forged })).toEqual({ organizations: [], projects: [] });
    expect((await s.loadBrandWorkspace({ sql }, editor, { organizationId: brandB })).projects).toEqual([]);
  });
});

describe("brand logo writes", () => {
  it("lets the studio set a logo on a brand that has no campaign yet, into private staging only", async () => {
    const r = await logo(studio, bare, PNG);
    expect(r).toMatchObject({ ok: true, revision: 1 });
    const id = idOf(r);
    expect([...route.objects.keys()]).toEqual([`brands/${bare}/logos/${id}`]);
    expect((await s.loadStudioBrandAccess({ sql }, studio, bare))).toMatchObject({ logoUrl: `/api/brand-workspace/organizations/${bare}/logo?v=1`, logoRevision: 1 });
  });

  it("accepts PNG, JPEG and WebP by their bytes and refuses anything else", async () => {
    let revision = 0;
    for (const bytes of [PNG, JPEG, WEBP]) {
      expect(await logo(owner, brandA, bytes, { expectedRevision: revision })).toMatchObject({ ok: true, revision: revision + 1 });
      revision++;
    }
    const huge = Buffer.concat([PNG, Buffer.alloc(s.BRAND_LOGO_MAX_BYTES)]);
    for (const bytes of [GIF, Buffer.from("%PDF-1.7 not an image"), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), Buffer.alloc(0), PNG.subarray(0, 8), huge])
      expect(await logo(owner, brandA, bytes, { expectedRevision: revision })).toMatchObject({ ok: false, code: "invalid" });
    // A declared type must agree with the bytes; the bytes decide.
    expect(await logo(owner, brandA, JPEG, { expectedRevision: revision, mime: "image/png" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await logo(owner, brandA, PNG, { expectedRevision: revision, mime: "image/gif" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await logo(owner, brandA, PNG, { expectedRevision: revision, remoteUrl: "https://example.test/logo.png" })).toMatchObject({ ok: true });
    expect(route.puts).toBe(4);
  });

  it("allows owners and the studio; refuses editors, viewers, guests, outsiders and unknown brands", async () => {
    expect(await logo(editor, brandA, PNG)).toMatchObject({ ok: false, code: "forbidden" });
    // Owning brand A grants nothing on brand B, where this account is a viewer.
    expect(await logo(owner, brandB, PNG)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await logo(guest, brandB, PNG)).toMatchObject({ ok: false, code: "not_found" });
    expect(await logo(outsider, brandA, PNG)).toMatchObject({ ok: false, code: "not_found" });
    expect(await logo(studio, randomUUID(), PNG)).toMatchObject({ ok: false, code: "not_found" });
    expect(route.puts).toBe(0);
    expect(await logo(owner, brandA, PNG)).toMatchObject({ ok: true });
  });

  it("is idempotent per request, and stale revisions conflict", async () => {
    const requestId = randomUUID();
    const first = await logo(owner, brandA, PNG, { requestId });
    expect(await logo(owner, brandA, PNG, { requestId })).toEqual(first);
    expect(await logo(owner, brandA, JPEG, { requestId })).toMatchObject({ ok: false, code: "conflict" });
    expect(route.puts).toBe(1);
    expect(await logo(studio, brandA, JPEG, { expectedRevision: 0 })).toMatchObject({ ok: false, code: "conflict" });
    expect(await logo(studio, brandA, JPEG, { expectedRevision: 1 })).toMatchObject({ ok: true, revision: 2 });
  });

  it("removes back to the default avatar, retries safely, and keeps history immutable", async () => {
    idOf(await logo(owner, brandA, PNG));
    expect(await s.removeBrandOrganizationLogo({ sql }, editor, { organizationId: brandA, expectedRevision: 1 })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await s.removeBrandOrganizationLogo({ sql }, owner, { organizationId: brandA, expectedRevision: 0 })).toMatchObject({ ok: false, code: "conflict" });
    expect(await s.removeBrandOrganizationLogo({ sql }, owner, { organizationId: brandA, expectedRevision: 1 })).toMatchObject({ ok: true, revision: 2 });
    expect(await s.removeBrandOrganizationLogo({ sql }, owner, { organizationId: brandA, expectedRevision: 1 })).toMatchObject({ ok: true, revision: 2 });
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, owner, brandA)).toBeNull();
    expect((await s.loadBrandWorkspaceScope({ sql }, owner)).choices[0]!.logoUrl).toBeNull();
    expect((await s.loadBrandSettings({ sql }, owner, brandA))).toMatchObject({ logoUrl: null, logoRevision: 2 });
    await expect(sql.query("update brand_organization_logos set mime='image/png'")).rejects.toThrow(/immutable/);
    await expect(sql.query("delete from brand_organization_logos")).rejects.toThrow(/immutable/);
  });

  it("cannot point a brand at another brand's logo, even directly in the database", async () => {
    const foreign = idOf(await logo(studio, brandB, PNG));
    await expect(sql.query("update brand_organizations set logo_id=$1 where id=$2", [foreign, brandA])).rejects.toThrow();
  });

  it("runs through the admin operation registry with an uploaded file", async () => {
    const op = BRAND_WORKSPACE_OPERATIONS["brandWorkspace.logo"];
    const form = new FormData();
    form.set("organizationId", bare); form.set("requestId", randomUUID()); form.set("expectedRevision", "0");
    expect(op.parse(form)).toMatchObject({ ok: false });
    form.set("file", new File([PNG], "logo.png", { type: "image/png" }));
    const parsed = op.parse(form);
    if (!parsed.ok) throw Error("parse");
    expect(await op.run({ sql, storage, viewer: studio } as never, parsed.value)).toMatchObject({ ok: true });
    expect(await op.run({ sql, storage, viewer: owner } as never, { ...parsed.value, requestId: randomUUID(), expectedRevision: 1 })).toMatchObject({ ok: false });
    const remove = BRAND_WORKSPACE_OPERATIONS["brandWorkspace.logoRemove"];
    const removal = new FormData(); removal.set("organizationId", bare); removal.set("expectedRevision", "1");
    const value = remove.parse(removal); if (!value.ok) throw Error("parse");
    expect(await remove.run({ sql, storage, viewer: studio } as never, value.value)).toMatchObject({ ok: true });
    expect((await s.loadStudioBrandAccess({ sql }, studio, bare))).toMatchObject({ logoUrl: null, logoRevision: 2 });
  });
});

describe("brand logo reads", () => {
  beforeEach(async () => { idOf(await logo(studio, brandB, WEBP)); });

  it("serve members, shared-campaign guests and the studio; nobody else", async () => {
    for (const who of [owner, guest, studio]) expect(await s.loadBrandOrganizationLogoAccess({ sql }, who, brandB)).toMatchObject({ mime: "image/webp" });
    for (const who of [editor, outsider]) expect(await s.loadBrandOrganizationLogoAccess({ sql }, who, brandB)).toBeNull();
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, owner, randomUUID())).toBeNull();
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, owner, brandA)).toBeNull(); // no logo: default avatar
  });

  it("stop for a guest whose campaign access is revoked or whose campaign is hidden", async () => {
    idOf(await s.revokeStudioAccess({ sql }, studio, { organizationId: brandB, userId: ids.guest, projectId: projectB }));
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, guest, brandB)).toBeNull();
    await invite(guest, brandB, projectB, "viewer");
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, guest, brandB)).not.toBeNull();
    idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId: projectB, visible: false, expectedRevision: 1 }));
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, guest, brandB)).toBeNull();
    // Membership revocation removes the owner's read as well.
    idOf(await s.revokeStudioAccess({ sql }, studio, { organizationId: brandB, userId: ids.owner, projectId: null }));
    expect(await s.loadBrandOrganizationLogoAccess({ sql }, owner, brandB)).toBeNull();
  });
});

describe("logo route", () => {
  const url = (org: string, query = "") => `https://brand.twings.app/api/brand-workspace/organizations/${org}/logo${query}`;
  const ctx = (org: string) => ({ params: Promise.resolve({ id: org }) });
  const post = (org: string, body: Uint8Array, headers: Record<string, string> = {}) => new NextRequest(url(org, `?requestId=${randomUUID()}&expectedRevision=0`), {
    method: "POST", body: Buffer.from(body),
    headers: { host: "brand.twings.app", origin: "https://brand.twings.app", "sec-fetch-site": "same-origin", "content-type": "image/png", ...headers },
  });

  it("streams the private bytes with no-store to an allowed reader and 404s everyone else", async () => {
    idOf(await logo(studio, brandB, PNG));
    route.viewer = guest;
    const ok = await readLogo(new NextRequest(url(brandB)), ctx(brandB));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await ok.arrayBuffer()).equals(PNG)).toBe(true);
    for (const [who, org] of [[outsider, brandB], [guest, brandA], [guest, randomUUID()], [guest, "not-a-uuid"]] as const) {
      route.viewer = who;
      expect((await readLogo(new NextRequest(url(org)), ctx(org))).status).toBe(404);
    }
    route.viewer = { userId: null };
    expect((await readLogo(new NextRequest(url(brandB)), ctx(brandB))).status).toBe(404);
  });

  it("accepts an owner's raw image and refuses bad bytes, oversize bodies, non-owners and cross-site posts", async () => {
    route.viewer = owner;
    expect((await uploadLogo(post(brandA, PNG), ctx(brandA))).status).toBe(200);
    expect((await uploadLogo(post(brandA, GIF, { "content-type": "image/gif" }), ctx(brandA))).status).toBe(400);
    expect((await uploadLogo(post(brandA, Buffer.alloc(s.BRAND_LOGO_MAX_BYTES + 1)), ctx(brandA))).status).toBe(413);
    expect((await uploadLogo(post(brandB, PNG), ctx(brandB))).status).toBe(403);
    expect((await uploadLogo(post(brandA, PNG, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), ctx(brandA))).status).toBe(403);
    route.viewer = outsider;
    expect((await uploadLogo(post(brandA, PNG), ctx(brandA))).status).toBe(404);
  });
});
