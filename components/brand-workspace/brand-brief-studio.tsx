"use client";

import { useState, type FormEvent } from "react";
import {
  DELIVERABLE_MEDIUMS,
  DELIVERABLE_USES,
  SHOT_ASPECTS,
  SHOT_CUT_KINDS,
  SHOT_CUT_KIND_LABELS,
  resolveInternalCutKind,
  type CustomerBriefView,
  type DeliverableMedium,
  type DeliverableUse,
  type PublicCutKindCode,
  type ShotAspect,
  type ShotCutKind,
  type ShotSpec,
} from "@/lib/brands/briefs/schema";
import type {
  BrandBriefState,
  BriefDeltaAxis,
} from "@/lib/brands/briefs/state-machine";
import {
  BRAND_LOOK_PRESET_IDS,
  type BrandLookPresetId,
} from "@/lib/brands/finish/color-grading";
import {
  PROJECT_DIRECTION_PRESETS,
  type ProjectDirectionPresetKey,
} from "@/lib/brands/identity/project-direction";
import {
  synthesizeMultiAestheticLines,
  type BrandAestheticLine,
} from "@/lib/brands/identity/onboarding";
import {
  DESIGN_PRINCIPLE_CHIPS,
  DESIGN_PRINCIPLE_KEYS,
  POMELLI_SHOT_TEMPLATES,
  createAttachmentPreset,
  listPlaybooksForVertical,
  summarizeDesignPrincipleAttachment,
  type CoreBrandVertical,
  type DesignPrincipleAttachment,
  type DesignPrincipleAttachmentMode,
  type DesignPrincipleKey,
  type PomelliShotTemplate,
  type PomelliShotTemplateId,
  type VerticalMarketerPlaybook,
} from "@/lib/brands/briefs/vertical-playbooks";
import {
  BrandMicroRoiPanel,
  type ExternalMicroRoiHandoff,
} from "./brand-micro-roi-panel";
import { BrandSpatialStagePanel } from "./brand-spatial-stage-panel";
import {
  BrandStudioTutorial,
  type StudioFocusMode,
} from "./brand-studio-tutorial";
import { BrandVideoReversePanel } from "./brand-video-reverse-panel";
import { ReviewStage } from "./review-stage";
import { evaluateOpticalIdentityLockV2 } from "@/lib/brands/production-pipeline/video-creator-techniques";

export interface BrandBriefStudioProps {
  organizationId: string;
  locale: "ko" | "en";
  canWrite: boolean;
  identityConfirmed: boolean;
  defaultChecklist?: readonly string[];
  identityHref?: string;
  initialProjectId?: string;
  initialProjectTitle?: string;
}

const EDITABLE_DELTA_AXES: ReadonlyArray<{
  axis: BriefDeltaAxis;
  ko: string;
  en: string;
}> = [
  { axis: "light", ko: "조명 (광원 모디파이어·색온도)", en: "Lighting (Key modifier & temp)" },
  { axis: "camera", ko: "카메라 (초점거리 mm)", en: "Camera (Focal length mm)" },
  { axis: "space", ko: "공간 (배경·테이블 표면)", en: "Space (Background & surface)" },
  { axis: "product", ko: "제품 (라벨·재질 잠금)", en: "Product (Label & finish lock)" },
  { axis: "brief", ko: "한 줄 지시문 (핵심 연출)", en: "One-line Brief (Core direction)" },
];

export function BrandBriefStudio({
  organizationId,
  locale,
  canWrite,
  identityConfirmed,
  defaultChecklist = ["제품 실루엣과 라벨 비례 유지", "프렌치 블루 색 대역 유지"],
  identityHref,
  initialProjectId,
  initialProjectTitle,
}: BrandBriefStudioProps) {
  const isKo = locale === "ko";

  const [directionMode, setDirectionMode] = useState<
    "base_inherited" | "project_override"
  >(initialProjectId ? "project_override" : "base_inherited");
  const [projectId, setProjectId] = useState(
    initialProjectId ?? "kaiper-26ss-outdoor"
  );
  const [projectTitle, setProjectTitle] = useState(
    initialProjectTitle ??
      (isKo
        ? "시즌 캠페인 · 야외 골든아워 필름"
        : "Season Campaign · Outdoor Golden Hour")
  );
  const [lookPresetId, setLookPresetId] = useState<BrandLookPresetId>(
    "kodak-2383-warm"
  );
  const [projectRulePrompt, setProjectRulePrompt] = useState(
    isKo
      ? "야외 자연광 역광 하이라이트와 부드러운 아날로그 필름 결 유지, 스튜디오 정물 배경 배제"
      : "Maintain natural outdoor golden-hour rim light and analog film grain; avoid studio tabletop"
  );
  const [projectChecklistText, setProjectChecklistText] = useState(
    isKo
      ? "야외 역광에서도 의상/제품 본연의 색상과 로고 심볼 선명도 유지"
      : "Preserve garment/product colour accuracy and logo clarity under outdoor backlight"
  );
  const [lightColourK, setLightColourK] = useState(5400);
  const [isolateProjectMemory, setIsolateProjectMemory] = useState(true);

  const [briefText, setBriefText] = useState(
    isKo
      ? "자연광이 들어오는 스튜디오 테이블 위 제품 클로즈업과 정갈한 여백"
      : "Clean studio tabletop product close-up with natural side window light and negative space"
  );
  const [cutKind, setCutKind] = useState<ShotCutKind>("reference_exact_product");
  const [medium, setMedium] = useState<DeliverableMedium>("product still");
  const [aspect, setAspect] = useState<ShotAspect>("4:5");
  const [use, setUse] = useState<DeliverableUse>("feed");
  const [productName, setProductName] = useState("");
  const [labelLock, setLabelLock] = useState(
    defaultChecklist[0] ?? "front label centered with crisp brand typography"
  );
  const [cameraFocalMm, setCameraFocalMm] = useState(50);
  const [lightModifier, setLightModifier] = useState(
    "large diffused window softbox"
  );
  const [spaceBackground, setSpaceBackground] = useState(
    "soft daylight plaster wall with generous negative space"
  );
  const [spaceSurface, setSpaceSurface] = useState("honed limestone tabletop");

  const [briefState, setBriefState] = useState<BrandBriefState | null>(null);
  const [view, setView] = useState<CustomerBriefView | null>(null);
  const [deltaAxis, setDeltaAxis] = useState<BriefDeltaAxis>("light");
  const [deltaValue, setDeltaValue] = useState("");
  const [aestheticGatePassed, setAestheticGatePassed] = useState(false);
  const [finalResolution, setFinalResolution] = useState<
    "720p" | "1080p" | "2k" | "4k"
  >("2k");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [studioFocusMode, setStudioFocusMode] =
    useState<StudioFocusMode>("all");
  const [activeAestheticLineCode, setActiveAestheticLineCode] = useState<
    "A" | "B" | "C"
  >("A");
  const [principleAttachment, setPrincipleAttachment] =
    useState<DesignPrincipleAttachment>(() =>
      createAttachmentPreset("full_attach")
    );
  const [activeVertical, setActiveVertical] =
    useState<CoreBrandVertical>("fashion_apparel");
  const [activeShotTemplateId, setActiveShotTemplateId] =
    useState<PomelliShotTemplateId>("studio");
  const [activePlaybookId, setActivePlaybookId] = useState<string>(
    "fashion-flatlay-to-lookbook"
  );
  const [externalMicroRoiHandoff, setExternalMicroRoiHandoff] =
    useState<ExternalMicroRoiHandoff | null>(null);
  const [externalMusicRevealSec, setExternalMusicRevealSec] = useState<
    number | null
  >(null);

  // Interactive Optical Identity Lock™ v2 Diagnostic state in Self Studio
  const [portraitHeadWidthPct, setPortraitHeadWidthPct] = useState<number>(42);
  const [portraitHasOcclusion, setPortraitHasOcclusion] = useState<boolean>(false);
  const [portraitBaggyTop, setPortraitBaggyTop] = useState<boolean>(false);
  const studioOpticalReport = evaluateOpticalIdentityLockV2({
    focalLengthMm: cameraFocalMm,
    headWidthRatioPct: portraitHeadWidthPct,
    hasFaceOcclusion: portraitHasOcclusion,
    baggyCasualTopDetected: portraitBaggyTop,
    locale,
  });

  const aestheticLines = synthesizeMultiAestheticLines({
    brandName: "KAIPER",
    category: activeVertical,
    preferredVibe: "minimal_editorial",
    hasPinterestBoards: true,
  });

  const attachmentSummary =
    summarizeDesignPrincipleAttachment(principleAttachment);
  const activeVerticalPlaybooks = listPlaybooksForVertical(activeVertical);

  function handleSelectAttachmentMode(mode: DesignPrincipleAttachmentMode) {
    const next = createAttachmentPreset(mode);
    setPrincipleAttachment(next);
    setStatusMessage(
      mode === "unbound_free"
        ? isKo
          ? "디자인 원칙 미적용 · 자유 탐색 모드: 기존 브랜드 컬러·미감 기조 잠금을 해제하고 자유롭게 새 컨셉을 실험합니다."
          : "Unbound Free Exploration Mode: detached brand palette and aesthetic locks for open concept exploration."
        : mode === "custom_partial"
          ? isKo
            ? "선택적 디자인 원칙 연결 모드: 로고·제품 1:1 고정은 유지하고 시즌 컬러·배경 기조는 자유롭게 탐색합니다."
            : "Custom Partial Attach Mode: locked logo & product while unlocking seasonal colors and mood."
          : isKo
            ? "브랜드 디자인 원칙 전체 연결: 로고·컬러 팔레트·타이포 여백·미감 기조·모델 페르소나·금기어가 모두 연결되었습니다."
            : "Full Brand DNA Attached: all 6 brand design principles are locked."
    );
  }

  function handleTogglePrincipleChip(key: DesignPrincipleKey) {
    setPrincipleAttachment((prev) => {
      const nextVal = !prev[key];
      const updated = { ...prev, [key]: nextVal };
      const attachedCount = DESIGN_PRINCIPLE_KEYS.filter(
        (k) => updated[k]
      ).length;
      const nextMode: DesignPrincipleAttachmentMode =
        attachedCount === DESIGN_PRINCIPLE_KEYS.length
          ? "full_attach"
          : attachedCount <= 1
            ? "unbound_free"
            : "custom_partial";
      return { ...updated, mode: nextMode };
    });
  }

  function handleSelectPomelliShotTemplate(template: PomelliShotTemplate) {
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
    setStatusMessage(
      isKo
        ? `[${template.titleKo}] 화보 템플릿이 적용되었습니다 (${template.focalMm}mm · ${template.lightColourK}K · ${template.defaultAspect}).`
        : `Applied [${template.titleEn}] shot template (${template.focalMm}mm · ${template.lightColourK}K · ${template.defaultAspect}).`
    );
  }

  function handleSelectVerticalPlaybook(playbook: VerticalMarketerPlaybook) {
    setActivePlaybookId(playbook.id);
    setActiveVertical(playbook.vertical);
    setActiveShotTemplateId(playbook.shotTemplateId);
    setCutKind(playbook.cutKind);
    setMedium(playbook.medium);
    setAspect(playbook.defaultAspect);
    setUse(playbook.defaultUse);
    setCameraFocalMm(playbook.focalMm);
    setLightColourK(playbook.lightColourK);
    setLightModifier(playbook.lightModifier);
    setSpaceBackground(playbook.spaceBackground);
    setSpaceSurface(playbook.spaceSurface);
    setProductName(isKo ? playbook.productNameKo : playbook.productNameEn);
    setLabelLock(isKo ? playbook.labelLockKo : playbook.labelLockEn);
    setBriefText(isKo ? playbook.briefKo : playbook.briefEn);
    setPrincipleAttachment(
      createAttachmentPreset(playbook.recommendedAttachmentMode)
    );
    setStatusMessage(
      isKo
        ? `[${playbook.targetPersonaKo} · ${playbook.titleKo}] 맞춤 브리프와 광학·비율·디자인 원칙 연결이 자동 세팅되었습니다.`
        : `Loaded [${playbook.targetPersonaEn} · ${playbook.titleEn}] brief, optics, ratio pack, and principle attachment.`
    );
  }

  function applyAestheticLine(line: BrandAestheticLine) {
    setActiveAestheticLineCode(line.code);
    setDirectionMode("project_override");
    setProjectId(line.id);
    setProjectTitle(isKo ? line.titleKo : line.titleEn);
    setLookPresetId(line.lookPresetId);
    setCameraFocalMm(line.focalMm);
    setLightModifier(line.lightModifier);
    setLightColourK(line.lightColourK);
    setSpaceBackground(line.spaceBackground);
    setSpaceSurface(line.spaceSurface);
    setProjectRulePrompt(isKo ? line.rulePromptKo : line.rulePromptEn);
    setStatusMessage(
      isKo
        ? `[${line.titleKo}] 미감 기조가 스튜디오 전체에 적용되었습니다 (${line.focalMm}mm · ${line.lightColourK}K · 로고 금고 1:1 고정 유지).`
        : `Applied [${line.titleEn}] across the studio (${line.focalMm}mm · ${line.lightColourK}K · Logo Vault locked).`
    );
  }

  function handleCutKindChange(next: ShotCutKind) {
    setCutKind(next);
    if (next === "short_film_clip" || next === "video_object_replace") {
      setMedium("short film");
      setAspect("9:16");
      setUse("reel");
      setFinalResolution("1080p");
    } else if (next === "typography_layout") {
      setMedium("typography card");
      setFinalResolution("2k");
    } else if (next === "editorial_full_body") {
      setMedium("editorial still");
      setFinalResolution("2k");
    } else {
      setMedium("product still");
      setFinalResolution("2k");
    }
  }

  function handleMediumChange(next: DeliverableMedium) {
    setMedium(next);
    if (next === "short film") {
      if (cutKind !== "short_film_clip" && cutKind !== "video_object_replace") {
        setCutKind("short_film_clip");
      }
      setFinalResolution("1080p");
    } else {
      if (cutKind === "short_film_clip" || cutKind === "video_object_replace") {
        setCutKind("reference_exact_product");
      }
      setFinalResolution("2k");
    }
  }

  async function callWorkspaceOperation(
    operation: string,
    input: Record<string, unknown>
  ) {
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, input }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setErrorMessage(
          typeof payload.message === "string" && payload.message
            ? payload.message
            : isKo
              ? "요청을 처리하지 못했습니다. 입력 항목을 확인해 주세요."
              : "Could not complete the request. Please check the fields."
        );
        return null;
      }
      return payload as {
        ok: true;
        brief: BrandBriefState;
        view: CustomerBriefView;
      };
    } catch {
      setErrorMessage(
        isKo
          ? "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
          : "Please check your connection and try again."
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  function applyProjectPreset(presetKey: ProjectDirectionPresetKey) {
    const preset = PROJECT_DIRECTION_PRESETS[presetKey];
    setDirectionMode("project_override");
    setProjectId(`project-${presetKey.replace(/_/g, "-")}`);
    setProjectTitle(preset.title);
    setLookPresetId(preset.lookPresetId);
    setCameraFocalMm(preset.cameraOverride.focalMm);
    setLightModifier(preset.lightOverride.modifier);
    setLightColourK(preset.lightOverride.colourK);
    setSpaceBackground(preset.spaceOverride.background);
    setSpaceSurface(preset.spaceOverride.surface);
    setProjectRulePrompt(preset.projectRulePrompt);
    setProjectChecklistText(preset.projectProductChecklist.join("\n"));
  }

  async function onSaveProjectOverride() {
    if (!canWrite || busy) return;
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "projectDirection.save",
          input: {
            organizationId,
            projectId: projectId.trim() || "studio-project",
            enabled: directionMode === "project_override",
            title: projectTitle.trim() || "Project Override",
            lookPresetId,
            cameraOverride: { focalMm: cameraFocalMm },
            lightOverride: { modifier: lightModifier, colourK: lightColourK },
            spaceOverride: {
              background: spaceBackground,
              surface: spaceSurface,
            },
            projectRulePrompt: projectRulePrompt.trim() || undefined,
            projectProductChecklist: projectChecklistText
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
            isolateProjectMemory,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setErrorMessage(
          typeof payload.message === "string" && payload.message
            ? payload.message
            : isKo
              ? "프로젝트 전용 연출 설정을 저장하지 못했습니다."
              : "Failed to save project direction override."
        );
        return;
      }
      setStatusMessage(
        isKo
          ? `프로젝트 전용 연출 오버라이드(${projectTitle})가 저장되었습니다. 브랜드 기본 DNA는 건드리지 않고 이 프로젝트에만 적용됩니다.`
          : `Project direction override (${projectTitle}) saved without mutating Brand Base DNA.`
      );
    } catch {
      setErrorMessage(
        isKo
          ? "네트워크 요청 중 오류가 발생했습니다."
          : "Network error while saving project direction."
      );
    } finally {
      setBusy(false);
    }
  }

  async function onPromoteProjectToBase() {
    if (!canWrite || busy) return;
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "projectDirection.promoteToBase",
          input: {
            organizationId,
            projectId: projectId.trim() || "studio-project",
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setErrorMessage(
          typeof payload.message === "string" && payload.message
            ? payload.message
            : isKo
              ? "브랜드 기본 DNA 승격은 먼저 프로젝트 연출을 저장한 뒤 오너 권한으로 실행할 수 있습니다."
              : "Save the project direction first; only brand owners can promote to Base DNA."
        );
        return;
      }
      setStatusMessage(
        isKo
          ? "이 프로젝트의 연출 규칙과 체크리스트가 조직 전체의 브랜드 기본 DNA 초안으로 승격되었습니다."
          : "Promoted this project's direction rules into the organization's Brand Base DNA."
      );
    } catch {
      setErrorMessage(
        isKo
          ? "네트워크 요청 중 오류가 발생했습니다."
          : "Network error while promoting project direction."
      );
    } finally {
      setBusy(false);
    }
  }

  async function onCompileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite || busy) return;
    const isOverride = directionMode === "project_override";
    const result = await callWorkspaceOperation("brief.compile", {
      organizationId,
      principleAttachment,
      ...(isOverride
        ? {
            projectId: projectId.trim() || "studio-project",
            projectOverride: {
              projectId: projectId.trim() || "studio-project",
              enabled: true,
              title: projectTitle.trim() || "Project Override",
              lookPresetId,
              cameraOverride: { focalMm: cameraFocalMm },
              lightOverride: { modifier: lightModifier, colourK: lightColourK },
              spaceOverride: {
                background: spaceBackground,
                surface: spaceSurface,
              },
              projectRulePrompt: projectRulePrompt.trim() || undefined,
              projectProductChecklist: projectChecklistText
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean),
              isolateProjectMemory,
            },
          }
        : {}),
      quick: {
        brief: briefText,
        cutKind,
        medium,
        aspect,
        use,
        productName: productName.trim() || undefined,
        labelLock,
        cameraFocalMm,
        lightModifier,
        lightColourK,
        spaceBackground,
        spaceSurface,
      },
    });
    if (result) {
      setBriefState(result.brief);
      setView(result.view);
      setAestheticGatePassed(false);
      setStatusMessage(
        isOverride
          ? isKo
            ? `[Brand Base DNA ⊕ ${projectTitle}] 2계층 합성 촬영 지시서 초안(Round 1)이 컴파일되었습니다.`
            : `[Brand Base DNA ⊕ ${projectTitle}] 2-tier cascaded ShotSpec draft (Round 1) compiled.`
          : isKo
            ? "촬영 지시서 초안(Round 1)이 컴파일되었습니다."
            : "ShotSpec draft (Round 1) compiled."
      );
    }
  }

  function applySingleAxisDelta(base: ShotSpec): ShotSpec {
    const val = deltaValue.trim();
    if (!val) return base;
    if (deltaAxis === "light") {
      return {
        ...base,
        light: {
          ...base.light,
          key: { ...base.light.key, modifier: val },
        },
      };
    }
    if (deltaAxis === "camera") {
      const parsedMm = Number.parseInt(val, 10);
      const nextMm =
        Number.isFinite(parsedMm) && parsedMm >= 14 && parsedMm <= 200
          ? parsedMm
          : base.camera.focal_mm === 50
            ? 85
            : 50;
      return {
        ...base,
        camera: { ...base.camera, focal_mm: nextMm },
      };
    }
    if (deltaAxis === "space") {
      return {
        ...base,
        space: { ...base.space, background: val },
      };
    }
    if (deltaAxis === "product" && base.product) {
      return {
        ...base,
        product: { ...base.product, label_lock: val },
      };
    }
    return {
      ...base,
      brief: val,
    };
  }

  async function onReviseSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite || !briefState || busy) return;
    const nextSpec = applySingleAxisDelta(briefState.spec);
    const result = await callWorkspaceOperation("brief.revise", {
      organizationId,
      current: {
        id: briefState.id,
        organizationId: briefState.organizationId,
        stage: briefState.stage,
        round: briefState.round,
        maxRounds: briefState.maxRounds,
        baselineSpec: briefState.baselineSpec,
        spec: briefState.spec,
        lastChangedAxis: briefState.lastChangedAxis,
        lockedSpecHash: briefState.lockedSpecHash,
        approvedBy: briefState.approvedBy,
        approvedAt: briefState.approvedAt,
        finalizedAt: briefState.finalizedAt,
        updatedAt: briefState.updatedAt,
      },
      nextSpec,
    });
    if (result) {
      setBriefState(result.brief);
      setView(result.view);
      setDeltaValue("");
      setStatusMessage(
        isKo
          ? `단일 축(${deltaAxis}) 수정이 반영되었습니다 (Round ${result.view.round}/${result.view.maxRounds}).`
          : `Single-axis (${deltaAxis}) delta applied (Round ${result.view.round}/${result.view.maxRounds}).`
      );
    }
  }

  async function onApprove() {
    if (!canWrite || !briefState || busy) return;
    const result = await callWorkspaceOperation("brief.approve", {
      organizationId,
      current: {
        id: briefState.id,
        organizationId: briefState.organizationId,
        stage: briefState.stage,
        round: briefState.round,
        maxRounds: briefState.maxRounds,
        baselineSpec: briefState.baselineSpec,
        spec: briefState.spec,
        lastChangedAxis: briefState.lastChangedAxis,
        lockedSpecHash: briefState.lockedSpecHash,
        approvedBy: briefState.approvedBy,
        approvedAt: briefState.approvedAt,
        finalizedAt: briefState.finalizedAt,
        updatedAt: briefState.updatedAt,
      },
      aestheticGatePassed,
      projectId:
        directionMode === "project_override" && projectId.trim()
          ? projectId.trim()
          : undefined,
      isolateProjectMemory:
        directionMode === "project_override" ? isolateProjectMemory : false,
    });
    if (result) {
      setBriefState(result.brief);
      setView(result.view);
      setStatusMessage(
        isKo
          ? "촬영 지시서가 승인 잠금되었으며 브랜드 메모리에 기록되었습니다."
          : "ShotSpec approved, locked, and recorded to brand memory."
      );
    }
  }

  async function onPromoteFinal() {
    if (!canWrite || !briefState || busy) return;
    const result = await callWorkspaceOperation("brief.promoteFinal", {
      organizationId,
      current: {
        id: briefState.id,
        organizationId: briefState.organizationId,
        stage: briefState.stage,
        round: briefState.round,
        maxRounds: briefState.maxRounds,
        baselineSpec: briefState.baselineSpec,
        spec: briefState.spec,
        lastChangedAxis: briefState.lastChangedAxis,
        lockedSpecHash: briefState.lockedSpecHash,
        approvedBy: briefState.approvedBy,
        approvedAt: briefState.approvedAt,
        finalizedAt: briefState.finalizedAt,
        updatedAt: briefState.updatedAt,
      },
      finalResolution,
    });
    if (result) {
      setBriefState(result.brief);
      setView(result.view);
      setStatusMessage(
        isKo
          ? `최종 마스터 사양(${result.view.resolution})으로 승격되었습니다.`
          : `Promoted to final master specification (${result.view.resolution}).`
      );
    }
  }

  const cutInfo = SHOT_CUT_KIND_LABELS[cutKind];

  return (
    <section
      className="bw-panel"
      data-brand-brief-studio
      data-brief-stage={view?.stage ?? "idle"}
      data-brief-round={view?.round ?? 0}
      data-brief-identity-source={
        identityConfirmed ? "confirmed" : "default_fallback"
      }
      data-brief-cut-kind={cutInfo.code}
    >
      <div className="bw-row">
        <div>
          <p className="bw-kicker">
            {isKo ? "STUDIO · 브랜드 에셋 제작 스튜디오" : "STUDIO · BRAND ASSET WORKSPACE"}
          </p>
          <h2>
            {isKo
              ? "원하는 작업을 카드에서 고르면, 브랜드 톤과 로고 규칙을 맞춰 바로 제작합니다"
              : "Pick a workflow card below to produce on-brand photos, films, and local repairs"}
          </h2>
          <p className="bw-muted">
            {isKo
              ? "복잡한 프롬프트나 카메라 수치를 직접 입력할 필요가 없습니다. 작업 카드를 고르고 한 줄로 지시하면 브랜드 기본 DNA가 자동으로 결합됩니다."
              : "No complex prompts or camera numbers needed. Select a card and write one line; your Brand Base DNA is applied automatically."}
          </p>
        </div>
        <div className="bw-row">
          <span className="bw-badge" data-brief-identity-badge>
            {identityConfirmed
              ? isKo
                ? "브랜드 아이덴티티 확정본 적용"
                : "Confirmed Brand Identity"
              : isKo
                ? "스튜디오 기본 아이덴티티 적용"
                : "Default Studio Identity"}
          </span>
          {identityHref && (
            <a className="bw-button" href={identityHref}>
              {isKo ? "브랜드 규칙 보기" : "Brand Rules"}
            </a>
          )}
        </div>
      </div>

      {/* Multi-Aesthetic Line Selector (A / B / C) + Locked Brand Logo/Standard Vault */}
      <div
        className="bw-card bw-fields"
        data-studio-aesthetic-bar
        data-active-aesthetic-line={activeAestheticLineCode}
        style={{
          margin: 0,
          padding: 18,
          background: "#FFFFFF",
          borderRadius: 22,
          border: "1px solid rgba(15, 23, 42, 0.08)",
        }}
      >
        <div className="bw-row">
          <div>
            <p className="bw-kicker">
              {isKo
                ? "STEP 1 · 브랜드 미감 기조 선택 (고정 로고·스탠다드 + 다중 미감 A / B / C)"
                : "STEP 1 · PICK YOUR BRAND AESTHETIC LINE (LOCKED LOGO VAULT + LINE A / B / C)"}
            </p>
            <h3 style={{ margin: "4px 0" }}>
              {isKo
                ? "로고(1:1 비율)·제품·금기 규칙은 자동 잠금되어 있습니다. 오늘 제작할 미감 기조 하나만 골라 주세요"
                : "Logos, products, and taboos stay locked. Pick one Aesthetic Line below for today's shoot"}
            </h3>
          </div>
          <span
            className="bw-badge"
            data-studio-locked-vault-badge
            style={{ background: "rgba(56, 117, 197, 0.12)", color: "#3063A7" }}
          >
            {isKo
              ? "🔒 고정됨: 로고 금고(mark_only) · 제품 마스터 · 절대 금기 3항목"
              : "🔒 Locked: Logo Vault (1:1) · Product Master · 3 Brand Taboos"}
          </span>
        </div>

        <div className="bw-grid-wide" style={{ gap: 12 }}>
          {aestheticLines.map((line) => {
            const selected = activeAestheticLineCode === line.code;
            return (
              <button
                key={line.id}
                type="button"
                data-studio-aesthetic-card={line.code}
                aria-pressed={selected}
                onClick={() => applyAestheticLine(line)}
                disabled={busy}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 18,
                  background: selected
                    ? "rgba(56, 117, 197, 0.06)"
                    : "#F6F7F9",
                  border: selected
                    ? "2px solid #3875C5"
                    : "1px solid rgba(15, 23, 42, 0.08)",
                  cursor: busy ? "default" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: 104,
                    borderRadius: 12,
                    backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.12) 0%, rgba(15,23,42,0.52) 100%), url(${line.previewImageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    padding: 8,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#FFFFFF",
                      background: selected ? "#3875C5" : "rgba(15,23,42,0.72)",
                      padding: "2px 8px",
                      borderRadius: 999,
                    }}
                  >
                    {selected
                      ? isKo
                        ? `✓ 기조 ${line.code} 적용 중`
                        : `✓ Line ${line.code} Active`
                      : isKo
                        ? `기조 ${line.code} (${line.sharePct}%)`
                        : `Line ${line.code} (${line.sharePct}%)`}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#F8FAFC",
                      background: "rgba(15,23,42,0.68)",
                      padding: "2px 8px",
                      borderRadius: 999,
                    }}
                  >
                    {line.focalMm}mm · {line.lightColourK}K
                  </span>
                </div>
                <div>
                  <strong style={{ fontSize: 13, color: "#0B0D12" }}>
                    {isKo ? line.titleKo : line.titleEn}
                  </strong>
                  <p
                    className="bw-muted"
                    style={{ margin: "3px 0 0", fontSize: 12 }}
                  >
                    {isKo ? line.subtitleKo : line.subtitleEn}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 2 · Design Principle Attachment Selector (+ Elements / Brand DNA On vs Off) */}
      <div
        className="bw-card bw-fields"
        data-design-principle-attachment
        data-attachment-mode={principleAttachment.mode}
        style={{
          margin: 0,
          padding: 18,
          background: "#FFFFFF",
          borderRadius: 22,
          border:
            principleAttachment.mode === "unbound_free"
              ? "1.5px dashed rgba(15, 23, 42, 0.25)"
              : "1px solid rgba(56, 117, 197, 0.22)",
        }}
      >
        <div className="bw-row">
          <div>
            <p className="bw-kicker">
              {isKo
                ? "STEP 2 · 디자인 원칙 연결 선택 (+ Elements · Brand DNA Attachment Control)"
                : "STEP 2 · DESIGN PRINCIPLE ATTACHMENT (+ Elements · Attach vs Free Exploration)"}
            </p>
            <h3 style={{ margin: "4px 0" }}>
              {isKo
                ? "이미지를 만들 때 정해진 브랜드 디자인 원칙을 연결(Attach)할지, 제약 없이 자유 탐색할지 선택하세요"
                : "Choose whether to attach your Brand Design Principles or detach them for free exploration"}
            </h3>
            <p className="bw-muted" style={{ margin: 0, fontSize: 12.5 }}>
              {isKo
                ? "상세페이지·정규 캠페인 컷은 [원칙 전체 연결]로 일관성을 지키고, 시즌 콜라보·신규 컬러 테스트는 [선택적 연결]이나 [원칙 미적용 · 자유 탐색]으로 기존 팔레트·미감 잠금을 해제할 수 있습니다."
                : "Keep [Full Brand DNA Attach] for consistent PDP & campaign cuts, or switch to [Custom Partial] / [Unbound Free Exploration] when testing bold new seasonal concepts."}
            </p>
          </div>
          <span
            className="bw-badge"
            data-attachment-summary-badge
            style={{
              background:
                principleAttachment.mode === "unbound_free"
                  ? "#F6F7F9"
                  : "rgba(56, 117, 197, 0.12)",
              color:
                principleAttachment.mode === "unbound_free"
                  ? "#0B0D12"
                  : "#3063A7",
            }}
          >
            {isKo
              ? `연결됨 ${attachmentSummary.attachedKeys.length}/${DESIGN_PRINCIPLE_KEYS.length} · 자유 해제 ${attachmentSummary.detachedKeys.length}`
              : `Attached ${attachmentSummary.attachedKeys.length}/${DESIGN_PRINCIPLE_KEYS.length} · Unbound ${attachmentSummary.detachedKeys.length}`}
          </span>
        </div>

        {/* 3-Mode Attachment Switch */}
        <div
          className="bw-row"
          data-attachment-mode-bar
          style={{ gap: 8, flexWrap: "wrap" }}
        >
          <button
            type="button"
            className={
              principleAttachment.mode === "full_attach"
                ? "bw-button bw-primary"
                : "bw-button"
            }
            data-attachment-mode-btn="full_attach"
            aria-pressed={principleAttachment.mode === "full_attach"}
            onClick={() => handleSelectAttachmentMode("full_attach")}
            disabled={busy}
          >
            {isKo
              ? "🔗 디자인 원칙 전체 연결 (Full Brand DNA Attach · 권장)"
              : "🔗 Attach All Brand DNA (Recommended)"}
          </button>
          <button
            type="button"
            className={
              principleAttachment.mode === "custom_partial"
                ? "bw-button bw-primary"
                : "bw-button"
            }
            data-attachment-mode-btn="custom_partial"
            aria-pressed={principleAttachment.mode === "custom_partial"}
            onClick={() => handleSelectAttachmentMode("custom_partial")}
            disabled={busy}
          >
            {isKo
              ? "🎛️ 원칙 개별 선택 연결 (로고만 고정 · 시즌 컬러 자유)"
              : "🎛️ Custom Partial Attach (Lock Logo · Free Palette)"}
          </button>
          <button
            type="button"
            className={
              principleAttachment.mode === "unbound_free"
                ? "bw-button bw-primary"
                : "bw-button"
            }
            data-attachment-mode-btn="unbound_free"
            aria-pressed={principleAttachment.mode === "unbound_free"}
            onClick={() => handleSelectAttachmentMode("unbound_free")}
            disabled={busy}
          >
            {isKo
              ? "🔓 원칙 미적용 · 자유 탐색 (Unbound Free Exploration)"
              : "🔓 Detach Principles · Free Exploration"}
          </button>
        </div>

        {/* 6 Granular Principle Toggle Chips */}
        <div
          className="bw-grid-wide"
          data-attachment-chip-grid
          style={{ gap: 10 }}
        >
          {DESIGN_PRINCIPLE_CHIPS.map((chip) => {
            const attached = principleAttachment[chip.key];
            return (
              <button
                key={chip.key}
                type="button"
                data-principle-chip={chip.key}
                data-principle-attached={attached}
                aria-pressed={attached}
                onClick={() => handleTogglePrincipleChip(chip.key)}
                disabled={busy}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 14,
                  background: attached
                    ? "rgba(56, 117, 197, 0.06)"
                    : "#F6F7F9",
                  border: attached
                    ? "1.5px solid #3875C5"
                    : "1px dashed rgba(15, 23, 42, 0.18)",
                  cursor: busy ? "default" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div className="bw-row">
                  <strong
                    style={{
                      fontSize: 12.5,
                      color: attached ? "#3063A7" : "#475569",
                    }}
                  >
                    {attached ? "✓ " : "○ "}
                    {isKo ? chip.labelKo : chip.labelEn}
                  </strong>
                  <span
                    className="bw-badge"
                    style={{
                      fontSize: 10.5,
                      background: attached ? "#3875C5" : "#E2E8F0",
                      color: attached ? "#FFFFFF" : "#475569",
                    }}
                  >
                    {attached
                      ? isKo
                        ? "Attach"
                        : "Attached"
                      : isKo
                        ? "해제됨"
                        : "Detached"}
                  </span>
                </div>
                <small className="bw-muted" style={{ fontSize: 11.5 }}>
                  {attached
                    ? isKo
                      ? chip.attachedDescKo
                      : chip.attachedDescEn
                    : isKo
                      ? chip.detachedDescKo
                      : chip.detachedDescEn}
                </small>
              </button>
            );
          })}
        </div>

        <small className="bw-muted" data-attachment-directive-preview>
          {isKo
            ? attachmentSummary.directiveSuffixKo
            : attachmentSummary.directiveSuffixEn}
        </small>
      </div>

      {/* STEP 3 · Fashion · Beauty · F&B Marketer / PM / Director Tailored Playbooks & Pomelli 4-Shot Templates */}
      <div
        className="bw-card bw-fields"
        data-vertical-marketer-hub
        data-active-vertical={activeVertical}
        style={{
          margin: 0,
          padding: 18,
          background: "#FFFFFF",
          borderRadius: 22,
          border: "1px solid rgba(15, 23, 42, 0.08)",
        }}
      >
        <div className="bw-row">
          <div>
            <p className="bw-kicker">
              {isKo
                ? "STEP 3 · 패션 · 뷰티 · F&B 마케터·PM·디렉터 맞춤 화보 템플릿 & 플레이북"
                : "STEP 3 · FASHION · BEAUTY · F&B MARKETER, PM & DIRECTOR PLAYBOOKS"}
            </p>
            <h3 style={{ margin: "4px 0" }}>
              {isKo
                ? "화보 촬영 4대 구도(Studio · 원료/제형 · 착장/사용 · 공간)와 업종별 실무 플레이북을 원클릭으로 불러오세요"
                : "Pick a 4-Shot Photoshoot Template (Studio / Ingredients / In-Use / Contextual) or a Vertical Marketer Playbook"}
            </h3>
          </div>

          {/* Industry Vertical Selector Tabs */}
          <div
            className="bw-row"
            role="tablist"
            data-vertical-tabs
            style={{
              background: "#F6F7F9",
              padding: 4,
              borderRadius: 999,
              gap: 4,
            }}
          >
            {(
              [
                {
                  id: "fashion_apparel" as const,
                  ko: "패션 · 어패럴 (MD/디렉터)",
                  en: "Fashion & Apparel",
                },
                {
                  id: "beauty_skincare" as const,
                  ko: "뷰티 · 스킨케어 (BM/마케터)",
                  en: "Beauty & Skincare",
                },
                {
                  id: "fnb_hospitality" as const,
                  ko: "F&B · 다이닝 (브랜드 PM)",
                  en: "F&B & Hospitality",
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeVertical === tab.id}
                data-vertical-tab={tab.id}
                onClick={() => {
                  setActiveVertical(tab.id);
                  const first = listPlaybooksForVertical(tab.id)[0];
                  if (first) handleSelectVerticalPlaybook(first);
                }}
                className={
                  activeVertical === tab.id
                    ? "bw-button bw-primary"
                    : "bw-button"
                }
                style={{ borderRadius: 999, padding: "6px 14px" }}
              >
                {isKo ? tab.ko : tab.en}
              </button>
            ))}
          </div>
        </div>

        {/* Part A: Pomelli 4-Shot Product Photoshoot Template Matrix (Studio / Ingredients / In-Use / Contextual) */}
        <div
          className="bw-grid-wide"
          data-pomelli-shot-templates
          style={{ gap: 10 }}
        >
          {POMELLI_SHOT_TEMPLATES.map((tpl) => {
            const selected = activeShotTemplateId === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                data-pomelli-shot-template={tpl.id}
                aria-pressed={selected}
                onClick={() => handleSelectPomelliShotTemplate(tpl)}
                disabled={busy}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 16,
                  background: selected
                    ? "rgba(56, 117, 197, 0.06)"
                    : "#F6F7F9",
                  border: selected
                    ? "2px solid #3875C5"
                    : "1px solid rgba(15, 23, 42, 0.08)",
                  cursor: busy ? "default" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div className="bw-row">
                  <span
                    className="bw-badge"
                    style={{
                      fontSize: 10.5,
                      background: selected ? "#3875C5" : "#FFFFFF",
                      color: selected ? "#FFFFFF" : "#3063A7",
                    }}
                  >
                    {isKo ? tpl.badgeKo : tpl.badgeEn}
                  </span>
                  <small className="bw-muted">
                    {tpl.focalMm}mm · {tpl.defaultAspect}
                  </small>
                </div>
                <strong style={{ fontSize: 13, color: "#0B0D12" }}>
                  {isKo ? tpl.titleKo : tpl.titleEn}
                </strong>
                <small className="bw-muted" style={{ fontSize: 11.5 }}>
                  {isKo ? tpl.subtitleKo : tpl.subtitleEn}
                </small>
              </button>
            );
          })}
        </div>

        {/* Part B: 3 Tailored Marketer / PM / Creative Director Playbook Cards for the Active Vertical */}
        <div
          className="bw-grid-wide"
          data-vertical-playbook-grid
          style={{ gap: 12 }}
        >
          {activeVerticalPlaybooks.map((pb) => {
            const isSelected = activePlaybookId === pb.id;
            return (
              <div
                key={pb.id}
                className="bw-card bw-fields"
                data-vertical-playbook-card={pb.id}
                style={{
                  margin: 0,
                  padding: 14,
                  borderRadius: 18,
                  background: isSelected
                    ? "rgba(56, 117, 197, 0.05)"
                    : "#F6F7F9",
                  border: isSelected
                    ? "2px solid #3875C5"
                    : "1px solid rgba(15, 23, 42, 0.08)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div className="bw-fields" style={{ margin: 0, gap: 8 }}>
                  <div
                    style={{
                      height: 112,
                      borderRadius: 12,
                      backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.14) 0%, rgba(15,23,42,0.58) 100%), url(${pb.previewImageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      padding: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#FFFFFF",
                        background: "#3875C5",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {isKo ? pb.targetPersonaKo : pb.targetPersonaEn}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#F8FAFC",
                        background: "rgba(15, 23, 42, 0.72)",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {isKo
                        ? pb.startupPatternBadgeKo
                        : pb.startupPatternBadgeEn}
                    </span>
                  </div>

                  <div>
                    <strong style={{ fontSize: 14, color: "#0B0D12" }}>
                      {isKo ? pb.titleKo : pb.titleEn}
                    </strong>
                    <p
                      className="bw-muted"
                      style={{ margin: "4px 0 0", fontSize: 12 }}
                    >
                      {isKo ? pb.painSolvedKo : pb.painSolvedEn}
                    </p>
                  </div>
                </div>

                <div className="bw-fields" style={{ margin: 0, gap: 8 }}>
                  {/* + Sizes Multi-Ratio Quick Selector Pills */}
                  <div
                    className="bw-row"
                    style={{ gap: 6, flexWrap: "wrap" }}
                  >
                    <small className="bw-muted" style={{ fontSize: 11 }}>
                      {isKo ? "+ 규격(Sizes):" : "+ Sizes:"}
                    </small>
                    {pb.recommendedRatios.map((r) => (
                      <button
                        key={`${pb.id}-${r}`}
                        type="button"
                        onClick={() => {
                          handleSelectVerticalPlaybook(pb);
                          setAspect(r);
                        }}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          border:
                            isSelected && aspect === r
                              ? "1.5px solid #3875C5"
                              : "1px solid rgba(15,23,42,0.14)",
                          background:
                            isSelected && aspect === r
                              ? "rgba(56,117,197,0.14)"
                              : "#FFFFFF",
                          color: "#0B0D12",
                          cursor: "pointer",
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={
                      isSelected ? "bw-button bw-primary" : "bw-button"
                    }
                    data-apply-vertical-playbook={pb.id}
                    onClick={() => handleSelectVerticalPlaybook(pb)}
                    disabled={busy}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    {isSelected
                      ? isKo
                        ? "✓ 현재 브리프에 적용됨 (다시 채우기)"
                        : "✓ Applied to Studio Brief"
                      : isKo
                        ? "이 실무 플레이북으로 브리프·광학 세팅 채우기"
                        : "Load Playbook into Studio Brief"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <BrandStudioTutorial
        locale={locale}
        activeMode={studioFocusMode}
        onSelectMode={setStudioFocusMode}
      />

      <details className="bw-service-disclosure">
        <summary>
          {isKo
            ? "고급 연출 설정 · 프로젝트별 광학 오버라이드 & 수동 촬영 지시서 열기"
            : "Advanced Direction · Project Optics Override & Manual ShotSpec Compiler"}
        </summary>
        <div className="bw-fields" style={{ marginTop: 14 }}>
      <div
        className="bw-panel"
        data-project-direction-panel
        data-direction-mode={directionMode}
      >
        <div className="bw-row">
          <div>
            <p className="bw-kicker">
              {isKo
                ? "2-TIER DIRECTION CASCADE · 브랜드 기본 DNA ⊕ 개별 프로젝트 연출"
                : "2-TIER DIRECTION CASCADE · BRAND BASE DNA ⊕ PROJECT OVERRIDE"}
            </p>
            <h3>
              {isKo
                ? "연출 로직 선택: 브랜드 공통 기준선 상속 vs 개별 프로젝트 전용 오버라이드"
                : "Direction Logic: Inherit Brand Base DNA vs Project-Specific Override"}
            </h3>
            <p className="bw-muted">
              {isKo
                ? "평소에는 브랜드 온보딩에서 확정한 기본 DNA를 그대로 상속하고, 시즌 캠페인·야외 촬영·콜라보처럼 다른 무드와 광학 로직이 필요한 프로젝트만 선택적으로 덮어씁니다."
                : "Inherit your confirmed Brand Base DNA by default, or selectively override optics, lighting, space, and look for a specific campaign project."}
            </p>
          </div>
          <div className="bw-row">
            <button
              type="button"
              className={
                directionMode === "base_inherited"
                  ? "bw-button bw-primary"
                  : "bw-button"
              }
              data-direction-mode-toggle="base_inherited"
              onClick={() => setDirectionMode("base_inherited")}
              disabled={busy}
            >
              {isKo
                ? "① 브랜드 기본 DNA 상속"
                : "1. Inherit Brand Base DNA"}
            </button>
            <button
              type="button"
              className={
                directionMode === "project_override"
                  ? "bw-button bw-primary"
                  : "bw-button"
              }
              data-direction-mode-toggle="project_override"
              onClick={() => setDirectionMode("project_override")}
              disabled={busy}
            >
              {isKo
                ? "② 개별 프로젝트 전용 오버라이드"
                : "2. Project-Specific Override"}
            </button>
          </div>
        </div>

        {directionMode === "project_override" && (
          <div className="bw-fields" data-project-override-editor>
            <div className="bw-row">
              <small className="bw-muted">
                {isKo
                  ? "프로젝트 연출 빠른 템플릿:"
                  : "Quick Project Direction Presets:"}
              </small>
              <button
                type="button"
                className="bw-button"
                data-project-preset="outdoor_golden_hour"
                onClick={() => applyProjectPreset("outdoor_golden_hour")}
                disabled={!canWrite || busy}
              >
                {isKo
                  ? "시즌 야외 골든아워 (35mm · 3900K)"
                  : "Outdoor Golden Hour (35mm · 3900K)"}
              </button>
              <button
                type="button"
                className="bw-button"
                data-project-preset="night_neon_capsule"
                onClick={() => applyProjectPreset("night_neon_capsule")}
                disabled={!canWrite || busy}
              >
                {isKo
                  ? "나이트 하이콘트라스트 (28mm · 6200K)"
                  : "Night High-Contrast (28mm · 6200K)"}
              </button>
              <button
                type="button"
                className="bw-button"
                data-project-preset="crisp_studio_drop"
                onClick={() => applyProjectPreset("crisp_studio_drop")}
                disabled={!canWrite || busy}
              >
                {isKo
                  ? "신제품 매크로 스튜디오 (85mm · 5500K)"
                  : "Macro Studio Drop (85mm · 5500K)"}
              </button>
            </div>

            <div className="bw-grid-wide">
              <label>
                {isKo ? "프로젝트 식별키 (Scope ID)" : "Project Scope Key"}
                <input
                  name="projectId"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  maxLength={80}
                  disabled={!canWrite || busy}
                />
              </label>
              <label>
                {isKo ? "프로젝트 연출 이름" : "Project Direction Title"}
                <input
                  name="projectTitle"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  maxLength={120}
                  disabled={!canWrite || busy}
                />
              </label>
              <label>
                {isKo
                  ? "이 프로젝트 전용 컬러 룩 (Look Override)"
                  : "Project Look Preset Override"}
                <select
                  name="lookPresetId"
                  value={lookPresetId}
                  onChange={(e) =>
                    setLookPresetId(e.target.value as BrandLookPresetId)
                  }
                  disabled={!canWrite || busy}
                >
                  {BRAND_LOOK_PRESET_IDS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="bw-grid-wide">
              <label>
                {isKo
                  ? "이 프로젝트 전용 추가 연출 규칙 (Prompt Rule Override)"
                  : "Project-Specific Direction Rule"}
                <input
                  name="projectRulePrompt"
                  value={projectRulePrompt}
                  onChange={(e) => setProjectRulePrompt(e.target.value)}
                  maxLength={300}
                  disabled={!canWrite || busy}
                />
              </label>
              <label>
                {isKo
                  ? "조명 색온도 오버라이드 (K)"
                  : "Lighting Colour Temp Override (K)"}
                <input
                  type="number"
                  min={2500}
                  max={9000}
                  name="lightColourK"
                  value={lightColourK}
                  onChange={(e) =>
                    setLightColourK(Number(e.target.value) || 5400)
                  }
                  disabled={!canWrite || busy}
                />
              </label>
            </div>

            <label>
              {isKo
                ? "이 프로젝트 전용 추가 제품 체크리스트 (브랜드 기본 체크리스트에 병합됨)"
                : "Project-Specific Product Checklist (merged with Base DNA)"}
              <input
                name="projectChecklistText"
                value={projectChecklistText}
                onChange={(e) => setProjectChecklistText(e.target.value)}
                maxLength={300}
                disabled={!canWrite || busy}
              />
            </label>

            <label className="bw-check">
              <input
                type="checkbox"
                checked={isolateProjectMemory}
                onChange={(e) => setIsolateProjectMemory(e.target.checked)}
                disabled={!canWrite || busy}
              />
              <span>
                {isKo
                  ? "프로젝트 메모리 격리 (이 프로젝트에서 실험·승인한 컷이 다른 프로젝트의 기본 연출을 오염시키지 않게 분리)"
                  : "Isolate project memory (keep experimental cuts in this project separate from other projects)"}
              </span>
            </label>

            <div className="bw-note" data-direction-cascade-summary>
              <div className="bw-grid-wide">
                <div>
                  <strong>
                    {isKo
                      ? "🔒 Brand Base DNA 고정 (이 프로젝트에서도 절대 유지)"
                      : "🔒 Locked from Brand Base DNA (Immutable)"}
                  </strong>
                  <p className="bw-muted">
                    {isKo
                      ? "사전 동의 인물 전용 · 브랜드 로고 원형/여백 고정 · 브랜드 절대 금기 3항목 · 피부 웜톤 보호"
                      : "Consented talent only · Logo geometry & clearspace · 3 Base Brand Taboos · Skin protection"}
                  </p>
                </div>
                <div>
                  <strong>
                    {isKo
                      ? `⚡ ${projectTitle} 전용 오버라이드 적용 중`
                      : `⚡ Overridden by ${projectTitle}`}
                  </strong>
                  <p className="bw-muted">
                    {isKo
                      ? `렌즈 ${cameraFocalMm}mm · 조명 ${lightColourK}K (${lightModifier}) · 룩 ${lookPresetId} · ${isolateProjectMemory ? "프로젝트 메모리 단독 격리" : "조직 공통 메모리 공유"}`
                      : `Lens ${cameraFocalMm}mm · Light ${lightColourK}K · Look ${lookPresetId} · ${isolateProjectMemory ? "Isolated project memory" : "Shared memory"}`}
                  </p>
                </div>
              </div>
            </div>

            {canWrite && (
              <div className="bw-row">
                <button
                  type="button"
                  className="bw-button"
                  data-project-direction-save
                  onClick={() => void onSaveProjectOverride()}
                  disabled={busy}
                >
                  {isKo
                    ? "이 프로젝트 전용 연출 오버라이드 저장"
                    : "Save Project Direction Override"}
                </button>
                <button
                  type="button"
                  className="bw-button"
                  data-project-direction-promote
                  onClick={() => void onPromoteProjectToBase()}
                  disabled={busy}
                >
                  {isKo
                    ? "성공한 프로젝트 규칙을 브랜드 Base DNA로 승격"
                    : "Promote Project Rules to Brand Base DNA"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onCompileSubmit} className="bw-fields" data-brief-compile-form>
        <label>
          {isKo ? "한 줄 연출 브리프" : "One-line Direction Brief"}
          <input
            name="brief"
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            maxLength={500}
            required
            disabled={!canWrite || busy}
          />
        </label>

        <div className="bw-grid-wide">
          <label>
            {isKo ? "컷 종류 (역할별 문법)" : "Cut Kind (Role Grammar)"}
            <select
              name="cutKind"
              value={cutInfo.code}
              onChange={(e) =>
                handleCutKindChange(
                  resolveInternalCutKind(e.target.value as PublicCutKindCode)
                )
              }
              disabled={!canWrite || busy}
            >
              {SHOT_CUT_KINDS.map((k) => (
                <option
                  key={SHOT_CUT_KIND_LABELS[k].code}
                  value={SHOT_CUT_KIND_LABELS[k].code}
                >
                  {isKo ? SHOT_CUT_KIND_LABELS[k].ko : SHOT_CUT_KIND_LABELS[k].en}
                </option>
              ))}
            </select>
            <small className="bw-muted">
              {isKo ? cutInfo.roleKo : cutInfo.roleEn}
            </small>
          </label>

          <label>
            {isKo ? "매체" : "Medium"}
            <select
              name="medium"
              value={medium}
              onChange={(e) =>
                handleMediumChange(e.target.value as DeliverableMedium)
              }
              disabled={!canWrite || busy}
            >
              {DELIVERABLE_MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label>
            {isKo ? "화면 비율" : "Aspect Ratio"}
            <select
              name="aspect"
              value={aspect}
              onChange={(e) => setAspect(e.target.value as ShotAspect)}
              disabled={!canWrite || busy}
            >
              {SHOT_ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label>
            {isKo ? "납품 용도" : "Deliverable Use"}
            <select
              name="use"
              value={use}
              onChange={(e) => setUse(e.target.value as DeliverableUse)}
              disabled={!canWrite || busy}
            >
              {DELIVERABLE_USES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="bw-grid-wide">
          <label>
            {isKo ? "제품·오브젝트명 (선택)" : "Product / Object Name (Optional)"}
            <input
              name="productName"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              maxLength={160}
              placeholder={
                isKo ? "예: 세럼 보틀 50ml" : "e.g. Serum Bottle 50ml"
              }
              disabled={!canWrite || busy}
            />
          </label>
          <label>
            {isKo ? "렌즈 초점거리 (mm)" : "Lens Focal Length (mm)"}
            <input
              name="cameraFocalMm"
              type="number"
              min={14}
              max={200}
              value={cameraFocalMm}
              onChange={(e) => setCameraFocalMm(Number(e.target.value) || 50)}
              disabled={!canWrite || busy}
            />
          </label>
          <label>
            {isKo ? "주광원 모디파이어" : "Key Light Modifier"}
            <input
              name="lightModifier"
              value={lightModifier}
              onChange={(e) => setLightModifier(e.target.value)}
              maxLength={120}
              disabled={!canWrite || busy}
            />
          </label>
        </div>

        <div className="bw-grid-wide">
          <label>
            {isKo ? "배경 공간" : "Background Space"}
            <input
              name="spaceBackground"
              value={spaceBackground}
              onChange={(e) => setSpaceBackground(e.target.value)}
              maxLength={200}
              disabled={!canWrite || busy}
            />
          </label>
          <label>
            {isKo ? "바닥·테이블 재질" : "Surface Material"}
            <input
              name="spaceSurface"
              value={spaceSurface}
              onChange={(e) => setSpaceSurface(e.target.value)}
              maxLength={160}
              disabled={!canWrite || busy}
            />
          </label>
        </div>

        <label>
          {isKo
            ? "제품 라벨·구조 보존 기준"
            : "Product Label & Geometry Lock"}
          <input
            name="labelLock"
            value={labelLock}
            onChange={(e) => setLabelLock(e.target.value)}
            maxLength={240}
            disabled={!canWrite || busy}
          />
        </label>

        {canWrite && (
          <div className="bw-row">
            <button
              type="submit"
              className="bw-button bw-primary"
              disabled={busy}
              data-brief-compile-submit
            >
              {busy
                ? isKo
                  ? "컴파일 중…"
                  : "Compiling…"
                : isKo
                  ? "촬영 지시서 컴파일 (초안 Round 1)"
                  : "Compile ShotSpec (Draft Round 1)"}
            </button>
          </div>
        )}
      </form>
        </div>
      </details>

      {errorMessage && (
        <p role="alert" className="bw-error" data-brief-error>
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p role="status" className="bw-note" data-brief-status>
          {statusMessage}
        </p>
      )}

      {view && (
        <div className="bw-fields" data-brief-preview>
          <div className="bw-row">
            <div>
              <strong>
                {isKo ? view.cutKindLabel.ko : view.cutKindLabel.en} ·{" "}
                {isKo ? view.grammarLabel.ko : view.grammarLabel.en}
              </strong>
              <p className="bw-muted">
                {isKo
                  ? `단계: ${view.stage.toUpperCase()} · 라운드 ${view.round}/${view.maxRounds} · 해상도 ${view.resolution}`
                  : `Stage: ${view.stage.toUpperCase()} · Round ${view.round}/${view.maxRounds} · Resolution ${view.resolution}`}
                {view.lastChangedAxis
                  ? isKo
                    ? ` · 최근 변경 축: ${view.lastChangedAxis}`
                    : ` · Last delta axis: ${view.lastChangedAxis}`
                  : ""}
              </p>
            </div>
            <span className="bw-badge" data-brief-lint-badge>
              {view.lint.filter((l) => l.severity === "error").length === 0
                ? isKo
                  ? "규칙 검사 통과"
                  : "Hardline Lint Passed"
                : isKo
                  ? `규칙 오류 ${view.lint.filter((l) => l.severity === "error").length}건`
                  : `${view.lint.filter((l) => l.severity === "error").length} Lint Error(s)`}
            </span>
          </div>

          {view.directionCascade && (
            <div
              className="bw-row"
              data-brief-cascade-badge
              data-cascade-mode={view.directionCascade.mode}
            >
              <span className="bw-badge">
                {view.directionCascade.mode === "project_override"
                  ? isKo
                    ? `연출 계층: Base DNA ⊕ ${view.directionCascade.projectTitle ?? view.directionCascade.projectId}`
                    : `Cascade: Base DNA ⊕ ${view.directionCascade.projectTitle ?? view.directionCascade.projectId}`
                  : isKo
                    ? "연출 계층: Brand Base DNA 100% 상속"
                    : "Cascade: 100% Brand Base DNA"}
              </span>
              {view.directionCascade.overriddenByProject.length > 0 && (
                <small className="bw-muted">
                  {view.directionCascade.overriddenByProject.join(" · ")}
                </small>
              )}
            </div>
          )}

          {view.principleAttachment && (
            <div
              className="bw-row"
              data-brief-principle-attachment-badge
              data-principle-attachment-mode={view.principleAttachment.mode}
            >
              <span className="bw-badge">
                {view.principleAttachment.mode === "unbound_free"
                  ? isKo
                    ? "디자인 원칙: 미적용 · 자유 탐색 (Unbound)"
                    : "Design Principles: Unbound Free Exploration"
                  : view.principleAttachment.mode === "custom_partial"
                    ? isKo
                      ? `디자인 원칙: 선택 연결 (${view.principleAttachment.attachedKeys.length}개 고정 · ${view.principleAttachment.detachedKeys.length}개 자유)`
                      : `Design Principles: Partial Attach (${view.principleAttachment.attachedKeys.length} locked)`
                    : isKo
                      ? "디자인 원칙: Brand DNA 전체 연결됨 (Full Attach)"
                      : "Design Principles: Full Brand DNA Attached"}
              </span>
            </div>
          )}

          <label>
            {isKo ? "컴파일된 촬영 지시문" : "Compiled Direction Prompt"}
            <textarea
              readOnly
              rows={5}
              value={view.prompt}
              data-brief-compiled-prompt
            />
          </label>

          {view.lint.length > 0 && (
            <ul className="bw-list" data-brief-lint-list>
              {view.lint.map((issue, idx) => (
                <li key={`${issue.rule}-${idx}`} className="bw-row">
                  <span>
                    <strong>[{issue.severity.toUpperCase()}]</strong>{" "}
                    {issue.text}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canWrite && view.stage === "draft" && (
            <div className="bw-grid-wide">
              <form
                onSubmit={onReviseSubmit}
                className="bw-fields"
                data-brief-revise-form
              >
                <h3>
                  {isKo
                    ? `단일 축 델타 수정 (Round ${view.round}/${view.maxRounds})`
                    : `Single-Axis Delta Revision (Round ${view.round}/${view.maxRounds})`}
                </h3>
                <p className="bw-muted">
                  {isKo
                    ? "베이스라인 고정 규칙에 따라 한 번에 하나의 연출 축만 수정합니다."
                    : "Baseline+delta rule: adjust exactly one direction axis per round."}
                </p>
                <label>
                  {isKo ? "수정할 축 선택" : "Axis to Adjust"}
                  <select
                    value={deltaAxis}
                    onChange={(e) =>
                      setDeltaAxis(e.target.value as BriefDeltaAxis)
                    }
                    disabled={busy || view.round >= view.maxRounds}
                  >
                    {EDITABLE_DELTA_AXES.map((item) => (
                      <option key={item.axis} value={item.axis}>
                        {isKo ? item.ko : item.en}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {isKo ? "변경 값" : "New Axis Value"}
                  <input
                    value={deltaValue}
                    onChange={(e) => setDeltaValue(e.target.value)}
                    placeholder={
                      isKo
                        ? "예: 85 (초점거리) 또는 soft overhead lantern"
                        : "e.g. 85 (focal mm) or soft overhead lantern"
                    }
                    required
                    disabled={busy || view.round >= view.maxRounds}
                  />
                </label>
                <button
                  type="submit"
                  className="bw-button"
                  disabled={busy || view.round >= view.maxRounds}
                  data-brief-revise-submit
                >
                  {isKo ? "1개 축 수정 반영" : "Apply 1-Axis Revision"}
                </button>
              </form>

              <div className="bw-fields" data-brief-approve-box>
                <h3>
                  {isKo
                    ? "미학 검수 및 지시서 잠금"
                    : "Aesthetic Gate & Spec Lock"}
                </h3>
                <p className="bw-muted">
                  {isKo
                    ? "초안 구도와 브랜드 색 대역·제품 체크리스트를 확인한 뒤 승인하면 지시서 해시가 잠깁니다."
                    : "Confirm composition, colour band, and product checklist to lock the ShotSpec hash."}
                </p>
                <label className="bw-check">
                  <input
                    type="checkbox"
                    checked={aestheticGatePassed}
                    onChange={(e) => setAestheticGatePassed(e.target.checked)}
                    disabled={busy}
                    data-brief-aesthetic-checkbox
                  />
                  {isKo
                    ? "구도·색 대역·제품 체크리스트 검수를 마쳤습니다"
                    : "Composition, colour band, and product checklist verified"}
                </label>
                <button
                  type="button"
                  className="bw-button bw-primary"
                  onClick={() => void onApprove()}
                  disabled={busy || !aestheticGatePassed}
                  data-brief-approve-submit
                >
                  {isKo ? "촬영 지시서 승인 및 잠금" : "Approve & Lock ShotSpec"}
                </button>
              </div>
            </div>
          )}

          {canWrite && view.stage === "approved" && (
            <div className="bw-fields" data-brief-promote-box>
              <h3>
                {isKo
                  ? "최종 마스터 사양 승격"
                  : "Promote to Final Master Specification"}
              </h3>
              <p className="bw-muted">
                {isKo
                  ? "승인 잠금된 지시서 해시를 검증하고 고해상도 마스터 사양으로 승격합니다."
                  : "Verifies the locked ShotSpec hash and upgrades to master resolution."}
              </p>
              <div className="bw-row">
                <label>
                  {isKo ? "마스터 해상도" : "Master Resolution"}
                  <select
                    value={finalResolution}
                    onChange={(e) =>
                      setFinalResolution(
                        e.target.value as "720p" | "1080p" | "2k" | "4k"
                      )
                    }
                    disabled={busy}
                  >
                    {view.deliverable.medium === "short film" ? (
                      <>
                        <option value="1080p">1080p Master (High Bitrate)</option>
                        <option value="720p">720p Master (High Bitrate)</option>
                      </>
                    ) : (
                      <>
                        <option value="2k">2K Editorial Still</option>
                        <option value="4k">4K Master Print / Hero</option>
                      </>
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  className="bw-button bw-primary"
                  onClick={() => void onPromoteFinal()}
                  disabled={busy}
                  data-brief-promote-submit
                >
                  {isKo ? "최종 마스터로 승격" : "Promote to Final Master"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <hr className="bw-divider" />

      {(studioFocusMode === "all" || studioFocusMode === "spatial_brief") && (
        <>
          <BrandSpatialStagePanel
            organizationId={organizationId}
            projectId={
              directionMode === "project_override" && projectId.trim()
                ? projectId.trim()
                : undefined
            }
            locale={locale}
            canWrite={canWrite}
            onCompiledBrief={(compiledView) => setView(compiledView)}
          />
          <hr className="bw-divider" />
        </>
      )}

      {(studioFocusMode === "all" ||
        studioFocusMode === "video_reverse" ||
        studioFocusMode === "sound_studio") && (
        <>
          <BrandVideoReversePanel
            organizationId={organizationId}
            projectId={
              directionMode === "project_override" && projectId.trim()
                ? projectId.trim()
                : undefined
            }
            locale={locale}
            canWrite={canWrite}
            externalRevealSec={externalMusicRevealSec}
            onCompiledBrief={(compiledView) => setView(compiledView)}
          />
          <hr className="bw-divider" />
        </>
      )}

      {(studioFocusMode === "all" || studioFocusMode === "micro_roi") && (
        <>
          <BrandMicroRoiPanel
            organizationId={organizationId}
            projectId={
              directionMode === "project_override" && projectId.trim()
                ? projectId.trim()
                : undefined
            }
            locale={locale}
            canWrite={canWrite}
            externalHandoff={externalMicroRoiHandoff}
          />
          <hr className="bw-divider" />
        </>
      )}

      {/* Customer Utility: Optical Identity Lock™ v2 & Bust-Up Proportion Guard */}
      <div className="bw-card bw-fields" data-studio-optical-identity-panel>
        <div className="bw-row">
          <div>
            <p className="bw-kicker">
              {isKo
                ? "OPTICAL IDENTITY LOCK™ V2 · 모델 얼굴 원형 100% 보존 & 바스트업 8등신 비율 가드"
                : "OPTICAL IDENTITY LOCK™ V2 · ZERO-DISTORTION FACE & BUST-UP PROPORTION GUARD"}
            </p>
            <h3>{studioOpticalReport.customerTitle}</h3>
            <p className="bw-muted">{studioOpticalReport.customerSummary}</p>
          </div>
          <span className="bw-badge" data-optical-stage-badge={studioOpticalReport.selectedStage}>
            {studioOpticalReport.facePixelPreservationPct}% ORIGINAL FACE PIXELS
          </span>
        </div>

        <div className="bw-grid">
          <label>
            {isKo
              ? "인물 참조 사진 구도 (프레임 대비 머리 폭 비중)"
              : "Portrait Framing (Head Width % of Frame)"}
            <select
              value={portraitHeadWidthPct}
              onChange={(e) => setPortraitHeadWidthPct(Number(e.target.value))}
              data-optical-head-width-select
            >
              <option value={42}>
                {isKo
                  ? "42% — 권장 바스트업 (목·쇄골·양쪽 어깨 포함 · 8등신 비율 유지)"
                  : "42% — Optimal Bust-Up (Neck, Collarbone & Both Shoulders Visible)"}
              </option>
              <option value={78}>
                {isKo
                  ? "78% — 얼굴 꽉 찬 클로즈업 (전신 생성 시 대두·좁은 어깨 위험 경고)"
                  : "78% — Tight Face Crop (Warning: Risks Narrow Shoulders in Full-Body)"}
              </option>
            </select>
          </label>

          <label>
            {isKo ? "얼굴 앞 손·컵·소품 가림 여부" : "Face Occlusion (Hand / Cup / Prop)"}
            <select
              value={portraitHasOcclusion ? "occluded" : "clean"}
              onChange={(e) => setPortraitHasOcclusion(e.target.value === "occluded")}
              data-optical-occlusion-select
            >
              <option value="clean">
                {isKo
                  ? "가림 없음 → Stage 1 원본 얼굴 픽셀 100% 그대로 보존 (기본)"
                  : "Unoccluded → Stage 1 Passthrough Smart Crop (100% Original Pixels)"}
              </option>
              <option value="occluded">
                {isKo
                  ? "손·소품 가림 있음 → Stage 2 국소 수선 (닮음도 90% 미달 시 즉시 롤백)"
                  : "Occluded → Stage 2 Surgical Edit (Auto-Rollback if <90% Match)"}
              </option>
            </select>
          </label>

          <label>
            {isKo ? "참조 사진 상의 핏 (어깨선 판별)" : "Reference Top Silhouette"}
            <select
              value={portraitBaggyTop ? "baggy" : "fitted"}
              onChange={(e) => setPortraitBaggyTop(e.target.value === "baggy")}
              data-optical-baggy-select
            >
              <option value="fitted">
                {isKo
                  ? "어깨선이 보이는 일반 상의 (바스트업 3:4 크롭 참조)"
                  : "Clear Shoulder Line (Standard 3:4 Bust-Up Reference)"}
              </option>
              <option value="baggy">
                {isKo
                  ? "박시한 후드·오버핏 가디건 (헤드·넥만 분리 + 슬렌더 런웨이 체형 가드)"
                  : "Baggy Hoodie/Cardigan (Head-Neck Crop + Slender Runway Physique)"}
              </option>
            </select>
          </label>
        </div>

        <p className="bw-note" data-optical-actionable-advice>
          {studioOpticalReport.actionableAdvice}
        </p>

        <div className="bw-row" style={{ flexWrap: "wrap", gap: 8 }}>
          {studioOpticalReport.guardrailBadges.map((badge) => (
            <span key={badge} className="bw-badge">
              ✓ {badge}
            </span>
          ))}
        </div>
      </div>

      <hr className="bw-divider" />

      {(studioFocusMode === "all" || studioFocusMode === "frame_review") && (
        <div className="bw-fields" data-studio-frame-review-section>
          <div className="bw-row">
            <div>
              <p className="bw-kicker">
                {isKo
                  ? "FRAME.IO-GRADE SPATIAL PIN REVIEW & PIPELINE HANDOFF"
                  : "FRAME.IO-GRADE SPATIAL PIN REVIEW & PIPELINE HANDOFF"}
              </p>
              <h3>
                {isKo
                  ? "프레임 단위 시사 · 화면 좌표(x%, y%) 핀 피드백 · 극소 부위 수선 & 0ms 음악 드롭 직결"
                  : "Frame-Accurate Review · Spatial (x%, y%) Pinning · Direct Micro-ROI & Music Drop Handoff"}
              </h3>
            </div>
          </div>
          <ReviewStage
            projectId={projectId.trim() || "studio-master-cut"}
            contents={[
              {
                id: "studio-v2-master",
                slotKey: "hero-reel",
                version: 2,
                title: isKo
                  ? "1080p 마스터 컷 (OLED 에디토리얼 룩 + -14.0 LUFS)"
                  : "1080p Master Cut (OLED Editorial + -14.0 LUFS)",
                attachmentId: "att-v2",
                mediaUrl: "/reel/brands/house-runway-1080p.mp4",
                caption: "Stage 2 Master",
                usageRights: "owned_organic",
                reviewRevision: 2,
                decision: "pending",
                createdAt: "2026-11-04T00:00:00Z",
              },
              {
                id: "studio-v1-draft",
                slotKey: "hero-reel",
                version: 1,
                title: isKo
                  ? "1080p 스튜디오 룩북 컷 (프렌치 블루 에디토리얼 + -14.0 LUFS)"
                  : "1080p Studio Lookbook Cut (French Blue Editorial + -14.0 LUFS)",
                attachmentId: "att-v1",
                mediaUrl: "/reel/brands/studio-editorial-blue-1080p.mp4",
                caption: "Stage 1 Draft",
                usageRights: "owned_organic",
                reviewRevision: 1,
                decision: "changes_requested",
                createdAt: "2026-11-04T00:00:00Z",
              },
            ]}
            messages={[]}
            decisions={[]}
            locale={locale}
            deferVideoMount={true}
            onSendPinToMicroRoi={(payload) => {
              const modeMap: Record<
                typeof payload.mode,
                "logo_mark_lock" | "expression_au_retake" | "micro_patch_ecc" | "face_detail_refine"
              > = {
                brand_logo_packaging: "logo_mark_lock",
                face_expression_retake: "expression_au_retake",
                hand_artifact_repair: "micro_patch_ecc",
                skin_hair_patch: "face_detail_refine",
                garment_collar_seam: "micro_patch_ecc",
              };
              setExternalMicroRoiHandoff({
                box: payload.box,
                mode: modeMap[payload.mode],
                note: payload.note,
                timestampSec: payload.timestampSec,
              });
              if (studioFocusMode === "frame_review") {
                setStudioFocusMode("micro_roi");
              }
            }}
            onSetMusicDropRevealSec={(revealSec) => {
              setExternalMusicRevealSec(revealSec);
              if (studioFocusMode === "frame_review") {
                setStudioFocusMode("sound_studio");
              }
            }}
          />
        </div>
      )}
    </section>
  );
}
