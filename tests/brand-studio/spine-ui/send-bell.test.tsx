import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import type { SendFileCard } from '@/lib/brand-rooms/send-contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
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
  loadSendBell: vi.fn(),
  readChannel: vi.fn(),
  sendRead: vi.fn(),
  sendReadAll: vi.fn(),
}));

vi.mock('@/components/brand-rooms/chat/transport', () => ({
  loadRoomBell: (...args: unknown[]) => mocks.loadRoomBell(...args),
  loadSendBell: (...args: unknown[]) => mocks.loadSendBell(...args),
  brandTransport: (organizationId: string) => ({
    read: (channel: string, at: string) => mocks.readChannel(organizationId, channel, at),
  }),
  sendTransport: (organizationId: string) => ({
    read: (rootId: string, at?: string | null) => mocks.sendRead(organizationId, rootId, at),
    readAll: () => mocks.sendReadAll(organizationId),
  }),
}));

import { WorkspaceBell } from '@/components/brand-workspace/bell';
import { BellProvider } from '@/components/brand-workspace/bell/provider';
import {
  BELL_POLL_MS,
  pickBellCopy,
  pickBellSendCopy,
  type BellItem,
  type BellState,
} from '@/components/brand-workspace/bell/model';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const PROJ_1 = '11111111-1111-4111-8111-111111111111';
const ROOT_1 = '22222222-2222-4222-8222-222222222221';
const ROOT_2 = '22222222-2222-4222-8222-222222222222';
const OUT_1 = '33333333-3333-4333-8333-333333333331';
const ASSET_1 = '44444444-4444-4444-8444-444444444441';

const KO = getDictionary('ko');
const EN = getDictionary('en');
const KO_BELL = pickBellCopy(KO);
const KO_SEND = pickBellSendCopy(KO);
const EN_BELL = pickBellCopy(EN);
const EN_SEND = pickBellSendCopy(EN);

const SCOPE: BrandWorkspaceScope = {
  choices: [{ id: ORG, name: 'Alpha', role: 'owner', logoUrl: null }],
  projectOrganizations: {},
};

function makeFile(over: Partial<SendFileCard> = {}): SendFileCard {
  return {
    ref: { kind: 'output', outputId: OUT_1 },
    available: true,
    kind: 'image',
    name: null,
    url: '/api/brand-studio/media/st/pic.png',
    thumbUrl: '/api/brand-studio/media/st/pic-thumb.webp',
    width: 720,
    height: 1280,
    project: { id: PROJ_1, title: '봄 향수 론칭' },
    ...over,
  };
}

function threadItem(over: Partial<BellItem> = {}): BellItem {
  return {
    id: `thread:${ROOT_1}`,
    kind: 'thread',
    projectId: PROJ_1,
    projectTitle: '봄 향수 론칭',
    title: null,
    line: '립 컬러는 이 컷이 제일 자연스러워요.',
    version: null,
    openNotes: 0,
    unreadCount: 0,
    at: '2026-11-26T04:45:00.000Z',
    unread: true,
    thumbUrl: '/api/brand-studio/media/st/pic-thumb.webp',
    href: `/brand/inbox?organizationId=${ORG}&thread=${ROOT_1}`,
    rootId: ROOT_1,
    mentioned: true,
    actorName: '김서아',
    file: makeFile(),
    ...over,
  };
}

function convItem(over: Partial<BellItem> = {}): BellItem {
  return {
    id: `channel:${PROJ_1}`,
    kind: 'conversation',
    projectId: PROJ_1,
    projectTitle: '봄 향수 론칭',
    title: null,
    line: '시안 확인 부탁드려요',
    version: null,
    openNotes: 0,
    unreadCount: 2,
    at: '2026-11-26T04:15:00.000Z',
    unread: true,
    thumbUrl: null,
    href: `/brand/rooms?organizationId=${ORG}&channel=${PROJ_1}`,
    ...over,
  };
}

function boardItem(): BellItem {
  return {
    id: 'storyboard:sb-1',
    kind: 'storyboard',
    projectId: PROJ_1,
    projectTitle: '봄 향수 론칭',
    title: 'Board 1',
    line: null,
    version: 2,
    openNotes: 0,
    unreadCount: 0,
    at: '2026-11-26T03:00:00.000Z',
    unread: true,
    thumbUrl: null,
    href: `/brand/rooms/${PROJ_1}?organizationId=${ORG}&tab=storyboard&board=sb-1`,
  };
}

describe('Slice 4b Batch B Bell', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    navState.path = '/brand/studio';
    navState.query = `organizationId=${ORG}`;
    mocks.loadRoomBell.mockReset();
    mocks.loadSendBell.mockReset();
    mocks.readChannel.mockReset().mockResolvedValue(undefined);
    mocks.sendRead.mockReset().mockResolvedValue({ ok: true, rootId: ROOT_1, lastReadAt: '2026-11-26T05:00:00.000Z' });
    mocks.sendReadAll.mockReset().mockResolvedValue({ ok: true, marked: 1, more: false });
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
  });

  it('without send prop: uses ONLY loadRoomBell with identical request counts and renders 3a href (/brand/rooms)', async () => {
    const bell3a: BellState = { unread: 2, items: [convItem(), boardItem()], more: false };
    mocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 2, channels: [], alerts: [], bell: bell3a });

    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={SCOPE} rooms bellCopy={KO_BELL} locale="ko">
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(1);
    expect(mocks.loadRoomBell).toHaveBeenCalledWith(ORG);
    expect(mocks.loadSendBell).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
    expect(mocks.loadSendBell).not.toHaveBeenCalled();

    await mounted.click('[data-bell]');
    expect(mounted.query('[data-bell-views]')).toBeNull();
    expect(mounted.query('[data-bell-mark-all]')).toBeNull();
    expect(mounted.query('[data-bell-see-all]')?.getAttribute('href')).toBe(`/brand/rooms?organizationId=${ORG}`);

    await mounted.click(`[data-bell-mark-read="channel:${PROJ_1}"]`);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.readChannel).toHaveBeenCalledTimes(1);
    expect(mocks.sendRead).not.toHaveBeenCalled();
    expect(mocks.sendReadAll).not.toHaveBeenCalled();
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(3);
    expect(mocks.loadSendBell).not.toHaveBeenCalled();
  });

  it('without send prop: renders a thread item via the exact 3a conversation path (Fix round 2 item 4)', async () => {
    const bareThread = threadItem({
      id: `thread:${ROOT_1}`,
      kind: 'thread',
      projectId: null,
      projectTitle: null,
      title: null,
      line: null,
      actorName: '김서아',
      thumbUrl: null,
      unread: false,
      unreadCount: 0,
      mentioned: true,
      at: '2026-11-25T10:00:00.000Z',
      href: `/brand/rooms?organizationId=${ORG}&channel=general`,
    });
    const legacyConv = convItem({
      id: 'channel:general',
      kind: 'conversation',
      projectId: null,
      projectTitle: null,
      title: null,
      line: null,
      unread: false,
      unreadCount: 0,
      thumbUrl: null,
      at: '2026-11-25T10:00:00.000Z',
      href: `/brand/rooms?organizationId=${ORG}&channel=general`,
    });

    mocks.loadRoomBell
      .mockResolvedValueOnce({ ok: true, unread: 0, channels: [], alerts: [], bell: { unread: 0, items: [bareThread], more: false } })
      .mockResolvedValueOnce({ ok: true, unread: 0, channels: [], alerts: [], bell: { unread: 0, items: [legacyConv], more: false } });

    const domTree = (node: unknown): string => {
      if (!node || typeof node !== 'object') return '';
      const n = node as { nodeType?: number; textContent?: string; tagName?: string; attributes?: Record<string, string>; childNodes?: unknown[] };
      if (n.nodeType === 3) return n.textContent ?? '';
      if (!n.tagName) return '';
      const attrs = n.attributes
        ? Object.entries(n.attributes)
            .filter(([k]) => k !== 'data-bell-item' && k !== 'data-kind')
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => ` ${k}="${v}"`)
            .join('')
        : '';
      const children = (n.childNodes ?? []).map(domTree).join('');
      return `<${n.tagName.toLowerCase()}${attrs}>${children}</${n.tagName.toLowerCase()}>`;
    };

    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={SCOPE} rooms bellCopy={KO_BELL} locale="ko">
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await mounted.click('[data-bell]');
    const threadRowHtml = domTree(mounted.query(`[data-bell-item="thread:${ROOT_1}"]`));
    expect(threadRowHtml).toContain('일반 문의');
    expect(threadRowHtml).toContain('프로젝트와 상관없는 질문');
    expect(threadRowHtml).not.toContain('김서아');
    expect(threadRowHtml).not.toContain('멘션');

    await mounted.unmount();
    mounted = null;

    mounted = await mountDom(
      <BellProvider candidates={[ORG]} scope={SCOPE} rooms bellCopy={KO_BELL} locale="ko">
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await mounted.click('[data-bell]');
    const convRowHtml = domTree(mounted.query('[data-bell-item="channel:general"]'));
    expect(threadRowHtml).toBe(convRowHtml);
  });

  it('with send prop: renders thread rows (thumb/glyph, actor, project/미분류/삭제된 파일, 멘션 mark), switches 전체/멘션 keeping badge constant, and never runs two bell reads in flight', async () => {
    let resolvePending!: (val: unknown) => void;
    const allBell: BellState = {
      unread: 5,
      view: 'all',
      mentionsUnread: 2,
      more: true,
      items: [
        threadItem(),
        threadItem({
          id: `thread:${ROOT_2}`,
          rootId: ROOT_2,
          projectId: null,
          projectTitle: null,
          thumbUrl: null,
          actorName: null,
          mentioned: false,
          unread: false,
          line: '영상 미분류 컷이에요',
          href: `/brand/inbox?organizationId=${ORG}&thread=${ROOT_2}`,
          file: makeFile({ ref: { kind: 'asset', assetId: ASSET_1 }, kind: 'video', project: null, thumbUrl: null }),
        }),
        threadItem({
          id: 'thread:gone-1',
          rootId: '22222222-2222-4222-8222-222222222229',
          projectId: null,
          projectTitle: null,
          thumbUrl: null,
          actorName: '박도윤',
          mentioned: false,
          unread: true,
          line: '예전 시안입니다',
          file: makeFile({ available: false, kind: null, url: null, thumbUrl: null, project: null }),
        }),
        convItem(),
      ],
    };
    let resolveMentions!: (val: unknown) => void;
    let resolvePendingReverse!: (val: unknown) => void;
    let resolveReverseAll!: (val: unknown) => void;
    const mentionOnlyItem = threadItem({
      id: 'thread:mention-only',
      rootId: '22222222-2222-4222-8222-222222222288',
      line: '멘션 전용 대화',
    });
    const mentionsBell: BellState = {
      unread: 5,
      view: 'mentions',
      mentionsUnread: 2,
      more: false,
      items: [mentionOnlyItem],
    };

    mocks.loadSendBell
      .mockResolvedValueOnce({ ok: true, unread: 5, channels: [], alerts: [], bell: allBell })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePending = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMentions = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePendingReverse = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReverseAll = resolve;
          }),
      );

    mounted = await mountDom(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        rooms
        bellCopy={KO_BELL}
        locale="ko"
        send={{ organizations: [ORG], copy: KO_SEND }}
      >
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.loadSendBell).toHaveBeenCalledTimes(1);
    expect(mocks.loadSendBell).toHaveBeenCalledWith(ORG, 'all');
    expect(mocks.loadRoomBell).not.toHaveBeenCalled();
    expect(mounted.query('[data-bell-count]')?.textContent).toBe('5');

    await mounted.click('[data-bell]');
    const winText = mounted.query('[data-bell-window]')?.textContent ?? '';
    expect(winText).toContain('김서아');
    expect(winText).toContain('봄 향수 론칭');
    expect(winText).toContain('멘션');
    expect(winText).toContain('미분류');
    expect(winText).toContain('삭제된 파일');
    expect(winText).toContain('모두 읽음 처리');
    expect(winText).not.toContain('답글:');
    expect(mounted.query('[data-bell-views]')?.getAttribute('aria-label')).toBe(KO_BELL.bellTitle);
    expect(mounted.query('[data-bell-view="all"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(mounted.query('[data-bell-view="mentions"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(mounted.query('[data-bell-mark-all]')).not.toBeNull();
    expect(mounted.queryAll('video')).toHaveLength(0);
    expect(mounted.query('[data-bell-see-all]')?.getAttribute('href')).toBe(`/brand/inbox?organizationId=${ORG}`);

    // Start 20s poll (call #2 stays pending), click 멘션 during inflight -> MUST NOT launch a 2nd concurrent read!
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadSendBell).toHaveBeenCalledTimes(2);

    await mounted.click('[data-bell-view="mentions"]');
    expect(mounted.query('[data-bell-view="all"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(mounted.query('[data-bell-view="mentions"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(mounted.query('[data-bell-mark-all]')).toBeNull();
    // Still 2 calls while call #2 is inflight!
    expect(mocks.loadSendBell).toHaveBeenCalledTimes(2);
    // Badge number never drops or changes when switching to 멘션, and NO row of the old view is rendered while loading
    expect(mounted.query('[data-bell-count]')?.textContent).toBe('5');
    expect(mounted.queryAll('[data-bell-item]')).toHaveLength(0);
    expect(mounted.query('[data-bell-loading]')).not.toBeNull();

    // Finish call #2 (allBell with updated counts 6 / 3 while Mentions tab is active) -> counts update, items DROPPED, loading shown until queued Mentions read settles
    await act(async () => {
      resolvePending({
        ok: true,
        unread: 6,
        channels: [],
        alerts: [],
        bell: { ...allBell, unread: 6, mentionsUnread: 3 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadSendBell).toHaveBeenCalledTimes(3);
    expect(mocks.loadSendBell).toHaveBeenLastCalledWith(ORG, 'mentions');
    expect(mounted.query('[data-bell-count]')?.textContent).toBe('6');
    expect(mounted.query('[data-bell-mentions-count]')?.textContent).toBe('3');
    expect(mounted.queryAll('[data-bell-item]')).toHaveLength(0);
    expect(mounted.query('[data-bell-loading]')).not.toBeNull();

    await act(async () => {
      resolveMentions({ ok: true, unread: 5, channels: [], alerts: [], bell: mentionsBell });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-bell-loading]')).toBeNull();
    expect(mounted.queryAll('[data-bell-item]')).toHaveLength(1);
    expect(mounted.query('[data-bell-item="thread:mention-only"]')).not.toBeNull();
    expect(mounted.query('[data-bell-mark-all]')).toBeNull();
    expect(mounted.query('[data-bell-count]')?.textContent).toBe('5');
    expect(mounted.query('[data-bell-see-all]')?.getAttribute('href')).toBe(
      `/brand/inbox?organizationId=${ORG}&view=mentions`,
    );

    // Reverse direction: while in 멘션 view, start 20s mentions read #4 -> click 전체 -> resolve #4 with mentions items -> ZERO mentions rows drawn under 전체!
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    expect(mocks.loadSendBell).toHaveBeenCalledTimes(4);
    expect(mocks.loadSendBell).toHaveBeenLastCalledWith(ORG, 'mentions');

    await mounted.click('[data-bell-view="all"]');
    expect(mounted.queryAll('[data-bell-item]')).toHaveLength(0);
    expect(mounted.query('[data-bell-loading]')).not.toBeNull();

    await act(async () => {
      resolvePendingReverse({
        ok: true,
        unread: 8,
        channels: [],
        alerts: [],
        bell: { ...mentionsBell, unread: 8, mentionsUnread: 4 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadSendBell).toHaveBeenCalledTimes(5);
    expect(mocks.loadSendBell).toHaveBeenLastCalledWith(ORG, 'all');
    expect(mounted.query('[data-bell-count]')?.textContent).toBe('8');
    expect(mounted.query('[data-bell-mentions-count]')?.textContent).toBe('4');
    expect(mounted.queryAll('[data-bell-item]')).toHaveLength(0);
    expect(mounted.query('[data-bell-loading]')).not.toBeNull();

    await act(async () => {
      resolveReverseAll({ ok: true, unread: 5, channels: [], alerts: [], bell: allBell });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-bell-loading]')).toBeNull();
    expect(mounted.queryAll('[data-bell-item]')).toHaveLength(4);
    expect(mounted.query('[data-bell-mark-all]')).not.toBeNull();
  });

  it('marks single thread row with send.read, conversation row with channel.read, and 모두 읽음 처리 with send.read_all once + each unread conversation row', async () => {
    const bellData: BellState = {
      unread: 4,
      view: 'all',
      mentionsUnread: 1,
      more: false,
      items: [
        threadItem(),
        convItem({ id: 'channel:general', projectId: null, projectTitle: null, at: '2026-11-26T04:10:00.000Z' }),
        convItem({ id: `channel:${PROJ_1}`, at: '2026-11-26T04:05:00.000Z' }),
        convItem({ id: 'channel:read-one', projectId: '99999999-9999-4999-8999-999999999991', unread: false, unreadCount: 0 }),
        boardItem(),
      ],
    };
    mocks.loadSendBell.mockResolvedValue({ ok: true, unread: 4, channels: [], alerts: [], bell: bellData });

    mounted = await mountDom(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        rooms
        bellCopy={KO_BELL}
        locale="ko"
        send={{ organizations: [ORG], copy: KO_SEND }}
      >
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await mounted.click('[data-bell]');

    // Single thread markRead -> send.read (NOT brandTransport.read)
    await mounted.click(`[data-bell-mark-read="thread:${ROOT_1}"]`);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.sendRead).toHaveBeenCalledTimes(1);
    expect(mocks.sendRead).toHaveBeenCalledWith(ORG, ROOT_1, '2026-11-26T04:45:00.000Z');
    expect(mocks.readChannel).not.toHaveBeenCalled();

    // 모두 읽음 처리 -> two fast clicks -> 1 send.read_all + 1 read per unread conversation row (general + PROJ_1), 0 for read/board rows
    const markAllBtn = mounted.query('[data-bell-mark-all]')!;
    await act(async () => {
      markAllBtn.dispatchEvent({ type: 'click', bubbles: true, cancelable: true } as never);
      markAllBtn.dispatchEvent({ type: 'click', bubbles: true, cancelable: true } as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.sendReadAll).toHaveBeenCalledTimes(1);
    expect(mocks.sendReadAll).toHaveBeenCalledWith(ORG);
    expect(mocks.readChannel).toHaveBeenCalledTimes(2);
    expect(mocks.readChannel).toHaveBeenCalledWith(ORG, 'general', '2026-11-26T04:10:00.000Z');
    expect(mocks.readChannel).toHaveBeenCalledWith(ORG, PROJ_1, '2026-11-26T04:05:00.000Z');
  });

  it('gracefully falls back to 3a UI when server returns RoomBell without view field', async () => {
    mocks.loadSendBell.mockResolvedValue({
      ok: true,
      unread: 1,
      channels: [],
      alerts: [],
      bell: { unread: 1, items: [convItem()], more: false },
    });
    mounted = await mountDom(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        rooms
        bellCopy={EN_BELL}
        locale="en"
        send={{ organizations: [ORG], copy: EN_SEND }}
      >
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await mounted.click('[data-bell]');
    expect(mounted.query('[data-bell-views]')).toBeNull();
    expect(mounted.query('[data-bell-mark-all]')).toBeNull();
    expect(mounted.query('[data-bell-see-all]')?.getAttribute('href')).toBe(`/brand/rooms?organizationId=${ORG}`);
  });

  it('clears the queued view when a bell read ends in a stop code (Fix round 2 item 5)', async () => {
    let resolveInflight!: (val: unknown) => void;
    mocks.loadSendBell
      .mockResolvedValueOnce({
        ok: true,
        unread: 2,
        channels: [],
        alerts: [],
        bell: { unread: 2, view: 'all', mentionsUnread: 1, more: false, items: [threadItem()] },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

    mounted = await mountDom(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        rooms
        bellCopy={KO_BELL}
        locale="ko"
        send={{ organizations: [ORG], copy: KO_SEND }}
      >
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await mounted.click('[data-bell]');

    // Start 20s poll (#2), click 멘션 while inflight -> queues 'mentions'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    await mounted.click('[data-bell-view="mentions"]');
    expect(mocks.loadSendBell).toHaveBeenCalledTimes(2);

    // #2 settles with a permanent stop code -> bell stops and does NOT fire queued 'mentions'
    await act(async () => {
      resolveInflight({ ok: false, code: 'rooms_closed' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.loadSendBell).toHaveBeenCalledTimes(2);
    expect(mounted.query('[data-bell]')).toBeNull();
  });

  it('allows direct click without hover, reveals on :hover and :focus-within above time label, and keeps Tab reachability only on send rows (Fix round 6 item 8)', async () => {
    const bellCss = readFileSync(
      path.join(process.cwd(), 'components/brand-workspace/bell/bell.module.css'),
      'utf8',
    );
    expect(bellCss).toContain(".row[data-kind='thread'][data-can-mark='true'] .sideMeta");
    expect(bellCss).toContain(".row[data-kind='thread'][data-can-mark='true'] .markRead");
    expect(bellCss).toMatch(/\.row\[data-kind='thread'\]\[data-can-mark='true'\]\s+\.sideMeta\s*\{[^}]*pointer-events:\s*none;/s);
    expect(bellCss).toMatch(/\.row\[data-kind='thread'\]\[data-can-mark='true'\]\s+\.markRead\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*\d+;[^}]*pointer-events:\s*auto;/s);
    expect(bellCss).toMatch(
      /\.row\[data-kind='thread'\]\[data-can-mark='true'\]:hover\s+\.markRead,\s*\.row\[data-kind='thread'\]\[data-can-mark='true'\]:focus-within\s+\.markRead[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;[\s\S]*?z-index:\s*\d+;/,
    );
    // 3a conversation rows without send remain unchanged
    expect(bellCss).not.toContain("data-kind='conversation'");
    expect(bellCss).not.toContain('data-kind="conversation"');

    // Keyboard Tab focusability & click-without-hover in DOM
    mocks.loadSendBell.mockResolvedValue({
      ok: true,
      unread: 1,
      channels: [],
      alerts: [],
      bell: {
        unread: 1,
        view: 'all',
        mentionsUnread: 0,
        more: false,
        items: [threadItem({ id: `thread:${ROOT_1}`, rootId: ROOT_1, unread: true, at: '2026-11-26T04:55:00.000Z' })],
      },
    });
    mocks.sendRead.mockResolvedValue({ ok: true, marked: 1 });

    mounted = await mountDom(
      <BellProvider
        candidates={[ORG]}
        scope={SCOPE}
        rooms
        bellCopy={KO_BELL}
        locale="ko"
        send={{ organizations: [ORG], copy: KO_SEND }}
      >
        <WorkspaceBell />
      </BellProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await mounted.click('[data-bell]');

    const row = mounted.query(`[data-bell-item="thread:${ROOT_1}"]`)!;
    const btn = mounted.query(`[data-bell-mark-read="thread:${ROOT_1}"]`)! as unknown as HTMLElement & {
      focus: () => void;
      getAttribute: (k: string) => string | null;
    };
    expect(row.getAttribute('data-kind')).toBe('thread');
    expect(row.getAttribute('data-can-mark')).toBe('true');
    expect(btn.getAttribute('tabindex')).toBeNull();
    expect(btn.getAttribute('aria-hidden')).toBeNull();
    btn.focus();
    expect(mounted.document.activeElement).toBe(btn);
    await mounted.click(`[data-bell-mark-read="thread:${ROOT_1}"]`);
    expect(mocks.sendRead).toHaveBeenCalledWith(ORG, ROOT_1, '2026-11-26T04:55:00.000Z');
  });
});
