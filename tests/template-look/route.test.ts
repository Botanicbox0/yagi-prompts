import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { resetTemplateLookSchemaCache } from '@/lib/template-look/repo';

/**
 * `POST /api/account/template-look` (docs/PERSONAL-STUDIO.md §3.4.10) — the one writer of the account's template
 * style. Signed in only, our own page only, a closed vocabulary, idempotent; it stores the choice on the profile and
 * sets the `tw_look` cookie to match, and it does not exist with the switch off. A database without 0190 answers
 * `unavailable` and sets nothing.
 */

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));

import { POST } from '@/app/api/account/template-look/route';

const ORIGIN = 'http://localhost:3000';
const URL_ = `${ORIGIN}/api/account/template-look`;
const USER = '66666666-6666-4666-8666-666666666601';

const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' }) =>
  new Request(URL_, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('POST /api/account/template-look', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    resetTemplateLookSchemaCache();
    db = await freshDb();
    sql = runner(db);
    await sql.query('insert into auth.users (id) values ($1)', [USER]);
    await sql.query(`insert into profiles (id, email, locale) values ($1, 'look@twings.test', 'ko')`, [USER]);
    mocks.viewer.mockResolvedValue({ userId: USER });
    mocks.sql.mockResolvedValue(sql);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await db.close();
  });

  const stored = async () =>
    (await sql.query<{ template_look: string | null; template_look_set_at: Date | null }>('select template_look, template_look_set_at from profiles where id = $1', [USER])).rows[0]!;

  it('does not exist with the switch off', async () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', '');
    const res = await POST(post({ look: 'female' }));
    expect(res.status).toBe(404);
    expect(mocks.viewer).not.toHaveBeenCalled();
    expect((await stored()).template_look).toBeNull();
  });

  it('refuses a write that is not from our own page', async () => {
    expect((await POST(post({ look: 'female' }, { 'content-type': 'application/json' }))).status).toBe(403);
    expect((await POST(post({ look: 'female' }, { origin: 'https://evil.example', 'content-type': 'application/json' }))).status).toBe(403);
  });

  it('refuses a signed-out write (401)', async () => {
    mocks.viewer.mockResolvedValue({ userId: null });
    const res = await POST(post({ look: 'female' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a value outside the vocabulary (400) and writes nothing', async () => {
    for (const body of [{ look: 'any' }, { look: 'Female' }, {}, 'not json']) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect((await stored()).template_look).toBeNull();
  });

  it('stores the choice and sets the first-party cookie', async () => {
    const res = await POST(post({ look: 'female' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, look: 'female' });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('tw_look=female');
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=31536000/);
    expect(cookie).not.toMatch(/HttpOnly/i);
    const row = await stored();
    expect(row.template_look).toBe('female');
    expect(row.template_look_set_at).not.toBeNull();
  });

  it('is idempotent: the same choice again changes nothing, not even the time', async () => {
    await POST(post({ look: 'male' }));
    const first = (await stored()).template_look_set_at;
    const again = await POST(post({ look: 'male' }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, look: 'male' });
    expect((await stored()).template_look_set_at).toEqual(first);
  });

  it('clears the choice with null and deletes the cookie', async () => {
    await POST(post({ look: 'female' }));
    const res = await POST(post({ look: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, look: null });
    expect(res.headers.get('set-cookie')).toMatch(/tw_look=;.*Max-Age=0/);
    expect((await stored()).template_look).toBeNull();
  });

  it('refuses a value the database would not take either (the CHECK is the backstop)', async () => {
    await expect(sql.query(`update profiles set template_look = 'any' where id = $1`, [USER])).rejects.toThrow();
    await expect(sql.query(`update profiles set template_look = 'unisex' where id = $1`, [USER])).rejects.toThrow();
  });

  it('degrades without 0190: answers unavailable, stores and sets nothing', async () => {
    resetTemplateLookSchemaCache();
    await sql.query('alter table profiles drop column template_look_set_at');
    await sql.query('alter table profiles drop column template_look');
    const res = await POST(post({ look: 'female' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: 'unavailable' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('answers unavailable without a database', async () => {
    mocks.sql.mockResolvedValue(null);
    expect((await POST(post({ look: 'female' }))).status).toBe(503);
  });
});
