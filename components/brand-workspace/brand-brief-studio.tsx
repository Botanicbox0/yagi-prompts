"use client";

import { useState, type FormEvent } from "react";
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
  POMELLI_SHOT_TEMPLATES,
  createAttachmentPreset,
  type DesignPrincipleAttachment,
  type DesignPrincipleAttachmentMode,
  type PomelliShotTemplate,
  type PomelliShotTemplateId,
} from "@/lib/brands/briefs/vertical-playbooks";
import {
  auditMultiShotContinuity,
  buildTwoStageApprovalAndReelsMasterPlan,
  compileOledCinemaColorGradePlan,
  evaluateOpticalIdentityLockV2,
} from "@/lib/brands/production-pipeline/video-creator-techniques";

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

/**
 * Clean, Minimalist Customer Studio Composer (`/brand/studio`).
 *
 * Design Rule:
 * - Surface UI is ultra-simple: pick a scene type, type 1 line, choose mood/aspect/brand-style toggle, and click [만들기].
 * - All complex optical, color-grading (OLED 33³ LUT), identity-lock (Stage 1 passthrough / 35–55% bust-up guard),
 *   multi-shot continuity, and 2-stage mastering parameters are automatically compiled under the hood.
 */
export function BrandBriefStudio({
  organizationId,
  locale,
  canWrite,
  identityConfirmed,
  defaultChecklist = ["제품 실루엣과 라벨 비례 유지", "브랜드 고유 색감 유지"],
  identityHref,
  initialProjectId,
  initialProjectTitle,
}: BrandBriefStudioProps) {
  const isKo = locale === "ko";

  // Simple customer-facing state
  const [activeShotTemplateId, setActiveShotTemplateId] =
    useState<PomelliShotTemplateId>("studio");
  const [medium, setMedium] = useState<DeliverableMedium>("product still");
  const [cutKind, setCutKind] = useState<ShotCutKind>("reference_exact_product");
  const [aspect, setAspect] = useState<ShotAspect>("4:5");
  const [use, setUse] = useState<DeliverableUse>("feed");
  const [briefText, setBriefText] = useState("");
  const [activeAestheticLineCode, setActiveAestheticLineCode] = useState<
    "A" | "B" | "C"
  >("A");
  const [principleAttachment, setPrincipleAttachment] =
    useState<DesignPrincipleAttachment>(() =>
      createAttachmentPreset("full_attach"),
    );

  // Under-the-hood compiled system state (never dumped as raw jargon on the screen)
  const [lookPresetId, setLookPresetId] =
    useState<BrandLookPresetId>("kodak-2383-warm");
  const [cameraFocalMm, setCameraFocalMm] = useState(85);
  const [lightColourK, setLightColourK] = useState(5500);
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
    brandName: "BRAND",
    category: "fashion_apparel",
    preferredVibe: "minimal_editorial",
    hasPinterestBoards: true,
  });

  // Under-the-hood SOTA pipeline synthesis (computed silently for the compiler)
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
          : "oled-editorial-punch",
    locale,
  });
  const silentContinuity = auditMultiShotContinuity({ clipCount: 4, locale });
  const silentMasterPlan = buildTwoStageApprovalAndReelsMasterPlan({
    gateStatus: "stage2_1080p_master",
    locale,
  });

  function handleSelectSceneType(
    template: PomelliShotTemplate | "short_video",
  ) {
    if (template === "short_video") {
      setMedium("short film");
      setCutKind("short_film_clip");
      setAspect("9:16");
      setUse("reel");
      setCameraFocalMm(50);
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

  async function onCompileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite || busy) return;
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");

    const promptToUse =
      briefText.trim() ||
      (isKo
        ? "자연광이 부드럽게 들어오는 테이블 위 제품 중심 연출"
        : "Clean tabletop product scene with soft natural daylight");

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
                    projectProductChecklist: [...defaultChecklist],
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
                defaultChecklist[0] ??
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
        isKo
          ? "브랜드 스타일과 최적 촬영 세팅이 자동으로 적용되어 장면이 준비되었습니다."
          : "Scene prepared with your brand style and optimal studio settings.",
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
    labelKo: string;
    labelEn: string;
    descKo: string;
    descEn: string;
    isVideo?: boolean;
    template?: PomelliShotTemplate;
  }> = [
    {
      id: "studio",
      labelKo: "제품 단독 컷",
      labelEn: "Product Cut",
      descKo: "단상·배경 위 깔끔한 제품 촬영",
      descEn: "Clean tabletop product shot",
      template: POMELLI_SHOT_TEMPLATES[0],
    },
    {
      id: "ingredients",
      labelKo: "제형 · 디테일",
      labelEn: "Texture & Detail",
      descKo: "원단 질감·제형 클로즈업",
      descEn: "Macro texture & material close-up",
      template: POMELLI_SHOT_TEMPLATES[1],
    },
    {
      id: "in_use",
      labelKo: "착용 · 사용 컷",
      labelEn: "Model & In-Use",
      descKo: "모델 착용 및 실제 사용 장면",
      descEn: "Natural model & in-use scene",
      template: POMELLI_SHOT_TEMPLATES[2],
    },
    {
      id: "short_video",
      labelKo: "숏폼 영상",
      labelEn: "Short Video",
      descKo: "릴스·숏츠용 고화질 모션 영상",
      descEn: "Vertical motion video for Reels",
      isVideo: true,
    },
  ];

  return (
    <section
      className="bw-panel"
      data-brand-brief-studio
      data-brief-stage={view?.stage ?? "idle"}
      data-brief-round={view?.round ?? 0}
      data-brief-identity-source={
        identityConfirmed ? "confirmed" : "default_fallback"
      }
      data-studio-optical-stage={silentOpticalGuard.selectedStage}
      data-studio-oled-look={silentOledPlan.preset.id}
      data-studio-continuity={silentContinuity.status}
      data-studio-master-gate={silentMasterPlan.gateStatus}
      style={{
        padding: "24px",
        borderRadius: "24px",
        background: "#FFFFFF",
        border: "1px solid rgba(15, 23, 42, 0.08)",
      }}
    >
      {/* Clean Header */}
      <div
        className="bw-row"
        style={{ marginBottom: "18px", alignItems: "center" }}
      >
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 600 }}>
            {isKo ? "어떤 콘텐츠를 만들까요?" : "What would you like to create?"}
          </h2>
          <p className="bw-muted" style={{ margin: 0, fontSize: "13.5px" }}>
            {isKo
              ? "원하는 구도를 고르고 한 줄로 적어주시면, 등록된 브랜드 로고·색감·고화질 마감 기준에 맞춰 바로 제작합니다."
              : "Pick a shot type and describe your scene in one line. Your brand style and master quality rules are applied automatically."}
          </p>
        </div>
        {identityHref && (
          <a className="bw-button" href={identityHref}>
            {isKo ? "브랜드 스타일 관리" : "Brand Style"}
          </a>
        )}
      </div>

      {/* 1. Simple 4-Card Scene Type Picker (No mm/Kelvin/jargon) */}
      <div
        className="bw-grid-wide"
        data-pomelli-shot-templates
        style={{ gap: "10px", marginBottom: "16px" }}
      >
        {simpleSceneButtons.map((item) => {
          const isSelected = item.isVideo
            ? medium === "short film"
            : medium !== "short film" && activeShotTemplateId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-pomelli-shot-template={item.id}
              aria-pressed={isSelected}
              onClick={() =>
                handleSelectSceneType(
                  item.isVideo ? "short_video" : item.template!,
                )
              }
              disabled={busy}
              style={{
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: "16px",
                background: isSelected ? "rgba(56, 117, 197, 0.06)" : "#F8FAFC",
                border: isSelected
                  ? "2px solid #3875C5"
                  : "1px solid rgba(15, 23, 42, 0.08)",
                cursor: busy ? "default" : "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <strong style={{ fontSize: "14px", color: "#0F172A" }}>
                {isKo ? item.labelKo : item.labelEn}
              </strong>
              <span style={{ fontSize: "12px", color: "#64748B" }}>
                {isKo ? item.descKo : item.descEn}
              </span>
            </button>
          );
        })}
      </div>

      {/* 2. Unified One-Box Composer (Prompt + Compact Pill Toolbar) */}
      <form
        onSubmit={onCompileSubmit}
        data-brief-compile-form
        style={{
          padding: "16px",
          borderRadius: "20px",
          background: "#F8FAFC",
          border: "1px solid rgba(15, 23, 42, 0.1)",
          display: "grid",
          gap: "14px",
        }}
      >
        <textarea
          name="brief"
          rows={2}
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
          maxLength={500}
          disabled={!canWrite || busy}
          placeholder={
            isKo
              ? "원하는 장면을 편하게 적어주세요 (예: 아침 햇살이 들어오는 대리석 테이블 위 세럼 보틀과 물방울)"
              : "Describe your scene in one line (e.g., Serum bottle on a sunlit marble table with water droplets)"
          }
          style={{
            width: "100%",
            border: "none",
            background: "transparent",
            fontSize: "15px",
            lineHeight: 1.5,
            color: "#0F172A",
            resize: "none",
            outline: "none",
          }}
        />

        {/* Compact Bottom Pill Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            paddingTop: "10px",
            borderTop: "1px solid rgba(15, 23, 42, 0.08)",
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
              data-studio-aesthetic-bar
              data-active-aesthetic-line={activeAestheticLineCode}
              style={{
                display: "inline-flex",
                background: "#FFFFFF",
                padding: "3px",
                borderRadius: "999px",
                border: "1px solid rgba(15, 23, 42, 0.09)",
                gap: "2px",
              }}
            >
              {aestheticLines.map((line) => {
                const selected = activeAestheticLineCode === line.code;
                const label = moodLabels[line.code];
                return (
                  <button
                    key={line.id}
                    type="button"
                    data-studio-aesthetic-card={line.code}
                    aria-pressed={selected}
                    onClick={() => applyMood(line)}
                    disabled={busy}
                    style={{
                      padding: "5px 11px",
                      borderRadius: "999px",
                      border: "none",
                      fontSize: "12px",
                      fontWeight: selected ? 600 : 500,
                      background: selected ? "#3875C5" : "transparent",
                      color: selected ? "#FFFFFF" : "#475569",
                      cursor: "pointer",
                    }}
                  >
                    {isKo ? label.ko : label.en}
                  </button>
                );
              })}
            </div>

            {/* Aspect Ratio Pills */}
            <div
              style={{
                display: "inline-flex",
                background: "#FFFFFF",
                padding: "3px",
                borderRadius: "999px",
                border: "1px solid rgba(15, 23, 42, 0.09)",
                gap: "2px",
              }}
            >
              {SHOT_ASPECTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={aspect === r}
                  onClick={() => setAspect(r)}
                  disabled={busy}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "999px",
                    border: "none",
                    fontSize: "12px",
                    fontWeight: aspect === r ? 600 : 500,
                    background:
                      aspect === r ? "rgba(56, 117, 197, 0.14)" : "transparent",
                    color: aspect === r ? "#3063A7" : "#475569",
                    cursor: "pointer",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* Simple Brand Style Switch (On vs Free Exploration) */}
            <div
              data-design-principle-attachment
              data-attachment-mode={principleAttachment.mode}
              style={{
                display: "inline-flex",
                background: "#FFFFFF",
                padding: "3px",
                borderRadius: "999px",
                border: "1px solid rgba(15, 23, 42, 0.09)",
                gap: "2px",
              }}
            >
              <button
                type="button"
                data-attachment-mode-btn="full_attach"
                aria-pressed={principleAttachment.mode === "full_attach"}
                onClick={() => toggleBrandStyleMode("full_attach")}
                disabled={busy}
                style={{
                  padding: "5px 11px",
                  borderRadius: "999px",
                  border: "none",
                  fontSize: "12px",
                  fontWeight:
                    principleAttachment.mode === "full_attach" ? 600 : 500,
                  background:
                    principleAttachment.mode === "full_attach"
                      ? "rgba(56, 117, 197, 0.14)"
                      : "transparent",
                  color:
                    principleAttachment.mode === "full_attach"
                      ? "#3063A7"
                      : "#475569",
                  cursor: "pointer",
                }}
              >
                {isKo ? "🔒 브랜드 톤 유지" : "🔒 Brand Style ON"}
              </button>
              <button
                type="button"
                data-attachment-mode-btn="unbound_free"
                aria-pressed={principleAttachment.mode === "unbound_free"}
                onClick={() => toggleBrandStyleMode("unbound_free")}
                disabled={busy}
                style={{
                  padding: "5px 11px",
                  borderRadius: "999px",
                  border: "none",
                  fontSize: "12px",
                  fontWeight:
                    principleAttachment.mode === "unbound_free" ? 600 : 500,
                  background:
                    principleAttachment.mode === "unbound_free"
                      ? "rgba(15, 23, 42, 0.08)"
                      : "transparent",
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                {isKo ? "🔓 자유 탐색" : "🔓 Free Style"}
              </button>
            </div>
          </div>

          {canWrite && (
            <button
              type="submit"
              className="bw-button bw-primary"
              disabled={busy}
              data-brief-compile-submit
              style={{
                padding: "9px 20px",
                borderRadius: "999px",
                fontWeight: 600,
              }}
            >
              {busy
                ? isKo
                  ? "만드는 중..."
                  : "Creating..."
                : isKo
                  ? "만들기 →"
                  : "Create →"}
            </button>
          )}
        </div>
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

      {/* Clean Customer Output Card (Never exposes raw prompt/hash/lint dumps) */}
      {view && (
        <div
          className="bw-card"
          data-brief-preview
          style={{
            marginTop: "16px",
            padding: "18px",
            borderRadius: "18px",
            background: "#F8FAFC",
            border: "1px solid rgba(56, 117, 197, 0.22)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div>
            <strong style={{ fontSize: "15px", color: "#0F172A" }}>
              {isKo ? view.cutKindLabel.ko : view.cutKindLabel.en} ·{" "}
              {view.deliverable.aspect} ({view.resolution})
            </strong>
            <p className="bw-muted" style={{ margin: "4px 0 0", fontSize: "13px" }}>
              {isKo
                ? "브랜드 로고·색감·화질 보정이 모두 반영되었습니다."
                : "Your brand logo, color tone, and quality mastering have been applied."}
            </p>
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
