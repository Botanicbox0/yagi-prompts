import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
const names = [
  "guard_campaign_render_lineage",
  "lock_campaign_application_terms",
  "guard_campaign_accepted_payout",
  "guard_campaign_collaboration_binding",
  "guard_campaign_collaboration_immutable",
  "guard_campaign_risk_audit_immutable",
  "guard_campaign_funding_immutable",
  "guard_campaign_funding_scope",
];
const migration = () =>
  readFile(
    new URL(
      "../../supabase/migrations/0136_glue_campaign_trigger_search_path.sql",
      import.meta.url,
    ),
    "utf8",
  );
it("pins all eight invoker trigger functions without changing their ACL or security mode", async () => {
  const db = await freshDb();
  try {
    const before = (
      await db.query<{ proname: string; proacl: unknown }>(
        "select proname,proacl from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[]) order by proname",
        [names],
      )
    ).rows;
    await db.exec(await migration());
    const after = (
      await db.query<{
        proname: string;
        proacl: unknown;
        prosecdef: boolean;
        proconfig: string[];
      }>(
        "select proname,proacl,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[]) order by proname",
        [names],
      )
    ).rows;
    expect(after).toHaveLength(8);
    for (let i = 0; i < after.length; i++) {
      expect(after[i]?.prosecdef).toBe(false);
      expect(after[i]?.proacl).toEqual(before[i]?.proacl);
      expect(after[i]?.proconfig).toContain("search_path=public, pg_temp");
    }
  } finally {
    await db.close();
  }
});
it("keeps payout and application locks on public tables under an attacker-controlled caller path", async () => {
  const db = await freshDb();
  try {
    const sql = runner(db),
      campaignId = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    for (const id of [first, second]) await seedProfile(sql, { id });
    await sql.query(
      `insert into campaigns(id,slug,title,summary,host_name,platforms,slots,payout) values($1,$2,'{"ko":"테스트","en":"Test"}','{"ko":"안내","en":"Brief"}','Test brand',array['instagram'],10,'{"model":"flat","flatCents":20000}')`,
      [campaignId, `scope-${campaignId}`],
    );
    await sql.query(
      "insert into campaign_applications(id,campaign_id,creator_id,pitch,sns_url,follower_count) values($1,$2,$3,'Test participant','https://instagram.com/test',10)",
      [randomUUID(), campaignId, first],
    );
    await db.exec(
      "create schema shadow;create table shadow.campaign_applications(campaign_id uuid);create table shadow.campaigns(wrong_column uuid);set search_path=shadow,public;",
    );
    // Before hardening, a caller path can shadow the guard's application lookup.
    await sql.query(
      `update public.campaigns set payout='{"model":"flat","flatCents":21000}' where id=$1`,
      [campaignId],
    );
    await sql.query(
      `update public.campaigns set payout='{"model":"flat","flatCents":20000}' where id=$1`,
      [campaignId],
    );
    await db.exec(await migration());
    await expect(
      sql.query(
        `update public.campaigns set payout='{"model":"flat","flatCents":21000}' where id=$1`,
        [campaignId],
      ),
    ).rejects.toThrow("immutable after application");
    // The application trigger must use public.campaigns, not shadow.campaigns (which lacks id).
    await sql.query(
      "insert into public.campaign_applications(id,campaign_id,creator_id,pitch,sns_url,follower_count) values($1,$2,$3,'Second participant','https://instagram.com/second',10)",
      [randomUUID(), campaignId, second],
    );
    expect(
      (
        await sql.query<{ n: number }>(
          "select count(*)::int n from public.campaign_applications where campaign_id=$1",
          [campaignId],
        )
      ).rows[0]?.n,
    ).toBe(2);
  } finally {
    await db.close();
  }
});
