"use client";

import { useState } from "react";
import {
  SPATIAL_STAGE_PRESETS,
  compileSpatialStageToShotSpec,
  type SpatialStageCompileResult,
  type SpatialStageSpec,
} from "@/lib/brands/briefs/spatial-stage";
import type { CustomerBriefView } from "@/lib/brands/briefs/schema";

export interface BrandSpatialStagePanelProps {
  organizationId: string;
  projectId?: string;
  locale: "ko" | "en";
  canWrite: boolean;
  onCompiledBrief?: (view: CustomerBriefView) => void;
}

type ActiveDragNode = "subject" | "product" | "occluder";

export function BrandSpatialStagePanel({
  organizationId,
  projectId,
  locale,
  canWrite,
  onCompiledBrief,
}: BrandSpatialStagePanelProps) {
  const isKo = locale === "ko";
  const [spec, setSpec] = useState<SpatialStageSpec>(
    () => SPATIAL_STAGE_PRESETS[0]!.spec,
  );
  const [activeNode, setActiveNode] = useState<ActiveDragNode>("subject");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [serverView, setServerView] = useState<CustomerBriefView | null>(null);

  const previewCompiled: SpatialStageCompileResult =
    compileSpatialStageToShotSpec(spec);

  function loadPreset(presetId: string) {
    const found = SPATIAL_STAGE_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setSpec(found.spec);
    setStatusMessage(
      isKo
        ? `공간 블로킹 프리셋 로드됨: ${found.labelKo}`
        : `Loaded spatial stage preset: ${found.id}`,
    );
  }

  function handleStageCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!canWrite || busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = Math.max(
      12,
      Math.min(88, Math.round(((e.clientX - rect.left) / rect.width) * 100)),
    );
    const yPct = Math.max(
      16,
      Math.min(86, Math.round(((e.clientY - rect.top) / rect.height) * 100)),
    );

    setSpec((prev) => {
      if (activeNode === "subject") {
        return { ...prev, subject: { ...prev.subject, xPct, yPct } };
      }
      if (activeNode === "product") {
        return { ...prev, product: { ...prev.product, xPct, yPct } };
      }
      return { ...prev, occluder: { ...prev.occluder, xPct, yPct } };
    });
  }

  async function submitSpatialStage() {
    if (!canWrite || busy) return;
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "brief.spatialStage",
          input: {
            organizationId,
            projectId: projectId?.trim() || undefined,
            stage: spec,
          },
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        code?: string;
        view?: CustomerBriefView;
      };
      if (!response.ok || !data.ok || !data.view) {
        setErrorMessage(
          isKo
            ? `2D 공간 블로킹 지시서 생성 실패 (${data.code ?? "invalid"})`
            : `Failed to compile spatial stage brief (${data.code ?? "invalid"})`,
        );
        return;
      }
      setServerView(data.view);
      onCompiledBrief?.(data.view);
      setStatusMessage(
        isKo
          ? "✓ 2D 공간 블로킹 좌표·광원 벡터·레퍼런스 역할 잠금이 촬영 지시서(480p 초안)로 컴파일되었습니다."
          : "✓ 2D Spatial Stage compiled into a draft shooting brief.",
      );
    } catch {
      setErrorMessage(
        isKo
          ? "네트워크 오류로 공간 블로킹 지시서를 저장하지 못했습니다."
          : "Network error while saving spatial stage brief.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bw-fields" data-brand-spatial-stage-panel>
      <div className="bw-row">
        <div>
          <p className="bw-kicker">
            {isKo
              ? "PRE-RENDER 2D SPATIAL STAGE · ARTCRAFT-GRADE MULTI-LAYER COMPOSER"
              : "PRE-RENDER 2D SPATIAL STAGE · MULTI-LAYER COMPOSER"}
          </p>
          <h3>
            {isKo
              ? "렌더링 전 2D 공간 블로킹 · 카메라·단일 광원 벡터 · @Image 1~3 단일 역할 분리 스테이지"
              : "Pre-Render 2D Spatial Stage · Camera & Unified Light Vector · Reference Role Lock"}
          </h3>
          <p className="bw-muted">
            {isKo
              ? "텍스트 프롬프트만으로 위치와 크기를 맞히느라 반복 생성하지 마세요. 캔버스 위에서 인물(화면 높이 35~50% 미드와이드 안전 캡)·히어로 제품(50mL 손바닥 실측 잠금)·전경 보케 레이어의 좌표(x%, y%)와 단일 광원 각도를 먼저 배치하면 촬영 지시서로 즉시 변환됩니다."
              : "Position subject, palm-scaled hero product, foreground depth occluder, camera optics, and unified key-light azimuth on a 2D stage before rendering."}
          </p>
        </div>
        <span className="bw-badge" data-spatial-stage-badge>
          {spec.aspectRatio} · {spec.camera.focal_mm}mm · {spec.camera.aperture}
        </span>
      </div>

      {/* Preset Selector Bar */}
      <div className="bw-row" data-spatial-stage-presets>
        {SPATIAL_STAGE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="bw-button"
            data-spatial-preset={preset.id}
            onClick={() => loadPreset(preset.id)}
            disabled={busy}
          >
            {isKo ? preset.labelKo : preset.id}
          </button>
        ))}
      </div>

      <div className="bw-grid-wide" style={{ alignItems: "stretch", gap: 16 }}>
        {/* Left: Interactive 2D Stage Canvas */}
        <div
          className="bw-card bw-fields"
          style={{ margin: 0, padding: 14, background: "#F7F8FA" }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? "① 2D 공간 블로킹 캔버스 (배치할 레이어 선택 후 클릭)"
                : "① 2D Spatial Blocking Stage (Select layer & click)"}
            </strong>
            <div style={{ display: "flex", gap: 6 }}>
              {(
                [
                  { id: "subject", ko: "👤 인물 노드", en: "👤 Subject" },
                  { id: "product", ko: "💎 제품 노드", en: "💎 Product" },
                  { id: "occluder", ko: "🌿 전경 보케", en: "🌿 Occluder" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    activeNode === item.id
                      ? "bw-button bw-primary"
                      : "bw-button"
                  }
                  onClick={() => setActiveNode(item.id)}
                  style={{ padding: "4px 9px", fontSize: 12 }}
                  data-spatial-node-select={item.id}
                >
                  {isKo ? item.ko : item.en}
                </button>
              ))}
            </div>
          </div>

          <div
            onClick={handleStageCanvasClick}
            data-spatial-stage-canvas
            role="presentation"
            style={{
              position: "relative",
              height: 280,
              borderRadius: 12,
              background:
                "radial-gradient(circle at 30% 25%, #FFFFFF 0%, #E6EEF8 55%, #CFDDF0 100%)",
              border: "1px solid rgba(15, 23, 42, 0.14)",
              overflow: "hidden",
              cursor: canWrite ? "crosshair" : "default",
            }}
          >
            {/* 15% Top/Bottom Headroom Safety Guides */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "15%",
                bottom: "15%",
                borderTop: "1px dashed rgba(56, 117, 197, 0.35)",
                borderBottom: "1px dashed rgba(56, 117, 197, 0.35)",
                pointerEvents: "none",
              }}
            />
            <span
              style={{
                position: "absolute",
                right: 8,
                top: 6,
                fontSize: 10,
                color: "#3063A7",
                fontWeight: 600,
              }}
            >
              {isKo ? "상하단 15% 헤드룸 안전 여백선" : "15% Headroom Safety Margin"}
            </span>

            {/* Key Light Direction Vector Indicator */}
            <div
              style={{
                position: "absolute",
                left: 10,
                top: 10,
                padding: "4px 8px",
                borderRadius: 999,
                background: "rgba(15, 23, 42, 0.82)",
                color: "#F8FAFC",
                fontSize: 11,
                pointerEvents: "none",
              }}
            >
              ☀️ {isKo ? "단일 주광" : "Key Light"} {spec.lightRig.keyAzimuthDeg}° /{" "}
              {spec.lightRig.keyElevationDeg}° ({spec.lightRig.colourTempK}K)
            </div>

            {/* Subject Node */}
            {spec.subject.enabled && (
              <div
                data-spatial-subject-marker
                style={{
                  position: "absolute",
                  left: `${spec.subject.xPct}%`,
                  top: `${spec.subject.yPct}%`,
                  transform: "translate(-50%, -50%)",
                  padding: "6px 10px",
                  borderRadius: 12,
                  background:
                    activeNode === "subject" ? "#16233F" : "rgba(22, 35, 63, 0.85)",
                  color: "#FFFFFF",
                  border:
                    activeNode === "subject"
                      ? "2px solid #3875C5"
                      : "1px solid rgba(255,255,255,0.4)",
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  boxShadow: "0 6px 16px rgba(15,23,42,0.18)",
                }}
              >
                👤 {spec.subject.label} ({spec.subject.xPct}%, {spec.subject.yPct}%) · H:
                { previewCompiled.normalizedSpec.subject.frameHeightPct}% ·{" "}
                {previewCompiled.normalizedSpec.subject.torsoAngleDeg}°
              </div>
            )}

            {/* Product Node */}
            {spec.product.enabled && (
              <div
                data-spatial-product-marker
                style={{
                  position: "absolute",
                  left: `${spec.product.xPct}%`,
                  top: `${spec.product.yPct}%`,
                  transform: "translate(-50%, -50%)",
                  padding: "6px 10px",
                  borderRadius: 10,
                  background: "#3875C5",
                  color: "#FFFFFF",
                  border: "2px solid #FFFFFF",
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  boxShadow: "0 6px 16px rgba(56,117,197,0.28)",
                }}
              >
                💎 {spec.product.label} ({spec.product.xPct}%, {spec.product.yPct}%) ·{" "}
                {spec.product.palmScaleLocked ? "50mL 실측 잠금" : `${spec.product.scalePct}%`}
              </div>
            )}

            {/* Foreground Occluder Node */}
            {spec.occluder.enabled && (
              <div
                data-spatial-occluder-marker
                style={{
                  position: "absolute",
                  left: `${spec.occluder.xPct}%`,
                  top: `${spec.occluder.yPct}%`,
                  transform: "translate(-50%, -50%)",
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: "rgba(255, 255, 255, 0.88)",
                  color: "#1E293B",
                  border: "1px dashed #3875C5",
                  fontSize: 10,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                🌿 {spec.occluder.label} ({spec.occluder.xPct}%, {spec.occluder.yPct}%)
              </div>
            )}
          </div>

          {/* Sliders for Subject Height, Torso Angle, Focal Length, Key Light Azimuth */}
          <div className="bw-grid-wide">
            <label style={{ fontSize: 12 }}>
              {isKo
                ? `인물 화면 높이 비중 (${previewCompiled.normalizedSpec.subject.frameHeightPct}% · 동적 35~50% 캡)`
                : `Subject Frame Height (${previewCompiled.normalizedSpec.subject.frameHeightPct}%)`}
              <input
                type="range"
                min={30}
                max={65}
                value={spec.subject.frameHeightPct}
                onChange={(e) =>
                  setSpec((prev) => ({
                    ...prev,
                    subject: {
                      ...prev.subject,
                      frameHeightPct: Number(e.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label style={{ fontSize: 12 }}>
              {isKo
                ? `인물 토르소 회전 각도 (${previewCompiled.normalizedSpec.subject.torsoAngleDeg}° · 정면 경직 차단)`
                : `Torso Rotation (${previewCompiled.normalizedSpec.subject.torsoAngleDeg}°)`}
              <input
                type="range"
                min={-60}
                max={60}
                value={spec.subject.torsoAngleDeg}
                onChange={(e) =>
                  setSpec((prev) => ({
                    ...prev,
                    subject: {
                      ...prev.subject,
                      torsoAngleDeg: Number(e.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
            <label style={{ fontSize: 12 }}>
              {isKo
                ? `카메라 렌즈 초점거리 (${spec.camera.focal_mm}mm)`
                : `Camera Focal Length (${spec.camera.focal_mm}mm)`}
              <select
                value={spec.camera.focal_mm}
                onChange={(e) =>
                  setSpec((prev) => ({
                    ...prev,
                    camera: {
                      ...prev.camera,
                      focal_mm: Number(e.currentTarget.value),
                    },
                  }))
                }
              >
                <option value={35}>35mm (공간감 워킹 미드와이드)</option>
                <option value={50}>50mm (표준 내추럴 에디토리얼)</option>
                <option value={85}>85mm (인물·제품 포트레이트 압축)</option>
                <option value={100}>100mm (매크로 보틀·질감 클로즈업)</option>
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              {isKo
                ? `단일 주광 방위각 (${spec.lightRig.keyAzimuthDeg}° · 그림자 벡터 통일)`
                : `Key Light Azimuth (${spec.lightRig.keyAzimuthDeg}°)`}
              <input
                type="range"
                min={-135}
                max={135}
                value={spec.lightRig.keyAzimuthDeg}
                onChange={(e) =>
                  setSpec((prev) => ({
                    ...prev,
                    lightRig: {
                      ...prev.lightRig,
                      keyAzimuthDeg: Number(e.currentTarget.value),
                    },
                  }))
                }
              />
            </label>
          </div>
        </div>

        {/* Right: Multi-Asset Reference Layer Stack (@Image 1..3) + Diagnostics */}
        <div
          className="bw-card bw-fields"
          style={{ margin: 0, padding: 14, background: "#F7F8FA" }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? "② 멀티 레퍼런스 단일 역할 분리 스택 (@Image 1~3)"
                : "② Reference Layer Single-Authority Stack (@Image 1..3)"}
            </strong>
            <span className="bw-badge">
              {previewCompiled.diagnostics.antiCompositeLightingVerified
                ? isKo
                  ? "합성티(Anti-Composite) 광원 잠금"
                  : "Anti-Composite Locked"
                : ""}
            </span>
          </div>

          <div className="bw-fields" data-spatial-reference-stack>
            {previewCompiled.normalizedSpec.referenceStack.map((slot) => (
              <div
                key={slot.tag}
                style={{
                  padding: "9px 11px",
                  borderRadius: 10,
                  background: "#FFFFFF",
                  border: "1px solid rgba(15, 23, 42, 0.1)",
                  fontSize: 12,
                }}
              >
                <div className="bw-row">
                  <strong>
                    <code>{slot.tag}</code> · {slot.assetTitle}
                  </strong>
                  <span className="bw-badge">{slot.role}</span>
                </div>
                <p className="bw-muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                  ✓ {isKo ? "제어 권한(Controls)" : "Controls"}:{" "}
                  {slot.controls.join(", ")}
                </p>
                <p className="bw-muted" style={{ margin: "2px 0 0", fontSize: 11 }}>
                  ✕ {isKo ? "간섭 차단(Ignore)" : "Ignore"}: {slot.ignore.join(", ")}
                </p>
              </div>
            ))}
          </div>

          <div
            className="bw-note"
            data-spatial-compiled-preview
            style={{ fontSize: 12 }}
          >
            <strong>
              {isKo
                ? "실시간 컴파일된 공간 블로킹 지시문"
                : "Compiled Spatial Blocking Directive"}
            </strong>
            <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
              {isKo
                ? previewCompiled.spatialPromptKo
                : previewCompiled.spatialPromptEn}
            </p>
          </div>

          {previewCompiled.diagnostics.warnings.length > 0 && (
            <ul className="bw-list" style={{ fontSize: 12 }}>
              {previewCompiled.diagnostics.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {canWrite && (
            <div className="bw-row">
              <button
                type="button"
                className="bw-button bw-primary"
                onClick={() => void submitSpatialStage()}
                disabled={busy}
                data-spatial-stage-submit
              >
                {isKo
                  ? "이 2D 공간 블로킹으로 촬영 지시서(480p 초안) 생성"
                  : "Compile Spatial Stage into Draft Brief"}
              </button>
            </div>
          )}

          {errorMessage && (
            <p role="alert" className="bw-error">
              {errorMessage}
            </p>
          )}
          {statusMessage && (
            <p role="status" className="bw-note" data-spatial-stage-status>
              {statusMessage}
            </p>
          )}
          {serverView && (
            <p className="bw-muted" data-spatial-stage-compiled-id>
              {isKo
                ? `생성된 지시서 ID: ${serverView.id.slice(0, 8)} · ${serverView.grammarLabel.ko} · ${serverView.resolution}`
                : `Brief ID: ${serverView.id.slice(0, 8)} · ${serverView.grammarLabel.en}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
