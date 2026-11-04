"use client";

import { useState } from "react";

export type StudioFocusMode =
  | "all"
  | "spatial_brief"
  | "video_reverse"
  | "micro_roi"
  | "sound_studio"
  | "frame_review";

export interface BrandStudioTutorialProps {
  locale: "ko" | "en";
  activeMode: StudioFocusMode;
  onSelectMode: (mode: StudioFocusMode) => void;
}

const STUDIO_PLAYBOOK_STEPS: ReadonlyArray<{
  stepNumber: number;
  mode: StudioFocusMode;
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  badgeKo: string;
  actionLabelKo: string;
  actionLabelEn: string;
}> = [
  {
    stepNumber: 1,
    mode: "spatial_brief",
    titleKo: "① 2D 공간 블로킹 & 7종 문법 촬영 지시서",
    titleEn: "① 2D Spatial Blocking & 7-Grammar Shooting Brief",
    summaryKo:
      "렌더링 전에 인물(35~50% 미드와이드 안전 비율)·제품(50mL 손바닥 실측 잠금)·전경 보케의 좌표(x%, y%)와 단일 광원 각도를 배치하고 480p 초안 지시서를 생성합니다.",
    summaryEn:
      "Block subject, palm-scaled product, and unified key-light angle on a 2D stage before compiling a 480p draft brief.",
    badgeKo: "ArtCraft식 공간 블로킹",
    actionLabelKo: "① 공간 블로킹·지시서 열기",
    actionLabelEn: "Open Spatial Stage",
  },
  {
    stepNumber: 2,
    mode: "video_reverse",
    titleKo: "② 레퍼런스 영상 0.1초 역설계 & 브랜드 치환",
    titleEn: "② Reference Video Reverse-Engineering & Brand Swap",
    summaryKo:
      "검증된 바이럴·런웨이 레퍼런스의 카메라 옵티컬 플로우와 서브초(0.7~0.9s) 컷 리듬만 보존하고, 제품·의상·색채는 브랜드 고유 자산으로 치환합니다.",
    summaryEn:
      "Preserve reference camera choreography and sub-second cut beats while swapping in your brand product and palette.",
    badgeKo: "다각도 교차 · 2단계 마스터",
    actionLabelKo: "② 레퍼런스 영상 역설계 열기",
    actionLabelEn: "Open Video Reverse Engine",
  },
  {
    stepNumber: 3,
    mode: "micro_roi",
    titleKo: "③ 극소 부위(Micro-ROI) 5단계 무손실 복원",
    titleEn: "③ 5-Step Micro-ROI Zero-Leak Precision Repair",
    summaryKo:
      "전체 재합성으로 얼굴이나 조명이 왜곡되는 것을 막기 위해 고칠 부위(로고·손가락·표정 1~2mm)만 1440px로 확대 복원한 뒤 ECC/랜드마크 정렬과 주파수 분리로 주변 픽셀 변화 0(outside_pixels_changed === 0)을 보장합니다.",
    summaryEn:
      "Crop only the target 180-400px patch to 1440px, align subpixel via ECC/MediaPipe, lock low-frequency tone, and composite with zero outside pixel drift.",
    badgeKo: "outside_pixels_changed === 0",
    actionLabelKo: "③ 극소 부위 5단계 수선 열기",
    actionLabelEn: "Open Micro-ROI Repair",
  },
  {
    stepNumber: 4,
    mode: "sound_studio",
    titleKo: "④ 3트랙 사운드·BGM 마스터 & 0ms 드롭 동기화",
    titleEn: "④ 3-Track Sound & BGM Master & 0ms Drop Sync",
    summaryKo:
      "5.5kHz 이상 디지털 노이즈를 제거하고, 리드 악기가 지정된 상업용 인스트루멘탈 스코어를 영상 클라이맥스(T_reveal)에 0ms 오차로 맞춘 뒤 -14.0 LUFS / -1.0 dBTP로 마스터링합니다.",
    summaryEn:
      "Align commercial-safe instrumental BGM drop to T_reveal with 0ms offset and master through an 8-stage EBU R128 chain (-14.0 LUFS).",
    badgeKo: "0ms 드롭 · -14.0 LUFS",
    actionLabelKo: "④ 사운드·BGM 마스터 열기",
    actionLabelEn: "Open Sound & BGM Studio",
  },
  {
    stepNumber: 5,
    mode: "frame_review",
    titleKo: "⑤ Frame.io급 공간 핀(x%, y%) 시사 & 원클릭 핸드오프",
    titleEn: "⑤ Frame.io-Grade Spatial Frame Pin Review & Handoff",
    summaryKo:
      "영상 위 원하는 위치를 클릭해 @MM:SS.FF · (x%, y%) 핀을 찍고, 버튼 하나로 해당 좌표를 극소 부위 5단계 수선 박스로 넘기거나 0ms 음악 드롭 기준점으로 즉시 지정합니다.",
    summaryEn:
      "Click any video frame to drop a spatial pin and hand off coordinates directly to Micro-ROI repair or 0ms Music Drop sync.",
    badgeKo: "무로그인 임원 공유 · 파이프라인 직결",
    actionLabelKo: "⑤ 공간 핀 시사 스테이지 열기",
    actionLabelEn: "Open Frame Review Stage",
  },
];

export function BrandStudioTutorial({
  locale,
  activeMode,
  onSelectMode,
}: BrandStudioTutorialProps) {
  const isKo = locale === "ko";
  const [expanded, setExpanded] = useState<boolean>(true);
  const [completedSteps, setCompletedSteps] = useState<number[]>([1]);

  function handleStepJump(stepNumber: number, mode: StudioFocusMode) {
    if (!completedSteps.includes(stepNumber)) {
      setCompletedSteps((prev) => [...prev, stepNumber]);
    }
    onSelectMode(mode);
  }

  return (
    <section
      className="bw-card bw-fields"
      data-brand-studio-tutorial
      style={{
        background:
          "linear-gradient(180deg, #FFFFFF 0%, #F7F9FC 100%)",
        border: "1px solid rgba(56, 117, 197, 0.24)",
      }}
    >
      <div className="bw-row">
        <div>
          <p className="bw-kicker">
            {isKo
              ? "60-SECOND INTERACTIVE PLAYBOOK · 프로그레시브 스튜디오 가이드"
              : "60-SECOND INTERACTIVE PLAYBOOK · PROGRESSIVE STUDIO GUIDE"}
          </p>
          <h2 style={{ margin: "2px 0 4px" }}>
            {isKo
              ? "처음 오셨나요? 5단계 프로덕션 워크플로우 중 필요한 도구만 골라 바로 실행하세요"
              : "5-Step Brand Production Workflow — Choose a focused tool or view all"}
          </h2>
          <p className="bw-muted" style={{ margin: 0 }}>
            {isKo
              ? "기능이 많아도 복잡하지 않습니다. 상단 모드 탭을 누르면 해당 작업 화면만 집중해서 볼 수 있고, 시사 스테이지에서 찍은 핀 좌표는 극소 부위 수선과 사운드 드롭으로 자동 연결됩니다."
              : "Switch between focused studio modes or run the full integrated pipeline."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="bw-badge" data-tutorial-progress-badge>
            {isKo
              ? `가이드 탐색 ${completedSteps.length}/5 완료`
              : `${completedSteps.length}/5 Explored`}
          </span>
          <button
            type="button"
            className="bw-button"
            onClick={() => setExpanded((prev) => !prev)}
            data-tutorial-collapse-toggle
          >
            {expanded
              ? isKo
                ? "가이드 카드 접기 ▲"
                : "Hide Playbook ▲"
              : isKo
                ? "5단계 플레이북 펼치기 ▼"
                : "Show Playbook ▼"}
          </button>
        </div>
      </div>

      {/* Progressive Studio Mode Switcher Bar */}
      <div
        className="bw-row"
        role="tablist"
        aria-label={isKo ? "스튜디오 작업 모드 전환" : "Studio focus mode switcher"}
        data-studio-mode-tabs
        style={{
          padding: "8px 10px",
          borderRadius: 12,
          background: "#EEF3F9",
          gap: 6,
        }}
      >
        {(
          [
            { id: "all", ko: "전체 통합 스튜디오 (All-in-One)", en: "All-in-One Studio" },
            { id: "spatial_brief", ko: "① 2D 공간 블로킹·지시서", en: "① 2D Spatial Stage & Brief" },
            { id: "video_reverse", ko: "② 레퍼런스 영상 역설계", en: "② Video Reverse Engine" },
            { id: "micro_roi", ko: "③ 극소 부위 5단계 수선", en: "③ 5-Step Micro-ROI Repair" },
            { id: "sound_studio", ko: "④ 사운드·BGM 마스터", en: "④ Sound & BGM Master" },
            { id: "frame_review", ko: "⑤ Frame.io급 공간 핀 시사", en: "⑤ Frame Review & Share" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeMode === tab.id}
            className={
              activeMode === tab.id ? "bw-button bw-primary" : "bw-button"
            }
            data-studio-mode-tab={tab.id}
            onClick={() => onSelectMode(tab.id)}
          >
            {isKo ? tab.ko : tab.en}
          </button>
        ))}
      </div>

      {/* Collapsible 5-Step Interactive Playbook Cards */}
      {expanded && (
        <div
          data-studio-playbook-cards
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {STUDIO_PLAYBOOK_STEPS.map((item) => {
            const isDone = completedSteps.includes(item.stepNumber);
            const isCurrent = activeMode === item.mode;
            return (
              <div
                key={item.stepNumber}
                data-playbook-step={item.stepNumber}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: isCurrent ? "#EBF3FC" : "#FFFFFF",
                  border: isCurrent
                    ? "1.5px solid #3875C5"
                    : "1px solid rgba(15, 23, 42, 0.1)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div>
                  <div className="bw-row">
                    <span className="bw-badge">
                      {isDone ? "✓ " : ""}
                      {item.badgeKo}
                    </span>
                  </div>
                  <strong style={{ display: "block", marginTop: 6, fontSize: 13 }}>
                    {isKo ? item.titleKo : item.titleEn}
                  </strong>
                  <p className="bw-muted" style={{ margin: "4px 0 0", fontSize: 11.5 }}>
                    {isKo ? item.summaryKo : item.summaryEn}
                  </p>
                </div>
                <button
                  type="button"
                  className="bw-button"
                  data-playbook-try-btn={item.mode}
                  onClick={() => handleStepJump(item.stepNumber, item.mode)}
                  style={{ width: "100%", justifyContent: "center", fontSize: 12 }}
                >
                  {isKo ? item.actionLabelKo : item.actionLabelEn}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
