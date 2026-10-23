import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { Viewer } from "@/lib/auth/identity";
import { bindCollaboration } from "@/lib/campaigns/collaboration/service";
import { compactFollowers, inviteCap, loadCreatorPool, parsePoolQuery, poolBandOf, roundedFollowers } from "@/lib/brands/creator-pool";

/**
 * docs/PLATFORM-2.0.md §16.5·§17.3 — the creator pool a brand sees: verified 3,000+ accounts whose
 * owner ticked the pool box, shown as handle, platform, a follower band rounded to 1,000 and the
 * last check date. Never the account, a contact, a real name, the exact count or the profile link.
 * Owners and editors only; closed while TWINGS_INFLUENCERS is off.
 */
let db: PGlite, sql: SqlRunner;
const adminId = randomUUID(), ownerId = randomUUID(), editorId = randomUUID(), viewerId = randomUUID(), strangerId = randomUUID();
const people = { hana: randomUUID(), mina: randomUUID(), jun: randomUUID(), small: randomUUID(), shy: randomUUID(), waiting: randomUUID(), gone: randomUUID() };
const v = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, email: null, locale: "ko", tier: isAdmin ? "admin" : "free" });
const now = new Date("2026-10-23T00:00:00Z");
let org = "", project = "", campaign = "", closedCampaign = "", otherOrgCampaign = "";

async function account(userId: string, platform: string, handle: string, followers: number | null, status: string, consent: boolean) {
  const url = platform === "instagram" ? `https://www.instagram.com/${handle}/` : platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.youtube.com/@${handle}`;
  await sql.query(
    `insert into social_accounts(user_id,platform,handle,profile_url,follower_count,claimed_count,status,measured_at,note,pool_consent_at)
     values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)`,
    [userId, platform, handle, url, followers, status, status === "verified" || status === "expired" ? "2026-10-20T03:00:00Z" : null, status === "rejected" ? "blurry" : null, consent ? now : null],
  );
}

async function campaignFor(projectId: string, status: string, close: string, slots = 3) {
  const id = randomUUID();
  await sql.query(
    `insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots,applications_close_at,post_deadline_at,published_at,payout,audience)
     values($1,$2,$3,'{"en":"Fall","ko":"가을"}','{"en":"S","ko":"S"}','Brand',array['instagram'],$4,$5,'2026-12-15',now(),'{"model":"flat","flatCents":30000,"currency":"KRW","holdDays":7}','invited')`,
    [id, `pool-${id}`, status, slots, close],
  );
  expect(await bindCollaboration({ sql, now }, v(adminId, true), { campaignId: id, projectId })).toMatchObject({ ok: true });
  return id;
}

beforeAll(async () => {
  vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "on");
  vi.stubEnv("TWINGS_INFLUENCERS", "on");
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, editorId, viewerId, strangerId, ...Object.values(people)]) await seedProfile(sql, { id, isAdmin: id === adminId });
  await sql.query("update profiles set display_name='Hana Kim' where id=$1", [people.hana]).catch(() => undefined);
  org = randomUUID();
  project = randomUUID();
  await sql.query("insert into brand_organizations(id,name,created_by,request_id) values($1,'Brand',$2,$3)", [org, adminId, randomUUID()]);
  await sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'editor'),($1,$4,'viewer')", [org, ownerId, editorId, viewerId]);
  await sql.query("insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Project','Objective','creator','active',true,$3,$4)", [project, org, adminId, randomUUID()]);
  campaign = await campaignFor(project, "recruiting", "2026-11-01");
  closedCampaign = await campaignFor(project, "selecting", "2026-10-01");
  const otherOrg = randomUUID(), otherProject = randomUUID();
  await sql.query("insert into brand_organizations(id,name,created_by,request_id) values($1,'Other',$2,$3)", [otherOrg, adminId, randomUUID()]);
  await sql.query("insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Other','Objective','creator','active',true,$3,$4)", [otherProject, otherOrg, adminId, randomUUID()]);
  otherOrgCampaign = await campaignFor(otherProject, "recruiting", "2026-11-01");

  await account(people.hana, "instagram", "hana.daily", 3240, "verified", true);
  await account(people.hana, "tiktok", "hana.dance", 12_800, "verified", true);
  await account(people.mina, "youtube", "mina-cooks", 125_400, "verified", true);
  await account(people.jun, "tiktok", "jun.walks", 58_499, "verified", true);
  await account(people.small, "instagram", "small.one", 2_999, "verified", true); // under the line
  await account(people.shy, "instagram", "shy.one", 40_000, "verified", false); // no pool consent
  await account(people.waiting, "instagram", "waiting.one", null, "submitted", true); // not checked yet
  await account(people.gone, "instagram", "gone.one", 9_000, "expired", true); // re-measured away
  await account(people.gone, "tiktok", "gone.two", null, "rejected", true);
});
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });

describe("follower bands", () => {
  it("rounds to the nearest thousand and writes it short", () => {
    expect(roundedFollowers(3240)).toBe(3000);
    expect(roundedFollowers(3500)).toBe(4000);
    expect(roundedFollowers(12_800)).toBe(13_000);
    expect(roundedFollowers(125_400)).toBe(125_000);
    expect(compactFollowers(3000, "ko")).toBe("3천");
    expect(compactFollowers(13_000, "ko")).toBe("1.3만");
    expect(compactFollowers(125_000, "ko")).toBe("12.5만");
    expect(compactFollowers(1_250_000, "ko")).toBe("125만");
    expect(compactFollowers(3000, "en")).toBe("3K");
    expect(compactFollowers(125_000, "en")).toBe("125K");
    expect(compactFollowers(1_250_000, "en")).toBe("1.25M");
    expect(poolBandOf(3000)).toBe("3k-10k");
    expect(poolBandOf(10_000)).toBe("10k-50k");
    expect(poolBandOf(58_000)).toBe("50k-100k");
    expect(poolBandOf(125_000)).toBe("100k+");
  });

  it("caps invitations at five per slot, never more than fifty", () => {
    expect(inviteCap(3)).toBe(15);
    expect(inviteCap(10)).toBe(50);
    expect(inviteCap(20)).toBe(50);
    expect(inviteCap(0)).toBe(0);
  });

  it("reads the filters defensively", () => {
    expect(parsePoolQuery({ q: " @Hana.Daily ", platform: "tiktok", band: "10k-50k" })).toEqual({ q: "hana.daily", platform: "tiktok", band: "10k-50k" });
    expect(parsePoolQuery({ q: ["a", "b"], platform: "facebook", band: "huge" })).toEqual({ q: "", platform: null, band: null });
    expect(parsePoolQuery({ q: "x".repeat(80) }).q).toHaveLength(30);
    // Only handle characters survive; `_` stays because handles use it (the search is not a LIKE).
    expect(parsePoolQuery({ q: "%_\\'" }).q).toBe("_");
  });
});

describe("creator pool", () => {
  it("lists consenting verified 3,000+ accounts only, with a rounded band and nothing personal", async () => {
    const pool = await loadCreatorPool({ sql, now }, v(ownerId), org, parsePoolQuery({}));
    expect(pool.state).toBe("open");
    if (pool.state !== "open") return;
    expect(pool.cards.map((c) => c.handle).sort()).toEqual(["hana.daily", "hana.dance", "jun.walks", "mina-cooks"]);
    const hana = pool.cards.find((c) => c.handle === "hana.daily")!;
    expect(hana).toMatchObject({ platform: "instagram", followers: 3000, checkedOn: "2026-10-20" });
    expect(pool.cards.find((c) => c.handle === "jun.walks")!.followers).toBe(58_000);
    // Canary: no account id, profile link, email, name or exact number in what the page receives.
    const raw = JSON.stringify(pool);
    for (const secret of [...Object.values(people), "instagram.com/", "tiktok.com/", "youtube.com/", "@playbook.test", "Hana Kim", "3240", "12800", "125400", "58499"]) expect(raw).not.toContain(secret);
    for (const key of ["user_id", "userId", "profile_url", "profileUrl", "email", "display_name", "follower_count", "claimed_count", "evidence"]) expect(raw).not.toContain(`"${key}"`);
  });

  it("offers the brand's own recruiting campaigns with their invitation cap", async () => {
    const pool = await loadCreatorPool({ sql, now }, v(editorId), org, parsePoolQuery({}));
    if (pool.state !== "open") throw Error(pool.state);
    expect(pool.canInvite).toBe(true);
    expect(pool.campaigns.map((c) => c.id)).toEqual([campaign]);
    expect(pool.campaigns[0]).toMatchObject({ slots: 3, invited: 0, cap: 15 });
    expect(pool.campaigns.map((c) => c.id)).not.toContain(closedCampaign);
    expect(pool.campaigns.map((c) => c.id)).not.toContain(otherOrgCampaign);
  });

  it("searches by handle and filters by platform and band", async () => {
    const by = async (search: Record<string, string>) => {
      const pool = await loadCreatorPool({ sql, now }, v(ownerId), org, parsePoolQuery(search));
      if (pool.state !== "open") throw Error(pool.state);
      return pool.cards.map((c) => c.handle).sort();
    };
    expect(await by({ q: "@hana" })).toEqual(["hana.daily", "hana.dance"]);
    expect(await by({ q: "DANCE" })).toEqual(["hana.dance"]);
    expect(await by({ platform: "tiktok" })).toEqual(["hana.dance", "jun.walks"]);
    expect(await by({ band: "3k-10k" })).toEqual(["hana.daily"]);
    expect(await by({ band: "100k+" })).toEqual(["mina-cooks"]);
    expect(await by({ platform: "tiktok", band: "50k-100k" })).toEqual(["jun.walks"]);
    expect(await by({ q: "nobody" })).toEqual([]);
  });

  it("is for owners and editors of that brand only", async () => {
    expect((await loadCreatorPool({ sql, now }, v(viewerId), org, parsePoolQuery({}))).state).toBe("forbidden");
    expect((await loadCreatorPool({ sql, now }, v(strangerId), org, parsePoolQuery({}))).state).toBe("forbidden");
    expect((await loadCreatorPool({ sql, now }, v(adminId, true), org, parsePoolQuery({}))).state).toBe("forbidden");
    expect((await loadCreatorPool({ sql, now }, v(ownerId), "not-a-uuid", parsePoolQuery({}))).state).toBe("forbidden");
    expect((await loadCreatorPool({ sql, now }, { ...v(ownerId), userId: null }, org, parsePoolQuery({}))).state).toBe("forbidden");
  });

  it("is closed while TWINGS_INFLUENCERS is off", async () => {
    expect((await loadCreatorPool({ sql, now, env: { TWINGS_INFLUENCERS: "off" } }, v(ownerId), org, parsePoolQuery({}))).state).toBe("closed");
  });

  it("lists but does not invite while campaign collaboration is closed", async () => {
    const pool = await loadCreatorPool({ sql, now, env: { TWINGS_INFLUENCERS: "on", CAMPAIGN_COLLABORATION_PUBLIC: "off" } }, v(ownerId), org, parsePoolQuery({}));
    if (pool.state !== "open") throw Error(pool.state);
    expect(pool.cards.length).toBe(4);
    expect(pool.canInvite).toBe(false);
  });
});
