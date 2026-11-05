"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
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
  BRAND_STUDIO_IMAGE_MODELS,
  resolveCategoryReferenceWorkflows,
  type BrandStudioImageModelId,
  type StudioReferenceSlotNumber,
  type StudioReferenceWorkflowId,
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
      "/reel/studio/vto-garment.webp",
      "/reel/landing/c-garment-ours.webp",
      "/reel/studio/vto-look-front.webp",
      "/reel/brands/house-runway-1080p.jpg",
    ],
    takes: [
      {
        id: "take-1",
        labelKo: "컷 01 · 정면 히어로",
        labelEn: "Cut 01 · Front Hero",
        src: "/reel/studio/vto-look-front.webp",
      },
      {
        id: "take-2",
        labelKo: "컷 02 · 측면 실루엣",
        labelEn: "Cut 02 · Side Profile",
        src: "/reel/studio/vto-look-side.webp",
      },
      {
        id: "take-3",
        labelKo: "컷 03 · 상반신 디테일",
        labelEn: "Cut 03 · Upper Detail",
        src: "/reel/studio/vto-look-upper.webp",
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

  // Image Model Selection & Full Comparison Guide Toggle
  const [selectedImageModelId, setSelectedImageModelId] =
    useState<BrandStudioImageModelId>("portrait_lookbook_pro");
  const [showFullModelGuide, setShowFullModelGuide] = useState<boolean>(false);
  const activeImageModel =
    BRAND_STUDIO_IMAGE_MODELS.find((m) => m.id === selectedImageModelId) ??
    BRAND_STUDIO_IMAGE_MODELS[0]!;

  // Video production controls (Resolution + Duration + 2-Stage Approval Gate)
  const [videoResolution, setVideoResolution] =
    useState<BrandVideoResolution>("720p");
  const [videoSeconds, setVideoSeconds] =
    useState<BrandStandardDurationSeconds>(10);
  const [useTwoStageGate, setUseTwoStageGate] = useState<boolean>(true);

  // Active take on the right-hand live studio canvas
  const [activeTakeIndex, setActiveTakeIndex] = useState<number>(0);

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

  const resolvedChecklist =
    defaultChecklist && defaultChecklist.length > 0
      ? defaultChecklist
      : [
          categoryProfile.compiler.defaultProductChecklist.geometry,
          categoryProfile.compiler.defaultProductChecklist.label,
          categoryProfile.compiler.defaultProductChecklist.material,
        ];

  function handleSwitchMediumMode(targetMode: "image" | "video") {
    if (targetMode === "video") {
      setMedium("short film");
      setCutKind("short_film_clip");
      setAspect("9:16");
      setUse("reel");
      setCameraFocalMm(categoryProfile.scenes[3].focalMm);
    } else {
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
      setSelectedImageModelId("multi_ref_standard");
    } else {
      setSelectedImageModelId("portrait_lookbook_pro");
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

    const promptToUse =
      briefText.trim() ||
      (isKo
        ? activeRefWorkflow.defaultPromptKo
        : activeRefWorkflow.defaultPromptEn);

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
    >
      {/* Top Bar: Studio Header + Explicit Image vs Video Mode Switch + Brand Category Pill */}
      <div
        className="bw-row"
        style={{
          marginBottom: "18px",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "14px",
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 4px" }}>
            {isKo
              ? "멀티 레퍼런스 화보 · 영상 워크벤치"
              : "Multi-Reference Image & Video Workbench"}
          </h2>
          <p className="bw-muted" style={{ margin: 0, fontSize: "13px" }}>
            {isKo ? categoryProfile.headlineKo : categoryProfile.headlineEn}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {/* Explicit Image Lookbook vs Video Creation Mode Switch */}
          <div
            className="bw-seg-track"
            data-studio-medium-tabs
            role="tablist"
            aria-label={isKo ? "제작 유형 선택" : "Select creation mode"}
          >
            <button
              type="button"
              role="tab"
              className="bw-seg-btn"
              data-studio-medium-tab="image"
              aria-selected={!isVideoMode}
              aria-pressed={!isVideoMode}
              onClick={() => handleSwitchMediumMode("image")}
              disabled={busy}
            >
              {isKo ? "이미지 화보 만들기" : "Create Image Stills"}
            </button>
            <button
              type="button"
              role="tab"
              className="bw-seg-btn"
              data-studio-medium-tab="video"
              aria-selected={isVideoMode}
              aria-pressed={isVideoMode}
              onClick={() => handleSwitchMediumMode("video")}
              disabled={busy}
            >
              {isKo ? "숏폼 · 마스터 영상 만들기" : "Create Short-Form Video"}
            </button>
          </div>

          <span
            className="bw-badge"
            data-studio-category-switcher
            data-studio-category-pill={activeCategory}
          >
            {isKo ? categoryProfile.labelKo : categoryProfile.labelEn}
          </span>
          {identityHref && (
            <a className="bw-button" href={identityHref}>
              {isKo ? "브랜드 스타일" : "Brand Style"}
            </a>
          )}
        </div>
      </div>

      {/* 2-Column Split Studio Workbench: Left = Creation Controls, Right = Always-On Live Visual Canvas */}
      <div className="bw-studio-workbench">
        {/* LEFT COLUMN: 1-4 Reference Deck + Image Model Selector + Scene Cards + Prompt Composer */}
        <div>
          {/* STEP 1: Numbered 1-4 Reference Image Slots (Sunra / AMERICANO / Oplux Style) */}
          <div
            style={{
              display: "flex",
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
                  ? "1~4번 레퍼런스 이미지 배치"
                  : "1–4 Numbered Reference Slots"}
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

          <div className="bw-ref-slot-grid" data-studio-asset-upload>
            {activeRefWorkflow.slots.map((slot) => {
              const thumbSrc =
                customSlotThumbs[slot.slotNumber] ?? slot.defaultThumb;
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

              return (
                <div
                  key={slot.slotNumber}
                  className="bw-ref-slot-card"
                  data-ref-slot={slot.slotNumber}
                  data-upload-slot={compatSlotAttr}
                >
                  <div className="bw-ref-slot-media">
                    <img src={thumbSrc} alt={assetName} loading="lazy" />
                    <span className="bw-ref-num-badge">
                      {isKo ? slot.tagKo : slot.tagEn}
                    </span>
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
                      gap: "6px",
                      marginTop: "auto",
                      paddingTop: "4px",
                    }}
                  >
                    <label
                      className="bw-quick-chip"
                      style={{ fontWeight: 600, padding: "4px 9px" }}
                    >
                      {isKo ? "사진 넣기" : "Upload"}
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
                      style={{ padding: "4px 9px" }}
                      onClick={() =>
                        handleInsertSlotReferenceIntoPrompt(
                          slot.slotNumber,
                          roleTitle,
                        )
                      }
                      disabled={!canWrite || busy}
                    >
                      {isKo
                        ? `+ ${slot.slotNumber}번 지시`
                        : `+ Cite #${slot.slotNumber}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* STEP 2: Image Model Selector + Quick Characteristics + Detailed Suitability Guide */}
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
                      ? "이미지 생성 모델 선택"
                      : "Select Image Generation Model"}
                  </strong>
                  <span
                    className="bw-muted"
                    style={{ marginLeft: "8px", fontSize: "12px" }}
                  >
                    {isKo
                      ? "만들려는 결과물(제품 교체 vs 인물 룩북 vs 라벨 마크로 vs 의류 착장)에 맞춰 모델을 고르세요"
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

              {/* 4 Image Model Cards with 1-Line Traits & Strength Pills */}
              <div
                className="bw-model-picker-grid"
                data-studio-image-model-picker
                data-selected-image-model={selectedImageModelId}
              >
                {BRAND_STUDIO_IMAGE_MODELS.map((model) => {
                  const selected = selectedImageModelId === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className="bw-model-card"
                      data-studio-image-model-card={model.id}
                      aria-pressed={selected}
                      onClick={() => handleSelectImageModel(model.id)}
                      disabled={busy}
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
                  <span
                    className="bw-badge"
                    style={{ fontSize: "11px", fontWeight: 600 }}
                  >
                    {isKo
                      ? `권장 슬롯 공식: ${activeImageModel.recommendedSlotFormulaKo}`
                      : `Slot Formula: ${activeImageModel.recommendedSlotFormulaEn}`}
                  </span>
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

                {/* Full 4-Model Comparison Matrix when toggled open */}
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
                        ? "상황별 이미지 모델 한눈에 비교하기"
                        : "Model Suitability Comparison by Deliverable"}
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
                          ko: "480p 구도 프리뷰",
                          en: "480p Preview",
                        },
                        {
                          res: "720p",
                          ko: "720p 스탠다드",
                          en: "720p Standard",
                        },
                        {
                          res: "1080p",
                          ko: "1080p 마스터",
                          en: "1080p Master",
                        },
                      ] as const
                    ).map((tier) => (
                      <button
                        key={tier.res}
                        type="button"
                        className="bw-seg-btn"
                        aria-pressed={videoResolution === tier.res}
                        onClick={() => setVideoResolution(tier.res)}
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

        {/* RIGHT COLUMN: Always-On Live Studio Canvas Stage */}
        <aside
          className="bw-canvas-stage"
          data-studio-live-canvas
          aria-label={isKo ? "실시간 스튜디오 캔버스" : "Live Studio Canvas"}
        >
          {/* Canvas Top Status Bar */}
          <div
            style={{
              display: "flex",
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
            <span style={{ color: "rgba(255, 255, 255, 0.68)" }}>
              {isKo
                ? activeRefWorkflow.formulaBadgeKo
                : activeRefWorkflow.formulaBadgeEn}
            </span>
          </div>

          {/* Main Passepartout Viewport */}
          <div className="bw-canvas-viewport">
            <img
              src={activeCanvasImageSrc}
              alt={
                isKo
                  ? `${activeSceneButton.labelKo} 미리보기`
                  : `${activeSceneButton.labelEn} Preview`
              }
              className="bw-canvas-media"
              style={{
                aspectRatio: CSS_ASPECT_MAP[aspect] ?? "4 / 5",
              }}
            />
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
