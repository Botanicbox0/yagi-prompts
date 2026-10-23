import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';

/**
 * docs/PLATFORM-2.0.md §5.3 bug fix — a Kakao account that did not share an email used to land in
 * `profiles` as `email = ''`, which looks like an address to anything that only null-checks.
 * The callback now stores the Auth user's email when there is one and NULL when there is not.
 */

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), sql: vi.fn() }));
vi.mock('@/lib/supabase/auth-client', () => ({ createAuthServerClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));

import { GET as callback } from '@/app/auth/callback/route';

const KAKAO = '55555555-5555-4555-8555-555555555555';
const GOOGLE = '66666666-6666-4666-8666-666666666666';

describe('/auth/callback profile email', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
    for (const id of [KAKAO, GOOGLE]) await sql.query('insert into auth.users (id) values ($1)', [id]);
    mocks.sql.mockResolvedValue(sql);
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await db.close();
  });

  const signIn = async (user: Record<string, unknown>) => {
    mocks.exchange.mockResolvedValue({ data: { user }, error: null });
    return callback(new NextRequest('http://localhost:3000/auth/callback?code=c&locale=ko'));
  };
  const emailOf = async (id: string) => (await sql.query<{ email: string | null }>('select email from profiles where id = $1', [id])).rows[0]?.email;

  it('stores NULL, not an empty string, for an account without an email', async () => {
    const response = await signIn({ id: KAKAO, email: '', user_metadata: { full_name: '카카오' } });
    expect(response.status).toBe(307);
    expect(await emailOf(KAKAO)).toBeNull();
  });

  it('stores NULL when the Auth user carries no email field at all', async () => {
    await signIn({ id: KAKAO, user_metadata: {} });
    expect(await emailOf(KAKAO)).toBeNull();
  });

  it('keeps the Auth user’s email when there is one', async () => {
    await signIn({ id: GOOGLE, email: 'reader@gmail.com', user_metadata: {} });
    expect(await emailOf(GOOGLE)).toBe('reader@gmail.com');
  });

  it('still lands on the video formats in the chosen language', async () => {
    const response = await signIn({ id: KAKAO, email: '', user_metadata: {} });
    expect(new URL(response.headers.get('location')!).pathname).toBe('/ko/video');
  });
});
