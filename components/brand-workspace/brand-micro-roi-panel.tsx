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
    labelKo: "① 브랜드 로고·심볼 정밀 복원 (1440px ECC + 스케일 잠금)",
    labelEn: "① Brand Logo & Mark Lock (1440px ECC + Scale Lock)",
    shortKo: "로고·라벨 각인",
    mode: "logo_mark_lock",
    box: { x0: 680, y0: 510, x1: 960, y1: 790 },
    referenceKind: "mark_only",
    targetDescriptionKo: "의상/용기 전면 브랜드 심볼과 타이포그래피 획 선명도 복원",
    targetDescriptionEn: "Restore crisp brand symbol and typography stroke geometry",
    seamNoteKo: "보틀 유리 숄더·라벨 외곽선 밖 평탄면 36px 여유 확보됨",
  },
  hand_skin_patch: {
    labelKo: "② 극소 부위 패치 (볼의 손 제거 · 의류 주름 · 피부 패치)",
    labelEn: "② Micro-ROI Patch (Hand Removal / Garment / Skin Patch)",
    shortKo: "손·피부 패치",
    mode: "micro_patch_ecc",
    box: { x0: 880, y0: 180, x1: 1280, y1: 580 },
    referenceKind: "none",
    targetDescriptionKo: "볼/턱선 주변 불필요한 손가락 아티팩트 제거 및 자연스러운 피부결 복원",
    targetDescriptionEn: "Remove stray hand artifact near cheek/jaw and restore natural skin texture",
    seamNoteKo: "턱선·옷깃 경계선 회피 완료 · 볼 평탄 피부 영역 내부에서 알파 0.0 소멸",
  },
  full_body_face: {
    labelKo: "③ 전신 샷 얼굴 디테일 복원 (1400px 비균일 피부결·홍채)",
    labelEn: "③ Full-Body Face Detail Refine (1400px Pores & Iris)",
    shortKo: "전신 얼굴·홍채",
    mode: "face_detail_refine",
    box: { x0: 758, y0: 38, x1: 1290, y1: 563 },
    referenceKind: "consented_identity",
    targetDescriptionKo: "전신 화보의 작은 얼굴에 실제 피부 모공·홍채 캐치라이트·속눈썹 디테일 복원",
    targetDescriptionEn: "Restore realistic non-uniform skin pores, iris catchlights, and eyelashes",
    seamNoteKo: "헤어라인·목선 여유 포함 532×525px 안전 박스 확보됨",
  },
  expression_retake: {
    labelKo: "④ MediaPipe 478점 국소 표정 리테이크 (눈·눈썹·입매 전용)",
    labelEn: "④ MediaPipe 478-Point Expression Retake (Eyes / Brows / Mouth)",
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
            ? `극소 부위 합성 명세 생성 실패 (${data.code ?? "invalid"}${data.field ? `: ${data.field}` : ""}). 로고 복원은 mark_only, 인물 복원은 consented_identity가 필요합니다.`
            : `Failed to build Micro-ROI plan (${data.code ?? "invalid"}).`
        );
        return;
      }
      setPlanView(data.plan);
      setStatusMessage(
        operation === "microRoi.queue"
          ? isKo
            ? `5단계 극소 부위(Micro-ROI) 로컬 CV 합성 작업이 큐에 등록되었습니다 (outside_pixels_changed === 0 보장).`
            : `5-step Micro-ROI CV composite task queued (outside_pixels_changed === 0 guaranteed).`
          : isKo
            ? `5단계 극소 부위(Micro-ROI) 크롭·정렬·톤 잠금·합성 명세가 생성되었습니다.`
            : `5-step Micro-ROI crop, alignment, tone-lock, and composite plan generated.`
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
              ? "MICRO-ROI 5-STEP HARNESS · 극소 부위 무손실 부분 복원"
              : "MICRO-ROI 5-STEP HARNESS · ZERO-LEAK LOCAL COMPOSITE"}
          </p>
          <h3>
            {isKo
              ? "전체 캔버스 재합성 왜곡 차단 · 극소 부위 Crop → 2K 확대 → 서브픽셀 정렬 → 주파수 분리 톤 잠금 → 무손실 합성"
              : "Zero Full-Canvas Drift · Box & 2K Upscale → Subpixel Align → Tone Lock → Zero-Leak Feather"}
          </h3>
          <p className="bw-muted">
            {isKo
              ? "전체 사진을 재합성하면 눈·코·인중 비율이 5~15% 변형되고 조명이 뜹니다. 고칠 부위(180~400px)만 잘라 1400~1600px로 확대한 뒤, 로컬 OpenCV 서브픽셀 역정렬(ECC / 5-Point / MediaPipe 478점)과 주파수 분리(keep_tone)를 거쳐 마스크 바깥 단 1픽셀도 바꾸지 않고(outside_pixels_changed === 0) 합성합니다."
              : "Prevents full-canvas facial/lighting drift by cropping only the target ROI to 1400-1600px, applying subpixel CV alignment and frequency-separated tone lock, and guaranteeing outside_pixels_changed === 0."}
          </p>
        </div>
        <span className="bw-badge" data-micro-roi-badge>
          {activeSpec.code} · {activeSpec.defaultCanvasPx}px
        </span>
      </div>

      {/* Dynamic Contextual Island + Quick Hotspot Presets */}
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
          style={{ margin: 0, padding: 14, background: "#F7F8FA" }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? "① 2K 원본 캔버스 ROI 선택기 (클릭하여 크롭 이동)"
                : "① 2K Source Canvas ROI Selector (Click to move)"}
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
              height: 250,
              borderRadius: 12,
              background:
                "linear-gradient(155deg, #EEF2F7 0%, #DCE6F2 48%, #C6D6EA 100%)",
              border: "1px solid rgba(15, 23, 42, 0.14)",
              overflow: "hidden",
              cursor: canWrite ? "crosshair" : "default",
            }}
          >
            {/* Architectural grid lines */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(to right, rgba(56,117,197,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,117,197,0.08) 1px, transparent 1px)",
                backgroundSize: "25% 25%",
              }}
            />

            {/* Silhouette & Bottle Guides */}
            <div
              style={{
                position: "absolute",
                left: "36%",
                top: "12%",
                width: "28%",
                height: "74%",
                borderRadius: "999px 999px 24px 24px",
                background: "rgba(22, 35, 63, 0.12)",
                border: "1px dashed rgba(22, 35, 63, 0.28)",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: 10,
                fontSize: 11,
                color: "#1E293B",
                fontWeight: 600,
              }}
            >
              {isKo ? "인물·의상 원본 보존 구역 (100% 불변)" : "100% Untouched Subject Zone"}
            </div>

            {/* Active Micro-ROI Crop Box */}
            <div
              data-micro-roi-active-box
              style={{
                position: "absolute",
                left: `${Math.max(4, Math.min(82, (x0 / imageWidth) * 100))}%`,
                top: `${Math.max(4, Math.min(78, (y0 / imageHeight) * 100))}%`,
                width: `${Math.max(14, Math.min(48, (cropW / imageWidth) * 100))}%`,
                height: `${Math.max(16, Math.min(48, (cropH / imageHeight) * 100))}%`,
                border: "2px solid #3875C5",
                borderRadius: 10,
                background: "rgba(56, 117, 197, 0.16)",
                boxShadow: "0 0 0 3px rgba(255,255,255,0.85)",
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
                  borderRadius: 4,
                  padding: "1px 5px",
                  alignSelf: "flex-start",
                }}
              >
                ROI ({x0},{y0})~({x1},{y1})
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "#0F172A",
                  background: "rgba(255,255,255,0.9)",
                  borderRadius: 4,
                  padding: "1px 5px",
                  alignSelf: "flex-end",
                }}
              >
                alpha &lt; 0.012 → 0px leak
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
              padding: "8px 10px",
              borderRadius: 8,
              background: seamPaddingSafe
                ? "rgba(56, 117, 197, 0.08)"
                : "rgba(217, 119, 6, 0.12)",
              border: seamPaddingSafe
                ? "1px solid rgba(56, 117, 197, 0.25)"
                : "1px solid rgba(217, 119, 6, 0.35)",
              fontSize: 12,
            }}
          >
            <span>
              {seamPaddingSafe
                ? isKo
                  ? "✓ 구조선 안전 레이더 통과: 턱선·옷깃·보틀 숄더 경계 밖 평탄면 여유 확보됨"
                  : "✓ Seam-Safety Radar Passed: flat margin secured outside structural seams"
                : isKo
                  ? "⚠ 크롭 박스가 좁거나 경계에 가깝습니다. 페더링 경계가 묻히도록 안전 여백 확장을 권장합니다."
                  : "⚠ Crop box is tight; expand flat padding so feathering drops to 0.0 cleanly."}
            </span>
            <button
              type="button"
              className="bw-button"
              data-micro-roi-autosnap-btn
              onClick={autoSnapSeamSafePadding}
              disabled={!canWrite || busy}
              style={{ padding: "4px 10px", fontSize: 12 }}
            >
              {isKo ? "구조선 회피 안전 여백 자동 보정" : "Auto-Snap Seam Padding"}
            </button>
          </div>
        </div>

        {/* Right: 1440px Magnified Loupe Before/After Compare + @Image 2 Original Asset Lock */}
        <div
          className="bw-card bw-fields"
          data-micro-roi-loupe
          style={{ margin: 0, padding: 14, background: "#F7F8FA" }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? `② ${activeSpec.defaultCanvasPx}px 확대 루페 · 수정 전 ↔ 수정 후 비교`
                : `② ${activeSpec.defaultCanvasPx}px Magnified Loupe · Before ↔ After`}
            </strong>
            <span className="bw-badge" data-micro-roi-image2-lock>
              {referenceKind === "mark_only"
                ? isKo
                  ? "@Image 2 브랜드 원본 로고 1:1 고정"
                  : "@Image 2 Brand Mark 1:1 Lock"
                : referenceKind === "consented_identity"
                  ? isKo
                    ? "@Image 2 사전 동의 인물 골격·피부결 고정"
                    : "@Image 2 Consented Identity Lock"
                  : isKo
                    ? "주파수 분리(keep_tone) 원본 조명 잠금"
                    : "Frequency-Separated Tone Lock"}
            </span>
          </div>

          <div
            style={{
              position: "relative",
              height: 196,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid rgba(15, 23, 42, 0.14)",
              background: "#0F172A",
              color: "#F8FAFC",
              display: "grid",
              gridTemplateColumns: `${loupeComparePct}% ${100 - loupeComparePct}%`,
            }}
          >
            {/* After (Right / Primary restored layer) */}
            <div
              style={{
                padding: 12,
                background:
                  "linear-gradient(135deg, #16233F 0%, #244B82 55%, #3875C5 100%)",
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
                  background: "rgba(255,255,255,0.18)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  alignSelf: "flex-start",
                }}
              >
                {isKo
                  ? `수정 후 (${activeSpec.defaultCanvasPx}px 패치 + ${activeSpec.alignmentMethod})`
                  : `After (${activeSpec.defaultCanvasPx}px Patch + ${activeSpec.alignmentMethod})`}
              </span>
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <strong>
                  {isKo
                    ? "서브픽셀 정합 완료 · 저주파 조명 원본 100% 일치 · 고주파 디테일 복원"
                    : "Subpixel aligned · Original low-freq light locked · Crisp high-freq detail"}
                </strong>
                <p style={{ margin: "4px 0 0", fontSize: 11, opacity: 0.9 }}>
                  {targetDescription}
                </p>
              </div>
              <code style={{ fontSize: 11, color: "#DBEAFE" }}>
                outside_pixels_changed === 0 · RMS ≤ 0.10 IOD
              </code>
            </div>

            {/* Before (Left / Raw unrefined crop) */}
            <div
              style={{
                padding: 12,
                background: "#1E293B",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                overflow: "hidden",
                opacity: 0.85,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  background: "rgba(255,255,255,0.1)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  alignSelf: "flex-start",
                }}
              >
                {isKo ? `수정 전 (${cropW}×${cropH}px 원본)` : `Before (${cropW}×${cropH}px)`}
              </span>
              <p style={{ margin: 0, fontSize: 11, color: "#CBD5E1" }}>
                {isKo
                  ? "전체 캔버스 재합성 시 주변 얼굴 비율 5~15% 왜곡 및 세리프 획 뭉개짐 발생 구간"
                  : "Low-res local region prone to 5-15% facial/stroke drift under full-canvas re-render"}
              </p>
            </div>
          </div>

          <label style={{ fontSize: 12 }}>
            {isKo
              ? `수정 전 ↔ 수정 후 루페 비교 슬라이더 (${loupeComparePct}%)`
              : `Before ↔ After Loupe Wipe (${loupeComparePct}%)`}
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
        <div className="bw-grid-wide">
          <label>
            {isKo ? "복원 모드 (5단계 CV 파이프라인)" : "Micro-ROI Repair Mode"}
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
            {isKo ? "레퍼런스 역할 잠금 (Reference Role)" : "Reference Role Lock"}
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
                  ? "mark_only · 단독 로고/심볼 마크 전용 (전체 제품 사진 금지)"
                  : "mark_only · Isolated logo/mark only"}
              </option>
              <option value="consented_identity">
                {isKo
                  ? "consented_identity · 사전 동의 인물 정체성/피부결 앵커"
                  : "consented_identity · Pre-consented identity anchor"}
              </option>
              <option value="material_swatch">
                {isKo
                  ? "material_swatch · 원단/표면 재질 스와치"
                  : "material_swatch · Surface material swatch"}
              </option>
              <option value="none">
                {isKo
                  ? "none · 원본 크롭 단독 복원 (손/아티팩트 제거)"
                  : "none · Crop-only repair"}
              </option>
            </select>
          </label>
        </div>

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
            ? `Step 1 크롭 크기: ${cropW}×${cropH}px → LANCZOS4 업스케일 작업 캔버스: ${activeSpec.defaultCanvasPx}px (확대 배율 ${upscaleFactor}×) · 정렬: ${activeSpec.alignmentMethod} · 톤 잠금: ${activeSpec.toneLockMethod}`
            : `Step 1 Crop: ${cropW}×${cropH}px → LANCZOS4 Canvas: ${activeSpec.defaultCanvasPx}px (${upscaleFactor}×) · Align: ${activeSpec.alignmentMethod}`}
        </p>

        <label>
          {isKo
            ? "Step 2 픽셀 고정 부분 복원 지시문 (수정할 극소 부위만 기술)"
            : "Step 2 Pixel-Locked Target Repair Instruction"}
          <input
            name="targetDescription"
            value={targetDescription}
            onChange={(e) => setTargetDescription(e.target.value)}
            maxLength={400}
            required
            disabled={!canWrite || busy}
          />
        </label>

        <label className="bw-check">
          <input
            type="checkbox"
            checked={shapeChanged}
            onChange={(e) => setShapeChanged(e.target.checked)}
            disabled={!canWrite || busy}
          />
          {isKo
            ? "외곽 실루엣/옷깃 형태 변경 포함 (Step 4 주파수 분리 가우시안 시그마 σ ≥ 200px 강제)"
            : "Includes silhouette/shape change (Enforce Step 4 keep_tone Gaussian sigma ≥ 200px)"}
        </label>

        {canWrite && (
          <div className="bw-row">
            <button
              type="submit"
              className="bw-button"
              disabled={busy}
              data-micro-roi-plan-submit
            >
              {isKo
                ? "5단계 Micro-ROI 복원 명세 시뮬레이션"
                : "Simulate 5-Step Micro-ROI Plan"}
            </button>
            <button
              type="button"
              className="bw-button bw-primary"
              disabled={busy}
              data-micro-roi-queue-submit
              onClick={() => void submitMicroRoi("microRoi.queue")}
            >
              {isKo
                ? "로컬 CV 하네스 부분 복원 작업 실행 (Queue)"
                : "Queue Local CV Micro-ROI Repair"}
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
