import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';

/**
 * B1c-1 §2: migration 0186 applied on a database that already holds invoices and grants, then a second time. Existing
 * rows keep null cycle and range columns; the calendar-month uniqueness still holds for them; cycle invoices are unique
 * per (organization, cycle_start) and two of them may share a calendar month; grants accept a date range and `carry`.
 */
describe('0186_core_brand_billing_cycle on existing data', () => {
  it('applies twice without touching rows and enforces the cycle and range rules', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      const files = coreMigrationFiles();
      const index0186 = files.findIndex((f) => f.startsWith('0186_'));
      expect(index0186).toBeGreaterThan(0);
      for (const file of files.slice(0, index0186)) await db.exec(readMigration(file));

      const userId = randomUUID();
      const orgId = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [userId]);
      await db.query("insert into profiles (id, email) values ($1, 'cycle-migration@fixture.invalid')", [userId]);
      await db.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [orgId, 'Cycle Fixture', userId, randomUUID()]);
      // The invoice insert the deployed admin path runs (no kind, no cycle).
      const legacyInsert = (id: string, period: string, status = 'draft') =>
        db.query(
          `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent,
              discount_krw, supply_krw, vat_krw, total_krw, status, issued_at, created_by, updated_by)
           values ($1, $2, $3, 'b2b_29', 290000, 290000, 0, 0, 290000, 29000, 319000, $4,
              case when $4 in ('issued','paid') then now() end, $5, $5)`,
          [id, orgId, period, status, userId],
        );
      await legacyInsert(randomUUID(), '2026-10', 'issued');
      await legacyInsert(randomUUID(), '2026-11');
      await db.query("insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason) values ($1, 5000, '2026-11', 'existing')", [orgId]);
      const snapshot = async () => ({
        invoices: (await db.query('select id, period, status, total_krw, kind from brand_invoices order by period')).rows,
        grants: (await db.query('select id, amount_krw, valid_month, kind from brand_allowance_grants order by id')).rows,
      });
      const before = await snapshot();

      await db.exec(readMigration(files[index0186]!));
      await db.exec(readMigration(files[index0186]!));

      expect(await snapshot()).toEqual(before);
      expect((await db.query('select cycle_start, cycle_end from brand_invoices')).rows).toEqual([
        { cycle_start: null, cycle_end: null },
        { cycle_start: null, cycle_end: null },
      ]);
      expect((await db.query('select valid_from, valid_until from brand_allowance_grants')).rows).toEqual([{ valid_from: null, valid_until: null }]);

      // Calendar-month rows: still one non-void subscription invoice per (organization, period).
      await expect(legacyInsert(randomUUID(), '2026-11')).rejects.toThrow();

      const cycleInsert = (cycleStart: string, cycleEnd: string, period: string) =>
        db.query(
          `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent,
              discount_krw, supply_krw, vat_krw, total_krw, status, created_by, updated_by, cycle_start, cycle_end)
           values ($1, $2, $3, 'b2b_29', 290000, 290000, 0, 0, 290000, 29000, 319000, 'draft', $4, $4, $5::date, $6::date)`,
          [randomUUID(), orgId, period, userId, cycleStart, cycleEnd],
        );
      // A cycle invoice next to a calendar-month one of the same period, and two cycles starting in one month.
      await cycleInsert('2026-11-17', '2026-12-17', '2026-11');
      await cycleInsert('2026-11-02', '2026-11-17', '2026-11');
      await expect(cycleInsert('2026-11-17', '2026-12-17', '2026-11')).rejects.toThrow();
      await expect(cycleInsert('2026-12-17', '2026-12-17', '2026-12')).rejects.toThrow(); // start < end
      await expect(
        db.query(
          `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent,
              discount_krw, supply_krw, vat_krw, total_krw, status, created_by, updated_by, cycle_start)
           values ($1, $2, '2027-01', 'b2b_29', 290000, 290000, 0, 0, 290000, 29000, 319000, 'draft', $3, $3, '2027-01-17')`,
          [randomUUID(), orgId, userId],
        ),
      ).rejects.toThrow(); // both or neither
      // A void cycle invoice frees the cycle.
      await db.query("update brand_invoices set status = 'void', voided_at = now() where cycle_start = '2026-11-17'");
      await cycleInsert('2026-11-17', '2026-12-17', '2026-11');
      // The derived-amounts check still holds for a cycle row (full price, no proration).
      await expect(
        db.query(
          `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent,
              discount_krw, supply_krw, vat_krw, total_krw, status, created_by, updated_by, cycle_start, cycle_end)
           values ($1, $2, '2027-02', 'b2b_29', 290000, 280000, 0, 0, 280000, 28000, 308000, 'draft', $3, $3, '2027-02-17', '2027-03-17')`,
          [randomUUID(), orgId, userId],
        ),
      ).rejects.toThrow();

      // Grants: a date range (both or neither, from ≤ until) and the kind 'carry'.
      const grant = (from: string | null, until: string | null, kind = 'extra') =>
        db.query(
          "insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, kind, valid_from, valid_until) values ($1, 1000, '2026-12', 'r', $2, $3::date, $4::date)",
          [orgId, kind, from, until],
        );
      await grant('2026-12-17', '2027-01-16', 'carry');
      await grant('2026-12-17', '2026-12-17');
      await expect(grant('2026-12-18', '2026-12-17')).rejects.toThrow();
      await expect(grant('2026-12-17', null)).rejects.toThrow();
      await expect(grant(null, null, 'bogus')).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it('applies on a schema without 0182 (no invoice kind) and keeps the calendar-month rule there', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((f) => !f.startsWith('0182_'))) await db.exec(readMigration(file));
      const idx = (await db.query<{ indexname: string }>("select indexname from pg_indexes where tablename = 'brand_invoices' and indexname like 'brand_invoices_org_%' order by 1")).rows;
      expect(idx.map((r) => r.indexname)).toEqual(['brand_invoices_org_cycle_active', 'brand_invoices_org_period_legacy_active']);
    } finally {
      await db.close();
    }
  });
});
