import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { Viewer } from "@/lib/auth/identity";
import { createFakeMailer } from "@/lib/notify/mailer-fake";
import {
  acceptInvitation,
  bindCollaboration,
  campaignTermsVersion,
  issueInvitation,
  loadProjectApplicants,
  revokeInvitation,
} from "@/lib/campaigns/collaboration/service";
import { loadVisibleCampaigns } from "@/lib/influencers/visibility";
import { notifyCampaignInvitation } from "@/lib/campaigns/notify";
import { loadCreatorPool, parsePoolQuery } from "@/lib/brands/creator-pool";

/**
 * docs/PLATFORM-2.0.md §17.3 — "invite to a campaign" from the creator pool: a campaign_targets row
 * plus the existing invitation, bound to that one account. Once per person per campaign, at most
 * min(slots × 5, 50) per campaign, accepted only by the invited account, mailed once to people who
 * keep campaign mail on. Selection stays with TWINGS.
 */
let db: PGlite, sql: SqlRunner;
const adminId = randomUUID(), ownerId = randomUUID(), viewerId = randomUUID(), creator = randomUUID(), other = randomUUID(), quiet = randomUUID(), unconsented = randomUUID();
const v = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, email: null, locale: "ko", tier: isAdmin ? "admin" : "free" });
const now = new Date("2026-10-23T00:00:00Z");
let org = "", project = "";
const accounts: Record<string, string> = {};
const APPLY = { pitch: "카페 리뷰를 꾸준히 올려요", snsUrl: "https://www.instagram.com/invited.one/", followerCount: 4200, consent: true };

async function account(userId: string, handle: string, consent = true) {
  const { rows } = await sql.query<{ id: string }>(
    "insert into social_accounts(user_id,platform,handle,profile_url,follower_count,status,measured_at,pool_consent_at) values($1,'instagram',$2,$3,4200,'verified',$4,$5) returning id",
    [userId, handle, `https://www.instagram.com/${handle}/`, now, consent ? now : null],
  );
  return rows[0]!.id;
}

async function campaign(slots = 3, audience = "invited") {
  const id = randomUUID();
  await sql.query(
    `insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots,applications_close_at,post_deadline_at,published_at,payout,audience)
     values($1,$2,'recruiting','{"en":"Fall","ko":"가을 신제품"}','{"en":"S","ko":"S"}','Brand',array['instagram'],$3,'2026-11-01','2026-11-15',now(),'{"model":"flat","flatCents":30000,"currency":"KRW","holdDays":7}',$4)`,
    [id, `designated-${id}`, slots, audience],
  );
  expect(await bindCollaboration({ sql, now }, v(adminId, true), { campaignId: id, projectId: project })).toMatchObject({ ok: true });
  return id;
}

const invite = (campaignId: string, socialAccountId: string, viewer = v(ownerId), requestId = randomUUID()) =>
  issueInvitation({ sql, now }, viewer, { campaignId, requestId, socialAccountId });

beforeAll(async () => {
  vi.stubEnv("CAMPAIGN_COLLABORATION_PUBLIC", "on");
  vi.stubEnv("TWINGS_INFLUENCERS", "on");
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, viewerId, creator, other, quiet, unconsented]) await seedProfile(sql, { id, isAdmin: id === adminId, locale: "ko" });
  await sql.query("update profiles set notif_updates=true where id in ($1,$2)", [creator, other]);
  org = randomUUID();
  project = randomUUID();
  await sql.query("insert into brand_organizations(id,name,created_by,request_id) values($1,'Brand',$2,$3)", [org, adminId, randomUUID()]);
  await sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')", [org, ownerId, viewerId]);
  await sql.query("insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Project','Objective','creator','active',true,$3,$4)", [project, org, adminId, randomUUID()]);
  accounts.creator = await account(creator, "invited.one");
  accounts.other = await account(other, "other.one");
  accounts.quiet = await account(quiet, "quiet.one");
  accounts.unconsented = await account(unconsented, "hidden.one", false);
});
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });

describe("invite from the creator pool", () => {
  it("names the account in campaign_targets and binds the invitation to it", async () => {
    const c = await campaign();
    const r = await invite(c, accounts.creator!);
    expect(r).toMatchObject({ ok: true, invitee: creator });
    const target = (await sql.query<{ invited_by: string }>("select invited_by from campaign_targets where campaign_id=$1 and user_id=$2", [c, creator])).rows[0];
    expect(target?.invited_by).toBe(ownerId);
    const row = (await sql.query<{ invited_user_id: string; email: string | null }>("select invited_user_id,email from campaign_participant_invites where campaign_id=$1", [c])).rows[0]!;
    expect(row).toEqual({ invited_user_id: creator, email: null });
  });

  it("is idempotent per request and refuses the same person twice", async () => {
    const c = await campaign();
    const requestId = randomUUID();
    expect(await invite(c, accounts.creator!, v(ownerId), requestId)).toMatchObject({ ok: true });
    expect(await invite(c, accounts.creator!, v(ownerId), requestId)).toMatchObject({ ok: false, code: "invitation_retry" });
    expect(await invite(c, accounts.creator!)).toMatchObject({ ok: false, code: "conflict" });
    expect((await sql.query<{ n: number }>("select count(*)::int n from campaign_participant_invites where campaign_id=$1", [c])).rows[0]!.n).toBe(1);
  });

  it("stops at min(slots × 5, 50) invitations per campaign", async () => {
    const c = await campaign(1);
    const extra: string[] = [];
    for (let i = 0; i < 5; i++) {
      const user = randomUUID();
      await seedProfile(sql, { id: user });
      extra.push(await account(user, `cap.${i}`));
    }
    for (const id of extra) expect(await invite(c, id)).toMatchObject({ ok: true });
    expect(await invite(c, accounts.other!)).toMatchObject({ ok: false, code: "invite_limit" });
  });

  it("only invites people in the pool, and only as an owner or editor", async () => {
    const c = await campaign();
    expect(await invite(c, accounts.unconsented!)).toMatchObject({ ok: false, code: "not_found" });
    expect(await invite(c, randomUUID())).toMatchObject({ ok: false, code: "not_found" });
    expect(await invite(c, accounts.creator!, v(viewerId))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await invite(c, accounts.creator!, v(adminId, true))).toMatchObject({ ok: false, code: "forbidden" });
    vi.stubEnv("TWINGS_INFLUENCERS", "off");
    try {
      expect(await invite(c, accounts.creator!)).toMatchObject({ ok: false, code: "unavailable" });
    } finally {
      vi.stubEnv("TWINGS_INFLUENCERS", "on");
    }
  });

  it("lets only the invited account accept, and shows the campaign to that account alone", async () => {
    const c = await campaign();
    const r = await invite(c, accounts.creator!);
    if (!r.ok) throw Error(r.code);
    const termsVersion = (await campaignTermsVersion(sql, `designated-${c}`))!;
    const slug = `designated-${c}`;
    expect(await acceptInvitation({ sql, now }, v(other), { ...APPLY, token: r.token, slug, termsVersion })).toMatchObject({ ok: false, code: "wrong_account" });
    expect((await acceptInvitation({ sql, now }, v(creator), { ...APPLY, token: r.token, slug, termsVersion })).ok).toBe(true);
    const mine = await loadVisibleCampaigns(sql, creator);
    expect(mine.forYou.map((x) => x.row.id)).toContain(c);
    const theirs = await loadVisibleCampaigns(sql, other);
    expect([...theirs.forYou, ...theirs.public].map((x) => x.row.id)).not.toContain(c);
  });

  it("revoking takes the person off the campaign and allows a fresh invitation", async () => {
    const c = await campaign();
    const r = await invite(c, accounts.other!);
    if (!r.ok) throw Error(r.code);
    expect(await revokeInvitation({ sql, now }, v(ownerId), { invitationId: r.id })).toMatchObject({ ok: true });
    expect((await sql.query("select 1 from campaign_targets where campaign_id=$1 and user_id=$2", [c, other])).rows).toHaveLength(0);
    expect(await invite(c, accounts.other!)).toMatchObject({ ok: true });
  });

  it("shows invited people in the applicants tab and in the pool", async () => {
    const c = await campaign();
    const r = await invite(c, accounts.quiet!);
    if (!r.ok) throw Error(r.code);
    const view = await loadProjectApplicants({ sql, now }, v(ownerId), project);
    const entry = view!.campaigns.find((x) => x.id === c)!;
    expect(entry.invited).toEqual([expect.objectContaining({ id: r.id, handle: "quiet.one", platform: "instagram", status: "pending" })]);
    expect(JSON.stringify(entry.invited)).not.toContain(quiet);
    const pool = await loadCreatorPool({ sql, now }, v(ownerId), org, parsePoolQuery({ q: "quiet" }));
    if (pool.state !== "open") throw Error(pool.state);
    expect(pool.cards[0]!.invitedTo).toContain(c);
    expect(pool.campaigns.find((x) => x.id === c)!.invited).toBe(1);
  });

  it("marks an applicant who came through an invitation", async () => {
    const c = await campaign(3, "public");
    const r = await invite(c, accounts.creator!);
    if (!r.ok) throw Error(r.code);
    const termsVersion = (await campaignTermsVersion(sql, `designated-${c}`))!;
    expect((await acceptInvitation({ sql, now }, v(creator), { ...APPLY, token: r.token, slug: `designated-${c}`, termsVersion })).ok).toBe(true);
    const entry = (await loadProjectApplicants({ sql, now }, v(ownerId), project))!.campaigns.find((x) => x.id === c)!;
    expect(entry.applicants[0]).toMatchObject({ invited: true, status: "applied" });
    expect(entry.invited[0]).toMatchObject({ status: "accepted" });
  });
});

describe("invitation mail", () => {
  it("mails the invited person once when campaign mail is on, never when it is off", async () => {
    const c = await campaign();
    const mailer = createFakeMailer();
    const deps = { sql, mailer, siteUrl: "https://twings.app/" };
    const r = await invite(c, accounts.creator!);
    if (!r.ok) throw Error(r.code);
    const first = await notifyCampaignInvitation(deps, { campaignId: c, userId: creator, invitationId: r.id, token: r.token });
    expect(first?.ok).toBe(true);
    await notifyCampaignInvitation(deps, { campaignId: c, userId: creator, invitationId: r.id, token: r.token });
    expect(mailer.sent).toHaveLength(2);
    expect(new Set(mailer.sent.map((m) => m.idempotencyKey)).size).toBe(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe(`${creator}@playbook.test`);
    expect(mail.subject).toContain("가을 신제품");
    expect(mail.text).toContain(`https://twings.app/campaigns/designated-${c}/join#token=${r.token}`);
    expect(mail.unsubscribeUrl).toContain("/api/notify/unsubscribe?t=");

    const q = await invite(c, accounts.quiet!);
    if (!q.ok) throw Error(q.code);
    expect(await notifyCampaignInvitation(deps, { campaignId: c, userId: quiet, invitationId: q.id, token: q.token })).toBeNull();
    expect(mailer.sent).toHaveLength(2);
  });
});
