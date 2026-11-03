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
  const [externalMicroRoiHandoff, setExternalMicroRoiHandoff] =
    useState<ExternalMicroRoiHandoff | null>(null);
  const [externalMusicRevealSec, setExternalMusicRevealSec] = useState<
    number | null
  >(null);

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
            {isKo ? "SHOTSPEC · 촬영 지시서 컴파일러" : "SHOTSPEC · BRIEF COMPILER"}
          </p>
          <h2>
            {isKo
              ? "한 줄 브리프 → 촬영 지시서 → 480p 초안 → 마스터 승격"
              : "1-Line Brief → ShotSpec → 480p Draft → Master Promotion"}
          </h2>
          <p className="bw-muted">
            {isKo
              ? "제품·참조 역할을 지정하면 브랜드 아이덴티티 고정 층을 결합해 촬영 지시서를 조립합니다. 초안 수정은 라운드당 1개 축만 변경해 흔들림을 막습니다."
              : "Combines your confirmed brand identity with a structured ShotSpec. Revisions change one axis per round to prevent drift."}
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

      <BrandStudioTutorial
        locale={locale}
        activeMode={studioFocusMode}
        onSelectMode={setStudioFocusMode}
      />

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
                mediaUrl: "/api/brand-workspace/attachments/studio-v2-master",
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
                  ? "480p 고속 드래프트 컷 (구도·모션 검수본)"
                  : "480p Fast Draft Cut (Composition Check)",
                attachmentId: "att-v1",
                mediaUrl: "/api/brand-workspace/attachments/studio-v1-draft",
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
            }}
            onSetMusicDropRevealSec={(revealSec) => {
              setExternalMusicRevealSec(revealSec);
            }}
          />
        </div>
      )}
    </section>
  );
}
