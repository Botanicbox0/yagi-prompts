import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import type { SpineHomeProps } from '@/components/brand-workspace/home/project-cards';
import type { Viewer } from '@/lib/auth/identity';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import type { HomeAnnouncement } from '@/lib/brand-news/contracts';
import { resetBrandNewsProbe } from '@/lib/brand-news/service';
import type { StudioBrandProjectCard, StudioBrandProjectCounts } from '@/lib/brand-studio/contracts';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeLayout, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { ADMIN_VIEWER, formOf } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * Slice N2 Step 0 parity snapshots — captured on the untouched branch BEFORE any other edit.
 * NEVER regenerate these snapshots: any later failure proves an unintended change when
 * `BRAND_NEWS` is off, when 0204 is not yet applied, or when no news prop is passed.
 */
const mocks = vi.hoisted(() => ({
  path: '/brand/home',
  query: '',
  unread: 0,
  sql: null as SqlRunner | null,
  viewer: {
    tier: 'admin',
    userId: 'f0000000-0000-4000-8000-000000000003',
    email: 'admin@yagiworkshop.xyz',
    isAdmin: true,
    locale: 'ko',
  } as Viewer,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/i18n/server', () => ({
  getLocaleFromHeaders: async () => 'ko' as const,
}));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({
    admin: true,
    brand: false,
    workspace: true,
    origin: 'https://admin.twings.app',
  }),
  publicHref: (p: string, admin: boolean) => (admin ? `https://twings.app${p}` : p),
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => mocks.viewer,
  getViewer: async () => mocks.viewer,
}));
vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () => mocks.sql,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({ summary: null, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
    useRoomUnread: () => mocks.unread,
  };
});

import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import { WorkspaceTeamHome, type TeamHomeProject } from '@/components/brand-workspace/home/team-home';

const AdminBrandNewsPage = (await import('@/app/(admin)/admin/brand-news/page')).default;

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const NAME = 'Fern & Field';
const NOW = new Date('2026-11-27T00:00:00.000Z');
const FIXED_DRAFT_ID = '55555555-5555-4555-8555-555555555555';
const FIXED_NEWS_ID = '33333333-3333-4333-8333-333333333333';
const ALLOWANCE = { capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' };

async function freshPre0204Db(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
  `);
  for (const file of coreMigrationFiles()) {
    const version = Number(file.split('_')[0]);
    if (version <= 203) {
      await db.exec(readMigration(file));
    }
  }
  return db;
}

async function seedPre0204Draft(sql: SqlRunner): Promise<void> {
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
    ORG,
    NAME,
    ADMIN_VIEWER.userId!,
    '10000000-0000-4000-8000-000000000099',
  ]);
  await sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
    ORG,
    ADMIN_VIEWER.userId!,
  ]);
  await sql.query(
    `insert into brand_announcements
       (id, slot, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape,
        starts_at, ends_at, audience, status, created_by, created_at, updated_at)
     values
       ($1, 'home', '새 기능', 'New', '고정 초안 한국어 문구', 'Fixed draft English line', '보기', 'View',
        '/brand/studio/video', 'line', '2026-11-20T01:00:00.000Z', '2026-12-20T01:00:00.000Z', '{}'::jsonb,
        'draft', $2, '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z')`,
    [FIXED_DRAFT_ID, ADMIN_VIEWER.userId!],
  );
}

const legacyCopyOf = (locale: 'ko' | 'en', withBrandNews = false): WorkspaceHomeProps['copy'] => {
  const d = getDictionary(locale);
  return {
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
    ...(withBrandNews ? { brandNews: d.brandNews } : {}),
  };
};

const spineCopyOf = (locale: 'ko' | 'en', withBrandNews = false): Extract<WorkspaceHomeProps, { spineHome: SpineHomeProps }>['copy'] => {
  const d = getDictionary(locale);
  return {
    ...legacyCopyOf(locale, withBrandNews),
    projectHome: d.projectHome,
    projectSpine: d.projectSpine,
    libraryHub: d.studioLibrary.hub,
    roomsOverview: d.roomsShell.overview,
  };
};

const layoutOf = (role: 'owner' | 'viewer' = 'owner'): HomeLayout =>
  homeLayout({ choice: { id: ORG, name: NAME, role }, flagOn: true, canRequest: role === 'owner', rooms: true })!;

const emptyCounts = (over: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...over,
});

const SAMPLE_CARDS: StudioBrandProjectCard[] = [
  {
    project: { id: '10000000-0000-4000-8000-000000000001', title: '봄 향수 론칭', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' },
    counts: emptyCounts({ image: 24, video: 6, sound: 2 }),
    covers: [],
    lastActivity: { at: '2026-11-26T10:00:00.000Z', kind: 'video', item: { type: 'job', id: 'j1' }, actorName: '김서아' },
    unread: 0,
    stage: null,
  },
];

const SAMPLE_SPINE: SpineHomeProps = {
  canCreate: true,
  roomsOpen: true,
  cards: {
    ok: true,
    projects: SAMPLE_CARDS,
    unfiled: { counts: emptyCounts(), covers: [] },
  },
};

const SAMPLE_RESULTS: HomeResult[] = [
  {
    outputId: '00000000-0000-4000-8000-000000000001',
    kind: 'image',
    src: '/m/still-1.webp',
    clip: null,
    play: null,
    width: 800,
    height: 1000,
    seconds: null,
    href: `/brand/studio?organizationId=${ORG}&view=o%3A00000000-0000-4000-8000-000000000001`,
  },
];

const CHECKLIST: FirstRunChecklistState = {
  show: true,
  hasTeammate: false,
  hasLogo: false,
  hasUploads: false,
  usageApproved: false,
  usageRequestSent: false,
  usageState: 'not_requested',
  hasFirstImage: false,
};

const TEAM_ALERT: RoomAlertItem = {
  id: 'alert-1',
  kind: 'review',
  projectId: 'p0000000-0000-4000-8000-000000000001',
  projectTitle: 'Spring launch 1',
  targetId: 't0000000-0000-4000-8000-000000000001',
  title: 'Cut 1',
  version: 1,
  openNotes: 0,
  updatedAt: '2026-11-24T00:00:00Z',
};

const TEAM_PROJECTS: TeamHomeProject[] = [
  {
    id: 'p0000000-0000-4000-8000-000000000001',
    title: 'Spring launch',
    stage: 'storyboard',
    steps: [
      { stage: 'requested', state: 'done', at: '2026-11-20T01:00:00.000Z' },
      { stage: 'storyboard', state: 'current', at: '2026-11-25T05:00:00.000Z' },
      { stage: 'draft', state: 'ahead', at: null },
      { stage: 'revision', state: 'ahead', at: null },
      { stage: 'done', state: 'ahead', at: null },
    ],
    unread: 2,
  },
];

const TEAM_COPY = (() => {
  const ko = getDictionary('ko');
  return {
    home: ko.brandHome,
    nav: ko.roomsShell.nav,
    space: ko.roomsShell.space,
    overview: ko.roomsShell.overview,
    inbox: ko.roomsChat.inbox,
  };
})();

const LINE_NEWS: HomeAnnouncement = {
  id: FIXED_NEWS_ID,
  kicker: '새 기능',
  title: '영상 스튜디오에서 참고 영상으로 바로 시작할 수 있습니다',
  ctaLabel: '써 보기',
  href: `/brand/studio/video?start=reverse&organizationId=${ORG}`,
  external: false,
  shape: 'line',
  image: null,
};

const BANNER_NEWS: HomeAnnouncement = {
  ...LINE_NEWS,
  shape: 'banner',
  image: { url: 'https://media.example.test/public-content/banner.webp', width: 1600, height: 400 },
};

async function renderHtml(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

function extractMainMarkup(fullHtml: string): string {
  const match = /<main id="main" class="admin-main">[\s\S]*<\/main>/.exec(fullHtml);
  if (!match) throw new Error('Expected <main id="main" class="admin-main"> in rendered AdminShell HTML');
  return match[0];
}

let db: PGlite | null = null;
let storageRoot: string | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetBrandNewsProbe();
  mocks.path = '/brand/home';
  mocks.query = '';
  mocks.unread = 0;
  mocks.sql = null;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetBrandNewsProbe();
  mocks.sql = null;
  if (db) {
    await db.close();
    db = null;
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
    storageRoot = null;
  }
});

describe('Slice N2 Step 0 parity snapshots', () => {
  it('matches make-mode home without news and with line/banner news', async () => {
    const withoutNews = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={ALLOWANCE}
        reviews={[]}
        results={SAMPLE_RESULTS}
        activeProjects={1}
        readOnly={false}
        checklist={CHECKLIST}
        canOpenBilling
        spineHome={SAMPLE_SPINE}
        copy={spineCopyOf('ko', false)}
      />,
    );
    await expect(withoutNews).toMatchFileSnapshot('./__snapshots__/news2-make-home-without-news.html');

    const withLine = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={ALLOWANCE}
        reviews={[]}
        results={SAMPLE_RESULTS}
        activeProjects={1}
        readOnly={false}
        checklist={CHECKLIST}
        canOpenBilling
        news={LINE_NEWS}
        spineHome={SAMPLE_SPINE}
        copy={spineCopyOf('ko', true)}
      />,
    );
    await expect(withLine).toMatchFileSnapshot('./__snapshots__/news2-make-home-with-line.html');

    const withBanner = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={ALLOWANCE}
        reviews={[]}
        results={SAMPLE_RESULTS}
        activeProjects={1}
        readOnly={false}
        checklist={CHECKLIST}
        canOpenBilling
        news={BANNER_NEWS}
        spineHome={SAMPLE_SPINE}
        copy={spineCopyOf('ko', true)}
      />,
    );
    await expect(withBanner).toMatchFileSnapshot('./__snapshots__/news2-make-home-with-banner.html');
  });

  it('matches TEAM-mode home without news prop', async () => {
    const projectsHtml = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG}
        organizationName={NAME}
        projects={TEAM_PROJECTS}
        totalProjects={1}
        reviews={[TEAM_ALERT]}
        canRequest
        copy={TEAM_COPY}
      />,
    );
    await expect(projectsHtml).toMatchFileSnapshot('./__snapshots__/news2-team-home-projects.html');

    const emptyHtml = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG}
        organizationName={NAME}
        projects={[]}
        totalProjects={0}
        reviews={[]}
        canRequest
        copy={TEAM_COPY}
      />,
    );
    await expect(emptyHtml).toMatchFileSnapshot('./__snapshots__/news2-team-home-empty.html');

    const viewerHtml = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG}
        organizationName={NAME}
        projects={TEAM_PROJECTS}
        totalProjects={1}
        reviews={[]}
        canRequest={false}
        viewerNote
        copy={TEAM_COPY}
      />,
    );
    await expect(viewerHtml).toMatchFileSnapshot('./__snapshots__/news2-team-home-viewer.html');
  });

  it('matches AdminBrandNewsPage server <main> markup with flag off and flag on (pre-0204 DB)', async () => {
    db = await freshPre0204Db();
    const sql = runner(db);
    await seedPre0204Draft(sql);
    mocks.sql = sql;

    vi.stubEnv('BRAND_NEWS', 'off');
    const offFull = await renderHtml((await AdminBrandNewsPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    await expect(extractMainMarkup(offFull)).toMatchFileSnapshot('./__snapshots__/news2-admin-page-flag-off.html');

    vi.stubEnv('BRAND_NEWS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const onFull = await renderHtml(
      (await AdminBrandNewsPage({ searchParams: Promise.resolve({ edit: FIXED_DRAFT_ID }) })) as ReactElement,
    );
    await expect(extractMainMarkup(onFull)).toMatchFileSnapshot('./__snapshots__/news2-admin-page-flag-on-pre0204.html');
  });

  it('matches the three operations answers for a fixed draft (flag off and flag on on pre-0204 DB)', async () => {
    db = await freshPre0204Db();
    const sql = runner(db);
    await seedPre0204Draft(sql);
    storageRoot = await mkdtemp(join(tmpdir(), 'news2-parity-'));
    const storage = createLocalStorageDriver(storageRoot);
    const ctx: AdminContext = { sql, storage, viewer: ADMIN_VIEWER };

    const draftEditFields = {
      id: FIXED_DRAFT_ID,
      kickerKo: '새 기능',
      kickerEn: 'New',
      titleKo: '수정된 고정 초안 문구',
      titleEn: 'Updated fixed draft line',
      ctaLabelKo: '보기',
      ctaLabelEn: 'View',
      ctaHref: '/brand/studio/video',
      shape: 'line',
      startsAt: '2026-11-20T10:00',
      endsAt: '2026-12-20T10:00',
    };

    vi.stubEnv('BRAND_NEWS', 'off');
    const offSave = await dispatchAdmin('brandNews.save', formOf('brandNews.save', draftEditFields), ctx);
    const offPublish = await dispatchAdmin('brandNews.publish', formOf('brandNews.publish', { id: FIXED_DRAFT_ID }), ctx);
    const offEnd = await dispatchAdmin('brandNews.end', formOf('brandNews.end', { id: FIXED_DRAFT_ID }), ctx);

    vi.stubEnv('BRAND_NEWS', 'on');
    const onSave = await dispatchAdmin('brandNews.save', formOf('brandNews.save', draftEditFields), ctx);
    const onPublish = await dispatchAdmin('brandNews.publish', formOf('brandNews.publish', { id: FIXED_DRAFT_ID }), ctx);
    const onEnd = await dispatchAdmin('brandNews.end', formOf('brandNews.end', { id: FIXED_DRAFT_ID }), ctx);

    const payload = JSON.stringify(
      {
        flagOff: { save: offSave, publish: offPublish, end: offEnd },
        flagOnPre0204: { save: onSave, publish: onPublish, end: onEnd },
      },
      null,
      2,
    );
    await expect(payload).toMatchFileSnapshot('./__snapshots__/news2-ops-fixed-draft.json');
  });
});
