import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  path: '/brand/home',
  query: '',
  modeCookie: undefined as string | undefined,
  failCards: false,
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
vi.mock('@/lib/brand-studio/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand-studio/service')>();
  return {
    ...actual,
    loadProjectCards: async (...args: Parameters<typeof actual.loadProjectCards>) => {
      if (mocks.failCards) throw new Error('simulated cards failure');
      return actual.loadProjectCards(...args);
    },
  };
});

const homePage = (await import('@/app/(brand)/brand/home/page')).default;
const openHome = async (organizationId?: string) =>
  renderToStaticMarkup((await homePage({ searchParams: Promise.resolve(organizationId ? { organizationId } : {}) })) as ReactElement);

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
  resetSpineProbe();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
  mocks.path = '/brand/home';
  mocks.query = '';
  mocks.modeCookie = undefined;
  mocks.failCards = false;
});

async function setupFixture(options: { orgId?: string; orgName?: string } = {}) {
  resetSpineProbe();
  f = await studioFixture({ orgId: options.orgId, orgName: options.orgName ?? 'Spine Home Brand', capKrw: 100_000 });
  mocks.sql = f.sql;
  return f;
}

describe('/brand/home with brand project spine', () => {
  const ko = getDictionary('ko');

  it('keeps today’s home when BRAND_PROJECT_SPINE is off or open only for another organization', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await setupFixture();
    mocks.viewer = viewerOf(fx.ids.owner);

    const closed = await openHome(fx.orgId);
    expect(closed).toContain('data-home-lines');
    expect(closed).not.toContain('data-home-top-row');
    expect(closed).not.toContain('data-home-projects');
    expect(closed).not.toContain('data-home-no-projects');
    expect(closed).not.toContain('data-home-unfiled');

    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', '00000000-0000-4000-8000-999999999999');
    const otherOrg = await openHome(fx.orgId);
    expect(otherOrg).toBe(closed);
  });

  it('renders project cards, unread count, stage, activity, and 미분류 line when spine is open for a member', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    const fx = await setupFixture();
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);

    // Give owner a display name for activity attribution
    await f!.sql.query('update profiles set display_name = $2 where id = $1', [fx.ids.owner, '김서아']);

    // Create an own project and file an image run in it
    const selfId = randomUUID();
    await fx.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
        values ($1, $2, '봄 향수 캠페인', '', 'studio', 'active', false, 'self', $3, $4)`,
      [selfId, fx.orgId, fx.ids.owner, randomUUID()],
    );
    const deps = studioDeps(fx.sql);
    const { jobId } = await seedRun(deps, fx.orgId, fx.ids.owner, { kind: 'image' });
    await fx.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [jobId, selfId]);

    // Add an unread team message in the fixture's team project
    await fx.sql.query(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body)
        values ($1, $2::uuid, $3, $4, 'studio', 'text', '초안 올려드렸습니다')`,
      [fx.orgId, fx.projectId, fx.projectId, fx.ids.admin],
    );

    // Add an unfiled upload
    await seedImageAsset(deps, fx.orgId, fx.ids.owner);

    mocks.viewer = viewerOf(fx.ids.owner);
    const html = await openHome(fx.orgId);

    expect(html).toContain('data-home-top-row');
    expect(html).toContain('data-home-projects');
    expect(html).toContain(`data-home-project="${selfId}"`);
    expect(html).toContain(`data-home-project="${fx.projectId}"`);
    expect(html).toContain('봄 향수 캠페인');
    expect(html).toContain('김서아 님이 이미지를 추가했어요');
    expect(html).toContain('data-home-project-unread="1"');
    expect(html).toContain('야기 팀과 · 지금 단계 · 의뢰 접수');
    expect(html).toContain('data-home-unfiled="1"');
    expect(html).toContain('프로젝트 없이 만든 파일 1개');
    expect(html).toContain('data-home-new-project');
    expect(html).not.toContain('data-home-lines');
    expect(html).not.toContain('data-home-wall');
  });

  it('renders the no-project guide line with today’s starters or wall when zero projects exist', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    const fx = await setupFixture();
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);

    await fx.sql.query('update brand_projects set client_visible = false where organization_id = $1', [fx.orgId]);
    mocks.viewer = viewerOf(fx.ids.owner);

    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-no-projects');
    expect(html).toContain(ko.projectHome.guideNoProject);
    expect(html).toContain('data-home-starters');
    expect(html).not.toContain('data-home-projects');
    expect(html).not.toContain('data-home-unfiled');
    expect(html).not.toContain('data-home-lines');
  });

  it('gives viewers cards without create, request, or move actions', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    const fx = await setupFixture();
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);

    await seedImageAsset(studioDeps(fx.sql), fx.orgId, fx.ids.owner);
    mocks.viewer = viewerOf(fx.ids.viewer);

    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-projects');
    expect(html).toContain('data-home-unfiled="1"');
    expect(html).toContain('data-home-viewer-note');
    expect(html).not.toContain('data-home-new-project');
    expect(html).not.toContain('/brand/projects/new');
    expect(html).not.toContain('data-home-unfiled-move');
  });

  it('never passes spineHome to non-member staff browsing as studio view', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    const fx = await setupFixture();
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);

    mocks.viewer = { ...viewerOf(fx.ids.admin), isAdmin: true };
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-lines');
    expect(html).not.toContain('data-home-top-row');
    expect(html).not.toContain('data-home-projects');
    expect(html).not.toContain('data-home-no-projects');
  });

  it('keeps team mode and Morphic sandbox 404 unchanged when spine is open', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    const fx = await setupFixture();
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);

    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.modeCookie = `${fx.orgId}:team`;
    const teamHtml = await openHome(fx.orgId);
    expect(teamHtml).toContain('data-home-mode="team"');
    expect(teamHtml).not.toContain('data-home-projects');

    await fx.db.close();
    f = null;

    const sandboxId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
    const sbx = await setupFixture({ orgId: sandboxId, orgName: 'Morphic Korea' });
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', sbx.orgId);
    mocks.viewer = viewerOf(sbx.ids.owner);
    mocks.modeCookie = undefined;
    expect(await signal(() => openHome(sbx.orgId))).toContain('404');
  });

  it('links team cards to /brand/projects/<id> when BRAND_ROOMS is off and spine is open', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'off');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    const fx = await setupFixture();
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);

    mocks.viewer = viewerOf(fx.ids.owner);
    const html = await openHome(fx.orgId);
    expect(html).toContain(`href="/brand/projects/${fx.projectId}?organizationId=${fx.orgId}"`);
    expect(html).not.toContain(`/brand/rooms/${fx.projectId}`);
  });

  it('falls back to today’s home cleanly when loadProjectCards throws', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    const fx = await setupFixture();
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', fx.orgId);

    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.failCards = true;
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-lines');
    expect(html).not.toContain('data-home-projects');
    expect(html).not.toContain('data-home-no-projects');
  });
});
