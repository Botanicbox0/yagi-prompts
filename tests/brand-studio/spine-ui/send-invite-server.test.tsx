import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { BrandWorkspaceChoice } from '@/lib/brands/workspace/selection';
import type { BrandAssetHubProps } from '@/components/brand-studio/asset-hub';
import type { StudioSpineProps } from '@/lib/brand-studio/open-project';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioState } from '../ui/fixtures';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const PROJ = '11111111-1111-4111-8111-111111111111';
const USER_1 = '55555555-5555-4555-8555-555555555551';

const state = vi.hoisted(() => ({
  locale: 'ko' as 'ko' | 'en',
  role: 'owner' as BrandWorkspaceChoice['role'],
  staff: false,
  spineOpen: true,
  sendSwitchesOn: true,
  sendOpenFor: true,
  inviteOpenFor: true as boolean | Error,
  inboxData: { ok: true, view: 'all', threads: [], next: null, unread: 0, mentionsUnread: 0 } as unknown,
  threadData: { ok: false, code: 'not_found' } as unknown,
  capturedStudioApp: null as Record<string, unknown> | null,
  capturedVideoWorkspace: null as Record<string, unknown> | null,
  capturedAssetHub: null as BrandAssetHubProps | null,
  capturedInboxProps: null as Record<string, unknown> | null,
  runSendCalls: [] as Array<{ op: string; input: Record<string, unknown> }>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/brand/studio',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
  return {
    ...actual,
    brandStudioV2Open: () => true,
    brandRoomsOpen: () => true,
    brandRoomNotifyOpen: () => true,
    brandStudioProjectsOpen: () => true,
  };
});

vi.mock('@/lib/brand-rooms/members-channel', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-rooms/members-channel')>(
    '@/lib/brand-rooms/members-channel',
  );
  return {
    ...actual,
    brandSendSwitchesOn: () => state.sendSwitchesOn,
    brandSendOpenFor: vi.fn(async () => state.sendOpenFor),
  };
});

const inviteOpenSpy = vi.hoisted(() =>
  vi.fn(async () => {
    if (state.inviteOpenFor instanceof Error) throw state.inviteOpenFor;
    return state.inviteOpenFor;
  }),
);

vi.mock('@/lib/brand-rooms/send-invite', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-rooms/send-invite')>(
    '@/lib/brand-rooms/send-invite',
  );
  return {
    ...actual,
    brandSendInviteOpenFor: inviteOpenSpy,
  };
});

vi.mock('@/lib/brand-rooms/send', () => ({
  runSendOperation: vi.fn(async (_deps: unknown, _viewer: unknown, op: string, input: Record<string, unknown>) => {
    state.runSendCalls.push({ op, input });
    if (op === 'send.thread') return state.threadData;
    return state.inboxData;
  }),
}));

vi.mock('@/lib/brand-studio/open-project-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/open-project-server')>(
    '@/lib/brand-studio/open-project-server',
  );
  const spine: StudioSpineProps = {
    open: { kind: 'unfiled' },
    projects: [{ id: PROJ, title: '봄 향수', origin: 'self', lastActivityAt: '2026-11-26T04:00:00.000Z' }],
    canCreate: true,
    notice: null,
    noticeSource: null,
  };
  return {
    ...actual,
    loadStudioSpine: vi.fn(async (input: { seat: { staff: boolean; role: string } }) => {
      if (!state.spineOpen || input.seat.staff || input.seat.role === 'guest') return null;
      return spine;
    }),
  };
});

vi.mock('@/lib/brand-studio/brand-projects', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/brand-projects')>(
    '@/lib/brand-studio/brand-projects',
  );
  return {
    ...actual,
    brandProjectSpineOpen: vi.fn(async () => state.spineOpen),
  };
});

vi.mock('@/lib/brand-studio/runtime', () => ({
  studioRuntimeDeps: vi.fn(async (sql: SqlRunner) => ({ sql })),
}));

vi.mock('@/lib/brand-studio/service', () => ({
  loadStudioState: vi.fn(async () => studioState()),
  runStudioOperation: vi.fn(async () => ({
    ok: true,
    projects: [],
    brandMaterials: { count: 0, byRole: { logo: 0, product: 0, person: 0, style: 0, place: 0 }, covers: [] },
    unfiled: { counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 }, covers: [] },
  })),
}));

vi.mock('@/lib/brand-studio/asset-projects', () => ({
  loadAssetProjectLinks: vi.fn(async () => ({ ok: true, self: {}, team: {} })),
}));

vi.mock('@/lib/brand-studio/video-projects', () => ({
  loadVideoProjects: vi.fn(async () => ({ ok: true, projects: [], project: null })),
}));

vi.mock('@/components/brand-studio/video/contracts-link', () => ({
  hasProductionContracts: vi.fn(async () => false),
}));

vi.mock('@/lib/brand-studio/visibility', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/visibility')>('@/lib/brand-studio/visibility');
  return {
    ...actual,
    assetHubVisible: () => true,
    studioV2Visible: () => true,
  };
});

vi.mock('@/lib/brand-studio/media-store', () => ({
  createStudioMediaStore: () => ({} as StudioMediaStore),
}));

vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: vi.fn(async () => ({
      sql: { transaction: async () => {} } as unknown as SqlRunner,
      viewer: { userId: USER_1, email: 'a@b.c', tier: 'free', isAdmin: state.staff, locale: state.locale } as Viewer,
      verifiedEmail: 'a@b.c',
      locale: state.locale,
      dict: getDictionary(state.locale),
      b: getDictionary(state.locale).brandWorkspace,
    })),
  };
});

vi.mock('@/components/brand-workspace/scope', async () => {
  const actual = await vi.importActual<typeof import('@/components/brand-workspace/scope')>(
    '@/components/brand-workspace/scope',
  );
  return {
    ...actual,
    brandScope: vi.fn(async () => ({
      selection: { state: 'selected' },
      choice: { id: ORG, name: 'Lumiere', role: state.role, logoUrl: null },
    })),
  };
});

vi.mock('@/lib/brands/workspace/service', () => ({
  loadBrandWorkspace: vi.fn(async () => ({ organizations: [], projects: [] })),
}));

vi.mock('@/components/brand-studio/route-context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    studioRouteOrShowroom: vi.fn(async () => ({
      kind: 'studio' as const,
      choice: { id: ORG, name: 'Lumiere', role: state.role, logoUrl: null },
      access: {
        hasOrganization: true,
        staff: state.staff,
        canRequest: state.role !== 'viewer',
        fresh: false,
        projectScopedOnly: false,
      },
      locale: state.locale,
      dict: getDictionary(state.locale),
      deps: { sql: {} as SqlRunner, verifiedEmail: 'a@b.c' },
      viewer: { userId: USER_1, email: 'a@b.c', tier: 'free', isAdmin: state.staff, locale: state.locale } as Viewer,
    })),
  };
});

vi.mock('@/components/brand-studio/studio-app', () => ({
  StudioApp: (props: Record<string, unknown>) => {
    state.capturedStudioApp = props;
    return <div data-mock-studio-app />;
  },
}));

vi.mock('@/components/brand-studio/video/workspace', () => ({
  VideoStudioWorkspace: (props: Record<string, unknown>) => {
    state.capturedVideoWorkspace = props;
    return <div data-mock-video-workspace />;
  },
}));

vi.mock('@/components/brand-studio/asset-hub', () => ({
  BrandAssetHub: (props: BrandAssetHubProps) => {
    state.capturedAssetHub = props;
    return <div data-mock-asset-hub />;
  },
}));

vi.mock('@/components/brand-send/inbox-page', () => ({
  SendInboxPage: (props: Record<string, unknown>) => {
    state.capturedInboxProps = props;
    return <div data-mock-inbox-page />;
  },
}));

vi.mock('@/components/brand-workspace/bell', () => ({
  WorkspaceBell: () => <span data-mock-bell />,
}));

vi.mock('@/components/brand-studio/project-chip', () => ({
  ProjectSpineProvider: ({ children }: { children: unknown }) => <>{children}</>,
  ProjectChip: () => <span />,
  ProjectGoneNotice: () => null,
}));

describe('Slice 4c §1 server components add `invite: true` only when brandSendInviteOpenFor is true', () => {
  beforeEach(() => {
    state.locale = 'ko';
    state.role = 'owner';
    state.staff = false;
    state.spineOpen = true;
    state.sendSwitchesOn = true;
    state.sendOpenFor = true;
    state.inviteOpenFor = true;
    state.capturedStudioApp = null;
    state.capturedVideoWorkspace = null;
    state.capturedAssetHub = null;
    state.capturedInboxProps = null;
    state.runSendCalls = [];
    inviteOpenSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes invite: true for owner/editor/viewer, omits when closed or throwing, and skips when send is absent across image, video, library, and inbox pages', async () => {
    const { brandStudioV2 } = await import('@/components/brand-studio/v2-page');
    const { default: StudioVideoPage } = await import('@/app/(brand)/brand/studio/video/page');
    const { default: ContentLibrary } = await import('@/app/(brand)/brand/library/page');
    const { default: BrandInboxPage } = await import('@/app/(brand)/brand/inbox/page');
    const getStudioApp = () => state.capturedStudioApp;
    const getVideoWorkspace = () => state.capturedVideoWorkspace;
    const getAssetHub = () => state.capturedAssetHub;
    const getInboxProps = () => state.capturedInboxProps;

    // 1. Open -> viewer ALSO receives send.invite === true across all 4 surfaces
    state.role = 'viewer';
    state.inviteOpenFor = true;

    const imgViewerEl = await brandStudioV2({
      deps: { sql: {} as SqlRunner, verifiedEmail: 'a@b.c' },
      viewer: { userId: USER_1, email: 'a@b.c', tier: 'free', isAdmin: false, locale: 'ko' },
      choice: { id: ORG, name: 'Lumiere', role: 'viewer', logoUrl: null, denied: [] },
      access: { staff: false, hasOrganization: true, canRequest: false, fresh: false, projectScopedOnly: false } as never,
      locale: 'ko',
      brandHost: true,
      tab: undefined,
      mode: undefined,
      project: undefined,
    });
    renderToStaticMarkup(imgViewerEl);
    expect((getStudioApp()?.send as { invite?: boolean })?.invite).toBe(true);

    const vidViewerEl = await StudioVideoPage({ searchParams: Promise.resolve({ organizationId: ORG }) });
    if (vidViewerEl) renderToStaticMarkup(vidViewerEl);
    expect((getVideoWorkspace()?.send as { invite?: boolean })?.invite).toBe(true);

    const libViewerEl = await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) });
    renderToStaticMarkup(libViewerEl as ReactElement);
    expect(getAssetHub()?.send?.invite).toBe(true);

    const threadId = randomUUID();
    const inboxViewerEl = await BrandInboxPage({
      searchParams: Promise.resolve({ organizationId: ORG, thread: threadId }),
    });
    renderToStaticMarkup(inboxViewerEl as ReactElement);
    expect((getInboxProps()?.send as { invite?: boolean })?.invite).toBe(true);
    // Inbox SSR must keep markRead: false
    expect(state.runSendCalls).toContainEqual({
      op: 'send.thread',
      input: { organizationId: ORG, rootId: threadId.toLowerCase(), markRead: false },
    });

    // 2. Invite switch false or error -> send stays present, invite is absent
    state.role = 'owner';
    for (const val of [false, new Error('probe failed')]) {
      state.inviteOpenFor = val;
      state.capturedStudioApp = null;
      state.capturedVideoWorkspace = null;
      state.capturedAssetHub = null;
      state.capturedInboxProps = null;

      renderToStaticMarkup(
        await brandStudioV2({
          deps: { sql: {} as SqlRunner, verifiedEmail: 'a@b.c' },
          viewer: { userId: USER_1, email: 'a@b.c', tier: 'free', isAdmin: false, locale: 'ko' },
          choice: { id: ORG, name: 'Lumiere', role: 'owner', logoUrl: null, denied: [] },
          access: { staff: false, hasOrganization: true, canRequest: true, fresh: false, projectScopedOnly: false } as never,
          locale: 'ko',
          brandHost: true,
          tab: undefined,
          mode: undefined,
          project: undefined,
        }),
      );
      expect(getStudioApp()?.send).toBeTruthy();
      expect((getStudioApp()?.send as Record<string, unknown>)?.invite).toBeUndefined();

      const vidClosed = await StudioVideoPage({ searchParams: Promise.resolve({ organizationId: ORG }) });
      if (vidClosed) renderToStaticMarkup(vidClosed);
      expect(getVideoWorkspace()?.send).toBeTruthy();
      expect((getVideoWorkspace()?.send as Record<string, unknown>)?.invite).toBeUndefined();

      renderToStaticMarkup((await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement);
      expect(getAssetHub()?.send).toBeTruthy();
      expect(getAssetHub()?.send?.invite).toBeUndefined();

      renderToStaticMarkup((await BrandInboxPage({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement);
      expect((getInboxProps()?.send as Record<string, unknown>)?.invite).toBeUndefined();
    }

    // 3. When send is absent (brandSendOpenFor false), brandSendInviteOpenFor is NOT called
    inviteOpenSpy.mockClear();
    state.sendOpenFor = false;
    state.inviteOpenFor = true;
    state.capturedStudioApp = null;
    state.capturedVideoWorkspace = null;
    state.capturedAssetHub = null;

    renderToStaticMarkup(
      await brandStudioV2({
        deps: { sql: {} as SqlRunner, verifiedEmail: 'a@b.c' },
        viewer: { userId: USER_1, email: 'a@b.c', tier: 'free', isAdmin: false, locale: 'ko' },
        choice: { id: ORG, name: 'Lumiere', role: 'owner', logoUrl: null, denied: [] },
        access: { staff: false, hasOrganization: true, canRequest: true, fresh: false, projectScopedOnly: false } as never,
        locale: 'ko',
        brandHost: true,
        tab: undefined,
        mode: undefined,
        project: undefined,
      }),
    );
    const vidNoSend = await StudioVideoPage({ searchParams: Promise.resolve({ organizationId: ORG }) });
    if (vidNoSend) renderToStaticMarkup(vidNoSend);
    renderToStaticMarkup((await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement);
    await expect(BrandInboxPage({ searchParams: Promise.resolve({ organizationId: ORG }) })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getStudioApp()?.send).toBeUndefined();
    expect(getVideoWorkspace()?.send).toBeUndefined();
    expect(getAssetHub()?.send).toBeUndefined();
    expect(inviteOpenSpy).not.toHaveBeenCalled();
  });
});
