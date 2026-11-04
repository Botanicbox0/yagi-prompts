import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  PreserveChangeMatrixSchema,
  SPATIAL_STAGE_PRESETS,
  VIDEO_REVERSE_PRESETS,
  compileBrandSpatialStageBrief,
  compileBrandVideoReverseBrief,
  compileSpatialStageToShotSpec,
  compileVideoReverseAdaptation,
  sanitizeVideoReverseAnalysis,
} from '@/lib/brands/briefs';
import {
  markConfirmedBrandIdentity,
  twingsDefaultIdentity,
} from '@/lib/brands/identity/service';
import {
  BRAND_MUSIC_STUDIO_PRESETS,
  EIGHT_STAGE_BROADCAST_MASTERING_CHAIN,
  buildBrandSoundAndMusicStudioPlan,
  compileBrandMusicScore,
  planBrandSoundAndMusicStudio,
} from '@/lib/brands/sound';
import {
  buildSpatialFramePinRecord,
  createStakeholderReviewShare,
  recordSpatialFramePin,
  spatialPinToMicroRoiBox,
} from '@/lib/brands/review';
import { BrandBriefStudio } from '@/components/brand-workspace/brand-brief-studio';

const adminId = randomUUID();
const ownerId = randomUUID();

const makeViewer = (userId: string, isAdmin = false): Viewer => ({
  userId,
  isAdmin,
  tier: isAdmin ? 'admin' : 'free',
  email: `${userId}@example.test`,
  locale: 'ko',
});

const admin = makeViewer(adminId, true);
const owner = makeViewer(ownerId, false);

let db: PGlite;
let sql: SqlRunner;
let kaiperOrgId: string;
let morphicOrgId: string;

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId]) {
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`,
    });
  }
  const createdKaiper = await createStudioOrganization({ sql }, admin, {
    name: 'KAIPER',
    requestId: randomUUID(),
  });
  if (!createdKaiper.ok) throw new Error(createdKaiper.code);
  kaiperOrgId = createdKaiper.id;

  const createdMorphic = await createStudioOrganization({ sql }, admin, {
    name: 'Morphic Studio',
    requestId: randomUUID(),
  });
  if (!createdMorphic.ok) throw new Error(createdMorphic.code);
  morphicOrgId = createdMorphic.id;

  await sql.query(
    `insert into brand_memberships (organization_id, user_id, role)
       values ($1, $3, 'owner'),
              ($2, $3, 'owner')`,
    [kaiperOrgId, morphicOrgId, ownerId],
  );

  // Enforce Morphic zero-trace isolation (generative_media, sound, color_grading denied)
  const policyUpdated = await setFeaturePolicy({ sql }, admin, {
    organizationId: morphicOrgId,
    expectedRevision: 0,
    denied: ['generative_media', 'sound', 'color_grading'],
  });
  if (!policyUpdated.ok) throw new Error(policyUpdated.code);
});

afterEach(async () => {
  await db?.close();
});

describe('Brand Studio Complete Suite (Video Reverse, 2D Spatial Stage, 3-Track Music, Frame Pin Review)', () => {
  it('sanitizes local reference video paths and compiles Preserve/Change matrix with angle alternation & Two-Stage gate', () => {
    const rawWithPrivatePaths = {
      ...VIDEO_REVERSE_PRESETS.runway_flash_15s!,
      source_path: 'D:/local/private/reference.mp4',
      sha256: 'deadbeef1234567890',
      raw_video_url: 'https://internal.example/ref.mp4',
      extracted_frame_paths: ['D:/tmp/frame_001.jpg'],
    };

    const sanitized = sanitizeVideoReverseAnalysis(rawWithPrivatePaths);
    expect('source_path' in sanitized).toBe(false);
    expect('sha256' in sanitized).toBe(false);
    expect('raw_video_url' in sanitized).toBe(false);
    expect('extracted_frame_paths' in sanitized).toBe(false);

    const matrix = PreserveChangeMatrixSchema.parse({
      preserve: {
        cameraChoreography: true,
        cutRhythmAndSubsecondBeats: true,
        lightingContrastAndKey: true,
        revealClimaxTiming: true,
      },
      change: {
        brandProductName: 'KAIPER Signature Vessel 50ml',
        brandProductGeometryLock:
          'palm-sized architectural glass bottle with brushed steel cap',
        subjectMode: 'fictional_cast',
        wardrobeDescription: 'asymmetric navy tailored wool coat',
        environmentSurface: 'honed travertine plinth and steel gallery floor',
        enforceBrandColourWorld: true,
        enforceAntiPlasticAndAntiComposite: true,
        enforceStrictNoBgm: true,
      },
    });

    const compiled = compileVideoReverseAdaptation({
      analysis: rawWithPrivatePaths,
      matrix,
      identity: markConfirmedBrandIdentity(twingsDefaultIdentity()),
    });

    expect(compiled.spec.cutKind).toBe('short_film_clip');
    expect(compiled.spec.deliverable.medium).toBe('short film');
    expect(compiled.spec.timeline?.length).toBe(6);
    expect(compiled.spec.timeline?.every((s) => s.audio?.no_bgm === true)).toBe(
      true,
    );
    expect(compiled.twoStageGate.stage1Draft.resolution).toBe('480p');
    expect(compiled.twoStageGate.stage2Master.resolution).toBe('1080p');
    expect(compiled.twoStageGate.stage2Master.revealDropTimestampSec).toBe(3.8);
  });

  it('compiles ArtCraft-inspired 2D Spatial Stage with Mid-Wide height guard, anti-frontal lock, and unique reference roles', () => {
    const rawStage = {
      ...SPATIAL_STAGE_PRESETS[0]!.spec,
      dynamicMotionScene: true,
      subject: {
        ...SPATIAL_STAGE_PRESETS[0]!.spec.subject,
        frameHeightPct: 68, // exceeds 50% dynamic cap -> auto-clamped to 46%
        torsoAngleDeg: 0, // frontal lock -> auto-rotated to 18 deg
      },
    };

    const result = compileSpatialStageToShotSpec(rawStage);
    expect(result.normalizedSpec.subject.frameHeightPct).toBe(46);
    expect(Math.abs(result.normalizedSpec.subject.torsoAngleDeg)).toBeGreaterThanOrEqual(18);
    expect(result.diagnostics.frameHeightSafe).toBe(true);
    expect(result.diagnostics.frontalLockAvoided).toBe(true);
    expect(result.diagnostics.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.shotSpec.camera.focal_mm).toBe(85);
  });

  it('compiles 3-Track Music & Sound Studio with named lead instrument, 32-unit ABC bars, 0ms drop sync, and license gate', () => {
    const score = compileBrandMusicScore({
      presetId: 'french_house_runway_122',
      leadInstrument: 'mellow Rhodes lead melody',
      bpm: 122,
      keySignature: 'Dm',
      bars: 8,
    });

    expect(score.vocalBleedGuardActive).toBe(true);
    expect(score.styleTagPrompt).toContain('instrumental, no vocals');
    expect(score.styleTagPrompt).toContain('mellow Rhodes lead melody');
    expect(score.abcScore.valid).toBe(true);
    expect(score.abcScore.voice1UnitsPerBar).toEqual([32, 32, 32, 32, 32, 32, 32, 32]);
    expect(score.licenseGate.commercialAllowed).toBe(true);

    // Non-commercial CC BY-NC source must be blocked by license gate
    const blockedScore = compileBrandMusicScore({
      presetId: 'blocked_nc',
      licenseSource: 'yue2_cc_by_nc',
    });
    expect(blockedScore.licenseGate.commercialAllowed).toBe(false);

    const studioPlan = buildBrandSoundAndMusicStudioPlan({
      score: BRAND_MUSIC_STUDIO_PRESETS[0]!.score,
      videoDurationSec: 15,
      videoRevealSec: 3.8,
    });

    expect(studioPlan.trackB_dropSync.valid).toBe(true);
    expect(studioPlan.trackB_dropSync.alignedOffsetMs).toBe(0);
    expect(studioPlan.trackB_dropSync.sliceStartSec).toBe(4.2);
    expect(studioPlan.trackB_dropSync.sliceEndSec).toBe(19.2);
    expect(studioPlan.trackC_mastering.stages.length).toBe(
      EIGHT_STAGE_BROADCAST_MASTERING_CHAIN.length,
    );
    expect(studioPlan.trackC_mastering.reconciliation.passed).toBe(true);
    expect(
      studioPlan.trackC_mastering.deliverableStems.masterWithBgm.commercialReady,
    ).toBe(true);
    expect(
      studioPlan.trackC_mastering.deliverableStems.cleanFoleyOnly.commercialReady,
    ).toBe(true);
  });

  it('converts Frame.io-style spatial frame pins into seam-safe Micro-ROI boxes and pipeline handoffs', () => {
    const box = spatialPinToMicroRoiBox({
      xPct: 58,
      yPct: 62,
      canvasWidth: 2048,
      canvasHeight: 2048,
      mode: 'brand_logo_packaging',
    });

    expect(box.x1 - box.x0).toBe(320);
    expect(box.y1 - box.y0).toBe(320);
    expect(box.x0).toBeGreaterThanOrEqual(36);
    expect(box.y0).toBeGreaterThanOrEqual(36);

    const pinRecord = buildSpatialFramePinRecord({
      projectId: 'kaiper-26ss',
      timestampSec: 3.8,
      xPct: 58,
      yPct: 62,
      note: 'Restore front bottle serif typography',
      handoffKind: 'send_to_micro_roi',
      microRoiMode: 'brand_logo_packaging',
    });

    expect(pinRecord.handoffPayload.microRoiBox).toEqual(box);
    expect(pinRecord.handoffPayload.formattedCommentStamp).toContain('58%, 62%');
  });

  it('enforces Morphic zero-trace isolation (feature_unavailable) on videoReverse, spatialStage, and soundStudio operations while allowing KAIPER', async () => {
    // KAIPER succeeds on all operations
    const kaiperVideo = await compileBrandVideoReverseBrief({ sql }, owner, {
      organizationId: kaiperOrgId,
      presetId: 'runway_flash_15s',
    });
    expect(kaiperVideo.ok).toBe(true);

    const kaiperSpatial = await compileBrandSpatialStageBrief({ sql }, owner, {
      organizationId: kaiperOrgId,
      presetId: 'editorial_duo_stage',
    });
    expect(kaiperSpatial.ok).toBe(true);

    const kaiperSound = await planBrandSoundAndMusicStudio({ sql }, owner, {
      organizationId: kaiperOrgId,
      presetId: 'french_house_runway_122',
    });
    expect(kaiperSound.ok).toBe(true);

    const kaiperShare = await createStakeholderReviewShare({ sql }, owner, {
      organizationId: kaiperOrgId,
      projectId: 'kaiper-26ss',
      scope: 'comment_only',
      pinProtected: true,
    });
    expect(kaiperShare.ok).toBe(true);

    const kaiperPin = await recordSpatialFramePin({ sql }, owner, {
      organizationId: kaiperOrgId,
      projectId: 'kaiper-26ss',
      timestampSec: 3.8,
      xPct: 54,
      yPct: 60,
      note: 'Check bottle cap reflection',
      handoffKind: 'send_to_micro_roi',
    });
    expect(kaiperPin.ok).toBe(true);

    // Morphic is strictly blocked from generative_media & sound
    const morphicVideo = await compileBrandVideoReverseBrief({ sql }, owner, {
      organizationId: morphicOrgId,
      presetId: 'runway_flash_15s',
    });
    expect(morphicVideo).toEqual({ ok: false, code: 'feature_unavailable' });

    const morphicSpatial = await compileBrandSpatialStageBrief({ sql }, owner, {
      organizationId: morphicOrgId,
      presetId: 'editorial_duo_stage',
    });
    expect(morphicSpatial).toEqual({ ok: false, code: 'feature_unavailable' });

    const morphicSound = await planBrandSoundAndMusicStudio({ sql }, owner, {
      organizationId: morphicOrgId,
      presetId: 'french_house_runway_122',
    });
    expect(morphicSound).toEqual({ ok: false, code: 'feature_unavailable' });
  });

  it('renders BrandBriefStudio with all 5 integrated modules and zero forbidden internal engine names in customer HTML', () => {
    const html = renderToStaticMarkup(
      React.createElement(BrandBriefStudio, {
        organizationId: kaiperOrgId,
        locale: 'ko',
        canWrite: true,
        identityConfirmed: true,
      }),
    );

    expect(html).toContain('data-brand-studio-tutorial');
    expect(html).toContain('data-brand-spatial-stage-panel');
    expect(html).toContain('data-brand-video-reverse-panel');
    expect(html).toContain('data-brand-music-studio-panel');
    expect(html).toContain('data-brand-micro-roi-panel');
    expect(html).toContain('data-review-stage');

    // Never expose internal engine/model names in customer HTML
    expect(html).not.toMatch(
      /seedance|seedream|nano\s*banana|seedvr2|comfyui|yue2|earshot|argon|higgsfield/i,
    );
  });

  it('guards Pre-mortem edge cases: empty spatial stage recovery, macro-cut subject disambiguation, aspect-aware ROI, and cross-org probing block', async () => {
    // 1. Empty stage (both subject & product disabled) auto-recovers instead of throwing ZodError
    const emptyStageSpec = {
      ...SPATIAL_STAGE_PRESETS[0]!.spec,
      subject: { ...SPATIAL_STAGE_PRESETS[0]!.spec.subject, enabled: false },
      product: { ...SPATIAL_STAGE_PRESETS[0]!.spec.product, enabled: false },
    };
    const recoveredSpatial = compileSpatialStageToShotSpec(emptyStageSpec);
    expect(recoveredSpatial.normalizedSpec.product.enabled).toBe(true);
    expect(recoveredSpatial.shotSpec.product).not.toBeNull();
    expect(recoveredSpatial.diagnostics.warnings.length).toBeGreaterThan(0);

    // 2. Macro product cuts in video reverse never inject human lip/eyeline directives (preventing face hallucination)
    const identity = markConfirmedBrandIdentity(twingsDefaultIdentity());
    const compiledVideo = compileVideoReverseAdaptation({
      analysis: VIDEO_REVERSE_PRESETS.runway_flash_15s!,
      matrix: PreserveChangeMatrixSchema.parse({}),
      identity,
    });
    const macroShot = compiledVideo.spec.timeline?.find((s) => s.shot === 2);
    expect(macroShot?.action).toContain('Product-only optical lock');
    expect(macroShot?.action).not.toContain('softly closed lips');

    // Subsequent subject shots use compact continuity token instead of repeating 195-char paragraph
    const firstSubjectShot = compiledVideo.spec.timeline?.find((s) => s.shot === 1);
    const secondSubjectShot = compiledVideo.spec.timeline?.find((s) => s.shot === 3);
    expect(firstSubjectShot?.action).toContain('softly closed lips');
    expect(secondSubjectShot?.action).toContain('Continuity lock:');

    // 3. Aspect-ratio-aware spatial pin to Micro-ROI box (9:16 vertical reel 1152x2048 vs 1:1 2048x2048)
    const box9x16 = spatialPinToMicroRoiBox({
      xPct: 50,
      yPct: 50,
      aspectRatio: '9:16',
      mode: 'brand_logo_packaging',
    });
    const box1x1 = spatialPinToMicroRoiBox({
      xPct: 50,
      yPct: 50,
      aspectRatio: '1:1',
      mode: 'brand_logo_packaging',
    });
    expect(box9x16.x0).toBeLessThan(box1x1.x0);
    expect(box9x16.y0).toBe(box1x1.y0);

    // 4. Outsider cannot probe Morphic feature policy via soundStudio.plan (returns 'forbidden', not 'feature_unavailable')
    const outsiderId = randomUUID();
    await seedProfile(sql, {
      id: outsiderId,
      isAdmin: false,
      email: 'outsider@example.test',
    });
    const outsider = makeViewer(outsiderId, false);
    const probeAttempt = await planBrandSoundAndMusicStudio({ sql }, outsider, {
      organizationId: morphicOrgId,
      presetId: 'french_house_runway_122',
    });
    expect(probeAttempt).toEqual({ ok: false, code: 'forbidden' });
  });
});
