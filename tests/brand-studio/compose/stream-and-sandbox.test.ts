import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { COMPOSE_CHAT_LIMIT_PER_MIN, resetComposeChatRateLimitsForTest } from '@/lib/brand-studio/compose/service';
import { composeFinalRenderCredits, composeFinalRenderKrw } from '@/lib/brand-studio/compose/credits';
import { muxAvc1ToMp4 } from '@/lib/brand-studio/compose/mp4-muxer';
import { appendClip, emptyComposerProject } from '@/lib/brand-studio/compose/timeline';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { memberUsage } from '@/lib/brand-studio/member-usage';
import { jobsOf, jobsOfStudioState } from '@/lib/brand-studio/repo';
import { studioMonthWindow, usedKrwIn } from '@/lib/brand-studio/usage';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
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
const postCompose = (body: unknown, headers?: Record<string, string>) =>
  composeRoute.POST(
    new NextRequest(BASE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

describe('composer route surface, Morphic/policy hardlines & TWINGS credits (Decision 3)', () => {
  let f: StudioFixture | null = null;

  beforeEach(() => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    resetComposeChatRateLimitsForTest();
  });

  afterEach(async () => {
    resetComposeChatRateLimitsForTest();
    vi.unstubAllEnvs();
    await f?.db.close();
    f = null;
    mocks.sql = null;
    mocks.viewer = null;
  });

  it('allowlists GET/HEAD/POST on /api/brand-studio/compose and rejects PUT/DELETE', () => {
    expect(brandRouteAllowed('/brand/studio/compose', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'HEAD')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'PUT')).toBe(false);
    expect(brandRouteAllowed('/api/brand-studio/compose', 'DELETE')).toBe(false);
  });

  it('returns 404 when BRAND_STUDIO_V2 is off, 403 on cross-origin POST, and 401 when signed out', async () => {
    const id = randomUUID();
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    expect((await getCompose(`organizationId=${id}&source=asset&id=${id}`)).status).toBe(404);
    expect((await postCompose({ operation: 'chat.edit', input: { organizationId: id } })).status).toBe(404);

    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    expect((await getCompose(`organizationId=${id}&source=asset&id=${id}`)).status).toBe(401);
    expect(
      (
        await postCompose(
          { operation: 'chat.edit', input: { organizationId: id } },
          { origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect((await postCompose({ operation: 'chat.edit', input: { organizationId: id } })).status).toBe(401);
  });

  it.each([
    { label: `sandboxed id ${[...SANDBOXED_CLIENT_ORG_IDS][0]}`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][0] },
    { label: `sandboxed id ${[...SANDBOXED_CLIENT_ORG_IDS][1]}`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][1] },
    { label: 'named Morphic Studio', orgName: 'Morphic Studio' },
    { label: 'named 모픽 코리아', orgName: '모픽 코리아' },
  ])('returns 404 on GET and POST for $label even for organization owners', async ({ orgId, orgName }) => {
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client' });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);

    const getRes = await getCompose(`organizationId=${f.orgId}&source=asset&id=${randomUUID()}`);
    expect(getRes.status).toBe(404);
    expect(getRes.headers.get('cache-control')).toBe('private, no-store');

    const postRes = await postCompose({
      operation: 'render.reserve',
      input: { organizationId: f.orgId, requestId: 'cmp_test_morphic_1234', durationSec: 10 },
    });
    expect(postRes.status).toBe(404);
  });

  it('streams full 200 and partial 206 Range bytes for member video assets, while denying guests, outsiders, and project_only orgs with 404', async () => {
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

    mocks.viewer = viewerOf(f.ids.outsider);
    expect((await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`)).status).toBe(404);

    mocks.viewer = viewerOf(f.ids.guest);
    expect((await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`)).status).toBe(404);

    // self_studio-denied (project_only) organization gets 404 on compose stream and POST
    await f.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features, updated_by)
       values ($1, array['self_studio']::text[], $2)`,
      [f.orgId, f.ids.admin],
    );
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await getCompose(`organizationId=${f.orgId}&source=asset&id=${assetId}`)).status).toBe(404);
    expect(
      (
        await postCompose({
          operation: 'render.reserve',
          input: { organizationId: f.orgId, requestId: 'cmp_projonly_1234', durationSec: 8 },
        })
      ).status,
    ).toBe(404);

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

  it('keeps timeline/caption chat free (0 credits) while enforcing the per-minute rate limit (429)', async () => {
    f = await studioFixture({ capKrw: 10_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);

    const project = appendClip(emptyComposerProject('9:16'), {
      id: 'c1',
      label: 'Opening',
      sourceKind: 'output',
      srcUrl: '/clip1.mp4',
      durationSec: 6,
      trimStartSec: 0,
      trimEndSec: 6,
      volume: 1,
      muted: false,
    });

    // Read-only viewer cannot run chat mutations (403)
    mocks.viewer = viewerOf(f.ids.viewer);
    const viewerRes = await postCompose({
      operation: 'chat.edit',
      input: { organizationId: f.orgId, message: '1번째 컷 3초로 줄여줘', locale: 'ko', project },
    });
    expect(viewerRes.status).toBe(403);

    mocks.viewer = viewerOf(f.ids.owner);
    for (let i = 0; i < COMPOSE_CHAT_LIMIT_PER_MIN; i += 1) {
      const res = await postCompose({
        operation: 'chat.edit',
        input: { organizationId: f.orgId, message: '1번째 컷 3초로 줄여줘', locale: 'ko', project },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; kind: string; creditsUsed: number };
      expect(body).toMatchObject({ ok: true, kind: 'patches', creditsUsed: 0 });
    }

    // 21st request within the same minute hits 429 rate_limited
    const blocked = await postCompose({
      operation: 'chat.edit',
      input: { organizationId: f.orgId, message: '1번째 컷 3초로 줄여줘', locale: 'ko', project },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await blocked.json()).toMatchObject({ ok: false, code: 'rate_limited' });

    // Zero credits were charged for all 20 timeline chat turns
    const usedAfterChat = await usedKrwIn(f.sql, f.orgId, studioMonthWindow(new Date()));
    expect(usedAfterChat).toBe(0);
  });

  it('deducts TWINGS credits on 1080p final render, hides ledger rows from video studio boards, blocks exhausted allowance, and refunds 100% on export failure', async () => {
    f = await studioFixture({ capKrw: 500 }); // 50 TWINGS credits
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);

    // 10s 1080p render = 300 KRW = 30 TWINGS credits
    expect(composeFinalRenderKrw(10)).toBe(300);
    expect(composeFinalRenderCredits(10)).toBe(30);

    const reserve1 = await postCompose({
      operation: 'render.reserve',
      input: { organizationId: f.orgId, requestId: 'cmp_render_ok_0001', durationSec: 10 },
    });
    expect(reserve1.status).toBe(200);
    const body1 = (await reserve1.json()) as {
      ok: true;
      jobId: string;
      creditsUsed: number;
      allowance: { capKrw: number; usedKrw: number };
    };
    expect(body1.creditsUsed).toBe(30);
    expect(body1.allowance.usedKrw).toBe(300);

    // Ledger row counts toward memberUsage, yet never clutters jobsOf / jobsOfStudioState
    expect(await jobsOf(f.sql, f.orgId)).toHaveLength(0);
    expect(await jobsOfStudioState(f.sql, f.orgId)).toHaveLength(0);
    const usage = await memberUsage(f.sql, f.orgId);
    expect(usage[0]?.usedKrw).toBe(300);

    // Second 10s render (needs 300 KRW, only 200 KRW left) -> 409 allowance_exhausted
    const exhausted = await postCompose({
      operation: 'render.reserve',
      input: { organizationId: f.orgId, requestId: 'cmp_render_over_0002', durationSec: 10 },
    });
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toEqual({ ok: false, code: 'allowance_exhausted' });

    // Client encoding fails on first job -> render.refund restores 100% of credits immediately
    const refund = await postCompose({
      operation: 'render.refund',
      input: { organizationId: f.orgId, jobId: body1.jobId },
    });
    expect(refund.status).toBe(200);
    const refundBody = (await refund.json()) as {
      ok: true;
      refunded: boolean;
      allowance: { usedKrw: number };
    };
    expect(refundBody.refunded).toBe(true);
    expect(refundBody.allowance.usedKrw).toBe(0);
    expect(await usedKrwIn(f.sql, f.orgId, studioMonthWindow(new Date()))).toBe(0);
  });
});
