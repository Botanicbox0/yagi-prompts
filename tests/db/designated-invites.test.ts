import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { readMigration } from "@/lib/db/migrations";
import { seedProfile } from "@/tests/helpers/billing";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * 0058 — docs/PLATFORM-2.0.md §17.3. An invitation can name the one account allowed to accept it.
 * The name is as immutable as the rest of the invitation, and one person has at most one live
 * (unrevoked) named invitation per campaign.
 */
let db: PGlite, sql: SqlRunner;
const creator = randomUUID(), brand = randomUUID();
let campaign = "";
const insert = (invitedUserId: string | null) =>
  sql.query(
    "insert into campaign_participant_invites(id,campaign_id,token_hash,created_by,request_id,expires_at,invited_user_id) values($1,$2,$3,$4,$5,'2026-11-01',$6) returning id",
    [randomUUID(), campaign, randomUUID().replace(/-/g, "").padEnd(64, "0"), brand, randomUUID(), invitedUserId],
  ).then((r) => String(r.rows[0]!.id));

beforeAll(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [creator, brand]) await seedProfile(sql, { id });
  const org = randomUUID(), project = randomUUID();
  campaign = randomUUID();
  await sql.query("insert into brand_organizations(id,name,created_by,request_id) values($1,'Brand',$2,$3)", [org, brand, randomUUID()]);
  await sql.query("insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Project','Objective','creator','active',true,$3,$4)", [project, org, brand, randomUUID()]);
  await sql.query(`insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots,applications_close_at,post_deadline_at,published_at,payout) values($1,$2,'recruiting','{"en":"C","ko":"C"}','{"en":"S","ko":"S"}','B',array['instagram'],3,'2026-11-01','2026-11-15',now(),'{"model":"flat","flatCents":30000,"currency":"KRW","holdDays":7}')`, [campaign, `schema-${campaign}`]);
  await sql.query("insert into campaign_collaboration_links(campaign_id,project_id,created_by) values($1,$2,$3)", [campaign, project, brand]);
});
afterAll(async () => db?.close());

describe("0058 designated invitations", () => {
  it("is marked for cloud application and only adds to the invitations table", () => {
    const text = readMigration("0058_core_campaign_designated_invites.sql");
    expect(text).toMatch(/CLOUD APPLICATION REQUIRED/);
    expect(text).toMatch(/invited_user_id/);
    expect(text).not.toMatch(/drop table|drop column/i);
  });

  it("keeps the named account immutable", async () => {
    const id = await insert(creator);
    await expect(sql.query("update campaign_participant_invites set invited_user_id=null where id=$1", [id])).rejects.toThrow(/immutable/);
    await expect(sql.query("update campaign_participant_invites set invited_user_id=$2 where id=$1", [id, brand])).rejects.toThrow(/immutable/);
  });

  it("allows one live named invitation per person and campaign, and a new one after revoking", async () => {
    const first = await insert(brand);
    await expect(insert(brand)).rejects.toThrow(/duplicate|unique/i);
    await sql.query("update campaign_participant_invites set revoked_at=now() where id=$1", [first]);
    expect(await insert(brand)).toBeTruthy();
    // Unnamed links are unaffected.
    await insert(null);
    await insert(null);
  });
});
