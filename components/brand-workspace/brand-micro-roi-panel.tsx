"use client";

import { useState, type FormEvent } from "react";
import {
  MICRO_ROI_MODES,
  MICRO_ROI_MODE_SPECS,
  type BrandMicroRoiPlanView,
  type MicroRoiMode,
} from "@/lib/brands/finish/micro-roi";
import type { LocalFixReferenceKind } from "@/lib/brands/finish/local-fix";

export interface BrandMicroRoiPanelProps {
  organizationId: string;
  projectId?: string;
  locale: "ko" | "en";
  canWrite: boolean;
}

const QUICK_ROI_PRESETS: Record<
  string,
  {
    labelKo: string;
    labelEn: string;
    mode: MicroRoiMode;
    box: { x0: number; y0: number; x1: number; y1: number };
    referenceKind: LocalFixReferenceKind;
    targetDescriptionKo: string;
    targetDescriptionEn: string;
  }
> = {
  logo_chest: {
    labelKo: "① 브랜드 로고·심볼 정밀 복원 (1440px ECC + 스케일 잠금)",
    labelEn: "① Brand Logo & Mark Lock (1440px ECC + Scale Lock)",
    mode: "logo_mark_lock",
    box: { x0: 700, y0: 530, x1: 920, y1: 750 },
    referenceKind: "mark_only",
    targetDescriptionKo: "의상/용기 전면 브랜드 심볼과 타이포그래피 획 선명도 복원",
    targetDescriptionEn: "Restore crisp brand symbol and typography stroke geometry",
  },
  hand_skin_patch: {
    labelKo: "② 극소 부위 패치 (볼의 손 제거 · 의류 주름 · 피부 패치)",
    labelEn: "② Micro-ROI Patch (Hand Removal / Garment / Skin Patch)",
    mode: "micro_patch_ecc",
    box: { x0: 880, y0: 180, x1: 1280, y1: 580 },
    referenceKind: "none",
    targetDescriptionKo: "볼/턱선 주변 불필요한 손가락 아티팩트 제거 및 자연스러운 피부결 복원",
    targetDescriptionEn: "Remove stray hand artifact near cheek/jaw and restore natural skin texture",
  },
  full_body_face: {
    labelKo: "③ 전신 샷 얼굴 디테일 복원 (1400px 비균일 피부결·홍채)",
    labelEn: "③ Full-Body Face Detail Refine (1400px Pores & Iris)",
    mode: "face_detail_refine",
    box: { x0: 758, y0: 38, x1: 1290, y1: 563 },
    referenceKind: "consented_identity",
    targetDescriptionKo: "전신 화보의 작은 얼굴에 실제 피부 모공·홍채 캐치라이트·속눈썹 디테일 복원",
    targetDescriptionEn: "Restore realistic non-uniform skin pores, iris catchlights, and eyelashes",
  },
  expression_retake: {
    labelKo: "④ MediaPipe 478점 국소 표정 리테이크 (눈·눈썹·입매 전용)",
    labelEn: "④ MediaPipe 478-Point Expression Retake (Eyes / Brows / Mouth)",
    mode: "expression_au_retake",
    box: { x0: 573, y0: 0, x1: 1474, y1: 768 },
    referenceKind: "consented_identity",
    targetDescriptionKo: "얼굴형·코·볼·조명은 100% 유지한 채 눈매 시선과 자연스러운 입꼬리만 리테이크",
    targetDescriptionEn: "Retake only eye gaze and mouth corners while keeping skull, nose, and cheeks 100% original",
  },
};

export function BrandMicroRoiPanel({
  organizationId,
  projectId,
  locale,
  canWrite,
}: BrandMicroRoiPanelProps) {
  const isKo = locale === "ko";

  const [mode, setMode] = useState<MicroRoiMode>("logo_mark_lock");
  const [x0, setX0] = useState(700);
  const [y0, setY0] = useState(530);
  const [x1, setX1] = useState(920);
  const [y1, setY1] = useState(750);
  const [imageWidth, setImageWidth] = useState(2048);
  const [imageHeight, setImageHeight] = useState(2560);
  const [referenceKind, setReferenceKind] =
    useState<LocalFixReferenceKind>("mark_only");
  const [targetDescription, setTargetDescription] = useState(
    isKo
      ? "의상/용기 전면 브랜드 심볼과 타이포그래피 획 선명도 복원"
      : "Restore crisp brand symbol and typography stroke geometry"
  );
  const [shapeChanged, setShapeChanged] = useState(false);
  const [planView, setPlanView] = useState<BrandMicroRoiPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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
            ? `Step 1 크롭 크기: ${cropW}×${cropH}px → LANCZOS4 업스케일 작업 캔버스: ${activeSpec.defaultCanvasPx}px (확대 배율 ${(activeSpec.defaultCanvasPx / Math.max(cropW, cropH)).toFixed(2)}×) · 정렬: ${activeSpec.alignmentMethod} · 톤 잠금: ${activeSpec.toneLockMethod}`
            : `Step 1 Crop: ${cropW}×${cropH}px → LANCZOS4 Canvas: ${activeSpec.defaultCanvasPx}px (${(activeSpec.defaultCanvasPx / Math.max(cropW, cropH)).toFixed(2)}×) · Align: ${activeSpec.alignmentMethod}`}
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
