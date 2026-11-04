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
  previewImg: string;
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
    mode: "video_reverse",
    previewImg: "/reel/landing/v7/rx-runway-duo.jpg",
    titleKo: "레퍼런스 영상 리믹스",
    titleEn: "Remix a Reference Film",
    summaryKo:
      "마음에 드는 캠페인 영상의 카메라 무빙과 컷 리듬은 그대로 두고, 제품과 색감만 우리 브랜드로 바꿉니다.",
    summaryEn:
      "Keep the camera movement and cut rhythm of a reference film while swapping in your product and palette.",
    badgeKo: "가장 많이 쓰는 시작점",
    actionLabelKo: "레퍼런스 리믹스 시작하기",
    actionLabelEn: "Start Film Remix",
  },
  {
    stepNumber: 2,
    mode: "spatial_brief",
    previewImg: "/reel/landing/look-sculpt.webp",
    titleKo: "구도 잡아서 새 화보·필름 찍기",
    titleEn: "Compose a New Look or Still",
    summaryKo:
      "화면 위에서 모델과 향수병·제품의 위치만 마우스로 놓으면, 비율과 조명을 맞춰 초안을 뽑아줍니다.",
    summaryEn:
      "Place your subject and palm-sized product on the 2D stage to generate a balanced draft.",
    badgeKo: "2D 구도 배치",
    actionLabelKo: "구도 잡기 시작하기",
    actionLabelEn: "Open 2D Stage",
  },
  {
    stepNumber: 3,
    mode: "micro_roi",
    previewImg: "/reel/landing/c-logo-ours.webp",
    titleKo: "흐린 로고·제품·피부만 부분 복원",
    titleEn: "Fix Logo, Bottle, or Skin Detail",
    summaryKo:
      "전체 사진을 다시 뽑지 않고, 네모로 찍은 로고·병 모양·피부 질감만 원본 그대로 선명하게 고칩니다.",
    summaryEn:
      "Repair only the selected box—logo, bottle, or skin—without changing a single pixel outside.",
    badgeKo: "주변 픽셀 변화 0%",
    actionLabelKo: "부분 복원 열기",
    actionLabelEn: "Open Detail Repair",
  },
  {
    stepNumber: 4,
    mode: "sound_studio",
    previewImg: "/reel/landing/v7/rx-beauty-product.jpg",
    titleKo: "클라이맥스 사운드 & BGM 맞추기",
    titleEn: "Sync Climax Sound & BGM",
    summaryKo:
      "제품이 클로즈업되는 순간에 딱 맞춰 음악 하이라이트와 실사 효과음이 터지도록 마스터링합니다.",
    summaryEn:
      "Align commercial BGM and live Foley to the exact product reveal moment.",
    badgeKo: "0ms 드롭 싱크",
    actionLabelKo: "사운드 맞추기",
    actionLabelEn: "Open Sound Studio",
  },
  {
    stepNumber: 5,
    mode: "frame_review",
    previewImg: "/reel/landing/v7/rx-beauty-world.jpg",
    titleKo: "프레임 핀 피드백 & 팀 공유",
    titleEn: "Frame Pin Review & Team Share",
    summaryKo:
      "영상 위 고칠 곳을 콕 찍어 메모를 남기거나, 로그인 없는 시사 링크로 팀·클라이언트 승인을 받습니다.",
    summaryEn:
      "Click any frame to pin feedback or share a zero-login review link with your team.",
    badgeKo: "링크 하나로 시사 공유",
    actionLabelKo: "시사·공유 열기",
    actionLabelEn: "Open Review Stage",
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
        padding: "24px",
        borderRadius: "24px",
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "var(--ys-card)",
      }}
    >
      <div className="bw-row" style={{ alignItems: "flex-start" }}>
        <div>
          <p className="bw-kicker" style={{ marginBottom: 4 }}>
            {isKo ? "STUDIO WORKFLOW · 오늘 무엇을 만들까요?" : "STUDIO WORKFLOW · WHAT ARE WE MAKING TODAY?"}
          </p>
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 600, letterSpacing: "-0.03em" }}>
            {isKo
              ? "원하는 작업 카드 하나를 고르면 그 작업에 필요한 화면만 깔끔하게 열립니다"
              : "Pick one visual workflow below—only the tools you need for that step will open"}
          </h2>
          <p className="bw-muted" style={{ margin: 0, fontSize: 14 }}>
            {isKo
              ? "복잡한 카메라 수치나 프롬프트 문법은 몰라도 됩니다. 예시 화면을 보고 고르면 브랜드 색감과 제품 규칙은 스튜디오가 자동으로 맞춥니다."
              : "No need to configure camera numbers or prompt syntax. Pick a card and let your brand memory handle the rules."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <span className="bw-badge" data-tutorial-progress-badge>
            {isKo ? `${completedSteps.length}/5 단계 체험` : `${completedSteps.length}/5 Explored`}
          </span>
          <button
            type="button"
            className="bw-button"
            onClick={() => setExpanded((prev) => !prev)}
            data-tutorial-collapse-toggle
            style={{ borderRadius: 999 }}
          >
            {expanded
              ? isKo
                ? "카드 접기"
                : "Hide Cards"
              : isKo
                ? "작업 카드 보기"
                : "Show Cards"}
          </button>
        </div>
      </div>

      {/* Clean Pill Mode Bar */}
      <div
        className="bw-row"
        role="tablist"
        aria-label={isKo ? "스튜디오 작업 모드 전환" : "Studio focus mode switcher"}
        data-studio-mode-tabs
        style={{
          padding: "6px",
          borderRadius: 999,
          background: "#F3F4F6",
          gap: 6,
          overflowX: "auto",
        }}
      >
        {(
          [
            { id: "video_reverse", ko: "① 레퍼런스 영상 리믹스", en: "① Film Remix" },
            { id: "spatial_brief", ko: "② 2D 구도·새 화보", en: "② 2D Stage & Look" },
            { id: "micro_roi", ko: "③ 로고·제품·피부 부분 복원", en: "③ Detail Repair" },
            { id: "sound_studio", ko: "④ 사운드·BGM 맞추기", en: "④ Sound & BGM" },
            { id: "frame_review", ko: "⑤ 프레임 핀 시사·공유", en: "⑤ Frame Review" },
            { id: "all", ko: "전체 도구 한눈에 보기", en: "All Tools" },
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
            style={{ borderRadius: 999, fontSize: 13 }}
          >
            {isKo ? tab.ko : tab.en}
          </button>
        ))}
      </div>

      {/* Visual Media Cards */}
      {expanded && (
        <div
          data-studio-playbook-cards
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 14,
          }}
        >
          {STUDIO_PLAYBOOK_STEPS.map((item) => {
            const isCurrent = activeMode === item.mode;
            return (
              <div
                key={item.stepNumber}
                data-playbook-step={item.stepNumber}
                onClick={() => handleStepJump(item.stepNumber, item.mode)}
                style={{
                  padding: 12,
                  borderRadius: 20,
                  background: isCurrent ? "#F4F8FD" : "#F8F9FA",
                  border: isCurrent
                    ? "1.5px solid #3875C5"
                    : "1px solid rgba(0, 0, 0, 0.06)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 10,
                  cursor: "pointer",
                  transition: "border-color 180ms ease, transform 180ms ease",
                }}
              >
                <div>
                  <div
                    style={{
                      height: 118,
                      borderRadius: 14,
                      overflow: "hidden",
                      background: "#E8EFF7",
                      position: "relative",
                      marginBottom: 10,
                    }}
                  >
                    <img
                      src={item.previewImg}
                      alt=""
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        left: 8,
                        top: 8,
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: isCurrent ? "#3875C5" : "rgba(18, 18, 22, 0.68)",
                        color: "#FFFFFF",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {item.badgeKo}
                    </span>
                  </div>
                  <strong style={{ display: "block", fontSize: 14, letterSpacing: "-0.02em" }}>
                    {isKo ? item.titleKo : item.titleEn}
                  </strong>
                  <p className="bw-muted" style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>
                    {isKo ? item.summaryKo : item.summaryEn}
                  </p>
                </div>
                <button
                  type="button"
                  className={isCurrent ? "bw-button bw-primary" : "bw-button"}
                  data-playbook-try-btn={item.mode}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStepJump(item.stepNumber, item.mode);
                  }}
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    fontSize: 12.5,
                    borderRadius: 999,
                  }}
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
