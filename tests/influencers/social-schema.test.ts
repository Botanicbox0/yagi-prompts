import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, expectReject, freshDb } from '../helpers/pglite';

/**
 * 0057 / 0141 — docs/PLATFORM-2.0.md §17.1. The linked-account table, its write ledger, the worker
 * heartbeat and `profiles.influencer_since`. Both files are cloud-applied by the founder or the
 * Director, and say so on their first line.
 */
const CORE = '0057_core_social_accounts.sql';
const GLUE = '0141_glue_social_accounts.sql';
const USER = '57000000-0000-4000-8000-000000000001';
const insert = (db: PGlite, extra = '', values = '') =>
  db.query(`insert into social_accounts (user_id, platform, handle, profile_url${extra}) values ($1, 'instagram', 'hana', 'https://www.instagram.com/hana/'${values})`, [USER]);

describe('0057 social accounts (core)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
    await db.query('insert into auth.users (id) values ($1)', [USER]);
    await db.query(`insert into profiles (id, email, locale) values ($1, 'a@twings.test', 'ko')`, [USER]);
  });
  afterEach(async () => db.close());

  it('creates the §17.1 columns with the submitted/manual/queued defaults', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema='public' and table_name='social_accounts' order by ordinal_position`,
    );
    expect(rows.map(r => r.column_name)).toEqual(expect.arrayContaining([
      'id', 'user_id', 'platform', 'handle', 'profile_url', 'claimed_count', 'follower_count', 'evidence_key', 'status', 'source',
      'ai_count', 'ai_confidence', 'ai_model', 'ai_note', 'reviewed_by', 'reviewed_at', 'measured_at', 'note', 'pool_consent_at',
      'created_at', 'updated_at', 'recheck_at', 'ai_state', 'ai_attempts', 'ai_lease_token', 'ai_lease_until',
    ]));
    await insert(db);
    expect((await db.query('select status, source, ai_state, ai_attempts from social_accounts')).rows[0]).toEqual({ status: 'submitted', source: 'manual', ai_state: 'queued', ai_attempts: 0 });
    const profile = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='profiles' and column_name='influencer_since'`);
    expect(profile.rows).toHaveLength(1);
  });

  it('keeps one row per member and platform, and only the three platforms and four states', async () => {
    await insert(db);
    expect(await expectReject(() => insert(db))).toMatch(/duplicate key|unique/i);
    expect(await expectReject(() => db.query(`insert into social_accounts (user_id, platform, handle, profile_url) values ($1, 'x', 'hana', 'https://x.com/hana')`, [USER]))).toMatch(/check/i);
    expect(await expectReject(() => db.query(`update social_accounts set status='approved'`))).toMatch(/check/i);
    expect(await expectReject(() => db.query(`update social_accounts set source='scraped'`))).toMatch(/check/i);
    expect(await expectReject(() => db.query(`update social_accounts set profile_url='http://instagram.com/hana'`))).toMatch(/check/i);
  });

  it('refuses a verified row without the confirmed number and date, and a rejection without a reason', async () => {
    await insert(db);
    expect(await expectReject(() => db.query(`update social_accounts set status='verified'`))).toMatch(/check/i);
    await db.query(`update social_accounts set status='verified', follower_count=3000, measured_at=now()`);
    expect(await expectReject(() => db.query(`update social_accounts set status='rejected', note=null`))).toMatch(/check/i);
    expect(await expectReject(() => db.query(`update social_accounts set ai_confidence=1.5`))).toMatch(/check|numeric/i);
  });

  it('follows the profile out, ledger included', async () => {
    await insert(db);
    await db.query(`insert into social_account_writes (user_id, platform) values ($1, 'instagram')`, [USER]);
    await db.query('delete from profiles where id=$1', [USER]);
    expect((await db.query<{ n: number }>('select (select count(*) from social_accounts)::int + (select count(*) from social_account_writes)::int as n')).rows[0]!.n).toBe(0);
  });
});

describe('0141 social accounts (glue)', () => {
  const core = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');

  it('says on the first line that the cloud needs it applied', () => {
    expect(core.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
    expect(glue.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
  });

  it('closes all three tables to the browser roles and opens them to service_role only (the 0131 shape)', () => {
    for (const table of ['social_accounts', 'social_account_writes', 'social_verify_workers']) expect(glue).toContain(`'${table}'`);
    expect(glue).toContain('alter table public.%I enable row level security');
    expect(glue).toContain('alter table public.%I force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).toContain('grant select,insert,update,delete on public.%I to service_role');
    expect(glue).not.toMatch(/create\s+policy/i);
  });
});
