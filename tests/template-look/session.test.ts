import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { resetTemplateLookSchemaCache } from '@/lib/template-look/repo';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — how the stored choice reaches the static pages: on the one request every page's
 * header already makes (`GET /api/account/session`), and through the `tw_look` cookie that answer keeps in line with
 * the profile (a second device learns it here). With the switch off the answer is exactly as before.
 */

const context = vi.hoisted(() => ({ user: null as { id: string } | null, sql: vi.fn() }));
vi.mock('@/lib/supabase/auth-client', () => ({ getSessionUser: async () => context.user }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: null }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: context.sql }));

import { GET } from '@/app/api/account/session/route';

const USER = '66666666-6666-4666-8666-666666666602';
const request = (cookie?: string) => new Request('https://twings.app/api/account/session', cookie ? { headers: { cookie } } : {});

describe('the session answer carries the template style (switch on only)', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    resetTemplateLookSchemaCache();
    db = await freshDb();
    sql = runner(db);
    await sql.query('insert into auth.users (id) values ($1)', [USER]);
    await sql.query(`insert into profiles (id, email, locale) values ($1, 'session@twings.test', 'ko')`, [USER]);
    context.sql.mockResolvedValue(sql);
    context.user = { id: USER };
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  it('switch off: no field, no cookie, even with a stored choice and a stale cookie', async () => {
    await sql.query(`update profiles set template_look = 'female' where id = $1`, [USER]);
    const res = await GET(request('tw_look=male'));
    const body = await res.json();
    expect('look' in body).toBe(false);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('tw_look');
    context.user = null;
    const anon = await GET(request('tw_look=male'));
    expect(await anon.json()).toEqual({ signedIn: false });
    expect(anon.headers.get('set-cookie')).toBeNull();
  });

  it('switch on: sends the stored choice and sets the cookie on a device that lacks it', async () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    await sql.query(`update profiles set template_look = 'female' where id = $1`, [USER]);
    const res = await GET(request());
    expect((await res.json()).look).toBe('female');
    expect(res.headers.get('set-cookie')).toContain('tw_look=female');
    // Already in line: nothing to rewrite.
    const again = await GET(request('tw_look=female'));
    expect(again.headers.get('set-cookie') ?? '').not.toContain('tw_look');
  });

  it('switch on: an unset account says null (so the page may ask) and loses a stale cookie', async () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    const res = await GET(request('tw_look=male'));
    expect((await res.json()).look).toBeNull();
    expect(res.headers.get('set-cookie')).toMatch(/tw_look=;.*Max-Age=0/);
  });

  it('switch on: a signed-out browser keeps no style', async () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    context.user = null;
    const res = await GET(request('tw_look=female'));
    expect(await res.json()).toEqual({ signedIn: false });
    expect(res.headers.get('set-cookie')).toMatch(/tw_look=;.*Max-Age=0/);
  });

  it('switch on but 0190 missing: no field (the page asks nothing), no cookie, no error', async () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    await sql.query('alter table profiles drop column template_look_set_at');
    await sql.query('alter table profiles drop column template_look');
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signedIn).toBe(true);
    expect('look' in body).toBe(false);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('tw_look');
  });
});
