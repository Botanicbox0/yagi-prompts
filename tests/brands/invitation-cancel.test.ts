import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import * as s from "@/lib/brands/workspace/service";

/**
 * An owner cancels a still-pending workspace invitation from the team page (`invitation.cancel`).
 * Authorized exactly like `createBrandInvitation`: an active owner of that brand, brand row locked.
 * The real service on PGlite; fixture names only.
 */
const ids = { admin: randomUUID(), owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID(), invitee: randomUUID(), guest: randomUUID() };
const as = (userId: string | null, email: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email, locale: "ko" });
const admin = as(ids.admin, "admin@example.test", true);
const owner = as(ids.owner, "owner@example.test");
const editor = as(ids.editor, "editor@example.test");
const viewer = as(ids.viewer, "viewer@example.test");
const outsider = as(ids.outsider, "outsider@example.test");
const invitee = as(ids.invitee, "invitee@example.test");
const guest = as(ids.guest, "guest@example.test");
const signedOut = as(null, "");
let db: PGlite, sql: SqlRunner, brandA: string, brandB: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

async function seat(v: Viewer, organizationId: string, role: "owner" | "editor" | "viewer") {
  const r = await s.createStudioInvitation({ sql }, admin, { organizationId, projectId: null, email: v.email, role, canComment: false, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  const accepted = await s.acceptBrandInvitation({ sql, verifiedEmail: v.email! }, v, { token: r.token });
  if (!accepted.ok) throw Error(accepted.code);
}
/** An owner's own workspace invitation, as the team page's composer sends it. */
async function invite(organizationId = brandA, email = invitee.email!, by: Viewer = owner) {
  const r = await s.createBrandInvitation({ sql }, by, { organizationId, email, role: "editor", requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  return r;
}
const cancel = (v: Viewer, organizationId: string, invitationId: string) =>
  s.cancelBrandInvitation({ sql }, v, { organizationId, invitationId, requestId: randomUUID() });
const state = async (id: string) =>
  (await sql.query<{ revoked: boolean; accepted: boolean }>("select revoked_at is not null as revoked, accepted_at is not null as accepted from brand_invites where id=$1", [id])).rows[0];

beforeEach(async () => {
  db = await freshDb(); sql = runner(db);
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "admin", email: `${key}@example.test` });
  brandA = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand A", requestId: randomUUID() }));
  brandB = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand B", requestId: randomUUID() }));
  await seat(owner, brandA, "owner");
  await seat(editor, brandA, "editor");
  await seat(viewer, brandA, "viewer");
  await seat(owner, brandB, "owner");
});
afterEach(async () => { await db?.close(); });

describe("cancelling a pending workspace invitation", () => {
  it("lets the owner cancel it, and the link can no longer be accepted", async () => {
    const pending = await invite();
    expect(await cancel(owner, brandA, pending.id)).toEqual({ ok: true, id: pending.id });
    expect(await state(pending.id)).toEqual({ revoked: true, accepted: false });
    const accepted = await s.acceptBrandInvitation({ sql, verifiedEmail: invitee.email! }, invitee, { token: pending.token });
    expect(accepted).toMatchObject({ ok: false, code: "not_found" });
    expect((await sql.query("select count(*)::int as n from brand_memberships where organization_id=$1 and user_id=$2", [brandA, ids.invitee])).rows[0]).toMatchObject({ n: 0 });
  });

  it("refuses editors, viewers, outsiders and signed-out callers with the same codes as creating one", async () => {
    const pending = await invite();
    for (const v of [editor, viewer, outsider, signedOut]) {
      const created = await s.createBrandInvitation({ sql }, v, { organizationId: brandA, email: "someone@example.test", role: "viewer", requestId: randomUUID() });
      expect(created.ok, `${v.email || "signed out"} may not invite`).toBe(false);
      const refused = await cancel(v, brandA, pending.id);
      expect(refused, `${v.email || "signed out"}`).toEqual({ ok: false, code: created.ok ? "unreachable" : created.code });
    }
    // The codes themselves: a seat without ownership is forbidden; no seat at all reveals nothing.
    expect(await cancel(editor, brandA, pending.id)).toEqual({ ok: false, code: "forbidden" });
    expect(await cancel(viewer, brandA, pending.id)).toEqual({ ok: false, code: "forbidden" });
    expect(await cancel(outsider, brandA, pending.id)).toEqual({ ok: false, code: "not_found" });
    expect(await cancel(signedOut, brandA, pending.id)).toEqual({ ok: false, code: "sign_in_required" });
    expect(await state(pending.id)).toEqual({ revoked: false, accepted: false });
  });

  it("answers not found for an accepted or already cancelled invitation", async () => {
    const accepted = await invite();
    expect(await s.acceptBrandInvitation({ sql, verifiedEmail: invitee.email! }, invitee, { token: accepted.token })).toMatchObject({ ok: true });
    expect(await cancel(owner, brandA, accepted.id)).toEqual({ ok: false, code: "not_found" });
    expect(await state(accepted.id)).toEqual({ revoked: false, accepted: true });

    const twice = await invite(brandA, "later@example.test");
    expect(await cancel(owner, brandA, twice.id)).toMatchObject({ ok: true });
    expect(await cancel(owner, brandA, twice.id)).toEqual({ ok: false, code: "not_found" });
  });

  it("never reaches another brand's invitation, even for an owner of both", async () => {
    const elsewhere = await invite(brandB);
    expect(await cancel(owner, brandA, elsewhere.id)).toEqual({ ok: false, code: "not_found" });
    expect(await state(elsewhere.id)).toEqual({ revoked: false, accepted: false });
    // A member of brand A only cannot reach it by naming brand B either.
    expect(await cancel(editor, brandB, elsewhere.id)).toEqual({ ok: false, code: "not_found" });
  });

  it("leaves invitations the TWINGS team issued to the team (an owner seat or any other)", async () => {
    for (const role of ["owner", "editor"] as const) {
      const issued = await s.createStudioInvitation({ sql }, admin, { organizationId: brandA, projectId: null, email: role + "-seat@example.test", role, canComment: false, requestId: randomUUID() });
      if (!issued.ok) throw Error(issued.code);
      expect(await cancel(owner, brandA, issued.id), role).toEqual({ ok: false, code: "not_found" });
      expect(await state(issued.id), role).toEqual({ revoked: false, accepted: false });
    }
  });

  it("leaves campaign invitations to their own path", async () => {
    const project = idOf(await s.createStudioProject({ sql }, admin, { organizationId: brandA, title: "Fixture campaign", objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
    idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId: project, visible: true, expectedRevision: 0 }));
    const campaignInvite = await s.createStudioInvitation({ sql }, admin, { organizationId: brandA, projectId: project, email: guest.email, role: "viewer", canComment: false, requestId: randomUUID() });
    if (!campaignInvite.ok) throw Error(campaignInvite.code);
    expect(await cancel(owner, brandA, campaignInvite.id)).toEqual({ ok: false, code: "not_found" });
    expect(await state(campaignInvite.id)).toEqual({ revoked: false, accepted: false });
  });

  it("refuses a malformed body before touching anything", async () => {
    const pending = await invite();
    expect(await s.cancelBrandInvitation({ sql }, owner, { organizationId: brandA })).toMatchObject({ ok: false, code: "invalid" });
    expect(await s.cancelBrandInvitation({ sql }, owner, { organizationId: "not-a-uuid", invitationId: pending.id })).toMatchObject({ ok: false, code: "invalid" });
    expect(await state(pending.id)).toEqual({ revoked: false, accepted: false });
  });

  it("shows the cancelled invitation as cancelled on the team list", async () => {
    const pending = await invite();
    idOf(await cancel(owner, brandA, pending.id));
    const team = await s.loadBrandMembers({ sql }, owner, brandA);
    expect(team?.invitations.find((i) => i.id === pending.id)?.status).toBe("revoked");
  });
});
