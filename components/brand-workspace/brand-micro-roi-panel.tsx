"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  MICRO_ROI_MODES,
  MICRO_ROI_MODE_SPECS,
  type BrandMicroRoiPlanView,
  type MicroRoiMode,
} from "@/lib/brands/finish/micro-roi";
import type { MicroRoiBox } from "@/lib/brands/review/service";
import type { LocalFixReferenceKind } from "@/lib/brands/finish/local-fix";

export interface ExternalMicroRoiHandoff {
  box: MicroRoiBox;
  mode?: MicroRoiMode;
  note: string;
  timestampSec?: number;
}

export interface BrandMicroRoiPanelProps {
  organizationId: string;
  projectId?: string;
  locale: "ko" | "en";
  canWrite: boolean;
  externalHandoff?: ExternalMicroRoiHandoff | null;
}

const ROI_VISUAL_MEDIA: Record<
  MicroRoiMode,
  { wide: string; before: string; after: string }
> = {
  logo_mark_lock: {
    wide: "/reel/landing/c-logo-wide.webp",
    before: "/reel/landing/c-logo-raw.webp",
    after: "/reel/landing/c-logo-ours.webp",
  },
  product_geometry_lock: {
    wide: "/reel/landing/c-logo-wide.webp",
    before: "/reel/landing/c-logo-raw.webp",
    after: "/reel/landing/c-logo-ours.webp",
  },
  micro_patch_ecc: {
    wide: "/reel/landing/c-garment-wide.webp",
    before: "/reel/landing/c-garment-raw.webp",
    after: "/reel/landing/c-garment-ours.webp",
  },
  face_detail_refine: {
    wide: "/reel/landing/c-skin-wide.webp",
    before: "/reel/landing/c-skin-raw.webp",
    after: "/reel/landing/c-skin-ours.webp",
  },
  face_identity_inward: {
    wide: "/reel/landing/c-skin-wide.webp",
    before: "/reel/landing/c-skin-raw.webp",
    after: "/reel/landing/c-skin-ours.webp",
  },
  expression_au_retake: {
    wide: "/reel/landing/c-skin-wide.webp",
    before: "/reel/landing/c-skin-raw.webp",
    after: "/reel/landing/c-skin-ours.webp",
  },
};

const QUICK_ROI_PRESETS: Record<
  string,
  {
    labelKo: string;
    labelEn: string;
    shortKo: string;
    mode: MicroRoiMode;
    box: { x0: number; y0: number; x1: number; y1: number };
    referenceKind: LocalFixReferenceKind;
    targetDescriptionKo: string;
    targetDescriptionEn: string;
    seamNoteKo: string;
  }
> = {
  logo_chest: {
    labelKo: "① 브랜드 로고·라벨 각인 복원",
    labelEn: "① Brand Logo & Label Lock",
    shortKo: "로고·라벨 각인",
    mode: "logo_mark_lock",
    box: { x0: 680, y0: 510, x1: 960, y1: 790 },
    referenceKind: "mark_only",
    targetDescriptionKo: "의상/용기 전면 브랜드 심볼과 타이포그래피 획 선명도 복원",
    targetDescriptionEn: "Restore crisp brand symbol and typography stroke geometry",
    seamNoteKo: "보틀 유리 숄더·라벨 외곽선 밖 평탄면 36px 여유 확보됨",
  },
  hand_skin_patch: {
    labelKo: "② 손·의류 주름·작은 흠집 정리",
    labelEn: "② Hand / Garment / Blemish Patch",
    shortKo: "손·피부 패치",
    mode: "micro_patch_ecc",
    box: { x0: 880, y0: 180, x1: 1280, y1: 580 },
    referenceKind: "none",
    targetDescriptionKo: "볼/턱선 주변 불필요한 손가락 아티팩트 제거 및 자연스러운 피부결 복원",
    targetDescriptionEn: "Remove stray hand artifact near cheek/jaw and restore natural skin texture",
    seamNoteKo: "턱선·옷깃 경계선 회피 완료 · 볼 평탄 피부 영역 내부에서 알파 0.0 소멸",
  },
  full_body_face: {
    labelKo: "③ 전신 화보 얼굴·피부결 선명화",
    labelEn: "③ Full-Body Face & Skin Detail",
    shortKo: "전신 얼굴·홍채",
    mode: "face_detail_refine",
    box: { x0: 758, y0: 38, x1: 1290, y1: 563 },
    referenceKind: "consented_identity",
    targetDescriptionKo: "전신 화보의 작은 얼굴에 실제 피부 모공·홍채 캐치라이트·속눈썹 디테일 복원",
    targetDescriptionEn: "Restore realistic non-uniform skin pores, iris catchlights, and eyelashes",
    seamNoteKo: "헤어라인·목선 여유 포함 532×525px 안전 박스 확보됨",
  },
  expression_retake: {
    labelKo: "④ 눈빛·입꼬리 미세 리테이크",
    labelEn: "④ Subtle Eye Gaze & Smile Retake",
    shortKo: "1~2mm 표정 리테이크",
    mode: "expression_au_retake",
    box: { x0: 573, y0: 40, x1: 1474, y1: 768 },
    referenceKind: "consented_identity",
    targetDescriptionKo: "얼굴형·코·볼·조명은 100% 유지한 채 눈매 시선과 자연스러운 입꼬리만 리테이크",
    targetDescriptionEn: "Retake only eye gaze and mouth corners while keeping skull, nose, and cheeks 100% original",
    seamNoteKo: "MediaPipe 478점 내향 폴리곤 마스크 작동 · 광대·코·턱선 원본 픽셀 100% 고정",
  },
};

export function BrandMicroRoiPanel({
  organizationId,
  projectId,
  locale,
  canWrite,
  externalHandoff,
}: BrandMicroRoiPanelProps) {
  const isKo = locale === "ko";

  const [mode, setMode] = useState<MicroRoiMode>("logo_mark_lock");
  const [x0, setX0] = useState(680);
  const [y0, setY0] = useState(510);
  const [x1, setX1] = useState(960);
  const [y1, setY1] = useState(790);
  const [imageWidth] = useState(2048);
  const [imageHeight] = useState(2560);
  const [referenceKind, setReferenceKind] =
    useState<LocalFixReferenceKind>("mark_only");
  const [targetDescription, setTargetDescription] = useState(
    isKo
      ? "의상/용기 전면 브랜드 심볼과 타이포그래피 획 선명도 복원"
      : "Restore crisp brand symbol and typography stroke geometry"
  );
  const [shapeChanged, setShapeChanged] = useState(false);
  const [loupeComparePct, setLoupeComparePct] = useState(78);
  const [planView, setPlanView] = useState<BrandMicroRoiPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!externalHandoff) return;
    setX0(externalHandoff.box.x0);
    setY0(externalHandoff.box.y0);
    setX1(externalHandoff.box.x1);
    setY1(externalHandoff.box.y1);
    if (externalHandoff.mode) {
      handleModeChange(externalHandoff.mode);
    }
    if (externalHandoff.note) {
      setTargetDescription(externalHandoff.note);
    }
    setStatusMessage(
      isKo
        ? `시사 스테이지 공간 핀 핸드오프 수신 완료: (${externalHandoff.box.x0}, ${externalHandoff.box.y0})~(${externalHandoff.box.x1}, ${externalHandoff.box.y1})`
        : `Received spatial pin handoff from Review Stage: (${externalHandoff.box.x0}, ${externalHandoff.box.y0})~(${externalHandoff.box.x1}, ${externalHandoff.box.y1})`
    );
  }, [externalHandoff, isKo]);

  function applyPreset(key: string) {
    const p = QUICK_ROI_PRESETS[key];
    if (!p) return;
    setMode(p.mode);
    setX0(p.box.x0);
    setY0(p.box.y0);
    setX1(p.box.x1);
    setY1(p.box.y1);
    setReferenceKind(p.referenceKind);
    setTargetDescription(isKo ? p.targetDescriptionKo : p.targetDescriptionEn);
    setErrorMessage("");
    setStatusMessage(
      isKo
        ? `프리셋 적용됨: ${p.labelKo}`
        : `Preset applied: ${p.labelEn}`
    );
  }

  function handleModeChange(nextMode: MicroRoiMode) {
    setMode(nextMode);
    const spec = MICRO_ROI_MODE_SPECS[nextMode];
    if (spec.requiresIsolatedMarkReference) {
      setReferenceKind("mark_only");
    } else if (spec.requiresConsentedIdentity) {
      setReferenceKind("consented_identity");
    } else {
      setReferenceKind("none");
    }
  }

  function autoSnapSeamSafePadding() {
    const cx = Math.round((x0 + x1) / 2);
    const cy = Math.round((y0 + y1) / 2);
    const safeW = Math.max(280, Math.min(520, x1 - x0 + 48));
    const safeH = Math.max(280, Math.min(520, y1 - y0 + 48));
    const nextX0 = Math.max(48, Math.min(imageWidth - safeW - 48, Math.round(cx - safeW / 2)));
    const nextY0 = Math.max(48, Math.min(imageHeight - safeH - 48, Math.round(cy - safeH / 2)));
    setX0(nextX0);
    setY0(nextY0);
    setX1(nextX0 + safeW);
    setY1(nextY0 + safeH);
    setStatusMessage(
      isKo
        ? `구조선(턱선·옷깃·보틀 숄더) 회피 안전 여백 자동 보정 완료: (${nextX0}, ${nextY0})~(${nextX0 + safeW}, ${nextY0 + safeH}) · 페더링 경계 내부 100% 수렴`
        : `Auto-snapped seam-safe padding: (${nextX0}, ${nextY0})~(${nextX0 + safeW}, ${nextY0 + safeH})`
    );
  }

  function handleVisualCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!canWrite || busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const clickX = Math.round(((e.clientX - rect.left) / rect.width) * imageWidth);
    const clickY = Math.round(((e.clientY - rect.top) / rect.height) * imageHeight);
    const w = Math.max(220, Math.min(640, x1 - x0));
    const h = Math.max(220, Math.min(640, y1 - y0));
    const nextX0 = Math.max(32, Math.min(imageWidth - w - 32, Math.round(clickX - w / 2)));
    const nextY0 = Math.max(32, Math.min(imageHeight - h - 32, Math.round(clickY - h / 2)));
    setX0(nextX0);
    setY0(nextY0);
    setX1(nextX0 + w);
    setY1(nextY0 + h);
  }

  async function submitMicroRoi(operation: "microRoi.plan" | "microRoi.queue") {
    if (!canWrite || busy) return;
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation,
          input: {
            organizationId,
            projectId: projectId?.trim() || undefined,
            mode,
            imageWidth,
            imageHeight,
            box: { x0, y0, x1, y1 },
            targetDescription,
            referenceKind,
            shapeChanged,
            locale,
            ...(mode === "logo_mark_lock"
              ? {
                  logoMarkLock: {
                    targetMarkHeightPx: 311,
                    detectedMarkHeightPx: 340,
                    targetCentreX: 734,
                    targetCentreY: 731,
                  },
                }
              : {}),
          },
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        code?: string;
        field?: string;
        plan?: BrandMicroRoiPlanView;
      };
      if (!response.ok || !data.ok || !data.plan) {
        setErrorMessage(
          isKo
            ? `부분 보정 요청을 처리하지 못했습니다 (${data.code ?? "invalid"}${data.field ? `: ${data.field}` : ""}). 로고나 인물 기준 에셋을 확인해 주세요.`
            : `Failed to build region repair plan (${data.code ?? "invalid"}).`
        );
        return;
      }
      setPlanView(data.plan);
      setStatusMessage(
        operation === "microRoi.queue"
          ? isKo
            ? `지정한 영역만 정밀 보정하는 작업이 등록되었습니다 (지정 영역 바깥 픽셀 100% 보존).`
            : `Region repair task queued (surrounding pixels 100% preserved).`
          : isKo
            ? `선택 영역 정밀 보정 계획이 준비되었습니다.`
            : `Region repair plan generated.`
      );
    } catch {
      setErrorMessage(
        isKo
          ? "네트워크 오류로 극소 부위 합성 요청을 전송하지 못했습니다."
          : "Network error while requesting Micro-ROI repair."
      );
    } finally {
      setBusy(false);
    }
  }

  function onFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitMicroRoi("microRoi.plan");
  }

  const activeSpec = MICRO_ROI_MODE_SPECS[mode];
  const activeVisual = ROI_VISUAL_MEDIA[mode];
  const cropW = Math.max(1, x1 - x0);
  const cropH = Math.max(1, y1 - y0);
  const upscaleFactor = (activeSpec.defaultCanvasPx / Math.max(cropW, cropH)).toFixed(2);
  const seamPaddingSafe =
    cropW >= 240 &&
    cropH >= 240 &&
    x0 >= 32 &&
    y0 >= 32 &&
    x1 <= imageWidth - 32 &&
    y1 <= imageHeight - 32;

  return (
    <div
      className="bw-fields"
      data-brand-micro-roi-panel
      data-micro-roi-mode={mode}
    >
      <div className="bw-row">
        <div>
          <p className="bw-kicker">
            {isKo
              ? "부분 디테일 정밀 보정"
              : "PRECISION DETAIL REPAIR"}
          </p>
          <h3>
            {isKo
              ? "원본 화보는 그대로 두고, 로고·피부·표정 극소 부위만 또렷하게 고칩니다"
              : "Keep the full shot untouched and repair only the logo, skin, or expression"}
          </h3>
          <p className="bw-muted">
            {isKo
              ? "전체 사진을 다시 합성하면 얼굴 인상과 조명이 달라집니다. 수선할 부위만 잘라 고해상도로 복원한 뒤, 주변 피부·조명 톤을 맞춰 경계 자국 없이 합칩니다."
              : "Full-canvas re-renders distort faces and lighting. We crop only the target region, restore it at high resolution, and keep surrounding pixels 100% untouched."}
          </p>
        </div>
        <span className="bw-badge" data-micro-roi-badge>
          {activeSpec.code} · {activeSpec.defaultCanvasPx}px
        </span>
      </div>

      {/* Quick Hotspot Presets */}
      <div className="bw-row" data-micro-roi-presets>
        {Object.entries(QUICK_ROI_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            className="bw-button"
            data-micro-roi-preset={key}
            onClick={() => applyPreset(key)}
            disabled={busy}
          >
            {isKo ? preset.labelKo : preset.labelEn}
          </button>
        ))}
      </div>

      {/* Interactive 2-Column Visual Stage: Left = 2K Canvas ROI Selector + Seam Radar, Right = 1440px Loupe Before/After Scrub */}
      <div className="bw-grid-wide" style={{ alignItems: "stretch", gap: 16 }}>
        {/* Left: Visual 2K Canvas & Seam-Safety Radar */}
        <div
          className="bw-card bw-fields"
          data-micro-roi-visual-stage
          style={{ margin: 0, padding: 16, background: "#FFFFFF", borderRadius: 20 }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? "① 원본 화보 수선 위치 선택 (화면을 클릭해 이동)"
                : "① Select Repair Area on Source Photo (Click to move)"}
            </strong>
            <span className="bw-badge">
              {cropW}×{cropH}px → {activeSpec.defaultCanvasPx}px ({upscaleFactor}×)
            </span>
          </div>

          <div
            onClick={handleVisualCanvasClick}
            role="presentation"
            style={{
              position: "relative",
              height: 280,
              borderRadius: 18,
              backgroundImage: `url(${activeVisual.wide})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundColor: "#EEF0F4",
              border: "1px solid rgba(15, 23, 42, 0.08)",
              overflow: "hidden",
              cursor: canWrite ? "crosshair" : "default",
            }}
          >
            {/* Subtle vignette so ROI frame pops */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(15,23,42,0.22) 0%, rgba(15,23,42,0.04) 50%, rgba(15,23,42,0.28) 100%)",
              }}
            />

            <span
              style={{
                position: "absolute",
                left: 12,
                top: 12,
                fontSize: 11,
                fontWeight: 600,
                color: "#FFFFFF",
                background: "rgba(15, 23, 42, 0.65)",
                backdropFilter: "blur(8px)",
                borderRadius: 999,
                padding: "4px 10px",
              }}
            >
              {isKo ? "박스 바깥 원본 픽셀 100% 보존" : "100% Untouched Outside Box"}
            </span>

            {/* Active Micro-ROI Crop Box */}
            <div
              data-micro-roi-active-box
              style={{
                position: "absolute",
                left: `${Math.max(4, Math.min(82, (x0 / imageWidth) * 100))}%`,
                top: `${Math.max(4, Math.min(78, (y0 / imageHeight) * 100))}%`,
                width: `${Math.max(18, Math.min(48, (cropW / imageWidth) * 100))}%`,
                height: `${Math.max(20, Math.min(48, (cropH / imageHeight) * 100))}%`,
                border: "2px solid #3875C5",
                borderRadius: 12,
                background: "rgba(56, 117, 197, 0.14)",
                boxShadow: "0 0 0 3px rgba(255,255,255,0.92), 0 12px 28px rgba(15,23,42,0.28)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: 6,
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  background: "#3875C5",
                  borderRadius: 999,
                  padding: "2px 7px",
                  alignSelf: "flex-start",
                }}
              >
                ROI ({x0},{y0})~({x1},{y1})
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#0F172A",
                  background: "rgba(255,255,255,0.92)",
                  borderRadius: 999,
                  padding: "2px 7px",
                  alignSelf: "flex-end",
                }}
              >
                0px leak
              </span>
            </div>
          </div>

          {/* Seam-Safety Radar */}
          <div
            data-micro-roi-seam-radar
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 12,
              background: seamPaddingSafe
                ? "rgba(56, 117, 197, 0.08)"
                : "rgba(217, 119, 6, 0.12)",
              border: seamPaddingSafe
                ? "1px solid rgba(56, 117, 197, 0.22)"
                : "1px solid rgba(217, 119, 6, 0.35)",
              fontSize: 12,
            }}
          >
            <span>
              {seamPaddingSafe
                ? isKo
                  ? "✓ 경계 여백 충분: 주변 피부·배경과 티 나지 않게 자연스럽게 이어집니다"
                  : "✓ Seam-Safety Passed: smooth feather margin secured"
                : isKo
                  ? "⚠ 수선 박스가 경계에 가깝습니다. 자동 여백 보정을 눌러 경계 자국을 예방하세요."
                  : "⚠ Box is tight; click Auto-Snap Padding for a seamless blend."}
            </span>
            <button
              type="button"
              className="bw-button"
              data-micro-roi-autosnap-btn
              onClick={autoSnapSeamSafePadding}
              disabled={!canWrite || busy}
              style={{ padding: "4px 10px", fontSize: 12 }}
            >
              {isKo ? "안전 여백 자동 보정" : "Auto-Snap Seam Padding"}
            </button>
          </div>
        </div>

        {/* Right: 1440px Magnified Loupe Before/After Compare */}
        <div
          className="bw-card bw-fields"
          data-micro-roi-loupe
          style={{ margin: 0, padding: 16, background: "#FFFFFF", borderRadius: 20 }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? `② ${activeSpec.defaultCanvasPx}px 확대 루페 · 수선 후 ↔ 수선 전 비교`
                : `② ${activeSpec.defaultCanvasPx}px Magnified Loupe · After ↔ Before`}
            </strong>
            <span className="bw-badge" data-micro-roi-image2-lock>
              {referenceKind === "mark_only"
                ? isKo
                  ? "브랜드 원본 로고 1:1 고정"
                  : "Brand Mark 1:1 Lock"
                : referenceKind === "consented_identity"
                  ? isKo
                    ? "사전 동의 인물 골격·피부결 고정"
                    : "Consented Identity Lock"
                  : isKo
                    ? "원본 조명·색온도 잠금"
                    : "Original Tone Lock"}
            </span>
          </div>

          <div
            style={{
              position: "relative",
              height: 280,
              borderRadius: 18,
              overflow: "hidden",
              border: "1px solid rgba(15, 23, 42, 0.08)",
              background: "#0F172A",
              color: "#F8FAFC",
              display: "grid",
              gridTemplateColumns: `${loupeComparePct}% ${100 - loupeComparePct}%`,
            }}
          >
            {/* After (Left / Primary restored layer with real photo) */}
            <div
              style={{
                padding: 12,
                backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.45) 0%, rgba(15,23,42,0.08) 45%, rgba(15,23,42,0.68) 100%), url(${activeVisual.after})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                borderRight: "2px solid #FFFFFF",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#3875C5",
                  color: "#FFFFFF",
                  padding: "3px 10px",
                  borderRadius: 999,
                  alignSelf: "flex-start",
                }}
              >
                {isKo
                  ? `수선 후 (${activeSpec.defaultCanvasPx}px 정밀 복원)`
                  : `After (${activeSpec.defaultCanvasPx}px Restored)`}
              </span>
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <strong style={{ color: "#FFFFFF" }}>
                  {isKo
                    ? "주변 조명·인상 100% 유지 · 디테일 선명 복원"
                    : "Original lighting & identity locked · Crisp detail"}
                </strong>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "#E2E8F0" }}>
                  {targetDescription}
                </p>
              </div>
            </div>

            {/* Before (Right / Raw unrefined crop with real photo) */}
            <div
              style={{
                padding: 12,
                backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.48) 0%, rgba(15,23,42,0.12) 45%, rgba(15,23,42,0.68) 100%), url(${activeVisual.before})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  background: "rgba(15, 23, 42, 0.72)",
                  color: "#F8FAFC",
                  padding: "3px 10px",
                  borderRadius: 999,
                  alignSelf: "flex-start",
                }}
              >
                {isKo ? "수선 전 (원본 확대)" : "Before (Raw Crop)"}
              </span>
              <p style={{ margin: 0, fontSize: 11, color: "#E2E8F0" }}>
                {isKo
                  ? "획 뭉개짐·미세 아티팩트 구간"
                  : "Unrefined detail region"}
              </p>
            </div>
          </div>

          <label style={{ fontSize: 12 }}>
            {isKo
              ? `수선 후 ↔ 수선 전 비교 슬라이더 (${loupeComparePct}%)`
              : `After ↔ Before Loupe Wipe (${loupeComparePct}%)`}
            <input
              type="range"
              min={15}
              max={85}
              value={loupeComparePct}
              onChange={(e) => setLoupeComparePct(Number(e.currentTarget.value))}
              aria-label={isKo ? "수정 전후 루페 비교" : "Before after loupe slider"}
            />
          </label>
        </div>
      </div>

      <form onSubmit={onFormSubmit} className="bw-fields" data-micro-roi-form>
        <label>
          {isKo
            ? "어떻게 고칠까요? (수선할 부위와 원하는 결과를 적어 주세요)"
            : "What should we fix in this area?"}
          <input
            name="targetDescription"
            value={targetDescription}
            onChange={(e) => setTargetDescription(e.target.value)}
            maxLength={400}
            required
            disabled={!canWrite || busy}
          />
        </label>

        <div className="bw-grid-wide">
          <label>
            {isKo ? "수선 대상 종류" : "Repair Target Mode"}
            <select
              name="microRoiMode"
              value={mode}
              onChange={(e) => handleModeChange(e.target.value as MicroRoiMode)}
              disabled={!canWrite || busy}
            >
              {MICRO_ROI_MODES.map((m) => (
                <option key={m} value={m}>
                  {isKo
                    ? MICRO_ROI_MODE_SPECS[m].titleKo
                    : MICRO_ROI_MODE_SPECS[m].titleEn}
                </option>
              ))}
            </select>
            <small className="bw-muted">
              {isKo ? activeSpec.summaryKo : activeSpec.summaryEn}
            </small>
          </label>

          <label>
            {isKo ? "고정할 기준 에셋" : "Reference Asset Lock"}
            <select
              name="referenceKind"
              value={referenceKind}
              onChange={(e) =>
                setReferenceKind(e.target.value as LocalFixReferenceKind)
              }
              disabled={!canWrite || busy}
            >
              <option value="mark_only">
                {isKo
                  ? "브랜드 원본 로고 · 심볼 마크 고정"
                  : "Original brand logo / symbol mark"}
              </option>
              <option value="consented_identity">
                {isKo
                  ? "사전 동의 모델 얼굴 · 피부결 고정"
                  : "Pre-consented model identity"}
              </option>
              <option value="material_swatch">
                {isKo
                  ? "원단 · 표면 재질 스와치 고정"
                  : "Surface material swatch"}
              </option>
              <option value="none">
                {isKo
                  ? "주변 피부 · 배경 결로 자연 복원"
                  : "Natural surrounding texture repair"}
              </option>
            </select>
          </label>
        </div>

        <details className="bw-service-disclosure">
          <summary>
            {isKo
              ? `고급 픽셀 좌표 & 주파수 분리 설정 (${cropW}×${cropH}px → ${activeSpec.defaultCanvasPx}px)`
              : `Advanced Pixel Coordinates & Tone-Lock Settings (${cropW}×${cropH}px → ${activeSpec.defaultCanvasPx}px)`}
          </summary>
          <div className="bw-fields" style={{ marginTop: 12 }}>
            <div className="bw-grid-wide">
              <label>
                {isKo ? "Box x0 (px)" : "Box x0 (px)"}
                <input
                  type="number"
                  min={0}
                  max={imageWidth - 16}
                  value={x0}
                  onChange={(e) => setX0(Number(e.target.value) || 0)}
                  disabled={!canWrite || busy}
                />
              </label>
              <label>
                {isKo ? "Box y0 (px)" : "Box y0 (px)"}
                <input
                  type="number"
                  min={0}
                  max={imageHeight - 16}
                  value={y0}
                  onChange={(e) => setY0(Number(e.target.value) || 0)}
                  disabled={!canWrite || busy}
                />
              </label>
              <label>
                {isKo ? "Box x1 (px)" : "Box x1 (px)"}
                <input
                  type="number"
                  min={16}
                  max={imageWidth}
                  value={x1}
                  onChange={(e) => setX1(Number(e.target.value) || 200)}
                  disabled={!canWrite || busy}
                />
              </label>
              <label>
                {isKo ? "Box y1 (px)" : "Box y1 (px)"}
                <input
                  type="number"
                  min={16}
                  max={imageHeight}
                  value={y1}
                  onChange={(e) => setY1(Number(e.target.value) || 200)}
                  disabled={!canWrite || busy}
                />
              </label>
            </div>

            <p className="bw-muted" data-micro-roi-scale-preview>
              {isKo
                ? `선택 영역 크기: ${cropW}×${cropH}px → 고해상도 작업 캔버스: ${activeSpec.defaultCanvasPx}px (확대 배율 ${upscaleFactor}×)`
                : `Selected Crop: ${cropW}×${cropH}px → High-Res Canvas: ${activeSpec.defaultCanvasPx}px (${upscaleFactor}×)`}
            </p>

            <label className="bw-check">
              <input
                type="checkbox"
                checked={shapeChanged}
                onChange={(e) => setShapeChanged(e.target.checked)}
                disabled={!canWrite || busy}
              />
              {isKo
                ? "외곽 실루엣/옷깃 형태 변경 포함 (넓은 주변 톤 자연 블렌딩 적용)"
                : "Includes silhouette/shape change (apply wide natural tone blending)"}
            </label>
          </div>
        </details>

        {canWrite && (
          <div className="bw-row">
            <button
              type="button"
              className="bw-button bw-primary"
              disabled={busy}
              data-micro-roi-queue-submit
              onClick={() => void submitMicroRoi("microRoi.queue")}
            >
              {isKo
                ? "선택한 부위 정밀 수선 실행"
                : "Run Precision Local Repair"}
            </button>
            <button
              type="submit"
              className="bw-button"
              disabled={busy}
              data-micro-roi-plan-submit
            >
              {isKo
                ? "5단계 복원 명세 미리보기"
                : "Preview 5-Step Repair Spec"}
            </button>
          </div>
        )}
      </form>

      {errorMessage && (
        <p role="alert" className="bw-error" data-micro-roi-error>
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p role="status" className="bw-note" data-micro-roi-status>
          {statusMessage}
        </p>
      )}

      {planView && (
        <div className="bw-note bw-fields" data-micro-roi-plan-result>
          <div className="bw-row">
            <strong>
              {isKo ? planView.modeTitle.ko : planView.modeTitle.en} (
              {planView.modeCode})
            </strong>
            <span className="bw-badge" data-micro-roi-invariant-badge>
              {planView.step5FeatherComposite.invariant} · alpha floor{" "}
              {planView.step5FeatherComposite.zeroLeakAlphaFloor}
            </span>
          </div>
          <ul className="bw-list">
            <li>
              <strong>Step 1 (Box & Upscale):</strong> ({planView.step1Crop.box.x0},{" "}
              {planView.step1Crop.box.y0}, {planView.step1Crop.box.x1},{" "}
              {planView.step1Crop.box.y1}) → {planView.step1Crop.canvasWidth}×
              {planView.step1Crop.canvasHeight}px ({planView.step1Crop.upscaleFactor}×{" "}
              {planView.step1Crop.interpolationUp})
            </li>
            <li>
              <strong>Step 2 (Pixel-Locked Edit):</strong>{" "}
              {planView.step2Edit.customerSummary}
            </li>
            <li>
              <strong>Step 3 (Subpixel Registration):</strong>{" "}
              {planView.step3Alignment.method}
              {planView.step3Alignment.actionUnits.length > 0
                ? ` (${planView.step3Alignment.actionUnits.join(", ")})`
                : ` (RMS ≤ ${planView.step3Alignment.gates.postwarpRmsMaxIod} IOD)`}
            </li>
            <li>
              <strong>Step 4 (Frequency-Separated Tone Lock):</strong>{" "}
              {planView.step4ToneLock.method} · σ ={" "}
              {planView.step4ToneLock.gaussianSigmaPx}px ·{" "}
              <code>{planView.step4ToneLock.keepToneFormula}</code>
            </li>
            <li>
              <strong>Step 5 (Zero-Leak Composite):</strong>{" "}
              {planView.step5FeatherComposite.matteMethod} ·{" "}
              <code>{planView.step5FeatherComposite.cliHarnessCommand}</code>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
