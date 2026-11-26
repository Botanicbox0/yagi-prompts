import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ROOM_ACTIVITY } from '@/components/brand-rooms/seams';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const navState = vi.hoisted(() => ({ path: '/brand/studio', query: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(navState.query),
}));

const bellMocks = vi.hoisted(() => ({
  loadRoomBell: vi.fn(),
  readChannel: vi.fn(),
}));

vi.mock('@/components/brand-rooms/chat/transport', () => ({
  loadRoomBell: (...args: unknown[]) => bellMocks.loadRoomBell(...args),
  brandTransport: (organizationId: string) => ({
    read: (channel: string, at: string) => bellMocks.readChannel(organizationId, channel, at),
  }),
}));

import { BellProvider } from '@/components/brand-workspace/bell/provider';
import { BELL_POLL_MS, type BellState } from '@/components/brand-workspace/bell/model';
import {
  RAIL_HREF,
  dropInGroup,
  groupItems,
  moveInGroup,
  railItems,
  railTier,
  railTiers,
} from '@/components/brand-workspace/rail-model';
import { RailNavigation, type RailNavigationProps } from '@/components/brand-workspace/rail-nav';

const ko = getDictionary('ko');
const en = getDictionary('en');

const ORG = 'a0000000-0000-4000-8000-0000000000a1';

const scopeOf = (choices: BrandWorkspaceScope['choices'] = [{ id: ORG, name: 'Alpha', role: 'owner', logoUrl: null }]): BrandWorkspaceScope => ({
  choices,
  projectOrganizations: {},
});

const bellSample = (over: Partial<BellState> = {}): BellState => ({
  unread: 3,
  items: [
    {
      id: 'channel:general',
      kind: 'conversation',
      projectId: null,
      projectTitle: null,
      title: null,
      line: 'Question about schedule',
      version: null,
      openNotes: 0,
      unreadCount: 2,
      at: '2026-11-26T03:00:00.000Z',
      unread: true,
      thumbUrl: null,
      href: `/brand/rooms?organizationId=${ORG}&channel=general`,
    },
  ],
  more: false,
  ...over,
});

const baseProps = (over: Partial<RailNavigationProps> = {}): RailNavigationProps => ({
  organizationId: ORG,
  studio: true,
  creators: true,
  identity: true,
  team: true,
  billing: true,
  settings: true,
  canCreate: true,
  copy: ko.studioShell,
  locale: 'ko',
  initialExpanded: true,
  scope: (p) => `${p}?organizationId=${ORG}`,
  rooms: true,
  roomsCopy: ko.roomsShell.nav,
  home: ko.brandHome.nav.home,
  ...over,
});

describe('rail-model with makeInbox', () => {
  const all = railItems({ studio: true, creators: true, identity: true, rooms: true });

  it('keeps single-arg railTier and default groupItems untouched without makeInbox', () => {
    expect(railTier('messages')).toBe('main');
    expect(groupItems(all, []).make).toEqual(['image', 'video', 'compose', 'workflows', 'assets']);
    expect(groupItems(all, []).team).toEqual(['campaigns', 'messages']);
  });

  it('places messages in make lower band after workflows and restricts movement to lower band', () => {
    expect(railTier('messages', 'make')).toBe('lower');
    expect(railTier('messages', 'team')).toBe('main');

    const groups = groupItems(all, [], { makeInbox: true });
    expect(groups.make).toEqual(['image', 'video', 'compose', 'workflows', 'assets', 'messages']);
    expect(railTiers(groups.make, 'make')).toEqual({
      main: ['image', 'video', 'compose', 'assets'],
      lower: ['workflows', 'messages'],
    });

    const movedUp = moveInGroup(groups, 'messages', -1, 'make', true);
    expect(movedUp.filter((id) => id === 'messages')).toHaveLength(1);
    const afterUp = groupItems(all, movedUp.map((id) => RAIL_HREF[id]), { makeInbox: true });
    expect(railTiers(afterUp.make, 'make').lower).toEqual(['messages', 'workflows']);
    expect(railTiers(afterUp.make, 'make').main).toEqual(['image', 'video', 'compose', 'assets']);

    const capped = moveInGroup(afterUp, 'messages', -1, 'make', true);
    expect(railTiers(groupItems(all, capped.map((id) => RAIL_HREF[id]), { makeInbox: true }).make, 'make').lower).toEqual([
      'messages',
      'workflows',
    ]);

    expect(dropInGroup(groups, 'messages', 'assets', 'make', true)).toBeNull();
    expect(dropInGroup(groups, 'assets', 'workflows', 'make', true)).toBeNull();
    const swapped = dropInGroup(groups, 'messages', 'workflows', 'make', true);
    expect(swapped).not.toBeNull();
    expect(swapped!.filter((id) => id === 'messages')).toHaveLength(1);
  });
});

describe('RailNavigation 알림함 row with BellProvider', () => {
  const prevFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    navState.path = '/brand/studio';
    navState.query = '';
    bellMocks.loadRoomBell.mockReset();
    bellMocks.readChannel.mockReset();
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, unread: 4, channels: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    globalThis.fetch = prevFetch;
    vi.useRealTimers();
  });

  it('renders 알림함 in lower group after 워크플로우 with bell.unread and link in 직접 만들기', async () => {
    bellMocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 3, channels: [], bell: bellSample({ unread: 3 }) });
    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={scopeOf()} rooms>
        <RailNavigation {...baseProps()} />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const lowerItems = [...mounted.queryAll('[data-rail-group="lower"] [data-rail-item]')].map((el) =>
      el.getAttribute('data-rail-item'),
    );
    expect(lowerItems).toEqual(['workflows', 'messages']);

    const inboxLink = mounted.query('[data-rail-inbox]');
    expect(inboxLink).not.toBeNull();
    expect(inboxLink?.getAttribute('href')).toBe(`/brand/rooms?organizationId=${ORG}`);
    expect(inboxLink?.textContent).toContain(ko.roomsShell.nav.messages);
    const badge = mounted.query('[data-rail-badge="messages"]');
    expect(badge?.textContent).toBe('3확인할 알림 3개');
  });

  it('shows no number before the first mount answer and shows 0/English copy when unread is 0', async () => {
    const waitingHtml = renderToStaticMarkup(
      <BellProvider candidates={[ORG]} scope={scopeOf()} rooms>
        <RailNavigation {...baseProps()} />
      </BellProvider>,
    );
    expect(waitingHtml).toContain('data-rail-inbox=""');
    expect(waitingHtml).not.toContain('data-rail-badge="messages"');

    bellMocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 0, channels: [], bell: bellSample({ unread: 0 }) });
    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={scopeOf()} rooms>
        <RailNavigation {...baseProps({ locale: 'en', copy: en.studioShell, roomsCopy: en.roomsShell.nav, home: en.brandHome.nav.home })} />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-rail-inbox]')).not.toBeNull();
    expect(mounted.query('[data-rail-badge="messages"]')).toBeNull();
    expect(mounted.query('[data-rail-inbox]')?.textContent).toContain(en.roomsShell.nav.messages);
  });

  it('places the badge on the collapsed icon and tooltip when rail is collapsed', async () => {
    bellMocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 5, channels: [], bell: bellSample({ unread: 5 }) });
    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={scopeOf()} rooms>
        <RailNavigation {...baseProps({ initialExpanded: false })} />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-rail-expanded="false"]')).not.toBeNull();
    const inboxLink = mounted.query('[data-rail-inbox]');
    expect(inboxLink?.getAttribute('data-rail-tip')).toBe('알림함 · 5개 알림');
    expect(mounted.query('[data-rail-badge="messages"] [aria-hidden="true"]')?.textContent).toBe('5');
  });

  it('leaves 야기 팀과 untouched even with BellProvider and omits lower inbox when candidates is empty', () => {
    navState.path = '/brand';
    const teamHtml = renderToStaticMarkup(
      <BellProvider candidates={[ORG]} scope={scopeOf()} rooms>
        <RailNavigation {...baseProps()} />
      </BellProvider>,
    );
    expect(teamHtml).toContain('data-rail-mode="team"');
    expect(teamHtml).not.toContain('data-rail-inbox');
    expect(teamHtml).not.toContain('data-rail-group="lower"');

    navState.path = '/brand/studio';
    const noBellHtml = renderToStaticMarkup(<RailNavigation {...baseProps()} />);
    expect(noBellHtml).not.toContain('data-rail-inbox');
    const lowerMatch = /<ul class="bw-rail-list" data-rail-group="lower">([\s\S]*?)<\/ul>/.exec(noBellHtml);
    const lowerIds = [...lowerMatch![1]!.matchAll(/data-rail-item="(\w+)"/g)].map((m) => m[1]);
    expect(lowerIds).toEqual(['workflows']);
  });

  it('does NOT run useRoomUnread while active, shows bell count after mount read, and falls back to useRoomUnread on stop', async () => {
    let resolveMount: ((value: unknown) => void) | null = null;
    bellMocks.loadRoomBell
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMount = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, unread: 7, channels: [], bell: bellSample({ unread: 7 }) })
      .mockResolvedValueOnce({ ok: false, code: 'rooms_closed' });

    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={scopeOf()} rooms>
        <RailNavigation {...baseProps()} />
      </BellProvider>,
    );

    const summaryUrls = () =>
      fetchSpy.mock.calls.map((c) => String(c[0])).filter((url) => url.includes('/api/brand-rooms/summary'));
    // While waiting for first bell read, useRoomUnread must not run and no badge shows yet.
    expect(bellMocks.loadRoomBell).toHaveBeenCalledTimes(1);
    expect(summaryUrls()).toEqual([]);
    expect(mounted.query('[data-rail-badge="messages"]')).toBeNull();

    // First answer delivers unread: 2.
    await act(async () => {
      resolveMount?.({ ok: true, unread: 2, channels: [], bell: bellSample({ unread: 2 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-rail-badge="messages"] [aria-hidden="true"]')?.textContent).toBe('2');

    // 20s poll updates badge to 7 without running useRoomUnread.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(bellMocks.loadRoomBell).toHaveBeenCalledTimes(2);
    expect(summaryUrls()).toEqual([]);
    expect(mounted.query('[data-rail-badge="messages"] [aria-hidden="true"]')?.textContent).toBe('7');

    // Stop code makes BellProvider go inactive and falls back to useRoomUnread.
    await act(async () => {
      window.dispatchEvent(new Event(ROOM_ACTIVITY));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-rail-inbox]')).toBeNull();
    expect(summaryUrls()).toEqual([`/api/brand-rooms/summary?organizationId=${encodeURIComponent(ORG)}`]);
  });

  it('runs useRoomUnread normally without BellProvider', async () => {
    mounted = await mountDom(<RailNavigation {...baseProps()} />);
    const summaryUrls = () =>
      fetchSpy.mock.calls.map((c) => String(c[0])).filter((url) => url.includes('/api/brand-rooms/summary'));
    expect(summaryUrls()).toEqual([`/api/brand-rooms/summary?organizationId=${encodeURIComponent(ORG)}`]);
  });

  it('reorders 알림함 and 워크플로우 only within the lower band in DOM order-edit mode', async () => {
    bellMocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 2, channels: [], bell: bellSample({ unread: 2 }) });
    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={scopeOf()} rooms>
        <RailNavigation {...baseProps()} />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    window.localStorage.removeItem('twings_brand_nav_order_v1');

    const lowerIds = () =>
      [...mounted!.queryAll('[data-rail-group="lower"] [data-rail-item]')].map((el) =>
        el.getAttribute('data-rail-item'),
      );
    const primaryIds = () =>
      [...mounted!.queryAll('[data-rail-group="primary"] [data-rail-item]')].map((el) =>
        el.getAttribute('data-rail-item'),
      );

    expect(lowerIds()).toEqual(['workflows', 'messages']);
    const beforePrimary = primaryIds();

    await mounted.click('[data-rail-order] button');
    const buttons = [...mounted.queryAll('[data-rail-group="lower"] button')];
    const findBtn = (aria: string) => buttons.find((btn) => btn.getAttribute('aria-label') === aria) ?? null;
    const moveWorkflowUp = findBtn(ko.studioShell.rail.moveUp.replace('{label}', ko.studioShell.rail.workflows));
    const moveInboxUp = findBtn(ko.studioShell.rail.moveUp.replace('{label}', ko.roomsShell.nav.messages));
    const moveInboxDown = findBtn(ko.studioShell.rail.moveDown.replace('{label}', ko.roomsShell.nav.messages));
    expect(moveWorkflowUp?.getAttribute('disabled')).not.toBeNull();
    expect(moveInboxUp).not.toBeNull();
    expect(moveInboxDown?.getAttribute('disabled')).not.toBeNull();

    await mounted.click(moveInboxUp!);
    expect(lowerIds()).toEqual(['messages', 'workflows']);
    expect(primaryIds()).toEqual(beforePrimary);
    window.localStorage.removeItem('twings_brand_nav_order_v1');
  });

  it('imports bellInboxCount from bell/model and useBell from bell/provider in rail-nav.tsx', () => {
    const src = readFileSync(path.join(process.cwd(), 'components/brand-workspace/rail-nav.tsx'), 'utf8');
    expect(src).toContain('bellInboxCount');
    expect(src).toContain('useBell');
  });
});
