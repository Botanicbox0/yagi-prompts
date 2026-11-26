import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { resetBrandNewsProbe } from '@/lib/brand-news/service';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  path: '/brand/home',
  query: '',
  modeCookie: undefined as string | undefined,
  loadHomeSpy: vi.fn(),
  rejectLoadHome: false,
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
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock('@/lib/brand-news/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand-news/service')>();
  return {
    ...actual,
    loadHomeAnnouncement: async (...args: Parameters<typeof actual.loadHomeAnnouncement>) => {
      mocks.loadHomeSpy(...args);
      if (mocks.rejectLoadHome) throw new Error('simulated brand_announcements fault');
      return actual.loadHomeAnnouncement(...args);
    },
  };
});

const homePage = (await import('@/app/(brand)/brand/home/page')).default;
const renderHomePage = async (organizationId?: string) =>
  (await homePage({ searchParams: Promise.resolve(organizationId ? { organizationId } : {}) })) as ReactElement<Record<string, unknown>>;

async function signal(render: () => Promise<unknown>): Promise<string> {
  const error = await render().then(
    () => null,
    (e: unknown) => e,
  );
  return String((error as { digest?: string } | null)?.digest ?? error);
}

let f: StudioFixture | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  resetBrandNewsProbe();
  resetSpineProbe();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
  mocks.path = '/brand/home';
  mocks.query = '';
  mocks.modeCookie = undefined;
  mocks.rejectLoadHome = false;
  mocks.loadHomeSpy.mockClear();
});

async function setupFixture(options: { orgId?: string; orgName?: string } = {}) {
  resetBrandNewsProbe();
  resetSpineProbe();
  f = await studioFixture({ orgId: options.orgId, orgName: options.orgName ?? 'News Home Brand', capKrw: 100_000 });
  mocks.sql = f.sql;
  return f;
}

async function seedLiveLine(fx: StudioFixture): Promise<string> {
  const id = randomUUID();
  const startsAt = new Date(Date.now() - 60 * 60_000).toISOString();
  const endsAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  await fx.sql.query(
    `insert into brand_announcements
       (id, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, starts_at, ends_at, audience, status, created_by, published_at)
     values
       ($1, '새 기능', 'New', '참고 영상으로 바로 시작할 수 있습니다', 'Start from a reference film', '써 보기', 'Try it', '/brand/studio/video?start=reverse', 'line', $2, $3, '{}'::jsonb, 'live', $4, $2)`,
    [id, startsAt, endsAt, fx.ids.admin],
  );
  return id;
}

describe('/brand/home news line wiring (slice 3b)', () => {
  it('omits news and brandNews props completely when loadHomeAnnouncement returns null (flag off or no announcement)', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_NEWS', 'off');
    const fx = await setupFixture();
    await seedLiveLine(fx);
    mocks.viewer = viewerOf(fx.ids.owner);

    const elOff = await renderHomePage(fx.orgId);
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    expect(mocks.loadHomeSpy.mock.calls[0]![2]).toEqual({ organizationId: fx.orgId, mode: 'make', locale: 'ko' });
    expect('news' in elOff.props).toBe(false);
    expect('brandNews' in (elOff.props.copy as Record<string, unknown>)).toBe(false);
    expect(renderToStaticMarkup(elOff)).not.toContain('data-home-news');

    mocks.loadHomeSpy.mockClear();
    vi.stubEnv('BRAND_NEWS', 'on');
    await fx.sql.query("update brand_announcements set status = 'ended', ended_at = now()");

    const elEmpty = await renderHomePage(fx.orgId);
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    expect('news' in elEmpty.props).toBe(false);
    expect('brandNews' in (elEmpty.props.copy as Record<string, unknown>)).toBe(false);
    expect(renderToStaticMarkup(elEmpty)).not.toContain('data-home-news');
  });

  it('calls loadHomeAnnouncement in make mode and renders the news line on both legacy and project-cards paths when live', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_NEWS', 'on');
    const fx = await setupFixture();
    const id = await seedLiveLine(fx);
    mocks.viewer = viewerOf(fx.ids.owner);

    // 1. Legacy home path (BRAND_PROJECT_SPINE off)
    vi.stubEnv('BRAND_PROJECT_SPINE', 'off');
    const elLegacy = await renderHomePage(fx.orgId);
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    expect(mocks.loadHomeSpy.mock.calls[0]![2]).toEqual({ organizationId: fx.orgId, mode: 'make', locale: 'ko' });
    expect(elLegacy.props.news).toMatchObject({ id, shape: 'line' });
    const legacyHtml = renderToStaticMarkup(elLegacy);
    expect(legacyHtml).toContain(`data-home-news="${id}"`);
    expect(legacyHtml).toContain('data-shape="line"');
    expect(legacyHtml).toContain('참고 영상으로 바로 시작할 수 있습니다');
    expect(legacyHtml.indexOf('data-home-news')).toBeLessThan(legacyHtml.indexOf('data-home-prompt'));

    // 2. Project-cards home path (BRAND_PROJECT_SPINE on for this org)
    mocks.loadHomeSpy.mockClear();
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);
    const elSpine = await renderHomePage(fx.orgId);
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    const spineHtml = renderToStaticMarkup(elSpine);
    expect(spineHtml).toContain('data-home-top-row');
    expect(spineHtml).toContain(`data-home-news="${id}"`);
    expect(spineHtml).toContain('data-home-projects');
    expect(spineHtml.indexOf('data-home-top-row')).toBeLessThan(spineHtml.indexOf('data-home-news'));
    expect(spineHtml.indexOf('data-home-news')).toBeLessThan(spineHtml.indexOf('data-home-prompt'));
  });

  it('never calls loadHomeAnnouncement in team mode or for a sandboxed Morphic organization', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_NEWS', 'on');
    const fx = await setupFixture();
    await seedLiveLine(fx);
    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.modeCookie = `${fx.orgId}:team`;

    const teamEl = await renderHomePage(fx.orgId);
    expect(mocks.loadHomeSpy).not.toHaveBeenCalled();
    const teamHtml = renderToStaticMarkup(teamEl);
    expect(teamHtml).toContain('data-home-mode="team"');
    expect(teamHtml).not.toContain('data-home-news');

    await fx.db.close();
    f = null;
    mocks.loadHomeSpy.mockClear();
    mocks.modeCookie = undefined;

    const sandboxId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
    const sbx = await setupFixture({ orgId: sandboxId, orgName: 'Morphic Korea' });
    mocks.viewer = viewerOf(sbx.ids.owner);
    expect(await signal(() => renderHomePage(sbx.orgId))).toContain('404');
    expect(mocks.loadHomeSpy).not.toHaveBeenCalled();
  });

  it('omits news prop for non-member TWINGS staff viewing the home', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_NEWS', 'on');
    const fx = await setupFixture();
    await seedLiveLine(fx);
    mocks.viewer = { ...viewerOf(fx.ids.admin), isAdmin: true };

    const el = await renderHomePage(fx.orgId);
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    expect('news' in el.props).toBe(false);
    expect(renderToStaticMarkup(el)).not.toContain('data-home-news');
  });

  it('renders the home without the line when loadHomeAnnouncement rejects', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_NEWS', 'on');
    const fx = await setupFixture();
    await seedLiveLine(fx);
    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.rejectLoadHome = true;

    const el = await renderHomePage(fx.orgId);
    expect(mocks.loadHomeSpy).toHaveBeenCalledTimes(1);
    expect('news' in el.props).toBe(false);
    expect(renderToStaticMarkup(el)).not.toContain('data-home-news');
  });
});
