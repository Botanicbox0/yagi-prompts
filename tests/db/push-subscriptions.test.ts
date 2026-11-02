import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, expectReject, freshDb } from '../helpers/pglite';

/**
 * 0053 / 0139 — docs/PLATFORM-2.0.md §5.3. The device table, `push` as a delivery channel, and
 * profiles that may honestly have no email (a Kakao account that did not share one). Both files
 * are cloud-applied by the founder or the Director, and say so at the top.
 */

const CORE = '0053_core_push_subscriptions.sql';
const GLUE = '0139_glue_push_subscriptions.sql';
const USER = '44444444-4444-4444-8444-444444444444';

describe('0053 push subscriptions (core)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await freshDb();
    await db.query('insert into auth.users (id) values ($1)', [USER]);
  });
  afterEach(async () => db.close());

  it('creates the device table with the §5.3 columns', async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'push_subscriptions' order by ordinal_position`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable]))).toEqual({
      id: 'NO',
      user_id: 'NO',
      endpoint: 'NO',
      p256dh: 'NO',
      auth: 'NO',
      user_agent: 'YES',
      created_at: 'NO',
      last_seen_at: 'NO',
      revoked_at: 'YES',
    });
  });

  it('keeps one row per endpoint and follows the profile out', async () => {
    await db.query(`insert into profiles (id, email, locale) values ($1, 'a@twings.test', 'ko')`, [USER]);
    const insert = () => db.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://fcm.googleapis.com/fcm/send/x', 'k', 'a')`, [USER]);
    await insert();
    expect(await expectReject(insert)).toMatch(/duplicate key|unique/i);
    expect(await expectReject(() => db.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'http://plain.example/x', 'k', 'a')`, [USER]))).toMatch(/check/i);
    await db.query('delete from profiles where id = $1', [USER]);
    expect((await db.query<{ n: number }>('select count(*)::int as n from push_subscriptions')).rows[0]!.n).toBe(0);
  });

  it('lets a render record push as its delivery channel, and nothing unknown', async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'render_jobs_notify_channel_check'`,
    );
    expect(rows).toHaveLength(1);
    for (const channel of ['email', 'kakao', 'whatsapp', 'sms', 'push']) expect(rows[0]!.def).toContain(`'${channel}'`);
    expect(rows[0]!.def).not.toContain('pigeon');
  });

  it('stores a missing email as NULL and cleans up the old empty strings', async () => {
    await db.query(`insert into profiles (id, email, locale) values ($1, null, 'ko')`, [USER]);
    expect((await db.query<{ email: string | null }>('select email from profiles where id = $1', [USER])).rows[0]!.email).toBeNull();
    const core = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
    expect(core).toMatch(/alter table profiles alter column email drop not null/);
    expect(core).toMatch(/update profiles set email = null where btrim\(email\) = ''/);
  });
});

describe('0139 push subscriptions (glue)', () => {
  const core = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');

  it('says on the first line that the cloud needs it applied', () => {
    expect(core.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
    expect(glue.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
  });

  it('closes the table to the browser roles and opens it to service_role only (the 0131 shape)', () => {
    expect(glue).toContain("'push_subscriptions'");
    expect(glue).toContain("alter table public.%I enable row level security");
    expect(glue).toContain("alter table public.%I force row level security");
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).toContain('grant select,insert,update,delete on public.%I to service_role');
    expect(glue).not.toMatch(/create\s+policy/i);
  });
});
