import webPush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { testPushKeys } from '@/tests/helpers/push';

/**
 * `POST`/`DELETE /api/notify/push` — docs/PLATFORM-2.0.md §5.3. A session is required, the request
 * must come from our own page, the body is small and shaped like PushSubscription.toJSON(), the
 * endpoint is unique (upsert), and turning push off keeps the row with `revoked_at`.
 */

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));

import { DELETE, POST } from '@/app/api/notify/push/route';

const KEYS = webPush.generateVAPIDKeys();
const ORIGIN = 'http://localhost:3000';
const URL_ = `${ORIGIN}/api/notify/push`;
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';
const SUBSCRIPTION = { endpoint: ENDPOINT, expirationTime: null, keys: testPushKeys() };

function req(method: 'POST' | 'DELETE', body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method,
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 15)', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('/api/notify/push', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', KEYS.publicKey);
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', KEYS.privateKey);
    vi.stubEnv('WEB_PUSH_SUBJECT', 'mailto:hello@twings.app');
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
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await db.close();
  });

  const rows = async () => (await sql.query<{ user_id: string; endpoint: string; revoked_at: Date | null; user_agent: string | null }>('select user_id, endpoint, revoked_at, user_agent from push_subscriptions order by created_at')).rows;

  it('refuses anonymous callers before reading the body or the database', async () => {
    mocks.viewer.mockResolvedValue({ userId: null });
    for (const res of [await POST(req('POST', SUBSCRIPTION)), await DELETE(req('DELETE', { endpoint: ENDPOINT }))]) {
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin or origin-less write', async () => {
    expect((await POST(req('POST', SUBSCRIPTION, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await DELETE(req('DELETE', { endpoint: ENDPOINT }, { origin: 'https://evil.example' }))).status).toBe(403);
    const bare = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SUBSCRIPTION) });
    expect((await POST(bare)).status).toBe(403);
    expect(await rows()).toEqual([]);
  });

  it('bounds the body: a declared or streamed oversize is 413, junk is 400', async () => {
    expect((await POST(req('POST', SUBSCRIPTION, { 'content-length': '999999' }))).status).toBe(413);
    expect((await POST(req('POST', JSON.stringify({ ...SUBSCRIPTION, pad: 'x'.repeat(10_000) })))).status).toBe(413);
    expect((await POST(req('POST', '{not json'))).status).toBe(400);
    expect((await POST(req('POST', { ...SUBSCRIPTION, endpoint: 'https://evil.example/x' }))).status).toBe(400);
    expect((await DELETE(req('DELETE', { nope: true }))).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it('upserts the device by endpoint for the signed-in reader', async () => {
    const first = await POST(req('POST', SUBSCRIPTION));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    await POST(req('POST', SUBSCRIPTION));
    expect(await rows()).toEqual([{ user_id: USER, endpoint: ENDPOINT, revoked_at: null, user_agent: 'Mozilla/5.0 (Linux; Android 15)' }]);
  });

  it('turns push off by revoking, only for the owner, keeping the row', async () => {
    await POST(req('POST', SUBSCRIPTION));
    mocks.viewer.mockResolvedValue({ userId: OTHER });
    const stranger = await DELETE(req('DELETE', { endpoint: ENDPOINT }));
    expect(await stranger.json()).toEqual({ ok: true, revoked: 0 });
    expect((await rows())[0]!.revoked_at).toBeNull();

    mocks.viewer.mockResolvedValue({ userId: USER });
    const own = await DELETE(req('DELETE', { endpoint: ENDPOINT }));
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ ok: true, revoked: 1 });
    const [row] = await rows();
    expect(row!.revoked_at).toBeInstanceOf(Date);

    // Subscribing again brings the same row back to life.
    await POST(req('POST', SUBSCRIPTION));
    expect((await rows()).map((r) => r.revoked_at)).toEqual([null]);
  });

  it('answers 503 when push is not configured here, or the store is missing', async () => {
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', '');
    const off = await POST(req('POST', SUBSCRIPTION));
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ ok: false, code: 'push_unavailable' });
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', KEYS.privateKey);
    mocks.sql.mockResolvedValue(null);
    expect((await POST(req('POST', SUBSCRIPTION))).status).toBe(503);
  });

  it('answers 503, not 500, when the table is not in this database yet', async () => {
    await sql.query('drop table push_subscriptions');
    const res = await POST(req('POST', SUBSCRIPTION));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: 'unavailable' });
  });
});
