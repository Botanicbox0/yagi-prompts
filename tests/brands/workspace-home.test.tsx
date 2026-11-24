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
  HOME_STARTERS,
  HOME_WALL_LIMIT,
  homeLayout,
  homeResults,
  homeTileRatio,
  homeWallRows,
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

/* -------------------------------------------------------------------- the layout the home reads */

// The home no longer draws doors or tool cards (the rail lists every tool); it reads the layout for the
// team line's request (`team`) and for the wall's one link out (`assets` in `tools`). The layout itself
// still follows the rail's checks, so these stay as they were.
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
    // The doors' example frames went with the doors; the starters are the home's only house frames now.
    for (const path of HOME_STARTERS.map((s) => s.picture)) {
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
const output = (id: string, kind: 'image' | 'video' | 'audio', thumbUrl: string | null, url = `/m/${id}`) =>
  ({ id, jobId: 'j', kind, url, thumbUrl, width: 800, height: 1000, seconds: kind === 'image' ? null : 6.2, draft: false, savedAssetId: null }) as StudioJobView['outputs'][number];
const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('recent results (the wall)', () => {
  const org = 'c0000000-0000-4000-8000-00000000000c';
  it('takes finished results, newest first, at most twelve by default, and links each to its screen viewer', () => {
    expect(HOME_WALL_LIMIT).toBe(12);
    const jobs = [
      job({ id: 'v', kind: 'video', outputs: [output(oid(1), 'video', '/m/poster')] }),
      job({ id: 'f', kind: 'image', status: 'failed', outputs: [output(oid(2), 'image', null)] }),
      job({ id: 'x', kind: 'image', purpose: 'fill', outputs: [output(oid(3), 'image', null)] }),
      job({ id: 'n', kind: 'video', outputs: [output(oid(4), 'video', null)] }),
      job({ id: 'r', kind: 'region_edit', outputs: [output(oid(5), 'image', null)] }),
      job({ id: 'm', kind: 'music', outputs: [output(oid(6), 'audio', null)] }),
      ...Array.from({ length: 14 }, (_, i) => job({ id: `i${i}`, outputs: [output(oid(100 + i), 'image', `/m/t${i}`)] })),
    ];
    const results = homeResults(jobs, org);
    expect(results).toHaveLength(HOME_WALL_LIMIT);
    // Newest first: the clip, the poster-less clip, the partial edit, then the images in order until the limit.
    expect(results.map((r) => r.outputId)).toEqual([oid(1), oid(4), oid(5), ...Array.from({ length: 9 }, (_, i) => oid(100 + i))]);
    expect(results[0]).toMatchObject({ kind: 'video', src: '/m/poster', seconds: 6.2 });
    expect(results[0]!.href).toBe(`/brand/studio/video?organizationId=${org}&view=o%3A${oid(1)}`);
    // A partial edit lives on the image screen; the image itself stands in when there is no thumbnail.
    expect(results[2]).toMatchObject({ kind: 'image', src: `/m/${oid(5)}`, clip: null });
    expect(results[2]!.href.startsWith(`/brand/studio?organizationId=${org}&view=`)).toBe(true);
    // Failed runs, fill strips and sound are left out.
    for (const left of [oid(2), oid(3), oid(6)]) expect(results.map((r) => r.outputId)).not.toContain(left);
    expect(results.some((r) => (r.kind as string) === 'audio')).toBe(false);
    // An explicit limit still wins.
    expect(homeResults(jobs, org, 2).map((r) => r.outputId)).toEqual([oid(1), oid(4)]);
  });

  it('gives a clip its own file to play, with or without a poster, and an image nothing to play', () => {
    const [poster, still, image] = homeResults(
      [
        job({ id: 'v', kind: 'video', outputs: [output(oid(11), 'video', '/m/poster-11', '/m/film-11.mp4')] }),
        job({ id: 'n', kind: 'video_remix', outputs: [output(oid(12), 'video', null, '/m/film-12.mp4')] }),
        job({ id: 'i', kind: 'image', outputs: [output(oid(13), 'image', '/m/thumb-13', '/m/full-13.png')] }),
      ],
      org,
    );
    // Over a poster: the poster is the picture, the file is what plays.
    expect(poster).toMatchObject({ kind: 'video', src: '/m/poster-11', clip: null, play: '/m/film-11.mp4', seconds: 6.2, width: 800, height: 1000 });
    // No poster: the file is both the still and what plays.
    expect(still).toMatchObject({ kind: 'video', src: null, clip: '/m/film-12.mp4', play: '/m/film-12.mp4' });
    expect(still!.href.startsWith(`/brand/studio/video?organizationId=${org}&view=`)).toBe(true);
    // An image never plays.
    expect(image).toMatchObject({ kind: 'image', src: '/m/thumb-13', clip: null, play: null, seconds: null });
  });
});

describe('a wall tile keeps its own proportions (homeTileRatio)', () => {
  it('reads width over height', () => {
    expect(homeTileRatio({ kind: 'image', width: 800, height: 1000 })).toBe(0.8);
    expect(homeTileRatio({ kind: 'image', width: 1000, height: 1000 })).toBe(1);
    expect(homeTileRatio({ kind: 'video', width: 1920, height: 1080 })).toBe(1.778);
    // 9:16 rounds to three decimals before the clamp (0.563), a hair inside the floor.
    expect(homeTileRatio({ kind: 'video', width: 1080, height: 1920 })).toBeCloseTo(9 / 16, 3);
  });
  it('keeps every tile between a tall phone frame (9:16) and a wide strip (2.4:1)', () => {
    expect(homeTileRatio({ kind: 'image', width: 500, height: 2000 })).toBe(0.5625);
    expect(homeTileRatio({ kind: 'video', width: 4000, height: 1000 })).toBe(2.4);
    expect(homeTileRatio({ kind: 'image', width: 1, height: 10_000 })).toBe(0.5625);
    expect(homeTileRatio({ kind: 'image', width: 10_000, height: 1 })).toBe(2.4);
  });
  it('falls back to 4:5 for an image and 16:9 for a clip without a size', () => {
    for (const size of [
      { width: null, height: null },
      { width: 800, height: null },
      { width: null, height: 1000 },
      { width: 0, height: 1000 },
      { width: 800, height: 0 },
    ]) {
      expect(homeTileRatio({ kind: 'image', ...size }), JSON.stringify(size)).toBe(0.8);
      expect(homeTileRatio({ kind: 'video', ...size }), JSON.stringify(size)).toBe(1.778);
    }
  });
});

describe('the wall as rows of one height (homeWallRows)', () => {
  const TARGET = 4.6;
  const sum = (row: { items: ReadonlyArray<{ ratio: number }> }) => row.items.reduce((total, entry) => total + entry.ratio, 0);
  // A fixed spread of real proportions (9:16 … 2.4:1), cycled: deterministic, no randomness in the test.
  const SPREAD = [0.5625, 0.8, 1, 1.778, 2.4, 0.75, 1.333, 0.5625, 1.5, 0.8, 2.4, 1];
  const sample = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, ratio: SPREAD[i % SPREAD.length]! }));
  const ratioOf = (t: { ratio: number }) => t.ratio;

  it('gives no rows for no results', () => {
    expect(homeWallRows([], ratioOf)).toEqual([]);
  });

  it('keeps every item once and in order, with the ratio it was given', () => {
    for (const n of [1, 2, 5, 12, 31]) {
      const items = sample(n);
      const rows = homeWallRows(items, ratioOf);
      expect(rows.flatMap((row) => row.items.map((entry) => entry.item)), String(n)).toEqual(items);
      for (const row of rows) for (const entry of row.items) expect(entry.ratio).toBe(entry.item.ratio);
      expect(rows.every((row) => row.items.length > 0)).toBe(true);
    }
  });

  it('closes a row near the target: never further off than half a tile', () => {
    const rows = homeWallRows(sample(48), ratioOf);
    expect(rows.length).toBeGreaterThan(5);
    // Every closed row (all but the last) sits within half the widest tile (2.4 / 2) of the target.
    for (const row of rows.slice(0, -1)) {
      expect(Math.abs(sum(row) - TARGET), JSON.stringify(row.items.map((e) => e.ratio))).toBeLessThanOrEqual(1.2 + 1e-9);
    }
    // Squares: four are 0.6 short of the target, five 0.4 over, six 1.4 over: rows of five.
    const squares = homeWallRows(Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, ratio: 1 })), ratioOf);
    expect(squares.map((row) => row.items.length)).toEqual([5, 5]);
    // A custom target is honoured.
    expect(homeWallRows(Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, ratio: 1 })), ratioOf, 3).map((row) => row.items.length)).toEqual([3, 3]);
  });

  it('marks a short last row with the room it leaves open, and every full row with none', () => {
    const seven = homeWallRows(Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, ratio: 1 })), ratioOf);
    expect(seven.map((row) => row.items.length)).toEqual([5, 2]);
    expect(seven[0]!.rest).toBe(0);
    expect(seven[1]!.rest).toBe(2.6);
    // A last row that reaches the target is full: no room left open.
    const ten = homeWallRows(Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, ratio: 1 })), ratioOf);
    expect(ten.map((row) => row.rest)).toEqual([0, 0]);
    // One tile alone: one short row.
    const one = homeWallRows([{ id: 'only', ratio: 0.8 }], ratioOf);
    expect(one).toEqual([{ items: [{ item: { id: 'only', ratio: 0.8 }, ratio: 0.8 }], rest: 3.8 }]);
    // Across a long, mixed wall: every row but the last is full, and the last one's rest is what it lacks.
    const rows = homeWallRows(sample(31), ratioOf);
    for (const row of rows.slice(0, -1)) expect(row.rest).toBe(0);
    const last = rows.at(-1)!;
    expect(last.rest).toBeCloseTo(Math.max(0, TARGET - sum(last)), 3);
    expect(rows.filter((row) => row.rest > 0).length).toBeLessThanOrEqual(1);
  });

  it('is deterministic: the same results always give the same wall', () => {
    const items = sample(23);
    expect(homeWallRows(items, ratioOf)).toEqual(homeWallRows(items, ratioOf));
    expect(homeWallRows([...items], ratioOf)).toEqual(homeWallRows(items, ratioOf));
  });

  it('is what the home view draws from homeResults (ratios from homeTileRatio)', () => {
    const results = homeResults(
      Array.from({ length: 5 }, (_, i) => job({ id: `i${i}`, outputs: [output(oid(200 + i), i % 2 ? 'video' : 'image', `/m/p${i}`)] })),
      'c0000000-0000-4000-8000-00000000000c',
    );
    const rows = homeWallRows(results, homeTileRatio);
    expect(rows.flatMap((row) => row.items.map((entry) => entry.ratio))).toEqual(results.map((r) => homeTileRatio(r)));
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

  // Markers of the home before the 2026-11-25 redesign: tool cards, doors and their pictures, example
  // frames, the team tile's stage strip, the lower band and the credits sentence. None may come back.
  const GONE = ['data-home-tools', 'data-home-doors', 'data-home-door', 'data-door-picture', 'data-home-example', 'data-home-team-stages', 'data-home-lower', 'data-home-credits'];
  const actions = (html: string) => [...html.matchAll(/data-home-action="([^"]+)"/g)].map((m) => m[1]);

  it('shows an owner the prompt bar, the team line and three starters: no tool cards, doors or credits', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    const html = await openHome(fx.orgId);
    expect(html).toContain(`data-workspace-home="${fx.orgId}"`);
    expect(html).toContain('data-home-state="empty"');
    // The heading is the workspace's name, one quiet h1.
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Home fixture brand 작업공간<\/h1>/);
    for (const marker of GONE) expect(html, marker).not.toContain(marker);
    // The rail lists every tool; the home repeats none of them. Its only link out here is the request.
    expect(actions(html)).toEqual(['commission']);
    for (const name of [ko.studioShell.rail.compose, ko.studioShell.rail.workflows, ko.roomsShell.nav.groupMake]) expect(html, name).not.toContain(name);
    expect(html).not.toContain(`href="/brand/studio/compose?organizationId=${fx.orgId}"`);
    // The prompt bar is the one thing first, with the page's only filled button.
    expect(html).toContain('data-home-prompt');
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).toContain(ko.brandStudio.dock.placeholder);
    expect(html.indexOf('data-home-prompt')).toBeLessThan(html.indexOf('data-home-lines'));
    // Nothing waits yet: no review lines. The team line is always there: a sentence (no project under way) and the request.
    expect(html).toContain('data-home-lines');
    expect(html).not.toContain('data-home-reviews');
    expect(html).toContain('data-home-team="commission"');
    expect(html).not.toContain('data-home-team-facts');
    expect(html).toContain(ko.brandHome.lines.commission);
    expect(html).toContain(ko.roomsShell.nav.groupTeam);
    expect(html).toContain(`href="/brand/projects/new?organizationId=${fx.orgId}"`);
    expect(html).not.toContain('data-home-action="campaign"');
    // A new brand: three starters, no wall, and no link to the asset hub (there is nothing on the wall to see more of).
    expect(html).toContain('data-home-starters');
    for (const key of ['product', 'look', 'film']) expect(html).toContain(`data-home-starter="${key}"`);
    expect(html).not.toContain('data-home-wall');
    expect(html).not.toContain('data-home-results');
    expect(html).not.toContain('data-home-action="assets"');
    // No credits on the home (the rail's meter is the one place they are read), never won.
    expect(html).not.toContain('크레딧 10,000 중 10,000 남았어요');
    expect(html).not.toMatch(/\d\s*원|₩|KRW/);
    expect(html).not.toContain('bw-primary');
    expect(html).not.toContain('data-home-viewer-note');
  });

  it('gives a viewer no prompt bar, no request, the projects link and one line saying why', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.viewer);
    const html = await openHome(fx.orgId);
    for (const marker of GONE) expect(html, marker).not.toContain(marker);
    expect(html).not.toContain('data-home-action="commission"');
    expect(html).not.toContain('/brand/projects/new');
    // No prompt bar for a role that cannot create; the team line opens the projects list instead.
    expect(html).not.toContain('data-home-prompt');
    expect(html).not.toContain('data-variant="solid"');
    expect(html).toContain('data-home-team="projects"');
    expect(actions(html)).toEqual(['projects']);
    expect(html).toContain(ko.brandHome.lines.projects);
    expect(html).toContain('data-home-viewer-note');
    // Nor the first-run guide, which is for those who can act on it.
    expect(html).not.toContain('data-home-first-run');
    // The starters still show what the studios make, as plain links.
    expect(html).toContain('data-home-starters');
  });

  it('lists drafts waiting for review as lines and the newest results as a wall', async () => {
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
    for (const marker of GONE) expect(html, marker).not.toContain(marker);
    // What waits: one line, no "more" link (that is only beyond two).
    expect(html).toContain('data-home-reviews="1"');
    expect(html.match(/data-home-review="/g)).toHaveLength(1);
    expect(html).not.toContain('data-home-reviews-more');
    expect(html).toContain('Spring launch film');
    expect(html).toContain(`/brand/rooms/${fx.projectId}?organizationId=${fx.orgId}&amp;tab=review&amp;review=${reviewId}`);
    expect(html).toContain('시안 v1 확인 대기');
    expect(html.indexOf('data-home-reviews')).toBeLessThan(html.indexOf('data-home-team='));
    // The wall: one tile per result, each a link to its viewer; the asset hub one link away.
    expect(html).toContain('data-home-state="content"');
    const shown = Number(/data-home-results="(\d+)"/.exec(html)?.[1]);
    expect(shown).toBeGreaterThanOrEqual(1);
    expect(html.match(/data-home-result="/g)).toHaveLength(shown);
    expect(html).toContain('data-home-wall');
    expect(html).toContain(`view=o%3A${outputId}`);
    expect(html).toContain('data-home-action="assets"');
    expect(html).toContain(`href="/brand/library?organizationId=${fx.orgId}"`);
    expect(html).toContain(ko.studioLibrary.allAssets);
    expect(html).not.toContain('data-home-starters');
    // The project is only requested, so the team line says what the team does rather than counting.
    expect(html).not.toContain('data-home-team-facts');
    expect(html).toContain(ko.brandHome.lines.commission);
  });

  it('counts projects under way on the team line, linked to the list, once one is active', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    await fx.sql.query("update brand_projects set status = 'active' where id = $1", [fx.projectId]);
    mocks.viewer = viewerOf(fx.ids.owner);
    const html = await openHome(fx.orgId);
    expect(html).toMatch(new RegExp(`<a href="/brand\\?organizationId=${fx.orgId}"[^>]*data-home-team-facts[^>]*>`));
    expect(html).toContain(`${ko.brandWorkspace.status.active} 1`);
    expect(html).not.toContain(ko.brandHome.lines.commission);
    // Still one request link beside it.
    expect(actions(html)).toEqual(['commission']);
  });
});

/* -------------------------------------------------------------------- the home follows the rail's mode */

describe('the home in 야기 팀과 (founder 2026-11-20: team customers do not see the making side)', () => {
  const nav = ko.roomsShell.nav;
  const ov = ko.roomsShell.overview;
  const sp = ko.roomsShell.space;
  // The making side as it is drawn since the 2026-11-25 redesign (prompt bar, waiting lines, wall, starters),
  // plus the credits sentence it no longer has either: none of it on 야기 팀과.
  const MAKING = ['data-home-prompt', 'data-home-lines', 'data-home-wall', 'data-home-results', 'data-home-starters', 'data-home-credits', ko.brandStudio.dock.placeholder];

  it('opens the making home with no remembered mode and with 직접 만들기 remembered', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await homeFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    for (const cookie of [undefined, `${fx.orgId}:make`, 'garbage']) {
      mocks.modeCookie = cookie;
      const html = await openHome(fx.orgId);
      expect(html, String(cookie)).toContain('data-home-mode="make"');
      // The rail refreshes a page that carries this when the switch is pressed (rail-mode.ts).
      expect(html).toContain('data-follows-rail-mode');
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
    expect(html).toContain('data-follows-rail-mode');
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
