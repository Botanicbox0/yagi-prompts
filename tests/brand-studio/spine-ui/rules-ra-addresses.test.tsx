import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  path: '/brand/library',
  query: '',
}));

vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => undefined }));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary: loadDict } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = loadDict('ko');
      return {
        viewer: mocks.viewer,
        sql: mocks.sql,
        verifiedEmail: undefined,
        brandHost: false,
        locale: 'ko',
        dict,
        b: dict.brandWorkspace,
      };
    },
  };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(mocks.query),
}));

const homePage = (await import('@/app/(brand)/brand/home/page')).default;
const libraryPage = (await import('@/app/(brand)/brand/library/page')).default;

let f: StudioFixture | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
  mocks.path = '/brand/library';
  mocks.query = '';
});

async function setup() {
  resetSpineProbe();
  f = await studioFixture({ orgName: 'R-A Address Brand', capKrw: 100_000 });
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', f.orgId);
  return f;
}

describe('Spine rules R-A addresses against local Postgres (/brand/library and /brand/home)', () => {
  it('opens visible active & finished projects via ?project=<id> and treats hidden/other-org/malformed ids identically to absent param', async () => {
    const fx = await setup();
    const deps = studioDeps(fx.sql);
    const ko = getDictionary('ko');

    const activeSelfId = randomUUID();
    const finishedSelfId = randomUUID();
    const hiddenTeamId = randomUUID();
    const otherOrgId = randomUUID();
    const otherOrgProjectId = randomUUID();

    await fx.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
       values
         ($1, $2, 'Active Spring', 'Studio goal', 'studio', 'active', false, 'self', $3, $4),
         ($5, $2, 'Finished Winter', 'Studio goal', 'studio', 'completed', false, 'self', $3, $6),
         ($7, $2, 'Secret Team', 'Team goal', 'studio', 'active', false, 'team', $3, $8)`,
      [activeSelfId, fx.orgId, fx.ids.owner, randomUUID(), finishedSelfId, randomUUID(), hiddenTeamId, randomUUID()],
    );
    await fx.sql.query(
      `insert into brand_organizations (id, name, created_by, request_id) values ($1, 'Other Brand', $2, $3)`,
      [otherOrgId, fx.ids.owner, randomUUID()],
    );
    await fx.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
       values ($1, $2, 'Other Org Project', 'Studio goal', 'studio', 'active', false, 'self', $3, $4)`,
      [otherOrgProjectId, otherOrgId, fx.ids.owner, randomUUID()],
    );

    const activeRun = await seedRun(deps, fx.orgId, fx.ids.owner, { kind: 'image' });
    await fx.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [activeRun.jobId, activeSelfId]);

    const finishedUpload = await seedImageAsset(deps, fx.orgId, fx.ids.owner);
    await fx.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [finishedUpload, finishedSelfId]);

    const madeFilm = await runVideoProjectOperation({ sql: fx.sql, media: deps.media }, viewerOf(fx.ids.owner), 'create', {
      organizationId: fx.orgId,
      requestId: `vp_${randomUUID()}`,
      title: 'Winter Edit',
    });
    if (!madeFilm.ok || !madeFilm.project) throw new Error(JSON.stringify(madeFilm));
    await fx.sql.query('update brand_studio_video_projects set brand_project_id = $2 where id = $1', [madeFilm.project.id, finishedSelfId]);

    const openLib = async (params: { projects?: string; project?: string } = {}) =>
      renderToStaticMarkup(
        (await libraryPage({
          searchParams: Promise.resolve({ organizationId: fx.orgId, ...params }),
        })) as ReactElement,
      );

    const baselineHtml = await openLib();
    expect(baselineHtml).toContain('data-asset-hub-projects-switch');
    expect(baselineHtml).toContain('data-asset-hub-finished-files="2"');

    // 1. Visible active project -> opens scope without finished hint
    const activeScopeHtml = await openLib({ project: activeSelfId });
    expect(activeScopeHtml).toContain(`data-asset-hub-scope="project:${activeSelfId}"`);
    expect(activeScopeHtml).toContain('Active Spring');
    expect(activeScopeHtml).not.toContain('data-asset-hub-finished-hint');

    // 2. Visible finished project -> opens scope with finishedHint + finishedMark, hides film edit link
    const finishedScopeHtml = await openLib({ project: finishedSelfId });
    expect(finishedScopeHtml).toContain(`data-asset-hub-scope="project:${finishedSelfId}"`);
    expect(finishedScopeHtml).toContain('Finished Winter');
    expect(finishedScopeHtml).toContain('data-asset-hub-finished-hint');
    expect(finishedScopeHtml).toContain(ko.studioLibrary.hub.spine.finishedHint);
    expect(finishedScopeHtml).toContain(ko.studioLibrary.hub.spine.finishedMark);
    expect(finishedScopeHtml).toContain('Winter Edit');
    expect(finishedScopeHtml).not.toContain(`film=${madeFilm.project.id}`);

    // 2b. Upper-case & whitespace-padded UUID normalizes to lowercase and renders the exact same scope
    expect(await openLib({ project: `  ${finishedSelfId.toUpperCase()}  ` })).toBe(finishedScopeHtml);

    // 3. Hidden team, other organization, and malformed ids all produce the EXACT same output as no ?project param
    expect(await openLib({ project: hiddenTeamId })).toBe(baselineHtml);
    expect(await openLib({ project: otherOrgProjectId })).toBe(baselineHtml);
    expect(await openLib({ project: 'not-a-uuid' })).toBe(baselineHtml);
    expect(await openLib({ project: '   ' })).toBe(baselineHtml);
    expect(await openLib({ project: 'ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ' })).toBe(baselineHtml);
  });

  it('renders /brand/home on active and ?projects=all with finished cards, counts switch, and library href', async () => {
    const fx = await setup();
    mocks.path = '/brand/home';
    const ko = getDictionary('ko');

    const finishedSelfId = randomUUID();
    await fx.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
       values ($1, $2, 'Archived Studio', 'Studio goal', 'studio', 'completed', false, 'self', $3, $4)`,
      [finishedSelfId, fx.orgId, fx.ids.owner, randomUUID()],
    );

    const activeHtml = renderToStaticMarkup(
      (await homePage({ searchParams: Promise.resolve({ organizationId: fx.orgId }) })) as ReactElement,
    );
    expect(activeHtml).toContain('data-home-projects-switch');
    expect(activeHtml).not.toContain(finishedSelfId);

    const allHtml = renderToStaticMarkup(
      (await homePage({ searchParams: Promise.resolve({ organizationId: fx.orgId, projects: 'all' }) })) as ReactElement,
    );
    expect(allHtml).toContain('Archived Studio');
    expect(allHtml).toContain(ko.projectHome.finishedMark);
    expect(allHtml).toContain(`href="/brand/library?organizationId=${fx.orgId}&amp;project=${finishedSelfId}"`);
  });
});
