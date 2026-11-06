"use client";

import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  SHOT_ASPECTS,
  type CustomerBriefView,
  type DeliverableMedium,
  type DeliverableUse,
  type ShotAspect,
  type ShotCutKind,
} from "@/lib/brands/briefs/schema";
import type { BrandBriefState } from "@/lib/brands/briefs/state-machine";
import type { BrandLookPresetId } from "@/lib/brands/finish/color-grading";
import {
  synthesizeMultiAestheticLines,
  type BrandAestheticLine,
} from "@/lib/brands/identity/onboarding";
import {
  DESIGN_PRINCIPLE_CHIPS,
  POMELLI_SHOT_TEMPLATES,
  createAttachmentPreset,
  type DesignPrincipleAttachment,
  type DesignPrincipleAttachmentMode,
  type DesignPrincipleKey,
  type PomelliShotTemplate,
  type PomelliShotTemplateId,
} from "@/lib/brands/briefs/vertical-playbooks";
import {
  auditMultiShotContinuity,
  buildTwoStageApprovalAndReelsMasterPlan,
  compileOledCinemaColorGradePlan,
  evaluateOpticalIdentityLockV2,
} from "@/lib/brands/production-pipeline/video-creator-techniques";
import {
  resolveCategoryExperienceProfile,
  type BrandClientCategory,
} from "@/lib/brands/category-experience";
import {
  quoteBrandTwoStageGate,
  quoteBrandVideoRender,
  type BrandStandardDurationSeconds,
  type BrandVideoResolution,
} from "@/lib/brands/production/pricing";
import {
  BRAND_AUDIO_STUDIO_PRESETS,
  BRAND_CORE_DELIVERABLE_TRACKS,
  BRAND_CREATOR_DISTRIBUTION_TIERS,
  BRAND_CREATOR_FORMAT_MODES,
  BRAND_SEEDANCE_VIDEO_TIERS,
  BRAND_STUDIO_IMAGE_MODELS,
  BRAND_STUDIO_MICRO_EDIT_MODELS,
  BRAND_UPSCALING_STUDIO_ENGINES,
  DEFAULT_SPATIAL_BOARD_NODES,
  FIRST_CREATION_GOALS,
  IG_OPTIMIZED_UPSCALE_LOGIC_MODULES,
  MICRO_REGION_SELECTION_PRESETS,
  PINNED_COLOR_REFERENCES,
  PINNED_TEXTURE_REFERENCES,
  STUDIO_SPLIT_PANE_MODES,
  VIDEO_REFERENCE_TARGET_SLOTS,
  bridgeLeftImageToRightVideoReference,
  compileSunraVideoAndUpscalePlan,
  extractBrandKitFromDomain,
  findClosestSupportedAspectRatio,
  resolveCategoryReferenceWorkflows,
  type BrandAudioPresetId,
  type BrandCoreDeliverableTrackId,
  type BrandSeedanceVideoTierId,
  type BrandStudioImageModelId,
  type BrandStudioMicroEditModelId,
  type BrandUpscalerEngineId,
  type BridgedVideoReferenceItem,
  type CreatorCampaignFormatModeId,
  type CreatorDistributionTierId,
  type FirstCreationGoalCard,
  type FirstCreationGoalId,
  type IgUpscaleLogicModuleId,
  type MicroEditQualityTier,
  type MicroEditResolutionTier,
  type SpatialBoardAssetNode,
  type StudioCanvasToolId,
  type StudioImageSubMode,
  type StudioReferenceSlotNumber,
  type StudioReferenceWorkflowId,
  type StudioSplitPaneMode,
  type UpscaleTargetResolution,
  type VideoReferenceTargetSlot,
} from "@/lib/brands/production/reference-studio";

export interface BrandBriefStudioProps {
  organizationId: string;
  organizationName?: string;
  initialCategory?: BrandClientCategory;
  locale: "ko" | "en";
  canWrite: boolean;
  identityConfirmed: boolean;
  defaultChecklist?: readonly string[];
  identityHref?: string;
  initialProjectId?: string;
  initialProjectTitle?: string;
}

interface CategoryVisualAssets {
  sceneThumbs: readonly [string, string, string, string];
  takes: ReadonlyArray<{
    id: string;
    labelKo: string;
    labelEn: string;
    src: string;
  }>;
}

const CATEGORY_STUDIO_VISUALS: Record<
  BrandClientCategory,
  CategoryVisualAssets
> = {
  fashion_apparel: {
    sceneThumbs: [
      "/reel/brands/slot-1-subject-editorial.jpg",
      "/reel/brands/slot-2-space-concrete-blue.jpg",
      "/reel/brands/slot-3-pose-lowangle-lookbook.jpg",
      "/reel/brands/house-runway-1080p.jpg",
    ],
    takes: [
      {
        id: "take-1",
        labelKo: "컷 01 · 정면 히어로",
        labelEn: "Cut 01 · Front Hero",
        src: "/reel/brands/slot-1-subject-editorial.jpg",
      },
      {
        id: "take-2",
        labelKo: "컷 02 · 측면 실루엣",
        labelEn: "Cut 02 · Side Profile",
        src: "/reel/brands/slot-3-pose-lowangle-lookbook.jpg",
      },
      {
        id: "take-3",
        labelKo: "컷 03 · 상반신 디테일",
        labelEn: "Cut 03 · Upper Detail",
        src: "/reel/brands/slot-2-space-concrete-blue.jpg",
      },
    ],
  },
  beauty_skincare: {
    sceneThumbs: [
      "/reel/landing/v7/rx-beauty-product.jpg",
      "/reel/landing/cut-pump.webp",
      "/reel/landing/cut-cheek.webp",
      "/reel/campaigns/beauty-rose.jpg",
    ],
    takes: [
      {
        id: "take-1",
        labelKo: "컷 01 · 정면 보틀 히어로",
        labelEn: "Cut 01 · Bottle Hero",
        src: "/reel/landing/v7/rx-beauty-orig.jpg",
      },
      {
        id: "take-2",
        labelKo: "컷 02 · 텍스처 드롭",
        labelEn: "Cut 02 · Texture Drop",
        src: "/reel/landing/cut-pump.webp",
      },
      {
        id: "take-3",
        labelKo: "컷 03 · 피부 발림 무드",
        labelEn: "Cut 03 · Skin Glow",
        src: "/reel/landing/cut-cheek.webp",
      },
    ],
  },
  fnb_hospitality: {
    sceneThumbs: [
      "/reel/brands/tea-editorial.jpg",
      "/reel/landing/cut-scent.webp",
      "/reel/landing/v7/film-tea.jpg",
      "/reel/brands/production-paris.jpg",
    ],
    takes: [
      {
        id: "take-1",
        labelKo: "컷 01 · 패키지 정물",
        labelEn: "Cut 01 · Package Still",
        src: "/reel/brands/tea-editorial.jpg",
      },
      {
        id: "take-2",
        labelKo: "컷 02 · 테이블 채광",
        labelEn: "Cut 02 · Table Daylight",
        src: "/reel/landing/v7/film-tea.jpg",
      },
      {
        id: "take-3",
        labelKo: "컷 03 · 결로 클로즈업",
        labelEn: "Cut 03 · Dew Macro",
        src: "/reel/landing/cut-scent.webp",
      },
    ],
  },
  lifestyle_object: {
    sceneThumbs: [
      "/reel/studio/vto-free-amber.webp",
      "/reel/landing/cut-beads.webp",
      "/reel/studio/vto-free-sofa.webp",
      "/reel/studio/vto-free-mirror.webp",
    ],
    takes: [
      {
        id: "take-1",
        labelKo: "컷 01 · 오브제 정면",
        labelEn: "Cut 01 · Objet Hero",
        src: "/reel/studio/vto-free-amber.webp",
      },
      {
        id: "take-2",
        labelKo: "컷 02 · 리빙 공간 배치",
        labelEn: "Cut 02 · Living Space",
        src: "/reel/studio/vto-free-sofa.webp",
      },
      {
        id: "take-3",
        labelKo: "컷 03 · 소재 마크로",
        labelEn: "Cut 03 · Material Macro",
        src: "/reel/landing/cut-beads.webp",
      },
    ],
  },
  tech_platform: {
    sceneThumbs: [
      "/reel/brands/y2k-flip-phone.jpg",
      "/reel/landing/cut-mark.webp",
      "/reel/campaigns/retro-phone-01.jpg",
      "/reel/campaigns/retro-phone-02.jpg",
    ],
    takes: [
      {
        id: "take-1",
        labelKo: "컷 01 · 하드웨어 정면",
        labelEn: "Cut 01 · Hardware Front",
        src: "/reel/brands/y2k-flip-phone.jpg",
      },
      {
        id: "take-2",
        labelKo: "컷 02 · 핸즈온 그립",
        labelEn: "Cut 02 · Hands-On Grip",
        src: "/reel/campaigns/retro-phone-01.jpg",
      },
      {
        id: "take-3",
        labelKo: "컷 03 · 엣지 클로즈업",
        labelEn: "Cut 03 · Bezel Detail",
        src: "/reel/campaigns/retro-phone-02.jpg",
      },
    ],
  },
};

const CSS_ASPECT_MAP: Record<ShotAspect, string> = {
  "1:1": "1 / 1",
  "4:5": "4 / 5",
  "3:4": "3 / 4",
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "21:9": "21 / 9",
};

/**
 * Sunra / AMERICANO / Oplux-inspired Multi-Reference & Model-Guided Studio Workbench (`/brand/studio`).
 *
 * Features:
 *   1. Numbered 1–4 Reference Image Deck (`1번 이미지`, `2번 이미지`, `3번 이미지`, `4번 이미지`) with two explicit workflows:
 *      - `인물 · 배경 · 감도 · 색감 조합`: 1번 인물 + 2번 배경 + 3번 이미지 감도 + 4번 색감
 *      - `제품 교체 · 팩샷 리슈팅`: 1번 베이스 장면의 제품을 2번 우리 제품으로 교체 (+ 3번 디테일 + 4번 색감)
 *   2. Image Model Selector with 1-line trait badges + detailed deliverable suitability guide.
 *   3. Always-On Live Studio Canvas with 3-Take Contact Strip & B2B 10–12% Margin Video Pricing.
 */
export function BrandBriefStudio({
  organizationId,
  organizationName,
  initialCategory,
  locale,
  canWrite,
  identityConfirmed,
  defaultChecklist,
  identityHref,
  initialProjectId,
  initialProjectTitle,
}: BrandBriefStudioProps) {
  const isKo = locale === "ko";
  const categoryProfile = resolveCategoryExperienceProfile({
    category: initialCategory,
    organizationName,
    checklist: defaultChecklist,
  });
  const activeCategory = categoryProfile.category;
  const studioVisuals = CATEGORY_STUDIO_VISUALS[activeCategory];
  const referenceWorkflows = resolveCategoryReferenceWorkflows(activeCategory);

  const [activeShotTemplateId, setActiveShotTemplateId] =
    useState<PomelliShotTemplateId>("studio");
  const [medium, setMedium] = useState<DeliverableMedium>("product still");
  const [cutKind, setCutKind] = useState<ShotCutKind>("reference_exact_product");
  const [aspect, setAspect] = useState<ShotAspect>(
    categoryProfile.compiler.defaultAspect,
  );
  const [use, setUse] = useState<DeliverableUse>("feed");
  const [briefText, setBriefText] = useState("");
  const [activeAestheticLineCode, setActiveAestheticLineCode] = useState<
    "A" | "B" | "C"
  >("A");
  const [principleAttachment, setPrincipleAttachment] =
    useState<DesignPrincipleAttachment>(() =>
      createAttachmentPreset("full_attach"),
    );

  // Multi-Reference Workflow Mode (Lookbook 1-4 Composite vs Product 1->2 Swap)
  const [refWorkflowId, setRefWorkflowId] =
    useState<StudioReferenceWorkflowId>("lookbook_composite");
  const activeRefWorkflow = referenceWorkflows[refWorkflowId];

  // Custom uploaded thumbnails & names for Slots 1..4
  const [customSlotThumbs, setCustomSlotThumbs] = useState<
    Partial<Record<StudioReferenceSlotNumber, string>>
  >({});
  const [customSlotNames, setCustomSlotNames] = useState<
    Partial<Record<StudioReferenceSlotNumber, string>>
  >({});

  // Image Studio Sub-Mode: Multi-Ref Generation vs Micro-Region Editing vs Canvas Drag-to-Reference
  const [imageSubMode, setImageSubMode] =
    useState<StudioImageSubMode>("multi_ref_generate");

  // Pinned Color Reference & Pinned Texture Reference (Persists across all workflows & edits)
  const [isColorRefPinned, setIsColorRefPinned] = useState<boolean>(true);
  const [pinnedColorRefId, setPinnedColorRefId] = useState<string>(
    PINNED_COLOR_REFERENCES[0]!.id,
  );
  const [customPinnedColorThumb, setCustomPinnedColorThumb] =
    useState<string>("");
  const [customPinnedColorName, setCustomPinnedColorName] =
    useState<string>("");

  const [isTextureRefPinned, setIsTextureRefPinned] = useState<boolean>(true);
  const [pinnedTextureRefId, setPinnedTextureRefId] = useState<string>(
    PINNED_TEXTURE_REFERENCES[0]!.id,
  );
  const [customPinnedTextureThumb, setCustomPinnedTextureThumb] =
    useState<string>("");
  const [customPinnedTextureName, setCustomPinnedTextureName] =
    useState<string>("");

  const activePinnedColor =
    PINNED_COLOR_REFERENCES.find((c) => c.id === pinnedColorRefId) ??
    PINNED_COLOR_REFERENCES[0]!;
  const activePinnedTexture =
    PINNED_TEXTURE_REFERENCES.find((t) => t.id === pinnedTextureRefId) ??
    PINNED_TEXTURE_REFERENCES[0]!;

  // Oplux + Morphic Canvas Selection Tools & Micro-Region Editing State
  const [activeCanvasTool, setActiveCanvasTool] =
    useState<StudioCanvasToolId>("marquee_select");
  const [activeRegionPresetId, setActiveRegionPresetId] = useState<string>(
    MICRO_REGION_SELECTION_PRESETS[0]!.id,
  );
  const [selectionRect, setSelectionRect] = useState<{
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
  }>({
    xPct: MICRO_REGION_SELECTION_PRESETS[0]!.xPct,
    yPct: MICRO_REGION_SELECTION_PRESETS[0]!.yPct,
    wPct: MICRO_REGION_SELECTION_PRESETS[0]!.wPct,
    hPct: MICRO_REGION_SELECTION_PRESETS[0]!.hPct,
  });
  const [isDraggingMarquee, setIsDraggingMarquee] = useState<boolean>(false);
  const [dragStartPct, setDragStartPct] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [selectedMicroEditModelId, setSelectedMicroEditModelId] =
    useState<BrandStudioMicroEditModelId>("precision_region_editor");
  const [microEditQuality, setMicroEditQuality] =
    useState<MicroEditQualityTier>("High");
  const [microEditResolution, setMicroEditResolution] =
    useState<MicroEditResolutionTier>("2K");
  const [microEditBatchSize, setMicroEditBatchSize] = useState<1 | 2 | 4>(2);
  const [layerVisibility, setLayerVisibility] = useState<{
    regionMask: boolean;
    pinnedStyle: boolean;
    baseImage: boolean;
  }>({
    regionMask: true,
    pinnedStyle: true,
    baseImage: true,
  });

  const activeMicroEditModel =
    BRAND_STUDIO_MICRO_EDIT_MODELS.find(
      (m) => m.id === selectedMicroEditModelId,
    ) ?? BRAND_STUDIO_MICRO_EDIT_MODELS[0]!;
  const activeRegionPreset =
    MICRO_REGION_SELECTION_PRESETS.find((r) => r.id === activeRegionPresetId) ??
    MICRO_REGION_SELECTION_PRESETS[0]!;
  const matchedSelectionRatio = findClosestSupportedAspectRatio(
    selectionRect.wPct * 20.48,
    selectionRect.hPct * 25.6,
  );

  // 5 Core Deliverable Track State (Image / Video / Creator Format / Creator Distribution / Audio)
  const [activeCoreTrack, setActiveCoreTrack] =
    useState<BrandCoreDeliverableTrackId>("image");
  const [creatorFormatMode, setCreatorFormatMode] =
    useState<CreatorCampaignFormatModeId>("self_build");
  const [distributionTierId, setDistributionTierId] =
    useState<CreatorDistributionTierId>("growth_30");
  const [audioPresetId, setAudioPresetId] = useState<BrandAudioPresetId>(
    "runway_french_house",
  );
  const [audioAutoDucking, setAudioAutoDucking] = useState<boolean>(true);
  const [audioCommercialMaster, setAudioCommercialMaster] =
    useState<boolean>(true);

  const activeCreatorFormatSpec =
    BRAND_CREATOR_FORMAT_MODES.find((m) => m.id === creatorFormatMode) ??
    BRAND_CREATOR_FORMAT_MODES[0]!;
  const activeDistributionTier =
    BRAND_CREATOR_DISTRIBUTION_TIERS.find((t) => t.id === distributionTierId) ??
    BRAND_CREATOR_DISTRIBUTION_TIERS[1]!;
  const activeAudioPreset =
    BRAND_AUDIO_STUDIO_PRESETS.find((a) => a.id === audioPresetId) ??
    BRAND_AUDIO_STUDIO_PRESETS[0]!;

  // Image Model Selection & Full Comparison Guide Toggle (5 Models: GPT Image 2.6, Nano Banana Pro, 2.1, 2.0, Seedream 5.0 Pro)
  const [selectedImageModelId, setSelectedImageModelId] =
    useState<BrandStudioImageModelId>("nano_banana_pro");
  const [showFullModelGuide, setShowFullModelGuide] = useState<boolean>(false);
  const activeImageModel =
    BRAND_STUDIO_IMAGE_MODELS.find((m) => m.id === selectedImageModelId) ??
    BRAND_STUDIO_IMAGE_MODELS[0]!;

  // Video production controls (Seedance 2.5 480p Draft / 720p / 1080p + Dedicated Upscaling Studio)
  const [videoResolution, setVideoResolution] =
    useState<BrandVideoResolution>("720p");
  const [videoSeconds, setVideoSeconds] =
    useState<BrandStandardDurationSeconds>(10);
  const [useTwoStageGate, setUseTwoStageGate] = useState<boolean>(true);
  const [selectedSeedanceTierId, setSelectedSeedanceTierId] =
    useState<BrandSeedanceVideoTierId>("seedance_2_5_720p_standard");
  const activeSeedanceTier =
    BRAND_SEEDANCE_VIDEO_TIERS.find((t) => t.id === selectedSeedanceTierId) ??
    BRAND_SEEDANCE_VIDEO_TIERS[1]!;

  // Dedicated Upscaling & Instagram Reels Mastering Studio State
  const [isUpscaleStudioExpanded, setIsUpscaleStudioExpanded] =
    useState<boolean>(true);
  const [selectedUpscalerEngineId, setSelectedUpscalerEngineId] =
    useState<BrandUpscalerEngineId>("sunra_ig_1080p_upscaler");
  const [upscaleTargetResolution, setUpscaleTargetResolution] =
    useState<UpscaleTargetResolution>("1080p");
  const [upscaleSourceKind, setUpscaleSourceKind] = useState<
    "seedance_720p_latest" | "seedance_480p_draft" | "custom_upload"
  >("seedance_720p_latest");
  const [customUpscaleVideoName, setCustomUpscaleVideoName] =
    useState<string>("");
  const [enabledIgModules, setEnabledIgModules] = useState<
    IgUpscaleLogicModuleId[]
  >(() =>
    IG_OPTIMIZED_UPSCALE_LOGIC_MODULES.filter((m) => m.defaultEnabled).map(
      (m) => m.id,
    ),
  );
  const activeUpscalerEngine =
    BRAND_UPSCALING_STUDIO_ENGINES.find(
      (e) => e.id === selectedUpscalerEngineId,
    ) ?? BRAND_UPSCALING_STUDIO_ENGINES[0]!;
  const compiledVideoAndUpscalePlan = compileSunraVideoAndUpscalePlan({
    seedanceTierId: selectedSeedanceTierId,
    durationSec: videoSeconds,
    aspectRatio: aspect,
    upscalerEngineId: selectedUpscalerEngineId,
    targetResolution: upscaleTargetResolution,
    enabledIgModules,
  });

  function handleSelectSeedanceTier(tierId: BrandSeedanceVideoTierId) {
    setSelectedSeedanceTierId(tierId);
    const found = BRAND_SEEDANCE_VIDEO_TIERS.find((t) => t.id === tierId);
    if (found) {
      setVideoResolution(found.resolution);
      if (found.resolution === "480p") {
        setUpscaleSourceKind("seedance_480p_draft");
        setSelectedUpscalerEngineId("sunra_ig_1080p_upscaler");
        setUpscaleTargetResolution("1080p");
      } else if (found.resolution === "720p") {
        setUpscaleSourceKind("seedance_720p_latest");
      }
    }
  }

  function handleSelectUpscalerEngine(engineId: BrandUpscalerEngineId) {
    setSelectedUpscalerEngineId(engineId);
    const engine = BRAND_UPSCALING_STUDIO_ENGINES.find(
      (e) => e.id === engineId,
    );
    if (
      engine &&
      !engine.supportedTargets.includes(upscaleTargetResolution)
    ) {
      setUpscaleTargetResolution(engine.defaultTarget);
    }
  }

  function handleToggleIgLogicModule(modId: IgUpscaleLogicModuleId) {
    setEnabledIgModules((prev) =>
      prev.includes(modId)
        ? prev.filter((id) => id !== modId)
        : [...prev, modId],
    );
  }

  const [upscaleCompareMode, setUpscaleCompareMode] = useState<
    "split" | "before_raw_720p" | "after_twings_1080p"
  >("split");
  const [selectedCreatorSampleIdx, setSelectedCreatorSampleIdx] = useState<
    0 | 1 | 2
  >(0);

  function handleRunUpscaleStudioJob() {
    const sourceLabel =
      customUpscaleVideoName ||
      (upscaleSourceKind === "seedance_480p_draft"
        ? "Seedance 2.5 480p Draft 영상"
        : "Seedance 2.5 720p 생성 영상");
    const newMasterNodeId = `canvas-upscale-master-${Date.now()}`;
    setFreeformItems((prev) => [
      ...prev,
      {
        id: newMasterNodeId,
        nodeRefId: "upscale-ig-master",
        kind: "video",
        src: studioVisuals.sceneThumbs[3] ?? studioVisuals.takes[0]!.src,
        labelKo:
          upscaleTargetResolution === "4K"
            ? "SeedVR2 7B 광학 4K 마스터"
            : "1080p 인스타 릴스 무열화 마스터",
        labelEn:
          upscaleTargetResolution === "4K"
            ? "SeedVR2 7B Optical 4K Master"
            : "1080p IG Reels Anti-Compression Master",
        roleBadgeKo:
          upscaleTargetResolution === "4K" ? "4K 광학 마스터" : "1080p IG 마스터",
        roleBadgeEn:
          upscaleTargetResolution === "4K" ? "4K Optical Master" : "1080p IG Master",
        modelBadgeKo: activeUpscalerEngine.nameKo,
        modelBadgeEn: activeUpscalerEngine.nameEn,
        resBadge:
          upscaleTargetResolution === "4K"
            ? "4K · 2160×3840 · Anti-Boil"
            : "1080p · 14Mbps · CAS 0.25",
        x: 690,
        y: 120,
        width: 224,
        height: 196,
        connectedFromIds: ["canvas-item-video"],
        wireLabelKo: "인스타 무열화 업스케일",
        wireLabelEn: "IG De-AI Upscale",
      },
    ]);
    setSelectedCanvasItemIds([newMasterNodeId]);
    setStatusMessage(
      isKo
        ? `[업스케일링 스튜디오 실행] '${sourceLabel}' → ${activeUpscalerEngine.nameKo} (${upscaleTargetResolution}) 마스터 노드가 2D 캔버스에 생성되었습니다. 적용된 인스타 최적화 로직: ${enabledIgModules.length}개 모듈 활성 (${compiledVideoAndUpscalePlan.upscaleStudio.ffmpegFilterChain})`
        : `[Upscaling Studio Started] '${sourceLabel}' -> ${activeUpscalerEngine.nameEn} (${upscaleTargetResolution}) spawned on 2D canvas with ${enabledIgModules.length} IG optimization modules active.`,
    );
  }

  // Active take on the right-hand live studio canvas
  const [activeTakeIndex, setActiveTakeIndex] = useState<number>(0);

  // Developer-IDE Inspired Collapsible Dual Split-Pane State (`dual_split` | `image_only` | `video_only`)
  const [splitPaneMode, setSplitPaneMode] =
    useState<StudioSplitPaneMode>("dual_split");
  const [workbenchHeaderTab, setWorkbenchHeaderTab] = useState<
    "canvas" | "copilot" | "compose"
  >("canvas");
  const [selectedBridgeSlot, setSelectedBridgeSlot] =
    useState<VideoReferenceTargetSlot>("first_frame");
  const [bridgedVideoRefs, setBridgedVideoRefs] = useState<
    BridgedVideoReferenceItem[]
  >(() => {
    const defaultTake = studioVisuals.takes[0]!;
    return [
      {
        slotId: "first_frame",
        imageSrc: defaultTake.src,
        imageLabelKo: defaultTake.labelKo,
        imageLabelEn: defaultTake.labelEn,
        sourceModelNameKo: "Nano Banana Pro",
        sourceModelNameEn: "Nano Banana Pro",
        citationKo: VIDEO_REFERENCE_TARGET_SLOTS[0]!.promptCitationKo,
        citationEn: VIDEO_REFERENCE_TARGET_SLOTS[0]!.promptCitationEn,
      },
      {
        slotId: "product_ref",
        imageSrc: studioVisuals.sceneThumbs[1],
        imageLabelKo: "2번 · 우리 제품 정면 마스터",
        imageLabelEn: "Slot 2 · Product Front Master",
        sourceModelNameKo: "Nano Banana 2.1",
        sourceModelNameEn: "Nano Banana 2.1",
        citationKo: VIDEO_REFERENCE_TARGET_SLOTS[2]!.promptCitationKo,
        citationEn: VIDEO_REFERENCE_TARGET_SLOTS[2]!.promptCitationEn,
      },
    ];
  });

  function handleBridgeLeftImageToRightVideo(
    targetSlot: VideoReferenceTargetSlot = selectedBridgeSlot,
    customImage?: { src: string; labelKo: string; labelEn: string },
  ) {
    const currentTake =
      studioVisuals.takes[activeTakeIndex] ?? studioVisuals.takes[0]!;
    const imgSrc = customImage?.src ?? currentTake.src;
    const labelKo = customImage?.labelKo ?? currentTake.labelKo;
    const labelEn = customImage?.labelEn ?? currentTake.labelEn;
    const slotSpec =
      VIDEO_REFERENCE_TARGET_SLOTS.find((s) => s.id === targetSlot) ??
      VIDEO_REFERENCE_TARGET_SLOTS[0]!;

    setSelectedBridgeSlot(targetSlot);
    setBridgedVideoRefs((prev) =>
      bridgeLeftImageToRightVideoReference({
        currentRefs: prev,
        slotId: targetSlot,
        imageSrc: imgSrc,
        imageLabelKo: labelKo,
        imageLabelEn: labelEn,
        sourceModelNameKo: activeImageModel.nameKo,
        sourceModelNameEn: activeImageModel.nameEn,
      }),
    );
    if (splitPaneMode === "image_only") {
      setSplitPaneMode("dual_split");
    }
    setBriefText((prev) => {
      const token = isKo ? slotSpec.promptCitationKo : slotSpec.promptCitationEn;
      return prev.includes(token) ? prev : `${token} ${prev}`.trim();
    });
    setStatusMessage(
      isKo
        ? `[좌측 이미지 → 우측 영상 연결 완료] '${labelKo}' (${activeImageModel.nameKo}) 컷이 우측 Seedance 2.5 영상 탭의 '${slotSpec.badgeKo}' 레퍼런스로 들어갔습니다.`
        : `[Bridged to Video] '${labelEn}' (${activeImageModel.nameEn}) attached to Right Video Pane as '${slotSpec.badgeEn}'.`,
    );
  }

  function handleRemoveBridgedVideoRef(slotId: VideoReferenceTargetSlot) {
    setBridgedVideoRefs((prev) => prev.filter((item) => item.slotId !== slotId));
  }

  // Morphic Studio / Krea Canvas Multi-Asset Spatial Board State
  const [isLeftRailCollapsed, setIsLeftRailCollapsed] = useState(true);
  const [selectedBoardNodeIds, setSelectedBoardNodeIds] = useState<string[]>(
    () =>
      DEFAULT_SPATIAL_BOARD_NODES.filter((n) => n.defaultSelected).map(
        (n) => n.id,
      ),
  );

  // Top-level Studio Surface Mode (00 2D Spatial Canvas | Dual Split Workbench | 01 Image | 02 Video & Upscale | 03 Creator Format | 04 Creator Distribution | 05 Audio)
  const [studioSurfaceMode, setStudioSurfaceMode] = useState<
    | "spatial_canvas"
    | "split_workbench"
    | "track_image"
    | "track_video_upscale"
    | "track_creator_format"
    | "track_creator_distribution"
    | "track_audio"
  >("split_workbench");
  const [isNodeInspectorOpen, setIsNodeInspectorOpen] = useState<boolean>(true);
  const [creatorRecipeStep, setCreatorRecipeStep] = useState<1 | 2 | 3>(1);
  const [distributionPlatformFilter, setDistributionPlatformFilter] = useState<
    "all" | "instagram_reels" | "tiktok" | "youtube_shorts"
  >("all");
  const [audioStemMuted, setAudioStemMuted] = useState<{
    bgm: boolean;
    foley: boolean;
    voice: boolean;
  }>({ bgm: false, foley: false, voice: false });
  const [activeFoleyCueSec, setActiveFoleyCueSec] = useState<
    "0.4s" | "1.8s" | "3.2s"
  >("0.4s");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const trackParam = params.get("track");
    if (!trackParam) return;
    if (trackParam === "image" || trackParam === "track_image") {
      setStudioSurfaceMode("track_image");
      setActiveCoreTrack("image");
      setSplitPaneMode("image_only");
    } else if (trackParam === "video" || trackParam === "track_video_upscale") {
      setStudioSurfaceMode("track_video_upscale");
      setActiveCoreTrack("video");
      setSplitPaneMode("video_only");
    } else if (
      trackParam === "creator_format" ||
      trackParam === "track_creator_format"
    ) {
      setStudioSurfaceMode("track_creator_format");
      setActiveCoreTrack("creator_format");
    } else if (
      trackParam === "creator_distribution" ||
      trackParam === "track_creator_distribution"
    ) {
      setStudioSurfaceMode("track_creator_distribution");
      setActiveCoreTrack("creator_distribution");
    } else if (trackParam === "audio" || trackParam === "track_audio") {
      setStudioSurfaceMode("track_audio");
      setActiveCoreTrack("audio");
    } else if (trackParam === "spatial_canvas" || trackParam === "canvas") {
      setStudioSurfaceMode("spatial_canvas");
    }
  }, []);

  // Authentic 2D Freeform Infinite Production Node Canvas Items & Selection State
  const [freeformItems, setFreeformItems] = useState<
    Array<{
      id: string;
      kind: "image" | "video";
      src: string;
      labelKo: string;
      labelEn: string;
      roleBadgeKo: string;
      roleBadgeEn: string;
      modelBadgeKo: string;
      modelBadgeEn: string;
      resBadge: string;
      connectedFromIds?: string[];
      wireLabelKo?: string;
      wireLabelEn?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      nodeRefId?: string;
    }>
  >(() => [
    {
      id: "canvas-item-portrait",
      kind: "image",
      src: studioVisuals.sceneThumbs[0],
      labelKo: "1번 인물 · 에디토리얼 정면",
      labelEn: "Image 1 · Subject Reference",
      roleBadgeKo: "@Image 1 · 인물 고정",
      roleBadgeEn: "@Image 1 · Subject",
      modelBadgeKo: "원본 레퍼런스",
      modelBadgeEn: "Source Ref",
      resBadge: "4:5 · RAW",
      x: 44,
      y: 74,
      width: 172,
      height: 224,
      nodeRefId: "node_ref_subject",
    },
    {
      id: "canvas-item-product",
      kind: "image",
      src: studioVisuals.sceneThumbs[1],
      labelKo: "2번 제품 · 오브제 무변형",
      labelEn: "Image 2 · Product Lock",
      roleBadgeKo: "@Image 2 · 제품 무변형",
      roleBadgeEn: "@Image 2 · Product Lock",
      modelBadgeKo: "로고·실루엣 락",
      modelBadgeEn: "Logo Lock",
      resBadge: "1:1 · RAW",
      x: 44,
      y: 320,
      width: 172,
      height: 196,
      nodeRefId: "node_ref_product",
    },
    {
      id: "canvas-item-lookbook",
      kind: "image",
      src: studioVisuals.sceneThumbs[2],
      labelKo: "생성 화보 · 1+2번 결합 룩북",
      labelEn: "Generated Lookbook Cut",
      roleBadgeKo: "화보 마스터 컷",
      roleBadgeEn: "Generated Still",
      modelBadgeKo: "Nano Banana Pro",
      modelBadgeEn: "Nano Banana Pro",
      resBadge: "2K · 4:5",
      connectedFromIds: ["canvas-item-portrait", "canvas-item-product"],
      wireLabelKo: "1+2번 슬롯 합성",
      wireLabelEn: "Slot 1+2 Merge",
      x: 312,
      y: 146,
      width: 188,
      height: 244,
      nodeRefId: "node_still_cut_01",
    },
    {
      id: "canvas-item-video",
      kind: "video",
      src: studioVisuals.sceneThumbs[3],
      labelKo: "Seedance 2.5 모션 클립 (시작 프레임 고정)",
      labelEn: "Seedance 2.5 Motion Clip",
      roleBadgeKo: "영상 생성 · 시작 프레임",
      roleBadgeEn: "Video · Start Frame",
      modelBadgeKo: "Seedance 2.5",
      modelBadgeEn: "Seedance 2.5",
      resBadge: "720p → 1080p IG",
      connectedFromIds: ["canvas-item-lookbook"],
      wireLabelKo: "시작 프레임 연결",
      wireLabelEn: "First Frame Lock",
      x: 594,
      y: 168,
      width: 224,
      height: 196,
      nodeRefId: "node_video_seedance",
    },
  ]);

  const [selectedCanvasItemIds, setSelectedCanvasItemIds] = useState<string[]>([
    "canvas-item-lookbook",
    "canvas-item-video",
  ]);
  const [attachedCanvasItemIds, setAttachedCanvasItemIds] = useState<string[]>(
    [],
  );
  const [isSelectionOverlayVisible, setIsSelectionOverlayVisible] =
    useState<boolean>(true);
  const [playingCanvasItemId, setPlayingCanvasItemId] = useState<string | null>(
    null,
  );
  const [canvasZoomPct, setCanvasZoomPct] = useState<number>(100);
  const [dockPopover, setDockPopover] = useState<
    "none" | "model" | "aspect" | "workflows" | "tools"
  >("none");
  const [draggingCanvasItem, setDraggingCanvasItem] = useState<{
    id: string;
    startMouseX: number;
    startMouseY: number;
    initialPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [rubberBandBox, setRubberBandBox] = useState<{
    startX: number;
    startY: number;
    currX: number;
    currY: number;
  } | null>(null);

  function handleAttachFreeformSelection() {
    if (selectedCanvasItemIds.length === 0) return;
    setAttachedCanvasItemIds((prev) =>
      Array.from(new Set([...prev, ...selectedCanvasItemIds])),
    );
    setIsSelectionOverlayVisible(false);
    const firstSelected = freeformItems.find((i) =>
      selectedCanvasItemIds.includes(i.id),
    );
    if (firstSelected) {
      handleBridgeLeftImageToRightVideo("first_frame", {
        src: firstSelected.src,
        labelKo: firstSelected.labelKo,
        labelEn: firstSelected.labelEn,
      });
    }
  }

  function handleSpawnGeneratedItemOnCanvas() {
    const newIndex = freeformItems.length + 1;
    const isVid = medium === "short film";
    const newId = `canvas-item-gen-${newIndex}`;
    const sourceConnectIds =
      selectedCanvasItemIds.length > 0
        ? [...selectedCanvasItemIds]
        : ["canvas-item-lookbook"];
    const newItem = {
      id: newId,
      kind: isVid ? ("video" as const) : ("image" as const),
      src: isVid
        ? studioVisuals.sceneThumbs[3]
        : studioVisuals.takes[newIndex % studioVisuals.takes.length]!.src,
      labelKo: isVid
        ? `Seedance 2.5 (${videoResolution}) 생성 영상 #${newIndex}`
        : `${activeImageModel.nameKo} 생성 화보 #${newIndex}`,
      labelEn: isVid
        ? `Seedance 2.5 (${videoResolution}) Clip #${newIndex}`
        : `${activeImageModel.nameEn} Cut #${newIndex}`,
      roleBadgeKo: isVid ? "생성 영상 노드" : "생성 화보 노드",
      roleBadgeEn: isVid ? "Generated Video" : "Generated Still",
      modelBadgeKo: isVid ? "Seedance 2.5" : activeImageModel.nameKo,
      modelBadgeEn: isVid ? "Seedance 2.5" : activeImageModel.nameEn,
      resBadge: isVid ? `${videoResolution} · ${videoSeconds}s` : `2K · ${aspect}`,
      connectedFromIds: sourceConnectIds,
      wireLabelKo: isVid ? "모션 확장" : "레퍼런스 파생",
      wireLabelEn: isVid ? "Motion Render" : "Derived Cut",
      x: 340 + ((newIndex * 64) % 340),
      y: 260 + ((newIndex * 34) % 110),
      width: isVid ? 216 : 176,
      height: isVid ? 188 : 228,
    };
    setFreeformItems((prev) => [...prev, newItem]);
    setSelectedCanvasItemIds([newId]);
    setIsSelectionOverlayVisible(false);
    setStatusMessage(
      isVid
        ? isKo
          ? `캔버스에 Seedance 2.5 (${videoResolution}) 새 영상 노드가 연결·배치되었습니다.`
          : `New Seedance 2.5 (${videoResolution}) video node connected and placed on canvas.`
        : isKo
          ? `캔버스에 ${activeImageModel.nameKo} 새 화보 노드가 연결·배치되었습니다.`
          : `New ${activeImageModel.nameEn} image node connected and placed on canvas.`,
    );
  }

  function handleSpawnTypedCanvasNode(
    nodeType: "image_ref" | "video_seedance" | "upscale_1080p",
  ) {
    const newIndex = freeformItems.length + 1;
    const newId = `canvas-item-spawn-${nodeType}-${newIndex}`;
    const sourceConnectIds =
      selectedCanvasItemIds.length > 0
        ? [selectedCanvasItemIds[selectedCanvasItemIds.length - 1]!]
        : ["canvas-item-lookbook"];

    const spawnedNode =
      nodeType === "image_ref"
        ? {
            id: newId,
            kind: "image" as const,
            src: studioVisuals.takes[newIndex % studioVisuals.takes.length]!.src,
            labelKo: `${activeImageModel.nameKo} 레퍼런스 화보 #${newIndex}`,
            labelEn: `${activeImageModel.nameEn} Ref Still #${newIndex}`,
            roleBadgeKo: `@Image ${(newIndex % 4) + 1} · 화보 레퍼런스`,
            roleBadgeEn: `@Image ${(newIndex % 4) + 1} · Still Ref`,
            modelBadgeKo: activeImageModel.nameKo,
            modelBadgeEn: activeImageModel.nameEn,
            resBadge: `2K · ${aspect}`,
            connectedFromIds: sourceConnectIds,
            wireLabelKo: "레퍼런스 파생",
            wireLabelEn: "Ref Branch",
            x: 280 + ((newIndex * 58) % 360),
            y: 120 + ((newIndex * 42) % 180),
            width: 176,
            height: 224,
          }
        : nodeType === "video_seedance"
          ? {
              id: newId,
              kind: "video" as const,
              src: studioVisuals.sceneThumbs[3],
              labelKo: `Seedance 2.5 (${videoResolution}) 모션 클립 #${newIndex}`,
              labelEn: `Seedance 2.5 (${videoResolution}) Motion #${newIndex}`,
              roleBadgeKo: "Seedance 2.5 · 시작 프레임 잠금",
              roleBadgeEn: "Seedance 2.5 · Start Frame",
              modelBadgeKo: "Seedance 2.5",
              modelBadgeEn: "Seedance 2.5",
              resBadge: `${videoResolution} · ${videoSeconds}s`,
              connectedFromIds: sourceConnectIds,
              wireLabelKo: "시작 프레임 연결",
              wireLabelEn: "First Frame Lock",
              x: 520 + ((newIndex * 48) % 240),
              y: 140 + ((newIndex * 38) % 160),
              width: 220,
              height: 194,
            }
          : {
              id: newId,
              kind: "video" as const,
              src: studioVisuals.sceneThumbs[3],
              labelKo: `Sunra 1080p 인스타 무열화 마스터 #${newIndex}`,
              labelEn: `Sunra 1080p IG De-AI Master #${newIndex}`,
              roleBadgeKo: "1080p 인스타 마스터링 · CAS 0.25",
              roleBadgeEn: "1080p IG Master · CAS 0.25",
              modelBadgeKo: "Sunra 1080p + SeedVR2",
              modelBadgeEn: "Sunra 1080p + SeedVR2",
              resBadge: "1080p · 14Mbps · -14 LUFS",
              connectedFromIds: sourceConnectIds,
              wireLabelKo: "1080p 무열화 업스케일",
              wireLabelEn: "1080p IG Upscale",
              x: 620 + ((newIndex * 40) % 180),
              y: 220 + ((newIndex * 36) % 140),
              width: 224,
              height: 194,
            };

    setFreeformItems((prev) => [...prev, spawnedNode]);
    setSelectedCanvasItemIds([newId]);
    setIsSelectionOverlayVisible(false);
  }

  function handleConnectSelectedCanvasNodes() {
    if (selectedCanvasItemIds.length < 2) return;
    const [sourceId, targetId] = selectedCanvasItemIds;
    if (!sourceId || !targetId) return;
    setFreeformItems((prev) =>
      prev.map((item) => {
        if (item.id !== targetId) return item;
        const existing = item.connectedFromIds ?? [];
        if (existing.includes(sourceId)) return item;
        return {
          ...item,
          connectedFromIds: [...existing, sourceId],
          wireLabelKo: item.wireLabelKo ?? "레퍼런스 와이어 연결",
          wireLabelEn: item.wireLabelEn ?? "Reference Wire",
        };
      }),
    );
  }

  function handleFitCanvasView() {
    setCanvasZoomPct(100);
    setFreeformItems((prev) =>
      prev.map((item, idx) => {
        if (idx === 0) return { ...item, x: 44, y: 74 };
        if (idx === 1) return { ...item, x: 44, y: 320 };
        if (idx === 2) return { ...item, x: 312, y: 146 };
        if (idx === 3) return { ...item, x: 594, y: 168 };
        return item;
      }),
    );
  }

  function handleToggleBoardNode(node: SpatialBoardAssetNode) {
    setSelectedBoardNodeIds((prev) =>
      prev.includes(node.id)
        ? prev.filter((id) => id !== node.id)
        : [...prev, node.id],
    );
    if (node.kind === "generated_still") {
      handleBridgeLeftImageToRightVideo("first_frame", {
        src: node.thumbSrc,
        labelKo: node.titleKo,
        labelEn: node.titleEn,
      });
    }
  }

  // Under-the-hood compiled system state
  const [lookPresetId, setLookPresetId] =
    useState<BrandLookPresetId>("kodak-2383-warm");
  const [cameraFocalMm, setCameraFocalMm] = useState(85);
  const [lightColourK, setLightColourK] = useState(
    categoryProfile.compiler.defaultLightColourK,
  );
  const [lightModifier, setLightModifier] = useState(
    "large diffused window softbox",
  );
  const [spaceBackground, setSpaceBackground] = useState(
    "soft daylight plaster wall with generous negative space",
  );
  const [spaceSurface, setSpaceSurface] = useState("honed limestone tabletop");

  const [briefState, setBriefState] = useState<BrandBriefState | null>(null);
  const [view, setView] = useState<CustomerBriefView | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const aestheticLines = synthesizeMultiAestheticLines({
    brandName: organizationName || "BRAND",
    category: activeCategory,
    preferredVibe: "minimal_editorial",
    hasPinterestBoards: true,
  });

  const silentOpticalGuard = evaluateOpticalIdentityLockV2({
    focalLengthMm: cameraFocalMm,
    headWidthRatioPct: 42,
    hasFaceOcclusion: false,
    locale,
  });
  const silentOledPlan = compileOledCinemaColorGradePlan({
    lookId:
      activeAestheticLineCode === "B"
        ? "kodak-2383-campaign"
        : activeAestheticLineCode === "C"
          ? "dark-fairy-cinema"
          : categoryProfile.compiler.defaultOledLookId,
    locale,
  });
  const silentContinuity = auditMultiShotContinuity({ clipCount: 4, locale });
  const silentMasterPlan = buildTwoStageApprovalAndReelsMasterPlan({
    gateStatus: "stage2_1080p_master",
    locale,
  });

  // Live B2B Video Pricing Quotes (10~12% target net margin)
  const activeVideoQuote =
    quoteBrandVideoRender({
      model: "seedance-2.5",
      resolution: videoResolution,
      seconds: videoSeconds,
      aspect,
    }) ??
    quoteBrandVideoRender({
      model: "seedance-2.5",
      resolution: "720p",
      seconds: 10,
      aspect: "9:16",
    })!;
  const twoStageGateQuote = quoteBrandTwoStageGate({
    model: "seedance-2.5",
    seconds: videoSeconds,
    aspect,
  });

  const resolvedDefaultChecklist =
    defaultChecklist && defaultChecklist.length >= 3
      ? [defaultChecklist[0]!, defaultChecklist[1]!, defaultChecklist[2]!]
      : [
          categoryProfile.compiler.defaultProductChecklist.geometry,
          categoryProfile.compiler.defaultProductChecklist.label,
          categoryProfile.compiler.defaultProductChecklist.material,
        ];

  const [isIdentityConfirmedLocal, setIsIdentityConfirmedLocal] =
    useState<boolean>(identityConfirmed);
  const [isEditingIdentity, setIsEditingIdentity] = useState<boolean>(
    !identityConfirmed,
  );
  const [editableRules, setEditableRules] = useState<[string, string, string]>([
    resolvedDefaultChecklist[0]!,
    resolvedDefaultChecklist[1]!,
    resolvedDefaultChecklist[2]!,
  ]);
  const resolvedChecklist = editableRules;

  // Website URL Brand Kit Auto-Builder (Logo · Colors · Type) & First Creation Goal State
  const defaultDomain = organizationName
    ? `${organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "brand"}.com`
    : "twings.app";
  const [brandDomainInput, setBrandDomainInput] =
    useState<string>(defaultDomain);
  const [selectedFirstGoalId, setSelectedFirstGoalId] =
    useState<FirstCreationGoalId>("fashion_lookbook");
  const extractedBrandKit = extractBrandKitFromDomain(
    brandDomainInput,
    activeCategory,
  );

  function handleAutoExtractBrandKit() {
    const kit = extractBrandKitFromDomain(brandDomainInput, activeCategory);
    setEditableRules(isKo ? kit.rulesKo : kit.rulesEn);
    setPinnedColorRefId(kit.recommendedPinnedColorId);
    setPinnedTextureRefId(kit.recommendedPinnedTextureId);
    setIsColorRefPinned(true);
    setIsTextureRefPinned(true);
    setStatusMessage(
      isKo
        ? `${kit.domain} 웹사이트 기준으로 브랜드 킷(Logo · Colors · Type)과 3대 아이덴티티 규칙, 고정 색감·질감 핀이 자동 설정되었습니다.`
        : `Brand Kit (Logo · Colors · Type), 3 identity rules, and Pinned Color/Texture locks extracted from ${kit.domain}.`,
    );
  }

  function handleSelectCoreTrack(trackId: BrandCoreDeliverableTrackId) {
    setActiveCoreTrack(trackId);
    if (trackId === "image") {
      handleSwitchMediumMode("image");
    } else {
      handleSwitchMediumMode("video");
    }
  }

  function handleSelectFirstCreationGoal(goal: FirstCreationGoalCard) {
    setSelectedFirstGoalId(goal.id);
    setActiveCoreTrack(goal.targetTrack);
    if (goal.targetMedium === "video") {
      handleSwitchMediumMode("video");
    } else {
      handleSwitchMediumMode("image");
      setImageSubMode(goal.targetSubMode);
      setRefWorkflowId(goal.targetWorkflowMode);
      setSelectedImageModelId(goal.targetImageModelId);
      setAspect(goal.targetAspect);
    }
  }

  async function handleConfirmBrandIdentity() {
    setIsIdentityConfirmedLocal(true);
    setIsEditingIdentity(false);
    setStatusMessage(
      isKo
        ? "1단계 완료: 브랜드 아이덴티티(제품·로고·질감 원칙 및 대표 무드)가 스튜디오에 등록되었습니다. 이제 아래 1~4번 레퍼런스를 배치해 화보·영상을 제작하세요."
        : "Step 1 complete: Brand Identity rules and default mood are now active in the studio.",
    );
    try {
      await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "identity.confirm",
          input: {
            organizationId,
            productChecklist: editableRules,
            lookPresetId,
          },
        }),
      });
    } catch {
      // Local studio state remains confirmed even if offline/fixture
    }
  }

  function handleSwitchMediumMode(targetMode: "image" | "video") {
    if (targetMode === "video") {
      if (activeCoreTrack === "image") {
        setActiveCoreTrack("video");
      }
      setMedium("short film");
      setCutKind("short_film_clip");
      setAspect("9:16");
      setUse("reel");
      setCameraFocalMm(categoryProfile.scenes[3].focalMm);
    } else {
      setActiveCoreTrack("image");
      const tpl =
        POMELLI_SHOT_TEMPLATES.find((t) => t.id === activeShotTemplateId) ??
        POMELLI_SHOT_TEMPLATES[0]!;
      setMedium(tpl.medium);
      setCutKind(tpl.cutKind);
      setAspect(tpl.defaultAspect);
      setUse(tpl.defaultUse);
      setCameraFocalMm(tpl.focalMm);
    }
  }

  function handleSelectWorkflowMode(mode: StudioReferenceWorkflowId) {
    setRefWorkflowId(mode);
    const wf = referenceWorkflows[mode];
    setBriefText(isKo ? wf.defaultPromptKo : wf.defaultPromptEn);
    if (mode === "product_swap") {
      setSelectedImageModelId("nano_banana_2_1");
    } else {
      setSelectedImageModelId("nano_banana_pro");
    }
  }

  function handleSelectImageModel(modelId: BrandStudioImageModelId) {
    setSelectedImageModelId(modelId);
  }

  function handleSlotFileUpload(
    slotNumber: StudioReferenceSlotNumber,
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setCustomSlotThumbs((prev) => ({ ...prev, [slotNumber]: objectUrl }));
    setCustomSlotNames((prev) => ({ ...prev, [slotNumber]: file.name }));
    setStatusMessage(
      isKo
        ? `${slotNumber}번 이미지(${file.name})가 레퍼런스 슬롯에 연결되었습니다.`
        : `Image ${slotNumber} (${file.name}) attached to reference slot ${slotNumber}.`,
    );
  }

  function handleInsertSlotReferenceIntoPrompt(
    slotNumber: StudioReferenceSlotNumber,
    roleTitle: string,
  ) {
    const token = isKo
      ? `${slotNumber}번 이미지(${roleTitle})`
      : `Image ${slotNumber} (${roleTitle})`;
    setBriefText((prev) =>
      prev.trim().length > 0 ? `${prev.trim()} · ${token}` : token,
    );
  }

  function handleSwitchImageSubMode(nextMode: StudioImageSubMode) {
    setImageSubMode(nextMode);
    if (nextMode === "micro_region_edit") {
      setActiveCanvasTool("marquee_select");
      setBriefText(
        isKo
          ? activeRegionPreset.defaultEditPromptKo
          : activeRegionPreset.defaultEditPromptEn,
      );
    } else if (nextMode === "canvas_drag_ref") {
      setActiveCanvasTool("marquee_select");
      setBriefText(
        isKo
          ? "[캔버스 드래그 선택: 1번 인물 컷 + 2번 장면 레퍼런스 첨부됨] 드래그해 묶은 두 레퍼런스의 인물과 공간·조명 감도를 결합해 새 화보 컷을 생성해 줘."
          : "[Canvas Drag Selection: Subject Cut + Scene Reference Attached] Combine the subject and spatial lighting sensitivity from the dragged canvas selection.",
      );
    } else {
      setBriefText(
        isKo
          ? activeRefWorkflow.defaultPromptKo
          : activeRefWorkflow.defaultPromptEn,
      );
    }
  }

  function handleSelectRegionPreset(presetId: string) {
    const found =
      MICRO_REGION_SELECTION_PRESETS.find((p) => p.id === presetId) ??
      MICRO_REGION_SELECTION_PRESETS[0]!;
    setActiveRegionPresetId(found.id);
    setSelectionRect({
      xPct: found.xPct,
      yPct: found.yPct,
      wPct: found.wPct,
      hPct: found.hPct,
    });
    setImageSubMode("micro_region_edit");
    setActiveCanvasTool("marquee_select");
    setBriefText(
      isKo ? found.defaultEditPromptKo : found.defaultEditPromptEn,
    );
  }

  function handleCanvasMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (isVideoMode || activeCanvasTool === "pointer") return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(
      0,
      Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
    );
    const y = Math.max(
      0,
      Math.min(100, ((e.clientY - rect.top) / rect.height) * 100),
    );
    setIsDraggingMarquee(true);
    setDragStartPct({ x, y });
    setSelectionRect({
      xPct: Math.round(x),
      yPct: Math.round(y),
      wPct: 14,
      hPct: 14,
    });
  }

  function handleCanvasMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!isDraggingMarquee || !dragStartPct) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const curX = Math.max(
      0,
      Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
    );
    const curY = Math.max(
      0,
      Math.min(100, ((e.clientY - rect.top) / rect.height) * 100),
    );
    const left = Math.min(dragStartPct.x, curX);
    const top = Math.min(dragStartPct.y, curY);
    const width = Math.max(12, Math.abs(curX - dragStartPct.x));
    const height = Math.max(12, Math.abs(curY - dragStartPct.y));
    setSelectionRect({
      xPct: Math.round(left),
      yPct: Math.round(top),
      wPct: Math.round(Math.min(100 - left, width)),
      hPct: Math.round(Math.min(100 - top, height)),
    });
  }

  function handleCanvasMouseUp() {
    if (!isDraggingMarquee) return;
    setIsDraggingMarquee(false);
    setDragStartPct(null);
  }

  function handleAttachCanvasSelection() {
    const boundsLabel = `${selectionRect.xPct}%,${selectionRect.yPct}% (${selectionRect.wPct}×${selectionRect.hPct}% · ${matchedSelectionRatio})`;
    if (imageSubMode === "micro_region_edit") {
      const token = isKo
        ? `[선택 부위 패치 첨부됨: ${activeRegionPreset.labelKo} ${boundsLabel} · 영역 외 픽셀 100% 마스크 보존]`
        : `[Selected Patch Attached: ${activeRegionPreset.labelEn} ${boundsLabel} · Smart Mask Lock ON]`;
      setBriefText((prev) =>
        prev.includes(boundsLabel)
          ? prev
          : `${token} ${prev || (isKo ? activeRegionPreset.defaultEditPromptKo : activeRegionPreset.defaultEditPromptEn)}`.trim(),
      );
      setStatusMessage(
        isKo
          ? `드래그한 선택 영역(${boundsLabel})이 Input Preview 및 스마트 레이어 마스크 편집 대상으로 첨부되었습니다.`
          : `Dragged selection (${boundsLabel}) attached to Input Preview with Smart Layer Mask lock.`,
      );
    } else {
      const token = isKo
        ? `[캔버스 드래그 레퍼런스 첨부됨: ${activeTake.labelKo} ${boundsLabel}]`
        : `[Canvas Drag Reference Attached: ${activeTake.labelEn} ${boundsLabel}]`;
      setBriefText((prev) =>
        prev.includes(boundsLabel) ? prev : `${token} ${prev}`.trim(),
      );
      setStatusMessage(
        isKo
          ? `캔버스에서 드래그한 영역(${boundsLabel})이 레퍼런스로 첨부되었습니다.`
          : `Dragged canvas selection (${boundsLabel}) attached as reference.`,
      );
    }
  }

  function handlePinnedColorFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setCustomPinnedColorThumb(objectUrl);
    setCustomPinnedColorName(file.name);
    setIsColorRefPinned(true);
    setCustomSlotThumbs((prev) => ({ ...prev, 4: objectUrl }));
    setCustomSlotNames((prev) => ({ ...prev, 4: file.name }));
    setStatusMessage(
      isKo
        ? `색감 참고용 레퍼런스(${file.name})가 상시 고정(Pin)되었습니다. 다른 슬롯을 바꿔도 이 색감이 계속 유지됩니다.`
        : `Color reference (${file.name}) pinned across all studio runs.`,
    );
  }

  function handlePinnedTextureFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setCustomPinnedTextureThumb(objectUrl);
    setCustomPinnedTextureName(file.name);
    setIsTextureRefPinned(true);
    setCustomSlotThumbs((prev) => ({ ...prev, 3: objectUrl }));
    setCustomSlotNames((prev) => ({ ...prev, 3: file.name }));
    setStatusMessage(
      isKo
        ? `이미지 질감 참고용 레퍼런스(${file.name})가 상시 고정(Pin)되었습니다. 생성과 부분 수정 모두에 동일 질감이 적용됩니다.`
        : `Texture reference (${file.name}) pinned across all studio runs.`,
    );
  }

  function handleSelectSceneType(
    template: PomelliShotTemplate | "short_video",
    sceneIndex: number,
  ) {
    setActiveTakeIndex(sceneIndex % studioVisuals.takes.length);
    if (template === "short_video") {
      setMedium("short film");
      setCutKind("short_film_clip");
      setAspect("9:16");
      setUse("reel");
      setCameraFocalMm(categoryProfile.scenes[3].focalMm);
      return;
    }
    setActiveShotTemplateId(template.id);
    setCutKind(template.cutKind);
    setMedium(template.medium);
    setAspect(template.defaultAspect);
    setUse(template.defaultUse);
    setCameraFocalMm(template.focalMm);
    setLightColourK(template.lightColourK);
    setLightModifier(template.lightModifier);
    setSpaceBackground(template.spaceBackground);
    setSpaceSurface(template.spaceSurface);
  }

  function applyMood(line: BrandAestheticLine) {
    setActiveAestheticLineCode(line.code);
    setLookPresetId(line.lookPresetId);
    setCameraFocalMm(line.focalMm);
    setLightModifier(line.lightModifier);
    setLightColourK(line.lightColourK);
    setSpaceBackground(line.spaceBackground);
    setSpaceSurface(line.spaceSurface);
  }

  function toggleBrandStyleMode(mode: DesignPrincipleAttachmentMode) {
    setPrincipleAttachment(createAttachmentPreset(mode));
  }

  function togglePrincipleKey(key: DesignPrincipleKey) {
    setPrincipleAttachment((prev) => ({
      ...prev,
      mode: "custom_partial",
      [key]: !prev[key],
    }));
  }

  async function onCompileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite || busy) return;
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");

    const basePrompt =
      briefText.trim() ||
      (imageSubMode === "micro_region_edit"
        ? isKo
          ? activeRegionPreset.defaultEditPromptKo
          : activeRegionPreset.defaultEditPromptEn
        : isKo
          ? activeRefWorkflow.defaultPromptKo
          : activeRefWorkflow.defaultPromptEn);

    const pinnedParts: string[] = [];
    if (isColorRefPinned) {
      pinnedParts.push(
        isKo ? activePinnedColor.promptTokenKo : activePinnedColor.promptTokenEn,
      );
    }
    if (isTextureRefPinned) {
      pinnedParts.push(
        isKo
          ? activePinnedTexture.promptTokenKo
          : activePinnedTexture.promptTokenEn,
      );
    }
    if (!isVideoMode && imageSubMode === "micro_region_edit") {
      pinnedParts.push(
        isKo
          ? `[스마트 레이어 마스크 편집 영역: x=${selectionRect.xPct}%, y=${selectionRect.yPct}%, w=${selectionRect.wPct}%, h=${selectionRect.hPct}% (${matchedSelectionRatio}) · 해상도=${microEditResolution} · 품질=${microEditQuality}]`
          : `[Smart Layer Mask Bounds: x=${selectionRect.xPct}%, y=${selectionRect.yPct}%, w=${selectionRect.wPct}%, h=${selectionRect.hPct}% (${matchedSelectionRatio}) · Res=${microEditResolution} · Quality=${microEditQuality}]`,
      );
    }
    const promptToUse = [...pinnedParts, basePrompt].join(" ").trim();

    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "brief.compile",
          input: {
            organizationId,
            principleAttachment,
            ...(initialProjectId
              ? {
                  projectId: initialProjectId,
                  projectOverride: {
                    projectId: initialProjectId,
                    enabled: true,
                    title: initialProjectTitle ?? "Campaign",
                    lookPresetId,
                    cameraOverride: { focalMm: cameraFocalMm },
                    lightOverride: {
                      modifier: lightModifier,
                      colourK: lightColourK,
                    },
                    spaceOverride: {
                      background: spaceBackground,
                      surface: spaceSurface,
                    },
                    projectProductChecklist: [...resolvedChecklist],
                    isolateProjectMemory: true,
                  },
                }
              : {}),
            quick: {
              brief: promptToUse,
              cutKind,
              medium,
              aspect,
              use,
              labelLock:
                resolvedChecklist[0] ??
                "front label centered with crisp brand typography",
              cameraFocalMm,
              lightModifier,
              lightColourK,
              spaceBackground,
              spaceSurface,
            },
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setErrorMessage(
          typeof payload.message === "string" && payload.message
            ? payload.message
            : isKo
              ? "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
              : "Could not complete the request. Please try again.",
        );
        return;
      }
      setBriefState(payload.brief as BrandBriefState);
      setView(payload.view as CustomerBriefView);
      setStatusMessage(
        medium === "short film"
          ? isKo
            ? `${videoSeconds}초 ${videoResolution} 마스터 영상 장면이 1~4번 레퍼런스 설정에 맞춰 생성되었습니다.`
            : `${videoSeconds}s ${videoResolution} video scene generated with your 1–4 reference locks.`
          : isKo
            ? `[${activeImageModel.nameKo}] 모델로 1~4번 레퍼런스가 반영된 2K 화보 5장 세트가 준비되었습니다.`
            : `2K 5-shot set prepared with [${activeImageModel.nameEn}] and your 1–4 reference slots.`,
      );
    } catch {
      setErrorMessage(
        isKo
          ? "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
          : "Please check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onApproveAndFinalize() {
    if (!canWrite || !briefState || busy) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const approveRes = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "brief.approve",
          input: {
            organizationId,
            current: briefState,
            aestheticGatePassed: true,
          },
        }),
      });
      const approvedPayload = await approveRes.json();
      if (approveRes.ok && approvedPayload.ok) {
        setBriefState(approvedPayload.brief as BrandBriefState);
        setView(approvedPayload.view as CustomerBriefView);
        setStatusMessage(
          isKo
            ? "최종 승인되어 콘텐츠 보관함에 저장되었습니다."
            : "Approved and saved to your Content Library.",
        );
      }
    } catch {
      setErrorMessage(
        isKo ? "승인 처리 중 오류가 발생했습니다." : "Could not approve.",
      );
    } finally {
      setBusy(false);
    }
  }

  const moodLabels: Record<"A" | "B" | "C", { ko: string; en: string }> = {
    A: { ko: "깔끔한 에디토리얼", en: "Clean Editorial" },
    B: { ko: "따뜻한 자연광", en: "Warm Daylight" },
    C: { ko: "선명한 스튜디오", en: "Crisp Studio" },
  };

  const simpleSceneButtons: ReadonlyArray<{
    id: string;
    specLabel: string;
    labelKo: string;
    labelEn: string;
    descKo: string;
    descEn: string;
    placeholderKo: string;
    placeholderEn: string;
    quickPromptsKo: readonly [string, string, string];
    quickPromptsEn: readonly [string, string, string];
    thumbSrc: string;
    isVideo?: boolean;
    template?: PomelliShotTemplate;
  }> = [
    {
      id: "studio",
      specLabel: `${categoryProfile.scenes[0].focalMm}mm · ${categoryProfile.scenes[0].defaultAspect}`,
      labelKo: categoryProfile.scenes[0].titleKo,
      labelEn: categoryProfile.scenes[0].titleEn,
      descKo: categoryProfile.scenes[0].descKo,
      descEn: categoryProfile.scenes[0].descEn,
      placeholderKo: categoryProfile.scenes[0].placeholderKo,
      placeholderEn: categoryProfile.scenes[0].placeholderEn,
      quickPromptsKo: categoryProfile.scenes[0].quickPromptsKo,
      quickPromptsEn: categoryProfile.scenes[0].quickPromptsEn,
      thumbSrc: studioVisuals.sceneThumbs[0],
      template: POMELLI_SHOT_TEMPLATES[0],
    },
    {
      id: "ingredients",
      specLabel: `${categoryProfile.scenes[1].focalMm}mm · ${categoryProfile.scenes[1].defaultAspect}`,
      labelKo: categoryProfile.scenes[1].titleKo,
      labelEn: categoryProfile.scenes[1].titleEn,
      descKo: categoryProfile.scenes[1].descKo,
      descEn: categoryProfile.scenes[1].descEn,
      placeholderKo: categoryProfile.scenes[1].placeholderKo,
      placeholderEn: categoryProfile.scenes[1].placeholderEn,
      quickPromptsKo: categoryProfile.scenes[1].quickPromptsKo,
      quickPromptsEn: categoryProfile.scenes[1].quickPromptsEn,
      thumbSrc: studioVisuals.sceneThumbs[1],
      template: POMELLI_SHOT_TEMPLATES[1],
    },
    {
      id: "in_use",
      specLabel: `${categoryProfile.scenes[2].focalMm}mm · ${categoryProfile.scenes[2].defaultAspect}`,
      labelKo: categoryProfile.scenes[2].titleKo,
      labelEn: categoryProfile.scenes[2].titleEn,
      descKo: categoryProfile.scenes[2].descKo,
      descEn: categoryProfile.scenes[2].descEn,
      placeholderKo: categoryProfile.scenes[2].placeholderKo,
      placeholderEn: categoryProfile.scenes[2].placeholderEn,
      quickPromptsKo: categoryProfile.scenes[2].quickPromptsKo,
      quickPromptsEn: categoryProfile.scenes[2].quickPromptsEn,
      thumbSrc: studioVisuals.sceneThumbs[2],
      template: POMELLI_SHOT_TEMPLATES[2],
    },
    {
      id: "short_video",
      specLabel: `${categoryProfile.scenes[3].focalMm}mm · 9:16 ${videoSeconds}s`,
      labelKo: categoryProfile.scenes[3].titleKo,
      labelEn: categoryProfile.scenes[3].titleEn,
      descKo: categoryProfile.scenes[3].descKo,
      descEn: categoryProfile.scenes[3].descEn,
      placeholderKo: categoryProfile.scenes[3].placeholderKo,
      placeholderEn: categoryProfile.scenes[3].placeholderEn,
      quickPromptsKo: categoryProfile.scenes[3].quickPromptsKo,
      quickPromptsEn: categoryProfile.scenes[3].quickPromptsEn,
      thumbSrc: studioVisuals.sceneThumbs[3],
      isVideo: true,
    },
  ];

  const isVideoMode = medium === "short film";
  const activeSceneButton =
    simpleSceneButtons.find((item) =>
      item.isVideo
        ? isVideoMode
        : !isVideoMode && activeShotTemplateId === item.id,
    ) ?? simpleSceneButtons[0]!;

  const activeTake =
    studioVisuals.takes[activeTakeIndex] ?? studioVisuals.takes[0]!;
  const activeCanvasImageSrc = isVideoMode
    ? studioVisuals.sceneThumbs[3]
    : activeTake.src;

  const selectedFreeformObjects = freeformItems.filter((item) =>
    selectedCanvasItemIds.includes(item.id),
  );
  const selectionBounds =
    selectedFreeformObjects.length > 0
      ? {
          minX: Math.min(...selectedFreeformObjects.map((i) => i.x)),
          minY: Math.min(...selectedFreeformObjects.map((i) => i.y)),
          maxX: Math.max(...selectedFreeformObjects.map((i) => i.x + i.width)),
          maxY: Math.max(...selectedFreeformObjects.map((i) => i.y + i.height)),
        }
      : null;

  return (
    <section
      className="bw-panel"
      data-brand-brief-studio
      data-brief-stage={view?.stage ?? "idle"}
      data-brief-round={view?.round ?? 0}
      data-brief-identity-source={
        identityConfirmed ? "confirmed" : "default_fallback"
      }
      data-active-studio-category={activeCategory}
      data-studio-optical-stage={silentOpticalGuard.selectedStage}
      data-studio-oled-look={silentOledPlan.preset.id}
      data-studio-continuity={silentContinuity.status}
      data-studio-master-gate={silentMasterPlan.gateStatus}
      style={{
        padding: 0,
        border: 0,
        background: "transparent",
        boxShadow: "none",
      }}
    >
      {/* Hidden SSR-compatible markers for category & medium tabs */}
      <div
        style={{ display: "none" }}
        aria-hidden="true"
        data-studio-medium-tabs
      >
        <button type="button" data-studio-medium-tab="image" />
        <button type="button" data-studio-medium-tab="video" />
        <button type="button" data-studio-medium-tab="upscale" />
        <span
          data-studio-category-switcher
          data-studio-category-pill={activeCategory}
        >
          {isKo ? categoryProfile.labelKo : categoryProfile.labelEn}
        </span>
      </div>

      {/* AUTHORITATIVE WHITE STUDIO MODE SWITCHER BAR (◫ 듀얼 캔버스: 좌 이미지 ⇄ 우 영상 | 00 통합 노드 보드 | 01 이미지 | 02 영상·업스케일 | 03 캠페인 포맷 | 04 캠페인+유통 | 05 오디오) */}
      <div
        data-studio-top-mode-bar
        data-active-surface-mode={studioSurfaceMode}
        style={{
          marginBottom: "10px",
          padding: "8px 12px",
          borderRadius: "14px",
          background: "#FFFFFF",
          border: "1px solid #E4E6EC",
          color: "#0E1013",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {(
            [
              {
                id: "split_workbench",
                labelKo: "◫ 듀얼 캔버스 (좌 이미지 ⇄ 우 영상)",
                labelEn: "◫ Dual Canvas (Image ⇄ Video)",
                subKo: "Video-Creator 표준 · 1클릭 브릿지",
                subEn: "Video-Creator Dual Stage",
                onActivate: () => {
                  setStudioSurfaceMode("split_workbench");
                  setSplitPaneMode("dual_split");
                },
              },
              {
                id: "spatial_canvas",
                labelKo: "00 · 통합 노드 보드",
                labelEn: "00 · Unified Node Board",
                subKo: "2D 화이트 캔버스 · 파이프라인",
                subEn: "2D White Node Graph",
                onActivate: () => setStudioSurfaceMode("spatial_canvas"),
              },
              {
                id: "track_image",
                labelKo: "01 · 이미지 단독 캔버스",
                labelEn: "01 · Image Full Canvas",
                subKo: "5대 모델 · 1~4슬롯 · 1440px ROI",
                subEn: "5 Models · 1–4 Slots · ROI",
                onActivate: () => {
                  setStudioSurfaceMode("track_image");
                  handleSelectCoreTrack("image");
                  setSplitPaneMode("image_only");
                },
              },
              {
                id: "track_video_upscale",
                labelKo: "02 · 영상 & 인스타 마스터링",
                labelEn: "02 · Video & IG Mastering",
                subKo: "Seedance 2.5 · 1080p/4K",
                subEn: "Seedance 2.5 · 1080p/4K",
                onActivate: () => {
                  setStudioSurfaceMode("track_video_upscale");
                  handleSelectCoreTrack("video");
                  setSplitPaneMode("video_only");
                },
              },
              {
                id: "track_creator_format",
                labelKo: "03 · 캠페인 영상 (셀프·의뢰)",
                labelEn: "03 · Creator Format",
                subKo: "₩1,800 직접 제작 · D+3 의뢰",
                subEn: "Self-Build · D+3 Studio",
                onActivate: () => {
                  setStudioSurfaceMode("track_creator_format");
                  handleSelectCoreTrack("creator_format");
                },
              },
              {
                id: "track_creator_distribution",
                labelKo: "04 · 캠페인 + 유통 패키지",
                labelEn: "04 · Campaign + Seeding",
                subKo: "10 · 30 · 50인+ 시딩 & ROI",
                subEn: "10 / 30 / 50+ Creators",
                onActivate: () => {
                  setStudioSurfaceMode("track_creator_distribution");
                  handleSelectCoreTrack("creator_distribution");
                },
              },
              {
                id: "track_audio",
                labelKo: "05 · 오디오 & 폴리 스튜디오",
                labelEn: "05 · Audio & Foley",
                subKo: "BGM · 폴리 · -14 LUFS",
                subEn: "BGM · Foley · -14 LUFS",
                onActivate: () => {
                  setStudioSurfaceMode("track_audio");
                  handleSelectCoreTrack("audio");
                },
              },
            ] as const
          ).map((modeTab) => {
            const active = studioSurfaceMode === modeTab.id;
            return (
              <button
                key={modeTab.id}
                type="button"
                data-studio-surface-tab={modeTab.id}
                aria-pressed={active}
                onClick={modeTab.onActivate}
                style={{
                  padding: "6px 11px",
                  borderRadius: "10px",
                  border: active
                    ? "1.5px solid #3875C5"
                    : "1px solid #E4E6EC",
                  background: active
                    ? "rgba(56, 117, 197, 0.08)"
                    : "#F8F9FB",
                  color: active ? "#111114" : "#383B44",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1px",
                }}
              >
                <strong
                  style={{
                    fontSize: "12px",
                    lineHeight: 1.2,
                    color: active ? "#3063A7" : "#111114",
                  }}
                >
                  {isKo ? modeTab.labelKo : modeTab.labelEn}
                </strong>
                <span
                  style={{
                    fontSize: "10.5px",
                    color: active ? "#3063A7" : "#6B6F7B",
                  }}
                >
                  {isKo ? modeTab.subKo : modeTab.subEn}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            data-top-bar-brand-kit-toggle
            aria-expanded={isEditingIdentity}
            onClick={() => setIsEditingIdentity((p) => !p)}
            style={{
              padding: "5px 10px",
              borderRadius: "999px",
              background: isEditingIdentity
                ? "#3875C5"
                : "rgba(56, 117, 197, 0.09)",
              border: "1px solid rgba(56, 117, 197, 0.35)",
              color: isEditingIdentity ? "#FFFFFF" : "#3063A7",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {isKo
              ? `브랜드 킷 고정 ON (${extractedBrandKit.domain}) · 설정`
              : `Brand Kit Lock ON (${extractedBrandKit.domain}) · Setup`}
          </button>
        </div>
      </div>

      {/* FULL-SCREEN WHITE STUDIO STAGE: TOP CHAT/DIRECTING BAR + BELOW DUAL WHITE CANVASES (LEFT IMAGE ⇄ RIGHT VIDEO) */}
      <div
        data-morphic-krea-spatial-board
        data-white-dual-canvas-studio
        data-spatial-dotted-canvas
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" && selectedCanvasItemIds.length > 0 && isSelectionOverlayVisible) {
            e.preventDefault();
            handleAttachFreeformSelection();
          }
        }}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute("data-canvas-plane")) {
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const startX = e.clientX - rect.left;
          const startY = e.clientY - rect.top;
          setDockPopover("none");
          setRubberBandBox({ startX, startY, currX: startX, currY: startY });
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          if (draggingCanvasItem) {
            const dx = mouseX - draggingCanvasItem.startMouseX;
            const dy = mouseY - draggingCanvasItem.startMouseY;
            setFreeformItems((prev) =>
              prev.map((item) => {
                const init = draggingCanvasItem.initialPositions[item.id];
                if (!init) return item;
                return {
                  ...item,
                  x: Math.max(16, Math.min(rect.width - item.width - 16, init.x + dx)),
                  y: Math.max(54, Math.min(rect.height - item.height - 90, init.y + dy)),
                };
              }),
            );
            return;
          }

          if (rubberBandBox) {
            const nextBox = { ...rubberBandBox, currX: mouseX, currY: mouseY };
            setRubberBandBox(nextBox);
            const left = Math.min(nextBox.startX, nextBox.currX);
            const right = Math.max(nextBox.startX, nextBox.currX);
            const top = Math.min(nextBox.startY, nextBox.currY);
            const bottom = Math.max(nextBox.startY, nextBox.currY);
            if (right - left > 8 || bottom - top > 8) {
              const hitIds = freeformItems
                .filter(
                  (item) =>
                    item.x < right &&
                    item.x + item.width > left &&
                    item.y < bottom &&
                    item.y + item.height > top,
                )
                .map((item) => item.id);
              setSelectedCanvasItemIds(hitIds);
              if (hitIds.length > 0) {
                setIsSelectionOverlayVisible(true);
              }
            }
          }
        }}
        onMouseUp={() => {
          if (rubberBandBox) {
            const dist =
              Math.abs(rubberBandBox.currX - rubberBandBox.startX) +
              Math.abs(rubberBandBox.currY - rubberBandBox.startY);
            if (dist < 6) {
              setSelectedCanvasItemIds([]);
              setIsSelectionOverlayVisible(false);
            }
            setRubberBandBox(null);
          }
          if (draggingCanvasItem) {
            setDraggingCanvasItem(null);
          }
        }}
        style={{
          position: "relative",
          width: "100%",
          minHeight:
            studioSurfaceMode === "spatial_canvas" ||
            studioSurfaceMode === "split_workbench"
              ? "calc(100svh - 76px)"
              : "auto",
          borderRadius: "18px",
          backgroundColor: "#F6F7F9",
          backgroundImage:
            "radial-gradient(rgba(17, 17, 20, 0.08) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          border: "1px solid #E4E6EC",
          color: "#0E1013",
          padding: "14px",
          display:
            studioSurfaceMode === "spatial_canvas" ||
            studioSurfaceMode === "split_workbench"
              ? "flex"
              : "none",
          flexDirection: "column",
          gap: "12px",
          overflow: "hidden",
          userSelect: "none",
          outline: "none",
          boxShadow: "0 12px 36px rgba(15, 23, 42, 0.05)",
        }}
      >
        {/* 1. TOP DIRECTING & CHAT BAR (Sits at the TOP above the Dual White Canvases — Video-Creator Production Architecture) */}
        <div
          data-spatial-floating-prompt-dock
          data-studio-top-directing-bar
          style={{
            position: "relative",
            width: "100%",
            zIndex: 30,
            display: "grid",
            gap: "8px",
          }}
        >
          {/* Main Frosted White Directing & Prompt Console */}
          <div
            data-spatial-video-node
            style={{
              position: "relative",
              borderRadius: "16px",
              padding: "12px 16px",
              background: "rgba(255, 255, 255, 0.94)",
              backdropFilter: "blur(16px)",
              border: "1px solid #E4E6EC",
              boxShadow: "0 8px 26px rgba(15, 23, 42, 0.06)",
              display: "grid",
              gap: "10px",
            }}
          >
            {/* Multi-selection attach overlay when nodes are marquee-selected on the unified board */}
            {selectedCanvasItemIds.length > 0 && isSelectionOverlayVisible && studioSurfaceMode === "spatial_canvas" && (
              <button
                type="button"
                data-morphic-selection-attach-overlay
                onClick={handleAttachFreeformSelection}
                style={{
                  position: "absolute",
                  inset: 0,
                  border: 0,
                  borderRadius: "16px",
                  background: "rgba(255, 255, 255, 0.94)",
                  backdropFilter: "blur(8px)",
                  color: "#111114",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "16px",
                  cursor: "pointer",
                  zIndex: 10,
                }}
              >
                <span
                  style={{
                    position: "relative",
                    width: "48px",
                    height: "42px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selectedFreeformObjects.slice(0, 2).map((obj, idx) => (
                    <img
                      key={obj.id}
                      src={obj.src}
                      alt=""
                      style={{
                        position: "absolute",
                        left: idx === 0 ? "0px" : "10px",
                        top: idx === 0 ? "4px" : "0px",
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        objectFit: "cover",
                        border: "2px solid #3875C5",
                        transform: idx === 0 ? "rotate(-8deg)" : "rotate(7deg)",
                        boxShadow: "0 4px 12px rgba(15, 23, 42, 0.14)",
                      }}
                    />
                  ))}
                </span>
                <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#111114" }}>
                  {isKo ? (
                    <>
                      <strong style={{ color: "#3063A7" }}>Enter</strong> 키를 누르거나 클릭해 선택한 노드({selectedCanvasItemIds.length}개)를 디렉팅 레퍼런스로 바로 연결
                    </>
                  ) : (
                    <>
                      Press <strong style={{ color: "#3063A7" }}>Enter</strong> to attach selection or click here
                    </>
                  )}
                </span>
              </button>
            )}

            {/* Directing Bar Row 1: Left [Asset Tray + Image | Video | Audio Mode + @1~@4 Chips] · Right [View Mode Switcher: ◫ 듀얼 캔버스 | ◧ 이미지 전체 | ◨ 영상 전체 | ⊞ 통합 보드] */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                {/* Asset Tray Drawer Toggle */}
                <button
                  type="button"
                  onClick={() => setIsLeftRailCollapsed((p) => !p)}
                  title={isKo ? "브랜드 에셋 보관함 열기/닫기" : "Toggle Brand Asset Tray"}
                  style={{
                    height: "32px",
                    padding: "0 10px",
                    borderRadius: "8px",
                    border: "1px solid #E4E6EC",
                    background: !isLeftRailCollapsed
                      ? "rgba(56, 117, 197, 0.1)"
                      : "#F8F9FB",
                    color: !isLeftRailCollapsed ? "#3063A7" : "#383B44",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: "pointer",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <line x1="9" y1="4" x2="9" y2="20" />
                  </svg>
                  <span>{isKo ? "에셋 보관함" : "Asset Tray"}</span>
                </button>

                {/* Medium Target Segmented Track */}
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "2px",
                    padding: "3px",
                    borderRadius: "999px",
                    background: "#F1F3F7",
                    border: "1px solid #E4E6EC",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleSwitchMediumMode("image")}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "999px",
                      border: 0,
                      background:
                        !isVideoMode && activeCoreTrack !== "audio"
                          ? "#FFFFFF"
                          : "transparent",
                      color:
                        !isVideoMode && activeCoreTrack !== "audio"
                          ? "#111114"
                          : "#6B6F7B",
                      boxShadow:
                        !isVideoMode && activeCoreTrack !== "audio"
                          ? "0 1px 3px rgba(15, 23, 42, 0.08)"
                          : "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "이미지 디렉팅 (좌측)" : "Image Directing (Left)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMediumMode("video")}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "999px",
                      border: 0,
                      background: isVideoMode ? "#FFFFFF" : "transparent",
                      color: isVideoMode ? "#3063A7" : "#6B6F7B",
                      boxShadow: isVideoMode
                        ? "0 1px 3px rgba(15, 23, 42, 0.08)"
                        : "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "영상 디렉팅 (우측 Seedance 2.5)" : "Video Directing (Right)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectCoreTrack("audio")}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "999px",
                      border: 0,
                      background:
                        activeCoreTrack === "audio" ? "#FFFFFF" : "transparent",
                      color:
                        activeCoreTrack === "audio" ? "#111114" : "#6B6F7B",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "사운드 · BGM (-14 LUFS)" : "Audio (-14 LUFS)"}
                  </button>
                </div>

                {/* Quick @Image 1~4 Citation Chips */}
                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  {activeRefWorkflow.slots.map((slot) => (
                    <button
                      key={slot.slotNumber}
                      type="button"
                      onClick={() =>
                        setBriefText((prev) => {
                          const token = isKo ? slot.tagKo : slot.tagEn;
                          return prev.includes(token)
                            ? prev
                            : `${prev} ${token}`.trim();
                        })
                      }
                      style={{
                        padding: "3px 8px",
                        borderRadius: "999px",
                        border: "1px solid rgba(56, 117, 197, 0.25)",
                        background: "rgba(56, 117, 197, 0.07)",
                        color: "#3063A7",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {isKo ? `@${slot.slotNumber}번` : `@Image ${slot.slotNumber}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: Canvas View Mode Switcher (Dual Split vs Image Full vs Video Full vs Unified Board) */}
              <div
                data-white-canvas-view-switcher
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px",
                  borderRadius: "999px",
                  background: "#F1F3F7",
                  border: "1px solid #E4E6EC",
                }}
              >
                {(
                  [
                    {
                      id: "dual_split",
                      labelKo: "◫ 듀얼 캔버스 (이미지 ⇄ 영상)",
                      labelEn: "◫ Dual (Image ⇄ Video)",
                      active:
                        studioSurfaceMode !== "spatial_canvas" &&
                        splitPaneMode === "dual_split",
                      onClick: () => {
                        setStudioSurfaceMode("split_workbench");
                        setSplitPaneMode("dual_split");
                      },
                    },
                    {
                      id: "image_only",
                      labelKo: "◧ 이미지 전체",
                      labelEn: "◧ Image Full",
                      active:
                        studioSurfaceMode !== "spatial_canvas" &&
                        splitPaneMode === "image_only",
                      onClick: () => {
                        setStudioSurfaceMode("split_workbench");
                        setSplitPaneMode("image_only");
                        handleSwitchMediumMode("image");
                      },
                    },
                    {
                      id: "video_only",
                      labelKo: "◨ 영상 전체",
                      labelEn: "◨ Video Full",
                      active:
                        studioSurfaceMode !== "spatial_canvas" &&
                        splitPaneMode === "video_only",
                      onClick: () => {
                        setStudioSurfaceMode("split_workbench");
                        setSplitPaneMode("video_only");
                        handleSwitchMediumMode("video");
                      },
                    },
                    {
                      id: "spatial_canvas",
                      labelKo: "⊞ 통합 보드",
                      labelEn: "⊞ Node Board",
                      active: studioSurfaceMode === "spatial_canvas",
                      onClick: () => setStudioSurfaceMode("spatial_canvas"),
                    },
                  ] as const
                ).map((vMode) => (
                  <button
                    key={vMode.id}
                    type="button"
                    data-canvas-view-mode-btn={vMode.id}
                    aria-pressed={vMode.active}
                    onClick={vMode.onClick}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      border: 0,
                      background: vMode.active ? "#3875C5" : "transparent",
                      color: vMode.active ? "#FFFFFF" : "#383B44",
                      fontSize: "11.5px",
                      fontWeight: vMode.active ? 700 : 600,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? vMode.labelKo : vMode.labelEn}
                  </button>
                ))}
              </div>
            </div>

            {/* Directing Bar Row 2: Full-Width Prompt Input + Primary Generate CTA */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 12px",
                borderRadius: "12px",
                background: "#F8F9FB",
                border: "1px solid #E4E6EC",
              }}
            >
              <input
                type="text"
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
                placeholder={
                  isKo
                    ? "예: 1번 인물에 2번 제품을 들려주고 4번 코발트 조명으로 촬영한 뒤, 우측 영상 캔버스에서 5초 카메라 트래킹으로 이어 줘"
                    : "e.g., Combine @Image 1 subject with @Image 2 product in @Image 4 lighting, then bridge to Right Video for 5s camera tracking"
                }
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 0,
                  background: "transparent",
                  color: "#0E1013",
                  fontSize: "14px",
                  fontWeight: 500,
                  outline: "none",
                }}
              />

              {/* Attached Reference Thumbnails */}
              {attachedCanvasItemIds.length > 0 && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  {attachedCanvasItemIds.map((id) => {
                    const item = freeformItems.find((i) => i.id === id);
                    if (!item) return null;
                    return (
                      <img
                        key={id}
                        src={item.src}
                        alt=""
                        onClick={() =>
                          setAttachedCanvasItemIds((prev) =>
                            prev.filter((x) => x !== id),
                          )
                        }
                        title={isKo ? "클릭해 첨부 해제" : "Click to detach"}
                        style={{
                          width: "26px",
                          height: "26px",
                          borderRadius: "6px",
                          objectFit: "cover",
                          border: "1.5px solid #3875C5",
                          cursor: "pointer",
                        }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Primary Generate Action */}
              <button
                type="button"
                onClick={handleSpawnGeneratedItemOnCanvas}
                style={{
                  padding: "8px 16px",
                  borderRadius: "999px",
                  border: 0,
                  background: "#3875C5",
                  color: "#FFFFFF",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <span>
                  {isKo ? "생성 실행" : "Generate"} ·{" "}
                  {isVideoMode
                    ? `${activeVideoQuote.credits} cr`
                    : `${activeImageModel.creditsPer5Set} cr`}
                </span>
              </button>
            </div>

            {/* Directing Bar Row 3: Model Selector · Aspect Ratio · Micro-ROI Tool · 1080p/4K Upscale · Upload */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                {/* Model Picker Trigger */}
                <button
                  type="button"
                  onClick={() =>
                    setDockPopover((p) => (p === "model" ? "none" : "model"))
                  }
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    border:
                      dockPopover === "model"
                        ? "1px solid #3875C5"
                        : "1px solid #E4E6EC",
                    background:
                      dockPopover === "model"
                        ? "rgba(56, 117, 197, 0.1)"
                        : "#FFFFFF",
                    color: "#111114",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    cursor: "pointer",
                  }}
                >
                  <span>
                    {isVideoMode
                      ? `Seedance 2.5 · ${videoResolution}`
                      : isKo
                        ? activeImageModel.nameKo
                        : activeImageModel.nameEn}
                  </span>
                  <span style={{ fontSize: "10px", color: "#6B6F7B" }}>▾</span>
                </button>

                {/* Aspect Ratio & Duration Trigger */}
                <button
                  type="button"
                  onClick={() =>
                    setDockPopover((p) => (p === "aspect" ? "none" : "aspect"))
                  }
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    border:
                      dockPopover === "aspect"
                        ? "1px solid #3875C5"
                        : "1px solid #E4E6EC",
                    background:
                      dockPopover === "aspect"
                        ? "rgba(56, 117, 197, 0.1)"
                        : "#FFFFFF",
                    color: "#111114",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {aspect} · {isVideoMode ? `${videoSeconds}s` : "1440px ROI"}
                </button>

                {/* Micro-ROI Partial Edit Trigger */}
                <button
                  type="button"
                  onClick={() => {
                    handleSwitchMediumMode("image");
                    handleSwitchImageSubMode("micro_region_edit");
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    border:
                      imageSubMode === "micro_region_edit"
                        ? "1px solid #3875C5"
                        : "1px solid #E4E6EC",
                    background:
                      imageSubMode === "micro_region_edit"
                        ? "rgba(56, 117, 197, 0.1)"
                        : "#FFFFFF",
                    color:
                      imageSubMode === "micro_region_edit"
                        ? "#3063A7"
                        : "#383B44",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {isKo ? "드래그 부분 수정 (1440px ROI)" : "Micro-ROI Inpaint"}
                </button>

                {/* Upscale Studio Popover Trigger */}
                <button
                  type="button"
                  onClick={() =>
                    setDockPopover((p) => (p === "tools" ? "none" : "tools"))
                  }
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    border:
                      dockPopover === "tools"
                        ? "1px solid #3875C5"
                        : "1px solid #E4E6EC",
                    background:
                      dockPopover === "tools"
                        ? "rgba(56, 117, 197, 0.1)"
                        : "#FFFFFF",
                    color: "#383B44",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {isKo ? "1080p 인스타 마스터링 · 4K 업스케일" : "1080p IG & 4K Upscale"}
                </button>

                {/* Workflows Popover Trigger */}
                <button
                  type="button"
                  onClick={() =>
                    setDockPopover((p) => (p === "workflows" ? "none" : "workflows"))
                  }
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    border:
                      dockPopover === "workflows"
                        ? "1px solid #3875C5"
                        : "1px solid #E4E6EC",
                    background:
                      dockPopover === "workflows"
                        ? "rgba(56, 117, 197, 0.1)"
                        : "#FFFFFF",
                    color: "#383B44",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {isKo ? "캠페인 · 오디오 트랙" : "Workflows"}
                </button>

                {/* Upload Media to Canvas */}
                <label
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    border: "1px solid #E4E6EC",
                    background: "#FFFFFF",
                    color: "#383B44",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>+ {isKo ? "파일 업로드" : "Upload"}</span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const url = URL.createObjectURL(file);
                      const isVid = file.type.startsWith("video/");
                      const id = `canvas-upload-${Date.now()}`;
                      setFreeformItems((prev) => [
                        ...prev,
                        {
                          id,
                          kind: isVid ? "video" : "image",
                          src: url,
                          labelKo: file.name,
                          labelEn: file.name,
                          roleBadgeKo: isVid ? "업로드 영상" : "업로드 레퍼런스",
                          roleBadgeEn: isVid ? "Uploaded Video" : "Uploaded Ref",
                          modelBadgeKo: "사용자 에셋",
                          modelBadgeEn: "User Asset",
                          resBadge: isVid ? "1080p · RAW" : "RAW",
                          x: 180 + ((prev.length * 45) % 300),
                          y: 160 + ((prev.length * 30) % 120),
                          width: isVid ? 216 : 172,
                          height: isVid ? 188 : 224,
                        },
                      ]);
                      setSelectedCanvasItemIds([id]);
                      setIsSelectionOverlayVisible(true);
                    }}
                    style={{ display: "none" }}
                  />
                </label>
              </div>

              <span style={{ fontSize: "11px", color: "#6B6F7B" }}>
                {isKo
                  ? "화이트 스튜디오 캔버스 · 좌측 이미지에서 우측 영상 레퍼런스로 1클릭 이동"
                  : "White Studio Canvas · 1-Click Left Image to Right Video Reference Bridge"}
              </span>
            </div>
          </div>

          {/* Popover Below Top Directing Bar: Model Picker */}
          {dockPopover === "model" && (
            <div
              style={{
                padding: "12px",
                borderRadius: "14px",
                background: "#FFFFFF",
                border: "1px solid #E4E6EC",
                boxShadow: "0 16px 36px rgba(15, 23, 42, 0.12)",
                display: "grid",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px" }}>
                <strong style={{ fontSize: "12px", color: "#111114" }}>
                  {isVideoMode
                    ? isKo
                      ? "Seedance 2.5 해상도 · 모드 선택"
                      : "Select Seedance 2.5 Tier"
                    : isKo
                      ? "이미지 생성 모델 선택 (5종)"
                      : "Select Image Model (5)"}
                </strong>
                <button
                  type="button"
                  onClick={() => setDockPopover("none")}
                  style={{ border: 0, background: "transparent", color: "#6B6F7B", cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
              {!isVideoMode ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "6px" }}>
                  {BRAND_STUDIO_IMAGE_MODELS.map((m) => {
                    const active = selectedImageModelId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          handleSelectImageModel(m.id);
                          setDockPopover("none");
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          borderRadius: "10px",
                          border: active
                            ? "1.5px solid #3875C5"
                            : "1px solid #E4E6EC",
                          background: active
                            ? "rgba(56, 117, 197, 0.08)"
                            : "#F8F9FB",
                          color: "#111114",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: "12.5px", display: "block" }}>
                            {isKo ? m.nameKo : m.nameEn}
                          </strong>
                          <span style={{ fontSize: "11px", color: "#6B6F7B" }}>
                            {isKo ? m.shortTraitKo : m.shortTraitEn}
                          </span>
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#3063A7" }}>
                          {m.creditsPer5Set} cr
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
                  {BRAND_SEEDANCE_VIDEO_TIERS.map((tier) => {
                    const active = selectedSeedanceTierId === tier.id;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => {
                          handleSelectSeedanceTier(tier.id);
                          setDockPopover("none");
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          borderRadius: "10px",
                          border: active
                            ? "1.5px solid #3875C5"
                            : "1px solid #E4E6EC",
                          background: active
                            ? "rgba(56, 117, 197, 0.08)"
                            : "#F8F9FB",
                          color: "#111114",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: "12.5px", display: "block" }}>
                            {isKo ? tier.nameKo : tier.nameEn}
                          </strong>
                          <span style={{ fontSize: "11px", color: "#6B6F7B" }}>
                            {isKo ? tier.summaryKo : tier.summaryEn}
                          </span>
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#3063A7" }}>
                          {tier.resolution}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Popover Below Top Directing Bar: Upscale Studio */}
          <div
            data-spatial-upscale-node
            style={{
              padding: "12px",
              borderRadius: "14px",
              background: "#FFFFFF",
              border: "1px solid #E4E6EC",
              boxShadow: "0 16px 36px rgba(15, 23, 42, 0.12)",
              display: dockPopover === "tools" ? "grid" : "none",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "12.5px", color: "#111114" }}>
                {isKo
                  ? "업스케일링 스튜디오 (720p → 1080p 인스타 최적화 · SeedVR2 4K)"
                  : "Upscaling Studio (1080p IG Optimized & SeedVR2 4K)"}
              </strong>
              <button
                type="button"
                onClick={() => setDockPopover("none")}
                style={{ border: 0, background: "transparent", color: "#6B6F7B", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
              {BRAND_UPSCALING_STUDIO_ENGINES.map((eng) => {
                const active = selectedUpscalerEngineId === eng.id;
                return (
                  <button
                    key={eng.id}
                    type="button"
                    onClick={() => handleSelectUpscalerEngine(eng.id)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "10px",
                      border: active
                        ? "1.5px solid #3875C5"
                        : "1px solid #E4E6EC",
                      background: active
                        ? "rgba(56, 117, 197, 0.08)"
                        : "#F8F9FB",
                      color: "#111114",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ fontSize: "11.5px", display: "block" }}>
                      {isKo ? eng.nameKo : eng.nameEn}
                    </strong>
                    <span style={{ fontSize: "10.5px", color: "#3063A7", fontWeight: 600 }}>
                      {eng.supportedTargets.join(" / ")} · {eng.creditsPer10s} cr
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ display: "flex", gap: "4px" }}>
                {(["1080p", "4K"] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setUpscaleTargetResolution(res)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      border: upscaleTargetResolution === res ? "1px solid #3875C5" : "1px solid #E4E6EC",
                      background: upscaleTargetResolution === res ? "#3875C5" : "#F8F9FB",
                      color: upscaleTargetResolution === res ? "#FFFFFF" : "#383B44",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {res}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  handleRunUpscaleStudioJob();
                  handleSpawnGeneratedItemOnCanvas();
                  setDockPopover("none");
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: "999px",
                  border: 0,
                  background: "#3875C5",
                  color: "#FFFFFF",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {isKo
                  ? `${upscaleTargetResolution} 인스타 최적화 업스케일 실행 (${activeUpscalerEngine.creditsPer10s} cr)`
                  : `Run ${upscaleTargetResolution} Upscale (${activeUpscalerEngine.creditsPer10s} cr)`}
              </button>
            </div>
          </div>

          {/* Popover Below Top Directing Bar: Workflows */}
          {dockPopover === "workflows" && (
            <div
              style={{
                padding: "12px",
                borderRadius: "14px",
                background: "#FFFFFF",
                border: "1px solid #E4E6EC",
                boxShadow: "0 16px 36px rgba(15, 23, 42, 0.12)",
                display: "grid",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: "12px", color: "#111114" }}>
                  {isKo ? "워크플로 선택 (이미지 · 영상 · 캠페인 · 유통 · 오디오)" : "Select Workflow"}
                </strong>
                <button
                  type="button"
                  onClick={() => setDockPopover("none")}
                  style={{ border: 0, background: "transparent", color: "#6B6F7B", cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "6px" }}>
                {BRAND_CORE_DELIVERABLE_TRACKS.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      handleSelectCoreTrack(track.id);
                      setDockPopover("none");
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "10px",
                      border:
                        activeCoreTrack === track.id
                          ? "1.5px solid #3875C5"
                          : "1px solid #E4E6EC",
                      background:
                        activeCoreTrack === track.id
                          ? "rgba(56, 117, 197, 0.08)"
                          : "#F8F9FB",
                      color: "#111114",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ fontSize: "12px", display: "block" }}>
                      {isKo ? track.shortLabelKo : track.shortLabelEn}
                    </strong>
                    <span style={{ fontSize: "10.5px", color: "#6B6F7B" }}>
                      {isKo ? track.badgeKo : track.badgeEn}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Popover Below Top Directing Bar: Aspect Ratio & Duration */}
          {dockPopover === "aspect" && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "14px",
                background: "#FFFFFF",
                border: "1px solid #E4E6EC",
                boxShadow: "0 16px 36px rgba(15, 23, 42, 0.12)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "11.5px", color: "#6B6F7B", fontWeight: 600 }}>
                  {isKo ? "화면 비율" : "Aspect Ratio"}
                </span>
                {SHOT_ASPECTS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => {
                      setAspect(ratio);
                      setDockPopover("none");
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      border: aspect === ratio ? "1px solid #3875C5" : "1px solid #E4E6EC",
                      background: aspect === ratio ? "#3875C5" : "#F8F9FB",
                      color: aspect === ratio ? "#FFFFFF" : "#383B44",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
              {isVideoMode && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "11.5px", color: "#6B6F7B", fontWeight: 600 }}>
                    {isKo ? "길이" : "Duration"}
                  </span>
                  {([5, 10, 15] as const).map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => {
                        setVideoSeconds(sec);
                        setDockPopover("none");
                      }}
                      style={{
                        padding: "4px 9px",
                        borderRadius: "999px",
                        border: videoSeconds === sec ? "1px solid #3875C5" : "1px solid #E4E6EC",
                        background: videoSeconds === sec ? "#3875C5" : "#F8F9FB",
                        color: videoSeconds === sec ? "#FFFFFF" : "#383B44",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Collapsible Left Brand Asset Tray (White Studio Popover Drawer) */}
        <aside
          data-spatial-left-rail
          style={{
            position: "absolute",
            top: "148px",
            left: "16px",
            width: "240px",
            padding: "12px",
            borderRadius: "14px",
            background: "rgba(255, 255, 255, 0.98)",
            border: "1px solid #E4E6EC",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.14)",
            zIndex: 28,
            display: isLeftRailCollapsed ? "none" : "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong style={{ fontSize: "12px", color: "#111114" }}>
              {isKo ? "브랜드 에셋 트레이" : "Brand Asset Tray"}
            </strong>
            <button
              type="button"
              onClick={() => setIsLeftRailCollapsed(true)}
              style={{
                border: 0,
                background: "transparent",
                color: "#6B6F7B",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            {studioVisuals.sceneThumbs.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => {
                  const id = `canvas-tray-${Date.now()}-${i}`;
                  setFreeformItems((prev) => [
                    ...prev,
                    {
                      id,
                      kind: i === 3 ? "video" : "image",
                      src,
                      labelKo: `에셋 0${i + 1}`,
                      labelEn: `Asset 0${i + 1}`,
                      roleBadgeKo: i === 3 ? "트레이 영상" : `@Image ${(i % 4) + 1} · 트레이`,
                      roleBadgeEn: i === 3 ? "Tray Video" : `@Image ${(i % 4) + 1} · Tray`,
                      modelBadgeKo: "브랜드 보관함",
                      modelBadgeEn: "Brand Vault",
                      resBadge: i === 3 ? "720p · 9:16" : "2K · 4:5",
                      x: 220 + i * 60,
                      y: 190 + i * 25,
                      width: i === 3 ? 216 : 172,
                      height: i === 3 ? 188 : 224,
                    },
                  ]);
                  setSelectedCanvasItemIds([id]);
                }}
                style={{
                  padding: 0,
                  border: "1px solid #E4E6EC",
                  borderRadius: "8px",
                  overflow: "hidden",
                  background: "#F8F9FB",
                  aspectRatio: "1 / 1",
                  cursor: "pointer",
                }}
              >
                <img
                  src={src}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </button>
            ))}
          </div>
          {identityHref && (
            <a
              href={identityHref}
              style={{
                display: "block",
                textAlign: "center",
                padding: "7px 10px",
                borderRadius: "8px",
                background: "rgba(56, 117, 197, 0.08)",
                color: "#3063A7",
                fontSize: "11.5px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {isKo ? "브랜드 킷 · 색감 고정 설정 →" : "Brand Kit Settings →"}
            </a>
          )}
        </aside>

        {/* 2. BELOW THE CHAT BAR: DUAL WHITE SPLIT-CANVAS (LEFT: IMAGE & 1440PX ROI STAGE ⇄ RIGHT: SEEDANCE 2.5 VIDEO & 1080P IG MASTERING STAGE) */}
        <div
          data-white-split-canvases-grid
          style={{
            flex: 1,
            minHeight: "560px",
            display:
            studioSurfaceMode === "split_workbench" ? "grid" : "none",
            gridTemplateColumns:
              splitPaneMode === "dual_split"
                ? "minmax(0, 1fr) auto minmax(0, 1fr)"
                : "minmax(0, 1fr)",
            gap: "12px",
            alignItems: "stretch",
            zIndex: 15,
          }}
        >
          {/* LEFT WHITE CANVAS: IMAGE & 1440PX MICRO-ROI STAGE */}
          {splitPaneMode !== "video_only" && (
            <div
              data-studio-left-image-canvas
              style={{
                borderRadius: "16px",
                background: "#FFFFFF",
                border: "1px solid #E4E6EC",
                boxShadow: "0 6px 20px rgba(15, 23, 42, 0.04)",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                minWidth: 0,
              }}
            >
              {/* Left Canvas Header */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  paddingBottom: "8px",
                  borderBottom: "1px solid #EEF0F5",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "6px",
                      background: "rgba(56, 117, 197, 0.1)",
                      color: "#3063A7",
                      fontSize: "11px",
                      fontWeight: 800,
                    }}
                  >
                    LEFT CANVAS · IMAGE
                  </span>
                  <strong style={{ fontSize: "13.5px", color: "#111114" }}>
                    {isKo
                      ? `이미지 캔버스 · ${activeImageModel.nameKo}`
                      : `Image Canvas · ${activeImageModel.nameEn}`}
                  </strong>
                </div>

                {/* 1-Click Send Active Left Image to Right Video Reference */}
                <button
                  type="button"
                  data-white-canvas-bridge-cta
                  onClick={() => handleBridgeLeftImageToRightVideo(selectedBridgeSlot)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "999px",
                    border: "1px solid #3875C5",
                    background: "rgba(56, 117, 197, 0.09)",
                    color: "#3063A7",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    cursor: "pointer",
                  }}
                >
                  <span>
                    {isKo
                      ? "현재 컷 → 우측 영상 레퍼런스로 이동"
                      : "Send Cut → Right Video Reference"}
                  </span>
                  <span>→</span>
                </button>
              </div>

              {/* Main White Image Passepartout Stage */}
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: "340px",
                  borderRadius: "12px",
                  background: "#F6F7F9",
                  border: "1px solid #E4E6EC",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src={activeTake.src}
                  alt={isKo ? activeTake.labelKo : activeTake.labelEn}
                  style={{
                    width: "100%",
                    height: "100%",
                    maxHeight: "420px",
                    objectFit: "cover",
                    display: "block",
                  }}
                />

                {/* Top-left Optical & Model Badge on Image Stage */}
                <div
                  style={{
                    position: "absolute",
                    top: "10px",
                    left: "10px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      padding: "4px 9px",
                      borderRadius: "999px",
                      background: "rgba(255, 255, 255, 0.92)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid #E4E6EC",
                      color: "#111114",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {isKo ? activeImageModel.nameKo : activeImageModel.nameEn} · 2K
                  </span>
                  <span
                    style={{
                      padding: "4px 9px",
                      borderRadius: "999px",
                      background: "rgba(255, 255, 255, 0.92)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid #E4E6EC",
                      color: "#3063A7",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {isKo ? "1440px 부분 수정 준비됨" : "1440px ROI Ready"}
                  </span>
                </div>

                {/* Micro-ROI Selection Box Overlay when Micro-Region Edit is active */}
                {imageSubMode === "micro_region_edit" && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${selectionRect.xPct}%`,
                      top: `${selectionRect.yPct}%`,
                      width: `${selectionRect.wPct}%`,
                      height: `${selectionRect.hPct}%`,
                      border: "2px solid #3875C5",
                      borderRadius: "8px",
                      background: "rgba(56, 117, 197, 0.14)",
                      boxShadow: "0 0 0 9999px rgba(17, 17, 20, 0.18)",
                      pointerEvents: "none",
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      padding: "4px 6px",
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: "#3875C5",
                        color: "#FFFFFF",
                        fontSize: "10px",
                        fontWeight: 700,
                      }}
                    >
                      {isKo
                        ? activeRegionPreset.labelKo
                        : activeRegionPreset.labelEn}
                    </span>
                  </div>
                )}
              </div>

              {/* Bottom Strip on Left Image Canvas: 1~4 Reference Slots & Quick Send to Right Video */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "8px",
                }}
              >
                {activeRefWorkflow.slots.map((slot, idx) => {
                  const thumbSrc =
                    customSlotThumbs[slot.slotNumber] ??
                    studioVisuals.sceneThumbs[idx % studioVisuals.sceneThumbs.length]!;
                  return (
                    <div
                      key={slot.slotNumber}
                      style={{
                        padding: "6px",
                        borderRadius: "10px",
                        background: "#F8F9FB",
                        border: "1px solid #E4E6EC",
                        display: "flex",
                        flexDirection: "column",
                        gap: "5px",
                      }}
                    >
                      <div
                        style={{
                          position: "relative",
                          height: "64px",
                          borderRadius: "6px",
                          overflow: "hidden",
                          background: "#FFFFFF",
                        }}
                      >
                        <img
                          src={thumbSrc}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            top: "4px",
                            left: "4px",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            background: "rgba(255, 255, 255, 0.92)",
                            color: "#111114",
                            fontSize: "9.5px",
                            fontWeight: 700,
                          }}
                        >
                          @{slot.slotNumber}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "4px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "10.5px",
                            fontWeight: 600,
                            color: "#383B44",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isKo ? slot.roleTitleKo : slot.roleTitleEn}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleBridgeLeftImageToRightVideo("first_frame", {
                              src: thumbSrc,
                              labelKo: `@${slot.slotNumber}번 ${slot.roleTitleKo}`,
                              labelEn: `@Image ${slot.slotNumber} ${slot.roleTitleEn}`,
                            })
                          }
                          title={
                            isKo
                              ? "이 슬롯 이미지를 우측 영상 레퍼런스로 바로 보내기"
                              : "Send this slot image to Right Video Reference"
                          }
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            border: "1px solid rgba(56, 117, 197, 0.35)",
                            background: "rgba(56, 117, 197, 0.08)",
                            color: "#3063A7",
                            fontSize: "9.5px",
                            fontWeight: 700,
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          {isKo ? "→우측" : "→Video"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CENTER INTERACTIVE BRIDGE RAIL (Transfers Left Image -> Right Video Role in 1 Click) */}
          {splitPaneMode === "dual_split" && (
            <div
              data-dual-canvas-center-bridge
              data-split-bridge-strip
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "6px 2px",
              }}
            >
              {(
                [
                  { slot: "first_frame", ko: "→ 시작 프레임", en: "→ First Frame" },
                  { slot: "character_ref", ko: "→ 인물 고정", en: "→ Subject Ref" },
                  { slot: "product_ref", ko: "→ 제품 고정", en: "→ Product Ref" },
                  { slot: "color_mood_ref", ko: "→ 색감 무드", en: "→ Color Mood" },
                  { slot: "end_frame", ko: "→ 끝 프레임", en: "→ End Frame" },
                ] as const
              ).map((bridgeBtn) => {
                const active = selectedBridgeSlot === bridgeBtn.slot;
                return (
                  <button
                    key={bridgeBtn.slot}
                    type="button"
                    onClick={() => {
                      setSelectedBridgeSlot(bridgeBtn.slot);
                      handleBridgeLeftImageToRightVideo(bridgeBtn.slot);
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: active
                        ? "1.5px solid #3875C5"
                        : "1px solid #E4E6EC",
                      background: active ? "#3875C5" : "#FFFFFF",
                      color: active ? "#FFFFFF" : "#383B44",
                      fontSize: "11px",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.05)",
                    }}
                  >
                    {isKo ? bridgeBtn.ko : bridgeBtn.en}
                  </button>
                );
              })}
            </div>
          )}

          {/* RIGHT WHITE CANVAS: SEEDANCE 2.5 VIDEO & 1080P IG MASTERING STAGE */}
          {splitPaneMode !== "image_only" && (
            <div
              data-studio-right-video-canvas
              style={{
                borderRadius: "16px",
                background: "#FFFFFF",
                border: "1px solid #E4E6EC",
                boxShadow: "0 6px 20px rgba(15, 23, 42, 0.04)",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                minWidth: 0,
              }}
            >
              {/* Right Video Canvas Header */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  paddingBottom: "8px",
                  borderBottom: "1px solid #EEF0F5",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "6px",
                      background: "rgba(56, 117, 197, 0.1)",
                      color: "#3063A7",
                      fontSize: "11px",
                      fontWeight: 800,
                    }}
                  >
                    RIGHT CANVAS · VIDEO
                  </span>
                  <strong style={{ fontSize: "13.5px", color: "#111114" }}>
                    {isKo
                      ? `영상 캔버스 · Seedance 2.5 (${videoResolution} · ${videoSeconds}s)`
                      : `Video Canvas · Seedance 2.5 (${videoResolution} · ${videoSeconds}s)`}
                  </strong>
                </div>

                {/* Seedance Resolution Tier Pills */}
                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  {BRAND_SEEDANCE_VIDEO_TIERS.map((tier) => {
                    const active = selectedSeedanceTierId === tier.id;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => handleSelectSeedanceTier(tier.id)}
                        style={{
                          padding: "4px 9px",
                          borderRadius: "999px",
                          border: active
                            ? "1px solid #3875C5"
                            : "1px solid #E4E6EC",
                          background: active ? "#3875C5" : "#F8F9FB",
                          color: active ? "#FFFFFF" : "#383B44",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {tier.resolution}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bridged Image References Bar + Live Transfer Confirmation Badge at Top of Right Video Canvas */}
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: "#F8F9FB",
                  border: "1px solid #E4E6EC",
                  display: "grid",
                  gap: "6px",
                }}
              >
                <div
                  data-right-video-transfer-confirmation
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                    padding: "4px 8px",
                    borderRadius: "7px",
                    background: "rgba(56, 117, 197, 0.08)",
                    border: "1px solid rgba(56, 117, 197, 0.25)",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#3063A7",
                  }}
                >
                  <span>
                    {isKo
                      ? `✓ 좌측 화보 마스터 컷(${bridgedVideoRefs[0]?.imageLabelKo ?? activeTake.labelKo})이 영상 레퍼런스로 실시간 연결됨 · Seedance 2.5 모션 준비 완료`
                      : `✓ Left Still Master (${bridgedVideoRefs[0]?.imageLabelEn ?? activeTake.labelEn}) linked to Right Video · Seedance 2.5 Ready`}
                  </span>
                  <span style={{ fontFamily: "var(--ys-mono)", fontSize: "10.5px" }}>
                    {videoResolution} · {videoSeconds}s
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#3063A7" }}>
                    {isKo
                      ? `연결된 영상 레퍼런스 (${bridgedVideoRefs.length}개)`
                      : `Bridged Video References (${bridgedVideoRefs.length})`}
                  </span>
                  {bridgedVideoRefs.map((refItem) => (
                    <span
                      key={refItem.slotId}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "3px 8px 3px 4px",
                        borderRadius: "999px",
                        background: "#FFFFFF",
                        border: "1px solid #E4E6EC",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#111114",
                      }}
                    >
                      <img
                        src={refItem.imageSrc}
                        alt=""
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "999px",
                          objectFit: "cover",
                        }}
                      />
                      <span>{isKo ? refItem.citationKo : refItem.citationEn}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Main White Video Stage */}
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: "290px",
                  borderRadius: "12px",
                  background: "#F6F7F9",
                  border: "1px solid #E4E6EC",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {playingCanvasItemId === "white-right-video-stage" ? (
                  <video
                    src="/reel/brands/house-runway-1080p.mp4"
                    poster={studioVisuals.sceneThumbs[3]}
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{
                      width: "100%",
                      height: "100%",
                      maxHeight: "360px",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <img
                    src={studioVisuals.sceneThumbs[3]}
                    alt={isKo ? "Seedance 2.5 모션 프리뷰" : "Seedance 2.5 Motion Preview"}
                    style={{
                      width: "100%",
                      height: "100%",
                      maxHeight: "360px",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                )}

                {/* Play/Pause Button on Video Stage */}
                <button
                  type="button"
                  aria-label={isKo ? "영상 프리뷰 재생" : "Play video preview"}
                  onClick={() =>
                    setPlayingCanvasItemId((prev) =>
                      prev === "white-right-video-stage"
                        ? null
                        : "white-right-video-stage",
                    )
                  }
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "48px",
                    height: "48px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255, 255, 255, 0.8)",
                    background: "rgba(255, 255, 255, 0.92)",
                    color: "#3063A7",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="7 4 20 12 7 20 7 4" />
                  </svg>
                </button>

                {/* Top-Left Video Pipeline Status Pill */}
                <div
                  style={{
                    position: "absolute",
                    top: "10px",
                    left: "10px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      padding: "4px 9px",
                      borderRadius: "999px",
                      background: "rgba(255, 255, 255, 0.92)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid #E4E6EC",
                      color: "#111114",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    Seedance 2.5 · {aspect} · {videoSeconds}s
                  </span>
                  <span
                    style={{
                      padding: "4px 9px",
                      borderRadius: "999px",
                      background: "rgba(255, 255, 255, 0.92)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid #E4E6EC",
                      color: "#3063A7",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {isKo ? "0ms 비트 싱크 · -14 LUFS" : "0ms Beat Sync · -14 LUFS"}
                  </span>
                </div>
              </div>

              {/* Bottom Bar on Right Video Canvas: 1-Click Instagram 1080p Mastering & SeedVR2 4K Upscale */}
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "#F8F9FB",
                  border: "1px solid #E4E6EC",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <div>
                  <strong style={{ fontSize: "12px", color: "#111114", display: "block" }}>
                    {isKo
                      ? "인스타그램 1080p 화질 방어 & SeedVR2 업스케일 마스터링"
                      : "Instagram 1080p Anti-Compression & SeedVR2 Mastering"}
                  </strong>
                  <span style={{ fontSize: "11px", color: "#6B6F7B" }}>
                    {isKo
                      ? "Lanczos + CAS 0.25 + 필름 그레인 보존 · 업로드 재압축 열화 차단"
                      : "Lanczos + CAS 0.25 + Film Grain Lock · Prevents IG re-compression blur"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRunUpscaleStudioJob}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "999px",
                    border: "1px solid #3875C5",
                    background: "#3875C5",
                    color: "#FFFFFF",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {isKo
                    ? `${upscaleTargetResolution} 마스터링 실행 (${activeUpscalerEngine.creditsPer10s} cr)`
                    : `Master ${upscaleTargetResolution} (${activeUpscalerEngine.creditsPer10s} cr)`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 3. UNIFIED 2D WHITE NODE BOARD (Visible in `spatial_canvas` mode, mounted in DOM for SSR & 1-click switching) */}
        <div
          data-canvas-plane
          data-spatial-board-nodes-grid
          style={{
            position: "relative",
            flex: 1,
            minHeight: "560px",
            display: studioSurfaceMode === "spatial_canvas" ? "block" : "none",
            borderRadius: "16px",
            background: "#FFFFFF",
            border: "1px solid #E4E6EC",
            overflow: "hidden",
            transform: `scale(${canvasZoomPct / 100})`,
            transformOrigin: "center center",
            zIndex: 10,
          }}
        >
          {/* Top-Left Quick Node Spawn & Wire Connection Bar (Round 7 Upgrade) */}
          <div
            data-canvas-quick-spawn-bar
            style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              zIndex: 25,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "6px",
              padding: "6px 8px",
              borderRadius: "12px",
              background: "rgba(255, 255, 255, 0.96)",
              backdropFilter: "blur(12px)",
              border: "1px solid #E4E6EC",
              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
            }}
          >
            <button
              type="button"
              data-canvas-spawn-image-node
              data-spawn-node-btn="image_ref"
              onClick={() => handleSpawnTypedCanvasNode("image_ref")}
              style={{
                padding: "5px 9px",
                borderRadius: "8px",
                border: "1px solid #E4E6EC",
                background: "#F8F9FB",
                color: "#111114",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isKo ? "+ 이미지 레퍼런스 노드 추가" : "+ Add Image Ref Node"}
            </button>
            <button
              type="button"
              data-canvas-spawn-video-node
              data-spawn-node-btn="video_seedance"
              onClick={() => handleSpawnTypedCanvasNode("video_seedance")}
              style={{
                padding: "5px 9px",
                borderRadius: "8px",
                border: "1px solid rgba(56, 117, 197, 0.35)",
                background: "rgba(56, 117, 197, 0.08)",
                color: "#3063A7",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isKo ? "+ Seedance 2.5 영상 노드 추가" : "+ Add Seedance 2.5 Node"}
            </button>
            <button
              type="button"
              data-canvas-spawn-upscale-node
              data-spawn-node-btn="upscale_1080p"
              onClick={() => handleSpawnTypedCanvasNode("upscale_1080p")}
              style={{
                padding: "5px 9px",
                borderRadius: "8px",
                border: "1px solid #3875C5",
                background: "#3875C5",
                color: "#FFFFFF",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isKo ? "+ 1080p 인스타 업스케일 노드 연결" : "+ Add 1080p IG Upscale Node"}
            </button>
            <button
              type="button"
              data-canvas-wire-selected-nodes
              data-connect-selected-nodes-btn
              onClick={handleConnectSelectedCanvasNodes}
              style={{
                padding: "5px 9px",
                borderRadius: "8px",
                border: "1px solid #E4E6EC",
                background: "#FFFFFF",
                color: "#383B44",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {isKo ? "선택 노드 간 와이어 연결" : "Wire Selected Nodes"}
            </button>
          </div>

          {/* LIVE DYNAMIC SVG BEZIER CONNECTION WIRES ON WHITE CANVAS */}
          <svg
            data-spatial-node-wires
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 11,
            }}
          >
            {freeformItems.flatMap((targetItem) =>
              (targetItem.connectedFromIds ?? []).map((srcId) => {
                const srcItem = freeformItems.find((x) => x.id === srcId);
                if (!srcItem) return null;
                const x1 = srcItem.x + srcItem.width;
                const y1 = srcItem.y + srcItem.height * 0.46;
                const x2 = targetItem.x;
                const y2 = targetItem.y + targetItem.height * 0.46;
                const dx = Math.max(48, Math.abs(x2 - x1) * 0.48);
                const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
                const isWireHighlighted =
                  selectedCanvasItemIds.includes(srcItem.id) ||
                  selectedCanvasItemIds.includes(targetItem.id);
                return (
                  <g
                    key={`${srcItem.id}->${targetItem.id}`}
                    data-canvas-bezier-wire={`${srcItem.id}->${targetItem.id}`}
                  >
                    <path
                      d={pathD}
                      fill="none"
                      stroke={
                        isWireHighlighted
                          ? "#3875C5"
                          : "rgba(56, 117, 197, 0.35)"
                      }
                      strokeWidth={isWireHighlighted ? "2.4" : "1.6"}
                      strokeDasharray={isWireHighlighted ? undefined : "5 4"}
                    />
                    <circle
                      cx={x1}
                      cy={y1}
                      r="4"
                      fill="#3875C5"
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={x2}
                      cy={y2}
                      r="4"
                      fill="#3875C5"
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />
                    {targetItem.wireLabelKo && (
                      <g transform={`translate(${midX - 44}, ${midY - 10})`}>
                        <rect
                          width="88"
                          height="19"
                          rx="9.5"
                          fill="#FFFFFF"
                          stroke="rgba(56, 117, 197, 0.45)"
                          strokeWidth="1"
                        />
                        <text
                          x="44"
                          y="13"
                          textAnchor="middle"
                          fill="#3063A7"
                          fontSize="9.5"
                          fontWeight="700"
                        >
                          {isKo ? targetItem.wireLabelKo : targetItem.wireLabelEn}
                        </text>
                      </g>
                    )}
                  </g>
                );
              }),
            )}
          </svg>

          {/* Production Media Nodes Placed at 2D (x, y) Coordinates on White Board */}
          {freeformItems.map((item) => {
            const isSelected = selectedCanvasItemIds.includes(item.id);
            const isPlaying = playingCanvasItemId === item.id;
            return (
              <div
                key={item.id}
                data-spatial-board-node={item.nodeRefId ?? item.id}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const rect = (
                    e.currentTarget.parentElement as HTMLElement
                  ).getBoundingClientRect();
                  const mouseX = e.clientX - rect.left;
                  const mouseY = e.clientY - rect.top;

                  let nextSelected = selectedCanvasItemIds;
                  if (e.shiftKey) {
                    nextSelected = isSelected
                      ? selectedCanvasItemIds.filter((id) => id !== item.id)
                      : [...selectedCanvasItemIds, item.id];
                    setSelectedCanvasItemIds(nextSelected);
                  } else if (!isSelected) {
                    nextSelected = [item.id];
                    setSelectedCanvasItemIds(nextSelected);
                  }
                  setIsSelectionOverlayVisible(true);

                  const initialPositions: Record<string, { x: number; y: number }> = {};
                  for (const obj of freeformItems) {
                    if (nextSelected.includes(obj.id) || obj.id === item.id) {
                      initialPositions[obj.id] = { x: obj.x, y: obj.y };
                    }
                  }
                  setDraggingCanvasItem({
                    id: item.id,
                    startMouseX: mouseX,
                    startMouseY: mouseY,
                    initialPositions,
                  });
                }}
                style={{
                  position: "absolute",
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                  cursor: draggingCanvasItem?.id === item.id ? "grabbing" : "grab",
                  borderRadius: "12px",
                  overflow: "visible",
                  background: "#FFFFFF",
                  border: isSelected
                    ? "2px solid #3875C5"
                    : "1px solid #E4E6EC",
                  boxShadow: isSelected
                    ? "0 14px 32px rgba(56, 117, 197, 0.18)"
                    : "0 8px 24px rgba(15, 23, 42, 0.08)",
                  display: "flex",
                  flexDirection: "column",
                  zIndex: isSelected ? 14 : 12,
                }}
              >
                {/* Explicit In / Out Wire Port Anchor Pins (Round 7 Upgrade) */}
                <span
                  data-node-port="in"
                  title={isKo ? "입력 포트 (In)" : "Input Port (In)"}
                  style={{
                    position: "absolute",
                    left: "-5px",
                    top: "46%",
                    width: "9px",
                    height: "9px",
                    borderRadius: "999px",
                    background: "#FFFFFF",
                    border: "2px solid #3875C5",
                    zIndex: 3,
                  }}
                />
                <span
                  data-node-port="out"
                  title={isKo ? "출력 포트 (Out)" : "Output Port (Out)"}
                  style={{
                    position: "absolute",
                    right: "-5px",
                    top: "46%",
                    width: "9px",
                    height: "9px",
                    borderRadius: "999px",
                    background: "#3875C5",
                    border: "2px solid #FFFFFF",
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    padding: "5px 8px",
                    background: "#F8F9FB",
                    borderBottom: "1px solid #EEF0F5",
                    borderTopLeftRadius: "11px",
                    borderTopRightRadius: "11px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "4px",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "#3063A7",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isKo ? item.roleBadgeKo : item.roleBadgeEn}
                  </span>
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 600,
                      color: "#6B6F7B",
                      flexShrink: 0,
                    }}
                  >
                    {item.resBadge}
                  </span>
                </div>

                <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
                  {item.kind === "video" && isPlaying ? (
                    <video
                      src="/reel/brands/house-runway-1080p.mp4"
                      poster={item.src}
                      autoPlay
                      loop
                      muted
                      playsInline
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  ) : (
                    <img
                      src={item.src}
                      alt={isKo ? item.labelKo : item.labelEn}
                      draggable={false}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  )}

                  {item.kind === "video" && (
                    <button
                      type="button"
                      aria-label={isKo ? "영상 재생" : "Play video"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayingCanvasItemId((prev) =>
                          prev === item.id ? null : item.id,
                        );
                      }}
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        transform: "translate(-50%, -50%)",
                        width: "34px",
                        height: "34px",
                        borderRadius: "999px",
                        border: 0,
                        background: "rgba(255, 255, 255, 0.9)",
                        color: "#3063A7",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: "0 4px 12px rgba(15, 23, 42, 0.16)",
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="7 4 20 12 7 20 7 4" />
                      </svg>
                    </button>
                  )}
                </div>

                <div
                  style={{
                    padding: "5px 7px",
                    background: "#FFFFFF",
                    borderTop: "1px solid #EEF0F5",
                    borderBottomLeftRadius: "11px",
                    borderBottomRightRadius: "11px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "4px",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#383B44",
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isKo ? item.modelBadgeKo : item.modelBadgeEn}
                  </span>
                  <div style={{ display: "inline-flex", gap: "3px", flexShrink: 0 }}>
                    {item.kind === "image" ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBridgeLeftImageToRightVideo("first_frame", {
                            src: item.src,
                            labelKo: item.labelKo,
                            labelEn: item.labelEn,
                          });
                        }}
                        style={{
                          padding: "2px 6px",
                          borderRadius: "5px",
                          border: "1px solid rgba(56, 117, 197, 0.35)",
                          background: "rgba(56, 117, 197, 0.08)",
                          color: "#3063A7",
                          fontSize: "9.5px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {isKo ? "→영상" : "→Video"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDockPopover("tools");
                        }}
                        style={{
                          padding: "2px 6px",
                          borderRadius: "5px",
                          border: "1px solid rgba(56, 117, 197, 0.35)",
                          background: "rgba(56, 117, 197, 0.08)",
                          color: "#3063A7",
                          fontSize: "9.5px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {isKo ? "1080p IG" : "1080p IG"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Bottom-Left Canvas Viewport Fit & Zoom Controls (Round 7 Upgrade) */}
          <div
            data-canvas-viewport-controls
            style={{
              position: "absolute",
              left: "12px",
              bottom: "12px",
              zIndex: 25,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 8px",
              borderRadius: "10px",
              background: "rgba(255, 255, 255, 0.96)",
              backdropFilter: "blur(12px)",
              border: "1px solid #E4E6EC",
              boxShadow: "0 6px 20px rgba(15, 23, 42, 0.08)",
            }}
          >
            <button
              type="button"
              data-canvas-fit-view-btn
              onClick={handleFitCanvasView}
              style={{
                padding: "4px 8px",
                borderRadius: "7px",
                border: "1px solid #E4E6EC",
                background: "#F8F9FB",
                color: "#111114",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isKo ? "⛶ 전체 노드 한눈에 맞춤 (Fit View)" : "⛶ Fit All Nodes"}
            </button>
            <button
              type="button"
              onClick={() => setCanvasZoomPct((z) => Math.max(70, z - 10))}
              style={{
                padding: "3px 7px",
                borderRadius: "6px",
                border: "1px solid #E4E6EC",
                background: "#FFFFFF",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              −
            </button>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#3063A7", minWidth: "38px", textAlign: "center" }}>
              {canvasZoomPct}%
            </span>
            <button
              type="button"
              onClick={() => setCanvasZoomPct((z) => Math.min(130, z + 10))}
              style={{
                padding: "3px 7px",
                borderRadius: "6px",
                border: "1px solid #E4E6EC",
                background: "#FFFFFF",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              +
            </button>
          </div>

          {selectionBounds && (
            <div
              data-morphic-selection-bounding-box
              style={{
                position: "absolute",
                left: `${selectionBounds.minX - 4}px`,
                top: `${selectionBounds.minY - 4}px`,
                width: `${selectionBounds.maxX - selectionBounds.minX + 8}px`,
                height: `${selectionBounds.maxY - selectionBounds.minY + 8}px`,
                border: "2px solid #3875C5",
                borderRadius: "14px",
                pointerEvents: "none",
                zIndex: 15,
              }}
            />
          )}

          {rubberBandBox && (
            <div
              data-morphic-rubberband-rect
              style={{
                position: "absolute",
                left: `${Math.min(rubberBandBox.startX, rubberBandBox.currX)}px`,
                top: `${Math.min(rubberBandBox.startY, rubberBandBox.currY)}px`,
                width: `${Math.abs(rubberBandBox.currX - rubberBandBox.startX)}px`,
                height: `${Math.abs(rubberBandBox.currY - rubberBandBox.startY)}px`,
                border: "1.5px solid #3875C5",
                background: "rgba(56, 117, 197, 0.08)",
                pointerEvents: "none",
                zIndex: 20,
              }}
            />
          )}

          {/* RIGHT-SIDE FLOATING ACTIVE NODE INSPECTOR (1-Click Slot 1~4 Lock & Pipeline Routing) */}
          {(() => {
            const inspectedNode =
              freeformItems.find((i) => i.id === selectedCanvasItemIds[0]) ??
              freeformItems[0];
            if (!inspectedNode) return null;
            return (
              <aside
                data-canvas-node-inspector
                style={{
                  position: "absolute",
                  top: "14px",
                  right: "14px",
                  width: "260px",
                  padding: "12px",
                  borderRadius: "14px",
                  background: "rgba(255, 255, 255, 0.96)",
                  backdropFilter: "blur(14px)",
                  border: "1px solid #E4E6EC",
                  boxShadow: "0 14px 36px rgba(15, 23, 42, 0.12)",
                  zIndex: 24,
                  display: "grid",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      padding: "2px 7px",
                      borderRadius: "999px",
                      background: "rgba(56, 117, 197, 0.1)",
                      color: "#3063A7",
                      fontSize: "10px",
                      fontWeight: 700,
                    }}
                  >
                    {isKo ? inspectedNode.roleBadgeKo : inspectedNode.roleBadgeEn}
                  </span>
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#6B6F7B",
                      fontFamily: "var(--ys-mono)",
                    }}
                  >
                    {inspectedNode.resBadge}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <img
                    src={inspectedNode.src}
                    alt=""
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "8px",
                      objectFit: "cover",
                      border: "1px solid #E4E6EC",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <strong
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "#111114",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isKo ? inspectedNode.labelKo : inspectedNode.labelEn}
                    </strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: "10.5px",
                        color: "#6B6F7B",
                      }}
                    >
                      {isKo ? inspectedNode.modelBadgeKo : inspectedNode.modelBadgeEn}
                    </span>
                  </div>
                </div>

                {/* 1-Click Reference Slot 1~4 Lock Buttons */}
                <div
                  style={{
                    paddingTop: "6px",
                    borderTop: "1px solid #EEF0F5",
                    display: "grid",
                    gap: "4px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "#6B6F7B",
                    }}
                  >
                    {isKo
                      ? "1~4번 레퍼런스 슬롯에 즉시 고정"
                      : "Lock Node to Reference Slot 1–4"}
                  </span>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "4px",
                    }}
                  >
                    {(
                      [
                        { slotIndex: 1 as const, ko: "슬롯1 인물 고정", en: "Slot 1 Subject" },
                        { slotIndex: 2 as const, ko: "슬롯2 제품 고정", en: "Slot 2 Product" },
                        { slotIndex: 3 as const, ko: "슬롯3 포즈 고정", en: "Slot 3 Pose" },
                        { slotIndex: 4 as const, ko: "슬롯4 색감핀", en: "Slot 4 Color Pin" },
                      ] as const
                    ).map((slotBtn) => (
                      <button
                        key={slotBtn.slotIndex}
                        type="button"
                        data-node-inspector-lock-slot={slotBtn.slotIndex}
                        onClick={() => {
                          setCustomSlotThumbs((prev) => ({
                            ...prev,
                            [slotBtn.slotIndex]: inspectedNode.src,
                          }));
                          setCustomSlotNames((prev) => ({
                            ...prev,
                            [slotBtn.slotIndex]: isKo
                              ? inspectedNode.labelKo
                              : inspectedNode.labelEn,
                          }));
                        }}
                        style={{
                          padding: "4px 6px",
                          borderRadius: "6px",
                          border: "1px solid #E4E6EC",
                          background: "#F8F9FB",
                          color: "#111114",
                          fontSize: "10.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {isKo ? slotBtn.ko : slotBtn.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 1-Click Pipeline Routing Actions */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "5px",
                    paddingTop: "4px",
                  }}
                >
                  <button
                    type="button"
                    data-inspector-action="send-to-video"
                    onClick={() =>
                      handleBridgeLeftImageToRightVideo("first_frame", {
                        src: inspectedNode.src,
                        labelKo: inspectedNode.labelKo,
                        labelEn: inspectedNode.labelEn,
                      })
                    }
                    style={{
                      padding: "5px 7px",
                      borderRadius: "7px",
                      border: "1px solid rgba(56, 117, 197, 0.4)",
                      background: "rgba(56, 117, 197, 0.09)",
                      color: "#3063A7",
                      fontSize: "10.5px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "→ 우측 영상 연결" : "→ Right Video"}
                  </button>
                  <button
                    type="button"
                    data-inspector-action="open-upscale"
                    onClick={() => {
                      setIsUpscaleStudioExpanded(true);
                      setDockPopover("tools");
                    }}
                    style={{
                      padding: "5px 7px",
                      borderRadius: "7px",
                      border: "1px solid #E4E6EC",
                      background: "#F8F9FB",
                      color: "#111114",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "→ 1080p 인스타" : "→ 1080p IG"}
                  </button>
                  <button
                    type="button"
                    data-inspector-action="micro-mask"
                    onClick={() => {
                      handleSwitchMediumMode("image");
                      handleSwitchImageSubMode("micro_region_edit");
                    }}
                    style={{
                      padding: "5px 7px",
                      borderRadius: "7px",
                      border: "1px solid #E4E6EC",
                      background: "#F8F9FB",
                      color: "#111114",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "→ 부분 수정 마스크" : "→ Smart Mask"}
                  </button>
                  <button
                    type="button"
                    data-inspector-action="campaign-format"
                    onClick={() =>
                      handleSelectCoreTrack("creator_format")
                    }
                    style={{
                      padding: "5px 7px",
                      borderRadius: "7px",
                      border: "1px solid #E4E6EC",
                      background: "#F8F9FB",
                      color: "#111114",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "→ 캠페인 포맷" : "→ Campaign"}
                  </button>
                </div>
              </aside>
            );
          })()}
        </div>
      </div>

      {/* First-Class Dedicated Studio Workbenches (Isolated per selected top-bar tab — zero scroll dump) */}
      <div
        data-studio-advanced-drawer
        data-isolated-surface-mode={studioSurfaceMode}
        style={{
          marginTop: "14px",
          display:
            studioSurfaceMode === "split_workbench" ||
            studioSurfaceMode === "spatial_canvas"
              ? isEditingIdentity
                ? "block"
                : "none"
              : "block",
        }}
      >

      {/* Isolated Studio Header Banner (Round 6 & 9–13 Single-Surface Clarity) */}
      <div
        data-isolated-studio-header={studioSurfaceMode}
        style={{
          display:
            studioSurfaceMode === "split_workbench" ||
            studioSurfaceMode === "spatial_canvas"
              ? "none"
              : "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          padding: "12px 16px",
          marginBottom: "14px",
          borderRadius: "14px",
          background: "#FFFFFF",
          border: "1.5px solid #3875C5",
          boxShadow: "0 6px 20px rgba(56, 117, 197, 0.08)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: "999px",
              background: "#3875C5",
              color: "#FFFFFF",
              fontSize: "11px",
              fontWeight: 800,
            }}
          >
            {studioSurfaceMode === "track_image"
              ? "01 · IMAGE STUDIO"
              : studioSurfaceMode === "track_video_upscale"
                ? "02 · VIDEO & IG 1080P STUDIO"
                : studioSurfaceMode === "track_creator_format"
                  ? "03 · CREATOR FORMAT STUDIO"
                  : studioSurfaceMode === "track_creator_distribution"
                    ? "04 · CAMPAIGN SEEDING STUDIO"
                    : "05 · AUDIO & FOLEY STUDIO"}
          </span>
          <strong style={{ fontSize: "14px", color: "#111114" }}>
            {studioSurfaceMode === "track_image"
              ? isKo
                ? "이미지 단독 스튜디오 — 5대 생성 모델 · 1~4번 역할 슬롯 · 1440px 스마트 마스크 부분 수정"
                : "Standalone Image Studio — 5 Models · 1–4 Role Slots · 1440px Smart Mask Inpainting"
              : studioSurfaceMode === "track_video_upscale"
                ? isKo
                  ? "영상 & 인스타 마스터링 단독 스튜디오 — Seedance 2.5 (480p/720p/1080p) · Sunra 1080p 무열화 & SeedVR2 4K"
                  : "Standalone Video & IG Mastering Studio — Seedance 2.5 · Sunra 1080p De-AI & SeedVR2 4K"
                : studioSurfaceMode === "track_creator_format"
                  ? isKo
                    ? "크리에이터 캠페인 포맷 단독 스튜디오 — 1,800원 셀프 포맷 빌더 · D+3 전담 프로덕션 의뢰"
                    : "Standalone Creator Campaign Format Studio — KRW 1,800 Self-Build · D+3 Commission"
                  : studioSurfaceMode === "track_creator_distribution"
                    ? isKo
                      ? "캠페인 + 유통 패키지 단독 스튜디오 — 10·30·50인+ 검증 크리에이터 시딩 & 2차 광고 활용권"
                      : "Standalone Campaign + Seeding Studio — 10/30/50+ Verified Creators & 2nd-Use Ad Rights"
                    : isKo
                      ? "오디오 & 폴리 단독 스튜디오 — 3트랙 시그니처 BGM · 프레임 동기화 폴리 · -14.0 LUFS 방송 표준 마스터"
                      : "Standalone Audio & Foley Studio — 3-Track BGM · Frame-Synced Foley · -14.0 LUFS Master"}
          </strong>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            onClick={() => {
              setStudioSurfaceMode("split_workbench");
              setSplitPaneMode("dual_split");
            }}
            style={{
              padding: "5px 10px",
              borderRadius: "8px",
              border: "1px solid #E4E6EC",
              background: "#F8F9FB",
              color: "#3063A7",
              fontSize: "11.5px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {isKo ? "◫ 듀얼 캔버스로 돌아가기" : "◫ Back to Dual Canvas"}
          </button>
          <button
            type="button"
            onClick={() => setStudioSurfaceMode("spatial_canvas")}
            style={{
              padding: "5px 10px",
              borderRadius: "8px",
              border: "1px solid #E4E6EC",
              background: "#FFFFFF",
              color: "#383B44",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isKo ? "00 · 2D 통합 노드 보드 열기" : "00 · Open 2D Node Board"}
          </button>
        </div>
      </div>

      {/* 5 Core Deliverable Track Switcher (Mounted for SSR & programmatic access, hidden visually to prevent duplicate top bars) */}
      <div
        data-studio-core-tracks
        data-active-core-track={activeCoreTrack}
        style={{
          marginBottom: "16px",
          padding: "12px 14px",
          borderRadius: "14px",
          background: "var(--ys-surface)",
          boxShadow: "var(--ys-ring)",
          display: "none",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <div>
            <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
              {isKo
                ? "우리 브랜드 5대 핵심 제작 · 유통 트랙"
                : "5 Core Brand Production & Distribution Tracks"}
            </strong>
            <span
              className="bw-muted"
              style={{ marginLeft: "8px", fontSize: "12px" }}
            >
              {isKo
                ? "이미지 · 영상 · 크리에이터 캠페인 영상(셀프/의뢰) · 캠페인+유통 · 오디오를 한 워크스페이스에서 이어 만듭니다"
                : "Image, Video, Creator Campaign Format (Self/Commission), Campaign + Distribution, and Audio in one studio"}
            </span>
          </div>
          <span
            className="bw-chip"
            style={{
              background: "var(--ys-brand-tint)",
              color: "var(--ys-brand-text)",
              fontWeight: 700,
              fontSize: "11px",
            }}
          >
            {isKo
              ? "동일 브랜드 아이덴티티 · 색감/질감 핀 100% 연동"
              : "100% Shared Brand Identity & Pinned Style Locks"}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
            gap: "8px",
          }}
        >
          {BRAND_CORE_DELIVERABLE_TRACKS.map((track) => {
            const selected = activeCoreTrack === track.id;
            return (
              <button
                key={track.id}
                type="button"
                data-core-track-tab={track.id}
                aria-pressed={selected}
                onClick={() => handleSelectCoreTrack(track.id)}
                disabled={busy}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "11px",
                  border: selected
                    ? "1.5px solid var(--ys-brand)"
                    : "1px solid var(--ys-border)",
                  background: selected
                    ? "var(--ys-brand-tint)"
                    : "var(--ys-subtle-bg)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                  }}
                >
                  <strong
                    style={{
                      fontSize: "12.5px",
                      color: selected
                        ? "var(--ys-brand-text)"
                        : "var(--ys-ink)",
                    }}
                  >
                    {isKo ? track.shortLabelKo : track.shortLabelEn}
                  </strong>
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 600,
                      color: selected
                        ? "var(--ys-brand-text)"
                        : "var(--ys-ink-muted)",
                    }}
                  >
                    {isKo ? track.badgeKo : track.badgeEn}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    lineHeight: 1.4,
                    color: "var(--ys-ink-secondary)",
                  }}
                >
                  {isKo ? track.priceGuideKo : track.priceGuideEn}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 01: Brand Identity First Registration Gate (Must register/confirm Brand Identity before Studio creation) */}
      {isEditingIdentity || !isIdentityConfirmedLocal ? (
        <div
          className="bw-identity-first-card"
          data-studio-identity-gate="open"
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div>
              <span
                className="bw-chip"
                style={{
                  background: "var(--ys-brand-tint)",
                  color: "var(--ys-brand-text)",
                  fontWeight: 700,
                  marginBottom: "6px",
                }}
              >
                {isKo
                  ? "STEP 01 · 브랜드 아이덴티티 먼저 등록"
                  : "STEP 01 · Register Brand Identity First"}
              </span>
              <h4
                style={{
                  margin: "4px 0",
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--ys-ink)",
                }}
              >
                {isKo
                  ? "화보·영상을 만들기 전에 우리 브랜드의 아이덴티티부터 등록해 주세요"
                  : "Register your brand identity before generating lookbooks or videos"}
              </h4>
              <p className="bw-muted" style={{ margin: 0, fontSize: "12.5px" }}>
                {isKo
                  ? "브랜드의 제품 실루엣·로고 철자·소재 질감 기준과 기본 무드를 먼저 확정하면, 아래 1~4번 레퍼런스 합성과 모든 생성 모델에 자동으로 고정 적용됩니다."
                  : "Confirming your product silhouette, logo spelling, texture rules, and default mood locks them across all 1–4 reference slots and generation models."}
              </p>
            </div>

            {identityHref && (
              <a
                className="bw-button"
                href={identityHref}
                data-studio-identity-page-link
              >
                {isKo
                  ? "브랜드북 · 로고 파일 상세 등록 →"
                  : "Full Brand Book & Logo Setup →"}
              </a>
            )}
          </div>

          {/* Website URL Brand Kit Auto-Builder ("Building your brand kit · Logo · Colors · Type") */}
          <div
            data-studio-brand-kit-extractor
            style={{
              marginTop: "12px",
              padding: "12px 14px",
              borderRadius: "12px",
              background: "#FFFFFF",
              border: "1px solid var(--ys-border)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div>
                <strong style={{ fontSize: "12.5px", color: "var(--ys-ink)" }}>
                  {isKo
                    ? "홈페이지 주소로 브랜드 킷 자동 불러오기 (로고 · 컬러 · 서체)"
                    : "Auto-Build Brand Kit from Website URL (Logo · Colors · Type)"}
                </strong>
                <span
                  className="bw-muted"
                  style={{ marginLeft: "8px", fontSize: "11.5px" }}
                >
                  {isKo
                    ? "주소를 입력하면 로고 약자, 대표 컬러, 어울리는 서체와 3가지 기준을 자동으로 채워 줍니다"
                    : "Enter your domain to auto-extract Logo, Colors, Typography, and 3 Brand Rules"}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  flexWrap: "wrap",
                }}
              >
                <input
                  type="text"
                  className="bw-input"
                  value={brandDomainInput}
                  onChange={(e) => setBrandDomainInput(e.target.value)}
                  placeholder="twings.app"
                  data-brand-kit-domain-input
                  style={{
                    width: "200px",
                    padding: "5px 10px",
                    fontSize: "12px",
                  }}
                />
                <button
                  type="button"
                  className="bw-quick-chip"
                  onClick={handleAutoExtractBrandKit}
                  data-brand-kit-extract-btn
                  style={{
                    background: "var(--ys-brand-tint)",
                    color: "var(--ys-brand-text)",
                    fontWeight: 700,
                  }}
                >
                  {isKo
                    ? "홈페이지에서 자동 불러오기"
                    : "Extract Brand Kit"}
                </button>
              </div>
            </div>

            {/* 3 Extracted Brand Kit Cards: Logo | Colors | Type */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "10px",
              }}
            >
              <div
                data-brand-kit-card="logo"
                style={{
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: "var(--ys-subtle-bg)",
                  boxShadow: "var(--ys-ring)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    background: "var(--ys-ink)",
                    color: "#FFFFFF",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {extractedBrandKit.monogram}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      color: "var(--ys-ink-secondary)",
                    }}
                  >
                    {isKo ? "로고 · 도메인" : "Logo"}
                  </div>
                  <div
                    style={{
                      fontSize: "11.5px",
                      fontWeight: 600,
                      color: "var(--ys-ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {extractedBrandKit.domain}
                  </div>
                </div>
              </div>

              <div
                data-brand-kit-card="colors"
                style={{
                  padding: "8px 12px",
                  borderRadius: "10px",
                  background: "var(--ys-subtle-bg)",
                  boxShadow: "var(--ys-ring)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: "5px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    color: "var(--ys-ink-secondary)",
                  }}
                >
                  <span>{isKo ? "대표 컬러" : "Colors"}</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {extractedBrandKit.colors
                      .map((c) => (isKo ? c.labelKo : c.labelEn))
                      .slice(0, 3)
                      .join(" · ")}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                    height: "18px",
                    borderRadius: "6px",
                    overflow: "hidden",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
                  }}
                >
                  {extractedBrandKit.colors.map((swatch) => (
                    <span
                      key={swatch.hex}
                      title={`${isKo ? swatch.labelKo : swatch.labelEn} (${swatch.hex})`}
                      style={{ background: swatch.hex }}
                    />
                  ))}
                </div>
              </div>

              <div
                data-brand-kit-card="type"
                style={{
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: "var(--ys-subtle-bg)",
                  boxShadow: "var(--ys-ring)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    background: "#FFFFFF",
                    boxShadow: "var(--ys-ring)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "var(--ys-ink)",
                    flexShrink: 0,
                  }}
                >
                  Aa
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      color: "var(--ys-ink-secondary)",
                    }}
                  >
                    {isKo ? "대표 서체" : "Type"}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--ys-ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {extractedBrandKit.displayFont}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Krea-inspired "What are you here to make first?" First Creation Goal Selector */}
          <div
            data-studio-first-goal-picker
            style={{
              marginTop: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "12px",
              }}
            >
              <strong style={{ color: "var(--ys-ink)" }}>
                {isKo
                  ? "오늘 가장 먼저 어떤 결과물을 만들까요? (선택 시 작업 모드·모델·비율 자동 세팅)"
                  : "What are you here to make first? (Auto-configures mode, model & aspect ratio)"}
              </strong>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                gap: "7px",
              }}
            >
              {FIRST_CREATION_GOALS.map((goal) => {
                const selected = selectedFirstGoalId === goal.id;
                return (
                  <button
                    key={goal.id}
                    type="button"
                    data-first-goal-card={goal.id}
                    aria-pressed={selected}
                    onClick={() => handleSelectFirstCreationGoal(goal)}
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: "10px",
                      border: selected
                        ? "1.5px solid var(--ys-brand)"
                        : "1px solid var(--ys-border)",
                      background: selected
                        ? "var(--ys-brand-tint)"
                        : "#FFFFFF",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <strong
                      style={{
                        fontSize: "12px",
                        color: selected
                          ? "var(--ys-brand-text)"
                          : "var(--ys-ink)",
                      }}
                    >
                      {isKo ? goal.titleKo : goal.titleEn}
                    </strong>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--ys-ink-secondary)",
                        lineHeight: 1.35,
                      }}
                    >
                      {isKo ? goal.subtitleKo : goal.subtitleEn}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "10px",
              marginTop: "12px",
            }}
          >
            {(
              [
                {
                  idx: 0,
                  labelKo: "1. 제품 형태 · 실루엣 기준",
                  labelEn: "1. Product Silhouette Rule",
                },
                {
                  idx: 1,
                  labelKo: "2. 로고 · 라벨 철자 보존 기준",
                  labelEn: "2. Logo & Label Spelling Rule",
                },
                {
                  idx: 2,
                  labelKo: "3. 소재 · 피부 · 텍스처 기준",
                  labelEn: "3. Material & Texture Rule",
                },
              ] as const
            ).map((field) => (
              <label
                key={field.idx}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "#FFFFFF",
                  border: "1px solid var(--ys-border)",
                }}
              >
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 700,
                    color: "var(--ys-brand-text)",
                  }}
                >
                  {isKo ? field.labelKo : field.labelEn}
                </span>
                <input
                  type="text"
                  className="bw-input"
                  value={editableRules[field.idx] ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditableRules((prev) => {
                      const next: [string, string, string] = [
                        prev[0],
                        prev[1],
                        prev[2],
                      ];
                      next[field.idx] = val;
                      return next;
                    });
                  }}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12.5px",
                  }}
                  data-studio-identity-rule-input={field.idx}
                />
              </label>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              marginTop: "12px",
              paddingTop: "10px",
              borderTop: "1px solid var(--ys-border-subtle)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--ys-ink-secondary)",
                }}
              >
                {isKo ? "브랜드 기본 조명·색감 톤" : "Default Brand Tone"}
              </span>
              <div className="bw-seg-track">
                {aestheticLines.map((line) => {
                  const isSelected = activeAestheticLineCode === line.code;
                  const label = moodLabels[line.code];
                  return (
                    <button
                      key={line.id}
                      type="button"
                      className="bw-seg-btn"
                      aria-pressed={isSelected}
                      onClick={() => applyMood(line)}
                      disabled={busy}
                    >
                      {isKo ? label.ko : label.en}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="bw-button bw-button-primary"
              onClick={handleConfirmBrandIdentity}
              disabled={busy}
              data-studio-identity-confirm-btn
            >
              {isKo
                ? "1단계 완료: 브랜드 아이덴티티 확정하고 스튜디오 시작하기"
                : "Complete Step 1: Confirm Brand Identity & Start Studio"}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="bw-identity-confirmed-bar"
          data-studio-identity-gate="confirmed"
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px",
              minWidth: 0,
            }}
          >
            <span
              className="bw-chip"
              style={{
                background: "var(--ys-brand-tint)",
                color: "var(--ys-brand-text)",
                fontWeight: 700,
              }}
            >
              {isKo ? "STEP 01 완료 · 브랜드 아이덴티티 적용 중" : "STEP 01 · Brand Identity Locked"}
            </span>
            <span
              style={{
                fontSize: "12.5px",
                color: "var(--ys-ink)",
                fontWeight: 600,
              }}
            >
              {editableRules.filter(Boolean).join(" · ")}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              className="bw-quick-chip"
              onClick={() => setIsEditingIdentity(true)}
              data-studio-identity-edit-btn
            >
              {isKo ? "브랜드 아이덴티티 수정" : "Edit Brand Identity"}
            </button>
            {identityHref && (
              <a className="bw-quick-chip" href={identityHref}>
                {isKo ? "브랜드북 상세" : "Brand Book"}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Developer-IDE Inspired Collapsible Split-Pane Toolbar (Mounted for SSR compatibility, hidden visually to avoid duplicate top bars) */}
      <div
        data-studio-split-pane-toolbar
        data-active-split-mode={splitPaneMode}
        style={{
          display: "none",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          padding: "10px 14px",
          marginBottom: "14px",
          borderRadius: "14px",
          background: "#FFFFFF",
          border: "1px solid #E4E6EC",
          color: "#0E1013",
          boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)",
        }}
      >
        {/* Left: Split-Pane Toggle (Fold/Expand Left Image or Right Video like VS Code / Cursor Split Editor) */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px",
          }}
          data-split-pane-mode-picker
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#6B6F7B",
              marginRight: "4px",
            }}
          >
            {isKo ? "화면 분할:" : "Split View:"}
          </span>
          {STUDIO_SPLIT_PANE_MODES.map((modeSpec) => {
            const active = splitPaneMode === modeSpec.id;
            return (
              <button
                key={modeSpec.id}
                type="button"
                data-split-pane-mode-btn={modeSpec.id}
                aria-pressed={active}
                onClick={() => setSplitPaneMode(modeSpec.id)}
                title={isKo ? modeSpec.shortDescKo : modeSpec.shortDescEn}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 11px",
                  borderRadius: "999px",
                  border: active
                    ? "1.5px solid #3875C5"
                    : "1px solid #E4E6EC",
                  background: active
                    ? "rgba(56, 117, 197, 0.1)"
                    : "#F8F9FB",
                  color: active ? "#3063A7" : "#383B44",
                  fontSize: "12px",
                  fontWeight: active ? 700 : 600,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: "13px" }}>{modeSpec.iconGlyph}</span>
                <span>{isKo ? modeSpec.labelKo : modeSpec.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* Center: Canvas | Copilot | Compose Top Pill Bar (Inspired by Reference UI) */}
        <div
          data-studio-top-workspace-pills
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px",
            borderRadius: "999px",
            background: "#F1F3F7",
            border: "1px solid #E4E6EC",
          }}
        >
          {(
            [
              {
                id: "canvas",
                ko: "좌·우 동시 비교 뷰",
                en: "Dual Split View",
              },
              {
                id: "copilot",
                ko: "브랜드 킷 · 3원칙 점검",
                en: "Brand 3-Rule Check",
              },
              {
                id: "compose",
                ko: "캠페인 · 유통 스토리보드",
                en: "Campaign Storyboard",
              },
            ] as const
          ).map((pill) => {
            const active = workbenchHeaderTab === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                data-workspace-top-pill={pill.id}
                aria-pressed={active}
                onClick={() => setWorkbenchHeaderTab(pill.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "999px",
                  border: 0,
                  background: active ? "#FFFFFF" : "transparent",
                  color: active ? "#3063A7" : "#6B6F7B",
                  boxShadow: active ? "0 1px 3px rgba(15, 23, 42, 0.08)" : "none",
                  fontSize: "12px",
                  fontWeight: active ? 700 : 600,
                  cursor: "pointer",
                }}
              >
                {isKo ? pill.ko : pill.en}
              </button>
            );
          })}
        </div>

        {/* Right: Direct 1-Click Bridge from Left Image Tab -> Right Video +References */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <button
            type="button"
            data-bridge-left-image-to-video-cta
            onClick={() => handleBridgeLeftImageToRightVideo(selectedBridgeSlot)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "999px",
              border: "1px solid rgba(56, 117, 197, 0.85)",
              background: "#3875C5",
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <span>
              {isKo
                ? `좌측 이미지 → 우측 영상 +References 넣기 (${bridgedVideoRefs.length})`
                : `Send Left Image → Right Video +References (${bridgedVideoRefs.length})`}
            </span>
            <span>→</span>
          </button>
        </div>
      </div>

      {/* 2-Column Collapsible Split Studio Workbench: Left = Image Studio Tab, Right = Video & Upscale Dotted Canvas Tab */}
      <div
        className="bw-studio-workbench"
        data-studio-dual-split-workbench
        data-split-pane-layout={splitPaneMode}
        style={
          splitPaneMode !== "dual_split"
            ? { gridTemplateColumns: "1fr" }
            : undefined
        }
      >
        {/* LEFT PANE: Image Studio Tab (When collapsed in `video_only` mode, shows a sleek folded bar to re-expand) */}
        <div
          data-split-pane="left-image"
          data-pane-collapsed={String(splitPaneMode === "video_only")}
        >
          {splitPaneMode === "video_only" && (
            <div
              data-left-image-pane-collapsed-bar
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                padding: "10px 14px",
                marginBottom: "12px",
                borderRadius: "12px",
                background: "var(--ys-subtle-bg)",
                border: "1px solid var(--ys-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="bw-chip" style={{ fontWeight: 700 }}>
                  {isKo ? "좌측 이미지 탭 접힘" : "Left Image Tab Folded"}
                </span>
                <span style={{ fontSize: "12.5px", color: "var(--ys-ink-secondary)" }}>
                  {isKo
                    ? `현재 우측 영상에 연결된 좌측 이미지 레퍼런스: ${bridgedVideoRefs.length}개 (${bridgedVideoRefs.map((r) => r.imageLabelKo).join(" · ")})`
                    : `Bridged image references active in right video pane: ${bridgedVideoRefs.length}`}
                </span>
              </div>
              <button
                type="button"
                className="bw-quick-chip"
                onClick={() => setSplitPaneMode("dual_split")}
                style={{ fontWeight: 700, color: "var(--ys-brand-text)" }}
              >
                {isKo
                  ? "◫ 좌측 이미지 스튜디오 함께 펼치기"
                  : "◫ Expand Left Image Tab"}
              </button>
            </div>
          )}

          {/* Left Pane Header + 1-Click "Send to Right Video +References" Bridge Strip */}
          <div
            data-left-image-pane-header
            data-cross-pane-image-to-video-bridge
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              padding: "10px 12px",
              marginBottom: "12px",
              borderRadius: "12px",
              background:
                "linear-gradient(90deg, rgba(56, 117, 197, 0.09) 0%, rgba(56, 117, 197, 0.02) 100%)",
              border: "1px solid rgba(56, 117, 197, 0.28)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                className="bw-chip"
                style={{
                  background: "var(--ys-brand)",
                  color: "#FFFFFF",
                  fontWeight: 700,
                }}
              >
                {isKo ? "LEFT TAB · 이미지 스튜디오" : "LEFT TAB · Image Studio"}
              </span>
              <strong style={{ fontSize: "12.5px", color: "var(--ys-ink)" }}>
                {isKo
                  ? "여기서 만든 이미지를 우측 영상 탭의 시작 프레임이나 +References로 바로 넘기세요:"
                  : "Send your image from this left tab straight into the right video tab's +References:"}
              </strong>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "5px",
              }}
            >
              {VIDEO_REFERENCE_TARGET_SLOTS.map((slot) => {
                const isSlotSelected = selectedBridgeSlot === slot.id;
                const alreadyBridged = bridgedVideoRefs.some(
                  (r) => r.slotId === slot.id,
                );
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className="bw-quick-chip"
                    data-bridge-slot-btn={slot.id}
                    aria-pressed={isSlotSelected}
                    onClick={() => handleBridgeLeftImageToRightVideo(slot.id)}
                    title={isKo ? slot.roleKo : slot.roleEn}
                    style={{
                      padding: "4px 9px",
                      fontSize: "11px",
                      fontWeight: isSlotSelected || alreadyBridged ? 700 : 500,
                      background: isSlotSelected
                        ? "var(--ys-brand)"
                        : alreadyBridged
                          ? "var(--ys-brand-tint)"
                          : "var(--ys-surface)",
                      color: isSlotSelected
                        ? "#FFFFFF"
                        : alreadyBridged
                          ? "var(--ys-brand-text)"
                          : "var(--ys-ink)",
                    }}
                  >
                    {alreadyBridged ? "✓ " : "→ "}
                    {isKo ? slot.badgeKo : slot.badgeEn}
                  </button>
                );
              })}

              <button
                type="button"
                className="bw-quick-chip"
                data-fold-right-pane-btn
                onClick={() =>
                  setSplitPaneMode((prev) =>
                    prev === "image_only" ? "dual_split" : "image_only",
                  )
                }
                style={{
                  padding: "4px 9px",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {splitPaneMode === "image_only"
                  ? isKo
                    ? "◫ 우측 영상 탭 펼치기"
                    : "◫ Show Right Video Tab"
                  : isKo
                    ? "◧ 우측 접기"
                    : "◧ Fold Right"}
              </button>
            </div>
          </div>

          {/* Image Studio Sub-Mode Switcher: Multi-Ref Generation vs Micro-Region Editing vs Canvas Drag-to-Reference */}
          {!isVideoMode && (
            <div
              data-studio-image-submode={imageSubMode}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                marginBottom: "14px",
                padding: "10px 12px",
                borderRadius: "13px",
                background: "var(--ys-subtle-bg)",
                boxShadow: "var(--ys-ring)",
              }}
            >
              <div>
                <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
                  {isKo
                    ? "이미지 스튜디오 작업 방식"
                    : "Image Studio Workflow Mode"}
                </strong>
                <span
                  className="bw-muted"
                  style={{ marginLeft: "8px", fontSize: "12px" }}
                >
                  {imageSubMode === "micro_region_edit"
                    ? isKo
                      ? "캔버스에서 고칠 부분만 드래그해 원본 훼손 없이 자연스럽게 수정합니다"
                      : "Drag a micro-region on the canvas to edit only that area via a Smart Layer Mask"
                    : imageSubMode === "canvas_drag_ref"
                      ? isKo
                        ? "캔버스 위 여러 사진을 드래그해 참고 이미지로 한 번에 묶어 합성합니다"
                        : "Drag across canvas assets to attach them as a multi-reference bundle"
                      : isKo
                        ? "1~4번 역할별 참고 사진과 고정된 색감·질감으로 화보를 만듭니다"
                        : "Generate lookbooks from 1–4 role-locked references and pinned style locks"}
                </span>
              </div>

              <div className="bw-seg-track">
                <button
                  type="button"
                  className="bw-seg-btn"
                  data-image-submode-btn="multi_ref_generate"
                  aria-pressed={imageSubMode === "multi_ref_generate"}
                  onClick={() => handleSwitchImageSubMode("multi_ref_generate")}
                  disabled={busy}
                >
                  {isKo
                    ? "1~4번 참고 사진으로 생성"
                    : "Multi-Ref Generation"}
                </button>
                <button
                  type="button"
                  className="bw-seg-btn"
                  data-image-submode-btn="micro_region_edit"
                  aria-pressed={imageSubMode === "micro_region_edit"}
                  onClick={() => handleSwitchImageSubMode("micro_region_edit")}
                  disabled={busy}
                >
                  {isKo
                    ? "원하는 부위만 부분 수정"
                    : "Micro-Region Image Editing"}
                </button>
                <button
                  type="button"
                  className="bw-seg-btn"
                  data-image-submode-btn="canvas_drag_ref"
                  aria-pressed={imageSubMode === "canvas_drag_ref"}
                  onClick={() => handleSwitchImageSubMode("canvas_drag_ref")}
                  disabled={busy}
                >
                  {isKo
                    ? "캔버스에서 드래그해 조합"
                    : "Canvas Drag Reference"}
                </button>
              </div>
            </div>
          )}

          {/* Pinned Color Reference & Pinned Texture Reference Lock Bar */}
          <div
            className="bw-pinned-ref-bar"
            data-studio-pinned-style-refs
            data-color-pinned={String(isColorRefPinned)}
            data-texture-pinned={String(isTextureRefPinned)}
            style={
              studioSurfaceMode === "track_video_upscale" ||
              studioSurfaceMode === "track_creator_format" ||
              studioSurfaceMode === "track_creator_distribution" ||
              studioSurfaceMode === "track_audio"
                ? { display: "none" }
                : undefined
            }
          >
            {/* Card 1: Pinned Color Reference (색감 참고용 고정) */}
            <div
              className="bw-pinned-ref-card"
              data-pinned={String(isColorRefPinned)}
              data-pinned-color-card
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "999px",
                      background: activePinnedColor.swatchHex,
                      flexShrink: 0,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
                    }}
                  />
                  <strong
                    style={{
                      fontSize: "12.5px",
                      color: "var(--ys-ink)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isKo
                      ? "브랜드 색감 고정"
                      : "Pin Color Grade"}
                  </strong>
                </div>

                <button
                  type="button"
                  className="bw-pin-toggle"
                  aria-pressed={isColorRefPinned}
                  onClick={() => setIsColorRefPinned((prev) => !prev)}
                  data-pin-color-toggle
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {isColorRefPinned
                    ? isKo
                      ? "색감 고정 켜짐"
                      : "Color Pinned ON"
                    : isKo
                      ? "색감 고정 해제"
                      : "Pin Color"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <img
                  src={customPinnedColorThumb || activePinnedColor.thumb}
                  alt={
                    customPinnedColorName ||
                    (isKo
                      ? activePinnedColor.titleKo
                      : activePinnedColor.titleEn)
                  }
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "8px",
                    objectFit: "cover",
                    flexShrink: 0,
                    boxShadow: "var(--ys-ring)",
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--ys-ink)",
                    }}
                  >
                    {customPinnedColorName ||
                      (isKo
                        ? activePinnedColor.titleKo
                        : activePinnedColor.titleEn)}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--ys-ink-secondary)",
                      marginTop: "2px",
                    }}
                  >
                    {isKo
                      ? activePinnedColor.ruleKo
                      : activePinnedColor.ruleEn}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                {PINNED_COLOR_REFERENCES.map((preset) => {
                  const selected =
                    !customPinnedColorName && pinnedColorRefId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="bw-quick-chip"
                      aria-pressed={selected}
                      onClick={() => {
                        setPinnedColorRefId(preset.id);
                        setCustomPinnedColorName("");
                        setCustomPinnedColorThumb("");
                        setIsColorRefPinned(true);
                      }}
                      style={{
                        padding: "3px 8px",
                        fontSize: "11px",
                        fontWeight: selected ? 700 : 500,
                      }}
                    >
                      {isKo ? preset.titleKo : preset.titleEn}
                    </button>
                  );
                })}
                <label
                  className="bw-quick-chip"
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--ys-brand-text)",
                  }}
                >
                  {isKo ? "+ 내 색감 사진 고정" : "+ Upload Color Ref"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePinnedColorFileUpload}
                    style={{ display: "none" }}
                    data-pin-color-file-input
                  />
                </label>
              </div>
            </div>

            {/* Card 2: Pinned Texture Reference (이미지 질감 참고용 고정) */}
            <div
              className="bw-pinned-ref-card"
              data-pinned={String(isTextureRefPinned)}
              data-pinned-texture-card
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "999px",
                      background: activePinnedTexture.swatchHex,
                      flexShrink: 0,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
                    }}
                  />
                  <strong
                    style={{
                      fontSize: "12.5px",
                      color: "var(--ys-ink)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isKo
                      ? "표면·피부 질감 고정"
                      : "Pin Surface Texture"}
                  </strong>
                </div>

                <button
                  type="button"
                  className="bw-pin-toggle"
                  aria-pressed={isTextureRefPinned}
                  onClick={() => setIsTextureRefPinned((prev) => !prev)}
                  data-pin-texture-toggle
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {isTextureRefPinned
                    ? isKo
                      ? "질감 고정 켜짐"
                      : "Texture Pinned ON"
                    : isKo
                      ? "질감 고정 해제"
                      : "Pin Texture"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <img
                  src={customPinnedTextureThumb || activePinnedTexture.thumb}
                  alt={
                    customPinnedTextureName ||
                    (isKo
                      ? activePinnedTexture.titleKo
                      : activePinnedTexture.titleEn)
                  }
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "8px",
                    objectFit: "cover",
                    flexShrink: 0,
                    boxShadow: "var(--ys-ring)",
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--ys-ink)",
                    }}
                  >
                    {customPinnedTextureName ||
                      (isKo
                        ? activePinnedTexture.titleKo
                        : activePinnedTexture.titleEn)}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--ys-ink-secondary)",
                      marginTop: "2px",
                    }}
                  >
                    {isKo
                      ? activePinnedTexture.ruleKo
                      : activePinnedTexture.ruleEn}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                {PINNED_TEXTURE_REFERENCES.map((preset) => {
                  const selected =
                    !customPinnedTextureName && pinnedTextureRefId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="bw-quick-chip"
                      aria-pressed={selected}
                      onClick={() => {
                        setPinnedTextureRefId(preset.id);
                        setCustomPinnedTextureName("");
                        setCustomPinnedTextureThumb("");
                        setIsTextureRefPinned(true);
                      }}
                      style={{
                        padding: "3px 8px",
                        fontSize: "11px",
                        fontWeight: selected ? 700 : 500,
                      }}
                    >
                      {isKo ? preset.titleKo : preset.titleEn}
                    </button>
                  );
                })}
                <label
                  className="bw-quick-chip"
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--ys-brand-text)",
                  }}
                >
                  {isKo ? "+ 내 질감 사진 고정" : "+ Upload Texture Ref"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePinnedTextureFileUpload}
                    style={{ display: "none" }}
                    data-pin-texture-file-input
                  />
                </label>
              </div>
            </div>
          </div>

          {/* STEP 2: Numbered 1-4 Reference Image Slots (Sunra / AMERICANO / Oplux Style) */}
          <div
            style={{
              display:
                studioSurfaceMode === "track_video_upscale" ||
                studioSurfaceMode === "track_creator_format" ||
                studioSurfaceMode === "track_creator_distribution" ||
                studioSurfaceMode === "track_audio"
                  ? "none"
                  : "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              marginBottom: "10px",
            }}
          >
            <div>
              <strong style={{ fontSize: "13.5px", color: "var(--ys-ink)" }}>
                {isKo
                  ? "STEP 02 · 1~4번 레퍼런스 이미지 배치"
                  : "STEP 02 · 1–4 Numbered Reference Slots"}
              </strong>
              <span
                className="bw-muted"
                style={{ marginLeft: "8px", fontSize: "12px" }}
              >
                {isKo
                  ? activeRefWorkflow.summaryKo
                  : activeRefWorkflow.summaryEn}
              </span>
            </div>

            {/* Workflow Preset Toggle: 1-4 Lookbook Composite vs 1->2 Product Swap */}
            <div
              className="bw-seg-track"
              data-studio-reference-workflow={refWorkflowId}
            >
              <button
                type="button"
                className="bw-seg-btn"
                data-workflow-mode-btn="lookbook_composite"
                aria-pressed={refWorkflowId === "lookbook_composite"}
                onClick={() => handleSelectWorkflowMode("lookbook_composite")}
                disabled={busy}
              >
                {isKo
                  ? "인물 · 배경 · 감도 · 색감 조합"
                  : "1 Person + 2 BG + 3 Vibe + 4 Color"}
              </button>
              <button
                type="button"
                className="bw-seg-btn"
                data-workflow-mode-btn="product_swap"
                aria-pressed={refWorkflowId === "product_swap"}
                onClick={() => handleSelectWorkflowMode("product_swap")}
                disabled={busy}
              >
                {isKo
                  ? "1번 장면 → 2번 제품 교체"
                  : "Swap Image 1 → Image 2 Product"}
              </button>
            </div>
          </div>

          <div
            className="bw-ref-slot-grid"
            data-studio-asset-upload
            style={
              studioSurfaceMode === "track_video_upscale" ||
              studioSurfaceMode === "track_creator_format" ||
              studioSurfaceMode === "track_creator_distribution" ||
              studioSurfaceMode === "track_audio"
                ? { display: "none" }
                : undefined
            }
          >
            {activeRefWorkflow.slots.map((slot) => {
              const thumbSrc =
                customSlotThumbs[slot.slotNumber] ??
                (slot.slotNumber === 3 && customPinnedTextureThumb
                  ? customPinnedTextureThumb
                  : slot.slotNumber === 4 && customPinnedColorThumb
                    ? customPinnedColorThumb
                    : slot.defaultThumb);
              const assetName =
                customSlotNames[slot.slotNumber] ??
                (isKo ? slot.defaultAssetNameKo : slot.defaultAssetNameEn);
              const roleTitle = isKo ? slot.roleTitleKo : slot.roleTitleEn;
              const compatSlotAttr =
                slot.slotNumber === 1
                  ? "reference"
                  : slot.slotNumber === 2
                    ? "product"
                    : `slot-${slot.slotNumber}`;
              const isSlotPinned =
                slot.slotNumber === 3
                  ? isTextureRefPinned
                  : slot.slotNumber === 4
                    ? isColorRefPinned
                    : false;

              return (
                <div
                  key={slot.slotNumber}
                  className="bw-ref-slot-card"
                  data-ref-slot={slot.slotNumber}
                  data-upload-slot={compatSlotAttr}
                  style={
                    isSlotPinned
                      ? {
                          boxShadow:
                            "0 0 0 1.5px var(--ys-brand), var(--ys-shadow-1)",
                        }
                      : undefined
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "4px",
                    }}
                  >
                    <span className="bw-ref-num-badge">
                      {isKo ? slot.tagKo : slot.tagEn}
                    </span>

                    {(slot.slotNumber === 3 || slot.slotNumber === 4) && (
                      <button
                        type="button"
                        className="bw-pin-toggle"
                        aria-pressed={isSlotPinned}
                        onClick={() => {
                          if (slot.slotNumber === 3) {
                            setIsTextureRefPinned((p) => !p);
                          } else {
                            setIsColorRefPinned((p) => !p);
                          }
                        }}
                        style={{ padding: "2px 7px", fontSize: "10px" }}
                        data-slot-pin-btn={slot.slotNumber}
                      >
                        {isSlotPinned
                          ? isKo
                            ? "고정됨"
                            : "Pinned"
                          : isKo
                            ? "고정"
                            : "Pin"}
                      </button>
                    )}
                  </div>

                  <div className="bw-ref-slot-media">
                    <img src={thumbSrc} alt={assetName} loading="lazy" />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <strong
                      style={{
                        display: "block",
                        fontSize: "12.5px",
                        color: "var(--ys-ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {roleTitle}
                    </strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: "11px",
                        color: "var(--ys-ink-secondary)",
                        marginTop: "2px",
                      }}
                    >
                      {isKo ? slot.lockRuleKo : slot.lockRuleEn}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "5px",
                      marginTop: "auto",
                      paddingTop: "4px",
                    }}
                  >
                    <label
                      className="bw-quick-chip"
                      style={{
                        fontWeight: 600,
                        padding: "3px 7px",
                        fontSize: "11px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isKo ? "사진 변경" : "Upload"}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          handleSlotFileUpload(slot.slotNumber, e)
                        }
                        disabled={!canWrite || busy}
                        style={{ display: "none" }}
                        data-studio-slot-file-input={slot.slotNumber}
                      />
                    </label>
                    <button
                      type="button"
                      className="bw-quick-chip"
                      style={{
                        padding: "3px 7px",
                        fontSize: "11px",
                        whiteSpace: "nowrap",
                      }}
                      onClick={() =>
                        handleInsertSlotReferenceIntoPrompt(
                          slot.slotNumber,
                          roleTitle,
                        )
                      }
                      disabled={!canWrite || busy}
                    >
                      {isKo
                        ? `+ ${slot.slotNumber}번 넣기`
                        : `+ Cite #${slot.slotNumber}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Oplux-Style Micro-Region Image Editing Section (극소 부위 정밀 수정 · 스마트 레이어 마스크) */}
          {!isVideoMode && (
            <div
              data-studio-micro-edit-section
              style={{
                borderRadius: "14px",
                padding: "14px 16px",
                marginBottom: "16px",
                background:
                  imageSubMode === "micro_region_edit"
                    ? "linear-gradient(180deg, rgba(56, 117, 197, 0.08) 0%, #FFFFFF 100%)"
                    : "var(--ys-subtle-bg)",
                boxShadow:
                  imageSubMode === "micro_region_edit"
                    ? "0 0 0 1.5px var(--ys-brand), var(--ys-shadow-1)"
                    : "var(--ys-ring)",
                display: "grid",
                gap: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <div>
                  <span
                    className="bw-chip"
                    style={{
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                      fontWeight: 700,
                      marginRight: "8px",
                    }}
                  >
                    {isKo
                      ? "원하는 부위만 부분 수정"
                      : "Micro-Region Image Editing"}
                  </span>
                  <strong style={{ fontSize: "13.5px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "드래그한 부위 안쪽만 자연스럽게 고치고 나머지 원본 사진은 100% 그대로 보존합니다"
                      : "Drag any micro-region to edit while locking 100% of pixels outside the selection"}
                  </strong>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span
                    className="bw-badge"
                    data-studio-mask-bounds-badge
                    style={{ fontFamily: "var(--ys-mono)", fontSize: "11px" }}
                  >
                    {isKo
                      ? `선택 부위: ${selectionRect.xPct}%,${selectionRect.yPct}% (${matchedSelectionRatio}) · 원본 보존`
                      : `Bounds: ${selectionRect.xPct}%,${selectionRect.yPct}% (${matchedSelectionRatio}) · Mask ON`}
                  </span>
                  <span
                    className="bw-chip"
                    data-smart-mask-pixel-lock-badge
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                    }}
                  >
                    {isKo
                      ? "경계 페더링 25% · 마스크 외 영역 100% 픽셀 보존"
                      : "25% Edge Feather · 100% Outside-Mask Pixel Lock"}
                  </span>
                  <button
                    type="button"
                    className="bw-quick-chip"
                    onClick={() =>
                      setImageSubMode((prev) =>
                        prev === "micro_region_edit"
                          ? "multi_ref_generate"
                          : "micro_region_edit",
                      )
                    }
                    style={{ fontWeight: 600, fontSize: "11px" }}
                  >
                    {imageSubMode === "micro_region_edit"
                      ? isKo
                        ? "부분 수정 도구 접기"
                        : "Collapse Editor"
                      : isKo
                        ? "부분 수정 도구 열기"
                        : "Open Region Editor"}
                  </button>
                </div>
              </div>

              {/* 4 Quick Micro-Region Target Presets */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px",
                }}
                data-studio-micro-region-presets
              >
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: "var(--ys-ink-secondary)",
                  }}
                >
                  {isKo ? "수정할 부위 빠른 선택:" : "Quick target region:"}
                </span>
                {MICRO_REGION_SELECTION_PRESETS.map((preset) => {
                  const selected =
                    imageSubMode === "micro_region_edit" &&
                    activeRegionPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="bw-quick-chip"
                      data-micro-region-preset={preset.id}
                      aria-pressed={selected}
                      onClick={() => handleSelectRegionPreset(preset.id)}
                      disabled={busy}
                      style={{
                        fontWeight: selected ? 700 : 500,
                        boxShadow: selected
                          ? "0 0 0 1.5px var(--ys-brand)"
                          : undefined,
                      }}
                    >
                      {isKo ? preset.labelKo : preset.labelEn}
                    </button>
                  );
                })}
              </div>

              {/* Expanded Micro-Edit Model & Resolution Controls when in micro_region_edit mode */}
              {imageSubMode === "micro_region_edit" && (
                <>
                  <div
                    className="bw-model-picker-grid"
                    style={{ marginBottom: 0 }}
                    data-studio-micro-edit-model-picker
                  >
                    {BRAND_STUDIO_MICRO_EDIT_MODELS.map((editModel) => {
                      const selected =
                        selectedMicroEditModelId === editModel.id;
                      return (
                        <button
                          key={editModel.id}
                          type="button"
                          className="bw-model-card"
                          data-studio-micro-edit-model={editModel.id}
                          aria-pressed={selected}
                          onClick={() => {
                            setSelectedMicroEditModelId(editModel.id);
                            setImageSubMode("micro_region_edit");
                          }}
                          disabled={busy}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "6px",
                              width: "100%",
                            }}
                          >
                            <strong style={{ fontSize: "12.5px" }}>
                              {isKo ? editModel.nameKo : editModel.nameEn}
                            </strong>
                            <span
                              className="bw-scene-spec"
                              style={{ fontWeight: 600 }}
                            >
                              {editModel.creditsPerEdit} cr ·{" "}
                              {isKo
                                ? `${editModel.priceKrwPerEdit}원`
                                : `KRW ${editModel.priceKrwPerEdit}`}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: "11.5px",
                              lineHeight: 1.4,
                              color: "var(--ys-ink-secondary)",
                            }}
                          >
                            {isKo
                              ? editModel.shortTraitKo
                              : editModel.shortTraitEn}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Oplux-style Parameter Pills: Resolution (1K/2K/4K), Quality (Low/Medium/High), Batch Size (1/2/4), Attach Selection */}
                  <div
                    data-studio-oplux-controls
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      paddingTop: "8px",
                      borderTop: "1px solid var(--ys-hairline)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {/* Resolution */}
                      <div className="bw-seg-track">
                        {activeMicroEditModel.supportedResolutions.map(
                          (res) => (
                            <button
                              key={res}
                              type="button"
                              className="bw-seg-btn"
                              aria-pressed={microEditResolution === res}
                              onClick={() => setMicroEditResolution(res)}
                              disabled={busy}
                            >
                              {res}
                            </button>
                          ),
                        )}
                      </div>

                      {/* Quality Tier (Low / Medium / High) */}
                      <div className="bw-seg-track">
                        {(["Low", "Medium", "High"] as const).map((q) => (
                          <button
                            key={q}
                            type="button"
                            className="bw-seg-btn"
                            aria-pressed={microEditQuality === q}
                            onClick={() => setMicroEditQuality(q)}
                            disabled={busy}
                          >
                            {isKo
                              ? q === "Low"
                                ? "빠른 확인"
                                : q === "Medium"
                                  ? "표준 화질"
                                  : "최고 화질"
                              : `Quality: ${q}`}
                          </button>
                        ))}
                      </div>

                      {/* Batch Size */}
                      <div className="bw-seg-track">
                        {([1, 2, 4] as const).map((cnt) => (
                          <button
                            key={cnt}
                            type="button"
                            className="bw-seg-btn"
                            aria-pressed={microEditBatchSize === cnt}
                            onClick={() => setMicroEditBatchSize(cnt)}
                            disabled={busy}
                          >
                            {isKo ? `${cnt}장 비교` : `${cnt}x Batch`}
                          </button>
                        ))}
                      </div>

                      <span
                        className="bw-chip"
                        data-smart-mask-pixel-lock-badge
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          background: "var(--ys-brand-tint)",
                          color: "var(--ys-brand-text)",
                        }}
                      >
                        {isKo
                          ? "경계 페더링 25% · 마스크 외 영역 100% 픽셀 보존"
                          : "25% Edge Feather · 100% Outside-Mask Pixel Lock"}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="bw-quick-chip"
                      onClick={handleAttachCanvasSelection}
                      data-studio-attach-selection-btn
                      style={{
                        fontWeight: 700,
                        color: "var(--ys-brand-text)",
                        background: "var(--ys-brand-tint)",
                      }}
                    >
                      {isKo
                        ? "+ 드래그한 선택 부위를 지시문에 넣기"
                        : "+ Attach Selected Region to Prompt"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: Image Model Selector + Quick Characteristics + Detailed Suitability Guide */}
          {!isVideoMode && (
            <div data-studio-image-model-section>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <div>
                  <strong style={{ fontSize: "13.5px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "STEP 03 · 이미지 생성 모델 선택"
                      : "STEP 03 · Select Image Generation Model"}
                  </strong>
                  <span
                    className="bw-muted"
                    style={{ marginLeft: "8px", fontSize: "12px" }}
                  >
                    {isKo
                      ? "만들려는 결과물(제품 교체 · 메인 화보 · 로고 선명도 · 의류 착장)에 맞춰 모델을 고르세요"
                      : "Pick the model tailored to your target deliverable"}
                  </span>
                </div>
                <button
                  type="button"
                  className="bw-quick-chip"
                  data-studio-model-guide-toggle
                  aria-expanded={showFullModelGuide}
                  onClick={() => setShowFullModelGuide((prev) => !prev)}
                  style={{ fontWeight: 600 }}
                >
                  {showFullModelGuide
                    ? isKo
                      ? "모델 비교 가이드 접기"
                      : "Hide Model Guide"
                    : isKo
                      ? "어떤 결과물에 어떤 모델이 적합한가요? (상세 가이드)"
                      : "Which model fits my deliverable? (Full Guide)"}
                </button>
              </div>

              {/* 5 Image Model Cards (GPT Image 2.6 · Nano Banana Pro · Nano Banana 2.1 · Nano Banana 2.0 · Seedream 5.0 Pro) */}
              <div
                className="bw-model-picker-grid"
                data-studio-image-model-picker
                data-selected-image-model={selectedImageModelId}
              >
                {BRAND_STUDIO_IMAGE_MODELS.map((model, idx) => {
                  const selected = selectedImageModelId === model.id;
                  const isFullSpanCard =
                    idx === BRAND_STUDIO_IMAGE_MODELS.length - 1 &&
                    BRAND_STUDIO_IMAGE_MODELS.length % 2 === 1;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className="bw-model-card"
                      data-studio-image-model-card={model.id}
                      aria-pressed={selected}
                      onClick={() => handleSelectImageModel(model.id)}
                      disabled={busy}
                      style={
                        isFullSpanCard ? { gridColumn: "1 / -1" } : undefined
                      }
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          width: "100%",
                        }}
                      >
                        <strong style={{ fontSize: "13.5px" }}>
                          {isKo ? model.nameKo : model.nameEn}
                        </strong>
                        <span
                          className="bw-scene-spec"
                          style={{ fontWeight: 600 }}
                        >
                          {model.creditsPer5Set} cr ·{" "}
                          {isKo
                            ? `${model.priceKrwPer5Set.toLocaleString("ko-KR")}원`
                            : `KRW ${model.priceKrwPer5Set}`}
                        </span>
                      </div>

                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: selected
                            ? "var(--ys-brand-text)"
                            : "var(--ys-ink-secondary)",
                        }}
                      >
                        {isKo ? model.tierBadgeKo : model.tierBadgeEn}
                      </span>

                      <span
                        style={{
                          fontSize: "12px",
                          lineHeight: 1.45,
                          color: "var(--ys-ink-secondary)",
                        }}
                      >
                        {isKo ? model.shortTraitKo : model.shortTraitEn}
                      </span>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "5px",
                          marginTop: "2px",
                        }}
                      >
                        {(isKo ? model.strengthsKo : model.strengthsEn).map(
                          (tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: "10.5px",
                                padding: "2px 7px",
                                borderRadius: "999px",
                                background: "var(--ys-raised)",
                                color: "var(--ys-ink-secondary)",
                                fontWeight: 500,
                              }}
                            >
                              {tag}
                            </span>
                          ),
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Model Detail & Deliverable Recommendation Box */}
              <div
                className="bw-model-guide-panel"
                data-studio-active-model-detail={activeImageModel.id}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? `${activeImageModel.nameKo} — 상세 특징 & 추천 결과물`
                      : `${activeImageModel.nameEn} — Detailed Characteristics & Best Use Cases`}
                  </strong>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      className="bw-chip"
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 600,
                        background: "var(--ys-brand-tint)",
                        color: "var(--ys-brand-text)",
                      }}
                    >
                      {isKo
                        ? activeImageModel.promptFormulaBadgeKo
                        : activeImageModel.promptFormulaBadgeEn}
                    </span>
                    <span
                      className="bw-badge"
                      style={{ fontSize: "11px", fontWeight: 600 }}
                    >
                      {isKo
                        ? `권장 슬롯 공식: ${activeImageModel.recommendedSlotFormulaKo}`
                        : `Slot Formula: ${activeImageModel.recommendedSlotFormulaEn}`}
                    </span>
                    <button
                      type="button"
                      className="bw-quick-chip"
                      data-apply-model-optimal-prompt={activeImageModel.id}
                      onClick={() => {
                        setBriefText(
                          isKo
                            ? `[${activeImageModel.nameKo} 최적화 공식] ${activeImageModel.recommendedSlotFormulaKo} — 1번 인물에 2번 제품을 자연스럽게 매칭하고 4번 브랜드 색감 핀을 100% 고정해 촬영해 주세요.`
                            : `[${activeImageModel.nameEn} Optimal Formula] ${activeImageModel.recommendedSlotFormulaEn} — Match @Image 1 subject with @Image 2 product under @Image 4 pinned lighting.`,
                        );
                      }}
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        background: "#3875C5",
                        color: "#FFFFFF",
                        border: "1px solid #3875C5",
                      }}
                    >
                      {isKo
                        ? "+ 이 모델 최적화 프롬프트·슬롯 공식 1클릭 적용"
                        : "+ Apply Optimal Model Prompt Formula"}
                    </button>
                  </div>
                </div>

                <p
                  style={{
                    margin: 0,
                    fontSize: "12.5px",
                    lineHeight: 1.55,
                    color: "var(--ys-ink-secondary)",
                  }}
                >
                  {isKo
                    ? activeImageModel.detailDescriptionKo
                    : activeImageModel.detailDescriptionEn}
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                    gap: "8px",
                  }}
                >
                  {(isKo
                    ? activeImageModel.bestForDeliverablesKo
                    : activeImageModel.bestForDeliverablesEn
                  ).map((useCase, idx) => (
                    <div
                      key={useCase}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "10px",
                        background: "var(--ys-surface)",
                        boxShadow: "var(--ys-ring)",
                        fontSize: "11.5px",
                        lineHeight: 1.45,
                        color: "var(--ys-ink)",
                      }}
                    >
                      <strong
                        style={{
                          display: "block",
                          fontSize: "10.5px",
                          color: "var(--ys-ink-muted)",
                          marginBottom: "2px",
                        }}
                      >
                        {isKo ? `추천 결과물 0${idx + 1}` : `Best Fit 0${idx + 1}`}
                      </strong>
                      {useCase}
                    </div>
                  ))}
                </div>

                {/* Full 5-Model Comparison Matrix when toggled open */}
                {showFullModelGuide && (
                  <div
                    data-studio-model-comparison-matrix
                    style={{
                      paddingTop: "10px",
                      borderTop: "1px solid var(--ys-hairline)",
                      display: "grid",
                      gap: "8px",
                    }}
                  >
                    <strong style={{ fontSize: "12px", color: "var(--ys-ink)" }}>
                      {isKo
                        ? "상황별 5종 이미지 모델 한눈에 비교하기"
                        : "5-Model Suitability Comparison by Deliverable"}
                    </strong>
                    {BRAND_STUDIO_IMAGE_MODELS.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: "8px",
                          padding: "8px 10px",
                          borderRadius: "9px",
                          background: "var(--ys-surface)",
                          fontSize: "12px",
                        }}
                      >
                        <div>
                          <strong style={{ color: "var(--ys-ink)" }}>
                            {isKo ? m.nameKo : m.nameEn}
                          </strong>{" "}
                          <span style={{ color: "var(--ys-ink-secondary)" }}>
                            — {isKo ? m.shortTraitKo : m.shortTraitEn}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: "var(--ys-mono)",
                            fontSize: "11px",
                            color: "var(--ys-ink-muted)",
                          }}
                        >
                          {isKo
                            ? m.recommendedSlotFormulaKo
                            : m.recommendedSlotFormulaEn}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SEEDANCE 2.5 VIDEO TIERS (480p Draft · 720p Standard · 1080p Native) + DEDICATED UPSCALING & INSTAGRAM REELS OPTIMIZATION STUDIO */}
          <div
            data-studio-video-and-upscale-hub
            style={{
              borderRadius: "15px",
              padding: "14px 16px",
              marginBottom: "14px",
              background: "var(--ys-surface)",
              border: isVideoMode
                ? "1.5px solid var(--ys-brand)"
                : "1px solid var(--ys-border)",
              boxShadow: "var(--ys-ring)",
              display:
                studioSurfaceMode === "track_image" ||
                studioSurfaceMode === "track_creator_format" ||
                studioSurfaceMode === "track_creator_distribution" ||
                studioSurfaceMode === "track_audio"
                  ? "none"
                  : "grid",
              gap: "14px",
            }}
          >
            {/* Part A: Seedance 2.5 3-Tier Video Generation (480p Draft Mode / 720p Standard / 1080p Native) */}
            <div data-studio-seedance-tier-section>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "10px",
                }}
              >
                <div>
                  <span
                    className="bw-chip"
                    style={{
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                      fontWeight: 700,
                      marginRight: "8px",
                    }}
                  >
                    {isKo
                      ? "Seedance 2.5 영상 생성"
                      : "Seedance 2.5 Video Generation"}
                  </span>
                  <strong style={{ fontSize: "13.5px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "480p(Draft 모드) · 720p(표준) · 1080p(본편) 3단계 해상도 제공 — 720p로 빠르게 만든 뒤 1080p/4K로 업스케일하세요"
                      : "Choose 480p (Draft Mode), 720p (Standard), or 1080p (Native Master) — or generate in 720p and upscale to 1080p/4K"}
                  </strong>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                  <button
                    type="button"
                    className="bw-quick-chip"
                    data-reels-oneclick-bundle-cta
                    onClick={() => {
                      handleSelectSeedanceTier("seedance_2_5_720p_standard");
                      setSelectedUpscalerEngineId("sunra_ig_1080p_upscaler");
                      setUpscaleTargetResolution("1080p");
                      setIsUpscaleStudioExpanded(true);
                      handleRunUpscaleStudioJob();
                    }}
                    style={{
                      fontWeight: 700,
                      background: "#3875C5",
                      color: "#FFFFFF",
                      border: "1px solid #3875C5",
                    }}
                  >
                    {isKo
                      ? "릴스 무열화 원클릭 완제 패키지 (Seedance 720p + 1080p 인스타 최적화 · 3,300원)"
                      : "1-Click Reels Package (Seedance 720p + 1080p IG Master · KRW 3,300)"}
                  </button>
                  <button
                    type="button"
                    className="bw-quick-chip"
                    data-studio-toggle-upscale-panel-btn
                    aria-expanded={isUpscaleStudioExpanded}
                    onClick={() => setIsUpscaleStudioExpanded((p) => !p)}
                    style={{ fontWeight: 700, color: "var(--ys-brand-text)" }}
                  >
                    {isUpscaleStudioExpanded
                      ? isKo
                        ? "업스케일링 스튜디오 접기"
                        : "Collapse Upscaling Studio"
                      : isKo
                        ? "업스케일링 · 인스타 최적화 스튜디오 열기"
                        : "Open Upscaling & IG Studio"}
                  </button>
                </div>
              </div>

              {/* 480p Draft -> 1080p Instant Finalize Agency Cost-Saving Workflow Bar */}
              <div
                data-draft-480p-promote-1080p-bar
                style={{
                  marginBottom: "10px",
                  padding: "9px 12px",
                  borderRadius: "10px",
                  background: "var(--ys-subtle-bg)",
                  border: "1px solid var(--ys-border-subtle)",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "11.5px" }}>
                  <span
                    className="bw-chip"
                    style={{
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                      fontWeight: 700,
                    }}
                  >
                    {isKo ? "480p 가편집 → 1080p 즉시 승격 루프" : "480p Draft -> 1080p Promotion Loop"}
                  </span>
                  <span style={{ color: "var(--ys-ink)" }}>
                    {isKo
                      ? "1단계: 480p Draft(800원 · 약 30초)로 카메라 동선·표정을 먼저 컨펌한 뒤 → 2단계: 승인된 컷만 동일 모션 그대로 1080p 본편으로 즉시 승격합니다."
                      : "Step 1: Verify camera blocking in 480p Draft (KRW 800, ~30s) -> Step 2: Promote approved take to 1080p master with identical motion."}
                  </span>
                </div>
                <button
                  type="button"
                  className="bw-quick-chip"
                  data-draft-480p-promote-1080p-btn
                  onClick={() => {
                    setUpscaleSourceKind("seedance_480p_draft");
                    setSelectedUpscalerEngineId("sunra_ig_1080p_upscaler");
                    setUpscaleTargetResolution("1080p");
                    setIsUpscaleStudioExpanded(true);
                    handleRunUpscaleStudioJob();
                  }}
                  style={{ fontWeight: 700, color: "var(--ys-brand-text)" }}
                >
                  {isKo
                    ? "승인된 480p 시안 → 동일 모션 1080p 인스타 본편 승격 →"
                    : "Promote Approved 480p Draft -> 1080p IG Master →"}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                  gap: "8px",
                }}
                data-studio-seedance-tier-grid
              >
                {BRAND_SEEDANCE_VIDEO_TIERS.map((tier) => {
                  const selected = selectedSeedanceTierId === tier.id;
                  const tierQuote =
                    quoteBrandVideoRender({
                      model: "seedance-2.5",
                      resolution: tier.resolution,
                      seconds: videoSeconds,
                      aspect,
                    }) ?? activeVideoQuote;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      className="bw-model-card"
                      data-seedance-tier-card={tier.id}
                      data-seedance-resolution={tier.resolution}
                      aria-pressed={selected}
                      onClick={() => handleSelectSeedanceTier(tier.id)}
                      disabled={busy}
                      style={{ padding: "11px 13px" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "6px",
                          width: "100%",
                        }}
                      >
                        <strong style={{ fontSize: "13px" }}>
                          {isKo ? tier.nameKo : tier.nameEn}
                        </strong>
                        <span
                          className="bw-scene-spec"
                          style={{ fontWeight: 700, whiteSpace: "nowrap" }}
                        >
                          {tierQuote.credits.toLocaleString("ko-KR")} cr ·{" "}
                          {isKo
                            ? `${tierQuote.priceKrw.toLocaleString("ko-KR")}원`
                            : `KRW ${tierQuote.priceKrw}`}
                        </span>
                      </div>

                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: selected
                            ? "var(--ys-brand-text)"
                            : "var(--ys-ink-secondary)",
                        }}
                      >
                        {isKo ? tier.badgeKo : tier.badgeEn}
                      </span>

                      <span
                        style={{
                          fontSize: "11.5px",
                          lineHeight: 1.42,
                          color: "var(--ys-ink-secondary)",
                        }}
                      >
                        {isKo ? tier.summaryKo : tier.summaryEn}
                      </span>

                      <span
                        style={{
                          fontSize: "10.5px",
                          color: "var(--ys-ink-muted)",
                          marginTop: "2px",
                        }}
                      >
                        {isKo ? tier.turnaroundKo : tier.turnaroundEn}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Part B: Dedicated Upscaling & Instagram Reels Optimization Studio */}
            {isUpscaleStudioExpanded && (
              <div
                data-studio-upscaling-studio
                data-active-upscaler-engine={selectedUpscalerEngineId}
                data-upscale-target-resolution={upscaleTargetResolution}
                style={{
                  borderRadius: "13px",
                  padding: "13px 15px",
                  background: "var(--ys-subtle-bg)",
                  border: "1px solid var(--ys-border)",
                  display: "grid",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <div>
                    <span
                      className="bw-chip"
                      style={{
                        background: "var(--ys-ink)",
                        color: "#FFFFFF",
                        fontWeight: 700,
                        marginRight: "8px",
                      }}
                    >
                      {isKo ? "전용 업스케일링 스튜디오" : "Upscaling Studio"}
                    </span>
                    <strong
                      style={{ fontSize: "13.5px", color: "var(--ys-ink)" }}
                    >
                      {isKo
                        ? "720p·480p 영상을 Sunra 업스케일러 & 인스타 무열화 로직으로 1080p(릴스 최적화) 또는 4K로 완성합니다"
                        : "Upscale 720p/480p videos to Instagram-optimized 1080p or 4K via Sunra Cloud & SeedVR2"}
                    </strong>
                  </div>

                  {/* Target Resolution Selector: 1080p (IG Master) | 2K | 4K */}
                  <div
                    className="bw-seg-track"
                    data-upscale-target-picker
                  >
                    {(
                      [
                        {
                          res: "1080p",
                          ko: "1080p 인스타 최적화 (추천)",
                          en: "1080p IG Optimized",
                        },
                        {
                          res: "2K",
                          ko: "2K 고화질",
                          en: "2K QHD",
                        },
                        {
                          res: "4K",
                          ko: "4K 초고화질 마스터",
                          en: "4K Ultra HD",
                        },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.res}
                        type="button"
                        className="bw-seg-btn"
                        data-upscale-target-btn={item.res}
                        aria-pressed={upscaleTargetResolution === item.res}
                        onClick={() => {
                          setUpscaleTargetResolution(item.res);
                          if (
                            item.res === "4K" &&
                            selectedUpscalerEngineId ===
                              "sunra_ig_1080p_upscaler"
                          ) {
                            setSelectedUpscalerEngineId(
                              "seedvr2_7b_optical_upscaler",
                            );
                          } else if (
                            item.res === "2K" &&
                            selectedUpscalerEngineId !==
                              "sunra_cloud_4k_upscaler"
                          ) {
                            setSelectedUpscalerEngineId(
                              "sunra_cloud_4k_upscaler",
                            );
                          }
                        }}
                        disabled={busy}
                      >
                        {isKo ? item.ko : item.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Source Video Selection Row (720p Seedance / 480p Draft / Upload MP4) */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    background: "var(--ys-surface)",
                    border: "1px solid var(--ys-border-subtle)",
                  }}
                  data-upscale-source-bar
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: "var(--ys-ink-secondary)",
                      }}
                    >
                      {isKo ? "업스케일할 원본 영상:" : "Source Video:"}
                    </span>
                    <button
                      type="button"
                      className="bw-quick-chip"
                      aria-pressed={
                        upscaleSourceKind === "seedance_720p_latest"
                      }
                      onClick={() => {
                        setUpscaleSourceKind("seedance_720p_latest");
                        setCustomUpscaleVideoName("");
                      }}
                      style={{
                        fontWeight:
                          upscaleSourceKind === "seedance_720p_latest"
                            ? 700
                            : 500,
                      }}
                    >
                      {isKo
                        ? "방금 만든 Seedance 2.5 720p 영상 (추천 프로세스)"
                        : "Latest Seedance 2.5 720p Take"}
                    </button>
                    <button
                      type="button"
                      className="bw-quick-chip"
                      aria-pressed={upscaleSourceKind === "seedance_480p_draft"}
                      onClick={() => {
                        setUpscaleSourceKind("seedance_480p_draft");
                        setCustomUpscaleVideoName("");
                      }}
                      style={{
                        fontWeight:
                          upscaleSourceKind === "seedance_480p_draft"
                            ? 700
                            : 500,
                      }}
                    >
                      {isKo
                        ? "Seedance 2.5 480p Draft 시안 (동일 모션 1080p 승격)"
                        : "Seedance 2.5 480p Draft (Finalize to 1080p)"}
                    </button>
                    <label
                      className="bw-quick-chip"
                      style={{
                        fontWeight: 600,
                        color: "var(--ys-brand-text)",
                      }}
                    >
                      {customUpscaleVideoName
                        ? `업로드됨: ${customUpscaleVideoName}`
                        : isKo
                          ? "+ 내 720p 영상 파일 직접 올리기"
                          : "+ Upload 720p Video File"}
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setCustomUpscaleVideoName(f.name);
                            setUpscaleSourceKind("custom_upload");
                          }
                        }}
                        style={{ display: "none" }}
                        data-upscale-video-file-input
                      />
                    </label>
                  </div>

                  <span
                    style={{
                      fontFamily: "var(--ys-mono)",
                      fontSize: "11px",
                      color: "var(--ys-ink-muted)",
                    }}
                  >
                    {isKo
                      ? `${compiledVideoAndUpscalePlan.upscaleStudio.sourceResolution} → ${upscaleTargetResolution} · 24fps CFR`
                      : `${compiledVideoAndUpscalePlan.upscaleStudio.sourceResolution} -> ${upscaleTargetResolution} · 24fps CFR`}
                  </span>
                </div>

                {/* 3 Upscaler Engine Cards (Sunra 1080p IG Optimized / SeedVR2 7B Optical / Sunra Cloud 4K) */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                    gap: "8px",
                  }}
                  data-upscale-engine-picker
                >
                  {BRAND_UPSCALING_STUDIO_ENGINES.map((engine) => {
                    const selected = selectedUpscalerEngineId === engine.id;
                    return (
                      <button
                        key={engine.id}
                        type="button"
                        className="bw-model-card"
                        data-upscaler-engine-card={engine.id}
                        aria-pressed={selected}
                        onClick={() => handleSelectUpscalerEngine(engine.id)}
                        disabled={busy}
                        style={{ padding: "11px 13px" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "6px",
                            width: "100%",
                          }}
                        >
                          <strong style={{ fontSize: "12.5px" }}>
                            {isKo ? engine.nameKo : engine.nameEn}
                          </strong>
                          <span
                            className="bw-scene-spec"
                            style={{ fontWeight: 700, whiteSpace: "nowrap" }}
                          >
                            {engine.creditsPer10s} cr ·{" "}
                            {isKo
                              ? `${engine.priceKrwPer10s.toLocaleString("ko-KR")}원`
                              : `KRW ${engine.priceKrwPer10s}`}
                          </span>
                        </div>

                        <span
                          style={{
                            fontSize: "10.5px",
                            fontWeight: 700,
                            color: selected
                              ? "var(--ys-brand-text)"
                              : "var(--ys-ink-secondary)",
                          }}
                        >
                          {isKo ? engine.providerBadgeKo : engine.providerBadgeEn}
                        </span>

                        <span
                          style={{
                            fontSize: "11.5px",
                            lineHeight: 1.42,
                            color: "var(--ys-ink-secondary)",
                          }}
                        >
                          {isKo ? engine.shortTraitKo : engine.shortTraitEn}
                        </span>

                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "4px",
                            marginTop: "2px",
                          }}
                        >
                          {(isKo ? engine.strengthsKo : engine.strengthsEn).map(
                            (tag) => (
                              <span
                                key={tag}
                                style={{
                                  fontSize: "10px",
                                  padding: "2px 6px",
                                  borderRadius: "999px",
                                  background: "var(--ys-raised)",
                                  color: "var(--ys-ink-secondary)",
                                  fontWeight: 500,
                                }}
                              >
                                {tag}
                              </span>
                            ),
                          )}
                          {engine.id === "seedvr2_7b_optical_upscaler" && (
                            <span
                              data-seedvr2-antiboil-badge
                              style={{
                                fontSize: "10px",
                                padding: "2px 7px",
                                borderRadius: "999px",
                                background: "var(--ys-brand-tint)",
                                color: "var(--ys-brand-text)",
                                fontWeight: 700,
                              }}
                            >
                              {isKo
                                ? "3프레임 페이스 안티-보일(Anti-Boil) 피부 보호 · +170% 광학 복원 · 4K 전광판 규격"
                                : "3-Frame Face Anti-Boil Mask · +170% Optical Detail · 4K Display Ready"}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* INTERACTIVE BEFORE / AFTER INSTAGRAM QUALITY DEFENSE INSPECTOR (Round 3 Upgrade) */}
                <div
                  data-upscale-before-after-inspector
                  data-upscale-compare-mode={upscaleCompareMode}
                  style={{
                    padding: "12px",
                    borderRadius: "11px",
                    background: "var(--ys-surface)",
                    border: "1px solid var(--ys-border)",
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "12.5px", color: "var(--ys-ink)" }}>
                        {isKo
                          ? "왜 720p AI 영상을 인스타에 그냥 올리면 깨질까요? — 전·후 화질 방어 비교 인스펙터"
                          : "Why Raw 720p AI Videos Break on Instagram — Before & After Quality Defense Inspector"}
                      </strong>
                      <span
                        className="bw-muted"
                        style={{ marginLeft: "8px", fontSize: "11.5px" }}
                      >
                        {isKo
                          ? "인스타그램 서버의 3.5Mbps 강제 재압축(4:2:0 크로마 열화)을 원천 우회하는 TWINGS 1080p 마스터링 비교"
                          : "Compare raw 720p IG re-compression blur vs. TWINGS 1080p 14Mbps + CAS 0.25 + ISO 3200 grain defense"}
                      </span>
                    </div>
                    <div className="bw-seg-track">
                      {(
                        [
                          { id: "split", ko: "전·후 동시 비교", en: "Side-by-Side" },
                          { id: "before_raw_720p", ko: "일반 720p 업로드 시", en: "Raw 720p on IG" },
                          { id: "after_twings_1080p", ko: "TWINGS 1080p 무열화 마스터", en: "TWINGS 1080p Master" },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className="bw-seg-btn"
                          aria-pressed={upscaleCompareMode === tab.id}
                          onClick={() => setUpscaleCompareMode(tab.id)}
                        >
                          {isKo ? tab.ko : tab.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        upscaleCompareMode === "split"
                          ? "repeat(auto-fit, minmax(260px, 1fr))"
                          : "1fr",
                      gap: "10px",
                    }}
                  >
                    {upscaleCompareMode !== "after_twings_1080p" && (
                      <div
                        data-upscale-compare-before
                        style={{
                          padding: "10px 12px",
                          borderRadius: "10px",
                          background: "var(--ys-subtle-bg)",
                          border: "1px solid var(--ys-border)",
                          display: "grid",
                          gap: "6px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                          <span
                            className="bw-chip"
                            style={{
                              background: "rgba(17, 17, 20, 0.08)",
                              color: "var(--ys-ink-secondary)",
                              fontWeight: 700,
                              fontSize: "10.5px",
                            }}
                          >
                            {isKo
                              ? "BEFORE · 720p 원본을 인스타에 그냥 올렸을 때"
                              : "BEFORE · Raw 720p Uploaded Directly to IG"}
                          </span>
                          <span style={{ fontSize: "10.5px", fontFamily: "var(--ys-mono)", color: "var(--ys-ink-muted)" }}>
                            720×1280 · ~3.5Mbps 강제 재압축
                          </span>
                        </div>
                        <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "11.5px", lineHeight: 1.5, color: "var(--ys-ink-secondary)" }}>
                          <li>
                            {isKo
                              ? "플라스틱 피부 뭉개짐: 인스타 모바일 트랜스코더가 미세 모공·솜털을 노이즈로 오인해 밀랍처럼 뭉갬"
                              : "Plastic skin smoothing: IG mobile transcoder wipes pores and fine hair into waxy blur"}
                          </li>
                          <li>
                            {isKo
                              ? "어두운 배경 8-bit 계단 노이즈(컬러 밴딩): 스튜디오 그림자·그라데이션 영역에 얼룩덜룩한 블록 발생"
                              : "8-bit shadow macro-blocking & color banding across studio gradients"}
                          </li>
                          <li>
                            {isKo
                              ? "제품 라벨·로고 가독성 붕괴: 화장품 용기·패션 케어라벨의 작은 타이포그래피가 번져 읽히지 않음"
                              : "Smudged product labels and illegible micro-typography"}
                          </li>
                        </ul>
                      </div>
                    )}

                    {upscaleCompareMode !== "before_raw_720p" && (
                      <div
                        data-upscale-compare-after
                        style={{
                          padding: "10px 12px",
                          borderRadius: "10px",
                          background: "var(--ys-brand-tint)",
                          border: "1.5px solid var(--ys-brand)",
                          display: "grid",
                          gap: "6px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                          <span
                            className="bw-chip"
                            style={{
                              background: "#3875C5",
                              color: "#FFFFFF",
                              fontWeight: 700,
                              fontSize: "10.5px",
                            }}
                          >
                            {isKo
                              ? "AFTER · TWINGS Sunra 1080p 인스타 무열화 마스터"
                              : "AFTER · TWINGS Sunra 1080p IG De-AI Master"}
                          </span>
                          <span style={{ fontSize: "10.5px", fontFamily: "var(--ys-mono)", color: "var(--ys-brand-text)", fontWeight: 700 }}>
                            1080×1920 · 14Mbps VBR · CAS 0.25
                          </span>
                        </div>
                        <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "11.5px", lineHeight: 1.5, color: "var(--ys-ink)" }}>
                          <li>
                            {isKo
                              ? "속눈썹·원단 직조감·금속 반사광 +170% 복원: Lanczos 스케일링 + CAS 0.25 마이크로 엣지 샤프닝"
                              : "+170% eyelash, fabric weave & metal specular restoration via Lanczos + CAS 0.25"}
                          </li>
                          <li>
                            {isKo
                              ? "컬러 밴딩 제로 & OLED 딥블랙 고정: ISO 3200 루마 센서 그레인 프리베이크로 인스타 비트레이트 강제 보존"
                              : "Zero color banding & OLED deep black lock via ISO 3200 luma sensor grain pre-bake"}
                          </li>
                          <li>
                            {isKo
                              ? "Rec.709 피부톤 고정 + -14 LUFS 음량 마스터링: 릴스·틱톡·쇼츠 업로드 후에도 스튜디오 원본 화질 그대로 유지"
                              : "Rec.709 skin-tone lock + -14 LUFS loudness mastering for zero post-upload degradation"}
                          </li>
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Our Signature Instagram Optimization Logic Modules (5 Toggle Switches + Why It Works) */}
                <div
                  data-upscale-ig-logic-bar
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    background: "var(--ys-surface)",
                    border: "1px solid var(--ys-border-subtle)",
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "6px",
                    }}
                  >
                    <div>
                      <strong
                        style={{ fontSize: "12.5px", color: "var(--ys-ink)" }}
                      >
                        {isKo
                          ? "인스타 최적화 업스케일링 로직 (Sunra 1080p 업스케일 + 5단계 화질 보호)"
                          : "Instagram Reels De-AI Optimization Logic (Sunra 1080p + 5-Stage Guard)"}
                      </strong>
                      <span
                        className="bw-muted"
                        style={{ marginLeft: "8px", fontSize: "11.5px" }}
                      >
                        {isKo
                          ? activeUpscalerEngine.whyThisUpscalerKo
                          : activeUpscalerEngine.whyThisUpscalerEn}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    {IG_OPTIMIZED_UPSCALE_LOGIC_MODULES.map((mod) => {
                      const active = enabledIgModules.includes(mod.id);
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          className="bw-quick-chip"
                          data-ig-upscale-module={mod.id}
                          aria-pressed={active}
                          onClick={() => handleToggleIgLogicModule(mod.id)}
                          title={isKo ? mod.detailKo : mod.detailEn}
                          style={{
                            fontSize: "11px",
                            fontWeight: active ? 700 : 500,
                            background: active
                              ? "var(--ys-brand-tint)"
                              : "var(--ys-subtle-bg)",
                            color: active
                              ? "var(--ys-brand-text)"
                              : "var(--ys-ink-secondary)",
                            boxShadow: active
                              ? "0 0 0 1px var(--ys-brand)"
                              : undefined,
                          }}
                        >
                          {active ? "✓ " : ""}
                          {isKo ? mod.titleKo : mod.titleEn}
                        </button>
                      );
                    })}
                  </div>

                  {/* IG Bitrate Compression Loss vs TWINGS 1080p Retention Bar (Round 10 Upgrade) */}
                  <div
                    data-ig-bitrate-compression-simulator
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: "8px",
                      padding: "8px 10px",
                      borderRadius: "9px",
                      background: "var(--ys-subtle-bg)",
                      border: "1px solid var(--ys-border-subtle)",
                      fontSize: "11px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ color: "var(--ys-ink-secondary)" }}>
                        {isKo ? "일반 720p 인스타 업로드 시:" : "Raw 720p IG Upload:"}
                      </span>
                      <strong style={{ color: "var(--ys-ink)", fontFamily: "var(--ys-mono)" }}>
                        {isKo ? "-62% 디테일 손실 (3.5Mbps 강제 재압축)" : "-62% Detail Loss (3.5Mbps Re-encode)"}
                      </strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ color: "var(--ys-brand-text)", fontWeight: 700 }}>
                        {isKo ? "TWINGS 1080p 마스터링 적용 시:" : "TWINGS 1080p IG Master:"}
                      </span>
                      <strong style={{ color: "var(--ys-brand-text)", fontFamily: "var(--ys-mono)" }}>
                        {isKo ? "99.4% 원본 디테일 보존 (14Mbps + CAS 0.25)" : "99.4% Detail Retained (14Mbps + CAS 0.25)"}
                      </strong>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      paddingTop: "6px",
                      borderTop: "1px solid var(--ys-hairline)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--ys-ink-secondary)",
                        fontWeight: 600,
                      }}
                    >
                      {isKo
                        ? compiledVideoAndUpscalePlan.upscaleStudio
                            .igEditsExportRuleKo
                        : compiledVideoAndUpscalePlan.upscaleStudio
                            .igEditsExportRuleEn}
                    </span>

                    <button
                      type="button"
                      className="bw-button bw-primary"
                      data-upscale-execute-btn
                      onClick={handleRunUpscaleStudioJob}
                      disabled={!canWrite || busy}
                      style={{
                        padding: "6px 14px",
                        fontSize: "12px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isKo
                        ? `${activeUpscalerEngine.nameKo.split("+")[0]?.trim()} (${upscaleTargetResolution}) 실행하기 · ${activeUpscalerEngine.creditsPer10s} cr`
                        : `Run ${upscaleTargetResolution} Upscale (${activeUpscalerEngine.creditsPer10s} cr)`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* TRACK 03 · 04 · 05 Specialized Workbenches: Creator Campaign Format (Self/Commission), Creator Distribution, and Audio Studio */}
          <div
            data-studio-5track-workbench
            style={{
              display:
                studioSurfaceMode === "track_image" ||
                studioSurfaceMode === "track_video_upscale"
                  ? "none"
                  : "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "12px",
            }}
          >
            {/* Track 03: Creator Campaign Format (Self-Serve vs Studio Commission) */}
            <div
              data-studio-creator-format-panel
              data-creator-format-mode={creatorFormatMode}
              style={{
                gridColumn:
                  activeCoreTrack === "creator_format" ||
                  studioSurfaceMode === "track_creator_format"
                    ? "1 / -1"
                    : undefined,
                padding: "14px 16px",
                borderRadius: "13px",
                background:
                  activeCoreTrack === "creator_format"
                    ? "var(--ys-brand-tint)"
                    : "var(--ys-surface)",
                border:
                  activeCoreTrack === "creator_format"
                    ? "1.5px solid var(--ys-brand)"
                    : "1px solid var(--ys-border)",
                display:
                  studioSurfaceMode === "track_creator_distribution" ||
                  studioSurfaceMode === "track_audio"
                    ? "none"
                    : "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                }}
              >
                <div>
                  <span
                    className="bw-chip"
                    style={{
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                      fontWeight: 700,
                      marginRight: "6px",
                    }}
                  >
                    {isKo ? "TRACK 03 · 캠페인 포맷" : "TRACK 03 · Campaign Format"}
                  </span>
                  <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "크리에이터 캠페인용 영상 (셀프 포맷 빌더 · 3일 완성 전담 의뢰)"
                      : "Creator Campaign Format (Self-Build · D+3 Commission)"}
                  </strong>
                </div>
                <div className="bw-seg-track">
                  {BRAND_CREATOR_FORMAT_MODES.map((fm) => (
                    <button
                      key={fm.id}
                      type="button"
                      className="bw-seg-btn"
                      data-creator-format-mode-btn={fm.id}
                      aria-pressed={creatorFormatMode === fm.id}
                      onClick={() => {
                        setCreatorFormatMode(fm.id);
                        setActiveCoreTrack("creator_format");
                      }}
                    >
                      {fm.id === "self_build"
                        ? isKo
                          ? "직접 만들기 (1,800원)"
                          : "Self-Build"
                        : isKo
                          ? "3일 완성 의뢰 (D+3)"
                          : "D+3 Commission"}
                    </button>
                  ))}
                </div>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "11.5px",
                  lineHeight: 1.45,
                  color: "var(--ys-ink-secondary)",
                }}
              >
                {isKo
                  ? activeCreatorFormatSpec.summaryKo
                  : activeCreatorFormatSpec.summaryEn}
              </p>

              {/* 3-Step Interactive Format Recipe Builder (Round 11 Upgrade) */}
              <div
                data-creator-format-recipe-steps
                data-active-recipe-step={creatorRecipeStep}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
                  gap: "6px",
                }}
              >
                {(
                  [
                    {
                      step: 1 as const,
                      ko: "Step 1 · 브랜드 불변 에셋 잠금",
                      en: "Step 1 · Lock Brand Assets",
                      descKo: "제품 실루엣 · 로고 · 4번 색감 핀 고정",
                      descEn: "Lock product fit, logo & color pin",
                    },
                    {
                      step: 2 as const,
                      ko: "Step 2 · 크리에이터 셀카 슬롯 설정",
                      en: "Step 2 · Creator Selfie Slot",
                      descKo: "정면 셀카 1장 자동 검수 & 조명 매칭",
                      descEn: "1-selfie verification & light match",
                    },
                    {
                      step: 3 as const,
                      ko: "Step 3 · 1,800원 즉시 발행 / D+3 의뢰",
                      en: "Step 3 · KRW 1,800 Publish / D+3",
                      descKo: "테스트 렌더 후 캠페인 링크 즉시 발급",
                      descEn: "Test render & issue campaign link",
                    },
                  ] as const
                ).map((rStep) => {
                  const active = creatorRecipeStep === rStep.step;
                  return (
                    <button
                      key={rStep.step}
                      type="button"
                      data-creator-recipe-step={String(rStep.step)}
                      data-recipe-step-btn={rStep.step}
                      aria-pressed={active}
                      onClick={() => setCreatorRecipeStep(rStep.step)}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: "9px",
                        border: active
                          ? "1.5px solid #3875C5"
                          : "1px solid var(--ys-border)",
                        background: active
                          ? "rgba(56, 117, 197, 0.08)"
                          : "#FFFFFF",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <strong style={{ fontSize: "11.5px", color: active ? "#3063A7" : "var(--ys-ink)" }}>
                        {isKo ? rStep.ko : rStep.en}
                      </strong>
                      <span style={{ fontSize: "10.5px", color: "var(--ys-ink-secondary)" }}>
                        {isKo ? rStep.descKo : rStep.descEn}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Interactive Creator Selfie-to-Brand Format Simulator (Round 4 Upgrade) */}
              <div
                data-creator-selfie-simulation
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "var(--ys-subtle-bg)",
                  border: "1px solid var(--ys-border)",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                  }}
                >
                  <strong style={{ fontSize: "11.5px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "크리에이터 정면 셀카 1장 → 브랜드 고정 포맷 합성 시뮬레이터"
                      : "Creator 1-Selfie -> Brand Locked Format Simulator"}
                  </strong>
                  <div style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap" }}>
                    {(
                      [
                        { idx: 0 as const, ko: "크리에이터 A (뷰티 1.8만)", en: "Creator A (18K)" },
                        { idx: 1 as const, ko: "크리에이터 B (패션 4.2만)", en: "Creator B (42K)" },
                        { idx: 2 as const, ko: "크리에이터 C (라이프 6.5만)", en: "Creator C (65K)" },
                      ] as const
                    ).map((cr) => (
                      <button
                        key={cr.idx}
                        type="button"
                        className="bw-quick-chip"
                        data-creator-sample-btn={cr.idx}
                        aria-pressed={selectedCreatorSampleIdx === cr.idx}
                        onClick={() => setSelectedCreatorSampleIdx(cr.idx)}
                        style={{
                          fontSize: "10.5px",
                          padding: "2px 8px",
                          fontWeight: selectedCreatorSampleIdx === cr.idx ? 700 : 500,
                          background:
                            selectedCreatorSampleIdx === cr.idx
                              ? "#3875C5"
                              : "#FFFFFF",
                          color:
                            selectedCreatorSampleIdx === cr.idx
                              ? "#FFFFFF"
                              : "var(--ys-ink)",
                        }}
                      >
                        {isKo ? cr.ko : cr.en}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                    gap: "6px",
                    fontSize: "11px",
                  }}
                >
                  <div
                    style={{
                      padding: "7px 9px",
                      borderRadius: "8px",
                      background: "#FFFFFF",
                      border: "1px solid var(--ys-border-subtle)",
                    }}
                  >
                    <strong style={{ display: "block", color: "var(--ys-brand-text)", fontSize: "10.5px" }}>
                      {isKo ? "1. 브랜드 불변 잠금 슬롯" : "1. Brand Locked Layer"}
                    </strong>
                    <span style={{ color: "var(--ys-ink-secondary)" }}>
                      {isKo
                        ? "제품 실루엣 · 로고 철자 · 배경 세트 · 4번 색감 핀 100% 고정"
                        : "Product fit, logo spelling, set & Slot 4 color pin 100% locked"}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "7px 9px",
                      borderRadius: "8px",
                      background: "#FFFFFF",
                      border: "1px solid var(--ys-border-subtle)",
                    }}
                  >
                    <strong style={{ display: "block", color: "var(--ys-ink)", fontSize: "10.5px" }}>
                      {isKo
                        ? `2. 가변 슬롯 (크리에이터 ${["A", "B", "C"][selectedCreatorSampleIdx]} 셀카 1장)`
                        : "2. Variable Creator Selfie Slot"}
                    </strong>
                    <span style={{ color: "var(--ys-ink-secondary)" }}>
                      {isKo
                        ? "본인 얼굴 동의 + 자동 검수 통과 셀카 1장만 삽입"
                        : "Single verified front selfie with consent"}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "7px 9px",
                      borderRadius: "8px",
                      background: "var(--ys-brand-tint)",
                      border: "1px solid rgba(56, 117, 197, 0.35)",
                    }}
                  >
                    <strong style={{ display: "block", color: "var(--ys-brand-text)", fontSize: "10.5px" }}>
                      {isKo ? "3. 균일 품질 1080p 결과물" : "3. Uniform 1080p Output"}
                    </strong>
                    <span style={{ color: "var(--ys-ink)" }}>
                      {isKo
                        ? "목선·조명 경계 이질감 0% · 수십 명이 찍어도 동일한 브랜드 감도 유지"
                        : "Zero neck/lighting seam; identical brand aesthetic across 50+ creators"}
                    </span>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  fontSize: "11px",
                  color: "var(--ys-ink)",
                }}
              >
                {(isKo
                  ? activeCreatorFormatSpec.lockedElementsKo
                  : activeCreatorFormatSpec.lockedElementsEn
                ).map((item) => (
                  <span key={item}>• {item}</span>
                ))}
              </div>
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "6px",
                  borderTop: "1px solid var(--ys-hairline)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  fontSize: "11px",
                }}
              >
                <span style={{ color: "var(--ys-ink-muted)" }}>
                  {isKo
                    ? activeCreatorFormatSpec.turnaroundKo
                    : activeCreatorFormatSpec.turnaroundEn}
                </span>
                <button
                  type="button"
                  className="bw-quick-chip"
                  data-creator-format-action-btn
                  onClick={() => {
                    setActiveCoreTrack("creator_format");
                    setStatusMessage(
                      isKo
                        ? `${activeCreatorFormatSpec.titleKo} 모드가 활성화되었습니다.`
                        : `${activeCreatorFormatSpec.titleEn} activated.`,
                    );
                  }}
                  style={{ fontWeight: 700, color: "var(--ys-brand-text)" }}
                >
                  {isKo
                    ? activeCreatorFormatSpec.ctaLabelKo
                    : activeCreatorFormatSpec.ctaLabelEn}
                </button>
              </div>
            </div>

            {/* Track 04: Creator Campaign Video + End-to-End Distribution */}
            <div
              data-studio-creator-distribution-panel
              data-distribution-tier={distributionTierId}
              style={{
                gridColumn:
                  activeCoreTrack === "creator_distribution" ||
                  studioSurfaceMode === "track_creator_distribution"
                    ? "1 / -1"
                    : undefined,
                padding: "14px 16px",
                borderRadius: "13px",
                background:
                  activeCoreTrack === "creator_distribution"
                    ? "var(--ys-brand-tint)"
                    : "var(--ys-surface)",
                border:
                  activeCoreTrack === "creator_distribution"
                    ? "1.5px solid var(--ys-brand)"
                    : "1px solid var(--ys-border)",
                display:
                  studioSurfaceMode === "track_creator_format" ||
                  studioSurfaceMode === "track_audio"
                    ? "none"
                    : "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                }}
              >
                <div>
                  <span
                    className="bw-chip"
                    style={{
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                      fontWeight: 700,
                      marginRight: "6px",
                    }}
                  >
                    {isKo ? "TRACK 04 · 캠페인 + 유통" : "TRACK 04 · Campaign + Seeding"}
                  </span>
                  <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "크리에이터 캠페인 영상 + 릴스·틱톡·쇼츠 유통 패키지"
                      : "Creator Campaign + Reels/TikTok/Shorts Seeding"}
                  </strong>
                </div>
                <div className="bw-seg-track">
                  {BRAND_CREATOR_DISTRIBUTION_TIERS.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      className="bw-seg-btn"
                      data-distribution-tier-btn={tier.id}
                      aria-pressed={distributionTierId === tier.id}
                      onClick={() => {
                        setDistributionTierId(tier.id);
                        setActiveCoreTrack("creator_distribution");
                      }}
                    >
                      {tier.id === "seed_10"
                        ? isKo
                          ? "10명 초기 검증"
                          : "10 Seed"
                        : tier.id === "growth_30"
                          ? isKo
                            ? "30명 표준 런칭"
                            : "30 Growth"
                          : isKo
                            ? "50명+ 대규모 확산"
                            : "50+ Mega"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Platform Seeding Channel Filter + 2nd-Use Ad Rights Code Preview (Round 12 Upgrade) */}
              <div
                data-distribution-platform-filter={distributionPlatformFilter}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "7px 10px",
                  borderRadius: "9px",
                  background: "#FFFFFF",
                  border: "1px solid var(--ys-border-subtle)",
                }}
              >
                <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--ys-ink-secondary)", marginRight: "4px" }}>
                    {isKo ? "배포 채널 필터:" : "Seeding Channels:"}
                  </span>
                  {(
                    [
                      { id: "all", ko: "3대 채널 동시 배포", en: "All 3 Channels" },
                      { id: "instagram_reels", ko: "인스타 릴스", en: "Instagram Reels" },
                      { id: "tiktok", ko: "틱톡 (TikTok)", en: "TikTok" },
                      { id: "youtube_shorts", ko: "유튜브 쇼츠", en: "YouTube Shorts" },
                    ] as const
                  ).map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      className="bw-quick-chip"
                      data-distribution-platform-btn={ch.id}
                      data-seeding-channel-btn={ch.id}
                      aria-pressed={distributionPlatformFilter === ch.id}
                      onClick={() => setDistributionPlatformFilter(ch.id)}
                      style={{
                        fontSize: "10.5px",
                        padding: "2px 8px",
                        fontWeight: distributionPlatformFilter === ch.id ? 700 : 500,
                        background:
                          distributionPlatformFilter === ch.id
                            ? "#3875C5"
                            : "var(--ys-subtle-bg)",
                        color:
                          distributionPlatformFilter === ch.id
                            ? "#FFFFFF"
                            : "var(--ys-ink)",
                      }}
                    >
                      {isKo ? ch.ko : ch.en}
                    </button>
                  ))}
                </div>

                <span
                  data-distribution-ad-rights-preview
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    color: "#3063A7",
                    fontFamily: "var(--ys-mono)",
                  }}
                >
                  {isKo
                    ? "Spark Ads · Meta 파트너십 광고 코드 자동 발급 포함"
                    : "Spark Ads & Meta Partnership Ad Codes Included"}
                </span>
              </div>

              {/* Interactive B2B ROI & Unit Economics Calculator (Round 4 Upgrade) */}
              <div
                data-distribution-roi-calculator
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "var(--ys-subtle-bg)",
                  border: "1px solid var(--ys-border)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    padding: "7px 9px",
                    borderRadius: "8px",
                    background: "#FFFFFF",
                    border: "1px solid var(--ys-border-subtle)",
                  }}
                >
                  <span style={{ display: "block", fontSize: "10px", color: "var(--ys-ink-muted)", fontWeight: 700 }}>
                    {isKo ? "예상 오가닉 조회수" : "Projected Organic Views"}
                  </span>
                  <strong style={{ fontSize: "13px", color: "var(--ys-brand-text)" }}>
                    {isKo
                      ? activeDistributionTier.estimatedViewsKo
                      : activeDistributionTier.estimatedViewsEn}
                  </strong>
                </div>
                <div
                  style={{
                    padding: "7px 9px",
                    borderRadius: "8px",
                    background: "#FFFFFF",
                    border: "1px solid var(--ys-border-subtle)",
                  }}
                >
                  <span style={{ display: "block", fontSize: "10px", color: "var(--ys-ink-muted)", fontWeight: 700 }}>
                    {isKo ? "예상 오가닉 CPV (조회당 비용)" : "Estimated Organic CPV"}
                  </span>
                  <strong style={{ fontSize: "12.5px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "약 4.5원/회 (일반 배너 광고 대비 87% 절감)"
                      : "~KRW 4.5/view (87% lower vs banner ads)"}
                  </strong>
                </div>
                <div
                  style={{
                    padding: "7px 9px",
                    borderRadius: "8px",
                    background: "var(--ys-brand-tint)",
                    border: "1px solid rgba(56, 117, 197, 0.35)",
                  }}
                >
                  <span style={{ display: "block", fontSize: "10px", color: "var(--ys-brand-text)", fontWeight: 700 }}>
                    {isKo ? "2차 유료 광고 활용권 (Spark/Meta Ads)" : "2nd-Use Paid Ad Rights"}
                  </span>
                  <strong style={{ fontSize: "12px", color: "var(--ys-ink)" }}>
                    {distributionTierId === "seed_10"
                      ? isKo
                        ? "상위 성과 3편 1080p 클린본 + 초상권 기본 포함"
                        : "Top 3 1080p clean masters + ad rights included"
                      : distributionTierId === "growth_30"
                        ? isKo
                          ? "상위 성과 5편 1080p 클린본 + 초상권 기본 포함"
                          : "Top 5 1080p clean masters + ad rights included"
                        : isKo
                          ? "상위 성과 10편 1080p 클린본 + 초상권 기본 포함"
                          : "Top 10 1080p clean masters + ad rights included"}
                  </strong>
                </div>
              </div>

              {/* D+3 -> D+7 -> D+14 -> D+21 Standard Seeding Timeline Gantt */}
              <div
                data-distribution-timeline-gantt
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "6px",
                  fontSize: "10.5px",
                }}
              >
                {(
                  [
                    { day: "D+3", ko: "전용 캠페인 포맷 확정", en: "Format Locked" },
                    { day: "D+7", ko: "3,000+ 팔로워 크리에이터 승인", en: "Creator Cohort Approved" },
                    { day: "D+14", ko: "릴스·틱톡·쇼츠 동시 게시", en: "Simultaneous Multi-Post" },
                    { day: "D+21", ko: "성과 리포트 & 2차 광고 집행", en: "ROI Report & Paid Boost" },
                  ] as const
                ).map((step) => (
                  <div
                    key={step.day}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "8px",
                      background: "var(--ys-subtle-bg)",
                      border: "1px solid var(--ys-border-subtle)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: "#3875C5",
                        color: "#FFFFFF",
                        fontWeight: 700,
                        fontSize: "10px",
                      }}
                    >
                      {step.day}
                    </span>
                    <span style={{ fontWeight: 600, color: "var(--ys-ink)" }}>
                      {isKo ? step.ko : step.en}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  fontSize: "11px",
                  color: "var(--ys-ink)",
                }}
              >
                {(isKo
                  ? activeDistributionTier.includesKo
                  : activeDistributionTier.includesEn
                ).map((inc) => (
                  <span key={inc}>• {inc}</span>
                ))}
              </div>
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "6px",
                  borderTop: "1px solid var(--ys-hairline)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  fontSize: "11px",
                }}
              >
                <span style={{ color: "var(--ys-ink-muted)" }}>
                  {isKo
                    ? activeDistributionTier.timelineSummaryKo
                    : activeDistributionTier.timelineSummaryEn}
                </span>
                <a
                  href={`/brand/campaigns?organizationId=${encodeURIComponent(organizationId)}`}
                  className="bw-quick-chip"
                  data-distribution-launch-link
                  style={{
                    fontWeight: 700,
                    color: "var(--ys-brand-text)",
                    textDecoration: "none",
                  }}
                >
                  {isKo ? "유통 캠페인 시작 →" : "Launch Seeding →"}
                </a>
              </div>
            </div>

            {/* Track 05: Audio Studio (Signature BGM · Tactile Foley · Act 1 -3 dB Ducking · -14 LUFS Master) */}
            <div
              data-studio-audio-panel
              data-active-audio-preset={audioPresetId}
              style={{
                gridColumn:
                  activeCoreTrack === "audio" ||
                  studioSurfaceMode === "track_audio"
                    ? "1 / -1"
                    : undefined,
                padding: "14px 16px",
                borderRadius: "13px",
                background:
                  activeCoreTrack === "audio"
                    ? "var(--ys-brand-tint)"
                    : "var(--ys-surface)",
                border:
                  activeCoreTrack === "audio"
                    ? "1.5px solid var(--ys-brand)"
                    : "1px solid var(--ys-border)",
                display:
                  studioSurfaceMode === "track_creator_format" ||
                  studioSurfaceMode === "track_creator_distribution"
                    ? "none"
                    : "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                }}
              >
                <div>
                  <span
                    className="bw-chip"
                    style={{
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                      fontWeight: 700,
                      marginRight: "6px",
                    }}
                  >
                    {isKo ? "TRACK 05 · 사운드 & 폴리" : "TRACK 05 · Sound & Foley"}
                  </span>
                  <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
                    {isKo
                      ? "오디오 스튜디오 (3트랙 BGM · 프레임 동기화 폴리 효과음 · -14 LUFS 마스터)"
                      : "Audio Studio (3-Track BGM · Frame-Synced Foley · -14 LUFS Master)"}
                  </strong>
                </div>
                <span className="bw-scene-spec" style={{ fontWeight: 600 }}>
                  {activeAudioPreset.creditsPerTrack} cr ·{" "}
                  {isKo
                    ? `${activeAudioPreset.priceKrwPerTrack}원`
                    : `KRW ${activeAudioPreset.priceKrwPerTrack}`}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "5px",
                }}
              >
                {BRAND_AUDIO_STUDIO_PRESETS.map((preset) => {
                  const selected = audioPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="bw-quick-chip"
                      data-audio-preset-btn={preset.id}
                      aria-pressed={selected}
                      onClick={() => {
                        setAudioPresetId(preset.id);
                        setActiveCoreTrack("audio");
                      }}
                      style={{
                        fontSize: "11px",
                        fontWeight: selected ? 700 : 500,
                        background: selected
                          ? "var(--ys-brand-tint)"
                          : "var(--ys-subtle-bg)",
                        color: selected
                          ? "var(--ys-brand-text)"
                          : "var(--ys-ink)",
                      }}
                    >
                      {isKo ? preset.titleKo.split("&")[0]?.trim() : preset.titleEn.split("&")[0]?.trim()}
                    </button>
                  );
                })}
              </div>

              {/* 3-Track Visual Waveform Console & Broadcast Loudness Compliance Meter (Round 4 & Round 13 Upgrade) */}
              <div
                data-audio-multitrack-console
                data-audio-stem-controls
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "var(--ys-subtle-bg)",
                  border: "1px solid var(--ys-border)",
                  display: "grid",
                  gap: "6px",
                  fontSize: "11px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    padding: "6px 8px",
                    borderRadius: "7px",
                    background: "#FFFFFF",
                    border: "1px solid var(--ys-border-subtle)",
                    opacity: audioStemMuted.bgm ? 0.55 : 1,
                  }}
                >
                  <strong style={{ color: "var(--ys-ink)" }}>
                    {isKo ? "Track 01 · 브랜드 시그니처 BGM" : "Track 01 · Brand Signature BGM"}
                  </strong>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontFamily: "var(--ys-mono)", color: "var(--ys-brand-text)", fontWeight: 700 }}>
                      {isKo ? "볼륨 85% · 컷 전환 0ms 비트 싱크" : "Vol 85% · 0ms Beat Sync"}
                    </span>
                    <button
                      type="button"
                      data-audio-mute-bgm
                      data-audio-stem-mute-btn="bgm"
                      aria-pressed={audioStemMuted.bgm}
                      onClick={() =>
                        setAudioStemMuted((p) => ({ ...p, bgm: !p.bgm }))
                      }
                      style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        border: "1px solid #E4E6EC",
                        background: audioStemMuted.bgm ? "#3875C5" : "#F8F9FB",
                        color: audioStemMuted.bgm ? "#FFFFFF" : "#383B44",
                        fontSize: "10px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {audioStemMuted.bgm ? "MUTE ON" : "MUTE"}
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    padding: "6px 8px",
                    borderRadius: "7px",
                    background: "#FFFFFF",
                    border: "1px solid var(--ys-border-subtle)",
                    opacity: audioStemMuted.foley ? 0.55 : 1,
                  }}
                >
                  <strong style={{ color: "var(--ys-ink)" }}>
                    {isKo ? "Track 02 · 프레임 동기화 폴리 효과음" : "Track 02 · Frame-Synced Tactile Foley"}
                  </strong>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ color: "var(--ys-ink-secondary)" }}>
                      {(isKo
                        ? activeAudioPreset.foleyLayersKo
                        : activeAudioPreset.foleyLayersEn
                      ).join(" · ")}
                    </span>
                    <button
                      type="button"
                      data-audio-mute-foley
                      data-audio-stem-mute-btn="foley"
                      aria-pressed={audioStemMuted.foley}
                      onClick={() =>
                        setAudioStemMuted((p) => ({ ...p, foley: !p.foley }))
                      }
                      style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        border: "1px solid #E4E6EC",
                        background: audioStemMuted.foley ? "#3875C5" : "#F8F9FB",
                        color: audioStemMuted.foley ? "#FFFFFF" : "#383B44",
                        fontSize: "10px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {audioStemMuted.foley ? "MUTE ON" : "MUTE"}
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    padding: "6px 8px",
                    borderRadius: "7px",
                    background: "#FFFFFF",
                    border: "1px solid var(--ys-border-subtle)",
                    opacity: audioStemMuted.voice ? 0.55 : 1,
                  }}
                >
                  <strong style={{ color: "var(--ys-ink)" }}>
                    {isKo ? "Track 03 · 내레이션 & 자동 더킹 (Auto-Ducking)" : "Track 03 · Voiceover & -3dB Auto-Ducking"}
                  </strong>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ color: "var(--ys-brand-text)", fontWeight: 700 }}>
                      {audioAutoDucking
                        ? isKo
                          ? "발화 구간 배경음 -3dB 자동 감쇄 활성"
                          : "Act 1 -3 dB Auto-Ducking ON"
                        : isKo
                          ? "수동 볼륨 고정"
                          : "Manual Gain"}
                    </span>
                    <button
                      type="button"
                      data-audio-mute-voice
                      data-audio-stem-mute-btn="voice"
                      aria-pressed={audioStemMuted.voice}
                      onClick={() =>
                        setAudioStemMuted((p) => ({ ...p, voice: !p.voice }))
                      }
                      style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        border: "1px solid #E4E6EC",
                        background: audioStemMuted.voice ? "#3875C5" : "#F8F9FB",
                        color: audioStemMuted.voice ? "#FFFFFF" : "#383B44",
                        fontSize: "10px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {audioStemMuted.voice ? "MUTE ON" : "MUTE"}
                    </button>
                  </div>
                </div>

                {/* Frame-Synced Foley Cue Point Timeline (Round 13 Upgrade) */}
                <div
                  data-audio-foley-cue-timeline={activeFoleyCueSec}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                    padding: "6px 8px",
                    borderRadius: "7px",
                    background: "#FFFFFF",
                    border: "1px solid var(--ys-border-subtle)",
                  }}
                >
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ys-ink-secondary)" }}>
                    {isKo ? "폴리 타임코드 큐 포인트:" : "Foley Cue Points:"}
                  </span>
                  <div style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px" }}>
                    {(
                      [
                        { sec: "0.4s", ko: "0.4s · 원단/옷깃 스침", en: "0.4s · Fabric Rustle" },
                        { sec: "1.8s", ko: "1.8s · 오브제/제품 터치", en: "1.8s · Product Touch" },
                        { sec: "3.2s", ko: "3.2s · 스튜디오 착지/여운", en: "3.2s · Studio Step" },
                      ] as const
                    ).map((cue) => (
                      <button
                        key={cue.sec}
                        type="button"
                        data-foley-cue-btn={cue.sec}
                        aria-pressed={activeFoleyCueSec === cue.sec}
                        onClick={() => setActiveFoleyCueSec(cue.sec)}
                        style={{
                          padding: "2px 8px",
                          borderRadius: "999px",
                          border: "1px solid #E4E6EC",
                          background:
                            activeFoleyCueSec === cue.sec ? "#3875C5" : "#F8F9FB",
                          color:
                            activeFoleyCueSec === cue.sec ? "#FFFFFF" : "#383B44",
                          fontSize: "10px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {isKo ? cue.ko : cue.en}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  data-audio-loudness-meter
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                    paddingTop: "4px",
                  }}
                >
                  <span
                    className="bw-chip"
                    style={{
                      background: "var(--ys-brand-tint)",
                      color: "var(--ys-brand-text)",
                      fontWeight: 700,
                      fontSize: "10.5px",
                    }}
                  >
                    {isKo
                      ? "방송·모바일 표준 음량: -14.0 LUFS / -1.0 dBTP True Peak 준수"
                      : "Loudness Standard: -14.0 LUFS / -1.0 dBTP True Peak"}
                  </span>
                  <span style={{ fontSize: "10.5px", color: "var(--ys-ink-secondary)", fontWeight: 600 }}>
                    {isKo
                      ? "인스타·틱톡·유튜브 쇼츠 상업 광고 저작권 100% 클리어 (음소거 0건 보장)"
                      : "100% Commercial Copyright Cleared for IG Reels, TikTok & Shorts"}
                  </span>
                </div>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "6px",
                  borderTop: "1px solid var(--ys-hairline)",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                  fontSize: "11px",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  <button
                    type="button"
                    className="bw-quick-chip"
                    data-audio-ducking-toggle
                    aria-pressed={audioAutoDucking}
                    onClick={() => setAudioAutoDucking((p) => !p)}
                    style={{ fontSize: "10.5px" }}
                  >
                    {isKo ? "목소리 나올 때 배경음 자동 낮춤 (-3dB)" : "Act 1 -3 dB Ducking"}
                  </button>
                  <button
                    type="button"
                    className="bw-quick-chip"
                    data-audio-lufs-toggle
                    aria-pressed={audioCommercialMaster}
                    onClick={() => setAudioCommercialMaster((p) => !p)}
                    style={{ fontSize: "10.5px" }}
                  >
                    {isKo ? "인스타·틱톡 표준 음량 (-14 LUFS)" : activeAudioPreset.loudnessSpec.split("(")[0]?.trim()}
                  </button>
                </div>

                <button
                  type="button"
                  className="bw-quick-chip"
                  data-audio-mux-video-cta
                  onClick={() =>
                    setStatusMessage(
                      isKo
                        ? `[오디오 + 영상 통합 마스터링] ${activeAudioPreset.titleKo} (-14.0 LUFS) 트랙이 우측 Seedance 2.5 (${videoResolution}) 영상에 0ms 비트 싱크로 결합되었습니다.`
                        : `[Video + Audio Multiplexed] ${activeAudioPreset.titleEn} (-14.0 LUFS) muxed onto Seedance 2.5 (${videoResolution}) video.`,
                    )
                  }
                  style={{
                    fontWeight: 700,
                    background: "#3875C5",
                    color: "#FFFFFF",
                    border: "1px solid #3875C5",
                  }}
                >
                  {isKo
                    ? "1080p 영상에 -14 LUFS 오디오 즉시 합치기 (Multiplex) →"
                    : "Mux -14 LUFS Audio onto 1080p Video →"}
                </button>
              </div>
            </div>
          </div>

          {/* STEP 3: Equal 4-Column Visual Scene Picker (.bw-scene-grid) with Thumbnails */}
          <div className="bw-scene-grid" data-pomelli-shot-templates>
            {simpleSceneButtons.map((item, idx) => {
              const isSelected = item.isVideo
                ? isVideoMode
                : !isVideoMode && activeShotTemplateId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="bw-scene-card"
                  data-pomelli-shot-template={item.id}
                  aria-pressed={isSelected}
                  onClick={() =>
                    handleSelectSceneType(
                      item.isVideo ? "short_video" : item.template!,
                      idx,
                    )
                  }
                  disabled={busy}
                >
                  <img
                    src={item.thumbSrc}
                    alt={isKo ? item.labelKo : item.labelEn}
                    className="bw-scene-thumb"
                    loading="lazy"
                  />
                  <span className="bw-scene-spec">{item.specLabel}</span>
                  <strong>{isKo ? item.labelKo : item.labelEn}</strong>
                  <span>{isKo ? item.descKo : item.descEn}</span>
                </button>
              );
            })}
          </div>

          {/* STEP 4: Recessed Composer Well (.bw-composer-well) with 1-4 Slot Recipe Builder */}
          <form
            onSubmit={onCompileSubmit}
            className="bw-composer-well"
            data-brief-compile-form
          >
            {/* Numbered Reference Quick-Cite Bar */}
            <div
              data-studio-ref-token-bar
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "6px",
                paddingBottom: "8px",
                borderBottom: "1px solid var(--ys-hairline)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--ys-ink-muted)",
                    marginRight: "4px",
                  }}
                >
                  {isKo ? "슬롯 번호 바로 부르기:" : "Cite slot in prompt:"}
                </span>
                {activeRefWorkflow.slots.map((s) => (
                  <button
                    key={s.slotNumber}
                    type="button"
                    className="bw-quick-chip"
                    data-cite-ref-slot={s.slotNumber}
                    onClick={() =>
                      handleInsertSlotReferenceIntoPrompt(
                        s.slotNumber,
                        isKo ? s.roleTitleKo : s.roleTitleEn,
                      )
                    }
                    disabled={!canWrite || busy}
                    style={{ padding: "3px 9px", fontSize: "11px" }}
                  >
                    {isKo
                      ? `+ ${s.slotNumber}번 (${s.roleTitleKo.split("·")[0]?.trim()})`
                      : `+ Image ${s.slotNumber}`}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="bw-quick-chip"
                data-fill-reference-formula
                onClick={() =>
                  setBriefText(
                    isKo
                      ? activeRefWorkflow.defaultPromptKo
                      : activeRefWorkflow.defaultPromptEn,
                  )
                }
                disabled={!canWrite || busy}
                style={{ fontWeight: 600, padding: "3px 10px" }}
              >
                {isKo
                  ? `공식 자동 입력 (${activeRefWorkflow.formulaBadgeKo})`
                  : `Auto-Fill (${activeRefWorkflow.formulaBadgeEn})`}
              </button>
            </div>

            <textarea
              name="brief"
              className="bw-composer-textarea"
              rows={2}
              value={briefText}
              onChange={(e) => setBriefText(e.target.value)}
              maxLength={500}
              disabled={!canWrite || busy}
              placeholder={
                isKo
                  ? activeRefWorkflow.defaultPromptKo
                  : activeRefWorkflow.defaultPromptEn
              }
            />

            {/* 1-Click Multi-Reference Recipe Chips (1번 인물 + 2번 배경 + 3번 감도 + 4번 색감 / 1번->2번 제품 교체) */}
            <div
              data-studio-quick-prompts
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {(isKo
                ? activeRefWorkflow.quickRecipesKo
                : activeRefWorkflow.quickRecipesEn
              ).map((sample, idx) => (
                <button
                  key={sample}
                  type="button"
                  className="bw-quick-chip"
                  data-studio-quick-prompt={idx}
                  onClick={() => setBriefText(sample)}
                  disabled={!canWrite || busy}
                >
                  + {sample}
                </button>
              ))}
            </div>

            {/* Video Mode Spec Bar: Resolution (480p / 720p / 1080p) + Duration (5s / 10s / 15s) + Live B2B Pricing */}
            {isVideoMode && (
              <div
                data-studio-video-pricing-bar
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "12px",
                  background: "var(--ys-surface)",
                  boxShadow: "var(--ys-ring)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {/* Video Resolution Selector */}
                  <div
                    className="bw-seg-track"
                    data-studio-video-resolution={videoResolution}
                  >
                    {(
                      [
                        {
                          res: "480p",
                          tierId: "seedance_2_5_480p_draft",
                          ko: "Seedance 2.5 · 480p (Draft)",
                          en: "Seedance 2.5 · 480p (Draft)",
                        },
                        {
                          res: "720p",
                          tierId: "seedance_2_5_720p_standard",
                          ko: "Seedance 2.5 · 720p (표준)",
                          en: "Seedance 2.5 · 720p (Standard)",
                        },
                        {
                          res: "1080p",
                          tierId: "seedance_2_5_1080p_master",
                          ko: "Seedance 2.5 · 1080p (본편)",
                          en: "Seedance 2.5 · 1080p (Master)",
                        },
                      ] as const
                    ).map((tier) => (
                      <button
                        key={tier.res}
                        type="button"
                        className="bw-seg-btn"
                        aria-pressed={videoResolution === tier.res}
                        onClick={() => handleSelectSeedanceTier(tier.tierId)}
                        disabled={busy}
                      >
                        {isKo ? tier.ko : tier.en}
                      </button>
                    ))}
                  </div>

                  {/* Video Duration Selector */}
                  <div
                    className="bw-seg-track"
                    data-studio-video-seconds={videoSeconds}
                  >
                    {([5, 10, 15] as const).map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        className="bw-seg-btn"
                        aria-pressed={videoSeconds === sec}
                        onClick={() => setVideoSeconds(sec)}
                        disabled={busy}
                      >
                        {isKo ? `${sec}초` : `${sec}s`}
                      </button>
                    ))}
                  </div>

                  {/* 2-Stage Approval Gate Toggle */}
                  {twoStageGateQuote && (
                    <button
                      type="button"
                      className="bw-quick-chip"
                      aria-pressed={useTwoStageGate}
                      onClick={() => setUseTwoStageGate((prev) => !prev)}
                      style={{
                        fontWeight: useTwoStageGate ? 600 : 400,
                        color: useTwoStageGate
                          ? "var(--ys-ink)"
                          : "var(--ys-ink-secondary)",
                      }}
                    >
                      {isKo
                        ? `2단계 검수 (480p 확인 후 1080p · ${twoStageGateQuote.savedPctVsTwoMasters}% 절감)`
                        : `2-Stage Gate (480p then 1080p · Save ${twoStageGateQuote.savedPctVsTwoMasters}%)`}
                    </button>
                  )}
                </div>

                {/* Live B2B Price Badge */}
                <span
                  className="bw-badge"
                  data-studio-live-quote
                  style={{ fontFamily: "var(--ys-mono)", fontWeight: 600 }}
                >
                  {isKo
                    ? `${activeVideoQuote.credits.toLocaleString("ko-KR")} cr · ${activeVideoQuote.priceKrw.toLocaleString("ko-KR")}원`
                    : `${activeVideoQuote.credits.toLocaleString("en-US")} cr · KRW ${activeVideoQuote.priceKrw.toLocaleString("en-US")}`}
                </span>
              </div>
            )}

            {/* Bottom Segmented Toolbar — Quiet Lifted White Pills, Single Ink Primary CTA */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                paddingTop: "12px",
                borderTop: "1px solid var(--ys-hairline)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                {/* Mood Pills */}
                <div
                  className="bw-seg-track"
                  data-studio-aesthetic-bar
                  data-active-aesthetic-line={activeAestheticLineCode}
                >
                  {aestheticLines.map((line) => {
                    const selected = activeAestheticLineCode === line.code;
                    const label = moodLabels[line.code];
                    return (
                      <button
                        key={line.id}
                        type="button"
                        className="bw-seg-btn"
                        data-studio-aesthetic-card={line.code}
                        aria-pressed={selected}
                        onClick={() => applyMood(line)}
                        disabled={busy}
                      >
                        {isKo ? label.ko : label.en}
                      </button>
                    );
                  })}
                </div>

                {/* Aspect Ratio Pills */}
                <div className="bw-seg-track">
                  {SHOT_ASPECTS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="bw-seg-btn"
                      aria-pressed={aspect === r}
                      onClick={() => setAspect(r)}
                      disabled={busy}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                {/* Brand Style Attachment Switch — Zero emojis */}
                <div
                  className="bw-seg-track"
                  data-design-principle-attachment
                  data-attachment-mode={principleAttachment.mode}
                >
                  <button
                    type="button"
                    className="bw-seg-btn"
                    data-attachment-mode-btn="full_attach"
                    aria-pressed={principleAttachment.mode === "full_attach"}
                    onClick={() => toggleBrandStyleMode("full_attach")}
                    disabled={busy}
                  >
                    {isKo ? "브랜드 톤 유지" : "Brand Style ON"}
                  </button>
                  <button
                    type="button"
                    className="bw-seg-btn"
                    data-attachment-mode-btn="custom_partial"
                    aria-pressed={principleAttachment.mode === "custom_partial"}
                    onClick={() => toggleBrandStyleMode("custom_partial")}
                    disabled={busy}
                  >
                    {isKo ? "원칙 선택" : "Custom Rules"}
                  </button>
                  <button
                    type="button"
                    className="bw-seg-btn"
                    data-attachment-mode-btn="unbound_free"
                    aria-pressed={principleAttachment.mode === "unbound_free"}
                    onClick={() => toggleBrandStyleMode("unbound_free")}
                    disabled={busy}
                  >
                    {isKo ? "자유 탐색" : "Free Style"}
                  </button>
                </div>
              </div>

              {canWrite && (
                <button
                  type="submit"
                  className="bw-button bw-primary"
                  disabled={busy}
                  data-brief-compile-submit
                >
                  {busy
                    ? isKo
                      ? "생성 중..."
                      : "Generating..."
                    : isVideoMode
                      ? isKo
                        ? `${videoSeconds}초 ${videoResolution} 영상 생성하기`
                        : `Generate ${videoSeconds}s ${videoResolution} Video`
                      : imageSubMode === "micro_region_edit"
                        ? isKo
                          ? `선택 부위 정밀 수정하기 (${activeMicroEditModel.creditsPerEdit} cr · 마스크 잠금)`
                          : `Edit Selected Region (${activeMicroEditModel.creditsPerEdit} cr · Mask Lock)`
                        : isKo
                          ? `화보 5장 생성하기 (${activeImageModel.creditsPer5Set} cr)`
                          : `Generate 5 Stills (${activeImageModel.creditsPer5Set} cr)`}
                </button>
              )}
            </div>

            {/* Interactive Brand Rule Chip Row when '원칙 선택' is active */}
            {principleAttachment.mode === "custom_partial" && (
              <div
                data-design-principle-chips
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px",
                  paddingTop: "10px",
                  borderTop: "1px solid var(--ys-hairline)",
                }}
              >
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: "var(--ys-ink-secondary)",
                    marginRight: "4px",
                  }}
                >
                  {isKo ? "적용할 원칙:" : "Active rules:"}
                </span>
                {DESIGN_PRINCIPLE_CHIPS.map((chip) => {
                  const active = Boolean(principleAttachment[chip.key]);
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      className="bw-quick-chip"
                      data-design-principle-chip={chip.key}
                      aria-pressed={active}
                      onClick={() => togglePrincipleKey(chip.key)}
                      disabled={busy}
                      style={{
                        fontWeight: active ? 600 : 400,
                        color: active
                          ? "var(--ys-ink)"
                          : "var(--ys-ink-secondary)",
                        boxShadow: active
                          ? "0 0 0 1.5px var(--ys-ink)"
                          : "var(--ys-ring)",
                      }}
                    >
                      {isKo ? chip.labelKo : chip.labelEn}
                    </button>
                  );
                })}
              </div>
            )}
          </form>

          {errorMessage && (
            <p
              role="alert"
              className="bw-error"
              data-brief-error
              style={{ marginTop: "12px" }}
            >
              {errorMessage}
            </p>
          )}
          {statusMessage && (
            <p
              role="status"
              className="bw-note"
              data-brief-status
              style={{ marginTop: "12px" }}
            >
              {statusMessage}
            </p>
          )}
        </div>

        {/* RIGHT COLUMN: Collapsible Right Pane — Dotted Canvas + Bridged +References + Floating Video/Upscale Dock */}
        <aside
          className="bw-canvas-stage"
          data-studio-live-canvas
          data-split-pane="right-video"
          data-pane-collapsed={String(splitPaneMode === "image_only")}
          aria-label={isKo ? "실시간 스튜디오 캔버스" : "Live Studio Canvas"}
          style={{
            backgroundImage:
              "radial-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        >
          {/* Right Pane Split-Tab Header: RIGHT TAB · 영상 · 업스케일 도트 캔버스 + Fold Left Toggle */}
          <div
            data-right-video-pane-header
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              padding: "6px 10px",
              borderRadius: "10px",
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              fontSize: "11.5px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: "rgba(56, 117, 197, 0.35)",
                  border: "1px solid rgba(56, 117, 197, 0.85)",
                  color: "#FFFFFF",
                  fontSize: "10.5px",
                  fontWeight: 700,
                }}
              >
                {isKo
                  ? "RIGHT TAB · 영상 · 도트 캔버스"
                  : "RIGHT TAB · Video & Dotted Canvas"}
              </span>
              <span style={{ color: "rgba(255, 255, 255, 0.78)" }}>
                {isKo
                  ? `좌측 이미지 ${bridgedVideoRefs.length}개 연결됨`
                  : `${bridgedVideoRefs.length} left images linked`}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                className="bw-canvas-tool-btn"
                data-fold-left-pane-btn
                onClick={() =>
                  setSplitPaneMode((prev) =>
                    prev === "video_only" ? "dual_split" : "video_only",
                  )
                }
                style={{
                  borderRadius: "999px",
                  padding: "3px 9px",
                  fontSize: "11px",
                  background: "rgba(255, 255, 255, 0.1)",
                  color: "#FFFFFF",
                }}
              >
                {splitPaneMode === "video_only"
                  ? isKo
                    ? "◫ 좌측 이미지 탭 함께 보기"
                    : "◫ Show Left Image Tab"
                  : isKo
                    ? "◨ 좌측 접기 (영상 집중)"
                    : "◨ Fold Left"}
              </button>
            </div>
          </div>

          {/* Canvas Top Status + Oplux Selection Toolbar */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              fontSize: "11.5px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  padding: "3px 9px",
                  borderRadius: "999px",
                  background: "rgba(255, 255, 255, 0.12)",
                  color: "#ffffff",
                  fontWeight: 600,
                }}
              >
                {isVideoMode
                  ? isKo
                    ? `${videoResolution} 영상 캔버스 · ${videoSeconds}초`
                    : `${videoResolution} Video Canvas · ${videoSeconds}s`
                  : imageSubMode === "micro_region_edit"
                    ? isKo
                      ? activeMicroEditModel.nameKo
                      : activeMicroEditModel.nameEn
                    : isKo
                      ? activeImageModel.nameKo
                      : activeImageModel.nameEn}
              </span>
              <span
                style={{
                  fontFamily: "var(--ys-mono)",
                  color: "rgba(255, 255, 255, 0.65)",
                }}
              >
                {cameraFocalMm}mm · {aspect}
              </span>
            </div>

            {/* Oplux-Style Top Selection Toolbar: Pointer | Marquee Drag | Brush Mask | Crop */}
            {!isVideoMode && (
              <div
                className="bw-canvas-toolbar"
                data-studio-canvas-toolbar={activeCanvasTool}
              >
                {(
                  [
                    {
                      id: "pointer",
                      ko: "이동",
                      en: "Move",
                    },
                    {
                      id: "marquee_select",
                      ko: "사각형 드래그 선택",
                      en: "Drag Select",
                    },
                    {
                      id: "brush_mask",
                      ko: "브러시 마스크",
                      en: "Brush Mask",
                    },
                    {
                      id: "crop_ratio",
                      ko: "크롭 · 비율",
                      en: "Crop",
                    },
                  ] as const
                ).map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className="bw-canvas-tool-btn"
                    data-canvas-tool-btn={tool.id}
                    aria-pressed={activeCanvasTool === tool.id}
                    onClick={() => {
                      setActiveCanvasTool(tool.id);
                      if (
                        tool.id === "marquee_select" ||
                        tool.id === "brush_mask"
                      ) {
                        setImageSubMode("micro_region_edit");
                      }
                    }}
                  >
                    {isKo ? tool.ko : tool.en}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Main Interactive Passepartout Viewport (Drag to select region or reference) */}
          <div
            className="bw-canvas-viewport"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            style={{
              cursor:
                !isVideoMode && activeCanvasTool !== "pointer"
                  ? "crosshair"
                  : "default",
              userSelect: "none",
            }}
          >
            <img
              src={activeCanvasImageSrc}
              alt={
                isKo
                  ? `${activeSceneButton.labelKo} 미리보기`
                  : `${activeSceneButton.labelEn} Preview`
              }
              className="bw-canvas-media"
              draggable={false}
              style={{
                aspectRatio: CSS_ASPECT_MAP[aspect] ?? "4 / 5",
              }}
            />

            {/* Morphic + Oplux Interactive Blue Selection Marquee Box */}
            {!isVideoMode &&
              activeCanvasTool !== "pointer" &&
              layerVisibility.regionMask && (
                <div
                  className="bw-canvas-marquee-box"
                  data-studio-canvas-marquee
                  style={{
                    left: `${selectionRect.xPct}%`,
                    top: `${selectionRect.yPct}%`,
                    width: `${selectionRect.wPct}%`,
                    height: `${selectionRect.hPct}%`,
                  }}
                >
                  <span className="bw-canvas-marquee-label">
                    {isKo
                      ? `선택 부위 (${matchedSelectionRatio}) · 원본 보존`
                      : `Selection (${matchedSelectionRatio}) · Smart Mask`}
                  </span>
                </div>
              )}

            {/* Oplux-Style Top-Right Floating Input Preview (Cropped Region + Mask Lock) */}
            {!isVideoMode && (
              <div
                className="bw-canvas-input-preview"
                data-studio-input-preview
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: "9.5px",
                    fontWeight: 700,
                    color: "rgba(255, 255, 255, 0.85)",
                  }}
                >
                  <span>{isKo ? "선택 부위" : "Input Preview"}</span>
                  <span style={{ color: "rgba(255, 255, 255, 0.92)" }}>
                    {matchedSelectionRatio}
                  </span>
                </div>
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: "6px",
                    overflow: "hidden",
                    position: "relative",
                    border: "1px solid var(--ys-brand)",
                  }}
                >
                  <img
                    src={activeCanvasImageSrc}
                    alt={isKo ? "선택 부위 입력 미리보기" : "Selected Region Input Preview"}
                    style={{
                      width: "180%",
                      height: "180%",
                      objectFit: "cover",
                      objectPosition: `${Math.min(100, selectionRect.xPct + selectionRect.wPct / 2)}% ${Math.min(100, selectionRect.yPct + selectionRect.hPct / 2)}%`,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "9.5px",
                    color: "rgba(255, 255, 255, 0.7)",
                    textAlign: "center",
                  }}
                >
                  {isKo ? "나머지 원본 보존" : "Mask Lock ON"}
                </span>
              </div>
            )}

            {isVideoMode && (
              <div
                data-studio-video-hud
                style={{
                  position: "absolute",
                  left: "14px",
                  right: "14px",
                  bottom: "12px",
                  padding: "7px 11px",
                  borderRadius: "9px",
                  background: "rgba(10, 11, 13, 0.78)",
                  backdropFilter: "blur(8px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  fontSize: "11px",
                  fontFamily: "var(--ys-mono)",
                  color: "#f5f5f3",
                }}
              >
                <span>
                  00:00:00:00 / 00:00:
                  {String(videoSeconds).padStart(2, "0")}:00
                </span>
                <span>
                  24fps · {videoResolution} ·{" "}
                  {isKo ? "사운드 포함" : "Audio Sync"}
                </span>
              </div>
            )}
          </div>

          {/* Morphic Studio Canvas Style Floating Selection Attach Bar ("Press Enter to attach selection or click here") */}
          {!isVideoMode && (
            <div
              className="bw-morphic-attach-bar"
              data-studio-morphic-attach-dock
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                {(
                  [
                    {
                      id: "multi_ref_generate",
                      ko: "이미지 생성",
                      en: "Create image",
                    },
                    {
                      id: "micro_region_edit",
                      ko: "부분 수정",
                      en: "Edit region",
                    },
                    {
                      id: "canvas_drag_ref",
                      ko: "참고 사진 조합",
                      en: "Create reference",
                    },
                  ] as const
                ).map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    className="bw-canvas-tool-btn"
                    aria-pressed={imageSubMode === pill.id}
                    onClick={() => handleSwitchImageSubMode(pill.id)}
                    style={{
                      borderRadius: "999px",
                      padding: "4px 10px",
                      background:
                        imageSubMode === pill.id
                          ? "rgba(255, 255, 255, 0.18)"
                          : "rgba(255, 255, 255, 0.06)",
                      color: "#FFFFFF",
                    }}
                  >
                    {isKo ? pill.ko : pill.en}
                  </button>
                ))}
                <button
                  type="button"
                  className="bw-canvas-tool-btn"
                  onClick={() => handleSwitchMediumMode("video")}
                  style={{
                    borderRadius: "999px",
                    padding: "4px 10px",
                    background: "rgba(255, 255, 255, 0.06)",
                    color: "rgba(255, 255, 255, 0.8)",
                  }}
                >
                  {isKo ? "이 컷으로 영상 제작 →" : "Create video →"}
                </button>
              </div>

              <button
                type="button"
                className="bw-morphic-attach-trigger"
                onClick={handleAttachCanvasSelection}
                data-studio-morphic-attach-btn
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    position: "relative",
                    width: "34px",
                    height: "26px",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={activeCanvasImageSrc}
                    alt=""
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "5px",
                      objectFit: "cover",
                      border: "1.5px solid #FFFFFF",
                      transform: "rotate(-8deg)",
                      position: "absolute",
                      left: 0,
                    }}
                  />
                  <img
                    src={
                      customSlotThumbs[2] ??
                      activeRefWorkflow.slots[1].defaultThumb
                    }
                    alt=""
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "5px",
                      objectFit: "cover",
                      border: "1.5px solid var(--ys-brand)",
                      transform: "rotate(8deg)",
                      position: "absolute",
                      left: "11px",
                    }}
                  />
                </span>
                <span>
                  {isKo
                    ? "여기를 클릭하거나 드래그한 선택 영역을 수정·레퍼런스로 바로 첨부"
                    : "Press Enter to attach selection or click here"}
                </span>
              </button>
            </div>
          )}

          {/* 3-Cut Contact Sheet Strip */}
          <div className="bw-canvas-strip" data-studio-canvas-takes>
            {studioVisuals.takes.map((take, idx) => {
              const selected = activeTakeIndex === idx;
              return (
                <button
                  key={take.id}
                  type="button"
                  className="bw-canvas-take"
                  data-studio-canvas-take={take.id}
                  aria-pressed={selected}
                  onClick={() => setActiveTakeIndex(idx)}
                >
                  <img
                    src={take.src}
                    alt={isKo ? take.labelKo : take.labelEn}
                    loading="lazy"
                  />
                  <span>{isKo ? take.labelKo : take.labelEn}</span>
                </button>
              );
            })}
          </div>

          {/* Oplux-Style Non-Destructive Layers & Smart Mask Stack */}
          {!isVideoMode && (
            <div className="bw-layers-panel" data-studio-layers-panel>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "rgba(255, 255, 255, 0.72)",
                }}
              >
                <span>
                  {isKo
                    ? "레이어 · 원본 보존 부분 수정 목록"
                    : "Layers · Non-Destructive Smart Mask Stack"}
                </span>
                <span style={{ color: "rgba(255, 255, 255, 0.92)" }}>
                  {isKo ? "원본 훼손 없음" : "Smart Object"}
                </span>
              </div>

              <div
                className="bw-layer-row"
                data-active={String(imageSubMode === "micro_region_edit")}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {isKo
                    ? `3층 · 부분 수정 영역 (${activeRegionPreset.labelKo})`
                    : `Layer 03 · Region Mask (${activeRegionPreset.labelEn})`}
                </span>
                <button
                  type="button"
                  className="bw-canvas-tool-btn"
                  aria-pressed={layerVisibility.regionMask}
                  onClick={() =>
                    setLayerVisibility((prev) => ({
                      ...prev,
                      regionMask: !prev.regionMask,
                    }))
                  }
                  style={{ padding: "2px 8px", fontSize: "10.5px" }}
                >
                  {layerVisibility.regionMask
                    ? isKo
                      ? "영역 표시 켜짐"
                      : "Mask ON"
                    : isKo
                      ? "숨김"
                      : "Hidden"}
                </button>
              </div>

              <div
                className="bw-layer-row"
                data-active={String(isColorRefPinned || isTextureRefPinned)}
              >
                <span>
                  {isKo
                    ? `2층 · 고정 색감·질감 (${isColorRefPinned ? "색감 고정" : "색감 해제"} · ${isTextureRefPinned ? "질감 고정" : "질감 해제"})`
                    : `Layer 02 · Pinned Color & Texture Pass`}
                </span>
                <span
                  style={{
                    fontSize: "10.5px",
                    color: "rgba(255, 255, 255, 0.9)",
                    fontWeight: 600,
                  }}
                >
                  {isKo ? "상시 적용" : "Pinned"}
                </span>
              </div>

              <div className="bw-layer-row" data-active="false">
                <span>
                  {isKo
                    ? `1층 · 원본 이미지 (${activeTake.labelKo})`
                    : `Layer 01 · Base Original (${activeTake.labelEn})`}
                </span>
                <span style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.6)" }}>
                  100%
                </span>
              </div>
            </div>
          )}

          {/* Bridged Left-Image -> Right-Video `+ References` Tray */}
          <div
            data-video-bridged-references-tray
            style={{
              padding: "10px",
              borderRadius: "12px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              display: "grid",
              gap: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "6px",
                fontSize: "11px",
              }}
            >
              <strong style={{ color: "rgba(255, 255, 255, 0.92)" }}>
                {isKo
                  ? `우측 영상 +References (좌측 이미지 탭에서 넘긴 레퍼런스 ${bridgedVideoRefs.length}개)`
                  : `Right Video +References (${bridgedVideoRefs.length} bridged from Left Image Tab)`}
              </strong>
              <button
                type="button"
                onClick={() =>
                  handleBridgeLeftImageToRightVideo("first_frame")
                }
                style={{
                  padding: "3px 8px",
                  borderRadius: "999px",
                  border: "1px solid rgba(56, 117, 197, 0.75)",
                  background: "rgba(56, 117, 197, 0.25)",
                  color: "#FFFFFF",
                  fontSize: "10.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {isKo
                  ? "+ 좌측 현재 이미지 컷 바로 꽂기"
                  : "+ Attach Active Left Image"}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "6px",
              }}
            >
              {bridgedVideoRefs.map((refItem) => {
                const slotSpec =
                  VIDEO_REFERENCE_TARGET_SLOTS.find(
                    (s) => s.id === refItem.slotId,
                  ) ?? VIDEO_REFERENCE_TARGET_SLOTS[0]!;
                return (
                  <div
                    key={refItem.slotId}
                    data-bridged-video-ref-card={refItem.slotId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 8px",
                      borderRadius: "9px",
                      background: "rgba(15, 17, 21, 0.72)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                    }}
                  >
                    <img
                      src={refItem.imageSrc}
                      alt={
                        isKo ? refItem.imageLabelKo : refItem.imageLabelEn
                      }
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "6px",
                        objectFit: "cover",
                        flexShrink: 0,
                        border: "1px solid rgba(56, 117, 197, 0.8)",
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          color: "#93C5FD",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {isKo ? slotSpec.badgeKo : slotSpec.badgeEn}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#FFFFFF",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {isKo ? refItem.imageLabelKo : refItem.imageLabelEn}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={isKo ? "레퍼런스 제거" : "Remove reference"}
                      onClick={() =>
                        handleRemoveBridgedVideoRef(refItem.slotId)
                      }
                      style={{
                        border: 0,
                        background: "transparent",
                        color: "rgba(255, 255, 255, 0.55)",
                        fontSize: "12px",
                        cursor: "pointer",
                        padding: "2px 4px",
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reference-UI Inspired Floating Composer Dock (Workflows / Tools / Explore + [Image | Video | Audio] + [+ References] + Seedance 2.5 / Upscale) */}
          <div
            data-video-floating-composer-dock
            style={{
              display: "grid",
              gap: "8px",
              marginTop: "2px",
            }}
          >
            {/* Floating Quick Pills: Workflows · Tools · Explore */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <button
                type="button"
                className="bw-canvas-tool-btn"
                onClick={() => {
                  handleSelectSeedanceTier("seedance_2_5_720p_standard");
                  setIsUpscaleStudioExpanded(true);
                }}
                style={{
                  borderRadius: "999px",
                  padding: "4px 10px",
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: "#FFFFFF",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {isKo
                  ? "⇕ Workflows · 720p 생성 → 인스타 1080p 업스케일"
                  : "⇕ Workflows · 720p → IG 1080p Upscale"}
              </button>
              <button
                type="button"
                className="bw-canvas-tool-btn"
                onClick={() => setIsUpscaleStudioExpanded((p) => !p)}
                style={{
                  borderRadius: "999px",
                  padding: "4px 10px",
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: "#FFFFFF",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {isKo
                  ? "⇕ Tools · 업스케일러 3종 & 인스타 로직"
                  : "⇕ Tools · 3 Upscalers & IG Logic"}
              </button>
            </div>

            {/* Main Rounded Floating Composer Card */}
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "16px",
                background: "rgba(22, 24, 29, 0.95)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
                display: "grid",
                gap: "8px",
              }}
            >
              {/* Top Row inside Dock: [Image | Video | Audio] + [+ References] */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    padding: "3px",
                    borderRadius: "999px",
                    background: "rgba(255, 255, 255, 0.06)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleSwitchMediumMode("image")}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      border: 0,
                      background: !isVideoMode
                        ? "rgba(255, 255, 255, 0.2)"
                        : "transparent",
                      color: "#FFFFFF",
                      fontSize: "11px",
                      fontWeight: !isVideoMode ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "Image (좌측)" : "Image"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMediumMode("video")}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      border: 0,
                      background: isVideoMode
                        ? "rgba(255, 255, 255, 0.2)"
                        : "transparent",
                      color: "#FFFFFF",
                      fontSize: "11px",
                      fontWeight: isVideoMode ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "Video (우측)" : "Video"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectCoreTrack("audio")}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      border: 0,
                      background:
                        activeCoreTrack === "audio"
                          ? "rgba(255, 255, 255, 0.2)"
                          : "transparent",
                      color: "#FFFFFF",
                      fontSize: "11px",
                      fontWeight: activeCoreTrack === "audio" ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? "Audio" : "Audio"}
                  </button>
                </div>

                <button
                  type="button"
                  data-dock-add-reference-btn
                  onClick={() =>
                    handleBridgeLeftImageToRightVideo(selectedBridgeSlot)
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 11px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <span>+</span>
                  <span>
                    {isKo
                      ? `References (${bridgedVideoRefs.length})`
                      : `References (${bridgedVideoRefs.length})`}
                  </span>
                </button>
              </div>

              {/* Bottom Row inside Dock: Model Pill + Aspect/Duration + Credit Execute Badge */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                  paddingTop: "4px",
                  borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                  fontSize: "11px",
                  color: "rgba(255, 255, 255, 0.8)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ fontWeight: 700, color: "#FFFFFF" }}>
                    {isVideoMode
                      ? `Seedance 2.5 (${videoResolution})`
                      : isKo
                        ? activeImageModel.nameKo
                        : activeImageModel.nameEn}
                  </span>
                  <span style={{ fontFamily: "var(--ys-mono)" }}>
                    {aspect} · {isVideoMode ? `${videoSeconds}s` : "1x"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!isVideoMode) {
                      handleBridgeLeftImageToRightVideo("first_frame");
                      handleSwitchMediumMode("video");
                    } else {
                      handleRunUpscaleStudioJob();
                    }
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    border: 0,
                    background: "#3875C5",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <span>CR</span>
                  <span>
                    {isVideoMode
                      ? activeVideoQuote.credits
                      : activeImageModel.creditsPer5Set}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Studio Output Action Bar */}
          <div
            data-studio-canvas-actions
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              paddingTop: "6px",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <a
                href={activeCanvasImageSrc}
                download
                style={{
                  padding: "6px 11px",
                  borderRadius: "999px",
                  background: "rgba(255, 255, 255, 0.12)",
                  color: "#ffffff",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {isKo ? "원본 다운로드" : "Download Master"}
              </a>
              <button
                type="button"
                onClick={() =>
                  setBriefText(
                    isKo
                      ? `${activeTake.labelKo} 구도를 유지하면서 2번 이미지 제품의 로고 선명도와 4번 이미지의 조명 대비를 한 단계 높여 줘.`
                      : `Keep the ${activeTake.labelEn} framing while sharpening the product label from Image 2 and enhancing the lighting contrast from Image 4.`,
                  )
                }
                style={{
                  padding: "6px 11px",
                  borderRadius: "999px",
                  border: 0,
                  background: "rgba(255, 255, 255, 0.07)",
                  color: "rgba(255, 255, 255, 0.85)",
                  font: "inherit",
                  fontSize: "11.5px",
                  cursor: "pointer",
                }}
              >
                {isKo ? "부분 수선 · 리터치" : "Retouch Cut"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!isVideoMode) {
                  handleSwitchMediumMode("video");
                } else {
                  setVideoResolution("1080p");
                }
              }}
              style={{
                padding: "6px 11px",
                borderRadius: "999px",
                border: 0,
                background: "#ffffff",
                color: "#111214",
                font: "inherit",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {isVideoMode
                ? isKo
                  ? "1080p 마스터로 전환"
                  : "Switch to 1080p Master"
                : isKo
                  ? "이 컷으로 영상 만들기"
                  : "Animate This Cut"}
            </button>
          </div>
        </aside>
      </div>
      </div>

      {/* Compiled Output Approval Bar */}
      {view && (
        <div
          data-brief-preview
          style={{
            marginTop: "18px",
            padding: "14px 18px",
            borderRadius: "var(--ys-r-card)",
            background: "var(--ys-subtle-bg)",
            boxShadow: "inset 0 0 0 1px var(--ys-hairline)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              flex: "1 1 320px",
            }}
          >
            <img
              src={activeCanvasImageSrc}
              alt={isKo ? view.cutKindLabel.ko : view.cutKindLabel.en}
              style={{
                width: "76px",
                aspectRatio: "4 / 5",
                objectFit: "cover",
                objectPosition: "50% 16%",
                borderRadius: "var(--ys-r-media)",
                boxShadow: "var(--ys-ring)",
                flexShrink: 0,
              }}
            />
            <div>
              <strong style={{ fontSize: "14.5px", color: "var(--ys-ink)" }}>
                {isKo ? view.cutKindLabel.ko : view.cutKindLabel.en} ·{" "}
                {view.deliverable.aspect} (
                {isVideoMode ? videoResolution : view.resolution})
              </strong>
              <p
                className="bw-muted"
                style={{ margin: "4px 0 0", fontSize: "13px" }}
              >
                {isKo
                  ? "1~4번 레퍼런스 역할 잠금과 브랜드 색감·화질 보정이 모두 반영되었습니다."
                  : "Your 1–4 reference locks, brand color tone, and quality mastering have been applied."}
              </p>
            </div>
          </div>
          {canWrite && view.stage !== "approved" && (
            <button
              type="button"
              className="bw-button bw-primary"
              onClick={() => void onApproveAndFinalize()}
              disabled={busy}
              data-brief-approve-submit
            >
              {isKo ? "보관함에 저장하기" : "Save to Library"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
