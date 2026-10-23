import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, freshDb, glueMigrationFiles } from '../helpers/pglite';

/**
 * 0054 — docs/PLATFORM-2.0.md §3.2-1. One nullable timestamp on `profiles`: when this account
 * dismissed the first-run sheet. No new table, no policy: only the server writes it.
 */

const CORE = '0054_core_profile_onboarding.sql';

describe('0054 profile onboarding (core)', () => {
  it('is a core migration with no glue partner, and says it must be cloud-applied', () => {
    expect(coreMigrationFiles()).toContain(CORE);
    expect(glueMigrationFiles().some((file) => file.startsWith('0054'))).toBe(false);
    const text = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
    expect(text.split('\n')[0]).toMatch(/^-- CLOUD APPLICATION REQUIRED/);
  });

  it('adds profiles.onboarded_at as a nullable timestamptz, null for every account to begin with', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarded_at'`,
    );
    expect(rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null }]);
    await db.query('insert into auth.users (id) values ($1)', ['88888888-8888-4888-8888-888888888888']);
    await db.query(`insert into profiles (id, email) values ($1, 'new@twings.test')`, ['88888888-8888-4888-8888-888888888888']);
    expect((await db.query<{ onboarded_at: Date | null }>('select onboarded_at from profiles')).rows).toEqual([{ onboarded_at: null }]);
    await db.close();
  });

  it('creates no table — the migration table list is unchanged by 0054', () => {
    const text = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8').toLowerCase();
    expect(text).not.toMatch(/create table/);
  });
});
