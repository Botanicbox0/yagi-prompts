import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { Viewer } from "@/lib/auth/identity";
import {
  createProductionContract,
  createProductionTemplate,
} from "@/lib/brands/production/service";
import { configureCampaignProduction } from "@/lib/campaigns/production";
import {
  campaignTermsVersion,
  loadInvitationLanding,
  bindCollaboration,
  issueInvitation,
  acceptInvitation,
  revokeInvitation,
  sendParticipantMessage,
  loadParticipation,
  storeParticipantFile,
  readParticipantFile,
} from "@/lib/campaigns/collaboration/service";
let db: PGlite, sql: SqlRunner;
const adminId = randomUUID(),
  brandId = randomUUID(),
  creatorId = randomUUID(),
  otherId = randomUUID();
const viewer = (userId: string): Viewer => ({
  userId,
  isAdmin: false,
  email: null,
  locale: "ko",
  tier: "free",
});
it("rejects spoofed admin flags, organization viewers and cross-project rebinding", async () => {
  const a = await fixture(),
    b = await fixture();
  expect(
    await bindCollaboration(
      { sql, now },
      { ...other, isAdmin: true },
      { campaignId: a.campaign, projectId: b.project },
    ),
  ).toMatchObject({ ok: false, code: "forbidden" });
  expect(
    await bindCollaboration({ sql, now }, admin, {
      campaignId: a.campaign,
      projectId: b.project,
    }),
  ).toMatchObject({ ok: false, code: "conflict" });
  await sql.query(
    "update brand_memberships set role='viewer' where organization_id=$1 and user_id=$2",
    [a.org, brandId],
  );
  expect(
    await issueInvitation({ sql, now }, brand, {
      campaignId: a.campaign,
      requestId: randomUUID(),
    }),
  ).toMatchObject({ ok: false, code: "forbidden" });
  expect(
    await issueInvitation({ sql, now }, other, {
      campaignId: b.campaign,
      requestId: randomUUID(),
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
});
it("database rejects production contract rebind to another project", async () => {
  const a = await fixture(),
    b = await fixture();
  const contractId = idOf(
    await createProductionContract({ sql, now }, admin, {
      organizationId: b.org,
      projectId: b.project,
      title: "Other brand production",
      startsAt: "2026-10-15T00:00:00Z",
      endsAt: "2026-11-01T00:00:00Z",
      limit: 10,
      requestId: randomUUID(),
    }),
  );
  const templateId = idOf(
    await createProductionTemplate({ sql, now }, admin, {
      contractId,
      title: "Private campaign",
      titleKo: "비공개 캠페인",
      promptText: "Private fixed campaign recipe with own face",
      seconds: 5,
      aspect: "9:16",
      requestId: randomUUID(),
    }),
  );
  await expect(
    configureCampaignProduction({ sql, now }, admin, {
      campaignId: a.campaign,
      contractId,
      templateId,
      enabled: false,
      expectedRevision: -1,
    }),
  ).rejects.toThrow("project conflict");
  expect(
    (
      await sql.query(
        "select * from campaign_productions where campaign_id=$1",
        [a.campaign],
      )
    ).rows,
  ).toHaveLength(0);
});
it("retains the issuer authority and project visibility on invitation acceptance", async () => {
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  await sql.query(
    "update brand_memberships set status='revoked' where organization_id=$1 and user_id=$2",
    [f.org, brandId],
  );
  expect(
    await acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
  await sql.query(
    "update brand_memberships set status='active' where organization_id=$1 and user_id=$2",
    [f.org, brandId],
  );
  await sql.query(
    "update brand_projects set client_visible=false where id=$1",
    [f.project],
  );
  expect(
    await acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
});
it("does not claim a new application when the last selected slot is already held", async () => {
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  await sql.query(
    "insert into campaign_applications(id,campaign_id,creator_id,status,pitch,sns_url,follower_count) values($1,$2,$3,'selected','Existing selected creator','https://instagram.com/other',10)",
    [randomUUID(), f.campaign, otherId],
  );
  expect(
    await acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  ).toMatchObject({ ok: false, code: "slots_full" });
  expect(
    (
      await sql.query(
        "select accepted_at from campaign_participant_invites where id=$1",
        [r.id],
      )
    ).rows[0],
  ).toEqual({ accepted_at: null });
});
it("concurrent acceptance of one bearer invitation admits exactly one account", async () => {
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  const results = await Promise.all([
    acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
    acceptInvitation({ sql, now }, other, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(
    (
      await sql.query(
        "select * from campaign_applications where campaign_id=$1",
        [f.campaign],
      )
    ).rows,
  ).toHaveLength(1);
});
it("refuses acceptance when the displayed campaign terms changed before submission", async () => {
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  const oldInput = { token: r.token, slug: f.slug, ...apply };
  await sql.query("update campaigns set requirements=$2::jsonb where id=$1", [
    f.campaign,
    JSON.stringify({ hashtags: ["changed"], mentions: [], disclosure: true }),
  ]);
  expect(await acceptInvitation({ sql, now }, creator, oldInput)).toMatchObject(
    { ok: false, code: "conflict" },
  );
  expect(
    (
      await sql.query(
        "select * from campaign_applications where campaign_id=$1",
        [f.campaign],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    await acceptInvitation({ sql, now }, creator, {
      ...oldInput,
      termsVersion: await campaignTermsVersion(sql, f.slug),
    }),
  ).toMatchObject({ ok: true });
});
it("declined applications cannot use threads while post rejection retains selected access", async () => {
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  const id = idOf(
    await acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  );
  await sql.query(
    "update campaign_applications set status='declined' where id=$1",
    [id],
  );
  expect(
    await sendParticipantMessage({ sql, now }, creator, {
      applicationId: id,
      requestId: randomUUID(),
      body: "Cannot send",
    }),
  ).toMatchObject({ ok: false, code: "not_selected" });
  await sql.query(
    "update campaign_applications set status='rejected',reject_reason='Please revise the disclosure' where id=$1",
    [id],
  );
  expect(
    await sendParticipantMessage({ sql, now }, creator, {
      applicationId: id,
      requestId: randomUUID(),
      body: "Post correction",
    }),
  ).toMatchObject({ ok: true });
  await sql.query("update brand_projects set status='completed' where id=$1", [
    f.project,
  ]);
  expect((await loadParticipation({ sql, now }, creator, id))?.canWrite).toBe(
    false,
  );
  expect(
    await sendParticipantMessage({ sql, now }, creator, {
      applicationId: id,
      requestId: randomUUID(),
      body: "Cannot send after closure",
    }),
  ).toMatchObject({ ok: false, code: "not_open" });
});
it("rejects MIME spoofing, oversize and control/path filenames before storage", async () => {
  const storage = { putStaging: vi.fn(), read: vi.fn() },
    base = {
      applicationId: randomUUID(),
      requestId: randomUUID(),
      name: "brief.pdf",
      mime: "application/pdf",
      bytes: new TextEncoder().encode("Not a PDF"),
    };
  expect(
    await storeParticipantFile({ sql, now, storage }, creator, base),
  ).toMatchObject({ ok: false, code: "invalid" });
  expect(
    await storeParticipantFile({ sql, now, storage }, creator, {
      ...base,
      bytes: new Uint8Array(3000001),
    }),
  ).toMatchObject({ ok: false, code: "invalid" });
  expect(
    await storeParticipantFile({ sql, now, storage }, creator, {
      ...base,
      name: "../../file.pdf",
      bytes: new TextEncoder().encode("%PDF-test"),
    }),
  ).toMatchObject({ ok: false, code: "invalid" });
  expect(storage.putStaging).not.toHaveBeenCalled();
});
it("missing schema is graceful and studio thread reads leave an access purpose record", async () => {
  const unavailable = {
    query: async () => ({ rows: [{ ready: false }] }),
  } as unknown as SqlRunner;
  expect(
    await loadParticipation({ sql: unavailable }, creator, randomUUID()),
  ).toBeNull();
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  const id = idOf(
    await acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  );
  expect((await loadParticipation({ sql, now }, admin, id))?.role).toBe(
    "studio",
  );
  expect(
    (
      await sql.query(
        "select actor_id,purpose from campaign_participant_access_audit where application_id=$1",
        [id],
      )
    ).rows,
  ).toEqual([{ actor_id: adminId, purpose: "participant_support" }]);
});
it("enforces FORCE RLS and denies browser roles direct reads and writes", async () => {
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public to anon,authenticated,service_role;",
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/0132_glue_campaign_collaboration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const names = [
    "campaign_collaboration_links",
    "campaign_participant_invites",
    "campaign_participant_messages",
    "campaign_participant_files",
    "campaign_participant_access_audit",
  ];
  expect(
    (
      await sql.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname=any($1::text[])",
        [names],
      )
    ).rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
  ).toBe(true);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(
        sql.query("select * from campaign_participant_messages"),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  }
  await db.exec("set role service_role");
  try {
    expect(
      (await sql.query("select * from campaign_participant_messages")).rows,
    ).toBeInstanceOf(Array);
    await expect(
      sql.query("delete from campaign_participant_messages"),
    ).rejects.toThrow("permission denied");
  } finally {
    await db.exec("reset role");
  }
});
const admin = viewer(adminId),
  brand = viewer(brandId),
  creator = viewer(creatorId),
  other = viewer(otherId);
const now = new Date("2026-10-16T00:00:00Z");
const idOf = (r: { ok: boolean; id?: string; code?: string }) => {
  if (!r.ok || !r.id) throw Error(r.code);
  return r.id;
};
beforeAll(async () => {
  vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "on");
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, brandId, creatorId, otherId])
    await seedProfile(sql, { id, isAdmin: id === adminId });
});
afterAll(async () => {
  await db?.close();
  vi.unstubAllEnvs();
});
async function fixture() {
  const org = randomUUID(),
    project = randomUUID(),
    campaign = randomUUID(),
    slug = `collab-${campaign}`;
  await sql.query(
    "insert into brand_organizations(id,name,created_by,request_id) values($1,$2,$3,$4)",
    [org, "Test brand", adminId, randomUUID()],
  );
  await sql.query(
    "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [org, brandId],
  );
  await sql.query(
    "insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Test project','Test objective','creator','active',true,$3,$4)",
    [project, org, adminId, randomUUID()],
  );
  await sql.query(
    `insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots,applications_close_at,post_deadline_at,payout,published_at,media) values($1,$2,'recruiting',$3::jsonb,$3::jsonb,'Test brand',array['instagram'],1,'2026-10-20','2026-10-30',$4::jsonb,now(),'{"poster":{"bucket":"public-content","published_key":"test.jpg"}}')`,
    [
      campaign,
      slug,
      JSON.stringify({ en: "Test campaign", ko: "테스트 캠페인" }),
      JSON.stringify({
        model: "flat",
        flatCents: 30000,
        currency: "KRW",
        holdDays: 7,
      }),
    ],
  );
  expect(
    await bindCollaboration({ sql, now }, admin, {
      campaignId: campaign,
      projectId: project,
    }),
  ).toMatchObject({ ok: true });
  apply.termsVersion = (await campaignTermsVersion(sql, slug))!;
  return { org, project, campaign, slug };
}
const apply = {
  termsVersion: "",
  pitch: "I will make this campaign",
  snsUrl: "https://instagram.com/test",
  followerCount: 100,
  consent: true,
};
it("claims a hash-only invitation into applied without brand membership or mail, with immutable replay", async () => {
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
      email: "creator@example.com",
    });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(
    JSON.stringify(
      (
        await sql.query(
          "select * from campaign_participant_invites where id=$1",
          [r.id],
        )
      ).rows,
    ),
  ).not.toContain(r.token);
  expect(
    await acceptInvitation(
      { sql, now, verifiedEmail: "wrong@example.com" },
      creator,
      { token: r.token, slug: f.slug, ...apply },
    ),
  ).toMatchObject({ ok: false, code: "forbidden" });
  const input = { token: r.token, slug: f.slug, ...apply },
    accepted = await acceptInvitation(
      { sql, now, verifiedEmail: "creator@example.com" },
      creator,
      input,
    );
  const id = idOf(accepted);
  expect(
    (
      await sql.query("select status from campaign_applications where id=$1", [
        id,
      ])
    ).rows[0],
  ).toEqual({ status: "applied" });
  expect(
    await acceptInvitation(
      { sql, now, verifiedEmail: "creator@example.com" },
      creator,
      input,
    ),
  ).toMatchObject({ ok: true, id });
  expect(
    await acceptInvitation(
      { sql, now, verifiedEmail: "creator@example.com" },
      creator,
      { ...input, pitch: "Changed application payload" },
    ),
  ).toMatchObject({ ok: false, code: "conflict" });
  expect(
    await acceptInvitation(
      { sql, now, verifiedEmail: "creator@example.com" },
      other,
      input,
    ),
  ).toMatchObject({ ok: false, code: "not_found" });
  expect(
    (
      await sql.query("select * from brand_memberships where user_id=$1", [
        creatorId,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("enforces revocation, expiry, stopped projects and unavailable flags", async () => {
  const f = await fixture();
  const r = await issueInvitation({ sql, now }, brand, {
    campaignId: f.campaign,
    requestId: randomUUID(),
  });
  if (!r.ok) throw Error(r.code);
  expect(
    await acceptInvitation({ sql, now: new Date("2026-10-25") }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
  expect(
    await revokeInvitation({ sql, now }, brand, { invitationId: r.id }),
  ).toMatchObject({ ok: true });
  expect(
    await acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
  vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "off");
  expect(
    await loadParticipation({ sql, now }, creator, randomUUID()),
  ).toBeNull();
  vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "on");
});
it("isolates selected participant messages and files, checks duplicate payload and current membership", async () => {
  const f = await fixture();
  const r = await issueInvitation({ sql, now }, brand, {
    campaignId: f.campaign,
    requestId: randomUUID(),
  });
  if (!r.ok) throw Error(r.code);
  const applicationId = idOf(
    await acceptInvitation({ sql, now }, creator, {
      token: r.token,
      slug: f.slug,
      ...apply,
    }),
  );
  const requestId = randomUUID(),
    input = { applicationId, requestId, body: "Private participant message" };
  expect(
    await sendParticipantMessage({ sql, now }, creator, input),
  ).toMatchObject({ ok: false, code: "not_selected" });
  await sql.query(
    "update campaign_applications set status='selected',selected_at=now() where id=$1",
    [applicationId],
  );
  expect(
    await sendParticipantMessage({ sql, now }, creator, input),
  ).toMatchObject({ ok: true });
  expect(
    await sendParticipantMessage({ sql, now }, creator, input),
  ).toMatchObject({ ok: true });
  expect(
    await sendParticipantMessage({ sql, now }, creator, {
      ...input,
      body: "Different",
    }),
  ).toMatchObject({ ok: false, code: "conflict" });
  expect(
    await loadParticipation({ sql, now }, other, applicationId),
  ).toBeNull();
  expect(
    (await loadParticipation({ sql, now }, brand, applicationId))?.messages,
  ).toHaveLength(1);
  const objects = new Map<string, Uint8Array>(),
    storage = {
      putStaging: async (k: string, b: Uint8Array) => {
        objects.set(k, b);
      },
      read: async (_bucket: string, k: string) => objects.get(k)!,
    };
  const file = {
    applicationId,
    requestId: randomUUID(),
    name: "brief.pdf",
    mime: "application/pdf",
    bytes: new TextEncoder().encode("%PDF-1.7\nTest file"),
  };
  const uploaded = await storeParticipantFile(
    { sql, now, storage },
    brand,
    file,
  );
  const fileId = idOf(uploaded);
  expect(
    await storeParticipantFile({ sql, now, storage }, brand, file),
  ).toMatchObject({ ok: true, id: fileId });
  expect(
    await storeParticipantFile({ sql, now, storage }, brand, {
      ...file,
      bytes: new TextEncoder().encode("%PDF-1.7\nChanged"),
    }),
  ).toMatchObject({ ok: false, code: "conflict" });
  expect(
    await readParticipantFile({ sql, now, storage }, other, fileId),
  ).toBeNull();
  expect(
    (await readParticipantFile({ sql, now, storage }, creator, fileId))?.bytes,
  ).toEqual(file.bytes);
  expect(
    JSON.stringify(
      await loadParticipation({ sql, now }, creator, applicationId),
    ),
  ).not.toMatch(/storage_key|token_hash|creator@example|budget/);
  await expect(
    sql.query(
      "update campaign_participant_files set name='changed.pdf' where id=$1",
      [fileId],
    ),
  ).rejects.toThrow("immutable");
  await sql.query(
    "update brand_memberships set status='revoked' where organization_id=$1 and user_id=$2",
    [f.org, brandId],
  );
  expect(
    await loadParticipation({ sql, now }, brand, applicationId),
  ).toBeNull();
  expect(
    await readParticipantFile({ sql, now, storage }, brand, fileId),
  ).toBeNull();
});
it("retains immutable accepted terms including full brief after later campaign edits", async () => {
  const f = await fixture(),
    brief = { ko: "참여 안내 원문", en: "Original brief" };
  await sql.query("update campaigns set brief=$2::jsonb where id=$1", [
    f.campaign,
    JSON.stringify(brief),
  ]);
  const version = await campaignTermsVersion(sql, f.slug),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  idOf(
    await acceptInvitation({ sql, now }, creator, {
      ...apply,
      token: r.token,
      slug: f.slug,
      termsVersion: version,
    }),
  );
  await sql.query("update campaigns set brief=$2::jsonb where id=$1", [
    f.campaign,
    JSON.stringify({ ko: "변경", en: "Changed" }),
  ]);
  const saved = (
    await sql.query(
      "select accepted_terms_snapshot,accepted_terms_version from campaign_participant_invites where id=$1",
      [r.id],
    )
  ).rows[0]!;
  expect(
    (saved.accepted_terms_snapshot as Record<string, unknown>).brief,
  ).toEqual(brief);
  expect(saved.accepted_terms_version).toBe(version);
  expect(JSON.stringify(saved.accepted_terms_snapshot)).not.toMatch(
    /budget|creator_id|token/,
  );
  await expect(
    sql.query(
      "update campaign_participant_invites set accepted_terms_snapshot='{}' where id=$1",
      [r.id],
    ),
  ).rejects.toThrow("immutable");
  expect(
    await revokeInvitation({ sql, now }, brand, { invitationId: r.id }),
  ).toMatchObject({ ok: false, code: "conflict" });
  expect(
    (
      await sql.query(
        "select revoked_at from campaign_participant_invites where id=$1",
        [r.id],
      )
    ).rows[0]?.revoked_at,
  ).toBeNull();
});
it("gives explicit lost-token recovery while retaining only the original hash", async () => {
  const f = await fixture(),
    input = { campaignId: f.campaign, requestId: randomUUID() },
    first = await issueInvitation({ sql, now }, brand, input);
  if (!first.ok) throw Error(first.code);
  expect(await issueInvitation({ sql, now }, brand, input)).toEqual({
    ok: false,
    code: "invitation_retry",
  });
  expect(
    await revokeInvitation({ sql, now }, brand, { invitationId: first.id }),
  ).toMatchObject({ ok: true });
  const replacement = await issueInvitation({ sql, now }, brand, {
    ...input,
    requestId: randomUUID(),
  });
  expect(replacement.ok).toBe(true);
  if (!replacement.ok) return;
  expect(replacement.token).not.toBe(first.token);
  expect(
    await acceptInvitation({ sql, now }, creator, {
      ...apply,
      slug: f.slug,
      token: first.token,
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
});
it("releases SQL locks before upload and reauthorizes pending finalization", async () => {
  const f = await fixture(),
    r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
  if (!r.ok) throw Error(r.code);
  const applicationId = idOf(
    await acceptInvitation({ sql, now }, creator, {
      ...apply,
      slug: f.slug,
      token: r.token,
    }),
  );
  await sql.query(
    "update campaign_applications set status='selected' where id=$1",
    [applicationId],
  );
  let inTransaction = false,
    object: Uint8Array | undefined;
  const statements: string[] = [];
  const tracked = (base: SqlRunner): SqlRunner => ({
    query: async <T>(q: string, args?: unknown[]) => {
      statements.push(q);
      return base.query<T>(q, args);
    },
    transaction: (fn) =>
      base.transaction(async (tx) => {
        inTransaction = true;
        try {
          return await fn(tracked(tx));
        } finally {
          inTransaction = false;
        }
      }),
  });
  const storage = {
    putStaging: async (_key: string, bytes: Uint8Array) => {
      expect(inTransaction).toBe(false);
      if (object) throw Error("exists");
      object = bytes;
      await sql.query(
        "update brand_memberships set status='revoked' where organization_id=$1 and user_id=$2",
        [f.org, brandId],
      );
    },
    read: async () => object!,
  };
  const file = {
    applicationId,
    requestId: randomUUID(),
    name: "brief.pdf",
    mime: "application/pdf",
    bytes: new TextEncoder().encode("%PDF-immutable"),
  };
  expect(
    await storeParticipantFile(
      { sql: tracked(sql), now, storage },
      brand,
      file,
    ),
  ).toMatchObject({ ok: false, code: "not_found" });
  expect(
    (
      await sql.query(
        "select status from campaign_participant_files where request_id=$1",
        [file.requestId],
      )
    ).rows[0]?.status,
  ).toBe("pending");
  expect(
    (await loadParticipation({ sql, now }, creator, applicationId))?.files,
  ).toHaveLength(0);
  await sql.query(
    "update brand_memberships set status='active' where organization_id=$1 and user_id=$2",
    [f.org, brandId],
  );
  const done = await storeParticipantFile(
    { sql: tracked(sql), now, storage },
    brand,
    file,
  );
  expect(done.ok).toBe(true);
  const campaignLock = statements.findIndex(
      (q) => q.includes("select id from campaigns") && q.includes("for update"),
    ),
    applicationLock = statements.findIndex((q) =>
      q.includes("for share of a,l,p"),
    );
  expect(campaignLock).toBeGreaterThanOrEqual(0);
  expect(applicationLock).toBeGreaterThan(campaignLock);
  statements.length = 0;
  await loadParticipation({ sql: tracked(sql), now }, creator, applicationId);
  expect(statements.some((q) => /for (share|update)/i.test(q))).toBe(false);
});
it("loads anonymous invitation terms and hash in one lock-free statement", async () => {
  const f = await fixture();
  await sql.query("update campaigns set budget_cents=90909091 where id=$1", [
    f.campaign,
  ]);
  const queries: string[] = [];
  const tracked: SqlRunner = {
    query: async <T>(query: string, args?: unknown[]) => {
      queries.push(query);
      return sql.query<T>(query, args);
    },
    transaction: async () => {
      throw Error("anonymous snapshot must not open a transaction");
    },
  };
  const landing = await loadInvitationLanding(tracked, f.slug);
  expect(queries).toHaveLength(1);
  expect(queries[0]).not.toMatch(/for (share|update)/i);
  expect(landing?.version).toBe(await campaignTermsVersion(sql, f.slug));
  expect(landing?.campaign.slug).toBe(f.slug);
  expect(JSON.stringify(landing)).not.toMatch(/budget|90909091|creator_id/);
});
it.each(["declined", "withdrawn", "expired"])(
  "rejects a prior %s application without consuming the invitation",
  async (status) => {
    const f = await fixture(),
      applicationId = randomUUID();
    await sql.query(
      "insert into campaign_applications(id,campaign_id,creator_id,status,pitch,sns_url,follower_count) values($1,$2,$3,$4,$5,$6,10)",
      [
        applicationId,
        f.campaign,
        creatorId,
        status,
        "Original application",
        "https://instagram.com/original",
      ],
    );
    const invitation = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
    if (!invitation.ok) throw Error(invitation.code);
    expect(
      await acceptInvitation({ sql, now }, creator, {
        ...apply,
        token: invitation.token,
        slug: f.slug,
      }),
    ).toEqual({ ok: false, code: "application_ended" });
    expect(
      (
        await sql.query(
          "select accepted_at,accepted_by,application_id from campaign_participant_invites where id=$1",
          [invitation.id],
        )
      ).rows[0],
    ).toEqual({ accepted_at: null, accepted_by: null, application_id: null });
    expect(
      (
        await sql.query(
          "select status,pitch,sns_url from campaign_applications where id=$1",
          [applicationId],
        )
      ).rows[0],
    ).toEqual({
      status,
      pitch: "Original application",
      sns_url: "https://instagram.com/original",
    });
  },
);
it("denies owner DELETE of immutable collaboration records and removes inherited service grants", async () => {
  const tables = [
    "campaign_collaboration_links",
    "campaign_participant_invites",
    "campaign_participant_messages",
    "campaign_participant_files",
    "campaign_participant_access_audit",
  ];
  for (const table of tables) {
    const before = (
      await sql.query<{ n: number }>(`select count(*)::int n from ${table}`)
    ).rows[0]!.n;
    expect(before).toBeGreaterThan(0);
    await expect(sql.query(`delete from ${table}`)).rejects.toThrow(
      "immutable",
    );
    expect(
      (await sql.query<{ n: number }>(`select count(*)::int n from ${table}`))
        .rows[0]!.n,
    ).toBe(before);
    await db.exec(`grant all on ${table} to service_role`);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/0132_glue_campaign_collaboration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const table of tables) {
    const rights = (
      await sql.query<{ can_delete: boolean; can_select: boolean }>(
        "select has_table_privilege('service_role',$1,'DELETE') as can_delete,has_table_privilege('service_role',$1,'SELECT') as can_select",
        [table],
      )
    ).rows[0];
    expect(rights).toEqual({ can_delete: false, can_select: true });
  }
});
it("rejects unauthorized collaboration writes before acquiring campaign or membership row locks", async () => {
  const f = await fixture(),
    applicationId = randomUUID();
  await sql.query(
    "insert into campaign_applications(id,campaign_id,creator_id,status,pitch,sns_url,follower_count) values($1,$2,$3,'selected','Selected participant','https://instagram.com/selected',10)",
    [applicationId, f.campaign, creatorId],
  );
  const invitation = await issueInvitation({ sql, now }, brand, {
    campaignId: f.campaign,
    requestId: randomUUID(),
  });
  if (!invitation.ok) throw Error(invitation.code);
  const statements: string[] = [];
  const track = (base: SqlRunner): SqlRunner => ({
    query: async <T>(q: string, args?: unknown[]) => {
      statements.push(q);
      return base.query<T>(q, args);
    },
    transaction: (fn) => base.transaction((tx) => fn(track(tx))),
  });
  expect(
    await sendParticipantMessage({ sql: track(sql), now }, other, {
      applicationId,
      requestId: randomUUID(),
      body: "Not authorized",
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
  expect(statements.some((q) => /for (share|update)/i.test(q))).toBe(false);
  statements.length = 0;
  await sql.query(
    "update brand_memberships set role='viewer' where organization_id=$1 and user_id=$2",
    [f.org, brandId],
  );
  expect(
    await issueInvitation({ sql: track(sql), now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    }),
  ).toMatchObject({ ok: false, code: "forbidden" });
  expect(statements.some((q) => /for (share|update)/i.test(q))).toBe(false);
  statements.length = 0;
  expect(
    await revokeInvitation({ sql: track(sql), now }, brand, {
      invitationId: invitation.id,
    }),
  ).toMatchObject({ ok: false, code: "forbidden" });
  expect(statements.some((q) => /for (share|update)/i.test(q))).toBe(false);
});
it("refuses an influencer campaign's invitation until the account holds a verified 3,000+ SNS account", async () => {
  vi.stubEnv("TWINGS_INFLUENCERS", "on");
  try {
    const f = await fixture();
    await sql.query("update campaigns set audience='influencers' where id=$1", [
      f.campaign,
    ]);
    const r = await issueInvitation({ sql, now }, brand, {
      campaignId: f.campaign,
      requestId: randomUUID(),
    });
    if (!r.ok) throw Error(r.code);
    // A fresh account: the earlier cases in this file spend the creator's daily application budget.
    const freshId = randomUUID();
    await seedProfile(sql, { id: freshId });
    const accept = () =>
      acceptInvitation({ sql, now }, viewer(freshId), {
        token: r.token,
        slug: f.slug,
        ...apply,
      });
    expect(await accept()).toMatchObject({
      ok: false,
      code: "influencer_required",
    });
    await sql.query(
      "insert into social_accounts(user_id,platform,handle,profile_url,status,follower_count,measured_at) values($1,'instagram','hana','https://www.instagram.com/hana/','verified',3000,now()) on conflict (user_id,platform) do update set status='verified',follower_count=3000,measured_at=now()",
      [freshId],
    );
    expect(await accept()).toMatchObject({ ok: true });
  } finally {
    vi.unstubAllEnvs();
  }
});
