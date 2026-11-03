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

export interface BrandBriefStudioProps {
  organizationId: string;
  locale: "ko" | "en";
  canWrite: boolean;
  identityConfirmed: boolean;
  defaultChecklist?: readonly string[];
  identityHref?: string;
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
}: BrandBriefStudioProps) {
  const isKo = locale === "ko";

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

  async function onCompileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite || busy) return;
    const result = await callWorkspaceOperation("brief.compile", {
      organizationId,
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
        spaceBackground,
        spaceSurface,
      },
    });
    if (result) {
      setBriefState(result.brief);
      setView(result.view);
      setAestheticGatePassed(false);
      setStatusMessage(
        isKo
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
    </section>
  );
}
