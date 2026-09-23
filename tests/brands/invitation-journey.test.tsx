import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * The brand invitation journey (audit P2-1, P2-2, P2-3 and the members-page P3 items): the real
 * service on PGlite, and the real brand home and members pages with only the request context
 * (session, locale, database handle) injected. Fixture names only.
 */
const ctx = vi.hoisted(() => ({ sql: null as unknown, viewer: null as unknown }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return { brandContext: async () => { const dict = getDictionary("ko"); return { viewer: ctx.viewer, sql: ctx.sql, verifiedEmail: undefined, brandHost: false, locale: "ko", dict, b: dict.brandWorkspace }; } };
});

import * as s from "@/lib/brands/workspace/service";
import { invitationLanding, resolveWorkspaceSelection } from "@/lib/brands/workspace/selection";
import { invitationFailure } from "@/components/brand-workspace/invite-outcome";
import BrandHome from "@/app/(brand)/brand/page";
import MembersPage from "@/app/(brand)/brand/members/page";
import { getDictionary } from "@/lib/i18n/dictionaries";

const b = getDictionary("ko").brandWorkspace;
const ids = { admin: randomUUID(), owner: randomUUID(), owner2: randomUUID(), user: randomUUID(), other: randomUUID(), guest: randomUUID() };
const as = (userId: string, email: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email, locale: "ko" });
const admin = as(ids.admin, "admin@example.test", true);
const owner = as(ids.owner, "owner@example.test");
const owner2 = as(ids.owner2, "owner2@example.test");
const user = as(ids.user, "user@example.test");
const other = as(ids.other, "other@example.test");
const guest = as(ids.guest, "guest@example.test");
let db: PGlite, sql: SqlRunner, brandA: string, brandB: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

async function campaign(organizationId: string, visible: boolean, title = "Fixture campaign") {
  const id = idOf(await s.createStudioProject({ sql }, admin, { organizationId, title, objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  let revision = 0;
  if (visible) { idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId: id, visible: true, expectedRevision: revision })); revision++; }
  idOf(await s.activateBrandProject({ sql }, admin, { projectId: id, expectedRevision: revision, status: "active" }));
  return id;
}
async function hide(projectId: string) {
  const revision = Number((await sql.query<{ revision: number }>("select revision from brand_projects where id=$1", [projectId])).rows[0]!.revision);
  idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId, visible: false, expectedRevision: revision }));
}
async function token(v: Viewer, organizationId: string, role: "owner" | "editor" | "viewer", projectId: string | null = null) {
  const r = await s.createStudioInvitation({ sql }, admin, { organizationId, projectId, email: v.email, role, canComment: false, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  return r.token;
}
const accept = (v: Viewer, t: string, verifiedEmail: string | undefined = v.email!) => s.acceptBrandInvitation({ sql, verifiedEmail }, v, { token: t });
const page = async (render: () => Promise<React.ReactElement>, viewer: Viewer) => { ctx.viewer = viewer; return renderToStaticMarkup(await render()); };
const search = (organizationId?: string) => ({ searchParams: Promise.resolve(organizationId ? { organizationId } : {}) });

beforeEach(async () => {
  db = await freshDb(); sql = runner(db); ctx.sql = sql;
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "admin", email: key === "admin" ? admin.email! : `${key}@example.test` });
  brandA = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand A", requestId: randomUUID() }));
  brandB = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand B", requestId: randomUUID() }));
});
afterEach(async () => { await db?.close(); });

describe("accepting an invitation lands in that brand", () => {
  it("R1: a second brand's invitation opens that brand, not the oldest membership", async () => {
    expect(await accept(user, await token(user, brandA, "editor"))).toMatchObject({ ok: true });
    const result = await accept(user, await token(user, brandB, "viewer"));
    if (!result.ok) throw Error(result.code);
    const landing = invitationLanding(result);
    expect(landing).toBe(`/brand?organizationId=${brandB}`);
    const scope = await s.loadBrandWorkspaceScope({ sql }, user);
    const query = new URL(landing, "https://brand.invalid").searchParams.get("organizationId");
    expect(resolveWorkspaceSelection(scope.choices, { query })).toMatchObject({ state: "selected", choice: { id: brandB } });
  });

  it("a campaign invitation opens that shared campaign with its brand selected", async () => {
    const shared = await campaign(brandA, true);
    const result = await accept(guest, await token(guest, brandA, "viewer", shared));
    if (!result.ok) throw Error(result.code);
    expect(result).toMatchObject({ projectId: shared, projectShared: true });
    expect(invitationLanding(result)).toBe(`/brand/projects/${shared}?organizationId=${brandA}`);
    expect(await s.loadBrandProject({ sql }, guest, shared)).not.toBeNull();
  });

  it("R2: a re-sent invitation for the same role is a success that changes nothing", async () => {
    expect(await accept(user, await token(user, brandA, "editor"))).toMatchObject({ ok: true });
    const again = await accept(user, await token(user, brandA, "editor"));
    expect(again).toMatchObject({ ok: true, organizationId: brandA });
    if (!again.ok) throw Error(again.code);
    expect(invitationLanding(again)).toBe(`/brand?organizationId=${brandA}`);
    expect((await s.loadBrandWorkspace({ sql }, user, { organizationId: brandA })).organizations).toEqual([{ id: brandA, name: "Fixture brand A", role: "editor" }]);
    // And it is used up: nothing is left pending.
    expect((await sql.query("select count(*)::int as n from brand_invites where organization_id=$1 and accepted_at is null and revoked_at is null", [brandA])).rows[0]).toMatchObject({ n: 0 });
  });

  it("R2b: an existing member offered a different role is refused, keeps the seat, and the invitation stays pending", async () => {
    expect(await accept(user, await token(user, brandA, "editor"))).toMatchObject({ ok: true });
    for (const role of ["viewer", "owner"] as const) {
      const result = await accept(user, await token(user, brandA, role));
      expect(result).toMatchObject({ ok: false, code: "existing_member_role_mismatch" });
      expect(invitationFailure(!result.ok && result.code, b)).toEqual({ notice: b.inviteRoleMismatch, switchAccount: false });
    }
    // Neither a downgrade nor an escalation happened.
    expect((await s.loadBrandWorkspace({ sql }, user, { organizationId: brandA })).organizations).toEqual([{ id: brandA, name: "Fixture brand A", role: "editor" }]);
    // Nothing refused was marked accepted; the newest invitation (a new one to the same address
    // supersedes the older) stays pending, so the studio still sees it as not accepted.
    expect((await sql.query("select count(*)::int as n from brand_invites where organization_id=$1 and role<>'editor' and accepted_at is not null", [brandA])).rows[0]).toMatchObject({ n: 0 });
    expect((await sql.query("select role from brand_invites where organization_id=$1 and accepted_at is null and revoked_at is null", [brandA])).rows).toEqual([{ role: "owner" }]);
  });

  it("R3: a wrong or unconfirmed account is told to switch account; expired or revoked links are invalid", async () => {
    const t = await token(user, brandA, "editor");
    const wrong = await accept(other, t);
    expect(wrong).toMatchObject({ ok: false, code: "forbidden" });
    expect(invitationFailure(!wrong.ok && wrong.code, b)).toEqual({ notice: b.inviteWrongAccount, switchAccount: true });
    const unconfirmed = await accept(user, t, "");
    expect(unconfirmed).toMatchObject({ ok: false, code: "forbidden" });
    const revoked = await token(guest, brandA, "viewer");
    await token(guest, brandA, "viewer"); // reissue revokes the first
    const stale = await accept(guest, revoked);
    expect(stale).toMatchObject({ ok: false, code: "not_found" });
    expect(invitationFailure(!stale.ok && stale.code, b)).toEqual({ notice: b.inviteInvalid, switchAccount: false });
  });
});

describe("campaigns not yet shared with the client", () => {
  it("R4: the studio cannot invite a guest to a hidden campaign, but can invite the brand before publication", async () => {
    const hidden = await campaign(brandA, false);
    expect(await s.createStudioInvitation({ sql }, admin, { organizationId: brandA, projectId: hidden, email: guest.email, role: "viewer", canComment: true, requestId: randomUUID() }))
      .toMatchObject({ ok: false, code: "not_shared" });
    expect((await sql.query("select count(*)::int as n from brand_invites")).rows[0]).toMatchObject({ n: 0 });
    expect(await s.createStudioInvitation({ sql }, admin, { organizationId: brandA, projectId: null, email: owner.email, role: "owner", canComment: false, requestId: randomUUID() }))
      .toMatchObject({ ok: true });
  });

  it("R4: a guest of a campaign hidden after the invitation waits honestly instead of being offered a new workspace", async () => {
    const project = await campaign(brandA, true);
    const t = await token(guest, brandA, "viewer", project);
    await hide(project);
    const result = await accept(guest, t);
    if (!result.ok) throw Error(result.code);
    expect(result).toMatchObject({ projectId: project, projectShared: false });
    expect(invitationLanding(result)).toBe("/brand");
    expect(await s.countPendingSharedCampaigns({ sql }, guest)).toBe(1);
    const home = await page(() => BrandHome(search()), guest);
    expect(home).toContain('data-brand-pending-share="1"');
    expect(home).toContain(b.pendingShareTitle);
    expect(home).not.toContain(b.createOrganization);
    expect(home).not.toContain("Fixture campaign");
    // Once shared, the waiting note goes and the campaign opens.
    const revision = Number((await sql.query<{ revision: number }>("select revision from brand_projects where id=$1", [project])).rows[0]!.revision);
    idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId: project, visible: true, expectedRevision: revision }));
    expect(await s.countPendingSharedCampaigns({ sql }, guest)).toBe(0);
    const after = await page(() => BrandHome(search()), guest);
    expect(after).not.toContain("data-brand-pending-share");
    expect(after).toContain("Fixture campaign");
  });

  it("a brand-new account with nothing pending still gets the workspace setup", async () => {
    const home = await page(() => BrandHome(search()), other);
    expect(home).toContain(b.createOrganization);
    expect(home).not.toContain("data-brand-pending-share");
  });
});

describe("members page", () => {
  it("names the campaign of a campaign-only invitation (only once shared) and shows another owner once", async () => {
    expect(await accept(owner, await token(owner, brandA, "owner"))).toMatchObject({ ok: true });
    expect(await accept(owner2, await token(owner2, brandA, "owner"))).toMatchObject({ ok: true });
    const shared = await campaign(brandA, true, "Shared fixture campaign");
    const later = await campaign(brandA, true, "Later fixture campaign");
    await token(guest, brandA, "viewer", shared);
    await token(other, brandA, "viewer", later);
    await hide(later);
    const html = await page(() => MembersPage(search(brandA)), owner);
    expect(html).toContain("캠페인 · Shared fixture campaign");
    expect(html).toContain(b.invitationCampaignPending);
    expect(html).not.toContain("Later fixture campaign");
    // The other owner's address stays private and the role label is not printed twice.
    expect(html).toContain(`<li class="bw-row"><div><strong>${b.otherOwner}</strong></div></li>`);
    expect(html).not.toContain(`<strong>${owner2.email}</strong>`);
    expect(html).not.toContain(`<strong>${b.roles.owner}</strong>`);
  });
});
