import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { readMigration } from "@/lib/db/migrations";
import type { SqlRunner } from "@/lib/db/sql-runner";

/** 0123: browser roles get nothing; the server role gets select/insert and only the listed column updates. */
describe("brand usage database boundary", () => {
  let db: PGlite, sql: SqlRunner;
  beforeEach(async () => {
    db = await freshDb(); sql = runner(db);
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
    await db.exec(readMigration("0123_glue_brand_usage_licensing.sql"));
  });
  afterEach(async () => db?.close());
  const can = async (role: string, table: string, privilege: string) =>
    (await sql.query<{ allowed: boolean }>("select has_table_privilege($1,$2,$3) as allowed", [role, table, privilege])).rows[0]!.allowed;
  const canColumn = async (table: string, column: string) =>
    (await sql.query<{ allowed: boolean }>("select has_column_privilege('service_role',$1,$2,'UPDATE') as allowed", [table, column])).rows[0]!.allowed;
  it("forces RLS and denies every browser role", async () => {
    const tables = (await sql.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relname,relrowsecurity,relforcerowsecurity from pg_class where relkind='r' and relname like 'brand_usage_%'")).rows;
    expect(tables).toHaveLength(13);
    for (const t of tables) {
      expect(t.relrowsecurity && t.relforcerowsecurity, t.relname).toBe(true);
      for (const role of ["anon", "authenticated"]) expect(await can(role, t.relname, "SELECT,INSERT,UPDATE,DELETE"), `${role} ${t.relname}`).toBe(false);
      expect(await can("service_role", t.relname, "DELETE"), t.relname).toBe(false);
      expect(await can("service_role", t.relname, "SELECT") && await can("service_role", t.relname, "INSERT"), t.relname).toBe(true);
    }
  });
  it("lets the server role update only status-like columns, never an amount, scope or consent basis", async () => {
    for (const [table, column] of [["brand_usage_quotes", "total_krw"], ["brand_usage_quotes", "consent_ids"], ["brand_usage_payments", "amount_krw"], ["brand_usage_payments", "quote_id"],
      ["brand_usage_compensations", "amount_krw"], ["brand_usage_consents", "scope_sha256"], ["brand_usage_scope_revisions", "scope"], ["brand_usage_grants", "quote_id"], ["brand_usage_outcomes", "total_krw"]])
      expect(await canColumn(table!, column!), `${table}.${column}`).toBe(false);
    for (const [table, column] of [["brand_usage_cases", "status"], ["brand_usage_quotes", "status"], ["brand_usage_payments", "status"], ["brand_usage_consents", "withdrawn_at"], ["brand_usage_grants", "starts_at"]])
      expect(await canColumn(table!, column!), `${table}.${column}`).toBe(true);
    for (const history of ["brand_usage_messages", "brand_usage_scope_revisions", "brand_usage_compensations", "brand_usage_events", "brand_usage_grant_events", "brand_usage_case_items"])
      expect(await can("service_role", history, "UPDATE"), history).toBe(false);
  });
});
