import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { muxAvc1ToMp4 } from '@/lib/brand-studio/compose/mp4-muxer';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));

const composeRoute = await import('@/app/api/brand-studio/compose/route');

const BASE = 'http://localhost:3000/api/brand-studio/compose';
const getCompose = (query: string, headers?: Record<string, string>) =>
  composeRoute.GET(new NextRequest(`${BASE}?${query}`, { headers }));

describe('composer route surface & Morphic/policy hardlines', () => {
  let f: StudioFixture | null = null;

  beforeEach(() => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f?.db.close();
    f = null;
    mocks.sql = null;
    mocks.viewer = null;
  });

  it('allowlists GET/HEAD on /brand/studio/compose and /api/brand-studio/compose only', () => {
    expect(brandRouteAllowed('/brand/studio/compose', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'HEAD')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'POST')).toBe(false);
  });

  it('returns 404 when BRAND_STUDIO_V2 is off, and 401 when signed out', async () => {
    const id = randomUUID();
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    const closed = await getCompose(`organizationId=${id}&source=asset&id=${id}`);
    expect(closed.status).toBe(404);

    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const anon = await getCompose(`organizationId=${id}&source=asset&id=${id}`);
    expect(anon.status).toBe(401);
  });

  it.each([
    { label: `sandboxed id ${[...SANDBOXED_CLIENT_ORG_IDS][0]}`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][0] },
    { label: `sandboxed id ${[...SANDBOXED_CLIENT_ORG_IDS][1]}`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][1] },
    { label: 'named Morphic Studio', orgName: 'Morphic Studio' },
    { label: 'named 모픽 코리아', orgName: '모픽 코리아' },
  ])('returns 404 for $label even for organization owners', async ({ orgId, orgName }) => {
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client' });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);

    const res = await getCompose(`organizationId=${f.orgId}&source=asset&id=${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('streams full 200 and partial 206 Range bytes for member video assets, while denying guests and outsiders with 404', async () => {
    f = await studioFixture();
    mocks.sql = f.sql;

    const media = createStudioMediaStore();
    const mp4 = muxAvc1ToMp4({
      width: 640,
      height: 360,
      fps: 30,
      videoSamples: [{ data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, 0x00]), isKeyFrame: true }],
    });
    const stored = await media.put(mp4, 'video/mp4');
    const assetId = (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, duration_ms, storage_key, source, status, created_by, sha256)
         values ($1, 'video', 'clip.mp4', 'video/mp4', $2, 640, 360, 1000, $3, 'upload', 'ready', $4, $5) returning id`,
        [f.orgId, mp4.byteLength, stored.key, f.ids.owner, 'a'.repeat(64)],
      )
    ).rows[0]!.id;

    // Outsider & campaign-only guest both get 404
    mocks.viewer = viewerOf(f.ids.outsider);
    expect((await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`)).status).toBe(404);

    mocks.viewer = viewerOf(f.ids.guest);
    expect((await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`)).status).toBe(404);

    // Policy-denied organization gets 404
    await f.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features, updated_by)
       values ($1, array['generative_media']::text[], $2)`,
      [f.orgId, f.ids.admin],
    );
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`)).status).toBe(404);

    // Re-open policy: owner gets 200 full stream and 206 byte range
    await f.sql.query('delete from brand_feature_policies where organization_id = $1', [f.orgId]);
    const full = await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await full.arrayBuffer()).byteLength).toBe(mp4.byteLength);

    const partial = await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`, {
      range: 'bytes=4-7',
    });
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer()).toString('latin1')).toBe('ftyp');
  });
});
