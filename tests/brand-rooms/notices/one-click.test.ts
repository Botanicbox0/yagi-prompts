import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { loadRoomNoticePrefs } from '@/lib/brand-rooms/notice-prefs';
import { renderUnsubscribed, renderUnsubscribeInvalid } from '@/lib/notify/unsubscribe-page';
import { ROOM_EMAIL_SCOPE, unsubscribePath } from '@/lib/notify/unsubscribe';
import { viewerOf } from '../../brand-studio/server/helpers';
import { noticeEnv, noticeFixture, type NoticeFixture } from './helpers';

/**
 * RFC 8058 one-click unsubscribe (docs/BRAND-ROOMS-FEEDBACK.md §2.2 follow-up). The live mailer sends
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so a mail provider POSTs the same signed URL: no
 * cookies, no Origin. The POST applies the token exactly like the GET (every scope) and answers 200 with
 * no page; the GET keeps its pages byte for byte.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({ user: null, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (r: NextResponse) => r,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
const { GET, POST } = await import('@/app/api/notify/unsubscribe/route');
const { middleware } = await import('@/middleware');

let f: NoticeFixture;

beforeEach(async () => {
  noticeEnv();
  f = await noticeFixture();
  mocks.sql = f.sql;
  await f.sql.query('update profiles set notif_new_playbook = true, notif_updates = true where id = $1', [f.ids.owner]);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

/** What a mail provider sends: the link from the header, a form body, nothing else. */
const oneClick = (path: string) =>
  POST(
    new Request(`https://twings.app${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    }),
  );
const toggles = async () =>
  (await f.sql.query<{ notif_new_playbook: boolean; notif_updates: boolean }>('select notif_new_playbook, notif_updates from profiles where id = $1', [f.ids.owner])).rows[0]!;

describe('POST /api/notify/unsubscribe (one click)', () => {
  it('switches the room mail off for that organization: 200, no page', async () => {
    const response = await oneClick(unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: false });
    expect(await toggles()).toEqual({ notif_new_playbook: true, notif_updates: true });
  });

  it.each(['notif_new_playbook', 'notif_updates'] as const)('switches the profile toggle %s off', async (toggle) => {
    const response = await oneClick(unsubscribePath({ userId: f.ids.owner, toggle }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect((await toggles())[toggle]).toBe(false);
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: true });
  });

  it('answers a bad, missing or orphaned token like the GET does (400) and changes nothing', async () => {
    const good = unsubscribePath({ userId: f.ids.owner, toggle: 'notif_updates' });
    expect((await oneClick(`${good}x`)).status).toBe(400);
    expect((await oneClick('/api/notify/unsubscribe')).status).toBe(400);
    expect((await oneClick(unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: '00000000-0000-4000-8000-000000000000' }))).status).toBe(400);
    expect(await toggles()).toEqual({ notif_new_playbook: true, notif_updates: true });
  });
});

describe('GET /api/notify/unsubscribe stays as it was', () => {
  it('renders the same confirmation and refusal pages', async () => {
    const done = await GET(new Request(`https://twings.app${unsubscribePath({ userId: f.ids.owner, toggle: 'notif_updates' })}`));
    expect(done.status).toBe(200);
    expect(await done.text()).toBe(renderUnsubscribed({ locale: 'en', toggle: 'notif_updates' }));
    expect(done.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const bad = await GET(new Request('https://twings.app/api/notify/unsubscribe?t=nope'));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe(renderUnsubscribeInvalid('en'));
  });
});

describe('the host boundary lets the provider’s POST through on this path only', () => {
  const req = (host: string, path: string, method = 'POST') => new NextRequest(`https://${host}${path}`, { method, headers: { host } });

  it('passes a cookie-less, Origin-less POST on twings.app', async () => {
    const path = unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId });
    expect((await middleware(req('twings.app', path))).headers.get('x-middleware-next')).toBe('1');
  });

  it('still refuses it on the brand and admin hosts (the links never point there)', async () => {
    const path = unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId });
    expect((await middleware(req('brand.twings.app', path))).status).toBe(404);
    expect((await middleware(req('admin.twings.app', path))).status).toBe(404);
  });
});
