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
  HOME_DOOR_EXAMPLES,
  HOME_STARTERS,
  homeDoorPictures,
  homeLayout,
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
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null, path: '/brand/home', query: '', modeCookie: undefined as string | undefined }));
// The rail mode the browser remembered (components/brand-workspace/rail-mode.ts), as the home reads it.
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ get: (name: string) => (name === 'twings_brand_mode' && mocks.modeCookie ? { name, value: mocks.modeCookie } : undefined) }),
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
  mocks.modeCookie = undefined;
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
    expect(homeLayout({ choice: org, flagOn: true, canRequest: true, rooms: true })).toBeNull();
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

describe('doors, tools and the team tile follow the same checks as the rail', () => {
  const shape = (input: Parameters<typeof homeLayout>[0]) => {
    const layout = homeLayout(input);
    return layout && { doors: layout.doors.map((d) => d.key), tools: layout.tools.map((t) => t.key), team: layout.team.key };
  };
  it('gives an owner or editor the two doors, three tools and the brief with rooms', () => {
    for (const role of ['owner', 'editor'] as const) {
      expect(shape({ choice: choice({ role }), flagOn: true, canRequest: true, rooms: true })).toEqual({
        doors: ['image', 'video'],
        tools: ['compose', 'workflows', 'assets'],
        team: 'commission',
      });
    }
    expect(homeLayout({ choice: choice(), flagOn: true, canRequest: true, rooms: true })!.team.path).toBe('/brand/projects/new');
  });
  it('offers the campaign request instead when rooms are closed', () => {
    expect(shape({ choice: choice(), flagOn: true, canRequest: true, rooms: false })!.team).toBe('campaign');
  });
  it('gives a viewer (and the team view) every screen and the projects list instead of a request', () => {
    const layout = homeLayout({ choice: choice({ role: 'viewer' }), flagOn: true, canRequest: false, rooms: true })!;
    expect(layout.team).toEqual({ key: 'projects', path: '/brand' });
    expect(layout.doors).toHaveLength(2);
  });
  it('serves only house frames the brand host already allows, and starters in both media', () => {
    for (const path of [...Object.values(HOME_DOOR_EXAMPLES), ...HOME_STARTERS.map((s) => s.picture)]) {
      expect(brandRouteAllowed(path, 'GET'), path).toBe(true);
    }
    expect(new Set(HOME_STARTERS.map((s) => s.medium))).toEqual(new Set(['image', 'video']));
    for (const key of HOME_STARTERS.map((s) => s.key)) {
      expect(ko.brandHome.starters[key].prompt.length).toBeGreaterThan(10);
      expect(getDictionary('en').brandHome.starters[key].prompt).not.toBe(ko.brandHome.starters[key].prompt);
    }
  });
});

/* -------------------------------------------------------------------- recent results */

const job = (over: Partial<StudioJobView> & { outputs?: StudioJobView['outputs'] }): StudioJobView =>
  ({ id: 'j', kind: 'image', status: 'succeeded', outputs: [], ...over }) as StudioJobView;
const output = (id: string, kind: 'image' | 'video', thumbUrl: string | null, url = `/m/${id}`) =>
  ({ id, jobId: 'j', kind, url, thumbUrl, width: 800, height: 1000, seconds: kind === 'video' ? 6.2 : null, draft: false, savedAssetId: null }) as StudioJobView['outputs'][number];

describe('recent results', () => {
  const org = 'c0000000-0000-4000-8000-00000000000c';
  it('takes finished results, newest first, at most eight, and links each to its screen viewer', () => {
    const jobs = [
      job({ id: 'v', kind: 'video', outputs: [output('00000000-0000-4000-8000-000000000001', 'video', '/m/poster')] }),
      job({ id: 'f', kind: 'image', status: 'failed', outputs: [output('00000000-0000-4000-8000-000000000002', 'image', null)] }),
      job({ id: 'x', kind: 'image', purpose: 'fill', outputs: [output('00000000-0000-4000-8000-000000000003', 'image', null)] }),
      job({ id: 'n', kind: 'video', outputs: [output('00000000-0000-4000-8000-000000000004', 'video', null)] }),
      job({ id: 'r', kind: 'region_edit', outputs: [output('00000000-0000-4000-8000-000000000005', 'image', null)] }),
      ...Array.from({ length: 8 }, (_, i) => job({ id: `i${i}`, outputs: [output(`00000000-0000-4000-8000-00000000001${i}`, 'image', `/m/t${i}`)] })),
    ];
    const results = homeResults(jobs, org);
    expect(results).toHaveLength(8);
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

describe('door pictures', () => {
  it('take the newest result of each kind, or none', () => {
    const org = 'c0000000-0000-4000-8000-00000000000c';
    const doors = homeDoorPictures(
      [
        job({ id: 'a', kind: 'image', outputs: [output('00000000-0000-4000-8000-000000000021', 'image', '/m/a')] }),
        job({ id: 'b', kind: 'image', outputs: [output('00000000-0000-4000-8000-000000000022', 'image', '/m/b')] }),
      ],
      org,
    );
    expect(doors.image?.outputId).toBe('00000000-0000-4000-8000-000000000021');
    expect(doors.video).toBeNull();
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
    // A new brand: house frames marked as examples on both doors, and three starters below.
    expect(html.match(/data-door-picture="example"/g)).toHaveLength(2);
    expect(html.match(/data-home-example/g)).toHaveLength(2);
    expect(html).toContain('data-home-starters');
    for (const key of ['product', 'look', 'film']) expect(html).toContain(`data-home-starter="${key}"`);
    // The prompt bar is the one thing first, with the page's only filled button.
    expect(html).toContain('data-home-prompt');
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).toContain(ko.brandStudio.dock.placeholder);
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
    expect(html).not.toContain('data-home-continue');
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
    // No prompt bar for a role that cannot create; the team tile opens the projects list instead.
    expect(html).not.toContain('data-home-prompt');
    expect(html).not.toContain('data-variant="solid"');
    expect(html).toContain('data-home-action="projects"');
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
    expect(html).not.toContain('data-home-starters');
    // The doors now show the brand's own newest image; no clip yet, so the video door keeps its example.
    expect(html).toContain('data-door-picture="own"');
    expect(html).toContain('data-door-picture="example"');
    // Live facts on the team tile: drafts to look at.
    expect(html).toContain('data-home-team-facts');
    expect(html).toContain('확인할 시안 1개');
  });
});

/* -------------------------------------------------------------------- the home follows the rail's mode */

describe('the home in 야기 팀과 (founder 2026-11-20: team customers do not see the making side)', () => {
  const nav = ko.roomsShell.nav;
  const ov = ko.roomsShell.overview;
  const sp = ko.roomsShell.space;
  const MAKING = ['data-home-prompt', 'data-home-doors', 'data-home-tools', 'data-home-starters', 'data-home-credits', ko.brandStudio.dock.placeholder];

  it('opens the making home with no remembered mode and with 직접 만들기 remembered', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    for (const cookie of [undefined, `${fx.orgId}:make`, 'garbage']) {
      mocks.modeCookie = cookie;
      const html = await openHome(fx.orgId);
      expect(html, String(cookie)).toContain('data-home-mode="make"');
      expect(html).toContain('data-home-prompt');
      expect(html).not.toContain('data-home-team-projects');
    }
  });

  it('shows projects with their stage, nothing of the making side, and one request action', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.modeCookie = `${fx.orgId}:team`;
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-mode="team"');
    for (const marker of MAKING) expect(html, marker).not.toContain(marker);
    expect(html).not.toContain(nav.groupMake);
    expect(html).toContain('Home fixture brand 작업공간');
    // The project, its room and where it stands, in the room's own words.
    expect(html).toContain('data-home-team-projects');
    expect(html).toContain(`data-home-project="${fx.projectId}"`);
    expect(html).toContain(`/brand/rooms/${fx.projectId}?organizationId=${fx.orgId}`);
    expect(html).toContain('data-home-project-stage="requested"');
    for (const stage of ['requested', 'storyboard', 'draft', 'revision', 'done'] as const) expect(html).toContain(ov.stages[stage]);
    expect(html).toContain(`>${sp.list.all}<`);
    // One filled action: 새 프로젝트 의뢰.
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).toContain('data-home-action="commission"');
    expect(html).toContain(nav.commission);
    expect(html).toContain(`href="/brand/projects/new?organizationId=${fx.orgId}"`);
    expect(html).not.toContain('data-home-team-waiting');
  });

  it('puts what waits on the person first: a draft to review and unread team messages', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    const deps = studioDeps(fx.sql);
    const draft = await seedImageOutput(deps, fx.orgId, fx.ids.admin);
    await fx.sql.query(
      `insert into brand_studio_reviews (organization_id, output_id, title, created_role, project_id, version, status, source)
        values ($1, $2, 'Spring launch film', 'studio', $3, 1, 'open', 'delivery')`,
      [fx.orgId, draft, fx.projectId],
    );
    await fx.sql.query(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body)
        values ($1, $2::uuid, $3, $4, 'studio', 'text', 'First cut is up')`,
      [fx.orgId, fx.projectId, fx.projectId, fx.ids.admin],
    );
    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.modeCookie = `${fx.orgId}:team`;
    const html = await openHome(fx.orgId);
    const waiting = html.indexOf('data-home-team-waiting');
    expect(waiting).toBeGreaterThan(-1);
    expect(waiting).toBeLessThan(html.indexOf('data-home-team-projects'));
    expect(html).toContain(ov.todoTitle);
    expect(html).toContain('Spring launch film');
    expect(html).toContain('시안 v1 확인 대기');
    expect(html).toContain('안 읽은 메시지 1개');
    expect(html).toContain(`/brand/rooms/${fx.projectId}?organizationId=${fx.orgId}&amp;tab=chat`);
    for (const marker of MAKING) expect(html, marker).not.toContain(marker);
  });

  it('says what working with the team looks like when there is no project yet, with the one action', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    await fx.sql.query('update brand_projects set client_visible = false where organization_id = $1', [fx.orgId]);
    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.modeCookie = `${fx.orgId}:team`;
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-team-empty');
    expect(html).toContain(sp.empty.title);
    expect(html).toContain(sp.empty.body);
    expect(html).not.toContain('data-home-team-projects');
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).toContain(`href="/brand/projects/new?organizationId=${fx.orgId}"`);
    for (const marker of MAKING) expect(html, marker).not.toContain(marker);
  });

  it('gives a viewer the projects without a request action', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.viewer);
    mocks.modeCookie = `${fx.orgId}:team`;
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-mode="team"');
    expect(html).toContain('data-home-team-projects');
    expect(html).not.toContain('/brand/projects/new');
    expect(html).not.toContain('data-variant="solid"');
    expect(html).toContain('data-home-viewer-note');
  });

  it('ignores a remembered 야기 팀과 while rooms are closed: no team side, the making home', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    mocks.modeCookie = `${fx.orgId}:team`;
    const html = await openHome(fx.orgId);
    expect(html).toContain('data-home-mode="make"');
    expect(html).toContain('data-home-prompt');
  });
});
