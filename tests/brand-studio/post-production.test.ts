import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import {
  applyColorGradeToCanvasContext,
  computeReinhardTransferMatrix,
  cssFilterForColorGrade,
  extractColorProfileFromRgba,
  GRADE_PRESETS,
  type ColorGradeSpec,
} from '@/lib/brand-studio/compose/color-grade';
import {
  computeRgbaHistogram,
  detectSceneCutsFromFrameSamples,
  parseFfmpegScdetOutput,
  type FrameHistogramSample,
} from '@/lib/brand-studio/compose/scene-detect';
import { studioEnv } from '@/lib/brand-studio/env';
import { memberUsage } from '@/lib/brand-studio/member-usage';
import {
  generateReferenceMusic,
  getMusicJobStatus,
  NON_COMMERCIAL_MUSIC_NOTICE_KO,
  resolveMusicProviderId,
  selectMusicProvider,
  synthesizePreviewMusicWav,
} from '@/lib/brand-studio/music';
import { jobsOf, jobsOfStudioState } from '@/lib/brand-studio/repo';
import {
  getUpscaleJobStatus,
  resolveUpscaleProviderId,
  selectUpscaleProvider,
  submitUpscaleJob,
  upscaleCredits,
} from '@/lib/brand-studio/upscale';
import { studioMonthWindow, usedKrwIn } from '@/lib/brand-studio/usage';
import { POST_PRODUCTION_OPERATIONS } from '@/app/api/brand-studio/post-production/route';
import { seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () =>
    mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));

const postProdRoute = await import('@/app/api/brand-studio/post-production/route');

const BASE = 'http://localhost:3000/api/brand-studio/post-production';
const getPostProd = (query: string, headers?: Record<string, string>) =>
  postProdRoute.GET(new NextRequest(`${BASE}?${query}`, { headers }));

const postPostProd = (body: unknown, headers?: Record<string, string>) =>
  postProdRoute.POST(
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

function makeSolidRgba(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
  return buf;
}

function makeMockCanvas2d(width: number, height: number, initialRgba: Uint8ClampedArray) {
  const backing = new Uint8ClampedArray(initialRgba);
  const ctx = {
    getImageData(sx: number, sy: number, sw: number, sh: number) {
      const sub = new Uint8ClampedArray(sw * sh * 4);
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const srcIdx = ((sy + y) * width + (sx + x)) * 4;
          const dstIdx = (y * sw + x) * 4;
          sub[dstIdx] = backing[srcIdx]!;
          sub[dstIdx + 1] = backing[srcIdx + 1]!;
          sub[dstIdx + 2] = backing[srcIdx + 2]!;
          sub[dstIdx + 3] = backing[srcIdx + 3]!;
        }
      }
      return { data: sub, width: sw, height: sh };
    },
    putImageData(imgData: { data: Uint8ClampedArray }, dx: number, dy: number) {
      // Infer sub-rect width from backing if full width, else compute from call
      const totalPx = imgData.data.length / 4;
      // We track last getImageData dims via closure
      const sw = lastReadWidth || width;
      const sh = Math.floor(totalPx / sw);
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const srcIdx = (y * sw + x) * 4;
          const dstIdx = ((dy + y) * width + (dx + x)) * 4;
          backing[dstIdx] = imgData.data[srcIdx]!;
          backing[dstIdx + 1] = imgData.data[srcIdx + 1]!;
          backing[dstIdx + 2] = imgData.data[srcIdx + 2]!;
          backing[dstIdx + 3] = imgData.data[srcIdx + 3]!;
        }
      }
    },
  };
  let lastReadWidth = width;
  const origGet = ctx.getImageData;
  ctx.getImageData = (sx: number, sy: number, sw: number, sh: number) => {
    lastReadWidth = sw;
    return origGet(sx, sy, sw, sh);
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, backing };
}

describe('1. Post-Production Route Security & Morphic Sandbox Hardlines', () => {
  let f: StudioFixture | null = null;

  beforeEach(() => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    vi.stubEnv('BRAND_STUDIO_UPSCALE_PROVIDER', 'fake');
    vi.stubEnv('BRAND_STUDIO_MUSIC_PROVIDER', 'fake');
    // Open, so the `sound` policy gate below is what refuses `music.generate` (closed is in music-generation-flag.test.ts).
    vi.stubEnv('BRAND_STUDIO_MUSIC_GENERATION', 'on');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f?.db.close();
    f = null;
    mocks.sql = null;
    mocks.viewer = null;
  });

  it('cuts.detect never invents a cut: a clip with no browser samples gets no cuts, whatever its length (E2)', async () => {
    f = await studioFixture({ capKrw: 1_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    const deps = studioDeps(f.sql);
    for (const seconds of [6, 12, 3]) {
      const assetId = await seedVideoAsset(deps, f.orgId, f.ids.owner, seconds);
      const res = await postPostProd({ operation: 'cuts.detect', input: { organizationId: f.orgId, assetId, minShotSec: 0.4 } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, cuts: [], creditsUsed: 0 });
    }
    // Real analysis input still answers with what it found.
    const scdet = '[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 32.1, lavfi.scd.time: 2.4';
    const found = await postPostProd({ operation: 'cuts.detect', input: { organizationId: f.orgId, ffmpegStderr: scdet } });
    expect(found.status).toBe(200);
    expect(((await found.json()) as { cuts: unknown[] }).cuts.length).toBe(1);
  });

  it('enforces 404 when BRAND_STUDIO_V2 is off, 403 on cross-origin POST, and 401 when signed out', async () => {
    const orgId = randomUUID();
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    expect((await getPostProd(`organizationId=${orgId}`)).status).toBe(404);
    expect(
      (await postPostProd({ operation: 'cuts.detect', input: { organizationId: orgId } })).status,
    ).toBe(404);

    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    expect((await getPostProd(`organizationId=${orgId}`)).status).toBe(401);
    expect(
      (
        await postPostProd(
          { operation: 'cuts.detect', input: { organizationId: orgId } },
          { origin: 'https://attacker.example' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await postPostProd({ operation: 'cuts.detect', input: { organizationId: orgId } })).status,
    ).toBe(401);
  });

  it.each([
    { label: `Morphic sandbox id 1 (${[...SANDBOXED_CLIENT_ORG_IDS][0]})`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][0] },
    { label: `Morphic sandbox id 2 (${[...SANDBOXED_CLIENT_ORG_IDS][1]})`, orgId: [...SANDBOXED_CLIENT_ORG_IDS][1] },
    { label: 'organization named "Morphic Studio"', orgName: 'Morphic Studio' },
    { label: 'organization named "모픽 코리아"', orgName: '모픽 코리아' },
  ])('returns 404 across GET and all 7 operations for $label and writes nothing', async ({ orgId, orgName }) => {
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client', capKrw: 2_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);

    const getRes = await getPostProd(`organizationId=${f.orgId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.headers.get('cache-control')).toBe('private, no-store');

    for (const op of POST_PRODUCTION_OPERATIONS) {
      const res = await postPostProd({
        operation: op,
        input: {
          organizationId: f.orgId,
          requestId: 'pp_morphic_test_1234',
          jobId: randomUUID(),
          sourceUrl: 'https://example.test/clip.mp4',
          durationSec: 10,
        },
      });
      expect(res.status, op).toBe(404);
      const body = (await res.json()) as { ok: boolean; code: string };
      expect(['feature_unavailable', 'not_found']).toContain(body.code);
    }

    // Even an unknown operation for a sandboxed org gets 404 (learns nothing)
    const malformed = await postPostProd({
      operation: 'unknown.op',
      input: { organizationId: f.orgId },
    });
    expect(malformed.status).toBe(404);

    const jobCount = (
      await f.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_jobs')
    ).rows[0]!.n;
    expect(jobCount).toBe(0);
  });

  it('denies generative_media/self_studio blocked orgs and guests with 404, viewers with 403 on mutations, and enforces color_grading/sound feature gates', async () => {
    f = await studioFixture({ capKrw: 1_000_000 });
    mocks.sql = f.sql;

    // Guest gets 404
    mocks.viewer = viewerOf(f.ids.guest);
    expect((await getPostProd(`organizationId=${f.orgId}`)).status).toBe(404);
    expect(
      (
        await postPostProd({
          operation: 'cuts.detect',
          input: { organizationId: f.orgId, samples: [] },
        })
      ).status,
    ).toBe(404);

    // Read-only viewer gets 200 on GET (canCreate: false) and 403 on POST mutations
    mocks.viewer = viewerOf(f.ids.viewer);
    const viewerGet = await getPostProd(`organizationId=${f.orgId}`);
    expect(viewerGet.status).toBe(200);
    expect(await viewerGet.json()).toMatchObject({ ok: true, canCreate: false });

    expect(
      (
        await postPostProd({
          operation: 'upscale.submit',
          input: {
            organizationId: f.orgId,
            requestId: 'pp_viewer_block_01',
            sourceUrl: 'https://example.test/a.mp4',
            resolution: 1080,
          },
        })
      ).status,
    ).toBe(403);

    // Feature policies: deny `generative_media` -> 404 everywhere
    mocks.viewer = viewerOf(f.ids.owner);
    await f.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features, updated_by)
       values ($1, array['generative_media']::text[], $2)`,
      [f.orgId, f.ids.admin],
    );
    expect((await getPostProd(`organizationId=${f.orgId}`)).status).toBe(404);

    // Deny only `color_grading` and `sound` -> `cuts.detect` works (200), `grade.analyze` and `music.generate` get 404
    await f.sql.query(
      `update brand_feature_policies set denied_features = array['color_grading', 'sound']::text[]
        where organization_id = $1`,
      [f.orgId],
    );
    expect(
      (
        await postPostProd({
          operation: 'cuts.detect',
          input: { organizationId: f.orgId, samples: [] },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postPostProd({
          operation: 'grade.analyze',
          input: { organizationId: f.orgId, presetId: 'twings-french-blue' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await postPostProd({
          operation: 'music.generate',
          input: { organizationId: f.orgId, requestId: 'pp_sound_denied_01', durationSec: 12 },
        })
      ).status,
    ).toBe(404);
  });
});

describe('2. Scene-Cut Detection (`scene-detect.ts`)', () => {
  it('computes normalized RGB histograms + BT.709 luma and detects multi-shot cuts with minShotSec suppression', () => {
    const darkBlue = makeSolidRgba(16, 16, 15, 30, 180);
    const warmAmber = makeSolidRgba(16, 16, 235, 165, 30);
    const brightWhite = makeSolidRgba(16, 16, 240, 245, 250);

    const hBlue = computeRgbaHistogram(darkBlue, 8);
    const hAmber = computeRgbaHistogram(warmAmber, 8);
    const hWhite = computeRgbaHistogram(brightWhite, 8);

    expect(hBlue.hist).toHaveLength(24);
    expect(hBlue.hist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(hWhite.lumaMean).toBeGreaterThan(hBlue.lumaMean);

    // 25 samples @ 0.2s (0.0s .. 4.8s): Shot 1 [0..1.2), Cut @ 1.2s, Flash jitter @ 1.4s, Shot 2 [1.4..3.0), Cut @ 3.0s
    const samples: FrameHistogramSample[] = [];
    for (let i = 0; i < 25; i += 1) {
      const timeSec = Number((i * 0.2).toFixed(2));
      const src = timeSec < 1.2 ? hBlue : timeSec < 3.0 ? hAmber : hWhite;
      samples.push({
        timeSec,
        hist: src.hist,
        lumaMean: src.lumaMean,
        motionDelta: timeSec === 1.2 || timeSec === 3.0 ? 0.65 : 0.02,
      });
    }

    const cuts = detectSceneCutsFromFrameSamples(samples, { minShotSec: 0.6 });
    expect(cuts.map((c) => c.timeSec)).toEqual([1.2, 3.0]);
    expect(cuts.every((c) => c.confidence >= 0.5 && c.delta >= 0.22)).toBe(true);

    // Steady clip produces zero cuts
    const steady = samples.map((s) => ({ ...s, hist: hBlue.hist, lumaMean: hBlue.lumaMean, motionDelta: 0.01 }));
    expect(detectSceneCutsFromFrameSamples(steady)).toEqual([]);
  });

  it('parses FFmpeg scdet stderr output and enforces minShotSec', () => {
    const stderr = [
      '[Parsed_scdet_0 @ 0x7f8] lavfi.scd.score: 18.42, lavfi.scd.time: 0.25', // before minShotSec (0.6s) -> ignored
      '[Parsed_scdet_0 @ 0x7f8] lavfi.scd.score: 22.80, lavfi.scd.time: 1.84',
      '[Parsed_scdet_0 @ 0x7f8] lavfi.scd.score: 14.10, lavfi.scd.time: 2.12', // within 0.6s of 1.84 with lower score -> suppressed
      'lavfi.scd.score=31.5',
      'lavfi.scd.time=4.56',
    ].join('\n');

    const cuts = parseFfmpegScdetOutput(stderr, 0.6);
    expect(cuts.map((c) => c.timeSec)).toEqual([1.8, 4.6]);
    expect(cuts[1]!.confidence).toBeGreaterThan(cuts[0]!.confidence);
  });
});

describe('3. Reference Color Grading & Scoped Canvas Engine (`color-grade.ts`)', () => {
  it('exposes 6 vendor-clean presets, extracts color profiles, builds Reinhard matrices, and formats CSS filters', () => {
    expect(GRADE_PRESETS.map((p) => p.id)).toEqual([
      'twings-french-blue',
      'clean-high-key',
      'editorial-cool-porcelain',
      'kodak-2383-warm',
      'moody-teal-amber',
      'pastel-airy-film',
    ]);
    for (const preset of GRADE_PRESETS) {
      const combined = `${preset.titleKo} ${preset.titleEn}`;
      expect(combined).not.toMatch(/ComfyUI|YAGI-SERVER|YuE2|Supabase|Slack|Kodak/i);
    }

    const coolPixels = makeSolidRgba(8, 8, 40, 90, 210);
    const warmPixels = makeSolidRgba(8, 8, 220, 140, 50);

    const coolProfile = extractColorProfileFromRgba(coolPixels);
    const warmProfile = extractColorProfileFromRgba(warmPixels);
    expect(warmProfile.warmth).toBeGreaterThan(0.2);
    expect(coolProfile.warmth).toBeLessThan(-0.2);

    const identity = computeReinhardTransferMatrix(coolProfile, warmProfile, 0);
    expect(identity).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);

    const activeMatrix = computeReinhardTransferMatrix(coolProfile, warmProfile, 0.9);
    expect(activeMatrix).toHaveLength(20);
    expect(activeMatrix[4]).toBeGreaterThan(0); // positive red offset toward warm reference
    expect(activeMatrix[14]).toBeLessThan(0);   // negative blue offset toward warm reference

    const spec: ColorGradeSpec = {
      enabled: true,
      scope: 'full_timeline',
      presetId: 'twings-french-blue',
      referenceProfile: warmProfile,
      intensity: 0.8,
      skinProtect: 0.7,
      halation: 0.04,
      grain: 1.5,
    };
    const css = cssFilterForColorGrade(spec);
    expect(css).toContain('brightness(');
    expect(css).toContain('contrast(');
    expect(css).toContain('saturate(');
    expect(cssFilterForColorGrade({ ...spec, enabled: false })).toBe('none');
  });

  it('enforces selected_clip, full_timeline, and feathered region scoping plus 15..45 deg skin protection on Canvas2D', () => {
    const width = 40;
    const height = 40;
    const neutralGray = makeSolidRgba(width, height, 128, 128, 128);
    const warmRef = extractColorProfileFromRgba(makeSolidRgba(8, 8, 230, 120, 40));

    // A) selected_clip when isSelectedClip === false -> untouched
    const unselected = makeMockCanvas2d(width, height, neutralGray);
    applyColorGradeToCanvasContext(
      unselected.ctx,
      width,
      height,
      {
        enabled: true,
        scope: 'selected_clip',
        presetId: 'kodak-2383-warm',
        referenceProfile: warmRef,
        intensity: 1,
        skinProtect: 0,
        halation: 0,
        grain: 0,
      },
      false,
    );
    expect(unselected.backing[0]).toBe(128);
    expect(unselected.backing[2]).toBe(128);

    // B) region scope ({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }) -> outside (2,2) untouched, center (20,20) graded
    const regional = makeMockCanvas2d(width, height, neutralGray);
    applyColorGradeToCanvasContext(
      regional.ctx,
      width,
      height,
      {
        enabled: true,
        scope: 'region',
        region: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
        presetId: 'kodak-2383-warm',
        referenceProfile: warmRef,
        intensity: 1,
        skinProtect: 0,
        halation: 0,
        grain: 0,
      },
      true,
    );
    const outsideIdx = (2 * width + 2) * 4;
    const centerIdx = (20 * width + 20) * 4;
    expect(regional.backing[outsideIdx]).toBe(128);
    expect(regional.backing[outsideIdx + 2]).toBe(128);
    expect(regional.backing[centerIdx]!).toBeGreaterThan(145);
    expect(regional.backing[centerIdx + 2]!).toBeLessThan(115);

    // C) Skin-hue protection (28 deg warm skin RGB = 215, 162, 132) resists heavy cool-blue transfer
    const skinPixels = makeSolidRgba(12, 12, 215, 162, 132);
    const coolRef = extractColorProfileFromRgba(makeSolidRgba(8, 8, 40, 100, 235));

    const unprotected = makeMockCanvas2d(12, 12, skinPixels);
    applyColorGradeToCanvasContext(
      unprotected.ctx,
      12,
      12,
      {
        enabled: true,
        scope: 'full_timeline',
        referenceProfile: coolRef,
        intensity: 1,
        skinProtect: 0,
        halation: 0,
        grain: 0,
      },
      false,
    );

    const protectedSkin = makeMockCanvas2d(12, 12, skinPixels);
    applyColorGradeToCanvasContext(
      protectedSkin.ctx,
      12,
      12,
      {
        enabled: true,
        scope: 'full_timeline',
        referenceProfile: coolRef,
        intensity: 1,
        skinProtect: 1,
        halation: 0,
        grain: 0,
      },
      false,
    );

    const shiftUnprotected = Math.abs(unprotected.backing[0]! - 215) + Math.abs(unprotected.backing[2]! - 132);
    const shiftProtected = Math.abs(protectedSkin.backing[0]! - 215) + Math.abs(protectedSkin.backing[2]! - 132);
    expect(shiftProtected).toBeLessThan(shiftUnprotected * 0.4);
  });

  it('serves grade.analyze and grade.master through POST /api/brand-studio/post-production', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    const fix = await studioFixture({ capKrw: 100_000 });
    mocks.sql = fix.sql;
    mocks.viewer = viewerOf(fix.ids.owner);
    try {
      const analyzeRes = await postPostProd({
        operation: 'grade.analyze',
        input: {
          organizationId: fix.orgId,
          rgba: [220, 150, 60, 255, 210, 145, 55, 255],
          presetId: 'kodak-2383-warm',
          scope: 'region',
          region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
          intensity: 0.85,
        },
      });
      expect(analyzeRes.status).toBe(200);
      const analyzeBody = (await analyzeRes.json()) as {
        ok: true;
        transferMatrix: number[];
        cssFilter: string;
        spec: ColorGradeSpec;
      };
      expect(analyzeBody.transferMatrix).toHaveLength(20);
      expect(analyzeBody.spec.scope).toBe('region');
      expect(analyzeBody.cssFilter).toContain('contrast(');

      const masterRes = await postPostProd({
        operation: 'grade.master',
        input: {
          organizationId: fix.orgId,
          presetId: 'twings-french-blue',
          scope: 'selected_clip',
          targetClipId: 'clip_01',
        },
      });
      expect(masterRes.status).toBe(200);
      const masterBody = (await masterRes.json()) as {
        ok: true;
        id: string;
        masterSpec: { videoFilter: string };
      };
      expect(masterBody.id).toBe('twings-french-blue');
      expect(masterBody.masterSpec.videoFilter).toContain('lut3d=');
    } finally {
      await fix.db.close();
      mocks.sql = null;
      mocks.viewer = null;
      vi.unstubAllEnvs();
    }
  });
});

describe('4. SeedVR2 Pluggable Upscale Engine (`upscale/*`)', () => {
  let f: StudioFixture | null = null;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    f = await studioFixture({ capKrw: 2_500 }); // 250 TWINGS credits
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f?.db.close();
    f = null;
  });

  it('prices image/video 1080/1440/2160 credits, splits 4K clips at shot boundaries, hides ledger rows from boards, and refunds 100% on failure', async () => {
    expect(upscaleCredits(1080, 0, 'image')).toBe(8);
    expect(upscaleCredits(1440, 0, 'image')).toBe(12);
    expect(upscaleCredits(2160, 0, 'image')).toBe(18);
    expect(upscaleCredits(1080, 10, 'video')).toBe(35);
    expect(upscaleCredits(1440, 10, 'video')).toBe(55);
    expect(upscaleCredits(2160, 16, 'video')).toBe(120);

    const deps = studioDeps(f!.sql);
    const vidAssetId = await seedVideoAsset(deps, f!.orgId, f!.ids.owner, 16);
    const imgAssetId = await seedImageAsset(deps, f!.orgId, f!.ids.owner);

    // 1) 1440p image upscale (12 credits = 120 KRW)
    const imgRes = await submitUpscaleJob(
      deps,
      viewerOf(f!.ids.owner),
      {
        organizationId: f!.orgId,
        requestId: 'upscale_img_1440_01',
        assetId: imgAssetId,
        kind: 'image',
        resolution: 1440,
      },
      { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } },
    );
    expect(imgRes.ok).toBe(true);
    if (!imgRes.ok) throw new Error('expected success');
    expect(imgRes.creditsUsed).toBe(12);
    expect(imgRes.requiresSplit).toBe(false);
    expect(imgRes.outputUrl).toBeTruthy();

    // 2) 4K 2160p 16s video upscale with shot cuts -> splits into <=8s shot-aligned segments (120 credits = 1,200 KRW)
    const vid4k = await submitUpscaleJob(
      deps,
      viewerOf(f!.ids.owner),
      {
        organizationId: f!.orgId,
        requestId: 'upscale_vid_2160_02',
        assetId: vidAssetId,
        kind: 'video',
        resolution: 2160,
        durationSec: 16,
        shotCutSeconds: [5.4, 11.2],
      },
      { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } },
    );
    expect(vid4k.ok).toBe(true);
    if (!vid4k.ok) throw new Error('expected 4K success');
    expect(vid4k.requiresSplit).toBe(true);
    expect(vid4k.segments.map((s) => [s.startSec, s.endSec])).toEqual([
      [0, 5.4],
      [5.4, 11.2],
      [11.2, 16],
    ]);
    expect(vid4k.seedVr2Config.ditModel).toBe('seedvr2_ema_7b_fp16.safetensors');
    expect(vid4k.seedVr2Config.batchSize).toBe(21);
    expect(vid4k.seedVr2Config.colorCorrection).toBe('lab');
    expect(vid4k.creditsUsed).toBe(120);

    // Total used so far: 120 + 1,200 = 1,320 KRW; studio state boards remain uncluttered
    expect(await usedKrwIn(f!.sql, f!.orgId, studioMonthWindow(new Date()))).toBe(1320);
    expect(await jobsOf(f!.sql, f!.orgId)).toHaveLength(0);
    expect(await jobsOfStudioState(f!.sql, f!.orgId)).toHaveLength(0);
    expect((await memberUsage(f!.sql, f!.orgId))[0]?.usedKrw).toBe(1320);

    // 3) Provider failure triggers immediate 100% automatic credit refund (usedKrw stays 1,320!)
    const failedRun = await submitUpscaleJob(
      deps,
      viewerOf(f!.ids.owner),
      {
        organizationId: f!.orgId,
        requestId: 'upscale_fail_refund_03',
        assetId: vidAssetId,
        kind: 'video',
        resolution: 1080,
        durationSec: 10,
      },
      {
        env: {
          BRAND_STUDIO_UPSCALE_PROVIDER: 'fake',
          BRAND_STUDIO_UPSCALE_FAKE_FAIL: '1',
        },
      },
    );
    expect(failedRun).toMatchObject({
      ok: false,
      code: 'provider_unavailable',
      refunded: true,
      allowance: { usedKrw: 1320 },
    });
    expect(await usedKrwIn(f!.sql, f!.orgId, studioMonthWindow(new Date()))).toBe(1320);
  });

  it('auto-selects comfyui_cloud / external_api / fake from env and polls async upscale tasks to completion', async () => {
    expect(resolveUpscaleProviderId({ BRAND_STUDIO_UPSCALE_API_URL: 'https://upscale.example/v1' })).toBe(
      'external_api',
    );
    expect(resolveUpscaleProviderId({ COMFYUI_CLOUD_URL: 'https://cloud-comfy.example' })).toBe(
      'comfyui_cloud',
    );
    expect(
      resolveUpscaleProviderId({
        YAGI_PRODUCTION_URL: 'https://prod.example',
        YAGI_PROD_TOKEN: 'tok_123',
      }),
    ).toBe('yagi_production');
    expect(resolveUpscaleProviderId({ BRAND_STUDIO_PROVIDER: 'fake' })).toBe('fake');

    const deps = studioDeps(f!.sql);
    const calls: string[] = [];
    const mockFetch: typeof fetch = (async (url: string | URL | Request) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith('/api/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'cloud_task_99' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/jobs/cloud_task_99')) {
        return new Response(
          JSON.stringify({ status: 'completed', output_url: 'https://cdn.example/out_1080.mp4' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }) as typeof fetch;

    const cloudEnv = {
      COMFYUI_CLOUD_URL: 'https://cloud-comfy.example',
      COMFYUI_CLOUD_API_KEY: 'key_test',
    };
    const provider = selectUpscaleProvider(cloudEnv, { fetchImpl: mockFetch });
    expect(provider.id).toBe('comfyui_cloud');

    const submitted = await submitUpscaleJob(
      deps,
      viewerOf(f!.ids.owner),
      {
        organizationId: f!.orgId,
        requestId: 'upscale_cloud_async_01',
        sourceUrl: 'https://cdn.example/src.mp4',
        kind: 'video',
        resolution: 1080,
        durationSec: 6,
      },
      { env: cloudEnv, fetchImpl: mockFetch, provider },
    );
    expect(submitted).toMatchObject({ ok: true, status: 'running' });
    if (!submitted.ok) throw new Error('expected running');

    const polled = await getUpscaleJobStatus(
      deps,
      viewerOf(f!.ids.owner),
      { organizationId: f!.orgId, jobId: submitted.jobId },
      { env: cloudEnv, fetchImpl: mockFetch, provider },
    );
    expect(polled).toMatchObject({ ok: true, status: 'succeeded' });
    if (polled.ok) {
      expect(polled.outputUrl).toContain('/api/brand-studio/media/st/');
    }
    expect(calls.some((u) => u.includes('/api/prompt'))).toBe(true);
    expect(calls.some((u) => u.includes('/api/jobs/cloud_task_99'))).toBe(true);
  });
});

describe('5. Reference Music Engine, 0ms Drop Sync, WAV Synth & License Gate (`music/*`)', () => {
  let f: StudioFixture | null = null;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    vi.stubEnv('BRAND_STUDIO_MUSIC_PROVIDER', 'fake');
    vi.stubEnv('BRAND_STUDIO_MUSIC_GENERATION', 'on');
    f = await studioFixture({ capKrw: 5_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f?.db.close();
    f = null;
  });

  it('synthesizes playable 16-bit RIFF WAVE with Pre-Drop Hush + 0ms drop at revealSec and enforces CC BY-NC customer-safe notice', async () => {
    // Verify PCM hush & 0ms drop physics directly on synthesized WAV
    const synth = synthesizePreviewMusicWav({
      bpm: 122,
      keySignature: 'Dm',
      durationSec: 8,
      revealSec: 3.2,
      preDropHushMs: 200,
      sampleRate: 16_000,
    });
    expect(Buffer.from(synth.bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(synth.bytes.subarray(8, 12)).toString('ascii')).toBe('WAVE');
    expect(synth.dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(synth.peakAmplitude).toBeLessThanOrEqual(0.9);

    const pcmView = new DataView(synth.bytes.buffer);
    // Mid-hush sample (right before 3.2s reveal) must be silent
    const midHushSample = Math.floor((synth.hushStartSampleIndex + synth.dropSampleIndex) / 2) + 500;
    expect(Math.abs(pcmView.getInt16(44 + midHushSample * 2, true))).toBeLessThan(100);

    // Peak energy within first 30ms of 0ms drop at revealSec must be crisp & strong
    let dropBurstPeak = 0;
    for (let k = 0; k < Math.round(0.03 * synth.sampleRate); k += 1) {
      const amp = Math.abs(pcmView.getInt16(44 + (synth.dropSampleIndex + k) * 2, true));
      if (amp > dropBurstPeak) dropBurstPeak = amp;
    }
    expect(dropBurstPeak).toBeGreaterThan(8000);

    // Route end-to-end test with `ref_audio` + `revealSec`
    const res = await postPostProd({
      operation: 'music.generate',
      input: {
        organizationId: f!.orgId,
        requestId: 'music_ref_guide_0001',
        prompt: 'sleek architectural fashion film',
        bpm: 124,
        keySignature: 'Am',
        durationSec: 12,
        revealSec: 3.8,
        ref_audio: { url: 'https://example.test/ref-groove.mp3', label: 'Ref Groove' },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      status: string;
      hasReferenceAudio: boolean;
      nonCommercialOnly: boolean;
      commercialAllowed: boolean;
      licenseNoticeKo: string;
      licenseNoticeEn: string;
      dropSync: { valid: boolean; alignedOffsetMs: number; videoRevealSec: number };
      abcScore: { valid: boolean; unitNoteLength: string };
      audioUrl: string;
      dataUrl: string;
    };

    expect(body.ok).toBe(true);
    expect(body.status).toBe('succeeded');
    expect(body.hasReferenceAudio).toBe(true);
    expect(body.nonCommercialOnly).toBe(true);
    expect(body.commercialAllowed).toBe(false);
    expect(body.licenseNoticeKo).toBe(NON_COMMERCIAL_MUSIC_NOTICE_KO);
    expect(body.licenseNoticeKo).toBe(
      '비상업 시안·가이드 전용 음원이에요 (상업 광고 집행 시 라이선스 음원으로 교체해 주세요)',
    );
    // Customer-visible notices contain zero internal tool/server names
    expect(`${body.licenseNoticeKo} ${body.licenseNoticeEn}`).not.toMatch(
      /YuE2|SheetSage|YAGI-SERVER|gpu-arbiter|ComfyUI|Supabase|Slack/i,
    );
    expect(body.dropSync).toMatchObject({
      valid: true,
      alignedOffsetMs: 0,
      videoRevealSec: 3.8,
    });
    expect(body.abcScore).toMatchObject({ valid: true, unitNoteLength: '1/32' });
    expect(body.audioUrl).toContain('/api/brand-studio/media/st/');
    expect(body.dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
  });

  it('wires commercial Suno HTTP adapter (`commercialAllowed: true`) and refunds 100% on API failure', async () => {
    expect(
      resolveMusicProviderId({
        SUNO_API_URL: 'https://suno-gateway.example/v1',
        SUNO_API_KEY: 'suno_secret',
      }),
    ).toBe('suno');
    expect(resolveMusicProviderId({ ELEVENLABS_API_KEY: 'el_secret' })).toBe('elevenlabs');

    const deps = studioDeps(f!.sql, {
      env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_STUDIO_MUSIC_GENERATION: 'on' }),
    });
    let capturedBody: Record<string, unknown> | null = null;
    const sunoFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/generate')) {
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ id: 'suno_job_1', status: 'complete', audio_url: 'https://cdn.example/suno.mp3' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    }) as typeof fetch;

    const sunoEnv = {
      BRAND_STUDIO_MUSIC_PROVIDER: 'suno',
      SUNO_API_URL: 'https://suno-gateway.example/v1',
      SUNO_API_KEY: 'suno_secret',
    };
    const sunoProvider = selectMusicProvider(sunoEnv, { fetchImpl: sunoFetch });
    const commercial = await generateReferenceMusic(
      deps,
      viewerOf(f!.ids.owner),
      {
        organizationId: f!.orgId,
        requestId: 'music_suno_comm_01',
        bpm: 120,
        keySignature: 'Dm',
        durationSec: 15,
        revealSec: 4.0,
        refAudioUrl: 'https://cdn.example/ref.wav',
      },
      { env: sunoEnv, fetchImpl: sunoFetch, provider: sunoProvider },
    );

    expect(commercial).toMatchObject({
      ok: true,
      status: 'succeeded',
      commercialAllowed: true,
      nonCommercialOnly: false,
      hasReferenceAudio: true,
    });
    expect(capturedBody).toMatchObject({
      instrumental: true,
      bpm: 120,
      ref_audio_url: 'https://cdn.example/ref.wav',
    });

    const usedAfterSuccess = await usedKrwIn(f!.sql, f!.orgId, studioMonthWindow(new Date()));
    expect(usedAfterSuccess).toBeGreaterThan(0);

    // Failing Suno call refunds 100% of credits immediately
    const failingFetch: typeof fetch = (async () =>
      new Response('upstream down', { status: 503 })) as typeof fetch;
    const failingProvider = selectMusicProvider(sunoEnv, { fetchImpl: failingFetch });
    const failed = await generateReferenceMusic(
      deps,
      viewerOf(f!.ids.owner),
      {
        organizationId: f!.orgId,
        requestId: 'music_suno_fail_02',
        durationSec: 15,
      },
      { env: sunoEnv, fetchImpl: failingFetch, provider: failingProvider },
    );
    expect(failed).toMatchObject({
      ok: false,
      code: 'provider_unavailable',
      refunded: true,
      allowance: { usedKrw: usedAfterSuccess },
    });

    // Polling status on the succeeded job works too
    if (commercial.ok) {
      const statusCheck = await getMusicJobStatus(deps, viewerOf(f!.ids.owner), {
        organizationId: f!.orgId,
        jobId: commercial.jobId,
      });
      expect(statusCheck).toMatchObject({ ok: true, status: 'succeeded', commercialAllowed: true });
    }
  });
});

describe('6. Zero Prohibited Platform References Across Post-Production Modules', () => {
  const files = [
    'lib/brand-studio/compose/scene-detect.ts',
    'lib/brand-studio/compose/color-grade.ts',
    'lib/brand-studio/continuity/contracts.ts',
    'lib/brand-studio/continuity/frame-picker.ts',
    'lib/brand-studio/continuity/planner.ts',
    'lib/brand-studio/continuity/index.ts',
    'lib/brand-studio/upscale/contracts.ts',
    'lib/brand-studio/upscale/provider.ts',
    'lib/brand-studio/upscale/service.ts',
    'lib/brand-studio/upscale/index.ts',
    'lib/brand-studio/music/contracts.ts',
    'lib/brand-studio/music/provider.ts',
    'lib/brand-studio/music/synth.ts',
    'lib/brand-studio/music/service.ts',
    'lib/brand-studio/music/sfx.ts',
    'lib/brand-studio/music/index.ts',
    'app/api/brand-studio/post-production/route.ts',
  ];

  it('contains zero Higgsfield references or client-unsafe imports in browser compose modules', () => {
    const bannedPattern = new RegExp(['higgs', 'field'].join(''), 'i');
    for (const rel of files) {
      const content = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(content, rel).not.toMatch(bannedPattern);
    }

    // Client-safe compose modules must have zero Node or DB imports
    for (const clientRel of [
      'lib/brand-studio/compose/scene-detect.ts',
      'lib/brand-studio/compose/color-grade.ts',
      'lib/brand-studio/continuity/contracts.ts',
      'lib/brand-studio/continuity/frame-picker.ts',
    ]) {
      const src = readFileSync(resolve(process.cwd(), clientRel), 'utf8');
      expect(src, clientRel).not.toMatch(
        /(?:from\s+['"](?:node:|@\/lib\/db|pg|sharp|@electric-sql\/pglite)|require\s*\()/,
      );
    }
  });
});
