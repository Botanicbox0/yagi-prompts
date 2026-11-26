import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import { resetSpineProbe } from '@/lib/brands/project-origin';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { as, closeWorld, openSend, sendWorld, staffViewer, type SendWorld } from '../../brand-rooms/send/helpers';

const navState = vi.hoisted(() => ({
  path: '/brand/studio',
  query: '',
  locale: 'ko' as 'ko' | 'en',
  sql: null as SqlRunner | null,
  viewer: { userId: '', isAdmin: false } as Viewer,
  verifiedEmail: undefined as string | undefined,
  cookieMap: {} as Record<string, string>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(navState.query),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (navState.cookieMap[name] ? { value: navState.cookieMap[name] } : undefined),
  }),
}));

vi.mock('@/app/fonts', () => ({ fontVariables: '' }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => navState.locale }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ brand: true, origin: 'https://brand.twings.app' }),
}));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => navState.viewer }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => navState.verifiedEmail }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => navState.sql }));

vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({ summary: null, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
    useRoomUnread: () => 0,
  };
});

const mocks = vi.hoisted(() => ({
  loadRoomBell: vi.fn(),
  loadSendBell: vi.fn(),
}));

vi.mock('@/components/brand-rooms/chat/transport', () => ({
  loadRoomBell: (...args: unknown[]) => mocks.loadRoomBell(...args),
  loadSendBell: (...args: unknown[]) => mocks.loadSendBell(...args),
  brandTransport: () => ({ read: vi.fn() }),
  sendTransport: () => ({ read: vi.fn(), readAll: vi.fn() }),
}));

import BrandLayout from '@/app/(brand)/layout';
import { pickBellCopy, pickBellSendCopy } from '@/components/brand-workspace/bell/model';
import { BellProvider } from '@/components/brand-workspace/bell/provider';
import { RAIL_MODE_COOKIE, pathRailMode, rememberRailMode, resolveRailMode } from '@/components/brand-workspace/rail-mode';
import { RAIL_HREF, railActive, railItemHref } from '@/components/brand-workspace/rail-model';
import { RailNavigation, type RailNavigationProps } from '@/components/brand-workspace/rail-nav';

const KO = getDictionary('ko');
const ORG = 'a0000000-0000-4000-8000-0000000000a1';

const SCOPE: BrandWorkspaceScope = {
  choices: [{ id: ORG, name: 'Alpha', role: 'owner', logoUrl: null }],
  projectOrganizations: {},
};

const railProps = (over: Partial<RailNavigationProps> = {}): RailNavigationProps => ({
  organizationId: ORG,
  studio: true,
  creators: true,
  identity: true,
  team: true,
  billing: true,
  settings: true,
  canCreate: true,
  copy: KO.studioShell,
  locale: 'ko',
  initialExpanded: true,
  scope: (p) => `${p}?organizationId=${ORG}`,
  rooms: true,
  roomsCopy: KO.roomsShell.nav,
  home: KO.brandHome.nav.home,
  ...over,
});

describe('Slice 4b Batch B rail link & mode memory neutrality', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    navState.path = '/brand/studio';
    navState.query = `organizationId=${ORG}`;
    navState.cookieMap = {};
    mocks.loadRoomBell.mockReset();
    mocks.loadSendBell.mockReset();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
  });

  it('railItemHref & railActive point make-mode messages to /brand/inbox only with makeInbox+sendInbox and keep /brand/rooms otherwise', () => {
    expect(RAIL_HREF.messages).toBe('/brand/rooms');
    expect(railItemHref('messages')).toBe('/brand/rooms');
    expect(railItemHref('messages', { makeInbox: true, sendInbox: false })).toBe('/brand/rooms');
    expect(railItemHref('messages', { makeInbox: false, sendInbox: true })).toBe('/brand/rooms');
    expect(railItemHref('messages', { makeInbox: true, sendInbox: true })).toBe('/brand/inbox');

    expect(railActive('/brand/inbox', '/brand/inbox')).toBe(true);
    expect(railActive('/brand/inbox', '/brand/inbox/')).toBe(true);
    expect(railActive('/brand/inbox', '/brand/rooms')).toBe(false);
    expect(railActive('/brand/rooms', '/brand/inbox')).toBe(false);
  });

  it('renders make-mode rail row at /brand/inbox with send prop, marks aria-current on /brand/inbox, and keeps mode memory from flipping', async () => {
    navState.path = '/brand/inbox';
    mocks.loadSendBell.mockResolvedValue({
      ok: true,
      unread: 2,
      channels: [],
      alerts: [],
      bell: { unread: 2, items: [], more: false, view: 'all', mentionsUnread: 1 },
    });

    mounted = await mountDom(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        railModes={{ [ORG]: 'make' }}
        rooms
        bellCopy={pickBellCopy(KO)}
        send={{ organizations: [ORG], copy: pickBellSendCopy(KO) }}
      >
        <RailNavigation {...railProps({ modeMemory: { [ORG]: 'make' } })} />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const inboxLink = mounted.query('[data-rail-inbox]');
    expect(inboxLink?.getAttribute('href')).toBe(`/brand/inbox?organizationId=${ORG}`);
    expect(inboxLink?.getAttribute('aria-current')).toBe('page');
    expect(mounted.query('[data-rail-badge="messages"] [aria-hidden="true"]')?.textContent).toBe('2');
    expect(mounted.query('[data-brand-layout-mode="rail"]')?.getAttribute('data-rail-mode')).toBe('make');
    // Visiting /brand/inbox must NOT flip or write team mode into twings_brand_mode cookie
    expect((mounted.document as unknown as { cookie?: string }).cookie ?? '').toBe('');
    expect(pathRailMode('/brand/inbox')).toBeNull();
    expect(resolveRailMode({ studio: true, rooms: true, path: '/brand/inbox', remembered: 'make' })).toBe('make');
    expect(resolveRailMode({ studio: true, rooms: true, path: '/brand/inbox', remembered: 'team' })).toBe('team');

    // Contrast: visiting /brand/rooms DOES flip mode memory to team
    const cookieWrites: string[] = [];
    let cookieStore = `${RAIL_MODE_COOKIE}=${encodeURIComponent(`${ORG}:make`)}`;
    Object.defineProperty(globalThis.window, 'location', {
      configurable: true,
      value: { protocol: 'http:' },
    });
    Object.defineProperty(mounted.document, 'cookie', {
      configurable: true,
      get: () => cookieStore,
      set: (val: string) => {
        cookieWrites.push(val);
        cookieStore = val;
      },
    });
    navState.path = '/brand/rooms';
    await mounted.rerender(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        railModes={{ [ORG]: 'make' }}
        rooms
        bellCopy={pickBellCopy(KO)}
        send={{ organizations: [ORG], copy: pickBellSendCopy(KO) }}
      >
        <RailNavigation {...railProps({ modeMemory: { [ORG]: 'make' } })} />
      </BellProvider>,
    );
    expect(cookieWrites.some((c) => decodeURIComponent(c).includes(`${ORG}:team`))).toBe(true);
  });

  it('keeps /brand/inbox team-mode memory intact without flipping to make or calling send bell', () => {
    navState.path = '/brand/inbox';
    const html = renderToStaticMarkup(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        railModes={{ [ORG]: 'team' }}
        rooms
        bellCopy={pickBellCopy(KO)}
        send={{ organizations: [ORG], copy: pickBellSendCopy(KO) }}
      >
        <RailNavigation {...railProps({ modeMemory: { [ORG]: 'team' } })} />
      </BellProvider>,
    );
    expect(html).toContain('data-rail-mode="team"');
    expect(html).not.toContain('data-rail-inbox');
    expect(html).toContain(`href="/brand/rooms?organizationId=${ORG}"`);
  });
});

describe('BrandLayout send computation beside bellCandidates (PGlite)', () => {
  let w: SendWorld;

  beforeEach(async () => {
    w = await sendWorld();
    navState.sql = w.f.sql;
    navState.locale = 'ko';
    navState.path = '/brand/studio';
    navState.query = `organizationId=${w.f.orgId}`;
    navState.cookieMap = { [RAIL_MODE_COOKIE]: rememberRailMode({}, w.f.orgId, 'make') };
    navState.verifiedEmail = undefined;
    navState.viewer = as(w.f.ids.owner);
    openSend(w.f.orgId);
    resetSpineProbe();
    resetBrandSendProbe();
  });

  afterEach(async () => {
    await closeWorld(w);
  });

  it('passes send to BellProvider and points make-mode rail to /brand/inbox when open, and leaves rail at /brand/rooms when BRAND_SEND is off or schema 0200 missing or non-member', async () => {
    const openHtml = renderToStaticMarkup(await BrandLayout({ children: <div data-child /> }));
    expect(openHtml).toContain(`data-rail-inbox=""`);
    expect(openHtml).toContain(`href="/brand/inbox?organizationId=${w.f.orgId}"`);

    // On /brand/inbox with remembered make mode, layout keeps make mode and marks inbox current
    navState.path = '/brand/inbox';
    const inboxHtml = renderToStaticMarkup(await BrandLayout({ children: <div data-child /> }));
    expect(inboxHtml).toContain('data-rail-mode="make"');
    expect(inboxHtml).toContain(`href="/brand/inbox?organizationId=${w.f.orgId}"`);
    expect(inboxHtml).toContain('aria-current="page"');

    // BRAND_SEND off -> bell still opens for 3a, rail points back to /brand/rooms
    navState.path = '/brand/studio';
    vi.stubEnv('BRAND_SEND', 'off');
    resetBrandSendProbe();
    const sendOffHtml = renderToStaticMarkup(await BrandLayout({ children: <div data-child /> }));
    expect(sendOffHtml).toContain('data-rail-inbox=""');
    expect(sendOffHtml).toContain(`href="/brand/rooms?organizationId=${w.f.orgId}"`);

    // 0200 dropped -> zero error, rail points to /brand/rooms
    vi.stubEnv('BRAND_SEND', 'on');
    await w.f.sql.query('drop table brand_room_thread_reads');
    resetBrandSendProbe();
    const pre0200Html = renderToStaticMarkup(await BrandLayout({ children: <div data-child /> }));
    expect(pre0200Html).toContain(`href="/brand/rooms?organizationId=${w.f.orgId}"`);

    // Staff non-member -> no make inbox row
    openSend(w.f.orgId);
    navState.viewer = staffViewer(w);
    navState.verifiedEmail = 'staff@twings.app';
    const staffHtml = renderToStaticMarkup(await BrandLayout({ children: <div data-child /> }));
    expect(staffHtml).not.toContain('data-rail-inbox');
  });
});
