import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTeamHome, type TeamHomeProject, type WorkspaceTeamHomeProps } from '@/components/brand-workspace/home/team-home';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import type { Viewer } from '@/lib/auth/identity';
import type { HomeAnnouncement } from '@/lib/brand-news/contracts';
import { resetBrandNewsProbe } from '@/lib/brand-news/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  modeCookie: undefined as string | undefined,
  loadHomeSpy: vi.fn(),
}));

vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({
    get: (name: string) => (name === 'twings_brand_mode' && mocks.modeCookie ? { name, value: mocks.modeCookie } : undefined),
  }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => undefined }));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: mocks.viewer, sql: mocks.sql, verifiedEmail: undefined, brandHost: false, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/home',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/brand-news/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand-news/service')>();
  return {
    ...actual,
    loadHomeAnnouncement: async (...args: Parameters<typeof actual.loadHomeAnnouncement>) => {
      mocks.loadHomeSpy(...args);
      return actual.loadHomeAnnouncement(...args);
    },
  };
});

const homePage = (await import('@/app/(brand)/brand/home/page')).default;

const ORG = 'b0000000-0000-4000-8000-0000000000b1';
const NAME = 'Studio Team Brand';
const TEAM_NEWS_ID = '44444444-4444-4444-8444-444444444444';

function teamCopyOf(locale: 'ko' | 'en', withNews = false): WorkspaceTeamHomeProps['copy'] {
  const d = getDictionary(locale);
  return {
    home: d.brandHome,
    nav: d.roomsShell.nav,
    space: d.roomsShell.space,
    overview: d.roomsShell.overview,
    inbox: d.roomsChat.inbox,
    ...(withNews ? { brandNews: d.brandNews } : {}),
  };
}

const SAMPLE_PROJECT: TeamHomeProject = {
  id: 'p0000000-0000-4000-8000-000000000001',
  title: '봄 캠페인 영상',
  stage: 'storyboard',
  steps: [
    { stage: 'requested', state: 'done', at: '2026-11-20T01:00:00.000Z' },
    { stage: 'storyboard', state: 'current', at: '2026-11-25T05:00:00.000Z' },
    { stage: 'draft', state: 'ahead', at: null },
    { stage: 'revision', state: 'ahead', at: null },
    { stage: 'done', state: 'ahead', at: null },
  ],
  unread: 1,
};

const SAMPLE_ALERT: RoomAlertItem = {
  id: 'alert-team-1',
  kind: 'review',
  projectId: SAMPLE_PROJECT.id,
  projectTitle: SAMPLE_PROJECT.title,
  targetId: 'rev-1',
  title: '시안 v1',
  version: 1,
  openNotes: 0,
  updatedAt: '2026-11-25T00:00:00Z',
};

const TEAM_NEWS: HomeAnnouncement = {
  id: TEAM_NEWS_ID,
  kicker: '안내',
  title: '야기 팀과 홈에서도 중요한 일정을 한 줄로 알립니다',
  ctaLabel: '일정 보기',
  href: `/brand/rooms?organizationId=${ORG}`,
  external: false,
  shape: 'line',
  image: null,
};

let dom: MountedDom | null = null;
let f: StudioFixture | null = null;

afterEach(async () => {
  if (dom) await dom.unmount();
  dom = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetBrandNewsProbe();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
  mocks.modeCookie = undefined;
  mocks.loadHomeSpy.mockClear();
});

describe('Slice N2 team-mode home news line', () => {
  it('renders HomeNewsLine between header/notes and first block only when news is passed', () => {
    const withoutNews = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG}
        organizationName={NAME}
        projects={[SAMPLE_PROJECT]}
        totalProjects={1}
        reviews={[SAMPLE_ALERT]}
        canRequest
        viewerNote
        copy={teamCopyOf('ko', false)}
      />,
    );
    expect(withoutNews).toContain('data-home-viewer-note');
    expect(withoutNews).not.toContain('data-home-news');

    const withNews = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG}
        organizationName={NAME}
        projects={[SAMPLE_PROJECT]}
        totalProjects={1}
        reviews={[SAMPLE_ALERT]}
        canRequest
        viewerNote
        news={TEAM_NEWS}
        copy={teamCopyOf('ko', true)}
      />,
    );
    expect(withNews).toContain(`data-home-news="${TEAM_NEWS_ID}"`);
    expect(withNews.indexOf('data-home-viewer-note')).toBeLessThan(withNews.indexOf(`data-home-news="${TEAM_NEWS_ID}"`));
    expect(withNews.indexOf(`data-home-news="${TEAM_NEWS_ID}"`)).toBeLessThan(withNews.indexOf('data-home-team-waiting'));

    const emptyWithNews = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG}
        organizationName={NAME}
        projects={[]}
        totalProjects={0}
        reviews={[]}
        canRequest
        news={TEAM_NEWS}
        copy={teamCopyOf('ko', true)}
      />,
    );
    expect(emptyWithNews.indexOf(`data-home-news="${TEAM_NEWS_ID}"`)).toBeLessThan(emptyWithNews.indexOf('data-home-team-empty'));
  });

  it('closes the line, moves focus to the next team-home control, and posts news.dismiss once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, id: TEAM_NEWS_ID }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    dom = await mountDom(
      <WorkspaceTeamHome
        organizationId={ORG}
        organizationName={NAME}
        projects={[SAMPLE_PROJECT]}
        totalProjects={1}
        reviews={[SAMPLE_ALERT]}
        canRequest
        news={TEAM_NEWS}
        copy={teamCopyOf('ko', true)}
      />,
    );

    const line = dom.query(`[data-home-news="${TEAM_NEWS_ID}"]`);
    expect(line).not.toBeNull();
    const closeBtn = dom.query(`[data-home-news="${TEAM_NEWS_ID}"] button[aria-label="닫기"]`);
    expect(closeBtn).not.toBeNull();

    await dom.click(closeBtn!);

    expect(dom.query(`[data-home-news="${TEAM_NEWS_ID}"]`)).toBeNull();
    expect((dom.document.activeElement as unknown as HTMLElement | null)?.getAttribute('data-home-review')).toBe('review');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/brand-workspace');
    expect(JSON.parse(String(init.body))).toEqual({
      operation: 'news.dismiss',
      input: {
        organizationId: ORG,
        announcementId: TEAM_NEWS_ID,
      },
    });
  });

  it('loads team_home slot in /brand/home team mode and isolates home-only announcements', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_NEWS', 'on');
    f = await studioFixture({ orgName: 'Team Slot Brand', capKrw: 100_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    mocks.modeCookie = `${f.orgId}:team`;

    const startsAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const endsAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const homeOnlyId = randomUUID();
    await f.sql.query(
      `insert into brand_announcements (id, slot, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, starts_at, ends_at, audience, status, published_at)
       values ($1, 'home', '홈', 'Home', '직접 만들기 전용 소식', 'Make only news', '열기', 'Open', '/brand/home', 'line', $2, $3, '{}'::jsonb, 'live', now())`,
      [homeOnlyId, startsAt, endsAt],
    );

    const onlyHomeHtml = renderToStaticMarkup(
      (await homePage({ searchParams: Promise.resolve({ organizationId: f.orgId }) })) as ReactElement,
    );
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    expect(mocks.loadHomeSpy.mock.calls[0]![3]).toBe('team_home');
    expect(onlyHomeHtml).toContain('data-home-mode="team"');
    expect(onlyHomeHtml).not.toContain(`data-home-news="${homeOnlyId}"`);

    const teamOnlyId = randomUUID();
    await f.sql.query(
      `insert into brand_announcements (id, slot, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, starts_at, ends_at, audience, status, published_at)
       values ($1, 'team_home', '팀', 'Team', '야기 팀과 홈 새 소식', 'Team home announcement', '확인', 'View', '/brand/rooms', 'line', $2, $3, '{}'::jsonb, 'live', now())`,
      [teamOnlyId, startsAt, endsAt],
    );

    mocks.loadHomeSpy.mockClear();
    const teamHtml = renderToStaticMarkup(
      (await homePage({ searchParams: Promise.resolve({ organizationId: f.orgId }) })) as ReactElement,
    );
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    expect(mocks.loadHomeSpy.mock.calls[0]![3]).toBe('team_home');
    expect(teamHtml).toContain(`data-home-news="${teamOnlyId}"`);
    expect(teamHtml).not.toContain(`data-home-news="${homeOnlyId}"`);
  });
});
