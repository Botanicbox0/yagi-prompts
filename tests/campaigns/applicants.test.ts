import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { Viewer } from "@/lib/auth/identity";
import { bindCollaboration, loadProjectApplicants, setApplicantPreference } from "@/lib/campaigns/collaboration/service";

/**
 * docs/PLATFORM-2.0.md §16.4 — the brand sees who applied (applied included) and may mark a
 * preference. Selection stays with TWINGS: nothing here changes an application's status.
 */
let db: PGlite, sql: SqlRunner;
const adminId = randomUUID(), ownerId = randomUUID(), viewerId = randomUUID(), creatorA = randomUUID(), creatorB = randomUUID(), strangerId = randomUUID();
const v = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, email: null, locale: "ko", tier: isAdmin ? "admin" : "free" });
const now = new Date("2026-10-23T00:00:00Z");

beforeAll(async () => {
  vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "on");
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, viewerId, creatorA, creatorB, strangerId]) await seedProfile(sql, { id, isAdmin: id === adminId });
});
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });

async function fixture(status = "active") {
  const org = randomUUID(), project = randomUUID(), campaign = randomUUID();
  await sql.query("insert into brand_organizations(id,name,created_by,request_id) values($1,'Brand',$2,$3)", [org, adminId, randomUUID()]);
  await sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')", [org, ownerId, viewerId]);
  await sql.query("insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Project','Objective','creator',$3,true,$4,$5)", [project, org, status, adminId, randomUUID()]);
  await sql.query(
    `insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots,applications_close_at,post_deadline_at,published_at,payout) values($1,$2,'recruiting','{"en":"C","ko":"C"}','{"en":"S","ko":"S"}','Brand',array['instagram'],3,'2026-11-01','2026-11-15',now(),'{"model":"flat","flatCents":30000,"currency":"KRW","holdDays":7}')`,
    [campaign, `applicants-${campaign}`],
  );
  expect(await bindCollaboration({ sql, now }, v(adminId, true), { campaignId: campaign, projectId: project })).toMatchObject({ ok: true });
  const applied = randomUUID(), picked = randomUUID();
  await sql.query(`insert into campaign_applications(id,campaign_id,creator_id,status,pitch,sns_url,follower_count) values($1,$2,$3,'applied','성수동 카페 리뷰를 꾸준히 올려요','https://www.instagram.com/creator.a/',4200)`, [applied, campaign, creatorA]);
  await sql.query(`insert into campaign_applications(id,campaign_id,creator_id,status,pitch,sns_url,follower_count,selected_at,post_url,posted_at,views_snapshot,metrics_source) values($1,$2,$3,'posted','pitch','https://www.tiktok.com/@creator.b',9100,now(),'https://www.tiktok.com/@creator.b/video/1',now(),12000,'self')`, [picked, campaign, creatorB]);
  return { project, campaign, applied, picked };
}

describe("project applicants", () => {
  it("shows applied applications with handle, platform, self-reported followers, profile and message", async () => {
    const f = await fixture();
    const view = await loadProjectApplicants({ sql, now }, v(ownerId), f.project);
    expect(view?.canPrefer).toBe(true);
    const list = view!.campaigns[0]!.applicants;
    const applied = list.find((a) => a.id === f.applied)!;
    expect(applied).toMatchObject({ status: "applied", handle: "creator.a", platform: "instagram", followers: 4200, followersSource: "self", profileUrl: "https://www.instagram.com/creator.a/", pitch: "성수동 카페 리뷰를 꾸준히 올려요", preferred: false, postUrl: null });
    const posted = list.find((a) => a.id === f.picked)!;
    expect(posted).toMatchObject({ handle: "creator.b", platform: "tiktok", postUrl: "https://www.tiktok.com/@creator.b/video/1", views: 12000, metricsSource: "self" });
    // Never the creator's account, email or the internal payout fields.
    const raw = JSON.stringify(view);
    for (const secret of [creatorA, creatorB, "creator_id", "payout", "@example"]) expect(raw).not.toContain(secret);
  });

  it("lets an owner mark and unmark a preference without selecting anyone", async () => {
    const f = await fixture();
    expect(await setApplicantPreference({ sql, now }, v(ownerId), { applicationId: f.applied, preferred: true })).toMatchObject({ ok: true });
    const row = (await sql.query<{ status: string; brand_preferred_at: Date | null }>("select status,brand_preferred_at from campaign_applications where id=$1", [f.applied])).rows[0]!;
    expect(row.status).toBe("applied");
    expect(new Date(row.brand_preferred_at!).toISOString()).toBe(now.toISOString());
    expect((await loadProjectApplicants({ sql, now }, v(ownerId), f.project))!.campaigns[0]!.applicants.find((a) => a.id === f.applied)!.preferred).toBe(true);
    expect(await setApplicantPreference({ sql, now }, v(ownerId), { applicationId: f.applied, preferred: false })).toMatchObject({ ok: true });
    expect((await sql.query("select brand_preferred_at from campaign_applications where id=$1", [f.applied])).rows[0]!.brand_preferred_at).toBeNull();
  });

  it("refuses the preference to viewers, strangers, the TWINGS team and settled applications", async () => {
    const f = await fixture();
    expect((await loadProjectApplicants({ sql, now }, v(viewerId), f.project))?.canPrefer).toBe(false);
    expect(await setApplicantPreference({ sql, now }, v(viewerId), { applicationId: f.applied, preferred: true })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await setApplicantPreference({ sql, now }, v(strangerId), { applicationId: f.applied, preferred: true })).toMatchObject({ ok: false, code: "not_found" });
    expect(await loadProjectApplicants({ sql, now }, v(strangerId), f.project)).toBeNull();
    expect(await setApplicantPreference({ sql, now }, v(adminId, true), { applicationId: f.applied, preferred: true })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await setApplicantPreference({ sql, now }, v(ownerId), { applicationId: f.picked, preferred: true })).toMatchObject({ ok: false, code: "conflict" });
    expect(await setApplicantPreference({ sql, now }, v(ownerId), { applicationId: f.applied, preferred: "yes" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses a preference on a campaign that is not active", async () => {
    const f = await fixture("completed");
    expect((await loadProjectApplicants({ sql, now }, v(ownerId), f.project))?.canPrefer).toBe(false);
    expect(await setApplicantPreference({ sql, now }, v(ownerId), { applicationId: f.applied, preferred: true })).toMatchObject({ ok: false, code: "not_open" });
  });

  it("is closed while the collaboration flag is off", async () => {
    const f = await fixture();
    vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "off");
    try {
      expect(await loadProjectApplicants({ sql, now }, v(ownerId), f.project)).toBeNull();
      expect(await setApplicantPreference({ sql, now }, v(ownerId), { applicationId: f.applied, preferred: true })).toMatchObject({ ok: false, code: "unavailable" });
    } finally {
      vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "on");
    }
  });
});
