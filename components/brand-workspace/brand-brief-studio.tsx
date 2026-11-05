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

/**
 * Clean, Minimalist & Category-Adaptive Customer Studio Composer (`/brand/studio`).
 *
 * Follows docs/design/IDENTITY.md, TASTE.md, and TOOLBOX.md:
 * - Equal 4-column scene picker (.bw-scene-grid) with 1.5px ink selection ring.
 * - Recessed segmented tracks (.bw-seg-track) with lifted white pills (never competing blue fills).
 * - Recessed composer well (.bw-composer-well) with French Blue focus ring on :focus-within.
 * - Zero emojis, zero backend/engine jargon.
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

  const resolvedChecklist =
    defaultChecklist && defaultChecklist.length > 0
      ? defaultChecklist
      : [
          categoryProfile.compiler.defaultProductChecklist.geometry,
          categoryProfile.compiler.defaultProductChecklist.label,
          categoryProfile.compiler.defaultProductChecklist.material,
        ];

  function handleSelectSceneType(
    template: PomelliShotTemplate | "short_video",
  ) {
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

    const activeSceneIndex =
      medium === "short film"
        ? 3
        : activeShotTemplateId === "ingredients"
          ? 1
          : activeShotTemplateId === "in_use"
            ? 2
            : 0;
    const activeScene = categoryProfile.scenes[activeSceneIndex]!;

    const promptToUse =
      briefText.trim() ||
      (isKo ? activeScene.quickPromptsKo[0] : activeScene.quickPromptsEn[0]);

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
        isKo
          ? "브랜드 스타일과 업종별 촬영 세팅이 자동으로 적용되어 장면이 준비되었습니다."
          : "Scene prepared with your brand style and category settings.",
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
      template: POMELLI_SHOT_TEMPLATES[2],
    },
    {
      id: "short_video",
      specLabel: `${categoryProfile.scenes[3].focalMm}mm · 9:16 15s`,
      labelKo: categoryProfile.scenes[3].titleKo,
      labelEn: categoryProfile.scenes[3].titleEn,
      descKo: categoryProfile.scenes[3].descKo,
      descEn: categoryProfile.scenes[3].descEn,
      placeholderKo: categoryProfile.scenes[3].placeholderKo,
      placeholderEn: categoryProfile.scenes[3].placeholderEn,
      quickPromptsKo: categoryProfile.scenes[3].quickPromptsKo,
      quickPromptsEn: categoryProfile.scenes[3].quickPromptsEn,
      isVideo: true,
    },
  ];

  const activeSceneButton =
    simpleSceneButtons.find((item) =>
      item.isVideo
        ? medium === "short film"
        : medium !== "short film" && activeShotTemplateId === item.id,
    ) ?? simpleSceneButtons[0]!;

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
      {/* Header + Pre-configured Brand Category Badge */}
      <div className="bw-row" style={{ marginBottom: "18px", alignItems: "flex-end", gap: "16px" }}>
        <div>
          <h2 style={{ margin: "0 0 4px" }}>
            {isKo ? "장면 만들기" : "Create a Scene"}
          </h2>
          <p className="bw-muted" style={{ margin: 0, fontSize: "13px" }}>
            {isKo ? categoryProfile.headlineKo : categoryProfile.headlineEn}
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
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

      {/* Equal 4-Column Scene Type Picker (.bw-scene-grid) */}
      <div className="bw-scene-grid" data-pomelli-shot-templates>
        {simpleSceneButtons.map((item) => {
          const isSelected = item.isVideo
            ? medium === "short film"
            : medium !== "short film" && activeShotTemplateId === item.id;
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
                )
              }
              disabled={busy}
            >
              <span className="bw-scene-spec">{item.specLabel}</span>
              <strong>{isKo ? item.labelKo : item.labelEn}</strong>
              <span>{isKo ? item.descKo : item.descEn}</span>
            </button>
          );
        })}
      </div>

      {/* Recessed Composer Well (.bw-composer-well) */}
      <form
        onSubmit={onCompileSubmit}
        className="bw-composer-well"
        data-brief-compile-form
      >
        <textarea
          name="brief"
          className="bw-composer-textarea"
          rows={2}
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
          maxLength={500}
          disabled={!canWrite || busy}
          placeholder={
            isKo ? activeSceneButton.placeholderKo : activeSceneButton.placeholderEn
          }
        />

        {/* 1-Click Quick Prompt Chips */}
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
            ? activeSceneButton.quickPromptsKo
            : activeSceneButton.quickPromptsEn
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
                  ? "만드는 중..."
                  : "Creating..."
                : isKo
                  ? "만들기"
                  : "Create"}
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
                    color: active ? "var(--ys-ink)" : "var(--ys-ink-secondary)",
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

      {/* Clean Customer Output Card — True 4:5 Portrait Thumbnail, Zero Cropped Heads */}
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
              src={
                activeCategory === "beauty_skincare"
                  ? "/reel/campaigns/beauty-rose.jpg"
                  : activeCategory === "fnb_hospitality"
                    ? "/reel/brands/tea-editorial.jpg"
                    : "/reel/brands/production-paris.jpg"
              }
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
                {view.deliverable.aspect} ({view.resolution})
              </strong>
              <p className="bw-muted" style={{ margin: "4px 0 0", fontSize: "13px" }}>
                {isKo
                  ? "브랜드 로고·색감·화질 보정이 모두 반영되었습니다."
                  : "Your brand logo, color tone, and quality mastering have been applied."}
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
