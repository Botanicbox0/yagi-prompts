import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import * as s from "@/lib/brands/workspace/service";
const adminId = randomUUID(),
  clientId = randomUUID(),
  outsiderId = randomUUID();
const viewer = (userId: string, isAdmin = false): Viewer => ({
  userId,
  isAdmin,
  tier: isAdmin ? "admin" : "free",
  email: `${userId}@example.test`,
  locale: "ko",
});
const admin = viewer(adminId, true),
  client = viewer(clientId),
  outsider = viewer(outsiderId);
let db: PGlite, sql: SqlRunner, orgId: string, projectId: string;
const idOf = (r: s.BrandOutcome) => {
  if (!r.ok) throw Error(r.code);
  return r.id;
};
beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, clientId, outsiderId])
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`,
    });
  orgId = idOf(
    await s.createStudioOrganization({ sql }, admin, {
      name: "Fixture brand",
      requestId: randomUUID(),
    }),
  );
  projectId = idOf(
    await s.createStudioProject({ sql }, admin, {
      organizationId: orgId,
      title: "Fixture campaign",
      objective: "Prepare a campaign report",
      budgetKrw: null,
      productionMode: "creator",
      requestId: randomUUID(),
    }),
  );
});
afterEach(async () => {
  await db?.close();
});
it("creates a studio-managed brand without impersonating a customer and hides unpublished campaigns", async () => {
  expect(
    (await sql.query("select * from brand_memberships")).rows,
  ).toHaveLength(0);
  expect(
    (await s.loadStudioWorkspace({ sql }, admin)).organizations,
  ).toHaveLength(1);
  expect(
    await s.createStudioOrganization(
      { sql },
      { ...client, isAdmin: true },
      { name: "Forbidden", requestId: randomUUID() },
    ),
  ).toMatchObject({ ok: false, code: "forbidden" });
  await sql.query(
    "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [orgId, clientId],
  );
  expect(await s.loadBrandProject({ sql }, client, projectId)).toBeNull();
  expect((await s.loadBrandWorkspace({ sql }, client)).projects).toHaveLength(
    0,
  );
  expect(
    await s.setBrandProjectVisibility({ sql }, admin, {
      projectId,
      visible: true,
      expectedRevision: 0,
    }),
  ).toMatchObject({ ok: true });
  expect(await s.loadBrandProject({ sql }, client, projectId)).not.toBeNull();
});
it("grants only the invited campaign after verified signup, and revocation blocks retry and files", async () => {
  // A campaign-only invitation needs a campaign the client can open (hidden ones refuse: not_shared).
  await s.setBrandProjectVisibility({ sql }, admin, {
    projectId,
    visible: true,
    expectedRevision: 0,
  });
  const invite = await s.createStudioInvitation({ sql }, admin, {
    organizationId: orgId,
    projectId,
    email: client.email,
    role: "viewer",
    requestId: randomUUID(),
  });
  if (!invite.ok) throw Error(invite.code);
  expect(
    await s.acceptBrandInvitation({ sql }, client, { token: invite.token }),
  ).toMatchObject({ ok: false, code: "forbidden" });
  expect(
    await s.acceptBrandInvitation(
      { sql, verifiedEmail: client.email! },
      client,
      { token: invite.token },
    ),
  ).toMatchObject({ ok: true, projectId });
  expect(
    (await sql.query("select * from brand_memberships")).rows,
  ).toHaveLength(0);
  expect((await s.loadBrandWorkspace({ sql }, client)).projects).toHaveLength(
    1,
  );
  expect(
    await s.sendBrandMessage({ sql }, client, {
      projectId,
      body: "Cannot edit",
      requestId: randomUUID(),
    }),
  ).toMatchObject({ ok: false, code: "forbidden" });
  expect(
    await s.revokeStudioAccess({ sql }, admin, {
      organizationId: orgId,
      userId: clientId,
      projectId,
    }),
  ).toMatchObject({ ok: true });
  expect(await s.loadBrandProject({ sql }, client, projectId)).toBeNull();
  expect(
    await s.acceptBrandInvitation(
      { sql, verifiedEmail: client.email! },
      client,
      { token: invite.token },
    ),
  ).toMatchObject({ ok: false });
});
it("keeps contract uploads private, versions immutable, and sharing campaign-scoped", async () => {
  await sql.query(
    "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [orgId, clientId],
  );
  await s.setBrandProjectVisibility({ sql }, admin, {
    projectId,
    visible: true,
    expectedRevision: 0,
  });
  const input = {
    projectId,
    requestId: randomUUID(),
    name: "contract.pdf",
    mime: "application/pdf",
    sizeBytes: 8,
    purpose: "contract",
  };
  expect(await s.reserveBrandAttachment({ sql }, client, input)).toMatchObject({
    ok: false,
    code: "forbidden",
  });
  const file = await s.reserveBrandAttachment({ sql }, admin, input);
  if (!file.ok) throw Error(file.code);
  await s.completeBrandAttachment(
    { sql, storage: { read: async () => Buffer.from("%PDF-1.7") } },
    admin,
    file.id,
  );
  expect(
    await s.loadBrandAttachmentAccess({ sql }, client, file.id),
  ).toBeNull();
  const doc = {
    projectId,
    attachmentId: file.id,
    documentKey: "agreement",
    title: "Campaign agreement",
    requestId: randomUUID(),
  };
  const saved = await s.addBrandContract({ sql }, admin, doc);
  expect(saved).toMatchObject({ ok: true });
  expect(await s.addBrandContract({ sql }, admin, doc)).toEqual(saved);
  expect(
    (await s.loadBrandProject({ sql }, client, projectId))?.contracts,
  ).toHaveLength(0);
  expect(
    (await s.loadBrandProject({ sql }, client, projectId))?.attachments,
  ).toHaveLength(0);
  if (!saved.ok) throw Error(saved.code);
  await s.shareBrandContract({ sql }, admin, {
    projectId,
    contractId: saved.id,
    shared: true,
    expectedRevision: 0,
  });
  expect(
    (await s.loadBrandProject({ sql }, client, projectId))?.contracts,
  ).toHaveLength(1);
  expect(
    await s.loadBrandAttachmentAccess({ sql }, client, file.id),
  ).not.toBeNull();
  expect(
    await s.loadBrandAttachmentAccess({ sql }, outsider, file.id),
  ).toBeNull();
  await expect(
    sql.query("update brand_contract_documents set title=$1 where id=$2", [
      "Changed",
      saved.id,
    ]),
  ).rejects.toThrow(/immutable/);
  await s.revokeStudioAccess({ sql }, admin, {
    organizationId: orgId,
    userId: clientId,
    projectId: null,
  });
  expect(
    await s.loadBrandAttachmentAccess({ sql }, client, file.id),
  ).toBeNull();
});

it("limits brand settings to owners and preserves revision conflicts", async () => {
  await sql.query(
    "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [orgId, clientId],
  );
  const input = {
    organizationId: orgId,
    name: "Updated brand",
    website: "https://example.com/",
    description: "Brand description",
    contactEmail: "hello@example.com",
    expectedRevision: 0,
  };
  expect(await s.updateBrandSettings({ sql }, outsider, input)).toMatchObject({
    ok: false,
  });
  expect(
    await s.updateBrandSettings({ sql }, client, {
      ...input,
      website: "https://127.0.0.1/internal",
    }),
  ).toMatchObject({ ok: false, code: "invalid" });
  expect(await s.updateBrandSettings({ sql }, client, input)).toMatchObject({
    ok: true,
  });
  expect(await s.updateBrandSettings({ sql }, client, input)).toMatchObject({
    ok: false,
    code: "conflict",
  });
  expect(await s.loadBrandSettings({ sql }, outsider, orgId)).toBeNull();
  expect(await s.loadBrandSettings({ sql }, client, orgId)).toMatchObject({
    name: "Updated brand",
    revision: 1,
  });
});
it("keeps general support separate, idempotent and inaccessible to unrelated users", async () => {
  await sql.query(
    "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [orgId, clientId],
  );
  const input = {
    organizationId: orgId,
    body: "Please help with the workspace",
    requestId: randomUUID(),
  };
  const first = await s.sendBrandSupport({ sql }, client, input);
  expect(first).toMatchObject({ ok: true });
  expect(await s.sendBrandSupport({ sql }, client, input)).toEqual(first);
  expect(await s.sendBrandSupport({ sql }, outsider, input)).toMatchObject({
    ok: false,
  });
  expect(await s.loadBrandSupport({ sql }, outsider, orgId)).toBeNull();
  expect(
    await s.sendBrandSupport({ sql }, admin, {
      ...input,
      body: "Studio reply",
      requestId: randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(await s.loadBrandSupport({ sql }, client, orgId)).toHaveLength(2);
  expect(
    (await s.loadStudioProject({ sql }, admin, projectId))?.messages,
  ).toHaveLength(0);
  await s.revokeStudioAccess({ sql }, admin, {
    organizationId: orgId,
    userId: clientId,
  });
  expect(await s.loadBrandSupport({ sql }, client, orgId)).toBeNull();
});
