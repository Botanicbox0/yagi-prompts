import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { loadRoomNoticePrefs } from '@/lib/brand-rooms/notice-prefs';
import { ROOM_EMAIL_SCOPE, signUnsubscribeToken, unsubscribePath, verifyUnsubscribeToken } from '@/lib/notify/unsubscribe';
import { viewerOf } from '../../brand-studio/server/helpers';
import { noticeEnv, noticeFixture, type NoticeFixture } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2.2 — the project room scope of the signed unsubscribe link: it names a
 * person and an organization, can only switch that organization's room mail off, and works without a
 * session. The profile toggles' tokens keep their exact bytes and their behaviour.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
const { GET } = await import('@/app/api/notify/unsubscribe/route');

const SECRET = 'test-only-room-notice-secret-0000000000';
let f: NoticeFixture;

beforeEach(async () => {
  noticeEnv();
  f = await noticeFixture();
  mocks.sql = f.sql;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const open = (path: string) => GET(new Request(`https://twings.app${path}`));

describe('room mail scope of the unsubscribe token', () => {
  it('round-trips the person and the organization', () => {
    const claims = { userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId };
    expect(verifyUnsubscribeToken(signUnsubscribeToken(claims, SECRET), { secret: SECRET })).toEqual({ ok: true, claims });
  });

  it('refuses a token moved to another organization', () => {
    const token = signUnsubscribeToken({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId }, SECRET);
    const [, signature] = token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ u: f.ids.owner, t: ROOM_EMAIL_SCOPE, o: '00000000-0000-4000-8000-000000000000' })).toString('base64url');
    expect(verifyUnsubscribeToken(`${forged}.${signature}`, { secret: SECRET })).toEqual({ ok: false, reason: 'bad_signature' });
    const noOrg = Buffer.from(JSON.stringify({ u: f.ids.owner, t: ROOM_EMAIL_SCOPE })).toString('base64url');
    const signed = `${noOrg}.${signUnsubscribeToken({ userId: f.ids.owner, toggle: 'notif_updates' }, SECRET).split('.')[1]}`;
    expect(verifyUnsubscribeToken(signed, { secret: SECRET }).ok).toBe(false);
  });

  it('leaves the profile toggles’ tokens byte for byte as they were', () => {
    const token = signUnsubscribeToken({ userId: f.ids.owner, toggle: 'notif_updates' }, SECRET);
    const payload = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'));
    expect(payload).toEqual({ u: f.ids.owner, t: 'notif_updates' });
    expect(verifyUnsubscribeToken(token, { secret: SECRET })).toEqual({ ok: true, claims: { userId: f.ids.owner, toggle: 'notif_updates' } });
  });
});

describe('/api/notify/unsubscribe with the room scope', () => {
  it('switches that organization’s room mail off without a session, and again is the same', async () => {
    await f.sql.query('update profiles set notif_updates = true where id = $1', [f.ids.owner]);
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: true });
    const path = unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId });
    const first = await open(path);
    expect(first.status).toBe(200);
    const html = await first.text();
    expect(html).toContain('You will not get project emails from this organization any more.');
    expect(html).toContain('https://brand.twings.app/brand/rooms');
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: false });
    expect((await open(path)).status).toBe(200);
    // Nobody else's switch moved, and the profile toggles did not either.
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.editor), f.orgId)).toEqual({ ok: true, emailEnabled: true });
    expect((await f.sql.query<{ notif_updates: boolean }>('select notif_updates from profiles where id = $1', [f.ids.owner])).rows[0]!.notif_updates).toBe(true);
  });

  it('answers in the person’s language', async () => {
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.owner]);
    const html = await (await open(unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId }))).text();
    expect(html).toContain('이 조직의 프로젝트 메일을 더 보내지 않아요.');
  });

  it('says the link is not valid for an organization that no longer exists', async () => {
    const path = unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: '00000000-0000-4000-8000-000000000000' });
    expect((await open(path)).status).toBe(400);
  });

  it('still switches the profile toggles off with the old scopes', async () => {
    await f.sql.query('update profiles set notif_updates = true where id = $1', [f.ids.owner]);
    const response = await open(unsubscribePath({ userId: f.ids.owner, toggle: 'notif_updates' }));
    expect(response.status).toBe(200);
    expect((await f.sql.query<{ notif_updates: boolean }>('select notif_updates from profiles where id = $1', [f.ids.owner])).rows[0]!.notif_updates).toBe(false);
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: true });
  });
});
