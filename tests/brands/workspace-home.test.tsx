import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { brandRouteAllowed, isBrandPath } from '@/lib/routing/surfaces';
import {
  BRAND_HOME_PATH,
  BRAND_LANDING_PATH,
  brandHomeVisible,
  brandLandingPath,
  homeActions,
  homeResults,
} from '@/lib/brands/workspace/home';
import type { BrandWorkspaceChoice } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';
import { seedImageOutput } from '../brand-studio/library/helpers';

/**
 * docs/BRAND-STUDIO-V3.md §12 — the workspace home and the default landing.
 *
 * HARDLINE: a sandboxed client (both ids, "Morphic …", "모픽 …") and any brand whose policy closes
 * generative media get a 404 on `/brand/home` for every role, keep `/brand` as their landing, and never
 * see the rail's Home entry. Do not weaken this file to make something pass.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null, path: '/brand/home', query: '' }));
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

const ko = getDictionary('ko');
const choice = (over: Partial<BrandWorkspaceChoice> = {}): BrandWorkspaceChoice => ({
  id: 'a0000000-0000-4000-8000-00000000000a',
  name: 'Bright Bottle',
  role: 'owner',
  logoUrl: null,
  ...over,
});
const sandboxed = [...SANDBOXED_CLIENT_ORG_IDS];
const closedChoices: Array<[string, BrandWorkspaceChoice]> = [
  [`sandboxed id ${sandboxed[0]}`, choice({ id: sandboxed[0]! })],
  [`sandboxed id ${sandboxed[1]}`, choice({ id: sandboxed[1]! })],
  ['named "Morphic Korea"', choice({ name: 'Morphic Korea' })],
  ['named "모픽"', choice({ name: '모픽' })],
  ['generative media denied', choice({ denied: ['generative_media'] })],
];

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.path = '/brand/home';
  mocks.query = '';
});

/* -------------------------------------------------------------------- who has it, where sign-in lands */

describe('who gets the home', () => {
  it('is for a brand with the studio: every member role and the TWINGS team view, with the flag on', () => {
    for (const role of ['owner', 'editor', 'viewer', 'studio'] as const) expect(brandHomeVisible(choice({ role }), true), role).toBe(true);
    expect(brandHomeVisible(choice(), false)).toBe(false);
    expect(brandHomeVisible(null, true)).toBe(false);
  });
  it.each(closedChoices)('is never for %s', (_label, org) => {
    expect(brandHomeVisible(org, true)).toBe(false);
    expect(homeActions({ choice: org, flagOn: true, canRequest: true, rooms: true })).toEqual([]);
  });
  it('is not for a project-only brand (self-serve studio closed) or a campaign-only guest', () => {
    expect(brandHomeVisible(choice({ denied: ['self_studio'] }), true)).toBe(false);
    expect(brandHomeVisible(choice({ role: 'guest' }), true)).toBe(false);
  });
  it('registers both addresses on the brand host, read-only', () => {
    for (const path of [BRAND_HOME_PATH, BRAND_LANDING_PATH]) {
      expect(isBrandPath(path)).toBe(true);
      expect(brandRouteAllowed(path, 'GET')).toBe(true);
      expect(brandRouteAllowed(path, 'POST')).toBe(false);
    }
    expect(isBrandPath('/brand/homex')).toBe(false);
    expect(isBrandPath('/brand/startx')).toBe(false);
  });
});

describe('the default landing', () => {
  it('opens the home only when the brand the workspace opens on has it', () => {
    expect(brandLandingPath([choice()], true)).toBe('/brand/home');
    expect(brandLandingPath([choice({ role: 'viewer' })], true)).toBe('/brand/home');
    // Flag off, no brand yet, a project-only brand, a guest: `/brand`, exactly as before.
    expect(brandLandingPath([choice()], false)).toBe('/brand');
    expect(brandLandingPath([], true)).toBe('/brand');
    expect(brandLandingPath([choice({ denied: ['self_studio'] })], true)).toBe('/brand');
    expect(brandLandingPath([choice({ role: 'guest' })], true)).toBe('/brand');
  });
  it.each(closedChoices)('keeps %s on /brand', (_label, org) => {
    expect(brandLandingPath([org, choice({ id: 'b0000000-0000-4000-8000-00000000000b' })], true)).toBe('/brand');
  });
});

/* -------------------------------------------------------------------- the cards */

describe('action cards follow the same checks as the rail', () => {
  const keys = (input: Parameters<typeof homeActions>[0]) => homeActions(input).map((a) => `${a.group}:${a.key}`);
  it('shows the four studio screens, assets and the brief with rooms for an owner or editor', () => {
    for (const role of ['owner', 'editor'] as const) {
      expect(keys({ choice: choice({ role }), flagOn: true, canRequest: true, rooms: true })).toEqual([
        'make:image',
        'make:video',
        'make:compose',
        'make:workflows',
        'make:assets',
        'team:commission',
      ]);
    }
  });
  it('offers the campaign request instead when rooms are closed', () => {
    expect(keys({ choice: choice(), flagOn: true, canRequest: true, rooms: false }).at(-1)).toBe('team:campaign');
  });
  it('gives a viewer (and the team view) every screen they can open, but no request', () => {
    const viewer = keys({ choice: choice({ role: 'viewer' }), flagOn: true, canRequest: false, rooms: true });
    expect(viewer).not.toContain('team:commission');
    expect(viewer).not.toContain('team:campaign');
    expect(viewer).toContain('make:image');
  });
});

/* -------------------------------------------------------------------- recent results */

const job = (over: Partial<StudioJobView> & { outputs?: StudioJobView['outputs'] }): StudioJobView =>
  ({ id: 'j', kind: 'image', status: 'succeeded', outputs: [], ...over }) as StudioJobView;
const output = (id: string, kind: 'image' | 'video', thumbUrl: string | null, url = `/m/${id}`) =>
  ({ id, jobId: 'j', kind, url, thumbUrl, width: 800, height: 1000, seconds: kind === 'video' ? 6.2 : null, draft: false, savedAssetId: null }) as StudioJobView['outputs'][number];

describe('recent results', () => {
  const org = 'c0000000-0000-4000-8000-00000000000c';
  it('takes finished results, newest first, at most six, and links each to its screen viewer', () => {
    const jobs = [
      job({ id: 'v', kind: 'video', outputs: [output('00000000-0000-4000-8000-000000000001', 'video', '/m/poster')] }),
      job({ id: 'f', kind: 'image', status: 'failed', outputs: [output('00000000-0000-4000-8000-000000000002', 'image', null)] }),
      job({ id: 'x', kind: 'image', purpose: 'fill', outputs: [output('00000000-0000-4000-8000-000000000003', 'image', null)] }),
      job({ id: 'n', kind: 'video', outputs: [output('00000000-0000-4000-8000-000000000004', 'video', null)] }),
      job({ id: 'r', kind: 'region_edit', outputs: [output('00000000-0000-4000-8000-000000000005', 'image', null)] }),
      ...Array.from({ length: 6 }, (_, i) => job({ id: `i${i}`, outputs: [output(`00000000-0000-4000-8000-00000000001${i}`, 'image', `/m/t${i}`)] })),
    ];
    const results = homeResults(jobs, org);
    expect(results).toHaveLength(6);
    expect(results[0]).toMatchObject({ kind: 'video', src: '/m/poster', seconds: 6.2 });
    expect(results[0]!.href).toBe(`/brand/studio/video?organizationId=${org}&view=o%3A00000000-0000-4000-8000-000000000001`);
    // A partial edit lives on the image screen; the image itself stands in when there is no thumbnail.
    expect(results[2]).toMatchObject({ kind: 'image', src: '/m/00000000-0000-4000-8000-000000000005', clip: null });
    expect(results[2]!.href.startsWith(`/brand/studio?organizationId=${org}&view=`)).toBe(true);
    // Failed runs and fill strips are left out; a clip without a poster shows its first frame.
    expect(results.map((r) => r.outputId)).not.toContain('00000000-0000-4000-8000-000000000002');
    expect(results.map((r) => r.outputId)).not.toContain('00000000-0000-4000-8000-000000000003');
    expect(results.find((r) => r.outputId === '00000000-0000-4000-8000-000000000004')).toMatchObject({ src: null, clip: '/m/00000000-0000-4000-8000-000000000004' });
  });
});

/* -------------------------------------------------------------------- the page, on the real schema */

let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
});

async function homeFixture(options: { orgId?: string; orgName?: string; denied?: string[] } = {}) {
  f = await studioFixture({ orgId: options.orgId, orgName: options.orgName ?? 'Home fixture brand', capKrw: 100_000 });
  mocks.sql = f.sql;
  if (options.denied) {
    await f.sql.query('insert into brand_feature_policies (organization_id, denied_features) values ($1, $2)', [f.orgId, options.denied]);
  }
  return f;
}

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

const fixtureCases: Array<{ label: string; orgId?: string; orgName?: string; denied?: string[] }> = [
  { label: `sandboxed id ${sandboxed[0]}`, orgId: sandboxed[0]! },
  { label: `sandboxed id ${sandboxed[1]}`, orgId: sandboxed[1]! },
  { label: 'named "Morphic Korea"', orgName: 'Morphic Korea' },
  { label: 'named "모픽"', orgName: '모픽' },
  { label: 'generative media closed by policy', denied: ['generative_media'] },
];

describe.each(fixtureCases)('Morphic hardline, /brand/home: organization $label', (c) => {
  it('is a 404 for every member, with the flag on, and the landing stays /brand', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture(c);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      expect(await signal(() => openHome(fx.orgId))).toContain('404');
      expect(await signal(() => openHome())).toContain('404');
    }
    mocks.viewer = viewerOf(fx.ids.owner);
    const { GET } = await import('@/app/(brand)/brand/start/route');
    const landing = await GET(new Request('https://brand.twings.app/brand/start'));
    expect(new URL(landing.headers.get('location')!).pathname).toBe('/brand');
  });
});

describe('the home page', () => {
  it('is a 404 for everyone while studio v2 is off, and the landing stays /brand', async () => {
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    expect(await signal(() => openHome(fx.orgId))).toContain('404');
    const { GET } = await import('@/app/(brand)/brand/start/route');
    const landing = await GET(new Request('https://brand.twings.app/brand/start'));
    expect(new URL(landing.headers.get('location')!).pathname).toBe('/brand');
  });

  it('sends a project-only brand back to /brand, its landing as before', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const fx = await homeFixture({ denied: ['self_studio'] });
    mocks.viewer = viewerOf(fx.ids.owner);
    const digest = await signal(() => openHome(fx.orgId));
    expect(digest).toContain('NEXT_REDIRECT');
    expect(digest).toContain(`/brand?organizationId=${fx.orgId}`);
  });

  it('is where sign-in lands for a brand with the studio; an outsider address is a 404', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    const { GET } = await import('@/app/(brand)/brand/start/route');
    const landing = await GET(new Request('https://brand.twings.app/brand/start'));
    expect(landing.status).toBe(307);
    expect(landing.headers.get('location')).toBe('https://brand.twings.app/brand/home');
    expect(landing.headers.get('cache-control')).toContain('no-store');
    mocks.viewer = null;
    const anonymous = await GET(new Request('https://brand.twings.app/brand/start'));
    expect(new URL(anonymous.headers.get('location')!).pathname).toBe('/auth/choose');
    expect(new URL(anonymous.headers.get('location')!).searchParams.get('next')).toBe('/brand/start');
    // A brand this account cannot open names nothing.
    mocks.viewer = viewerOf(fx.ids.outsider);
    expect(await signal(() => openHome(fx.orgId))).toContain('404');
  });

  it('shows an owner every card, the credits and a one-line empty state, with no filled button', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    const html = await openHome(fx.orgId);
    expect(html).toContain(`data-workspace-home="${fx.orgId}"`);
    expect(html).toContain('Home fixture brand 작업공간');
    for (const key of ['image', 'video', 'compose', 'workflows', 'assets', 'commission']) expect(html).toContain(`data-home-action="${key}"`);
    expect(html).not.toContain('data-home-action="campaign"');
    // The rail's own names and groups.
    for (const name of [ko.studioShell.rail.image, ko.studioShell.rail.video, ko.studioShell.rail.compose, ko.studioShell.rail.workflows, ko.studioShell.rail.assets, ko.roomsShell.nav.commission, ko.roomsShell.nav.groupMake, ko.roomsShell.nav.groupTeam]) {
      expect(html).toContain(name);
    }
    expect(html).toContain(`href="/brand/studio/compose?organizationId=${fx.orgId}"`);
    expect(html).toContain(`href="/brand/projects/new?organizationId=${fx.orgId}"`);
    expect(html).toContain('data-home-credits');
    expect(html).toContain('크레딧 10,000 중 10,000 남았어요');
    expect(html).not.toMatch(/\d\s*원|₩|KRW/);
    expect(html).toContain('data-home-empty');
    expect(html).not.toContain('data-home-continue');
    expect(html).not.toContain('data-variant="solid"');
    expect(html).not.toContain('bw-primary');
    expect(html).not.toContain('data-home-viewer-note');
  });

  it('gives a viewer the screens they can open, no request card, and one line saying why', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.viewer);
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-action="image"');
    expect(html).not.toContain('data-home-action="commission"');
    expect(html).not.toContain(ko.roomsShell.nav.groupTeam);
    expect(html).toContain('data-home-viewer-note');
  });

  it('lists drafts waiting for review and the newest results under 이어서 하기', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    const deps = studioDeps(fx.sql);
    const outputId = await seedImageOutput(deps, fx.orgId, fx.ids.owner);
    const draft = await seedImageOutput(deps, fx.orgId, fx.ids.admin);
    const reviewId = (
      await fx.sql.query<{ id: string }>(
        `insert into brand_studio_reviews (organization_id, output_id, title, created_role, project_id, version, status, source)
          values ($1, $2, 'Spring launch film', 'studio', $3, 1, 'open', 'delivery') returning id::text as id`,
        [fx.orgId, draft, fx.projectId],
      )
    ).rows[0]!.id;
    mocks.viewer = viewerOf(fx.ids.owner);
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-continue');
    expect(html).toContain('data-home-reviews="1"');
    expect(html).toContain('Spring launch film');
    expect(html).toContain(`/brand/rooms/${fx.projectId}?organizationId=${fx.orgId}&amp;tab=review&amp;review=${reviewId}`);
    expect(html).toContain('시안 v1 확인 대기');
    expect(html).toContain(`view=o%3A${outputId}`);
    expect(html).not.toContain('data-home-empty');
  });
});
