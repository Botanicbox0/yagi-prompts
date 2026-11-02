import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { it, expect } from "vitest";
import { applyCoreMigrations } from "@/lib/db/migrations";

it("removes inherited DELETE/TRUNCATE while keeping production server reads and writes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);
   create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   grant usage on schema public to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
    await applyCoreMigrations(db);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/0130_glue_campaign_production.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const privileges = async (table: string) =>
      (
        await db.query<{
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          can_truncate: boolean;
          can_references: boolean;
          can_trigger: boolean;
        }>(
          `select
   has_table_privilege('service_role',$1,'SELECT') as can_select,
   has_table_privilege('service_role',$1,'INSERT') as can_insert,
   has_table_privilege('service_role',$1,'UPDATE') as can_update,
   has_table_privilege('service_role',$1,'DELETE') as can_delete,
   has_table_privilege('service_role',$1,'TRUNCATE') as can_truncate,
   has_table_privilege('service_role',$1,'REFERENCES') as can_references,
   has_table_privilege('service_role',$1,'TRIGGER') as can_trigger`,
          [table],
        )
      ).rows[0];
    for (const table of ["campaign_productions", "campaign_render_jobs"])
      expect(await privileges(table)).toMatchObject({
        can_delete: true,
        can_truncate: true,
      });
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/0135_glue_campaign_production_least_privilege.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const table of ["campaign_productions", "campaign_render_jobs"])
      expect(await privileges(table)).toEqual({
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      });
    await db.exec("set role service_role");
    expect((await db.query("select * from campaign_productions")).rows).toEqual(
      [],
    );
    await db.query(
      "update campaign_productions set enabled=enabled where false",
    );
    await db.query(
      "update campaign_render_jobs set dispatch_attempt=dispatch_attempt where false",
    );
    await expect(
      db.query("delete from campaign_render_jobs where false"),
    ).rejects.toThrow("permission denied");
    await expect(db.query("truncate campaign_render_jobs")).rejects.toThrow(
      "permission denied",
    );
    await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(
        db.query("select * from campaign_productions"),
      ).rejects.toThrow("permission denied");
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});
