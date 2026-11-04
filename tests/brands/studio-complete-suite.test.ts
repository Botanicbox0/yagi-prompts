import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/identity',
  useSearchParams: () => new URLSearchParams(),
}));
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import {
  SANDBOXED_CLIENT_ORG_IDS,
  isSandboxedClientOrganization,
  loadFeaturePolicies,
  loadFeaturePolicy,
  setFeaturePolicy,
} from '@/lib/brands/entitlements';
import { sectionVisibility } from '@/lib/brands/workspace/selection';
import { ServiceGuide } from '@/components/brand-workspace/service-guide';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  DESIGN_PRINCIPLE_CHIPS,
  POMELLI_SHOT_TEMPLATES,
  PreserveChangeMatrixSchema,
  SPATIAL_STAGE_PRESETS,
  VERTICAL_MARKETER_PLAYBOOKS,
  VIDEO_REVERSE_PRESETS,
  compileBrandBrief,
  compileBrandSpatialStageBrief,
  compileBrandVideoReverseBrief,
  compileSpatialStageToShotSpec,
  compileVideoReverseAdaptation,
  createAttachmentPreset,
  listPlaybooksForVertical,
  sanitizeVideoReverseAnalysis,
  summarizeDesignPrincipleAttachment,
} from '@/lib/brands/briefs';
import {
  POMELLI_EXTRACTION_STEPS,
  analyzePinterestBoardFunnel,
  classifyOmniAssetDrop,
  ingestBrandOnboarding,
  kaiperOnboardingPreset,
  listLooks,
  markConfirmedBrandIdentity,
  synthesizeBrandIdentityFromIngest,
  twingsDefaultIdentity,
} from '@/lib/brands/identity/service';
import { BrandOnboardingWizard } from '@/components/brand-workspace/brand-onboarding-wizard';
import {
  BRAND_CLIENT_CATEGORIES,
  inferBrandCategoryFromName,
  listCategoryExperienceProfiles,
  resolveCategoryExperienceProfile,
} from '@/lib/brands/category-experience';
import { BriefConcierge } from '@/components/brand-workspace/brief-concierge';
import { AestheticEngine } from '@/components/brand-workspace/aesthetic-engine';
import { BrandMicroRoiPanel } from '@/components/brand-workspace/brand-micro-roi-panel';
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
import { CampaignMoatShowcase } from '@/components/brand-workspace/campaign-moat-showcase';
import { ReviewStage } from '@/components/brand-workspace/review-stage';
import { CampaignWizard } from '@/components/brand-workspace/campaign-wizard';
import {
  buildCollageFolders,
  buildSharePreviewUrl,
  getAvailableCommissionTracks,
  getBrandWorkspaceTourSteps,
} from '@/lib/brands/workspace/commission-tracks';
import {
  auditMultiShotContinuity,
  buildTwoStageApprovalAndReelsMasterPlan,
  compileOledCinemaColorGradePlan,
  evaluateOpticalIdentityLockV2,
  getOledCinemaLookCatalog,
} from '@/lib/brands/production-pipeline/video-creator-techniques';

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

  it('renders BrandBriefStudio as a minimalist composer that compiles all SOTA systems under the hood with zero backend jargon in customer HTML', () => {
    const html = renderToStaticMarkup(
      React.createElement(BrandBriefStudio, {
        organizationId: kaiperOrgId,
        locale: 'ko',
        canWrite: true,
        identityConfirmed: true,
      }),
    );

    expect(html).toContain('data-brand-brief-studio');
    expect(html).toContain('data-pomelli-shot-templates');
    expect(html).toContain('data-studio-aesthetic-bar');
    expect(html).toContain('data-studio-aesthetic-card="A"');
    expect(html).toContain('data-studio-aesthetic-card="B"');
    expect(html).toContain('data-studio-aesthetic-card="C"');
    expect(html).toContain('data-design-principle-attachment');
    expect(html).toContain('data-brief-compile-form');
    expect(html).toContain('data-brief-compile-submit');

    // Never expose internal engine/model names or backend architecture lectures in customer HTML
    expect(html).not.toMatch(
      /seedance|seedream|nano\s*banana|seedvr2|comfyui|yue2|earshot|argon|higgsfield|mark_only|BRAND DNA ATTACHMENT CONTROL|2-TIER DIRECTION CASCADE/i,
    );
  });

  it('triages unlimited Omni-Asset drops into 4 buckets, compresses 1,240-pin Pinterest boards via 3-stage funnel, and persists 3 Multi-Aesthetic Lines (A/B/C)', async () => {
    const bulkRawItems = Array.from({ length: 48 }, (_, idx) => {
      if (idx < 2) {
        return {
          nameOrUrl: `kaiper-logo-${idx + 1}.svg`,
          note: '워드마크 1:1 고정',
        };
      }
      if (idx === 2) {
        return {
          nameOrUrl: 'kaiper-brandbook-standard.pdf',
          note: '네온 조명 금지. 뷰티 필터 금지.',
        };
      }
      if (idx < 13) {
        return {
          nameOrUrl: `kaiper-product-packshot-${idx}.jpg`,
          note: '실루엣 보존',
        };
      }
      return {
        nameOrUrl: `kaiper-lookbook-editorial-${idx}.webp`,
      };
    });

    const triaged = classifyOmniAssetDrop(bulkRawItems);
    expect(triaged.totalDropped).toBe(48);
    expect(triaged.counts.logo_vault).toBe(2);
    expect(triaged.counts.brand_standard).toBe(1);
    expect(triaged.counts.product_vault).toBe(10);
    expect(triaged.counts.aesthetic_mood_pool).toBe(35);
    expect(triaged.promotedSlotAssets.length).toBeLessThanOrEqual(14);

    const funnel = analyzePinterestBoardFunnel({
      pinterestBoardUrls: [
        'https://www.pinterest.com/kaiper_official/26ss-editorial-mood/',
      ],
      totalPinCountHint: 1240,
      moodAssetCount: 35,
    });
    expect(funnel.totalBoardPinsDetected).toBe(1240);
    expect(funnel.stage1LatestScannedCap).toBe(120);
    expect(funnel.stage2ClustersFormed).toBe(3);
    expect(funnel.stage2MedoidsSelected).toBe(12);
    expect(funnel.estimatedTokenSavingsPct).toBeGreaterThanOrEqual(95);
    expect(funnel.routingSafetyLock).toBe('mood_only_never_logo_or_product');

    const preset = kaiperOnboardingPreset(kaiperOrgId);
    const ingested = await ingestBrandOnboarding({ sql }, owner, {
      ...preset,
      autoConfirm: true,
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    expect(ingested.status).toBe('confirmed');
    expect(ingested.summary.aestheticLines).toHaveLength(3);
    expect(ingested.summary.aestheticLines.map((l) => l.code)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(ingested.summary.pinterestFunnel.stage2MedoidsSelected).toBe(12);

    const looks = await listLooks(sql, kaiperOrgId);
    expect(looks.length).toBeGreaterThanOrEqual(3);
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

  it('verifies Pomelli Bento Business Profile, Design Principle Attachment Selector (Attach vs Unbound), and Fashion·Beauty·F&B Marketer Playbooks', async () => {
    // 1. Pomelli 9-Stage URL Extraction & Bento Business Profile
    expect(POMELLI_EXTRACTION_STEPS).toHaveLength(9);
    const synthesized = synthesizeBrandIdentityFromIngest(
      kaiperOnboardingPreset(kaiperOrgId)
    );
    expect(synthesized.bentoProfile.brandName).toBe('KAIPER');
    expect(synthesized.bentoProfile.colorSwatches.length).toBeGreaterThanOrEqual(5);
    expect(synthesized.bentoProfile.fontSpecimen.sampleGlyph).toBe('Aa');
    expect(synthesized.bentoProfile.modelPreferences.enabledByDefault).toBe(true);
    expect(synthesized.bentoProfile.completenessPct).toBe(100);

    // 2. Design Principle Attachment presets & compileBrandBrief integration
    expect(DESIGN_PRINCIPLE_CHIPS).toHaveLength(6);
    const fullPreset = createAttachmentPreset('full_attach');
    const fullSummary = summarizeDesignPrincipleAttachment(fullPreset);
    expect(fullSummary.attachedKeys).toHaveLength(6);
    expect(fullSummary.detachedKeys).toHaveLength(0);

    const unboundPreset = createAttachmentPreset('unbound_free');
    const unboundSummary = summarizeDesignPrincipleAttachment(unboundPreset);
    expect(unboundSummary.attachment.colorPalette).toBe(false);
    expect(unboundSummary.attachment.aestheticLine).toBe(false);

    const compiledUnbound = await compileBrandBrief({ sql }, owner, {
      organizationId: kaiperOrgId,
      principleAttachment: unboundPreset,
      quick: {
        brief: '실험적인 네온 오렌지·바이올렛 조명 아래 시즌 캡슐 오브제 자유 탐색 컷',
        cutKind: 'reference_exact_product',
        aspect: '4:5',
      },
    });
    expect(compiledUnbound.ok).toBe(true);
    if (!compiledUnbound.ok) return;
    expect(compiledUnbound.view.principleAttachment?.mode).toBe('unbound_free');
    expect(compiledUnbound.view.principleAttachment?.detachedKeys).toContain(
      'colorPalette'
    );

    // 3. Pomelli 4-Shot Templates & Fashion / Beauty / F&B Vertical Playbooks
    expect(POMELLI_SHOT_TEMPLATES.map((t) => t.id)).toEqual([
      'studio',
      'ingredients',
      'in_use',
      'contextual',
    ]);
    expect(VERTICAL_MARKETER_PLAYBOOKS).toHaveLength(9);
    expect(listPlaybooksForVertical('fashion_apparel')).toHaveLength(3);
    expect(listPlaybooksForVertical('beauty_skincare')).toHaveLength(3);
    expect(listPlaybooksForVertical('fnb_hospitality')).toHaveLength(3);

    // 4. SSR verification of Onboarding Bento Profile & Studio Principle Attachment + Vertical Hub
    const onboardingHtml = renderToStaticMarkup(
      React.createElement(BrandOnboardingWizard, {
        organizationId: kaiperOrgId,
        organizationName: 'KAIPER',
        locale: 'ko',
        isOwner: true,
        currentStatus: 'confirmed',
        currentRevision: 1,
        studioHref: '/brand/studio',
      })
    );
    expect(onboardingHtml).toContain('data-pomelli-url-analyzer');
    expect(onboardingHtml).toContain('data-pomelli-bento-profile');
    expect(onboardingHtml).toContain('data-pomelli-model-preferences');
    expect(onboardingHtml).toContain('data-pomelli-director-dock');
    expect(onboardingHtml).toContain('data-pomelli-completion-bar');

    const studioHtml = renderToStaticMarkup(
      React.createElement(BrandBriefStudio, {
        organizationId: kaiperOrgId,
        locale: 'ko',
        canWrite: true,
        identityConfirmed: true,
      })
    );
    expect(studioHtml).toContain('data-design-principle-attachment');
    expect(studioHtml).toContain('data-attachment-mode-btn="full_attach"');
    expect(studioHtml).toContain('data-attachment-mode-btn="unbound_free"');
    expect(studioHtml).toContain('data-pomelli-shot-templates');
    expect(studioHtml).not.toContain('BRAND DNA ATTACHMENT CONTROL');

    // Guard: no internal engine/model names leaked into either customer surface
    for (const html of [onboardingHtml, studioHtml]) {
      expect(html).not.toMatch(
        /Seedance|Seedream|Nano Banana|SeedVR2|ComfyUI|YuE2|earshot|Argon|Gemini|Higgsfield/i
      );
    }

    // 5. Campaign Moat Showcase & Tab Orientation Map (1080p In-House Masters + Strict Morphic Sandbox Isolation)
    const moatFullHtml = renderToStaticMarkup(
      React.createElement(CampaignMoatShowcase, {
        locale: 'ko',
        organizationId: kaiperOrgId,
        studioOpen: true,
      })
    );
    expect(moatFullHtml).toContain('data-brand-tab-map');
    expect(moatFullHtml).toContain('data-campaign-moat-showcase');
    expect(moatFullHtml).toContain('data-b2b-sound-master-reel');
    expect(moatFullHtml).toContain('/reel/brands/house-runway-1080p.mp4');
    expect(moatFullHtml).toContain('/reel/brands/studio-editorial-blue-1080p.mp4');
    expect(moatFullHtml).toContain('/reel/brands/house-french-blue-hero-1080p.mp4');
    expect(moatFullHtml).toContain('/reel/brands/studio-rain-editorial-1080p.mp4');
    expect(moatFullHtml).toContain('data-home-studio-cta');
    // Never showcase Morphic campaign stats or Morphic creator videos on B2B workspace
    expect(moatFullHtml).not.toContain('seeding-redcarpet');
    expect(moatFullHtml).not.toContain('글로벌 AI 플랫폼');
    expect(moatFullHtml).not.toContain('영상 9편');
    expect(moatFullHtml).not.toContain('200만 뷰+');
    expect(moatFullHtml).not.toContain('300건+');
    expect(moatFullHtml).not.toMatch(
      /Morphic|Seedance|Seedream|Nano Banana|SeedVR2|ComfyUI|YuE2|earshot|Argon|Gemini|Higgsfield/i
    );

    // Sandboxed client (Morphic or studioOpen=false) renders NOTHING from CampaignMoatShowcase
    const moatIsolatedHtml = renderToStaticMarkup(
      React.createElement(CampaignMoatShowcase, {
        locale: 'ko',
        organizationId: morphicOrgId,
        studioOpen: false,
      })
    );
    expect(moatIsolatedHtml).toBe('');

    const moatMorphicProdIdHtml = renderToStaticMarkup(
      React.createElement(CampaignMoatShowcase, {
        locale: 'ko',
        organizationId: 'd425c3b1-4066-4970-8a3b-93c52b3eef70',
        studioOpen: true,
      })
    );
    expect(moatMorphicProdIdHtml).toBe('');

    // Hardline sandboxed client organization checks (Morphic production ID + local ID + name match)
    expect(SANDBOXED_CLIENT_ORG_IDS.has('d425c3b1-4066-4970-8a3b-93c52b3eef70')).toBe(true);
    expect(SANDBOXED_CLIENT_ORG_IDS.has('deb648e9-c2df-43d4-b2a7-7f9eff8180d9')).toBe(true);
    expect(isSandboxedClientOrganization({ id: 'd425c3b1-4066-4970-8a3b-93c52b3eef70' })).toBe(true);
    expect(isSandboxedClientOrganization({ name: 'Morphic' })).toBe(true);
    expect(isSandboxedClientOrganization({ id: kaiperOrgId, name: 'KAIPER' })).toBe(false);

    // Even without a DB row, Morphic's production organization ID is denied self-serve AI features
    const morphicProdPolicy = await loadFeaturePolicy(sql, 'd425c3b1-4066-4970-8a3b-93c52b3eef70');
    expect(morphicProdPolicy.denied).toEqual([
      'generative_media',
      'sound',
      'color_grading',
      'brand_learning',
    ]);
    const morphicProdPolicies = await loadFeaturePolicies(sql, ['d425c3b1-4066-4970-8a3b-93c52b3eef70']);
    expect(morphicProdPolicies['d425c3b1-4066-4970-8a3b-93c52b3eef70']).toEqual([
      'generative_media',
      'sound',
      'color_grading',
      'brand_learning',
    ]);
    expect(
      sectionVisibility({
        id: 'd425c3b1-4066-4970-8a3b-93c52b3eef70',
        name: 'Morphic',
        role: 'owner',
      })
    ).toEqual({
      studio: false,
      identity: false,
      settings: true,
      members: true,
    });

    // ServiceGuide for sandboxed client hides studio track and AI likeness wording
    const bKo = getDictionary('ko').brandWorkspace;
    const guideSandboxedHtml = renderToStaticMarkup(
      React.createElement(ServiceGuide, {
        kind: 'campaign',
        b: bKo,
        studioAllowed: false,
        showOther: false,
      })
    );
    expect(guideSandboxedHtml).not.toContain('data-track="studio"');
    expect(guideSandboxedHtml).not.toContain('자기 얼굴로');
    expect(guideSandboxedHtml).not.toContain('/brand/studio');
    expect(guideSandboxedHtml).toContain('검증된 크리에이터가 본인 계정에 캠페인 콘텐츠를 게시합니다');
  });

  it('implements 3-Track Commission Architecture, 1-Page Express Briefs, Frame.io V4 Guided Tour, Playbook Collage Folders, and Share Builder while enforcing Morphic sandbox', () => {
    const bKo = getDictionary('ko').brandWorkspace;

    // 1. 3-Track Commission Architecture (Standard Brand vs Sandboxed Morphic)
    const fullTracks = getAvailableCommissionTracks({ generativeClosed: false, locale: 'ko' });
    expect(fullTracks.map((t) => t.id)).toEqual([
      'creator_campaign',
      'template_build',
      'studio_film',
    ]);
    expect(fullTracks.find((t) => t.id === 'template_build')?.deliverableDestination.targetPath).toBe(
      '/brand/studio'
    );
    expect(fullTracks.find((t) => t.id === 'template_build')?.requiresInfluencerSteps).toBe(false);
    expect(fullTracks.find((t) => t.id === 'studio_film')?.requiresInfluencerSteps).toBe(false);

    // Morphic sandbox (`generativeClosed: true`) strictly hides `template_build` (Self-Studio template track)
    const sandboxedTracks = getAvailableCommissionTracks({ generativeClosed: true, locale: 'ko' });
    expect(sandboxedTracks.map((t) => t.id)).toEqual(['creator_campaign', 'studio_film']);
    expect(sandboxedTracks.some((t) => t.id === 'template_build')).toBe(false);

    // 2. Frame.io V4 Interactive Guided Tour Steps
    const tourSteps = getBrandWorkspaceTourSteps({ generativeClosed: false, locale: 'ko' });
    expect(tourSteps).toHaveLength(5);
    expect(tourSteps[0]?.type).toBe('MODAL');
    expect(tourSteps.slice(1).every((s) => s.type === 'POINT')).toBe(true);

    const sandboxedTourSteps = getBrandWorkspaceTourSteps({ generativeClosed: true, locale: 'ko' });
    expect(JSON.stringify(sandboxedTourSteps)).not.toContain('셀프 스튜디오');

    // 3. Playbook Collage Folders & Frame.io V4 Share Preview URL Builder
    const folders = buildCollageFolders({
      projectId: 'proj-1234567890',
      locale: 'ko',
      contents: [],
    });
    expect(folders.map((f) => f.id)).toEqual(['brand_source', 'review_cuts', 'master_stems']);
    expect(folders.every((f) => f.items.length === 3)).toBe(true);

    const shareUrl = buildSharePreviewUrl('proj-1234567890', 2, {
      layout: 'reel',
      access: 'restricted',
      expirationDays: 14,
      watermark: true,
    });
    expect(shareUrl).toBe(
      'https://brand.twings.app/s/proj-1234567?v=2&view=reel&access=restricted&exp=14d&wm=1'
    );

    // 4. ReviewStage SSR: Guided Tour trigger, Collage Folders, Deliverable Status Grid, and Share Builder
    const reviewHtml = renderToStaticMarkup(
      React.createElement(ReviewStage, {
        projectId: 'proj-1234567890',
        contents: [],
        messages: [],
        decisions: [],
        locale: 'ko',
        generativeMediaAllowed: true,
        productionMode: 'studio',
      })
    );
    expect(reviewHtml).toContain('data-frameio-guided-tour');
    expect(reviewHtml).toContain('data-tour-trigger');
    expect(reviewHtml).toContain('data-collage-folders');
    expect(reviewHtml).toContain('data-deliverable-status-grid');
    expect(reviewHtml).toContain('data-frameio-share-builder');
    expect(reviewHtml).toContain('data-share-settings-toggle');
    expect(reviewHtml).toContain('data-studio-handoff-link');

    // ReviewStage for Morphic (`generativeMediaAllowed: false`) hides Self Studio handoff link & platform option
    const reviewSandboxedHtml = renderToStaticMarkup(
      React.createElement(ReviewStage, {
        projectId: 'proj-morphic',
        contents: [],
        messages: [],
        decisions: [],
        locale: 'ko',
        generativeMediaAllowed: false,
        productionMode: 'creator',
      })
    );
    expect(reviewSandboxedHtml).not.toContain('data-studio-handoff-link');
    expect(reviewSandboxedHtml).not.toContain('value="self_studio"');

    // 5. CampaignWizard SSR: 3-Track Selector & 1-Page Express Brief for `template_build` and `studio_film`
    const wizardTemplateHtml = renderToStaticMarkup(
      React.createElement(CampaignWizard, {
        b: bKo,
        locale: 'ko',
        organizations: [{ id: kaiperOrgId, name: 'KAIPER' }],
        formats: [],
        generativeClosed: false,
        initialTrack: 'template_build',
      })
    );
    expect(wizardTemplateHtml).toContain('data-commission-track-selector');
    expect(wizardTemplateHtml).toContain('data-commission-track="template_build"');
    expect(wizardTemplateHtml).toContain('data-express-commission-form="template_build"');
    expect(wizardTemplateHtml).toContain('data-campaign-category-starters');
    expect(wizardTemplateHtml).toContain('전용 템플릿 의뢰 및 시사 룸 열기');

    const wizardSandboxedHtml = renderToStaticMarkup(
      React.createElement(CampaignWizard, {
        b: bKo,
        locale: 'ko',
        organizations: [{ id: morphicOrgId, name: 'Morphic' }],
        formats: [],
        generativeClosed: true,
        initialTrack: 'template_build', // falls back to creator_campaign when generativeClosed
      })
    );
    expect(wizardSandboxedHtml).not.toContain('data-commission-track="template_build"');
    expect(wizardSandboxedHtml).not.toContain('data-self-studio-shortcut');
  });

  it('integrates the 6 latest Video-Creator SOTA techniques as customer-facing utilities with zero internal jargon', () => {
    // 1. Optical Identity Lock™ v2 (3-Stage Zero-Distortion Face & Bust-Up Proportion Guard)
    const stage1Report = evaluateOpticalIdentityLockV2({
      focalLengthMm: 50,
      headWidthRatioPct: 42,
      hasFaceOcclusion: false,
      locale: 'ko',
    });
    expect(stage1Report.selectedStage).toBe('stage1_passthrough_crop');
    expect(stage1Report.facePixelPreservationPct).toBe(100);
    expect(stage1Report.wideAngleRejected).toBe(false);
    expect(stage1Report.framingVerdict).toBe('optimal_bust_up');

    const wideAngleTightReport = evaluateOpticalIdentityLockV2({
      focalLengthMm: 24,
      headWidthRatioPct: 80,
      hasFaceOcclusion: true,
      measuredIdentitySimilarity: 0.84, // below 0.90 -> auto-rollback to stage 1!
      locale: 'ko',
    });
    expect(wideAngleTightReport.wideAngleRejected).toBe(true);
    expect(wideAngleTightReport.selectedStage).toBe('stage3_rollback_to_stage1');
    expect(wideAngleTightReport.facePixelPreservationPct).toBe(100);
    expect(wideAngleTightReport.framingVerdict).toBe('tight_face_crop_warning');

    const baggyTopReport = evaluateOpticalIdentityLockV2({
      focalLengthMm: 50,
      headWidthRatioPct: 45,
      baggyCasualTopDetected: true,
      locale: 'ko',
    });
    expect(baggyTopReport.framingVerdict).toBe('headneck_runway_override');

    // 2. OLED Cinema Color Grading & Reference Look Match
    const lookCatalog = getOledCinemaLookCatalog('ko');
    expect(lookCatalog.map((l) => l.id)).toEqual([
      'oled-editorial-punch',
      'kodak-2383-campaign',
      'dreamcore-pastel-bloom',
      'dark-fairy-cinema',
      'reference-match',
    ]);
    const oledPlan = compileOledCinemaColorGradePlan({
      lookId: 'reference-match',
      referenceAssetTitle: '26SS Editorial Lookbook',
      locale: 'ko',
    });
    expect(oledPlan.preset.targetBlackFloorIre).toBe(0.008);
    expect(oledPlan.preset.skinToneProtectedHueDeg).toEqual([15, 40]);
    expect(oledPlan.customerBenefit).toContain('26SS Editorial Lookbook');

    // 3. Multi-Shot Continuity Inspector
    const continuity = auditMultiShotContinuity({ clipCount: 4, locale: 'ko' });
    expect(continuity.status).toBe('passed');
    expect(continuity.maxChromaDriftDeltaAB).toBeLessThan(continuity.chromaDriftLimit);
    expect(continuity.maxLumaDriftDeltaL).toBeLessThan(continuity.lumaDriftLimit);
    expect(continuity.maxGrainFftJumpPct).toBeLessThan(continuity.grainFftLimitPct);

    // 4. Two-Stage Approval Gate + Dual Audio Stems + Instagram Edits Checklist
    const twoStagePlan = buildTwoStageApprovalAndReelsMasterPlan({
      gateStatus: 'stage2_1080p_master',
      revealTimestampSec: 3.8,
      locale: 'ko',
    });
    expect(twoStagePlan.stage1Spec.resolution).toBe('480p');
    expect(twoStagePlan.stage2Spec.unlocked).toBe(true);
    expect(twoStagePlan.stage2Spec.integratedLufs).toBe(-14.0);
    expect(twoStagePlan.deliverableStems.map((s) => s.id)).toEqual([
      'reels_trending_clean_foley',
      'ad_master_with_bgm',
      'clean_cover_frame',
    ]);
    expect(twoStagePlan.igEditsExportChecklist).toHaveLength(3);

    // 5. Verify SSR of Customer Utilities in ReviewStage & BrandBriefStudio + Zero Internal Jargon
    const reviewHtml = renderToStaticMarkup(
      React.createElement(ReviewStage, {
        projectId: 'proj-utility-check',
        contents: [],
        messages: [],
        decisions: [],
        locale: 'ko',
        generativeMediaAllowed: true,
        productionMode: 'studio',
      })
    );
    expect(reviewHtml).toContain('data-two-stage-gate-bar');
    expect(reviewHtml).toContain('data-approve-stage1-to-stage2');
    expect(reviewHtml).toContain('data-safe-zone-toggle');
    expect(reviewHtml).toContain('data-quality-assurance-bar');
    expect(reviewHtml).toContain('data-oled-look-selector');
    expect(reviewHtml).toContain('data-continuity-audit-badge');
    expect(reviewHtml).toContain('data-optical-identity-badge');
    expect(reviewHtml).toContain('data-platform-delivery-utility');
    expect(reviewHtml).toContain('data-ig-edits-checklist');

    const studioHtml = renderToStaticMarkup(
      React.createElement(BrandBriefStudio, {
        organizationId: 'org-kaiper',
        locale: 'ko',
        canWrite: true,
        identityConfirmed: true,
      })
    );
    expect(studioHtml).toContain('data-studio-optical-stage="stage1_passthrough_crop"');
    expect(studioHtml).toContain('data-studio-oled-look="oled-editorial-punch"');
    expect(studioHtml).toContain('data-studio-continuity="passed"');

    // Strictly zero internal vendor/engine jargon or backend system dumps in customer-facing HTML
    const forbiddenJargon = [
      'Seedance',
      'Seedream',
      'Nano Banana',
      'SeedVR2',
      'ComfyUI',
      'Demucs',
      'Higgsfield',
      'Slack',
      'RECIPE V2',
      'BRAND DNA ATTACHMENT CONTROL',
      '2-TIER DIRECTION CASCADE',
      'mark_only',
    ];
    for (const token of forbiddenJargon) {
      expect(reviewHtml).not.toContain(token);
      expect(studioHtml).not.toContain(token);
    }
  });

  it('adapts customer Studio scenes, quick prompts, and compiler guardrails by client category and enforces zero red/jargon across all customer components', () => {
    const profiles = listCategoryExperienceProfiles();
    expect(profiles).toHaveLength(BRAND_CLIENT_CATEGORIES.length);

    expect(inferBrandCategoryFromName('DANYAD Fashion Studio')).toBe('fashion_apparel');
    expect(inferBrandCategoryFromName('GlowLab Skincare & Beauty')).toBe('beauty_skincare');
    expect(inferBrandCategoryFromName('Matcha Coffee Roasters')).toBe('fnb_hospitality');
    expect(inferBrandCategoryFromName('KAIPER Fragrance Atelier')).toBe('lifestyle_object');
    expect(inferBrandCategoryFromName('Cloud AI SaaS Platform')).toBe('tech_platform');

    for (const categoryId of BRAND_CLIENT_CATEGORIES) {
      const profile = resolveCategoryExperienceProfile({ category: categoryId });
      expect(profile.scenes).toHaveLength(4);
      expect(profile.campaignStarters.length).toBeGreaterThanOrEqual(1);
      expect(profile.compiler.defaultProductChecklist.geometry.length).toBeGreaterThanOrEqual(10);
      expect(profile.compiler.negativeGuardrails.length).toBeGreaterThanOrEqual(3);
    }

    const beautyStudioHtml = renderToStaticMarkup(
      React.createElement(BrandBriefStudio, {
        organizationId: 'org-beauty',
        organizationName: 'GlowLab Skincare',
        locale: 'ko',
        canWrite: true,
        identityConfirmed: true,
      })
    );
    expect(beautyStudioHtml).toContain('data-active-studio-category="beauty_skincare"');
    expect(beautyStudioHtml).toContain('data-studio-category-switcher');
    expect(beautyStudioHtml).toContain('data-studio-quick-prompts');
    expect(beautyStudioHtml).toContain('제형 · 수분 텍스처');

    const conciergeHtml = renderToStaticMarkup(
      React.createElement(BriefConcierge, {
        brandName: 'KAIPER',
        projectTitle: '26SS Launch',
        objective: 'Hero Film',
        locale: 'ko',
      })
    );
    const aestheticHtml = renderToStaticMarkup(
      React.createElement(AestheticEngine, {
        locale: 'ko',
        referenceLinks: [],
      })
    );
    const microRoiHtml = renderToStaticMarkup(
      React.createElement(BrandMicroRoiPanel, {
        organizationId: 'org-kaiper',
        locale: 'ko',
        canWrite: true,
      })
    );

    for (const html of [beautyStudioHtml, conciergeHtml, aestheticHtml, microRoiHtml]) {
      expect(html).not.toContain('#ED1E1E');
      expect(html).not.toContain('Slack');
      expect(html).not.toContain('슬랙');
      expect(html).not.toContain('(mark_only)');
      expect(html).not.toContain('outside_pixels_changed === 0');
    }
  });
});
