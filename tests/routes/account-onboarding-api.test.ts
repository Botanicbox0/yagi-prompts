import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';

/**
 * `GET`/`POST /api/account/onboarding` — the first-run sheet's one door (docs/PLATFORM-2.0.md §3.2-1).
 * GET answers "show the sheet?" for this session only; POST records that it was seen. A session is
 * required for the write, the write must come from our own page, and it is idempotent: the first
 * dismissal is the one that counts, a second one changes nothing.
 */

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));

import { GET, POST } from '@/app/api/account/onboarding/route';

const ORIGIN = 'http://localhost:3000';
const URL_ = `${ORIGIN}/api/account/onboarding`;
const USER = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';

const get = (headers: Record<string, string> = {}) => new Request(URL_, { headers });
const post = (headers: Record<string, string> = { origin: ORIGIN }) => new Request(URL_, { method: 'POST', headers });

describe('/api/account/onboarding', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
    for (const id of [USER, OTHER]) {
      await sql.query('insert into auth.users (id) values ($1)', [id]);
      await sql.query(`insert into profiles (id, email, locale) values ($1, $2, 'ko')`, [id, `${id.slice(0, 4)}@twings.test`]);
    }
    mocks.viewer.mockResolvedValue({ userId: USER });
    mocks.sql.mockResolvedValue(sql);
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await db.close();
  });

  const seen = async (id: string) => (await sql.query<{ onboarded_at: Date | null }>('select onboarded_at from profiles where id = $1', [id])).rows[0]!.onboarded_at;

  it('tells an anonymous visitor nothing to show, without touching the database', async () => {
    mocks.viewer.mockResolvedValue({ userId: null });
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ show: false });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('shows the sheet to an account that has not seen it, and only to that one', async () => {
    await sql.query('update profiles set onboarded_at = now() where id = $1', [OTHER]);
    expect(await (await GET(get())).json()).toEqual({ show: true });
    mocks.viewer.mockResolvedValue({ userId: OTHER });
    expect(await (await GET(get())).json()).toEqual({ show: false });
  });

  it('refuses an anonymous write', async () => {
    mocks.viewer.mockResolvedValue({ userId: null });
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses a cross-origin or origin-less write before recording anything', async () => {
    expect((await POST(post({ origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(new Request(URL_, { method: 'POST' }))).status).toBe(403);
    expect(await seen(USER)).toBeNull();
  });

  it('records the first dismissal once; a second one changes nothing', async () => {
    const first = await POST(post());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, recorded: true });
    const at = await seen(USER);
    expect(at).toBeInstanceOf(Date);

    const second = await POST(post());
    expect(await second.json()).toEqual({ ok: true, recorded: false });
    expect((await seen(USER))?.getTime()).toBe(at!.getTime());
    expect(await seen(OTHER)).toBeNull();
    expect(await (await GET(get())).json()).toEqual({ show: false });
  });

  it('degrades to "nothing to show" without a database', async () => {
    mocks.sql.mockResolvedValue(null);
    expect(await (await GET(get())).json()).toEqual({ show: false });
    expect((await POST(post())).status).toBe(503);
  });
});
