"use client";

import { useEffect, useState } from "react";
import {
  CAMERA_ANGLE_LABELS,
  PreserveChangeMatrixSchema,
  VIDEO_REVERSE_PRESETS,
  compileVideoReverseAdaptation,
  type PreserveChangeMatrix,
} from "@/lib/brands/briefs/video-reverse-engine";
import { markConfirmedBrandIdentity, twingsDefaultIdentity } from "@/lib/brands/identity/service";
import type { CustomerBriefView } from "@/lib/brands/briefs/schema";
import {
  BRAND_MUSIC_STUDIO_PRESETS,
  LEAD_INSTRUMENT_ARCHETYPES,
  buildBrandSoundAndMusicStudioPlan,
  type BrandSoundAndMusicStudioPlan,
  type LeadInstrumentArchetype,
} from "@/lib/brands/sound/music-studio";

export interface BrandVideoReversePanelProps {
  organizationId: string;
  projectId?: string;
  locale: "ko" | "en";
  canWrite: boolean;
  externalRevealSec?: number | null;
  onCompiledBrief?: (view: CustomerBriefView) => void;
}

export function BrandVideoReversePanel({
  organizationId,
  projectId,
  locale,
  canWrite,
  externalRevealSec,
  onCompiledBrief,
}: BrandVideoReversePanelProps) {
  const isKo = locale === "ko";

  // Video Reverse-Engineering State
  const [selectedVideoPresetId, setSelectedVideoPresetId] =
    useState<string>("runway_flash_15s");
  const [matrix, setMatrix] = useState<PreserveChangeMatrix>(() =>
    PreserveChangeMatrixSchema.parse({}),
  );
  const [busyVideo, setBusyVideo] = useState(false);
  const [videoStatus, setVideoStatus] = useState("");
  const [videoError, setVideoError] = useState("");
  const [compiledBriefView, setCompiledBriefView] =
    useState<CustomerBriefView | null>(null);

  // 3-Track Music & Sound Director Studio State
  const [selectedMusicPresetId, setSelectedMusicPresetId] = useState<string>(
    "french_house_runway_122",
  );
  const [leadInstrument, setLeadInstrument] = useState<LeadInstrumentArchetype>(
    "mellow Rhodes lead melody",
  );
  const [bpm, setBpm] = useState<number>(122);
  const [videoRevealSec, setVideoRevealSec] = useState<number>(3.8);
  const [trackDropSec, setTrackDropSec] = useState<number>(8.0);
  const [preDropHushMs, setPreDropHushMs] = useState<number>(180);
  const [busySound, setBusySound] = useState(false);
  const [soundStatus, setSoundStatus] = useState("");
  const [soundError, setSoundError] = useState("");
  const [serverSoundPlan, setServerSoundPlan] =
    useState<BrandSoundAndMusicStudioPlan | null>(null);

  const activeAnalysis =
    VIDEO_REVERSE_PRESETS[selectedVideoPresetId] ??
    VIDEO_REVERSE_PRESETS.runway_flash_15s!;

  useEffect(() => {
    if (typeof externalRevealSec === "number" && externalRevealSec > 0) {
      setVideoRevealSec(externalRevealSec);
      setSoundStatus(
        isKo
          ? `시사 스테이지에서 전달된 0ms 드롭 기준점(T_reveal = ${externalRevealSec}s)이 자동 반영되었습니다.`
          : `Synced 0ms drop anchor (T_reveal = ${externalRevealSec}s) from Review Stage.`,
      );
    }
  }, [externalRevealSec, isKo]);

  const previewAdaptation = compileVideoReverseAdaptation({
    analysis: activeAnalysis,
    matrix,
    identity: markConfirmedBrandIdentity(twingsDefaultIdentity()),
  });

  const activeMusicPreset =
    BRAND_MUSIC_STUDIO_PRESETS.find((p) => p.id === selectedMusicPresetId) ??
    BRAND_MUSIC_STUDIO_PRESETS[0]!;

  const previewSoundPlan =
    serverSoundPlan ??
    buildBrandSoundAndMusicStudioPlan({
      score: {
        ...activeMusicPreset.score,
        leadInstrument,
        bpm,
        trackDropSec,
        editBrief: {
          ...activeMusicPreset.score.editBrief,
          preDropHushWindowMs: preDropHushMs,
        },
      },
      videoDurationSec: activeAnalysis.pacing_summary.duration_s,
      videoRevealSec,
    });

  function selectVideoPreset(presetId: string) {
    const target = VIDEO_REVERSE_PRESETS[presetId];
    if (!target) return;
    setSelectedVideoPresetId(presetId);
    setVideoRevealSec(target.pacing_summary.reveal_timestamp_s);
    setBpm(target.audio_telemetry.bpm);
    setVideoStatus(
      isKo
        ? `레퍼런스 텔레메트리 로드 완료: ${target.title.ko} (클라이맥스 리빌 ${target.pacing_summary.reveal_timestamp_s}s)`
        : `Loaded reference telemetry: ${target.title.en}`,
    );
  }

  function selectMusicPreset(presetId: string) {
    const found = BRAND_MUSIC_STUDIO_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setSelectedMusicPresetId(presetId);
    setLeadInstrument(found.score.leadInstrument);
    setBpm(found.score.bpm);
    setTrackDropSec(found.score.trackDropSec);
    setVideoRevealSec(found.videoRevealSec);
    setServerSoundPlan(null);
  }

  async function submitVideoReverseBrief() {
    if (!canWrite || busyVideo) return;
    setBusyVideo(true);
    setVideoError("");
    setVideoStatus("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "brief.videoReverse",
          input: {
            organizationId,
            projectId: projectId?.trim() || undefined,
            presetId: selectedVideoPresetId,
            matrix,
          },
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        code?: string;
        view?: CustomerBriefView;
      };
      if (!response.ok || !data.ok || !data.view) {
        setVideoError(
          isKo
            ? `레퍼런스 영상 역설계 컴파일 실패 (${data.code ?? "invalid"})`
            : `Failed to compile reverse-engineered video brief (${data.code ?? "invalid"})`,
        );
        return;
      }
      setCompiledBriefView(data.view);
      onCompiledBrief?.(data.view);
      setVideoStatus(
        isKo
          ? "✓ 레퍼런스 영상 카메라 모션·서브초 컷 리듬은 보존하고 브랜드 제품·색채·무광 피부결로 치환한 2단계(480p 초안 → 1080p 마스터) 촬영 지시서가 생성되었습니다."
          : "✓ Reverse-engineered video adaptation brief compiled (480p Draft -> 1080p Master).",
      );
    } catch {
      setVideoError(
        isKo
          ? "네트워크 오류로 레퍼런스 역설계 지시서를 생성하지 못했습니다."
          : "Network error while compiling video reverse brief.",
      );
    } finally {
      setBusyVideo(false);
    }
  }

  async function submitSoundStudioPlan() {
    if (!canWrite || busySound) return;
    setBusySound(true);
    setSoundError("");
    setSoundStatus("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "soundStudio.plan",
          input: {
            organizationId,
            presetId: selectedMusicPresetId,
            score: {
              ...activeMusicPreset.score,
              leadInstrument,
              bpm,
              trackDropSec,
              editBrief: {
                ...activeMusicPreset.score.editBrief,
                preDropHushWindowMs: preDropHushMs,
              },
            },
            videoDurationSec: activeAnalysis.pacing_summary.duration_s,
            videoRevealSec,
          },
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        code?: string;
        plan?: BrandSoundAndMusicStudioPlan;
      };
      if (!response.ok || !data.ok || !data.plan) {
        setSoundError(
          isKo
            ? `사운드·BGM 마스터 설계 실패 (${data.code ?? "invalid"})`
            : `Failed to build Sound & Music Studio plan (${data.code ?? "invalid"})`,
        );
        return;
      }
      setServerSoundPlan(data.plan);
      setSoundStatus(
        isKo
          ? `✓ 3트랙 사운드·BGM 마스터 플랜 확정 완료: 드롭 오프셋 ${data.plan.trackB_dropSync.alignedOffsetMs}ms · 8단계 브로드캐스트 마스터링(-14.0 LUFS / -1.0 dBTP) · 상업용 라이선스 게이트 통과`
          : `✓ 3-Track Sound & Music Studio plan locked (0ms drop sync, -14.0 LUFS / -1.0 dBTP).`,
      );
    } catch {
      setSoundError(
        isKo
          ? "네트워크 오류로 사운드·BGM 마스터 플랜을 저장하지 못했습니다."
          : "Network error while saving Sound & Music Studio plan.",
      );
    } finally {
      setBusySound(false);
    }
  }

  return (
    <div className="bw-fields" data-brand-video-reverse-panel>
      {/* Part 1: Reference Video Reverse-Engineering & Preserve/Change Adaptation Engine */}
      <div className="bw-card bw-fields" style={{ margin: 0 }}>
        <div className="bw-row">
          <div>
            <p className="bw-kicker">
              {isKo
                ? "REFERENCE VIDEO REVERSE-ENGINEERING · 0.1S OPTICAL FLOW TELEMETRY"
                : "REFERENCE VIDEO REVERSE-ENGINEERING · 0.1S TELEMETRY"}
            </p>
            <h3>
              {isKo
                ? "레퍼런스 영상 역설계 엔진 · 보존(Preserve) vs 브랜드 치환(Change) 매트릭스"
                : "Reference Video Reverse-Engineering · Preserve vs Brand Change Matrix"}
            </h3>
            <p className="bw-muted">
              {isKo
                ? "레퍼런스 영상의 원본 파일이나 프레임은 외부 생성 모델에 절대 전송하지 않습니다(저작권·초상권 원천 보호). 대신 0.1초 단위 옵티컬 플로우로 추출한 카메라 이동 속도(pan/tilt/radial_divergence), 서브초(0.7~0.9초) 컷 리듬, 클라이맥스 리빌 타이밍(T_reveal)만 뼈대로 보존하고, 피사체·보틀 기하·의상·색채는 브랜드 고유 자산으로 100% 치환합니다."
                : "Extracts 0.1s camera optical flow, sub-second cut rhythm, and climax reveal timing while replacing product geometry, wardrobe, and colour palette with your brand assets."}
            </p>
          </div>
          <span className="bw-badge" data-video-reverse-badge>
            {activeAnalysis.aspect} · {activeAnalysis.pacing_summary.duration_s}s ·{" "}
            {activeAnalysis.pacing_summary.shot_count} Shots
          </span>
        </div>

        {/* Reference Video Preset Buttons */}
        <div className="bw-row" data-video-reverse-presets>
          {Object.values(VIDEO_REVERSE_PRESETS).map((preset) => (
            <button
              key={preset.referenceId}
              type="button"
              className={
                selectedVideoPresetId === preset.referenceId
                  ? "bw-button bw-primary"
                  : "bw-button"
              }
              data-video-reverse-preset={preset.referenceId}
              onClick={() => selectVideoPreset(preset.referenceId)}
              disabled={busyVideo}
            >
              {isKo ? preset.title.ko : preset.title.en}
            </button>
          ))}
        </div>

        {/* Shot-by-Shot Optical Flow Telemetry & Angle Alternation Strip */}
        <div
          className="bw-fields"
          data-video-reverse-telemetry-strip
          style={{
            padding: 12,
            borderRadius: 12,
            background: "#F7F8FA",
            border: "1px solid rgba(15, 23, 42, 0.1)",
          }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? `샷별 카메라 옵티컬 플로우 텔레메트리 & 다각도 교차 검증 (연속 동일 앵글 자동 교정 ${previewAdaptation.adaptationSummary.angleAlternationFixes}건 · 서브초 푸시인 보강 ${previewAdaptation.adaptationSummary.subsecondPushInFixes}건)`
                : "Shot-by-Shot Optical Flow Telemetry & Multi-Angle Alternation"}
            </strong>
            <span className="bw-badge">
              T_reveal = {activeAnalysis.pacing_summary.reveal_timestamp_s}s ·{" "}
              {activeAnalysis.audio_telemetry.bpm} BPM
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 8,
            }}
          >
            {activeAnalysis.shots.map((shot) => {
              const durationSec = (shot.end_s - shot.start_s).toFixed(1);
              const isRevealShot =
                activeAnalysis.pacing_summary.reveal_timestamp_s >= shot.start_s &&
                activeAnalysis.pacing_summary.reveal_timestamp_s < shot.end_s;
              return (
                <div
                  key={shot.shot}
                  style={{
                    padding: "9px 10px",
                    borderRadius: 10,
                    background: isRevealShot ? "#EBF3FC" : "#FFFFFF",
                    border: isRevealShot
                      ? "1.5px solid #3875C5"
                      : "1px solid rgba(15, 23, 42, 0.1)",
                    fontSize: 12,
                  }}
                >
                  <div className="bw-row">
                    <strong>
                      Shot {shot.shot} ({shot.start_s.toFixed(1)}~{shot.end_s.toFixed(1)}s ·{" "}
                      {durationSec}s)
                    </strong>
                    <span className="bw-badge">{shot.focal_mm}mm</span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#3063A7", fontWeight: 600 }}>
                    {isKo
                      ? CAMERA_ANGLE_LABELS[shot.camera_analysis.angle].ko
                      : CAMERA_ANGLE_LABELS[shot.camera_analysis.angle].en}{" "}
                    · H:{shot.camera_analysis.screen_anchor.subject_height_pct}%
                  </p>
                  <p className="bw-muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                    {shot.action_mechanism}
                  </p>
                  {shot.sfx_cue && (
                    <p style={{ margin: "4px 0 0", fontSize: 10, color: "#475569" }}>
                      🎙️ Foley: {shot.sfx_cue}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Preserve vs Change Matrix Controls */}
        <div className="bw-grid-wide">
          <div
            className="bw-card bw-fields"
            style={{ margin: 0, padding: 12, background: "#F7F8FA" }}
          >
            <strong>
              {isKo
                ? "① 보존할 레퍼런스 연출 뼈대 (Preserve)"
                : "① Reference Structure to Preserve"}
            </strong>
            <label className="bw-check">
              <input
                type="checkbox"
                checked={matrix.preserve.cameraChoreography}
                onChange={(e) =>
                  setMatrix((prev) => ({
                    ...prev,
                    preserve: {
                      ...prev.preserve,
                      cameraChoreography: e.target.checked,
                    },
                  }))
                }
              />
              {isKo
                ? "카메라 이동 궤적(Pan/Tilt/Radial Push-In) 및 렌즈 화각 보존"
                : "Preserve camera choreography & focal progression"}
            </label>
            <label className="bw-check">
              <input
                type="checkbox"
                checked={matrix.preserve.cutRhythmAndSubsecondBeats}
                onChange={(e) =>
                  setMatrix((prev) => ({
                    ...prev,
                    preserve: {
                      ...prev.preserve,
                      cutRhythmAndSubsecondBeats: e.target.checked,
                    },
                  }))
                }
              />
              {isKo
                ? "서브초(0.7~0.9s) 하드컷 리듬 & 매치컷 타이밍 보존"
                : "Preserve sub-second cut rhythm & match cuts"}
            </label>
            <label className="bw-check">
              <input
                type="checkbox"
                checked={matrix.preserve.revealClimaxTiming}
                onChange={(e) =>
                  setMatrix((prev) => ({
                    ...prev,
                    preserve: {
                      ...prev.preserve,
                      revealClimaxTiming: e.target.checked,
                    },
                  }))
                }
              />
              {isKo
                ? `클라이맥스 제품 리빌 타임스탬프(T_reveal = ${activeAnalysis.pacing_summary.reveal_timestamp_s}s) 앵커 고정`
                : "Preserve climax reveal timestamp (T_reveal)"}
            </label>
          </div>

          <div
            className="bw-card bw-fields"
            style={{ margin: 0, padding: 12, background: "#F7F8FA" }}
          >
            <strong>
              {isKo
                ? "② 치환할 브랜드 고유 에셋 및 물리 법칙 (Change & Locks)"
                : "② Brand Assets & Physical Laws to Apply"}
            </strong>
            <label style={{ fontSize: 12 }}>
              {isKo ? "치환할 브랜드 히어로 제품명" : "Brand Hero Product Name"}
              <input
                type="text"
                value={matrix.change.brandProductName}
                onChange={(e) =>
                  setMatrix((prev) => ({
                    ...prev,
                    change: {
                      ...prev.change,
                      brandProductName: e.target.value,
                    },
                  }))
                }
              />
            </label>
            <label style={{ fontSize: 12 }}>
              {isKo
                ? "용기 기하·스케일 잠금 (50mL 손바닥 실측 · 펌프 스템 · 라벨)"
                : "Vessel Geometry & Palm-Scale Lock"}
              <input
                type="text"
                value={matrix.change.brandProductGeometryLock}
                onChange={(e) =>
                  setMatrix((prev) => ({
                    ...prev,
                    change: {
                      ...prev.change,
                      brandProductGeometryLock: e.target.value,
                    },
                  }))
                }
              />
            </label>
            <label className="bw-check">
              <input
                type="checkbox"
                checked={matrix.change.enforceStrictNoBgm}
                onChange={(e) =>
                  setMatrix((prev) => ({
                    ...prev,
                    change: {
                      ...prev.change,
                      enforceStrictNoBgm: e.target.checked,
                    },
                  }))
                }
              />
              {isKo
                ? "생성 단계 Strict No-BGM (실사 폴리만 생성 → 5.5kHz+ 크래클 제거 후 아래 사운드 스튜디오에서 상업용 BGM 마스터 결합)"
                : "Enforce Strict No-BGM during video generation (diegetic foley only)"}
            </label>
          </div>
        </div>

        {/* Two-Stage Gate Summary */}
        <div className="bw-note" data-video-reverse-two-stage-gate style={{ fontSize: 12 }}>
          <strong>
            {isKo
              ? "2단계 검증 게이트 (Two-Stage Render Gate): Stage 1 [480p 고속 드래프트 검수] → Stage 2 [1080p CFR 24fps 마스터 + OLED 에디토리얼 룩 + -14.0 LUFS 사운드 마스터]"
              : "Two-Stage Render Gate: Stage 1 (480p Draft) -> Stage 2 (1080p Master + -14.0 LUFS)"}
          </strong>
        </div>

        {canWrite && (
          <div className="bw-row">
            <button
              type="button"
              className="bw-button bw-primary"
              onClick={() => void submitVideoReverseBrief()}
              disabled={busyVideo}
              data-video-reverse-submit
            >
              {isKo
                ? "레퍼런스 역설계 기반 브랜드 촬영 지시서(480p 초안) 컴파일"
                : "Compile Reverse-Engineered Brand Brief (480p Draft)"}
            </button>
          </div>
        )}

        {videoError && (
          <p role="alert" className="bw-error">
            {videoError}
          </p>
        )}
        {videoStatus && (
          <p role="status" className="bw-note" data-video-reverse-status>
            {videoStatus}
          </p>
        )}
        {compiledBriefView && (
          <p className="bw-muted" data-video-reverse-compiled-id>
            {isKo
              ? `생성된 타임라인 지시서 ID: ${compiledBriefView.id.slice(0, 8)} · ${compiledBriefView.grammarLabel.ko}`
              : `Compiled Timeline Brief ID: ${compiledBriefView.id.slice(0, 8)}`}
          </p>
        )}
      </div>

      {/* Part 2: 3-Track Brand Music & Sound Director Studio */}
      <div
        className="bw-card bw-fields"
        data-brand-music-studio-panel
        style={{ margin: 0 }}
      >
        <div className="bw-row">
          <div>
            <p className="bw-kicker">
              {isKo
                ? "3-TRACK BRAND SOUND & MUSIC STUDIO · 0MS DROP SYNC & 8-STAGE MASTERING"
                : "3-TRACK BRAND SOUND & MUSIC STUDIO · 0MS DROP SYNC"}
            </p>
            <h3>
              {isKo
                ? "상업용 인스트루멘탈 BGM 스코어 설계 · 0ms 클라이맥스 드롭 슬라이서 · 8단계 브로드캐스트 마스터링 (-14.0 LUFS)"
                : "Commercial Instrumental BGM Architect · 0ms Climax Drop Sync · 8-Stage Mastering"}
            </h3>
            <p className="bw-muted">
              {isKo
                ? "생성형 영상의 원본 오디오에 섞인 5.5kHz 이상 디지털 노이즈를 제거하고, ① 리드 악기가 명시된 상업용 인스트루멘탈 스코어(보컬 스템 간섭 원천 차단 + L:1/32 듀얼 보이스 악보 검증), ② 영상 클라이맥스 리빌(T_reveal) 프레임과 음악 드롭을 0ms 오차로 맞추는 슬라이서, ③ 8단계 브로드캐스트 마스터링 체인(-14.0 LUFS / -1.0 dBTP)으로 통합 마스터와 클린 폴리 스템(No-BGM) 2종을 동시에 출력합니다."
                : "Combines commercial-safe instrumental BGM scoring, 0ms visual climax drop slicing, and 8-stage EBU R128 broadcast mastering (-14.0 LUFS / -1.0 dBTP)."}
            </p>
          </div>
          <span className="bw-badge" data-music-studio-badge>
            {previewSoundPlan.trackB_dropSync.alignedOffsetMs}ms Sync · -14.0 LUFS
          </span>
        </div>

        {/* Music Studio Presets */}
        <div className="bw-row" data-music-studio-presets>
          {BRAND_MUSIC_STUDIO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={
                selectedMusicPresetId === preset.id
                  ? "bw-button bw-primary"
                  : "bw-button"
              }
              data-music-studio-preset={preset.id}
              onClick={() => selectMusicPreset(preset.id)}
              disabled={busySound}
            >
              {isKo ? preset.labelKo : preset.id}
            </button>
          ))}
        </div>

        {/* 3-Track Grid */}
        <div className="bw-grid-wide" style={{ alignItems: "stretch", gap: 14 }}>
          {/* Track A: Instrumental Score & Style Tag Architect */}
          <div
            className="bw-card bw-fields"
            data-sound-track-a
            style={{ margin: 0, padding: 12, background: "#F7F8FA" }}
          >
            <div className="bw-row">
              <strong>
                {isKo
                  ? "Track A · 인스트루멘탈 스코어 & 편집 지시서"
                  : "Track A · Instrumental Score & Edit Brief"}
              </strong>
              <span className="bw-badge">
                {previewSoundPlan.trackA_score.abcScore.meter} · L:
                {previewSoundPlan.trackA_score.abcScore.unitNoteLength}
              </span>
            </div>

            <label style={{ fontSize: 12 }}>
              {isKo
                ? "명시적 리드 악기 지정 (보컬 스템 누수 원천 차단)"
                : "Named Lead Instrument (Prevents Vocal Bleed)"}
              <select
                value={leadInstrument}
                onChange={(e) =>
                  setLeadInstrument(e.currentTarget.value as LeadInstrumentArchetype)
                }
              >
                {LEAD_INSTRUMENT_ARCHETYPES.map((inst) => (
                  <option key={inst} value={inst}>
                    {inst}
                  </option>
                ))}
              </select>
            </label>

            <div className="bw-grid-wide">
              <label style={{ fontSize: 12 }}>
                BPM ({bpm})
                <input
                  type="number"
                  min={60}
                  max={180}
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.currentTarget.value) || 120)}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                {isKo
                  ? `드롭 직전 무음 텐션 윈도우 (${preDropHushMs}ms)`
                  : `Pre-Drop Hush Window (${preDropHushMs}ms)`}
                <input
                  type="number"
                  min={0}
                  max={500}
                  step={20}
                  value={preDropHushMs}
                  onChange={(e) =>
                    setPreDropHushMs(Number(e.currentTarget.value) || 180)
                  }
                />
              </label>
            </div>

            <p className="bw-muted" style={{ fontSize: 11, margin: 0 }}>
              <strong>Style Formula:</strong>{" "}
              <code>{previewSoundPlan.trackA_score.styleTagPrompt}</code>
            </p>
            <p className="bw-muted" style={{ fontSize: 11, margin: 0 }}>
              ✓ {previewSoundPlan.trackA_score.editBriefSummaryKo}
            </p>
          </div>

          {/* Track B: 0ms Visual Climax Drop Slicer */}
          <div
            className="bw-card bw-fields"
            data-sound-track-b
            style={{ margin: 0, padding: 12, background: "#F7F8FA" }}
          >
            <div className="bw-row">
              <strong>
                {isKo
                  ? "Track B · 0ms 클라이맥스 드롭 동기화 슬라이서"
                  : "Track B · 0ms Visual Climax Drop Slicer"}
              </strong>
              <span className="bw-badge" data-drop-sync-offset>
                오프셋 {previewSoundPlan.trackB_dropSync.alignedOffsetMs}ms
              </span>
            </div>

            <div className="bw-grid-wide">
              <label style={{ fontSize: 12 }}>
                {isKo
                  ? "영상 클라이맥스 리빌 시각 T_reveal (초)"
                  : "Video Reveal T_reveal (s)"}
                <input
                  type="number"
                  step={0.1}
                  min={0.5}
                  max={25}
                  value={videoRevealSec}
                  onChange={(e) =>
                    setVideoRevealSec(Number(e.currentTarget.value) || 3.8)
                  }
                />
              </label>
              <label style={{ fontSize: 12 }}>
                {isKo
                  ? "원본 음원 하이라이트 드롭 시각 T_drop (초)"
                  : "Track Drop T_drop (s)"}
                <input
                  type="number"
                  step={0.1}
                  min={1.5}
                  max={40}
                  value={trackDropSec}
                  onChange={(e) =>
                    setTrackDropSec(Number(e.currentTarget.value) || 8.0)
                  }
                />
              </label>
            </div>

            <div
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "#FFFFFF",
                border: "1px solid rgba(15, 23, 42, 0.1)",
                fontSize: 12,
              }}
            >
              <div>
                <strong>슬라이스 구간 [T_drop - T_reveal, +D]:</strong>{" "}
                <code>
                  [{previewSoundPlan.trackB_dropSync.sliceStartSec}s ~{" "}
                  {previewSoundPlan.trackB_dropSync.sliceEndSec}s]
                </code>
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#3063A7" }}>
                ✓ 드롭 직전 정적 구간:{" "}
                <code>
                  {previewSoundPlan.trackB_dropSync.preDropSilenceStartSec}s ~{" "}
                  {previewSoundPlan.trackB_dropSync.preDropSilenceEndSec}s
                </code>{" "}
                · 마디 길이 {previewSoundPlan.trackB_dropSync.barDurationSec}s
              </div>
            </div>

            <ul className="bw-list" style={{ fontSize: 11, margin: 0 }}>
              {previewSoundPlan.trackC_mastering.snappedCues.map((cue) => (
                <li key={cue.id}>
                  <code>@{cue.frameTimestampSec.toFixed(2)}s</code> [{cue.act}]{" "}
                  {cue.description} ({cue.levelDb} dB)
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Track C: 8-Stage Broadcast Mastering Chain & Dual Stems */}
        <div
          className="bw-card bw-fields"
          data-sound-track-c
          style={{ margin: 0, padding: 12, background: "#F7F8FA" }}
        >
          <div className="bw-row">
            <strong>
              {isKo
                ? "Track C · 8단계 브로드캐스트 마스터링 체인 & 듀얼 스템 납품 규격"
                : "Track C · 8-Stage Broadcast Mastering & Dual Deliverable Stems"}
            </strong>
            <span className="bw-badge">
              {previewSoundPlan.trackA_score.licenseGate.commercialAllowed
                ? isKo
                  ? "✓ 상업용 라이선스 검증 통과"
                  : "✓ Commercial License Verified"
                : isKo
                  ? "⚠ 비상업 음원 차단됨"
                  : "⚠ License Blocked"}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 8,
            }}
          >
            {previewSoundPlan.trackC_mastering.stages.map((stage) => (
              <div
                key={stage.code}
                style={{
                  padding: "7px 9px",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  border: "1px solid rgba(15, 23, 42, 0.08)",
                  fontSize: 11,
                }}
              >
                <strong style={{ display: "block", color: "#0F172A" }}>
                  {stage.titleKo}
                </strong>
                <span className="bw-muted">{stage.parameterSummary}</span>
              </div>
            ))}
          </div>

          <div className="bw-row" style={{ marginTop: 4 }}>
            <span className="bw-badge">
              ① {previewSoundPlan.trackC_mastering.deliverableStems.masterWithBgm.labelKo}
            </span>
            <span className="bw-badge">
              ② {previewSoundPlan.trackC_mastering.deliverableStems.cleanFoleyOnly.labelKo}
            </span>
          </div>

          {canWrite && (
            <div className="bw-row">
              <button
                type="button"
                className="bw-button bw-primary"
                onClick={() => void submitSoundStudioPlan()}
                disabled={busySound}
                data-sound-studio-submit
              >
                {isKo
                  ? "3트랙 사운드·BGM 마스터 및 0ms 드롭 슬라이스 확정"
                  : "Lock 3-Track Sound & Music Master Plan"}
              </button>
            </div>
          )}

          {soundError && (
            <p role="alert" className="bw-error">
              {soundError}
            </p>
          )}
          {soundStatus && (
            <p role="status" className="bw-note" data-sound-studio-status>
              {soundStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
