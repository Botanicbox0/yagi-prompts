import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * A campaign cover set from brand.twings.app (docs/BRAND-STAFF-ACCESS.md "운영자 캠페인 준비"): the
 * image goes through the existing attachment path (declared type and size checked on reserve, the
 * real bytes checked on complete), then `brandWorkspace.cover` through the hardened studio door.
 * Real PGlite, service and route; only the session, database handle and storage are injected.
 */
const route = vi.hoisted(() => ({ viewer: null as unknown, sql: null as unknown, objects: new Map<string, Uint8Array>() }));
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => route.viewer,
  requireAdmin: async () => {
    const viewer = route.viewer as { isAdmin?: boolean } | null;
    if (!viewer?.isAdmin) throw new Error("forbidden: admin only");
    return viewer;
  },
}));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => route.sql }));
const storage = {
  servesSignedUrls: false,
  putStaging: async (key: string, bytes: Uint8Array) => { route.objects.set(key, new Uint8Array(bytes)); },
  read: async (_bucket: string, key: string) => { const b = route.objects.get(key); if (!b) throw Error("missing"); return b; },
};
vi.mock("@/lib/storage", () => ({ STAGING_BUCKET: "content", getStorage: async () => storage }));

import * as s from "@/lib/brands/workspace/service";
import { BRAND_HOST_STUDIO_OPERATIONS, STUDIO_REQUEST_HEADER } from "@/lib/admin/brand-host-studio";
import { POST } from "@/app/api/brand-workspace/studio/route";

const HOST = "brand.twings.app", ORIGIN = `https://${HOST}`;
const ids = { admin: randomUUID(), owner: randomUUID() };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
const admin = as(ids.admin, true), owner = as(ids.owner);
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(56)]);
const PDF = Buffer.from("%PDF-1.7 fixture");
let db: PGlite, sql: SqlRunner, brand: string, project: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

function door(fields: Record<string, string>, viewer: Viewer = admin) {
  route.viewer = viewer;
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return POST(new NextRequest(`${ORIGIN}/api/brand-workspace/studio`, { method: "POST", body,
    headers: { host: HOST, origin: ORIGIN, "sec-fetch-site": "same-origin", accept: "application/json", [STUDIO_REQUEST_HEADER]: "1" } }));
}
/** The browser's three steps: reserve (declared type/size), bytes, complete (real bytes). */
async function upload(projectId: string, bytes: Uint8Array, mime: string, name = "cover.png") {
  const reserved = await s.reserveBrandAttachment({ sql }, admin, { projectId, requestId: randomUUID(), name, mime, sizeBytes: bytes.length });
  if (!reserved.ok) return reserved;
  route.objects.set(reserved.storageKey, bytes);
  const done = await s.completeBrandAttachment({ sql, storage }, admin, reserved.id);
  return done.ok ? { ok: true as const, id: reserved.id } : done;
}
const cover = async (projectId: string) => (await sql.query<{ cover_attachment_id: string | null; revision: number }>("select cover_attachment_id, revision from brand_projects where id=$1", [projectId])).rows[0];

beforeEach(async () => {
  db = await freshDb(); sql = runner(db); route.sql = sql; route.objects.clear();
  await seedProfile(sql, { id: ids.admin, isAdmin: true, email: admin.email! });
  await seedProfile(sql, { id: ids.owner, email: owner.email! });
  brand = idOf(await s.createStudioOrganization({ sql }, admin, { name: "Fixture brand", requestId: randomUUID() }));
  const created = await (await door({ _op: "brandWorkspace.createProject", organizationId: brand, title: "Fixture launch", objective: "Fixture objective", budgetKrw: "", productionMode: "creator", requestId: randomUUID() })).json();
  project = String(created.to).split("/").pop()!;
  const r = await s.createStudioInvitation({ sql }, admin, { organizationId: brand, projectId: null, email: owner.email, role: "owner", canComment: false, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: owner.email! }, owner, { token: r.token })).toMatchObject({ ok: true });
});
afterEach(async () => { await db?.close(); });

describe("campaign cover from the brand host", () => {
  it("opens the cover operation on the door", () => {
    expect(BRAND_HOST_STUDIO_OPERATIONS).toContain("brandWorkspace.cover");
  });

  it("sets an uploaded image as the cover of a new campaign, audited, and keeps it out of the client's file list", async () => {
    const image = await upload(project, PNG, "image/png");
    expect(image.ok).toBe(true);
    const attachmentId = (image as { id: string }).id;
    const response = await door({ _op: "brandWorkspace.cover", projectId: project, expectedRevision: "0", attachmentId });
    expect(await response.json()).toEqual({ ok: true, to: `/brand/projects/${project}` });
    expect(await cover(project)).toEqual({ cover_attachment_id: attachmentId, revision: 1 });
    const rows = (await sql.query<{ state: string; attachment: string; entity: string }>(
      "select details->>'state' as state, details->>'attachmentId' as attachment, entity_id as entity from platform_audit where action='brandHostStudio.brandWorkspace.cover' order by created_at, details->>'state'")).rows;
    expect(rows).toEqual([{ state: "attempt", attachment: attachmentId, entity: project }, { state: "result", attachment: attachmentId, entity: project }]);
    // Once shared, the client sees the cover at the top of the page, never as a file.
    idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId: project, visible: true, expectedRevision: 1 }));
    const seen = await s.loadBrandProject({ sql }, owner, project);
    expect(seen?.coverUrl).toContain(attachmentId);
    expect(seen?.attachments.map((a) => a.id)).not.toContain(attachmentId);
  });

  it("replaces the cover of an existing campaign at its current revision only", async () => {
    const first = (await upload(project, PNG, "image/png")) as { id: string };
    await door({ _op: "brandWorkspace.cover", projectId: project, expectedRevision: "0", attachmentId: first.id });
    const second = (await upload(project, PNG, "image/png", "cover-2.png")) as { id: string };
    // A page opened before the first change carries revision 0: refused instead of overwriting.
    expect(await (await door({ _op: "brandWorkspace.cover", projectId: project, expectedRevision: "0", attachmentId: second.id })).json()).toEqual({ ok: false, code: "brandConflict" });
    expect(await (await door({ _op: "brandWorkspace.cover", projectId: project, expectedRevision: "1", attachmentId: second.id })).json()).toEqual({ ok: true, to: `/brand/projects/${project}` });
    expect(await cover(project)).toEqual({ cover_attachment_id: second.id, revision: 2 });
  });

  it("refuses anything that is not a finished image of this campaign", async () => {
    // Declared PNG, but the bytes are not: the server checks the real bytes and never marks it ready.
    const lying = await upload(project, Buffer.from("not an image at all"), "image/png");
    expect(lying).toMatchObject({ ok: false, code: "invalid" });
    // Declared beyond the image limit: refused before any byte is sent.
    expect(await s.reserveBrandAttachment({ sql }, admin, { projectId: project, requestId: randomUUID(), name: "huge.png", mime: "image/png", sizeBytes: 15 * 1024 * 1024 + 1 })).toMatchObject({ ok: false, code: "invalid" });
    const pdf = (await upload(project, PDF, "application/pdf", "brief.pdf")) as { id: string };
    expect(await (await door({ _op: "brandWorkspace.cover", projectId: project, expectedRevision: "0", attachmentId: pdf.id })).json()).toEqual({ ok: false, code: "invalid" });
    const other = idOf(await s.createStudioProject({ sql }, admin, { organizationId: brand, title: "Other fixture", objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
    const elsewhere = (await upload(other, PNG, "image/png")) as { id: string };
    expect(await (await door({ _op: "brandWorkspace.cover", projectId: project, expectedRevision: "0", attachmentId: elsewhere.id })).json()).toEqual({ ok: false, code: "invalid" });
    expect(await cover(project)).toEqual({ cover_attachment_id: null, revision: 0 });
  });

  it("is a DB admin's move only", async () => {
    const image = (await upload(project, PNG, "image/png")) as { id: string };
    expect((await door({ _op: "brandWorkspace.cover", projectId: project, expectedRevision: "0", attachmentId: image.id }, owner)).status).toBe(404);
    expect(await cover(project)).toEqual({ cover_attachment_id: null, revision: 0 });
  });
});
