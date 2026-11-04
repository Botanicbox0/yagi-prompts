import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  BrandLookDefaultsSchema,
  DEFAULT_BRAND_LOOK_DEFAULTS,
  DEFAULT_IG_REELS_MASTER_CONFIG,
  DEFAULT_SEEDVR2_UPSCALE_CONFIG,
  LookProfileSchema,
  PRESET_BRAND_LOOKS,
  SeedVr2UpscaleConfigSchema,
  WORKSTATION_PROVIDER,
  buildActiveGradeFilterChain,
  buildIgReelsMasterArgs,
  buildLocalFixPrompt,
  checkWebDeliveryBudget,
  computeColorLevelsParams,
  computeLocalCropBox,
  computeLookDistance,
  createWorkstationFinishTask,
  evaluateCyanToFrenchBlueGrade,
  evaluateEccAlignment,
  planUpscaleSegments,
  prepareBrandColorGradeSpec,
  prepareBrandLocalFixPlan,
  resolveFinishWorkerFallback,
  validateFeatherMask,
  verifyLocalFixComposite
} from '@/lib/brands/finish';

const adminId = randomUUID();
const ownerId = randomUUID();

const makeViewer = (userId: string, isAdmin = false): Viewer => ({
  userId,
  isAdmin,
  tier: isAdmin ? 'admin' : 'free',
  email: `${userId}@example.test`,
  locale: 'ko'
});

const admin = makeViewer(adminId, true);
const owner = makeViewer(ownerId);

let db: PGlite;
let sql: SqlRunner;
let orgId: string;

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId]) {
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`
    });
  }
  const orgRes = await createStudioOrganization({ sql }, admin, {
    name: 'Finish pipeline fixture',
    requestId: randomUUID()
  });
  if (!orgRes.ok) throw Error(orgRes.code);
  orgId = orgRes.id;
  await sql.query(
    "insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')",
    [orgId, ownerId]
  );
});

afterEach(async () => {
  await db?.close();
});

describe('S4 colour grading & deterministic look matching', () => {
  it('validates 8-field BrandLookDefaults, presets, look distance, and active 5-stage FFmpeg chain', () => {
    expect(DEFAULT_BRAND_LOOK_DEFAULTS).toEqual({
      auto_levels: true,
      target_black_ire: 1.5,
      target_white_ire: 97.5,
      max_black_shift: 0.06,
      max_white_gain: 1.12,
      luma_micro_contrast: 0.45,
      halation_strength: 0.045,
      grain_strength: 2.2
    });
    expect(BrandLookDefaultsSchema.safeParse(DEFAULT_BRAND_LOOK_DEFAULTS).success).toBe(true);
    expect(Object.keys(PRESET_BRAND_LOOKS)).toContain('twings-french-blue');

    const refProfile = LookProfileSchema.parse({
      luma: {
        p1: 1.5,
        p5: 8,
        p10: 15,
        p25: 32,
        p50: 54,
        p75: 76,
        p90: 89,
        p95: 94,
        p99: 97.5,
        std: 22,
        dynamic_range: 96
      },
      zones: {
        shadows: {
          l_mean: 18,
          a_mean: -1.2,
          b_mean: -4.5,
          rgb_mean: [0.14, 0.16, 0.2],
          weight_share: 0.25
        },
        midtones: {
          l_mean: 54,
          a_mean: -0.5,
          b_mean: -6.2,
          rgb_mean: [0.48, 0.52, 0.58],
          weight_share: 0.5
        },
        highlights: {
          l_mean: 88,
          a_mean: 0.2,
          b_mean: -2.0,
          rgb_mean: [0.88, 0.89, 0.92],
          weight_share: 0.25
        }
      },
      density_slope: 1.05,
      mid_chroma: 14.5,
      saturation_pct: 28,
      skin_share: 0.12,
      texture: { laplacian_std: 8.4, high_freq_energy: 0.32 }
    });

    const ungradedSource = LookProfileSchema.parse({
      ...refProfile,
      luma: { ...refProfile.luma, p50: 46, dynamic_range: 84 },
      zones: {
        ...refProfile.zones,
        midtones: { ...refProfile.zones.midtones, a_mean: 4.0, b_mean: 5.5 }
      },
      mid_chroma: 19.0
    });

    const gradedAfter = LookProfileSchema.parse({
      ...refProfile,
      luma: { ...refProfile.luma, p50: 53.2, dynamic_range: 95 },
      zones: {
        ...refProfile.zones,
        midtones: { ...refProfile.zones.midtones, a_mean: -0.3, b_mean: -5.8 }
      },
      mid_chroma: 14.8
    });

    const dist = computeLookDistance(ungradedSource, refProfile, gradedAfter);
    expect(dist.improved).toBe(true);
    expect(dist.after!.compositeScore).toBeLessThan(dist.before.compositeScore);

    const levels = computeColorLevelsParams({ p1: 5.0, p99: 90.0 });
    expect(levels.rimin).toBeLessThanOrEqual(0.06);
    expect(levels.rimax).toBeGreaterThanOrEqual(Number((1 / 1.12).toFixed(4)));

    const chain = buildActiveGradeFilterChain({
      lutPath: PRESET_BRAND_LOOKS['twings-french-blue'].lutKey,
      levels
    });
    expect(chain.videoFilter).toContain('colorlevels=');
    expect(chain.videoFilter).toContain('interp=tetrahedral');
    expect(chain.videoFilter).toContain('format=gbrp,split[base][hi]');
    expect(chain.videoFilter).toContain('unsharp=5:5:0.45:5:5:0.0');
    expect(chain.videoFilter).toContain('noise=c0s=2.2:c0f=t+u');
  });

  it('enforces cyan-to-French-Blue hue-band rules and blocks global hue rotation into green', () => {
    const valid = evaluateCyanToFrenchBlueGrade({
      sourceHueBandDeg: [170, 205],
      targetHueBandDeg: [200, 220],
      protectsRedAndSkinHues: true,
      greenPixelRatioBefore: 0.005,
      greenPixelRatioAfter: 0.005
    });
    expect(valid.valid).toBe(true);

    const badGlobalRotation = evaluateCyanToFrenchBlueGrade({
      sourceHueBandDeg: [0, 360],
      targetHueBandDeg: [200, 220],
      protectsRedAndSkinHues: false,
      greenPixelRatioBefore: 0.004,
      greenPixelRatioAfter: 0.085
    });
    expect(badGlobalRotation.valid).toBe(false);
    expect(badGlobalRotation.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces color_grading feature policy in prepareBrandColorGradeSpec', async () => {
    const okRes = await prepareBrandColorGradeSpec({ sql }, owner, {
      organizationId: orgId,
      presetId: 'twings-french-blue'
    });
    expect(okRes.ok).toBe(true);

    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['color_grading'],
      expectedRevision: 0
    });

    const deniedRes = await prepareBrandColorGradeSpec({ sql }, owner, {
      organizationId: orgId,
      presetId: 'twings-french-blue'
    });
    expect(deniedRes).toEqual({ ok: false, code: 'feature_unavailable' });
  });
});

describe('S4 partial edit / local fix 5-step pipeline', () => {
  it('computes 1440px crop upscale and rejects out-of-bounds boxes (Step 1)', () => {
    const crop = computeLocalCropBox({
      imageWidth: 2048,
      imageHeight: 2560,
      box: { x: 800, y: 1000, width: 180, height: 180 },
      paddingRatio: 0,
      targetCanvasPx: 1440
    });
    expect(crop.ok).toBe(true);
    if (crop.ok) {
      expect(crop.plan.canvasWidth).toBe(1440);
      expect(crop.plan.scaleFactor).toBeGreaterThan(4);
    }

    const outOfBounds = computeLocalCropBox({
      imageWidth: 1000,
      imageHeight: 1000,
      box: { x: 900, y: 900, width: 200, height: 200 }
    });
    expect(outOfBounds).toMatchObject({ ok: false, code: 'out_of_bounds' });
  });

  it('enforces preserve-first prompts and rejects full_product_photo for logo_mark (Step 2)', () => {
    const rejectedLogo = buildLocalFixPrompt({
      fixKind: 'logo_mark',
      referenceKind: 'full_product_photo',
      targetDescription: '가슴 로고 마크'
    });
    expect(rejectedLogo).toMatchObject({
      ok: false,
      code: 'full_product_photo_forbidden_for_logo'
    });

    const validLogo = buildLocalFixPrompt({
      fixKind: 'logo_mark',
      referenceKind: 'mark_only',
      targetDescription: '가슴 로고 마크',
      locale: 'ko'
    });
    expect(validLogo.ok).toBe(true);
    if (validLogo.ok) {
      expect(validLogo.prompt).toMatch(
        /^이미지 1의 프레임·크기·위치·배경 질감·모든 요소는 픽셀 그대로 유지하고/
      );
      expect(validLogo.prompt).toContain('로고·마크의 형태와 획 비례만');
    }

    const skinPrompt = buildLocalFixPrompt({
      fixKind: 'skin_texture',
      referenceKind: 'consented_identity',
      targetDescription: '볼과 콧등 피부 결'
    });
    expect(skinPrompt.ok).toBe(true);
    if (skinPrompt.ok) {
      expect(skinPrompt.prompt).toContain('피부 결만 살리고');
    }
  });

  it('evaluates ECC alignment, aborts on striping, and enforces sigma >= 200px when shape changes (Step 3)', () => {
    const striped = evaluateEccAlignment({
      eccScore: 0.94,
      maxShiftPx: 2,
      edgeStripingDetected: true,
      shapeChanged: false
    });
    expect(striped).toMatchObject({
      aligned: false,
      action: 'reselect_crop_box'
    });

    const shapeChange = evaluateEccAlignment({
      eccScore: 0.93,
      maxShiftPx: 3,
      edgeStripingDetected: false,
      shapeChanged: true,
      requestedLowFreqSigmaPx: 60
    });
    expect(shapeChange).toEqual({
      aligned: true,
      action: 'composite_frequency_separated',
      eccScore: 0.93,
      lowFreqSigmaPx: 200,
      highFreqSource: 'edited_crop',
      lowFreqSource: 'original_image'
    });
  });

  it('validates feather mask hardness/seams (Step 4) and changed_pixels_outside === 0 invariant (Step 5)', () => {
    expect(
      validateFeatherMask({
        edgeHardness: 50,
        maxAlphaAtBoxBoundary: 0,
        crossedSeams: []
      }).valid
    ).toBe(true);

    const badMask = validateFeatherMask({
      edgeHardness: 90,
      maxAlphaAtBoxBoundary: 0.15,
      crossedSeams: ['collar']
    });
    expect(badMask.valid).toBe(false);
    expect(badMask.reasons).toHaveLength(3);

    expect(
      verifyLocalFixComposite({
        changedPixelsOutsideCrop: 0,
        changedPixelsInsideMask: 18400,
        logoScaleDriftPct: 1.2
      }).passed
    ).toBe(true);

    const leaked = verifyLocalFixComposite({
      changedPixelsOutsideCrop: 14,
      changedPixelsInsideMask: 18400,
      logoScaleDriftPct: 6.5
    });
    expect(leaked.passed).toBe(false);
    expect(leaked.reasons).toHaveLength(2);
  });

  it('gates prepareBrandLocalFixPlan by generative_media feature policy', async () => {
    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['generative_media'],
      expectedRevision: 0
    });

    const res = await prepareBrandLocalFixPlan(
      { sql },
      {
        organizationId: orgId,
        crop: {
          imageWidth: 2048,
          imageHeight: 2048,
          box: { x: 400, y: 400, width: 200, height: 200 },
          paddingRatio: 0.35,
          targetCanvasPx: 1440
        },
        promptInput: {
          fixKind: 'logo_mark',
          referenceKind: 'mark_only',
          targetDescription: '로고 획 복원',
          locale: 'ko'
        }
      }
    );
    expect(res).toEqual({ ok: false, code: 'feature_unavailable' });
  });
});

describe('S4 SeedVR2 7B upscale, IG Reels master, and workstation worker', () => {
  it('enforces SeedVR2 4n+1 batch size rule, 4K shot-boundary split, and IG Reels CRF 13 master', () => {
    expect(DEFAULT_SEEDVR2_UPSCALE_CONFIG).toMatchObject({
      ditModel: 'seedvr2_ema_7b_fp16.safetensors',
      resolution: 1080,
      batchSize: 21,
      temporalOverlap: 2,
      colorCorrection: 'lab',
      offloadDevice: 'none',
      colorSpaceTag: 'bt709'
    });
    expect(
      SeedVr2UpscaleConfigSchema.safeParse({ batchSize: 20 }).success
    ).toBe(false);

    const split4k = planUpscaleSegments({
      durationSec: 15,
      resolution: 2160,
      shotCutSeconds: [5.0, 10.5]
    });
    expect(split4k.requiresSplit).toBe(true);
    expect(split4k.segments).toHaveLength(3);
    expect(split4k.segments.map((s) => [s.startSec, s.endSec])).toEqual([
      [0, 5],
      [5, 10.5],
      [10.5, 15]
    ]);

    const igMaster = buildIgReelsMasterArgs();
    expect(DEFAULT_IG_REELS_MASTER_CONFIG.crf).toBe(13);
    expect(igMaster.videoFilter).toContain('scale=1080:1920:flags=lanczos');
    expect(igMaster.videoFilter).toContain('cas=0.25');
    expect(igMaster.videoFilter).toContain('noise=c0s=3.4:c0f=t+u');
    expect(igMaster.ffmpegArgs).toContain('+faststart');
    expect(igMaster.ffmpegArgs).toContain('bt709');

    expect(checkWebDeliveryBudget('web_1080p', 6_500_000).withinBudget).toBe(
      true
    );
    expect(checkWebDeliveryBudget('web_1080p', 9_200_000).withinBudget).toBe(
      false
    );
  });

  it('gates workstation pull-worker tasks by operation feature policy and resolves offline fallbacks', async () => {
    const taskRes = await createWorkstationFinishTask(
      { sql },
      {
        organizationId: orgId,
        op: 'upscale',
        inputStorageKey: `brands/${orgId}/raw.mp4`,
        outputStoragePrefix: `brands/${orgId}/master`
      }
    );
    expect(taskRes.ok).toBe(true);
    if (taskRes.ok) {
      expect(taskRes.task.provider).toBe(WORKSTATION_PROVIDER);
      expect(taskRes.task.gpuArbiterSlot).toBe('comfyui');
    }

    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['sound'],
      expectedRevision: 0
    });

    const blockedSound = await createWorkstationFinishTask(
      { sql },
      {
        organizationId: orgId,
        op: 'audio_mix',
        inputStorageKey: `brands/${orgId}/raw.mp4`,
        outputStoragePrefix: `brands/${orgId}/audio`
      }
    );
    expect(blockedSound).toEqual({ ok: false, code: 'feature_unavailable' });

    expect(resolveFinishWorkerFallback('upscale', 1900)).toMatchObject({
      disposition: 'deliver_cloud_original',
      badge: 'finishing_pending'
    });
    expect(resolveFinishWorkerFallback('inpaint', 1900)).toMatchObject({
      disposition: 'hold_for_pd',
      badge: 'pd_review_required'
    });
  });
});
