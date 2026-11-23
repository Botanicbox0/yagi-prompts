import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';

/**
 * Review round 2, item 10: migration 0182 applied on a database that already holds invoices and plan
 * assignments, then applied a second time. Both runs succeed; existing invoices become
 * `kind = 'subscription'` with a null `subscription_epoch`; nothing else about the rows changes.
 */
describe('0182_core_brand_subscriptions on existing data', () => {
  it('applies over existing invoices and plan assignments, twice, without touching the rows', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      const files = coreMigrationFiles();
      const index0182 = files.findIndex((f) => f.startsWith('0182_'));
      expect(index0182).toBeGreaterThan(0);
      for (const file of files.slice(0, index0182)) await db.exec(readMigration(file));

      const userId = randomUUID();
      const orgId = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [userId]);
      await db.query("insert into profiles (id, email) values ($1, 'migration-owner@fixture.invalid')", [userId]);
      await db.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
        orgId,
        'Migration Fixture',
        userId,
        randomUUID(),
      ]);
      await db.query(
        "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-10-01', '2026-12-01', 1)",
        [orgId],
      );
      const invoiceRows: Array<[string, string, string]> = [
        ['2026-10', 'paid', randomUUID()],
        ['2026-11', 'issued', randomUUID()],
        ['2026-12', 'draft', randomUUID()],
        ['2026-12', 'void', randomUUID()],
      ];
      for (const [period, status, id] of invoiceRows) {
        await db.query(
          `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent,
              discount_krw, supply_krw, vat_krw, total_krw, status, issued_at, paid_at, voided_at, void_reason, created_by, updated_by)
           values ($1, $2, $3, 'b2b_29', 290000, 290000, 0, 0, 290000, 29000, 319000, $4,
              case when $4 in ('issued','paid') then now() end,
              case when $4 = 'paid' then now() end,
              case when $4 = 'void' then now() end,
              case when $4 = 'void' then 'test' else '' end, $5, $5)`,
          [id, orgId, period, status, userId],
        );
      }
      const snapshot = async () => ({
        invoices: (await db.query('select id, period, status, total_krw, issued_at, paid_at, voided_at from brand_invoices order by period, status')).rows,
        plans: (await db.query('select organization_id, plan_id, started_on, ends_on, revision from brand_plan_assignments')).rows,
      });
      const before = await snapshot();

      await db.exec(readMigration(files[index0182]!));
      await db.exec(readMigration(files[index0182]!));

      expect(await snapshot()).toEqual(before);
      const added = (
        await db.query<{ kind: string; covers_months: number; subscription_epoch: number | null; due_on: string | null }>(
          'select kind, covers_months, subscription_epoch, due_on from brand_invoices',
        )
      ).rows;
      expect(added).toHaveLength(4);
      for (const row of added) expect(row).toEqual({ kind: 'subscription', covers_months: 1, subscription_epoch: null, due_on: null });
      // The plan-assignment period check is the original one (ends_on > started_on).
      await expect(
        db.query("update brand_plan_assignments set ends_on = started_on where organization_id = $1", [orgId]),
      ).rejects.toThrow();
      // The subscription-scoped unique index allows only one non-void subscription invoice per period.
      await expect(
        db.query(
          `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent,
              discount_krw, supply_krw, vat_krw, total_krw, status, created_by, updated_by)
           values ($1, $2, '2026-11', 'b2b_29', 290000, 290000, 0, 0, 290000, 29000, 319000, 'draft', $3, $3)`,
          [randomUUID(), orgId, userId],
        ),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
