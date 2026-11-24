import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * `invitation.cancel` through the real brand workspace endpoint and the real service on PGlite: only the
 * session and the database handle are injected. The brand host allows the endpoint by path.
 */
const ctx = vi.hoisted(() => ({ viewer: null as unknown, sql: null as unknown }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => ctx.viewer }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => ctx.sql }));

import { POST } from "@/app/api/brand-workspace/route";
import { brandRouteAllowed } from "@/lib/routing/surfaces";
import * as s from "@/lib/brands/workspace/service";

const ids = { admin: randomUUID(), owner: randomUUID(), editor: randomUUID() };
const as = (userId: string, email: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email, locale: "ko" });
const admin = as(ids.admin, "admin@example.test", true);
const owner = as(ids.owner, "owner@example.test");
const editor = as(ids.editor, "editor@example.test");
let db: PGlite, sql: SqlRunner, brand: string;

const post = (body: unknown) =>
  POST(new NextRequest("https://brand.twings.app/api/brand-workspace", {
    method: "POST",
    headers: { host: "brand.twings.app", origin: "https://brand.twings.app", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
async function seat(v: Viewer, role: "owner" | "editor") {
  const r = await s.createStudioInvitation({ sql }, admin, { organizationId: brand, projectId: null, email: v.email, role, canComment: false, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  const accepted = await s.acceptBrandInvitation({ sql, verifiedEmail: v.email! }, v, { token: r.token });
  if (!accepted.ok) throw Error(accepted.code);
}

beforeEach(async () => {
  db = await freshDb(); sql = runner(db); ctx.sql = sql;
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "admin", email: `${key}@example.test` });
  const created = await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand", requestId: randomUUID() });
  if (!created.ok) throw Error(created.code);
  brand = created.id;
  await seat(owner, "owner");
  await seat(editor, "editor");
});
afterEach(async () => { await db?.close(); });

describe("POST /api/brand-workspace invitation.cancel", () => {
  it("is served on the brand host by the endpoint's path", () => {
    expect(brandRouteAllowed("/api/brand-workspace", "POST")).toBe(true);
  });

  it("refuses a bad body", async () => {
    ctx.viewer = owner;
    const noInput = await post({ operation: "invitation.cancel" });
    expect(noInput.status).toBe(400);
    expect(await noInput.json()).toEqual({ ok: false, code: "invalid" });
    const badIds = await post({ operation: "invitation.cancel", input: { organizationId: brand, invitationId: "not-a-uuid" } });
    expect(badIds.status).toBe(400);
    expect(await badIds.json()).toMatchObject({ ok: false, code: "invalid" });
  });

  it("cancels an owner's pending invitation and refuses an editor", async () => {
    const pending = await s.createBrandInvitation({ sql }, owner, { organizationId: brand, email: "invitee@example.test", role: "viewer", requestId: randomUUID() });
    if (!pending.ok) throw Error(pending.code);
    const input = { organizationId: brand, invitationId: pending.id, requestId: randomUUID() };

    ctx.viewer = editor;
    const refused = await post({ operation: "invitation.cancel", input });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ ok: false, code: "forbidden" });

    ctx.viewer = owner;
    const done = await post({ operation: "invitation.cancel", input });
    expect(done.status).toBe(200);
    expect(done.headers.get("cache-control")).toBe("private, no-store");
    expect(await done.json()).toEqual({ ok: true, id: pending.id });
    expect((await sql.query("select revoked_at is not null as revoked from brand_invites where id=$1", [pending.id])).rows[0]).toEqual({ revoked: true });

    const again = await post({ operation: "invitation.cancel", input });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ ok: false, code: "not_found" });
  });
});
