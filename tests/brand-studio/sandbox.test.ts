import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { STUDIO_OPERATIONS, type StudioOperation } from '@/lib/brand-studio/contracts';
import { studioV2Visible } from '@/lib/brand-studio/visibility';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { requestId, studioFixture, viewerOf, type StudioFixture } from './server/helpers';

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

const BASE = 'http://localhost:3000/api/brand-studio';
const get = (query: string) => studio.GET(new NextRequest(`${BASE}?${query}`));
const post = (operation: string, input: unknown) =>
  studio.POST(new NextRequest(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));

/** A well-formed input for every operation, so a refusal can only come from the gate. */
function validInput(operation: StudioOperation, organizationId: string): Record<string, unknown> {
  const id = randomUUID();
  switch (operation) {
    case 'job.create':
      return { kind: 'image', organizationId, requestId: requestId(), model: 'seedream-5-pro', prompt: 'a bottle', aspect: '1:1', resolution: '2K', count: 1 };
    case 'job.cancel':
      return { organizationId, jobId: id };
    case 'prompt.enhance':
      return { kind: 'image', organizationId, model: 'seedream-5-pro', prompt: 'a bottle', aspect: '1:1', resolution: '2K' };
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
