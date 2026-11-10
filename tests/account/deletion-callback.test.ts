import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';

/**
 * docs/RUNBOOK-deletion.md — the sign-in account is removed AFTER the account's rows, and that last
 * step is retried daily. If it failed once and the person signed in again, the callback used to start
 * a fresh profile on the same id; the next pass would then delete the sign-in account and cascade the
 * new profile away. While a request still lists the sign-in account, the callback creates nothing.
 */
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), signOut: vi.fn(), sql: vi.fn() }));
vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthServerClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange, signOut: mocks.signOut } }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));

import { GET as callback } from '@/app/auth/callback/route';

const LEAVING = '77777777-7777-4777-8777-777777777777';
const NEWCOMER = '88888888-8888-4888-8888-888888888888';

describe('/auth/callback while an account is being deleted', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
    for (const id of [LEAVING, NEWCOMER]) await sql.query('insert into auth.users (id) values ($1)', [id]);
    mocks.sql.mockResolvedValue(sql);
    mocks.signOut.mockResolvedValue({ error: null });
    // The rows are gone, the sign-in account is still on the list.
    await sql.query(
      `insert into account_deletion_requests (user_id, email, status, scheduled_for, due_at, started_at, cleanup)
       values (null, 'leaving@twings.test', 'processing', now(), now() + interval '7 days', now(), $1::jsonb)`,
      [JSON.stringify({ authUserId: LEAVING, folders: [], providerAssets: [], providerGroups: [] })],
    );
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await db.close();
  });

  const signIn = async (id: string) => {
    mocks.exchange.mockResolvedValue({ data: { user: { id, email: 'someone@twings.test', user_metadata: {} } }, error: null });
    return callback(new NextRequest('http://localhost:3000/auth/callback?code=c&locale=ko'));
  };
  const profiles = async (id: string) => (await sql.query<{ n: number }>('select count(*)::int n from profiles where id=$1', [id])).rows[0]!.n;

  it('creates no profile, ends the session and sends the person back with the sign-in notice', async () => {
    const response = await signIn(LEAVING);
    expect(await profiles(LEAVING)).toBe(0);
    expect((await sql.query<{ n: number }>('select count(*)::int n from cookie_ledger')).rows[0]!.n).toBe(0);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('oauth');
  });

  it('leaves everyone else alone', async () => {
    const response = await signIn(NEWCOMER);
    expect(await profiles(NEWCOMER)).toBe(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBeNull();
  });

  it('opens again once the request is closed', async () => {
    await sql.query(`update account_deletion_requests set status='completed', completed_at=now(), email=null, cleanup=null`);
    await signIn(LEAVING);
    expect(await profiles(LEAVING)).toBe(1);
  });
});
