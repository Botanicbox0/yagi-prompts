import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { ROOM_ACTIVITY } from '@/components/brand-rooms/seams';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const navState = vi.hoisted(() => ({
  path: '/brand/studio',
  query: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(navState.query),
}));

const mocks = vi.hoisted(() => ({
  loadRoomBell: vi.fn(),
  readChannel: vi.fn(),
}));

vi.mock('@/components/brand-rooms/chat/transport', () => ({
  loadRoomBell: (...args: unknown[]) => mocks.loadRoomBell(...args),
  brandTransport: (organizationId: string) => ({
    read: (channel: string, at: string) => mocks.readChannel(organizationId, channel, at),
  }),
}));

import { BellProvider, useBell } from '@/components/brand-workspace/bell/provider';
import { BELL_POLL_MS, type BellItem, type BellState } from '@/components/brand-workspace/bell/model';

const ORG_A = 'a0000000-0000-4000-8000-0000000000a1';
const ORG_B = 'b0000000-0000-4000-8000-0000000000b2';
const PROJECT = '11111111-1111-4111-8111-111111111111';

const scopeFor = (choices: BrandWorkspaceScope['choices'] = [
  { id: ORG_A, name: 'Alpha', role: 'owner', logoUrl: null },
  { id: ORG_B, name: 'Beta', role: 'owner', logoUrl: null },
]): BrandWorkspaceScope => ({
  choices,
  projectOrganizations: {},
});

const convItem = (over: Partial<BellItem> = {}): BellItem => ({
  id: `channel:${PROJECT}`,
  kind: 'conversation',
  projectId: PROJECT,
  projectTitle: 'Spring launch',
  title: null,
  line: 'Cut 4 feedback',
  version: null,
  openNotes: 0,
  unreadCount: 2,
  at: '2026-11-26T03:00:00.000Z',
  unread: true,
  thumbUrl: null,
  href: `/brand/rooms?organizationId=${ORG_A}&channel=${PROJECT}`,
  ...over,
});

const storyboardItem = (): BellItem => ({
  id: 'storyboard:sb-1',
  kind: 'storyboard',
  projectId: PROJECT,
  projectTitle: 'Spring launch',
  title: 'Board 1',
  line: null,
  version: 2,
  openNotes: 0,
  unreadCount: 0,
  at: '2026-11-26T02:00:00.000Z',
  unread: true,
  thumbUrl: null,
  href: `/brand/rooms/${PROJECT}?organizationId=${ORG_A}&tab=storyboard&board=sb-1`,
});

const makeBell = (over: Partial<BellState> = {}): BellState => ({
  unread: 2,
  items: [convItem(), storyboardItem()],
  more: false,
  ...over,
});

function Probe() {
  const bell = useBell();
  return (
    <div>
      <span data-probe-present>{bell ? 'yes' : 'no'}</span>
      <span data-probe-org>{bell?.organizationId ?? 'none'}</span>
      <span data-probe-loaded>{bell?.loaded ? 'yes' : 'no'}</span>
      <span data-probe-unread>{bell ? String(bell.unread) : 'none'}</span>
      <span data-probe-count>{bell ? String(bell.items.length) : '0'}</span>
      <button type="button" data-probe-refresh onClick={() => void bell?.refresh()}>
        refresh
      </button>
      <button type="button" data-probe-read-conv onClick={() => void bell?.markRead(convItem())}>
        read-conv
      </button>
      <button
        type="button"
        data-probe-read-general
        onClick={() => void bell?.markRead(convItem({ id: 'channel:general', projectId: null, projectTitle: null }))}
      >
        read-general
      </button>
      <button type="button" data-probe-read-alert onClick={() => void bell?.markRead(storyboardItem())}>
        read-alert
      </button>
    </div>
  );
}

describe('BellProvider (Decision Q5 client activation & polling)', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    navState.path = '/brand/studio';
    navState.query = '';
    mocks.loadRoomBell.mockReset();
    mocks.readChannel.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
  });

  const dispatchDoc = (doc: MountedDom['document'], type: string) => {
    doc.dispatchEvent({
      type,
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      cancelBubble: false,
      target: null,
      currentTarget: null,
      key: '',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    } as Parameters<MountedDom['document']['dispatchEvent']>[0]);
  };

  it('stays inactive (null context, zero timers, zero requests) when candidates empty, org not a candidate, or mode is team', async () => {
    // 1. Empty candidates
    const html = renderToStaticMarkup(
      <BellProvider candidates={[]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(html).toContain('data-probe-present="true">no</span>');

    // 2. Selected org not in candidates
    navState.query = `organizationId=${ORG_B}`;
    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('no');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS * 2);
    });
    expect(mocks.loadRoomBell).not.toHaveBeenCalled();

    // 3. 야기 팀과 route even when org IS a candidate
    await mounted.unmount();
    navState.path = '/brand';
    navState.query = `organizationId=${ORG_A}`;
    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('no');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS * 2);
    });
    expect(mocks.loadRoomBell).not.toHaveBeenCalled();
  });

  it('reads on mount when active (showing 0/unloaded before first answer) and polls every 20s only while visible', async () => {
    let resolveMount: ((value: unknown) => void) | null = null;
    mocks.loadRoomBell.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMount = resolve;
        }),
    );

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    // Before first answer arrives: active context exists, no number shown (unread 0, loaded no).
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('yes');
    expect(mounted.query('[data-probe-loaded]')?.textContent).toBe('no');
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('0');
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);
    expect(mocks.loadRoomBell).toHaveBeenCalledWith(ORG_A);

    await act(async () => {
      resolveMount?.({ ok: true, unread: 2, channels: [], alerts: [], bell: makeBell({ unread: 2 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-loaded]')?.textContent).toBe('yes');
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('2');

    // Hidden tab skips 20s tick.
    mocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 5, channels: [], alerts: [], bell: makeBell({ unread: 5 }) });
    (mounted.document as unknown as { visibilityState: string }).visibilityState = 'hidden';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    // Visible tab polls and updates.
    (mounted.document as unknown as { visibilityState: string }).visibilityState = 'visible';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('5');
  });

  it('refreshes on ROOM_ACTIVITY, focus, and visibilitychange while preventing concurrent reads', async () => {
    let resolvePending: ((value: unknown) => void) | null = null;
    mocks.loadRoomBell.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    // Mount fired read #1 and it is still pending.
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event(ROOM_ACTIVITY));
      window.dispatchEvent(new Event('focus'));
      (mounted!.document as unknown as { visibilityState: string }).visibilityState = 'visible';
      dispatchDoc(mounted!.document, 'visibilitychange');
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePending?.({ ok: true, unread: 4, channels: [], alerts: [], bell: makeBell({ unread: 4 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('4');

    // Hidden visibilitychange does nothing; visible starts next read.
    (mounted.document as unknown as { visibilityState: string }).visibilityState = 'hidden';
    await act(async () => {
      dispatchDoc(mounted!.document, 'visibilitychange');
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    (mounted.document as unknown as { visibilityState: string }).visibilityState = 'visible';
    await act(async () => {
      dispatchDoc(mounted!.document, 'visibilitychange');
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvePending?.({ ok: true, unread: 6, channels: [], alerts: [], bell: makeBell({ unread: 6 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('6');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(3);
  });

  it('re-evaluates active on org switch, ignores late previous-org answer, and clears old timer on deactivate', async () => {
    let resolveOrgA: ((value: unknown) => void) | null = null;
    mocks.loadRoomBell.mockImplementation((orgId: string) => {
      if (orgId === ORG_A) {
        return new Promise((resolve) => {
          resolveOrgA = resolve;
        });
      }
      return Promise.resolve({ ok: true, unread: 9, channels: [], alerts: [], bell: makeBell({ unread: 9 }) });
    });

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A, ORG_B]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(mocks.loadRoomBell).toHaveBeenCalledWith(ORG_A);

    // Switch query to ORG_B while ORG_A read is still pending.
    navState.query = `organizationId=${ORG_B}`;
    await mounted.rerender(
      <BellProvider candidates={[ORG_A, ORG_B]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledWith(ORG_B);
    expect(mounted.query('[data-probe-org]')?.textContent).toBe(ORG_B);
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('9');

    // Late answer from ORG_A must be ignored completely (unread stays 9, org stays ORG_B).
    await act(async () => {
      resolveOrgA?.({ ok: true, unread: 1, channels: [], alerts: [], bell: makeBell({ unread: 1 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-org]')?.textContent).toBe(ORG_B);
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('9');

    // Switching mode to 야기 팀과 deactivates and clears timers.
    navState.path = '/brand';
    await mounted.rerender(
      <BellProvider candidates={[ORG_A, ORG_B]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('no');
    const callsBeforeWait = mocks.loadRoomBell.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS * 3);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(callsBeforeWait);
  });

  it('re-evaluates active on client mode toggle without page reload via cookie + event', async () => {
    navState.path = '/brand/library';
    navState.query = `organizationId=${ORG_A}`;
    mocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 2, channels: [], alerts: [], bell: makeBell({ unread: 2 }) });

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} railModes={{ [ORG_A]: 'make' }} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('yes');
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    // Simulate rail-nav toggling mode to 'team' on /brand/library without navigation.
    (mounted.document as unknown as { cookie: string }).cookie = `twings_brand_mode=${encodeURIComponent(`${ORG_A}:team`)}`;
    await act(async () => {
      window.dispatchEvent(new Event('twings:rail-mode-changed'));
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('no');

    // Switching back to 'make' re-activates and triggers mount read.
    (mounted.document as unknown as { cookie: string }).cookie = `twings_brand_mode=${encodeURIComponent(`${ORG_A}:make`)}`;
    await act(async () => {
      window.dispatchEvent(new Event('twings:rail-mode-changed'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('yes');
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['rooms_closed', { ok: false, code: 'rooms_closed' }],
    ['not_found', { ok: false, code: 'not_found' }],
    ['sign_in_required', { ok: false, code: 'sign_in_required' }],
    ['missing_bell', { ok: true, unread: 0, channels: [] }],
  ])('goes inactive and clears context permanently on %s', async (_name, answer) => {
    mocks.loadRoomBell.mockResolvedValue(answer);
    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('no');

    // Subsequent triggers/ticks stay silent on this page.
    await act(async () => {
      window.dispatchEvent(new Event(ROOM_ACTIVITY));
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS * 2);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'failed'] as const)('keeps current bell on %s and retries next tick', async (code) => {
    const updated = makeBell({ unread: 7 });
    mocks.loadRoomBell
      .mockResolvedValueOnce({ ok: true, unread: 2, channels: [], alerts: [], bell: makeBell({ unread: 2 }) })
      .mockResolvedValueOnce({ ok: false, code })
      .mockResolvedValueOnce({ ok: true, unread: 7, channels: [], alerts: [], bell: updated });

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('yes');
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(3);
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('7');
  });

  it('marks conversation lines read via brandTransport and refreshes once; ignores alerts', async () => {
    const afterRead = makeBell({ unread: 1, items: [storyboardItem()] });
    mocks.loadRoomBell
      .mockResolvedValueOnce({ ok: true, unread: 2, channels: [], alerts: [], bell: makeBell({ unread: 2 }) })
      .mockResolvedValue({ ok: true, unread: 0, channels: [], alerts: [], bell: afterRead });

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    await mounted.click('[data-probe-read-alert]');
    expect(mocks.readChannel).not.toHaveBeenCalled();
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    await mounted.click('[data-probe-read-conv]');
    expect(mocks.readChannel).toHaveBeenCalledWith(ORG_A, PROJECT, '2026-11-26T03:00:00.000Z');
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('1');

    await mounted.click('[data-probe-read-general]');
    expect(mocks.readChannel).toHaveBeenLastCalledWith(ORG_A, 'general', '2026-11-26T03:00:00.000Z');
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(3);
  });

  it('keeps at most one read in flight across provider re-renders and ignores stale out-of-order answers on the same org', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.loadRoomBell.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    // Trigger a re-render within the same org (e.g. navigating /brand/studio -> /brand/studio/video + prop update) while read #1 is pending.
    navState.path = '/brand/studio/video';
    await mounted.rerender(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event(ROOM_ACTIVITY));
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    // Resolve read #1 -> now unread is 2.
    await act(async () => {
      resolvers[0]?.({ ok: true, unread: 2, channels: [], alerts: [], bell: makeBell({ unread: 2 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('2');

    // Start read #2 on 20s tick, then switch away (팀) & back (만들기) so read #3 starts cleanly on same ORG_A.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);

    navState.path = '/brand';
    await mounted.rerender(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    navState.path = '/brand/studio';
    await mounted.rerender(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(3);

    // Resolve newer read #3 FIRST (unread: 8), then resolve stale read #2 LAST (unread: 1): newer read #3 must win.
    await act(async () => {
      resolvers[2]?.({ ok: true, unread: 8, channels: [], alerts: [], bell: makeBell({ unread: 8 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('8');

    await act(async () => {
      resolvers[1]?.({ ok: true, unread: 1, channels: [], alerts: [], bell: makeBell({ unread: 1 }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('8');
  });

  it('clears the 20s interval while hidden (zero ticks for 60s) and resumes with one read + 20s rhythm when visible', async () => {
    mocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 1, channels: [], alerts: [], bell: makeBell({ unread: 1 }) });
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} rooms>
        <Probe />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    // Hide tab -> clears interval, zero ticks/requests across 60s.
    (mounted.document as unknown as { visibilityState: string }).visibilityState = 'hidden';
    await act(async () => {
      dispatchDoc(mounted!.document, 'visibilitychange');
    });
    expect(clearSpy).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);

    // Return visible -> 1 immediate read + new 20s interval resumes.
    (mounted.document as unknown as { visibilityState: string }).visibilityState = 'visible';
    await act(async () => {
      dispatchDoc(mounted!.document, 'visibilitychange');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(3);
    clearSpy.mockRestore();
  });

  it('triggers zero extra reads and keeps the same polling timer across 3 pathname changes inside the same (org, mode)', async () => {
    navState.path = '/brand/home';
    navState.query = `organizationId=${ORG_A}`;
    mocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 2, channels: [], alerts: [], bell: makeBell({ unread: 2 }) });

    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    mounted = await mountDom(
      <BellProvider candidates={[ORG_A]} scope={scopeFor()} railModes={{ [ORG_A]: 'make' }} rooms>
        <Probe />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('yes');
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('2');

    const initialSetCount = setSpy.mock.calls.length;
    const initialClearCount = clearSpy.mock.calls.length;
    expect(initialSetCount).toBe(1);

    for (const nextPath of ['/brand/studio', '/brand/studio/video', '/brand/studio/compose']) {
      navState.path = nextPath;
      await mounted.rerender(
        <BellProvider candidates={[ORG_A]} scope={scopeFor()} railModes={{ [ORG_A]: 'make' }} rooms>
          <Probe />
        </BellProvider>,
      );
    }

    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls.length).toBe(initialSetCount);
    expect(clearSpy.mock.calls.length).toBe(initialClearCount);
    expect(mounted.query('[data-probe-present]')?.textContent).toBe('yes');
    expect(mounted.query('[data-probe-unread]')?.textContent).toBe('2');

    // Original timer still fires cleanly once after BELL_POLL_MS without restarting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
    expect(clearSpy.mock.calls.length).toBe(initialClearCount);

    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});

describe('bell source guards', () => {
  const ROOT = process.cwd();
  const bellDir = path.join(ROOT, 'components/brand-workspace/bell');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });

  it('keeps timers, loadRoomBell, and <video rules clean under components/brand-workspace/bell/', () => {
    const files = walk(bellDir);
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      expect(src, `${rel} must not contain <video`).not.toContain('<video');
      expect(src, `${rel} must not import brand-rooms/bell`).not.toMatch(/from ['"][^'"]*brand-rooms\/bell['"]/);
      if (rel !== 'components/brand-workspace/bell/provider.tsx') {
        expect(src, `${rel} must not call setInterval/setTimeout`).not.toMatch(/\b(setInterval|setTimeout)\b/);
        expect(src, `${rel} must not name loadRoomBell`).not.toContain('loadRoomBell');
      }
    }
  });

  it('imports bellActive, bellPollReduce, and shell helpers in provider.tsx', () => {
    const providerSrc = readFileSync(path.join(bellDir, 'provider.tsx'), 'utf8');
    for (const fn of [
      'bellActive',
      'initialBellPollState',
      'bellPollReduce',
      'bellMarkReadTarget',
      'BELL_POLL_MS',
      'useWorkspaceSelection',
      'resolveRailMode',
    ]) {
      expect(providerSrc, fn).toContain(fn);
    }
    // Fix round 3 item 3: pathname must never be an effect dependency in provider.tsx; activation & polling depend solely on (orgId, modeActive).
    const effectDepArrays = [...providerSrc.matchAll(/useEffect\([\s\S]*?,\s*\[([^\]]*)\]\s*\)/g)].map((m) => m[1]!);
    expect(effectDepArrays.length).toBeGreaterThan(0);
    for (const deps of effectDepArrays) {
      expect(deps, `useEffect deps [${deps}] must not include pathname`).not.toMatch(/\bpathname\b/);
    }
  });
});
