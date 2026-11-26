import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { homeLayout } from '@/lib/brands/workspace/home';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { resetSpineProbe } from '@/lib/brands/project-origin';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ORG as FIXTURE_ORG, studioState } from '../ui/fixtures';

const stub = vi.hoisted(() => {
  const org = '10000000-0000-4000-8000-000000000011';
  return {
    org,
    path: '/brand/studio',
    query: `organizationId=${org}`,
    locale: 'ko' as 'ko' | 'en',
    role: 'owner' as 'owner' | 'editor' | 'viewer' | 'studio' | 'guest',
    staff: false,
    scopeChoices: null as BrandWorkspaceChoice[] | null,
    editorReal: true,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => stub.path,
  useSearchParams: () => new URLSearchParams(stub.query),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/app/fonts', () => ({ fontVariables: '' }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => stub.locale }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => ({
    userId: '00000000-0000-4000-8000-000000000001',
    isAdmin: false,
    tier: 'free' as const,
    email: 'member@test.com',
    locale: stub.locale,
  }),
}));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => 'member@test.com' }));
vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () =>
    ({
      query: async (sqlText: string) => {
        if (sqlText.includes('information_schema.columns')) return { rows: [{ n: 4 }] };
        return { rows: [] };
      },
      transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>) =>
        fn({ query: async () => ({ rows: [] }) } as unknown as SqlRunner),
    }) as unknown as SqlRunner,
}));
vi.mock('@/lib/brands/workspace/service', () => ({
  loadBrandWorkspaceScope: async (): Promise<BrandWorkspaceScope> => ({
    choices: stub.scopeChoices ?? [{ id: stub.org, name: 'Fixture brand', role: stub.role as BrandWorkspaceChoice['role'], logoUrl: null }],
    projectOrganizations: {},
  }),
  countPendingSharedCampaigns: async () => 0,
}));
vi.mock('@/components/brand-workspace/rail-activity', async (orig) => {
  const actual = await orig<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({ summary: null, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
    useRoomUnread: () => 0,
  };
});
vi.mock('@/components/brand-studio/route-context', async () => {
  const { getDictionary: getDict } = await import('@/lib/i18n/dictionaries');
  return {
    studioRouteOrShowroom: vi.fn(async () => ({
      kind: 'studio' as const,
      choice: { id: stub.org, name: 'Fixture brand', role: stub.role, logoUrl: null },
      access: {
        hasOrganization: true,
        isOwner: stub.role === 'owner',
        staff: stub.staff,
        fresh: false,
        projectScopedOnly: false,
        canRequest: !stub.staff && (stub.role === 'owner' || stub.role === 'editor'),
      },
      locale: stub.locale,
      dict: getDict(stub.locale),
      deps: {
        sql: {
          query: async () => ({ rows: [] }),
          transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>) => fn({ query: async () => ({ rows: [] }) } as unknown as SqlRunner),
        } as unknown as SqlRunner,
      },
      viewer: {
        userId: '00000000-0000-4000-8000-000000000001',
        tier: 'free' as const,
        isAdmin: false,
        email: 'member@test.com',
        locale: stub.locale,
      },
    })),
    studioRouteContext: vi.fn(async () => ({
      choice: { id: stub.org, name: 'Fixture brand', role: stub.role, logoUrl: null },
      access: {
        hasOrganization: true,
        isOwner: stub.role === 'owner',
        staff: stub.staff,
        fresh: false,
        projectScopedOnly: false,
        canRequest: !stub.staff && (stub.role === 'owner' || stub.role === 'editor'),
      },
      locale: stub.locale,
      dict: getDict(stub.locale),
      deps: {
        sql: {
          query: async () => ({ rows: [] }),
          transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>) => fn({ query: async () => ({ rows: [] }) } as unknown as SqlRunner),
        } as unknown as SqlRunner,
      },
      viewer: {
        userId: '00000000-0000-4000-8000-000000000001',
        tier: 'free' as const,
        isAdmin: false,
        email: 'member@test.com',
        locale: stub.locale,
      },
    })),
  };
});
vi.mock('@/lib/brands/entitlements', () => ({
  assertBrandFeature: vi.fn(async () => {}),
  BrandFeatureDenied: class BrandFeatureDenied extends Error {},
}));
vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
  return {
    ...actual,
    brandSoundStudioOpen: vi.fn(() => true),
    brandStudioEditorV2Open: vi.fn(() => true),
    brandStudioEditorV2DefaultFor: vi.fn(() => stub.editorReal),
    brandWorkspacePrototypeLayerOpen: vi.fn(() => true),
  };
});
vi.mock('@/lib/brand-studio/visibility', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/visibility')>('@/lib/brand-studio/visibility');
  return {
    ...actual,
    soundStudioVisible: vi.fn(() => true),
  };
});
vi.mock('@/lib/brand-studio/sound/load', () => ({
  loadSoundStudio: vi.fn(async () => ({
    tracks: [],
    jobs: [],
    videos: [],
    allowance: studioState().allowance,
  })),
}));
vi.mock('@/lib/brand-studio/video-projects', () => ({
  listVideoProjects: vi.fn(async () => []),
  loadVideoProject: vi.fn(async () => null),
}));
vi.mock('@/lib/brand-studio/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/repo')>('@/lib/brand-studio/repo');
  return {
    ...actual,
    assetsOf: vi.fn(async () => []),
    jobsOf: vi.fn(async () => []),
    viewsOf: vi.fn(async () => []),
  };
});
vi.mock('@/lib/brand-studio/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/service')>('@/lib/brand-studio/service');
  return {
    ...actual,
    loadStudioState: vi.fn(async () => studioState()),
  };
});
vi.mock('@/lib/brand-studio/open-project-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/open-project-server')>(
    '@/lib/brand-studio/open-project-server',
  );
  return {
    ...actual,
    loadStudioSpine: vi.fn(async () => null),
  };
});

import BrandLayout from '@/app/(brand)/layout';
import StudioVideoPage from '@/app/(brand)/brand/studio/video/page';
import StudioSoundPage from '@/app/(brand)/brand/studio/sound/page';
import StudioEditorV2Page from '@/app/(brand)/brand/studio/editor/page';
import { BrandAssetHub } from '@/components/brand-studio/asset-hub';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { brandStudioV2 } from '@/components/brand-studio/v2-page';
import { BellProvider } from '@/components/brand-workspace/bell/provider';
import { pickBellCopy } from '@/components/brand-workspace/bell/model';
import { WorkspaceBell } from '@/components/brand-workspace/bell';
import { WorkspaceHome } from '@/components/brand-workspace/home/home-view';

const ORG = FIXTURE_ORG;
const CANDIDATES = [ORG] as const;
const SCOPE: BrandWorkspaceScope = {
  choices: [{ id: ORG, name: 'Fixture brand', role: 'owner', logoUrl: null }],
  projectOrganizations: {},
};

const KO_DICT = getDictionary('ko');
const KO_BELL_COPY = pickBellCopy(KO_DICT);

function wrapBell(children: ReactElement) {
  return (
    <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={KO_BELL_COPY} locale="ko">
      {children}
    </BellProvider>
  );
}

describe('Bell slots across Layout, Home, and the 4 Studios', () => {
  beforeEach(() => {
    resetSpineProbe();
    stub.org = ORG;
    stub.path = '/brand/studio';
    stub.query = `organizationId=${ORG}`;
    stub.locale = 'ko';
    stub.role = 'owner';
    stub.staff = false;
    stub.scopeChoices = null;
    stub.editorReal = true;
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', ORG);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wires BrandLayout bellCopy & locale so open 직접 만들기 views render data-bell and closed/team omit it', async () => {
    const activeHtml = renderToStaticMarkup(await BrandLayout({ children: <WorkspaceBell /> }));
    expect(activeHtml).toContain('data-bell');
    expect(activeHtml).toContain('aria-label="알림"');

    stub.locale = 'en';
    const enHtml = renderToStaticMarkup(await BrandLayout({ children: <WorkspaceBell /> }));
    expect(enHtml).toContain('aria-label="Notifications"');

    stub.path = '/brand';
    const teamHtml = renderToStaticMarkup(await BrandLayout({ children: <WorkspaceBell /> }));
    expect(teamHtml).not.toContain('data-bell');

    vi.stubEnv('BRAND_PROJECT_SPINE', 'off');
    stub.path = '/brand/studio';
    const closedHtml = renderToStaticMarkup(await BrandLayout({ children: <WorkspaceBell /> }));
    expect(closedHtml).not.toContain('data-bell');
    expect(closedHtml).not.toContain(KO_BELL_COPY.bellEmpty);
  });

  it('places data-bell at the right end of Home top row only when spineHome and active BellProvider exist', () => {
    const d = KO_DICT;
    const layout = homeLayout({ choice: { id: ORG, name: 'Fixture', role: 'owner' }, flagOn: true, canRequest: true, rooms: true })!;
    const baseHomeProps = {
      organizationId: ORG,
      organizationName: 'Fixture',
      locale: 'ko' as const,
      layout,
      allowance: { capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' },
      reviews: [],
      results: [],
      activeProjects: 0,
      readOnly: false,
      viewerNote: false,
      checklist: null,
      canOpenBilling: true,
      spineHome: {
        cards: {
          ok: true as const,
          projects: [],
          unfiled: { counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 }, covers: [] },
        },
        canCreate: true,
        roomsOpen: true,
      },
      copy: {
        home: d.brandHome,
        shell: d.studioShell,
        roomsNav: d.roomsShell.nav,
        inbox: d.roomsChat.inbox,
        prompt: {
          label: d.brandStudio.dock.label,
          placeholder: { image: d.brandStudio.dock.placeholder, video: d.brandStudio.dock.placeholderVideo },
        },
        activeStatus: d.brandWorkspace.status.active,
        allAssets: d.studioLibrary.allAssets,
        closedRequestDraft: d.brandStudio.dock.closedRequestDraft,
        closedRequestOrgFallback: d.brandStudio.dock.closedRequestOrgFallback,
        billingCustomer: d.brandBilling.customer,
        projectHome: d.projectHome,
        projectSpine: d.projectSpine,
        libraryHub: d.studioLibrary.hub,
        roomsOverview: d.roomsShell.overview,
      },
    };

    const withoutBell = renderToStaticMarkup(<WorkspaceHome {...baseHomeProps} />);
    expect(withoutBell).toContain('data-home-top-row');
    expect(withoutBell).not.toContain('data-bell');

    const withBell = renderToStaticMarkup(wrapBell(<WorkspaceHome {...baseHomeProps} />));
    expect(withBell).toMatch(/data-home-top-row=""[^>]*><h1[^>]*>.*?<\/h1>.*data-bell=""/);
  });

  it('places data-bell at the right end of Image, Video, Sound, Editing (compact 34px), and Assets headers', async () => {
    const choice: BrandWorkspaceChoice = { id: ORG, name: 'Fixture brand', role: 'owner', logoUrl: null };

    // 1. Image studio (v2-page.tsx)
    const imgEl = await brandStudioV2({
      deps: { sql: { query: async () => ({ rows: [] }) } as unknown as SqlRunner },
      viewer: {
        userId: '00000000-0000-4000-8000-000000000001',
        tier: 'free',
        isAdmin: false,
        email: 'member@test.com',
        locale: 'ko',
      },
      choice,
      access: {
        hasOrganization: true,
        isOwner: true,
        staff: false,
        fresh: false,
        projectScopedOnly: false,
        canRequest: true,
      },
      locale: 'ko',
      brandHost: true,
      tab: undefined,
      mode: undefined,
    });
    const imgWithoutBell = renderToStaticMarkup(imgEl);
    expect(imgWithoutBell).toContain('<h1 class="bs-title">이미지 스튜디오</h1><div class="bs-head-slot"');
    expect(imgWithoutBell).not.toContain('data-bell');
    const imgBellHtml = renderToStaticMarkup(wrapBell(imgEl));
    expect(imgBellHtml).toMatch(/data-studio-head-slot="true"[^>]*><\/div>.*data-bell=""/);

    // 2. Video studio (video/page.tsx)
    const videoEl = (await StudioVideoPage({
      searchParams: Promise.resolve({ organizationId: ORG }),
    })) as ReactElement;
    expect(renderToStaticMarkup(videoEl)).not.toContain('data-bell');
    const videoBellHtml = renderToStaticMarkup(wrapBell(videoEl));
    expect(videoBellHtml).toMatch(/data-studio-head-slot="true"[^>]*><\/div>.*data-bell=""/);

    // 3. Sound studio (sound-studio.tsx)
    const soundEl = (await StudioSoundPage({
      searchParams: Promise.resolve({ organizationId: ORG }),
    })) as ReactElement;
    expect(renderToStaticMarkup(soundEl)).not.toContain('data-bell');
    const soundBellHtml = renderToStaticMarkup(wrapBell(soundEl));
    expect(soundBellHtml).toMatch(/data-sound-credits="true"[^>]*>.*?<\/span>.*data-bell=""/);

    // 4. Editing studio v2 (editor-v2.tsx) — real mode + compact 34px size
    const editorRealEl = (await StudioEditorV2Page({
      searchParams: Promise.resolve({ organizationId: ORG }),
    })) as ReactElement;
    expect(renderToStaticMarkup(editorRealEl)).not.toContain('data-bell');
    const editorBellHtml = renderToStaticMarkup(wrapBell(editorRealEl));
    expect(editorBellHtml).toMatch(/data-editor-export="true"[^>]*>.*?<\/button>.*data-bell="" data-size="compact"/);

    // Editing studio sample mode still hosts the bell when BellProvider says 직접 만들기 is active
    const editorSampleEl = (await StudioEditorV2Page({
      searchParams: Promise.resolve({ organizationId: ORG, sample: '1' }),
    })) as ReactElement;
    const editorSampleBellHtml = renderToStaticMarkup(wrapBell(editorSampleEl));
    expect(editorSampleBellHtml).toMatch(/data-editor-export="true"[^>]*>.*?<\/button>.*data-bell="" data-size="compact"/);

    // 5. Assets hub (asset-hub.tsx) — right end of header right-hand group after data-asset-hub-upload
    const stubLib: StudioLibrary = {
      ready: true,
      folders: [],
      liked: new Set(),
      likedItems: [],
      folderItems: () => null,
      openFolder: () => {},
      toggleLike: async () => true,
      createFolder: async () => null,
      renameFolder: async () => true,
      deleteFolder: async () => true,
      addToFolder: async () => true,
      removeFromFolder: async () => true,
    };
    const hubEl = (
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={studioState()}
        injectedLibrary={stubLib}
      />
    );
    expect(renderToStaticMarkup(hubEl)).not.toContain('data-bell');
    const hubBellHtml = renderToStaticMarkup(wrapBell(hubEl));
    expect(hubBellHtml).toMatch(
      /data-asset-hub-upload="true"[^>]*>.*?<\/button><div[^>]*data-bell-wrap=""[^>]*><button[^>]*data-bell=""[\s\S]*?<\/button><\/div><\/div><\/div><\/header>/,
    );

    const viewerHubBellHtml = renderToStaticMarkup(
      wrapBell(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={KO_DICT.brandStudio}
          libraryCopy={KO_DICT.studioLibrary}
          initialState={studioState({ canCreate: false })}
          injectedLibrary={stubLib}
        />,
      ),
    );
    expect(viewerHubBellHtml).toContain('data-bell=""');
  });

  it('keeps app/(brand)/brand/library and asset-hub-model untouched, and passes no inline object literals on header bell slots', () => {
    const root = process.cwd();
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full, acc);
        else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
      }
      return acc;
    };

    const untouchedAssets = [
      ...walk(path.join(root, 'app/(brand)/brand/library')),
      path.join(root, 'components/brand-studio/asset-hub-model.ts'),
    ];
    for (const file of untouchedAssets) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toContain('WorkspaceBell');
      expect(src).not.toContain('data-bell');
    }

    const slotFiles = [
      'components/brand-workspace/home/home-view.tsx',
      'components/brand-studio/v2-page.tsx',
      'app/(brand)/brand/studio/video/page.tsx',
      'components/brand-studio/sound/sound-studio.tsx',
      'components/brand-studio/editor-v2/editor-v2.tsx',
      'components/brand-studio/asset-hub.tsx',
    ];
    for (const rel of slotFiles) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src).not.toMatch(/<WorkspaceBell[^>]*=\{\s*[\[{]/);
    }
  });
});
