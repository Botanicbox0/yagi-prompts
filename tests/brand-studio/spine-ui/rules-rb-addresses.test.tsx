import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  path: '/brand/library',
  query: '',
  overviewCalls: [] as Array<unknown>,
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

vi.mock('@/lib/brand-studio/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/service')>('@/lib/brand-studio/service');
  return {
    ...actual,
    runStudioOperation: vi.fn(async (deps, viewer, op, input) => {
      if (op === 'project.overview') mocks.overviewCalls.push(input);
      return actual.runStudioOperation(deps, viewer, op, input);
    }),
  };
});

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
  mocks.overviewCalls = [];
});

async function setup() {
  resetSpineProbe();
  f = await studioFixture({ orgName: 'R-B Address Brand', capKrw: 100_000 });
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', f.orgId);
  return f;
}

describe('Spine rules R-B server page addresses (/brand/library & /brand/home)', () => {
  it('/brand/library?project=<finished> draws scope header from project.files summary with zero fallback project.overview calls, and opens beyond-100 project + ?view=archive + Home archiveLink', async () => {
    const fx = await setup();
    const ko = getDictionary('ko');

    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);
    await fx.sql.query('update brand_projects set updated_at = $2 where id = $1', [fx.projectId, new Date(baseMs).toISOString()]);

    const finishedBeyondId = randomUUID();
    const openBeyondId = randomUUID();
    await fx.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id, updated_at)
       values
         ($1, $2, 'Finished Beyond 100', 'Studio goal', 'studio', 'completed', false, 'self', $3, $4, $5),
         ($6, $2, 'Open Beyond 100', 'Studio goal', 'studio', 'active', false, 'self', $3, $7, $8)`,
      [
        finishedBeyondId,
        fx.orgId,
        fx.ids.owner,
        randomUUID(),
        new Date(baseMs - 300_000).toISOString(),
        openBeyondId,
        randomUUID(),
        new Date(baseMs - 250_000).toISOString(),
      ],
    );

    // Seed 103 active projects so both targets sit beyond the 100 cut (total = 105 active + 1 finished = 106 visible)
    const vals: unknown[] = [fx.orgId, fx.ids.owner];
    const tuples: string[] = [];
    for (let i = 0; i < 103; i += 1) {
      const pId = randomUUID();
      const reqId = randomUUID();
      const ts = new Date(baseMs - (i + 1) * 1000).toISOString();
      const base = vals.length;
      vals.push(pId, `Top Project ${i}`, reqId, ts);
      tuples.push(`($${base + 1}, $1, $${base + 2}, 'Studio goal', 'studio', 'active', false, 'self', $2, $${base + 3}, $${base + 4})`);
    }
    await fx.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id, updated_at) values ${tuples.join(', ')}`,
      vals,
    );

    // 1. /brand/library?project=<finishedBeyondId> (without ?projects=all):
    // ONLY 1 project.overview call (filter: 'active'), NO second fallback call, AND header draws title + finishedMark!
    mocks.overviewCalls = [];
    const finishedHtml = renderToStaticMarkup(
      (await libraryPage({
        searchParams: Promise.resolve({ organizationId: fx.orgId, project: finishedBeyondId }),
      })) as ReactElement,
    );
    expect(mocks.overviewCalls).toEqual([{ organizationId: fx.orgId, filter: 'active' }]);
    expect(finishedHtml).toContain(`data-asset-hub-scope="project:${finishedBeyondId}"`);
    expect(finishedHtml).toContain('Finished Beyond 100');
    expect(finishedHtml).toContain(ko.studioLibrary.hub.spine.finishedMark);
    expect(finishedHtml).toContain(ko.studioLibrary.hub.spine.finishedHint);

    // 2. /brand/library?project=<openBeyondId>: opens beyond-100 active project cleanly
    mocks.overviewCalls = [];
    const openBeyondHtml = renderToStaticMarkup(
      (await libraryPage({
        searchParams: Promise.resolve({ organizationId: fx.orgId, project: openBeyondId }),
      })) as ReactElement,
    );
    expect(mocks.overviewCalls).toEqual([{ organizationId: fx.orgId, filter: 'active' }]);
    expect(openBeyondHtml).toContain(`data-asset-hub-scope="project:${openBeyondId}"`);
    expect(openBeyondHtml).toContain('Open Beyond 100');

    // 3. /brand/library?view=archive: opens Archive view directly in SSR and back link drops view & project
    const archiveHtml = renderToStaticMarkup(
      (await libraryPage({
        searchParams: Promise.resolve({ organizationId: fx.orgId, view: 'archive' }),
      })) as ReactElement,
    );
    expect(archiveHtml).toContain('data-asset-hub-archive');
    expect(archiveHtml).toContain(ko.studioLibrary.hub.spine.archiveTitle);
    expect(archiveHtml).toContain(ko.studioLibrary.hub.spine.archiveBack);
    expect(archiveHtml).toContain(`href="/brand/library?organizationId=${fx.orgId}"`);

    // 4. /brand/library (without view=archive) NEVER shows Archive and shows archiveLink with n = 5 active unlisted (and n = 6 on ?projects=all)
    const byProjectHtml = renderToStaticMarkup(
      (await libraryPage({
        searchParams: Promise.resolve({ organizationId: fx.orgId }),
      })) as ReactElement,
    );
    expect(byProjectHtml).not.toContain('data-asset-hub-archive=""');
    expect(byProjectHtml).toContain('data-asset-hub-archive-count="5"');
    expect(byProjectHtml).toContain(ko.studioLibrary.hub.spine.archiveLink.replace('{n}', '5'));
    expect(byProjectHtml).toContain(`href="/brand/library?organizationId=${fx.orgId}&amp;view=archive"`);

    const byProjectAllHtml = renderToStaticMarkup(
      (await libraryPage({
        searchParams: Promise.resolve({ organizationId: fx.orgId, projects: 'all' }),
      })) as ReactElement,
    );
    expect(byProjectAllHtml).toContain('data-asset-hub-archive-count="6"');

    // 5. /brand/home shows archiveLink under project cards with n = 5 active (and n = 6 on ?projects=all)
    mocks.path = '/brand/home';
    const homeActiveHtml = renderToStaticMarkup(
      (await homePage({
        searchParams: Promise.resolve({ organizationId: fx.orgId }),
      })) as ReactElement,
    );
    expect(homeActiveHtml).toContain('data-home-projects-archive="5"');
    expect(homeActiveHtml).toContain(ko.projectHome.archiveLink.replace('{n}', '5'));
    expect(homeActiveHtml).toContain(`href="/brand/library?organizationId=${fx.orgId}&amp;view=archive"`);

    const homeAllHtml = renderToStaticMarkup(
      (await homePage({
        searchParams: Promise.resolve({ organizationId: fx.orgId, projects: 'all' }),
      })) as ReactElement,
    );
    expect(homeAllHtml).toContain('data-home-projects-archive="6"');

    // 6. When spine is closed, ?view=archive never leaks archive shell
    vi.stubEnv('BRAND_PROJECT_SPINE', 'off');
    const closedArchiveHtml = renderToStaticMarkup(
      (await libraryPage({
        searchParams: Promise.resolve({ organizationId: fx.orgId, view: 'archive' }),
      })) as ReactElement,
    );
    expect(closedArchiveHtml).not.toContain('data-asset-hub-archive');
  });
});
