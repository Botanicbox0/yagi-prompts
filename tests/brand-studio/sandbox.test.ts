import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { STUDIO_OPERATIONS, type StudioOperation } from '@/lib/brand-studio/contracts';
import { studioCopyAllowed, studioV2Visible } from '@/lib/brand-studio/visibility';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { requestId, studioFixture, viewerOf, type StudioFixture } from './server/helpers';
import { LIBRARY_OPERATIONS, type LibraryOperation } from '@/lib/brand-studio/library-contracts';
import { seedImageAsset, studioDeps } from './server/helpers';

/**
 * docs/BRAND-STUDIO-V2.md §3 — the Morphic hardline, pinned at the HTTP boundary.
 *
 * For both sandboxed organization ids and for organizations named "Morphic …" / "모픽 …", with the
 * flag ON and an allowance row present, every studio operation and both GETs answer 404 with
 * `feature_unavailable` (or `not_found`) and write nothing. With the flag OFF every studio route
 * answers `studio_closed` for everyone. Do not weaken this file to make something pass.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null, after: [] as Array<() => unknown> }));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (callback: () => unknown) => mocks.after.push(callback) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));

const studio = await import('@/app/api/brand-studio/route');
const uploadRoute = await import('@/app/api/brand-studio/assets/[id]/route');
const mediaRoute = await import('@/app/api/brand-studio/media/[...key]/route');
const libraryRoute = await import('@/app/api/brand-studio/library/route');

const BASE = 'http://localhost:3000/api/brand-studio';
const get = (query: string) => studio.GET(new NextRequest(`${BASE}?${query}`));
const post = (operation: string, input: unknown) =>
  studio.POST(new NextRequest(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));

/** A well-formed input for every operation, so a refusal can only come from the gate. */
function validInput(operation: StudioOperation, organizationId: string): Record<string, unknown> {
  const id = randomUUID();
  switch (operation) {
    case 'job.create':
      return { kind: 'image', organizationId, requestId: requestId(), model: 'seedream-5.5', prompt: 'a bottle', aspect: '1:1', resolution: '2K', count: 1 };
    case 'job.cancel':
      return { organizationId, jobId: id };
    case 'prompt.enhance':
      return { kind: 'image', organizationId, model: 'seedream-5.5', prompt: 'a bottle', aspect: '1:1', resolution: '2K' };
    case 'revise.plan':
      return { organizationId, outputId: id, prompt: 'make the bottle blue' };
    case 'revise.mark':
      return { organizationId, outputId: id, time: 1, x: 0.5, y: 0.5, frame: 'data:image/jpeg;base64,/9j/4AAQ' };
    case 'film.analyze':
    case 'asset.complete':
    case 'asset.delete':
      return { organizationId, assetId: id };
    case 'asset.reserve':
      return { organizationId, requestId: requestId(), name: 'bottle.png', mime: 'image/png', sizeBytes: 1000 };
    case 'asset.update':
      return { organizationId, assetId: id, name: 'renamed' };
    case 'asset.from_output':
    case 'output.delete':
      return { organizationId, outputId: id };
    case 'handoff.campaign':
      return { organizationId, requestId: requestId(), outputId: id, newProject: { title: 'A campaign', objective: 'An objective' } };
  }
}

const sandboxed = [...SANDBOXED_CLIENT_ORG_IDS];
const cases: Array<{ label: string; orgId?: string; orgName?: string }> = [
  { label: `sandboxed id ${sandboxed[0]}`, orgId: sandboxed[0]! },
  { label: `sandboxed id ${sandboxed[1]}`, orgId: sandboxed[1]! },
  { label: 'named "Morphic Korea"', orgName: 'Morphic Korea' },
  { label: 'named "모픽"', orgName: '모픽' },
];

let f: StudioFixture | null = null;
beforeEach(() => {
  mocks.after.length = 0;
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
});

async function counts(sql: SqlRunner) {
  return (
    await sql.query<{ jobs: number; assets: number; projects: number }>(
      `select (select count(*)::int from brand_studio_jobs) as jobs, (select count(*)::int from brand_studio_assets) as assets,
              (select count(*)::int from brand_projects) as projects`,
    )
  ).rows[0]!;
}

describe.each(cases)('Morphic hardline: organization $label', ({ orgId, orgName }) => {
  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client brand', capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
  });

  it('is invisible to every screen rule', () => {
    expect(studioV2Visible({ id: f!.orgId, name: orgName ?? 'Client brand' }, true)).toBe(false);
  });

  it('answers both GETs with a 404 that names nothing', async () => {
    expect((await f!.sql.query('select monthly_cap_krw from brand_studio_allowances where organization_id = $1', [f!.orgId])).rows).toHaveLength(1);
    for (const query of [`organizationId=${f!.orgId}`, `organizationId=${f!.orgId}&jobs=${randomUUID()}`]) {
      const response = await get(query);
      expect(response.status, query).toBe(404);
      expect(['feature_unavailable', 'not_found']).toContain((await response.json()).code);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('answers every operation with a 404 and writes nothing, for owners and editors alike', async () => {
    const before = await counts(f!.sql);
    for (const member of [f!.ids.owner, f!.ids.editor]) {
      mocks.viewer = viewerOf(member);
      for (const operation of STUDIO_OPERATIONS) {
        const response = await post(operation, validInput(operation, f!.orgId));
        const body = await response.json();
        expect(response.status, operation).toBe(404);
        expect(['feature_unavailable', 'not_found'], operation).toContain(body.code);
        expect(Object.keys(body).sort(), operation).toEqual(['code', 'ok']);
      }
      // Even a malformed body for this organization learns nothing beyond the 404.
      const malformed = await post('job.create', { organizationId: f!.orgId, kind: 'image' });
      expect(malformed.status).toBe(404);
    }
    expect(await counts(f!.sql)).toEqual(before);
    expect(mocks.after).toHaveLength(0);
  });

  it('keeps the local upload gateway shut', async () => {
    const response = await uploadRoute.POST(new NextRequest(`${BASE}/assets/${randomUUID()}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) }), {
      params: Promise.resolve({ id: randomUUID() }),
    });
    expect(response.status).toBe(404);
  });
});

describe('the flag', () => {
  it('closes every studio route for everyone when off, sandboxed or not', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    for (const options of [{ capKrw: 5_000_000 }, { orgId: sandboxed[0]!, capKrw: 5_000_000 }]) {
      f = await studioFixture(options);
      mocks.sql = f.sql;
      mocks.viewer = viewerOf(f.ids.owner);
      for (const query of [`organizationId=${f.orgId}`, `organizationId=${f.orgId}&jobs=${randomUUID()}`]) {
        const response = await get(query);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ ok: false, code: 'studio_closed' });
      }
      for (const operation of STUDIO_OPERATIONS) {
        const response = await post(operation, validInput(operation, f.orgId));
        expect(response.status, operation).toBe(404);
        expect(await response.json(), operation).toEqual({ ok: false, code: 'studio_closed' });
      }
      const upload = await uploadRoute.POST(new NextRequest(`${BASE}/assets/${randomUUID()}`, { method: 'POST', body: new Uint8Array([1]) }), { params: Promise.resolve({ id: randomUUID() }) });
      expect(upload.status).toBe(404);
      const media = await mediaRoute.GET(new NextRequest(`${BASE}/media/st/${'a'.repeat(64)}.png`), { params: Promise.resolve({ key: ['st', `${'a'.repeat(64)}.png`] }) });
      expect(media.status).toBe(404);
      expect((await counts(f.sql)).jobs).toBe(0);
      await f.db.close();
      f = null;
    }
  });

  it('is unset (closed) by default', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', '');
    f = await studioFixture();
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    expect(await (await get(`organizationId=${f.orgId}`)).json()).toEqual({ ok: false, code: 'studio_closed' });
  });
});

describe('control: an ordinary organization with the flag on', () => {
  it('opens the studio, so the 404s above come from the hardline and not from a broken route', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    const state = await get(`organizationId=${f.orgId}`);
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ ok: true, canCreate: true, allowance: { capKrw: 5_000_000, usedKrw: 0 } });
    const created = await post('job.create', validInput('job.create', f.orgId));
    expect(created.status).toBe(201);
    expect(mocks.after).toHaveLength(1);
    mocks.viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } as unknown as Viewer;
    expect((await get(`organizationId=${f.orgId}`)).status).toBe(401);
  });

  it('keeps the provider webhook and the lane door off the brand host', () => {
    expect(brandRouteAllowed('/api/brand-studio', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio', 'POST')).toBe(true);
    expect(brandRouteAllowed(`/api/brand-studio/assets/${randomUUID()}`, 'POST')).toBe(true);
    expect(brandRouteAllowed(`/api/brand-studio/media/st/${'b'.repeat(64)}.mp4`, 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/webhook', 'POST')).toBe(false);
    expect(brandRouteAllowed('/api/brand-studio/lane', 'POST')).toBe(false);
    expect(brandRouteAllowed('/api/brand-studio/media/st/../../secret', 'GET')).toBe(false);
  });
});

/* ---------------------------------------------- the library rail (docs/BRAND-STUDIO-V3.md §4, slice B2) */

const LIBRARY = `${BASE}/library`;
const libraryGet = (query: string) => libraryRoute.GET(new NextRequest(`${LIBRARY}?${query}`));
const libraryPost = (operation: string, input: unknown) =>
  libraryRoute.POST(new NextRequest(LIBRARY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));

/** Real targets of the organization, so a refusal can only come from the gate. */
function validLibraryInput(operation: LibraryOperation, organizationId: string, target: { folderId: string; assetId: string }): Record<string, unknown> {
  switch (operation) {
    case 'like.toggle':
      return { organizationId, ref: { assetId: target.assetId }, liked: true };
    case 'folder.create':
      return { organizationId, name: 'A new folder' };
    case 'folder.rename':
      return { organizationId, folderId: target.folderId, name: 'Renamed' };
    case 'folder.delete':
      return { organizationId, folderId: target.folderId };
    case 'folder.add':
    case 'folder.remove':
      return { organizationId, folderId: target.folderId, ref: { assetId: target.assetId } };
  }
}

async function libraryCounts(sql: SqlRunner) {
  return (
    await sql.query(
      `select (select count(*)::int from brand_studio_folders) as folders, (select count(*)::int from brand_studio_folders where deleted_at is null) as live,
              (select count(*)::int from brand_studio_folder_items) as items, (select count(*)::int from brand_studio_likes) as likes,
              (select string_agg(name, ',' order by name) from brand_studio_folders) as names`,
    )
  ).rows[0]!;
}

async function libraryTarget(fixture: StudioFixture) {
  const assetId = await seedImageAsset(studioDeps(fixture.sql), fixture.orgId, fixture.ids.owner);
  const folderId = (await fixture.sql.query<{ id: string }>("insert into brand_studio_folders (organization_id, name) values ($1, 'Seeded') returning id", [fixture.orgId])).rows[0]!.id;
  return { assetId, folderId };
}

describe.each(cases)('Morphic hardline, library rail: organization $label', ({ orgId, orgName }) => {
  let target: { folderId: string; assetId: string };
  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client brand', capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    target = await libraryTarget(f);
  });

  it('answers both GETs with a 404 that names nothing', async () => {
    for (const query of [`organizationId=${f!.orgId}`, `organizationId=${f!.orgId}&folder=${target.folderId}`]) {
      const response = await libraryGet(query);
      expect(response.status, query).toBe(404);
      const body = await response.json();
      expect(['feature_unavailable', 'not_found']).toContain(body.code);
      expect(Object.keys(body).sort(), query).toEqual(['code', 'ok']);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('answers every operation with a 404 and writes nothing, for owners, editors and viewers alike', async () => {
    const before = await libraryCounts(f!.sql);
    for (const member of [f!.ids.owner, f!.ids.editor, f!.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      for (const operation of LIBRARY_OPERATIONS) {
        const response = await libraryPost(operation, validLibraryInput(operation, f!.orgId, target));
        const body = await response.json();
        expect(response.status, operation).toBe(404);
        expect(['feature_unavailable', 'not_found'], operation).toContain(body.code);
        expect(Object.keys(body).sort(), operation).toEqual(['code', 'ok']);
      }
      const malformed = await libraryPost('folder.create', { organizationId: f!.orgId, name: '' });
      expect(malformed.status).toBe(404);
    }
    expect(await libraryCounts(f!.sql)).toEqual(before);
  });
});

describe('the flag, library rail', () => {
  it('closes the library for everyone when off, sandboxed or not', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    for (const options of [{ capKrw: 5_000_000 }, { orgId: sandboxed[0]!, capKrw: 5_000_000 }]) {
      f = await studioFixture(options);
      mocks.sql = f.sql;
      mocks.viewer = viewerOf(f.ids.owner);
      const target = await libraryTarget(f);
      const before = await libraryCounts(f.sql);
      for (const query of [`organizationId=${f.orgId}`, `organizationId=${f.orgId}&folder=${target.folderId}`]) {
        const response = await libraryGet(query);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ ok: false, code: 'studio_closed' });
      }
      for (const operation of LIBRARY_OPERATIONS) {
        const response = await libraryPost(operation, validLibraryInput(operation, f.orgId, target));
        expect(response.status, operation).toBe(404);
        expect(await response.json(), operation).toEqual({ ok: false, code: 'studio_closed' });
      }
      expect(await libraryCounts(f.sql)).toEqual(before);
      await f.db.close();
      f = null;
    }
  });
});

describe('control: the library rail of an ordinary organization with the flag on', () => {
  it('opens, so the 404s above come from the hardline and not from a broken route', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    const target = await libraryTarget(f);
    const summary = await libraryGet(`organizationId=${f.orgId}`);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ ok: true, folders: [{ id: target.folderId, name: 'Seeded' }], liked: [] });
    expect((await libraryPost('folder.add', validLibraryInput('folder.add', f.orgId, target))).status).toBe(200);
    expect(await (await libraryGet(`organizationId=${f.orgId}&folder=${target.folderId}`)).json()).toMatchObject({ ok: true, items: [{ key: `a:${target.assetId}` }] });
    mocks.viewer = viewerOf(f.ids.viewer);
    expect((await libraryPost('folder.create', validLibraryInput('folder.create', f.orgId, target))).status).toBe(403);
    expect((await libraryPost('like.toggle', validLibraryInput('like.toggle', f.orgId, target))).status).toBe(200);
    mocks.viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } as unknown as Viewer;
    expect((await libraryGet(`organizationId=${f.orgId}`)).status).toBe(401);
    expect(brandRouteAllowed('/api/brand-studio/library', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/library', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/library/extra', 'GET')).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * docs/BRAND-STUDIO-V3.md §7, §9-1 — the review space under the same hardline: for every sandboxed
 * case both GETs and every review operation answer 404 and write nothing, owners and editors alike;
 * with the flag off every method answers `studio_closed`.
 */
const reviewRoute = await import('@/app/api/brand-studio/review/route');
const { REVIEW_OPERATIONS } = await import('@/lib/brand-studio/review-contracts');
const { seedOutput } = await import('./review/fixtures');
const REVIEW = `${BASE}/review`;
const reviewGet = (query: string) => reviewRoute.GET(new NextRequest(`${REVIEW}?${query}`));
const reviewPost = (operation: string, input: unknown) =>
  reviewRoute.POST(new NextRequest(REVIEW, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));

/** A well-formed input for every review operation, pointing at real rows, so a refusal can only come from the gate. */
function validReviewInput(operation: string, organizationId: string, target: { outputId: string; reviewId: string; commentId: string }): Record<string, unknown> {
  switch (operation) {
    case 'review.create':
      return { organizationId, outputId: target.outputId, title: 'A film' };
    case 'review.status':
      return { organizationId, reviewId: target.reviewId, status: 'approved' };
    case 'review.delete':
      return { organizationId, reviewId: target.reviewId };
    case 'comment.add':
      return { organizationId, reviewId: target.reviewId, body: 'The logo is small', atMs: 1000, x: 0.5, y: 0.5 };
    default:
      return { organizationId, reviewId: target.reviewId, commentId: target.commentId };
  }
}

/** Rows planted under the sandboxed organization directly, as if they had slipped in some other way. */
async function reviewTarget(fixture: StudioFixture) {
  const outputId = await seedOutput(studioDeps(fixture.sql), fixture.orgId, fixture.ids.owner, 'video');
  const reviewId = (
    await fixture.sql.query<{ id: string }>(
      `insert into brand_studio_reviews (organization_id, output_id, title, created_by, created_role) values ($1, $2, 'Planted', $3, 'studio') returning id`,
      [fixture.orgId, outputId, fixture.ids.admin],
    )
  ).rows[0]!.id;
  const commentId = (
    await fixture.sql.query<{ id: string }>(
      `insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body) values ($1, $2, $3, 'brand', 'planted') returning id`,
      [reviewId, fixture.orgId, fixture.ids.owner],
    )
  ).rows[0]!.id;
  // A second piece with no review yet, so review.create has a valid target too.
  const freshOutput = await seedOutput(studioDeps(fixture.sql), fixture.orgId, fixture.ids.owner, 'image');
  return { outputId: freshOutput, reviewId, commentId };
}

async function reviewCounts(sql: SqlRunner) {
  return (
    await sql.query<{ reviews: number; comments: number; touched: number }>(
      `select (select count(*)::int from brand_studio_reviews where deleted_at is null) as reviews,
              (select count(*)::int from brand_studio_review_comments where deleted_at is null and resolved_at is null) as comments,
              (select count(*)::int from brand_studio_reviews where status <> 'open') as touched`,
    )
  ).rows[0]!;
}

describe.each(cases)('Morphic hardline, review space: organization $label', ({ orgId, orgName }) => {
  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client brand', capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
  });

  it('answers both GETs with a 404 that names nothing', async () => {
    const target = await reviewTarget(f!);
    for (const query of [`organizationId=${f!.orgId}`, `organizationId=${f!.orgId}&review=${target.reviewId}`]) {
      const response = await reviewGet(query);
      expect(response.status, query).toBe(404);
      const body = await response.json();
      expect(['feature_unavailable', 'not_found'], query).toContain(body.code);
      expect(Object.keys(body).sort(), query).toEqual(['code', 'ok']);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('answers every review operation with a 404 and writes nothing, for owners and editors alike', async () => {
    const target = await reviewTarget(f!);
    const before = await reviewCounts(f!.sql);
    for (const member of [f!.ids.owner, f!.ids.editor]) {
      mocks.viewer = viewerOf(member);
      for (const operation of REVIEW_OPERATIONS) {
        const response = await reviewPost(operation, validReviewInput(operation, f!.orgId, target));
        const body = await response.json();
        expect(response.status, operation).toBe(404);
        expect(['feature_unavailable', 'not_found'], operation).toContain(body.code);
        expect(Object.keys(body).sort(), operation).toEqual(['code', 'ok']);
      }
      expect((await reviewPost('comment.add', { organizationId: f!.orgId })).status).toBe(404);
    }
    expect(await reviewCounts(f!.sql)).toEqual(before);
    expect(mocks.after).toHaveLength(0);
  });
});

describe('the flag, review space', () => {
  it('closes every review method for everyone when off, sandboxed or not', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    for (const options of [{ capKrw: 5_000_000 }, { orgId: sandboxed[0]!, capKrw: 5_000_000 }]) {
      f = await studioFixture(options);
      mocks.sql = f.sql;
      mocks.viewer = viewerOf(f.ids.owner);
      const target = await reviewTarget(f);
      for (const query of [`organizationId=${f.orgId}`, `organizationId=${f.orgId}&review=${target.reviewId}`]) {
        const response = await reviewGet(query);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ ok: false, code: 'studio_closed' });
      }
      for (const operation of REVIEW_OPERATIONS) {
        const response = await reviewPost(operation, validReviewInput(operation, f.orgId, target));
        expect(response.status, operation).toBe(404);
        expect(await response.json(), operation).toEqual({ ok: false, code: 'studio_closed' });
      }
      await f.db.close();
      f = null;
    }
  });
});

describe('control: the review space of an ordinary organization with the flag on', () => {
  it('opens, so the 404s above come from the hardline and not from a broken route', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    const target = await reviewTarget(f);
    expect(await (await reviewGet(`organizationId=${f.orgId}`)).json()).toMatchObject({ ok: true, canWrite: true, reviews: [{ id: target.reviewId }] });
    expect((await reviewPost('comment.add', validReviewInput('comment.add', f.orgId, target))).status).toBe(200);
    expect(mocks.after).toHaveLength(1);
    expect((await reviewPost('review.create', validReviewInput('review.create', f.orgId, target))).status).toBe(201);
    mocks.viewer = viewerOf(f.ids.viewer);
    expect((await reviewPost('comment.add', validReviewInput('comment.add', f.orgId, target))).status).toBe(403);
    mocks.viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } as unknown as Viewer;
    expect((await reviewGet(`organizationId=${f.orgId}`)).status).toBe(401);
    expect(brandRouteAllowed('/api/brand-studio/review', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/review', 'POST')).toBe(true);
  });
});

/* ------------------------------------------------- the workspace rail's summary (docs/BRAND-STUDIO-V3.md §3) */

const summaryRoute = await import('@/app/api/brand-studio/summary/route');
const summaryGet = (organizationId: string) => summaryRoute.GET(new NextRequest(`${BASE}/summary?organizationId=${organizationId}`));

describe.each(cases)('Morphic hardline, rail summary: organization $label', ({ orgId, orgName }) => {
  it('answers a 404 that names nothing, for every member, with the flag on and an allowance present', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client brand', capKrw: 5_000_000 });
    mocks.sql = f.sql;
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      const response = await summaryGet(f.orgId);
      expect(response.status).toBe(404);
      expect(['feature_unavailable', 'not_found']).toContain((await response.json()).code);
    }
  });
});

describe('the flag and the control, rail summary', () => {
  it('is closed when off and open for an ordinary organization when on', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    f = await studioFixture({ capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    expect(await (await summaryGet(f.orgId)).json()).toEqual({ ok: false, code: 'studio_closed' });
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    expect(await (await summaryGet(f.orgId)).json()).toMatchObject({ ok: true, allowance: { capKrw: 5_000_000 }, open: [], settled: [] });
    expect(brandRouteAllowed('/api/brand-studio/summary', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/summary', 'POST')).toBe(false);
  });
});

/* --------------------------------- the video screen (docs/BRAND-STUDIO-V3.md §6, §9-1, slice C) */

// The page reads its viewer and database through the workspace context; here they are the fixture's.
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: mocks.viewer, sql: mocks.sql, verifiedEmail: undefined, brandHost: false, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});
const videoPage = (await import('@/app/(brand)/brand/studio/video/page')).default;
const { isBrandPath } = await import('@/lib/routing/surfaces');
const openVideoPage = (organizationId: string) => videoPage({ searchParams: Promise.resolve({ organizationId, start: 'reverse' }) });
/** `notFound()` throws Next's 404 signal before anything renders; a page (or any other error) fails here. */
async function expectNoVideoPage(organizationId: string) {
  const error = await openVideoPage(organizationId).then(
    () => null,
    (e: unknown) => e,
  );
  expect(String((error as { digest?: string } | null)?.digest ?? error)).toContain('404');
}

describe.each(cases)('Morphic hardline, video screen: organization $label', ({ orgId, orgName }) => {
  it('is a 404 for every member, with the flag on and an allowance present, and writes nothing', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client brand', capKrw: 5_000_000 });
    mocks.sql = f.sql;
    const before = await counts(f.sql);
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      await expectNoVideoPage(f.orgId);
    }
    expect(await counts(f.sql)).toEqual(before);
  });
});

describe('the video screen: the flag, invitees, the control and the route', () => {
  it('is a 404 for everyone while the flag is off, and for a campaign-only invitee when it is on', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    f = await studioFixture({ capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    await expectNoVideoPage(f.orgId);
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    mocks.viewer = viewerOf(f.ids.guest);
    await expectNoVideoPage(f.orgId);
  });

  it('opens for an ordinary organization with the flag on, so the 404s above come from the gate', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    f = await studioFixture({ capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    await expect(openVideoPage(f.orgId)).resolves.toBeTruthy();
  });

  it('is a brand route like its siblings', () => {
    expect(isBrandPath('/brand/studio/video')).toBe(true);
    expect(brandRouteAllowed('/brand/studio/video', 'GET')).toBe(true);
    expect(brandRouteAllowed('/brand/studio/video', 'POST')).toBe(false);
  });
});

describe('studio copy never reaches a viewer whose brands are all closed', () => {
  const MORPHIC = { id: 'deb648e9-c2df-43d4-b2a7-7f9eff8180d9', name: 'Morphic' };
  const OPEN = { id: '00000000-0000-4000-8000-0000000000aa', name: 'Ordinary brand' };
  it('refuses a sandboxed-only viewer, by id and by name', () => {
    expect(studioCopyAllowed([MORPHIC])).toBe(false);
    expect(studioCopyAllowed([{ id: OPEN.id, name: '모픽 코리아' }])).toBe(false);
    expect(studioCopyAllowed([])).toBe(false);
  });
  it('refuses a viewer whose only brand closes generative media', () => {
    expect(studioCopyAllowed([{ ...OPEN, denied: ['generative_media'] }])).toBe(false);
  });
  it('allows a viewer with at least one open brand', () => {
    expect(studioCopyAllowed([MORPHIC, OPEN])).toBe(true);
  });
  it('the workspace layout asks this before handing the navigation any studio copy', () => {
    const layout = readFileSync('app/(brand)/layout.tsx', 'utf8');
    expect(layout).toContain('studioCopyAllowed(scope.choices)');
    expect(layout).toContain('shell={studioCopy?d.studioShell:undefined}');
    expect(layout).toContain('const studioV2=brandStudioV2Open()&&studioCopy;');
    // Project rooms (docs/BRAND-ROOMS.md §2): the same rule, and the room words only with it.
    expect(layout).toContain('const rooms=brandRoomsOpen()&&studioCopy;');
    expect(layout).toContain('roomsCopy={rooms?d.roomsShell.nav:undefined}');
  });
});
