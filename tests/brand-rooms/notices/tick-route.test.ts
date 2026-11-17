import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import { enqueueNotices } from '@/lib/brand-rooms/notices';
import { noticeEnv, noticeFixture, noticeRows, type NoticeFixture } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2.2 — the 10-minute tick: private behind `CRON_SECRET` like the other
 * ticks, inert with the flag off, one pass otherwise (fake mailer, nothing leaves the machine).
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, mailer: null as FakeMailer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/notify/service', () => ({ getMailer: () => mocks.mailer }));
const { GET, POST } = await import('@/app/api/brand-rooms/notices/tick/route');

const TICK_URL = 'https://twings.app/api/brand-rooms/notices/tick';
let f: NoticeFixture;

beforeEach(async () => {
  noticeEnv({ CRON_SECRET: 'fixture-cron-secret', WEB_PUSH_PUBLIC_KEY: '', WEB_PUSH_PRIVATE_KEY: '', WEB_PUSH_SUBJECT: '' });
  f = await noticeFixture();
  mocks.sql = f.sql;
  mocks.mailer = createFakeMailer();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const authorized = () => new Request(TICK_URL, { headers: { authorization: 'Bearer fixture-cron-secret' } });

describe('/api/brand-rooms/notices/tick', () => {
  it('refuses without the cron secret configured, without a bearer and with a wrong one', async () => {
    await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner });
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(authorized())).status).toBe(503);
    vi.stubEnv('CRON_SECRET', 'fixture-cron-secret');
    expect((await GET(new Request(TICK_URL))).status).toBe(401);
    expect((await GET(new Request(TICK_URL, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect((await POST(new Request(TICK_URL, { method: 'POST', headers: { authorization: 'fixture-cron-secret' } }))).status).toBe(401);
    expect(mocks.mailer!.sent).toEqual([]);
    expect((await noticeRows(f.sql))[0]).toMatchObject({ state: 'pending' });
  });

  it('returns at once with the flag off', async () => {
    await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner });
    vi.stubEnv('BRAND_ROOM_NOTIFY', 'off');
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ran: false });
    expect(mocks.mailer!.sent).toEqual([]);
  });

  it('runs one pass with the right bearer, counts only in the answer', async () => {
    await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner });
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, ran: true, mails: 1, sent: 1 });
    expect(JSON.stringify(body)).not.toContain('@');
    expect(mocks.mailer!.sent).toHaveLength(1);
    expect(mocks.mailer!.sent[0]!.to).toBe('owner@example.test');
  });
});
