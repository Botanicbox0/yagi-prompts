import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import webPush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';
import { testPushKeys } from '../../helpers/push';
import { noticeEnv } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §10 — the customer's notice settings: the mail switch's route, this
 * browser's push route, the inbox section that uses them, the worker on brand pages, and the brand host
 * letting exactly these through. While `BRAND_ROOM_NOTIFY` is off every one of them answers as if it
 * did not exist; sandboxed and generation-closed brands get the same 404 as everywhere in rooms.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: mocks.viewer, sql: mocks.sql, verifiedEmail: undefined, brandHost: false, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});

const prefsRoute = await import('@/app/api/brand-rooms/notice-prefs/route');
const pushRoute = await import('@/app/api/brand-rooms/notice-push/route');
const inboxPage = (await import('@/app/(brand)/brand/rooms/page')).default;

const PREFS = 'http://localhost:3000/api/brand-rooms/notice-prefs';
const PUSH = 'http://localhost:3000/api/brand-rooms/notice-push';

let f: StudioFixture | null = null;
const fx = () => f!;

async function fixture(options: { orgId?: string; orgName?: string; policy?: boolean } = {}) {
  f = await studioFixture({ orgId: options.orgId, orgName: options.orgName });
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  if (options.policy) await f.sql.query(`insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media'])`, [f.orgId]);
  return f;
}

function vapid(): void {
  const keys = webPush.generateVAPIDKeys();
  vi.stubEnv('WEB_PUSH_PUBLIC_KEY', keys.publicKey);
  vi.stubEnv('WEB_PUSH_PRIVATE_KEY', keys.privateKey);
  vi.stubEnv('WEB_PUSH_SUBJECT', 'mailto:hello@twings.app');
}

const getPrefs = (organizationId: string) => prefsRoute.GET(new NextRequest(`${PREFS}?organizationId=${organizationId}`));
const postPrefs = (body: unknown, headers: Record<string, string> = {}) =>
  prefsRoute.POST(new NextRequest(PREFS, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const pushCall = (method: 'POST' | 'DELETE', organizationId: string, body: unknown, headers: Record<string, string> = {}) =>
  (method === 'POST' ? pushRoute.POST : pushRoute.DELETE)(
    new NextRequest(`${PUSH}?organizationId=${organizationId}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
  );
const subscription = (name = 'brand-device') => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, expirationTime: null, keys: testPushKeys() });

beforeEach(() => noticeEnv());
afterEach(async () => {
  vi.unstubAllEnvs();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
});

describe('/api/brand-rooms/notice-prefs', () => {
  it('reads and switches this member’s room mail for one brand, privately and uncached', async () => {
    await fixture();
    const first = await getPrefs(fx().orgId);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(await first.json()).toEqual({ ok: true, emailEnabled: true });
    const saved = await postPrefs({ organizationId: fx().orgId, emailEnabled: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, emailEnabled: false });
    expect(await (await getPrefs(fx().orgId)).json()).toEqual({ ok: true, emailEnabled: false });
    expect(await (await postPrefs({ organizationId: fx().orgId, emailEnabled: true })).json()).toEqual({ ok: true, emailEnabled: true });
    // Nobody else's switch moved.
    await postPrefs({ organizationId: fx().orgId, emailEnabled: false });
    mocks.viewer = viewerOf(fx().ids.editor);
    expect(await (await getPrefs(fx().orgId)).json()).toEqual({ ok: true, emailEnabled: true });
  });

  it('lets a project guest switch their own mail', async () => {
    await fixture();
    mocks.viewer = viewerOf(fx().ids.guest);
    expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: false })).status).toBe(200);
    expect(await (await getPrefs(fx().orgId)).json()).toEqual({ ok: true, emailEnabled: false });
  });

  it('answers as if it did not exist while room notices are off, or rooms are', async () => {
    await fixture();
    for (const [key, value] of [
      ['BRAND_ROOM_NOTIFY', 'off'],
      ['BRAND_ROOMS', 'off'],
    ] as const) {
      noticeEnv({ [key]: value });
      const read = await getPrefs(fx().orgId);
      expect(read.status, key).toBe(404);
      expect(await read.json()).toEqual({ ok: false, code: 'rooms_closed' });
      expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: false })).status, key).toBe(404);
    }
    noticeEnv();
    expect(await (await getPrefs(fx().orgId)).json()).toEqual({ ok: true, emailEnabled: true });
  });

  it('refuses no session (401), another origin (403) and a body that is not the switch (400)', async () => {
    await fixture();
    mocks.viewer = null;
    expect((await getPrefs(fx().orgId)).status).toBe(401);
    expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: false })).status).toBe(401);
    mocks.viewer = viewerOf(fx().ids.owner);
    expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: false }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await postPrefs('not json')).status).toBe(400);
    expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: 'no' })).status).toBe(400);
    expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: false, userId: fx().ids.editor })).status).toBe(400);
    expect(await (await getPrefs(fx().orgId)).json()).toEqual({ ok: true, emailEnabled: true });
  });

  it('gives a person without a seat, and another brand, the same 404', async () => {
    await fixture();
    mocks.viewer = viewerOf(fx().ids.outsider);
    expect((await getPrefs(fx().orgId)).status).toBe(404);
    expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: false })).status).toBe(404);
    // The owner, pointing at a brand they are not in.
    const other = randomUUID();
    await fx().sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', fx().ids.outsider, randomUUID()]);
    mocks.viewer = viewerOf(fx().ids.owner);
    expect((await getPrefs(other)).status).toBe(404);
    expect((await postPrefs({ organizationId: other, emailEnabled: false })).status).toBe(404);
    expect((await fx().sql.query('select 1 from brand_room_notice_prefs')).rows).toEqual([]);
  });
});

const closedCases: Array<{ label: string; orgId?: string; orgName?: string; policy?: boolean }> = [
  { label: `sandboxed id ${[...SANDBOXED_CLIENT_ORG_IDS][0]}`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]! },
  { label: `sandboxed id ${[...SANDBOXED_CLIENT_ORG_IDS][1]}`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][1]! },
  { label: 'named "Morphic Korea"', orgName: 'Morphic Korea' },
  { label: 'named "모픽"', orgName: '모픽' },
  { label: 'generative media closed by policy', policy: true },
];

describe.each(closedCases)('closed brand ($label), notices on', (options) => {
  it('404s both routes and renders no inbox (and so no settings)', async () => {
    vapid();
    await fixture(options);
    expect((await getPrefs(fx().orgId)).status).toBe(404);
    expect((await postPrefs({ organizationId: fx().orgId, emailEnabled: false })).status).toBe(404);
    expect((await pushCall('POST', fx().orgId, subscription())).status).toBe(404);
    expect((await pushCall('DELETE', fx().orgId, { endpoint: subscription().endpoint })).status).toBe(404);
    expect((await fx().sql.query('select 1 from push_subscriptions')).rows).toEqual([]);
    expect((await fx().sql.query('select 1 from brand_room_notice_prefs')).rows).toEqual([]);
    const error = await inboxPage({ searchParams: Promise.resolve({ organizationId: fx().orgId }) }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((error as { digest?: string } | null)?.digest ?? error)).toContain('404');
  });
});

describe('/api/brand-rooms/notice-push', () => {
  it('stores this browser for the signed-in member, then takes it back', async () => {
    vapid();
    await fixture();
    const sub = subscription();
    const saved = await pushCall('POST', fx().orgId, sub, { 'user-agent': 'Test browser' });
    expect(saved.status).toBe(200);
    expect(saved.headers.get('cache-control')).toBe('private, no-store');
    expect(await saved.json()).toEqual({ ok: true });
    const rows = (await fx().sql.query<{ user_id: string; endpoint: string; revoked_at: Date | null }>('select user_id::text as user_id, endpoint, revoked_at from push_subscriptions')).rows;
    expect(rows).toEqual([{ user_id: fx().ids.owner, endpoint: sub.endpoint, revoked_at: null }]);
    const gone = await pushCall('DELETE', fx().orgId, { endpoint: sub.endpoint });
    expect(await gone.json()).toEqual({ ok: true, revoked: 1 });
    expect((await fx().sql.query<{ revoked_at: Date | null }>('select revoked_at from push_subscriptions')).rows[0]!.revoked_at).not.toBeNull();
  });

  it('answers as if it did not exist while room notices are off', async () => {
    vapid();
    await fixture();
    noticeEnv({ BRAND_ROOM_NOTIFY: 'off' });
    const response = await pushCall('POST', fx().orgId, subscription());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: 'rooms_closed' });
    expect((await pushCall('DELETE', fx().orgId, { endpoint: subscription().endpoint })).status).toBe(404);
    expect((await fx().sql.query('select 1 from push_subscriptions')).rows).toEqual([]);
  });

  it('refuses no session, another origin, no seat, no keys here, and anything that is not a real push service', async () => {
    vapid();
    await fixture();
    mocks.viewer = null;
    expect((await pushCall('POST', fx().orgId, subscription())).status).toBe(401);
    mocks.viewer = viewerOf(fx().ids.owner);
    expect((await pushCall('POST', fx().orgId, subscription(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await pushCall('POST', fx().orgId, { ...subscription(), endpoint: 'https://evil.example/push' })).status).toBe(400);
    expect((await pushCall('DELETE', fx().orgId, { endpoint: 'http://127.0.0.1/x' })).status).toBe(400);
    mocks.viewer = viewerOf(fx().ids.outsider);
    expect((await pushCall('POST', fx().orgId, subscription())).status).toBe(404);
    mocks.viewer = viewerOf(fx().ids.owner);
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', '');
    const unconfigured = await pushCall('POST', fx().orgId, subscription());
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({ ok: false, code: 'push_unavailable' });
    expect((await fx().sql.query('select 1 from push_subscriptions')).rows).toEqual([]);
  });
});

describe('the inbox settings section', () => {
  const html = (element: unknown) => renderToStaticMarkup(element as ReactElement);
  const open = () => inboxPage({ searchParams: Promise.resolve({ organizationId: fx().orgId }) });

  it('is not rendered, nor any of its words sent, while room notices are off', async () => {
    vapid();
    await fixture();
    noticeEnv({ BRAND_ROOM_NOTIFY: 'off' });
    const page = (await open()) as ReactElement<{ settings?: unknown }>;
    expect(page.props.settings ?? null).toBeNull();
    const markup = html(page);
    expect(markup).not.toContain('data-room-notice-settings');
    for (const word of ['알림 설정', '이메일 알림', '푸시 알림', 'role="switch"']) expect(markup).not.toContain(word);
  });

  it('hands the inbox plain data, never an element made by the page (the cause of a key warning on every load)', async () => {
    vapid();
    await fixture();
    const page = (await open()) as ReactElement<{ settings?: unknown }>;
    expect(isValidElement(page.props.settings)).toBe(false);
    expect(page.props.settings).toEqual({ copy: getDictionary('ko').roomsNotices.settings, emailEnabled: true, publicKey: expect.any(String) });
    // Nothing the page made sits in the inbox's lists.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    html(page);
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('unique "key"'))).toEqual([]);
    errors.mockRestore();
  });

  it('ends the list with both switches when notices are on, reading the saved mail switch', async () => {
    vapid();
    await fixture();
    await postPrefs({ organizationId: fx().orgId, emailEnabled: false });
    const markup = html(await open());
    expect(markup).toContain('data-room-notice-settings');
    expect(markup).toContain('id="notice-settings"');
    for (const word of ['>알림 설정</h2>', '>이메일 알림</label>', '새 시안, 스토리보드, 메시지, 멘션 알림을 메일로 보내드려요.', '>푸시 알림</label>', '현재 사용 중인 브라우저에서 알림을 보내드려요.']) {
      expect(markup).toContain(word);
    }
    expect(markup.match(/role="switch"/g)).toHaveLength(2);
    expect(markup).toMatch(/data-notice-switch="email"[\s\S]*?role="switch"[^>]*aria-checked="false"/);
  });

  it('leaves out the push switch where this deployment has no push keys', async () => {
    await fixture();
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', '');
    const markup = html(await open());
    expect(markup.match(/role="switch"/g)).toHaveLength(1);
    expect(markup).not.toContain('푸시 알림');
  });
});

describe('the brand host', () => {
  it('lets through exactly the settings routes, the worker and its two icons', () => {
    expect(brandRouteAllowed('/api/brand-rooms/notice-prefs', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/notice-prefs', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/notice-prefs', 'DELETE')).toBe(false);
    expect(brandRouteAllowed('/api/brand-rooms/notice-push', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/notice-push', 'DELETE')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/notice-push', 'GET')).toBe(false);
    for (const path of ['/sw.js', '/icons/icon-192.png', '/icons/badge-96.png']) {
      expect(brandRouteAllowed(path, 'GET'), path).toBe(true);
      expect(brandRouteAllowed(path, 'POST'), path).toBe(false);
    }
    // Still closed here: the consumer push door, the offline page, the manifest, the other icons, the tick.
    for (const path of ['/api/notify/push', '/offline.html', '/manifest.webmanifest', '/icons/icon-512.png', '/icons/maskable-192.png', '/sw.js.map', '/api/brand-rooms/notices/tick']) {
      expect(brandRouteAllowed(path, 'GET'), path).toBe(false);
      expect(brandRouteAllowed(path, 'POST'), path).toBe(false);
    }
  });

  it('registers the worker on brand pages only for a signed-in member, while room notices are on and rooms are open', () => {
    const layout = readFileSync(join(process.cwd(), 'app', '(brand)', 'layout.tsx'), 'utf8');
    expect(layout).toContain('import { RegisterServiceWorker } from "@/components/pwa/register-sw";');
    // `scope` is read only with a session (`viewer.userId` -> sql -> scope), so a signed-out visitor
    // (e.g. /brand/invite) gets no worker.
    expect(layout).toContain('const sql=viewer.userId?await getSqlRunner():null;');
    expect(layout).toMatch(/const scope=sql\?await loadCachedBrandWorkspaceScope\(/);
    expect(layout).toContain('const roomPush=Boolean(scope)&&rooms&&brandRoomNotifyOpen();');
    expect(layout).toContain('{roomPush&&<RegisterServiceWorker />}');
    expect(layout.match(/<RegisterServiceWorker \/>/g)).toHaveLength(1);
    // The worker registers itself on every host but the two that never push.
    const register = readFileSync(join(process.cwd(), 'components', 'pwa', 'register-sw.tsx'), 'utf8');
    expect(register).toContain("['admin.twings.app', 'brands.twings.app'].includes(window.location.hostname)");
  });
});
