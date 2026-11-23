import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { coreMigrationFiles, glueMigrationFiles, MIGRATIONS_DIR, readMigration } from '@/lib/db/migrations';

/**
 * B1b-1 §3: migration 0184 applied on a database that already holds allowance grants, then applied a second time.
 * Existing grants become `kind = 'extra'` with no `carried_from` and are otherwise untouched; the grant insert the
 * deployed code runs (no `kind`) keeps working; the new unique indexes hold one original trial grant per organization
 * (revoked or not) and carry a grant at most once.
 */
describe('0184_core_brand_workspace_approval on existing data', () => {
  it('applies over existing grants, twice, without touching them, and enforces the trial and carry rules', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      const files = coreMigrationFiles();
      const index0184 = files.findIndex((f) => f.startsWith('0184_'));
      expect(index0184).toBeGreaterThan(0);
      for (const file of files.slice(0, index0184)) await db.exec(readMigration(file));

      const userId = randomUUID();
      const orgId = randomUUID();
      const otherOrg = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [userId]);
      await db.query("insert into profiles (id, email) values ($1, 'migration-admin@fixture.invalid')", [userId]);
      for (const [id, name] of [[orgId, 'Migration Fixture'], [otherOrg, 'Other Fixture']] as const) {
        await db.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, userId, randomUUID()]);
      }
      // The insert origin/main's grantExtraAllowance runs.
      const oldInsert = (id: string, org: string, amount: number, month: string) =>
        db.query(
          'insert into brand_allowance_grants (id, organization_id, amount_krw, valid_month, reason, created_by) values ($1, $2, $3, $4, $5, $6)',
          [id, org, amount, month, 'existing', userId],
        );
      const g1 = randomUUID();
      const g2 = randomUUID();
      await oldInsert(g1, orgId, 50_000, '2026-11');
      await oldInsert(g2, orgId, 20_000, '2026-12');
      await db.query('update brand_allowance_grants set revoked_at = now(), revoked_by = $2 where id = $1', [g2, userId]);
      const snapshot = async () =>
        (await db.query('select id, organization_id, amount_krw, valid_month, reason, created_by, created_at, revoked_at, revoked_by from brand_allowance_grants order by id')).rows;
      const before = await snapshot();

      await db.exec(readMigration(files[index0184]!));
      await db.exec(readMigration(files[index0184]!));

      expect(await snapshot()).toEqual(before);
      const added = (
        await db.query<{ kind: string; carried_from: string | null; trial_carry_checked_at: unknown }>(
          'select kind, carried_from, trial_carry_checked_at from brand_allowance_grants',
        )
      ).rows;
      expect(added).toEqual([
        { kind: 'extra', carried_from: null, trial_carry_checked_at: null },
        { kind: 'extra', carried_from: null, trial_carry_checked_at: null },
      ]);

      // Deployed code keeps working on the migrated schema: its insert takes the defaults.
      const g3 = randomUUID();
      await oldInsert(g3, orgId, 10_000, '2026-11');
      expect((await db.query('select kind, carried_from from brand_allowance_grants where id = $1', [g3])).rows[0]).toEqual({ kind: 'extra', carried_from: null });
      await oldInsert(randomUUID(), orgId, 10_000, '2026-11'); // extra grants stay unlimited

      const insert = (id: string, org: string, kind: string, carriedFrom: string | null, month = '2026-11') =>
        db.query(
          'insert into brand_allowance_grants (id, organization_id, amount_krw, valid_month, reason, created_by, kind, carried_from) values ($1, $2, 4000, $3, $4, $5, $6, $7)',
          [id, org, month, 'trial', userId, kind, carriedFrom],
        );
      await expect(insert(randomUUID(), orgId, 'bogus', null)).rejects.toThrow();

      // One original trial grant per organization, revoked or not.
      const trial = randomUUID();
      await insert(trial, orgId, 'trial', null);
      await db.query('update brand_allowance_grants set revoked_at = now() where id = $1', [trial]);
      await expect(insert(randomUUID(), orgId, 'trial', null)).rejects.toThrow();
      await insert(randomUUID(), otherOrg, 'trial', null); // another organization has its own

      // A grant is carried at most once, never into itself.
      const carried = randomUUID();
      await insert(carried, orgId, 'trial', trial, '2026-12');
      await expect(insert(randomUUID(), orgId, 'trial', trial, '2026-12')).rejects.toThrow();
      const self = randomUUID();
      await expect(insert(self, orgId, 'trial', self)).rejects.toThrow();
      // `on conflict do nothing` (the path the service uses) turns a second carry into no row instead of an error.
      const none = await db.query(
        `insert into brand_allowance_grants (id, organization_id, amount_krw, valid_month, reason, created_by, kind, carried_from)
           values ($1, $2, 4000, '2026-12', 'trial', $3, 'trial', $4) on conflict do nothing returning id`,
        [randomUUID(), orgId, userId, trial],
      );
      expect(none.rows).toEqual([]);

      // The approval record, linked to its trial grant.
      expect(
        (await db.query("select 1 from pg_constraint where conname = 'brand_workspace_approvals_trial_grant' and contype = 'f'")).rows,
      ).toHaveLength(1);
      await expect(
        db.query('insert into brand_workspace_approvals (organization_id, trial_grant_id) values ($1, $2)', [otherOrg, randomUUID()]),
      ).rejects.toThrow();
      await db.query('insert into brand_workspace_approvals (organization_id, approved_by, trial_grant_id, note) values ($1, $2, $3, $4)', [orgId, userId, trial, 'ok']);
      await expect(
        db.query('insert into brand_workspace_approvals (organization_id, approved_by, note) values ($1, $2, $3)', [otherOrg, userId, 'x'.repeat(501)]),
      ).rejects.toThrow();
      await expect(db.query('insert into brand_workspace_approvals (organization_id) values ($1)', [orgId])).rejects.toThrow();

      // Deleting an original by hand deletes what was carried from it (a carry means nothing without its original).
      const otherTrial = (await db.query<{ id: string }>("select id from brand_allowance_grants where organization_id = $1 and kind = 'trial'", [otherOrg])).rows[0]!.id;
      const otherCarried = randomUUID();
      await insert(otherCarried, otherOrg, 'trial', otherTrial, '2026-12');
      await db.query('delete from brand_allowance_grants where id = $1', [otherTrial]);
      expect((await db.query('select 1 from brand_allowance_grants where id = $1', [otherCarried])).rows).toEqual([]);

      // Deleting an organization removes its approval and every grant, the carried one and its original together.
      await db.query('delete from brand_organizations where id = $1', [orgId]);
      expect((await db.query('select 1 from brand_allowance_grants where organization_id = $1', [orgId])).rows).toEqual([]);
      expect((await db.query('select 1 from brand_workspace_approvals where organization_id = $1', [orgId])).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('applies on a database that lacks 0176 (the grants table) without failing, and skips only the grant parts', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0176_'))) await db.exec(readMigration(file));
      expect((await db.query("select to_regclass('public.brand_workspace_approvals') is not null as ok")).rows[0]).toEqual({ ok: true });
      expect((await db.query("select to_regclass('public.brand_allowance_grants') is not null as ok")).rows[0]).toEqual({ ok: false });
    } finally {
      await db.close();
    }
  });

  it('pairs with a glue file giving the new table the deny-all posture and nothing else', () => {
    const glue = glueMigrationFiles().find((f) => f.startsWith('0185_'));
    expect(glue).toBe('0185_glue_brand_workspace_approval.sql');
    const text = readFileSync(join(MIGRATIONS_DIR, glue!), 'utf8');
    expect(text).toContain("'brand_workspace_approvals'");
    expect(text).toContain('force row level security');
    expect(text).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(text).toContain('to service_role');
    expect(text).not.toMatch(/create\s+policy/i);
  });
});
