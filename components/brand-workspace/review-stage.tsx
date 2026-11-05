"use client";

import { useRef, useState } from "react";
import {
  spatialPinToMicroRoiBox,
  type MicroRoiBox,
  type MicroRoiTargetMode,
  type ReviewHandoffKind,
} from "@/lib/brands/review/service";
import type {
  BrandContentVersion,
  BrandDecision,
  BrandMessage,
} from "@/lib/brands/workspace/types";
import {
  DEFAULT_SHARE_LINK_CONFIG,
  buildCollageFolders,
  buildSharePreviewUrl,
  getBrandWorkspaceTourSteps,
  type DeliverableApprovalStatus,
  type ReleasePlatformId,
  type ShareLayoutMode,
  type ShareLinkConfig,
  type SmartCollectionId,
} from "@/lib/brands/workspace/commission-tracks";
import {
  auditMultiShotContinuity,
  buildTwoStageApprovalAndReelsMasterPlan,
  compileOledCinemaColorGradePlan,
  evaluateOpticalIdentityLockV2,
  getOledCinemaLookCatalog,
  type OledCinemaLookId,
  type TwoStageGateStatus,
} from "@/lib/brands/production-pipeline/video-creator-techniques";

type TimecodePin = {
  id: string;
  seconds: number;
  label: string;
  author: "studio" | "brand";
  body: string;
  xPct?: number;
  yPct?: number;
  handoffKind?: ReviewHandoffKind;
  microRoiMode?: MicroRoiTargetMode;
};

interface DeliverableCardItem {
  id: string;
  title: string;
  version: number;
  duration: string;
  aspect: string;
  updatedAt: string;
  status: DeliverableApprovalStatus;
  platform: ReleasePlatformId;
  mediaUrl: string;
}

export function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00.00";
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  const hundredths = Math.floor((sec - Math.floor(sec)) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function extractTimecodePins(
  messages: readonly BrandMessage[],
  decisions: readonly BrandDecision[],
): TimecodePin[] {
  const pins: TimecodePin[] = [];
  const regex = /\[?@?\s*(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]?/;

  for (const m of messages) {
    const match = regex.exec(m.body);
    if (match) {
      const mins = Number.parseInt(match[1]!, 10);
      const secs = Number.parseInt(match[2]!, 10);
      const frac = match[3] ? Number.parseInt(match[3].padEnd(2, "0"), 10) / 100 : 0;
      const total = mins * 60 + secs + frac;
      pins.push({
        id: `msg-${m.id}`,
        seconds: total,
        label: formatTimecode(total),
        author: m.authorRole,
        body: m.body,
        xPct: 54,
        yPct: 58,
      });
    }
  }

  for (const d of decisions) {
    if (!d.comment) continue;
    const match = regex.exec(d.comment);
    if (match) {
      const mins = Number.parseInt(match[1]!, 10);
      const secs = Number.parseInt(match[2]!, 10);
      const frac = match[3] ? Number.parseInt(match[3].padEnd(2, "0"), 10) / 100 : 0;
      const total = mins * 60 + secs + frac;
      pins.push({
        id: `dec-${d.id}`,
        seconds: total,
        label: formatTimecode(total),
        author: "brand",
        body: d.comment,
        xPct: 48,
        yPct: 52,
      });
    }
  }

  if (pins.length === 0) {
    return [
      {
        id: "guide-hook",
        seconds: 1.8,
        label: "00:01.80",
        author: "studio",
        body: "초반 2초 훅 — 메인 시선 집중 구간",
        xPct: 42,
        yPct: 44,
        handoffKind: "general_comment",
      },
      {
        id: "guide-product",
        seconds: 3.8,
        label: "00:03.80",
        author: "studio",
        body: "메인 제품 클로즈업 — 전면 라벨 및 용기 디테일",
        xPct: 58,
        yPct: 62,
        handoffKind: "send_to_micro_roi",
        microRoiMode: "brand_logo_packaging",
      },
      {
        id: "guide-payoff",
        seconds: 12.0,
        label: "00:12.00",
        author: "studio",
        body: "엔딩 컷 — 단상 제품 안착 및 브랜드 로고",
        xPct: 52,
        yPct: 66,
        handoffKind: "general_comment",
      },
    ];
  }

  return pins;
}

export function ReviewStage({
  projectId,
  contents,
  messages,
  decisions,
  locale,
  generativeMediaAllowed = true,
  productionMode = "creator",
  deferVideoMount = false,
  onSendPinToMicroRoi,
  onSetMusicDropRevealSec,
}: {
  projectId: string;
  contents: readonly BrandContentVersion[];
  messages: readonly BrandMessage[];
  decisions: readonly BrandDecision[];
  locale: string;
  generativeMediaAllowed?: boolean;
  productionMode?: "creator" | "studio";
  deferVideoMount?: boolean;
  onSendPinToMicroRoi?: (payload: {
    box: MicroRoiBox;
    mode: MicroRoiTargetMode;
    note: string;
    timestampSec: number;
    xPct: number;
    yPct: number;
  }) => void;
  onSetMusicDropRevealSec?: (revealSec: number) => void;
}) {
  const isKo = locale === "ko";
  const isEn = !isKo;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageOverlayRef = useRef<HTMLDivElement | null>(null);

  const sorted = [...contents].sort((a, b) => b.version - a.version);
  const [selectedVersionId, setSelectedVersionId] = useState<string>(
    sorted[0]?.id ?? "demo-preview",
  );
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [audioStemMode, setAudioStemMode] = useState<"master_with_bgm" | "clean_foley_only">(
    "master_with_bgm",
  );
  const [videoMounted, setVideoMounted] = useState<boolean>(!deferVideoMount);
  const [playing, setPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(3.8);
  const [duration, setDuration] = useState<number>(15);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [shareScope, setShareScope] = useState<"comment_only" | "allow_approve">(
    "comment_only",
  );
  const [pinProtected, setPinProtected] = useState<boolean>(false);
  const [shareCopied, setShareCopied] = useState<boolean>(false);
  const [stampedNotice, setStampedNotice] = useState<string | null>(null);

  // Frame.io V4 Interactive Guided Tour state
  const tourSteps = getBrandWorkspaceTourSteps({
    generativeClosed: !generativeMediaAllowed,
    locale,
  });
  const [tourOpen, setTourOpen] = useState<boolean>(false);
  const [tourIndex, setTourIndex] = useState<number>(0);
  const activeTourStep = tourSteps[tourIndex] ?? tourSteps[0]!;

  // Playbook + Frame.io V4 Smart Collection & Collage Folders state
  const [activeCollection, setActiveCollection] = useState<SmartCollectionId>("all");
  const [activeFolderId, setActiveFolderId] = useState<string>("review_cuts");
  const collageFolders = buildCollageFolders({
    projectId,
    locale,
    contents: sorted,
  });

  // Frame.io V4 Deliverable Status & Release Platform metadata cards
  const initialDeliverables: DeliverableCardItem[] =
    sorted.length > 0
      ? sorted.map((c, idx) => ({
          id: c.id,
          title: `${c.title}_v${c.version}.mp4`,
          version: c.version,
          duration: "00:15",
          aspect: idx % 2 === 0 ? "9:16" : "4:5",
          updatedAt: isEn ? "Updated today" : "오늘 업데이트",
          status:
            c.decision === "approved"
              ? "ready_for_release"
              : c.decision === "changes_requested"
                ? "needs_revision"
                : "awaiting_approval",
          platform: idx === 0 ? "instagram_reels" : "tiktok",
          mediaUrl: c.mediaUrl,
        }))
      : [
          {
            id: "deliv-9x16-v2",
            title: "MASTER_CUT_15S_FINAL_9x16.mp4",
            version: 2,
            duration: "00:15",
            aspect: "9:16",
            updatedAt: isEn ? "Updated 18m ago" : "18분 전 업데이트",
            status: "awaiting_approval",
            platform: "instagram_reels",
            mediaUrl: "/reel/brands/house-runway-1080p.mp4",
          },
          {
            id: "deliv-4x5-v2",
            title: "MASTER_CUT_15S_FEED_4x5.mp4",
            version: 2,
            duration: "00:15",
            aspect: "4:5",
            updatedAt: isEn ? "Updated 1h ago" : "1시간 전 업데이트",
            status: "ready_for_release",
            platform: "tiktok",
            mediaUrl: "/reel/brands/studio-editorial-blue-1080p.mp4",
          },
          {
            id: "deliv-16x9-v1",
            title: "FIRST_CUT_15S_WIDE_16x9.mp4",
            version: 1,
            duration: "00:15",
            aspect: "16:9",
            updatedAt: isEn ? "Yesterday" : "어제 업데이트",
            status: "needs_revision",
            platform: "youtube_shorts",
            mediaUrl: "/reel/brands/house-french-blue-hero-1080p.mp4",
          },
        ];

  const [deliverables, setDeliverables] = useState<DeliverableCardItem[]>(initialDeliverables);

  // Frame.io V4 Share Link Builder state
  const [shareConfig, setShareConfig] = useState<ShareLinkConfig>(DEFAULT_SHARE_LINK_CONFIG);
  const [shareBuilderOpen, setShareBuilderOpen] = useState<boolean>(false);

  // Spatial Frame Pinning state
  const [spatialPinMode, setSpatialPinMode] = useState<boolean>(true);
  const [cursorCoords, setCursorCoords] = useState<{ xPct: number; yPct: number }>({
    xPct: 58,
    yPct: 62,
  });
  const [customPins, setCustomPins] = useState<TimecodePin[]>([]);
  const [pinNoteDraft, setPinNoteDraft] = useState<string>(
    "제품 전면 라벨 글자 선명도 및 용기 반사광 다듬기",
  );
  const [pinRoiMode, setPinRoiMode] = useState<MicroRoiTargetMode>("brand_logo_packaging");
  const [handoffBanner, setHandoffBanner] = useState<string | null>(null);

  // Customer Utility State — Video-Creator Latest SOTA Techniques
  const [twoStageGate, setTwoStageGate] = useState<TwoStageGateStatus>("stage2_1080p_master");
  const [selectedOledLook, setSelectedOledLook] = useState<OledCinemaLookId>("oled-editorial-punch");
  const [safeZoneOverlayOn, setSafeZoneOverlayOn] = useState<boolean>(false);
  const [stemDownloadNotice, setStemDownloadNotice] = useState<string | null>(null);

  const oledLookCatalog = getOledCinemaLookCatalog(locale);
  const activeOledPlan = compileOledCinemaColorGradePlan({
    lookId: selectedOledLook,
    locale,
  });
  const continuityAudit = auditMultiShotContinuity({
    clipCount: Math.max(3, deliverables.length),
    locale,
  });
  const opticalIdentityReport = evaluateOpticalIdentityLockV2({
    focalLengthMm: 50,
    headWidthRatioPct: 44,
    hasFaceOcclusion: false,
    locale,
  });
  const twoStagePlan = buildTwoStageApprovalAndReelsMasterPlan({
    gateStatus: twoStageGate,
    revealTimestampSec: currentTime > 0 ? currentTime : 3.8,
    locale,
  });

  const activeContent =
    sorted.find((c) => c.id === selectedVersionId) ?? sorted[0] ?? null;
  const previousContent =
    sorted.find((c) => c.id !== activeContent?.id) ?? null;

  const basePins = extractTimecodePins(messages, decisions);
  const pins = [...customPins, ...basePins];

  const activeVersionNumber = activeContent?.version ?? 2;
  const shareUrl = buildSharePreviewUrl(projectId, activeVersionNumber, shareConfig);

  const togglePlay = () => {
    if (!videoMounted) {
      setVideoMounted(true);
      setPlaying(true);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const stepFrame = (deltaFrames: number) => {
    const v = videoRef.current;
    const next = Math.max(0, Math.min(duration, currentTime + deltaFrames * (1 / 24)));
    if (v) {
      v.pause();
      v.currentTime = next;
    }
    setPlaying(false);
    setCurrentTime(next);
  };

  const seekTo = (sec: number, coords?: { xPct?: number; yPct?: number }) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(duration, sec));
    if (v) {
      v.currentTime = clamped;
    }
    setCurrentTime(clamped);
    if (coords?.xPct !== undefined && coords?.yPct !== undefined) {
      setCursorCoords({ xPct: coords.xPct, yPct: coords.yPct });
    }
  };

  const cycleSpeed = () => {
    const rates = [0.5, 1, 1.5] as const;
    const next = rates[(rates.indexOf(playbackRate as 0.5 | 1 | 1.5) + 1) % rates.length]!;
    setPlaybackRate(next);
    if (videoRef.current) {
      videoRef.current.playbackRate = next;
    }
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!spatialPinMode) {
      togglePlay();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = Math.max(4, Math.min(96, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const yPct = Math.max(4, Math.min(96, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setPlaying(false);
    }
    setCursorCoords({ xPct, yPct });
  };

  const stampTimecodeToComment = () => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setPlaying(false);
    }
    const code = `[@${formatTimecode(currentTime)} · (${cursorCoords.xPct}%, ${cursorCoords.yPct}%)] `;
    if (typeof document !== "undefined") {
      const reviewArea = document.querySelector<HTMLTextAreaElement>(
        '#review textarea[name="comment"]',
      );
      const threadArea = document.querySelector<HTMLTextAreaElement>(
        '#conversation textarea[name="body"]',
      );
      const target = reviewArea ?? threadArea;
      if (target) {
        target.value = target.value ? `${target.value.trim()} ${code}` : code;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.focus();
      }
    }
    const newPin: TimecodePin = {
      id: `spatial-${Date.now()}`,
      seconds: currentTime,
      label: formatTimecode(currentTime),
      author: "brand",
      body: pinNoteDraft.trim() || "프레임 좌표 핀 코멘트",
      xPct: cursorCoords.xPct,
      yPct: cursorCoords.yPct,
      handoffKind: "general_comment",
    };
    setCustomPins((prev) => [newPin, ...prev]);
    setStampedNotice(`${formatTimecode(currentTime)} (${cursorCoords.xPct}%, ${cursorCoords.yPct}%)`);
    setTimeout(() => setStampedNotice(null), 2600);
  };

  const triggerMicroRoiHandoff = () => {
    const box = spatialPinToMicroRoiBox({
      xPct: cursorCoords.xPct,
      yPct: cursorCoords.yPct,
      canvasWidth: 2048,
      canvasHeight: 2048,
      mode: pinRoiMode,
    });
    const note =
      pinNoteDraft.trim() ||
      `@${formatTimecode(currentTime)} (${cursorCoords.xPct}%, ${cursorCoords.yPct}%) 극소 부위 수선`;
    const newPin: TimecodePin = {
      id: `roi-pin-${Date.now()}`,
      seconds: currentTime,
      label: formatTimecode(currentTime),
      author: "brand",
      body: `[극소 부위 수선 전달] ${note} → ROI (${box.x0}, ${box.y0})~(${box.x1}, ${box.y1})`,
      xPct: cursorCoords.xPct,
      yPct: cursorCoords.yPct,
      handoffKind: "send_to_micro_roi",
      microRoiMode: pinRoiMode,
    };
    setCustomPins((prev) => [newPin, ...prev]);
    onSendPinToMicroRoi?.({
      box,
      mode: pinRoiMode,
      note,
      timestampSec: currentTime,
      xPct: cursorCoords.xPct,
      yPct: cursorCoords.yPct,
    });
    setHandoffBanner(
      isKo
        ? `✓ @${formatTimecode(currentTime)} 좌표(${cursorCoords.xPct}%, ${cursorCoords.yPct}%)가 2K 안전 크롭 박스 (${box.x0}, ${box.y0})~(${box.x1}, ${box.y1})로 변환되어 극소 부위 5단계 수선 패널로 전달되었습니다.`
        : `✓ Sent @${formatTimecode(currentTime)} (${cursorCoords.xPct}%, ${cursorCoords.yPct}%) → Micro-ROI Box (${box.x0}, ${box.y0})-(${box.x1}, ${box.y1}).`,
    );
  };

  const triggerMusicDropHandoff = () => {
    const roundedSec = Number(currentTime.toFixed(2));
    const newPin: TimecodePin = {
      id: `drop-pin-${Date.now()}`,
      seconds: roundedSec,
      label: formatTimecode(roundedSec),
      author: "studio",
      body: `[0ms 음악 드롭 기준점(T_reveal) 잠금] @${formatTimecode(roundedSec)} 프레임에 음악 하이라이트 드롭 0ms 정렬`,
      xPct: cursorCoords.xPct,
      yPct: cursorCoords.yPct,
      handoffKind: "set_as_music_drop",
    };
    setCustomPins((prev) => [newPin, ...prev]);
    onSetMusicDropRevealSec?.(roundedSec);
    setHandoffBanner(
      isKo
        ? `✓ @${formatTimecode(roundedSec)} (${roundedSec}s) 프레임이 사운드·BGM 마스터의 0ms 클라이맥스 드롭 기준점(T_reveal)으로 즉시 동기화되었습니다.`
        : `✓ Locked @${formatTimecode(roundedSec)} (${roundedSec}s) as 0ms Music Climax Drop (T_reveal).`,
    );
  };

  const copyShareLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2600);
  };

  function updateDeliverableStatus(id: string, status: DeliverableApprovalStatus) {
    setDeliverables((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  }

  function updateDeliverablePlatform(id: string, platform: ReleasePlatformId) {
    setDeliverables((prev) =>
      prev.map((item) => (item.id === id ? { ...item, platform } : item)),
    );
  }

  const filteredDeliverables = deliverables.filter((d) => {
    if (activeCollection === "all" || activeCollection === "source_assets") return true;
    if (activeCollection === "awaiting_approval") return d.status === "awaiting_approval";
    if (activeCollection === "needs_revision") return d.status === "needs_revision";
    if (activeCollection === "final_deliverables") return d.status === "ready_for_release";
    return true;
  });

  const statusCounts = {
    awaiting_approval: deliverables.filter((d) => d.status === "awaiting_approval").length,
    needs_revision: deliverables.filter((d) => d.status === "needs_revision").length,
    ready_for_release: deliverables.filter((d) => d.status === "ready_for_release").length,
  };

  const activeMediaUrl = activeContent?.mediaUrl ?? "/reel/brands/house-runway-1080p.mp4";
  const computedRoiBox = spatialPinToMicroRoiBox({
    xPct: cursorCoords.xPct,
    yPct: cursorCoords.yPct,
    canvasWidth: 2048,
    canvasHeight: 2048,
    mode: pinRoiMode,
  });

  return (
    <div className="ys-review-stage" data-review-stage>
      {/* 1. Top Guided Tour Bar & Track Handoff Banner */}
      <div className="ys-tour-Banner" data-frameio-guided-tour>
        <div className="ys-tour-banner-left">
          <span className="ys-share-badge">
            {isEn ? "INTEGRATED ASSET FOLDERS & FRAME REVIEW" : "통합 에셋 폴더 · 프레임 시사 · 공유 룸"}
          </span>
          <strong>
            {generativeMediaAllowed && productionMode === "studio"
              ? isEn
                ? "Approved templates mount directly to Self Studio (/brand/studio); master films archive in Content Library."
                : "최종 승인된 전용 템플릿은 [셀프 스튜디오]로 즉시 장착되며, 마스터 영상은 [콘텐츠 보관함]에 1080p 원본으로 납품됩니다."
              : isEn
                ? "Manage source assets in collage folders, drop frame-accurate spatial pins, and build custom stakeholder share links."
                : "폴더별 원본·시사 에셋 확인부터 1프레임 단위 화면 핀 피드백, 임원진 맞춤 공유 링크 생성까지 한곳에서 진행하세요."}
          </strong>
        </div>
        <div className="ys-tour-banner-actions">
          {generativeMediaAllowed && (
            <a
              href="/brand/studio"
              className="bw-button"
              data-studio-handoff-link
            >
              {isEn ? "⚡ Open Self Studio →" : "⚡ 셀프 스튜디오 열기 →"}
            </a>
          )}
          <button
            type="button"
            className="bw-button bw-primary"
            data-tour-trigger
            aria-expanded={tourOpen}
            onClick={() => {
              setTourOpen((prev) => !prev);
              setTourIndex(0);
            }}
          >
            {tourOpen
              ? isEn
                ? "Close Interactive Tour"
                : "가이드 투어 닫기"
              : isEn
                ? "✨ 1-Min Interactive Feature Tour"
                : "✨ 1분 인터랙티브 기능 투어"}
          </button>
        </div>
      </div>

      {/* Frame.io 2026 Walnut-style Floating Guided Tour Card */}
      {tourOpen && (
        <aside
          className="ys-walnut-tour-card"
          data-tour-step-card={activeTourStep.id}
          data-tour-type={activeTourStep.type}
          data-tour-anchor={activeTourStep.anchor}
          aria-live="polite"
        >
          <div className="ys-walnut-tour-header">
            <div className="ys-walnut-brand-badge" aria-hidden="true">
              <span>Y</span>
            </div>
            <div className="ys-walnut-step-meta">
              <span className="ys-walnut-kicker">{activeTourStep.kicker}</span>
              <span className="ys-walnut-counter">
                {activeTourStep.stepNumber} / {activeTourStep.totalSteps}
              </span>
            </div>
            <button
              type="button"
              className="ys-walnut-close"
              onClick={() => setTourOpen(false)}
              aria-label={isEn ? "Close tour" : "투어 닫기"}
            >
              ✕
            </button>
          </div>
          <h4 className="ys-walnut-title">{activeTourStep.title}</h4>
          <p className="ys-walnut-body">{activeTourStep.body}</p>
          <div className="ys-walnut-pills">
            {activeTourStep.highlightPills.map((pill) => (
              <span key={pill} className="ys-walnut-pill">
                {pill}
              </span>
            ))}
          </div>
          <div className="ys-walnut-footer">
            <div className="ys-walnut-dots" role="tablist" aria-label="Tour steps">
              {tourSteps.map((step, idx) => (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  aria-selected={idx === tourIndex}
                  className={`ys-walnut-dot ${idx === tourIndex ? "ys-walnut-dot-active" : ""}`}
                  onClick={() => setTourIndex(idx)}
                  title={step.title}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <div className="ys-walnut-nav">
              <button
                type="button"
                className="bw-button"
                disabled={tourIndex === 0}
                onClick={() => setTourIndex((i) => Math.max(0, i - 1))}
              >
                {isEn ? "← Back" : "← 이전"}
              </button>
              {tourIndex < tourSteps.length - 1 ? (
                <button
                  type="button"
                  className="bw-button bw-primary"
                  data-tour-next
                  onClick={() => setTourIndex((i) => Math.min(tourSteps.length - 1, i + 1))}
                >
                  {isEn ? "Next →" : "다음 단계 →"}
                </button>
              ) : (
                <button
                  type="button"
                  className="bw-button bw-primary"
                  onClick={() => setTourOpen(false)}
                >
                  {isEn ? "Done" : "투어 완료"}
                </button>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* 2. Playbook + Frame.io V4 Smart Collections & 3 Collage Folder Cards */}
      <section className="ys-playbook-section" id="tour-collections" data-collage-folders>
        <div className="ys-playbook-header">
          <div>
            <span className="ys-kicker-badge">
              {isEn ? "ASSETS & COLLECTIONS" : "프로젝트 에셋 폴더 · 상태별 컬렉션"}
            </span>
            <h4>
              {isEn
                ? "Source Assets, Review Cuts & 1080p Deliverable Folders"
                : "브랜드 전달 에셋부터 버전별 시사 컷·최종 마스터까지 폴더별로 깔끔하게 공유됩니다"}
            </h4>
          </div>
          <div className="ys-smart-collections" data-smart-collections role="tablist">
            {(
              [
                {
                  id: "all" as const,
                  label: isEn ? `All (${deliverables.length})` : `전체 (${deliverables.length})`,
                },
                {
                  id: "awaiting_approval" as const,
                  label: isEn
                    ? `⏳ Awaiting Approval (${statusCounts.awaiting_approval})`
                    : `⏳ 검수 대기 (${statusCounts.awaiting_approval})`,
                },
                {
                  id: "needs_revision" as const,
                  label: isEn
                    ? `🛠 Needs Revision (${statusCounts.needs_revision})`
                    : `🛠 수정 요청 (${statusCounts.needs_revision})`,
                },
                {
                  id: "final_deliverables" as const,
                  label: isEn
                    ? `✅ Ready for Release (${statusCounts.ready_for_release})`
                    : `✅ 최종 승인 (${statusCounts.ready_for_release})`,
                },
              ] as const
            ).map((col) => (
              <button
                key={col.id}
                type="button"
                role="tab"
                aria-selected={activeCollection === col.id}
                data-collection-tab={col.id}
                className={`ys-collection-pill ${
                  activeCollection === col.id ? "ys-collection-pill-active" : ""
                }`}
                onClick={() => setActiveCollection(col.id)}
              >
                {col.label}
              </button>
            ))}
          </div>
        </div>

        {/* 3 Visual Collage Folder Cards (Playbook.com + Frame.io V4 style) */}
        <div className="ys-collage-folder-grid">
          {collageFolders.map((folder) => {
            const isSelected = activeFolderId === folder.id;
            return (
              <article
                key={folder.id}
                className={`ys-collage-folder-card ${
                  isSelected ? "ys-collage-folder-card-active" : ""
                }`}
                data-collage-folder={folder.id}
                onClick={() => setActiveFolderId(folder.id)}
              >
                <div className="ys-collage-bento" aria-hidden="true">
                  {folder.items.slice(0, 3).map((item, idx) => (
                    <div
                      key={item.id}
                      className={`ys-collage-cell ys-collage-cell-${idx + 1}`}
                      style={{ background: item.previewTone }}
                    >
                      <span className="ys-collage-cell-badge">{item.badge}</span>
                      <strong className="ys-collage-cell-title">{item.title}</strong>
                      <small className="ys-collage-cell-meta">{item.meta}</small>
                    </div>
                  ))}
                </div>
                <div className="ys-collage-folder-meta">
                  <div className="ys-collage-folder-title-row">
                    <h5>
                      <span aria-hidden="true">📁 </span>
                      {folder.title}
                    </h5>
                    <span className="ys-collage-count">
                      {folder.itemCount} {isEn ? "Items" : "개 파일"}
                    </span>
                  </div>
                  <p>{folder.subtitle}</p>
                  <div className="ys-collage-folder-footer">
                    <span className="ys-collage-updated">{folder.updatedLabel}</span>
                    <a href="#files" className="ys-collage-action">
                      {isEn ? "Manage files →" : "파일 열기 · 업로드 →"}
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Frame.io V4 Deliverable Cards with Status & Release Platform Metadata */}
        <div className="ys-deliverable-grid" data-deliverable-status-grid>
          {filteredDeliverables.map((item) => (
            <article
              key={item.id}
              className="ys-deliverable-card"
              data-deliverable-card={item.id}
              data-deliverable-status={item.status}
            >
              <div
                className="ys-deliverable-thumb"
                style={{
                  backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.25) 0%, rgba(15, 23, 42, 0.72) 100%), url(${
                    item.version >= 2
                      ? "/reel/brands/house-french-blue-hero-1080p.jpg"
                      : "/reel/brands/studio-editorial-blue-1080p.jpg"
                  })`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
                onClick={() => {
                  if (sorted.some((v) => v.id === item.id)) {
                    setSelectedVersionId(item.id);
                  }
                }}
              >
                <span className="ys-deliverable-aspect">{item.aspect}</span>
                <span className="ys-deliverable-version">v{item.version}</span>
                <span className="ys-deliverable-duration">{item.duration}</span>
                <div className="ys-deliverable-play-hint">
                  {isEn ? "▶ Load in Cinema Player" : "▶ 시사 플레이어로 열기"}
                </div>
              </div>
              <div className="ys-deliverable-info">
                <strong className="ys-deliverable-filename">{item.title}</strong>
                <span className="ys-deliverable-date">{item.updatedAt}</span>
              </div>
              <div className="ys-deliverable-metadata">
                <label className="ys-meta-row">
                  <span className="ys-meta-label">{isEn ? "Status" : "승인 상태"}</span>
                  <select
                    aria-label={`${item.title} status`}
                    data-deliverable-status-select={item.id}
                    className={`ys-status-pill-select ys-status-${item.status}`}
                    value={item.status}
                    onChange={(e) =>
                      updateDeliverableStatus(
                        item.id,
                        e.target.value as DeliverableApprovalStatus,
                      )
                    }
                  >
                    <option value="awaiting_approval">
                      {isEn ? "⏳ Awaiting Approval" : "⏳ 검수 대기"}
                    </option>
                    <option value="needs_revision">
                      {isEn ? "🛠 Needs Revision" : "🛠 수정 요청"}
                    </option>
                    <option value="ready_for_release">
                      {isEn ? "✅ Ready for Release" : "✅ 최종 승인"}
                    </option>
                  </select>
                </label>
                <label className="ys-meta-row">
                  <span className="ys-meta-label">{isEn ? "Release Platform" : "배포 매체"}</span>
                  <select
                    aria-label={`${item.title} platform`}
                    data-deliverable-platform-select={item.id}
                    className="ys-platform-pill-select"
                    value={item.platform}
                    onChange={(e) =>
                      updateDeliverablePlatform(item.id, e.target.value as ReleasePlatformId)
                    }
                  >
                    <option value="instagram_reels">Instagram Reels</option>
                    <option value="tiktok">TikTok</option>
                    <option value="youtube_shorts">YouTube</option>
                    <option value="owned_web">
                      {isEn ? "Owned Web / PDP" : "자사몰 · 공식 채널"}
                    </option>
                    {generativeMediaAllowed && (
                      <option value="self_studio">
                        {isEn ? "Self Studio Template" : "셀프 스튜디오 템플릿"}
                      </option>
                    )}
                  </select>
                </label>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 3. Frame.io V4 Share Link Builder + Stakeholder Share Bar */}
      <section
        className="ys-share-builder-card"
        id="tour-share"
        data-frameio-share-builder
        data-stakeholder-share-bar
      >
        <div className="ys-share-builder-top">
          <div className="ys-share-builder-heading">
            <span className="ys-share-badge">
              <span className="ys-brand-live-dot" aria-hidden="true" />
              {isKo
                ? "임원·팀원 무로그인 시사 링크 · 맞춤 공유 설정"
                : "Zero-Login Stakeholder Review Link & Share Builder"}
            </span>
            <div className="ys-share-title-row">
              <input
                type="text"
                aria-label={isEn ? "Share link title" : "공유 링크 제목"}
                className="ys-share-title-input"
                value={shareConfig.title}
                onChange={(e) =>
                  setShareConfig((prev) => ({ ...prev, title: e.target.value }))
                }
              />
              <span className="ys-share-url-chip" data-share-preview-url>
                {shareUrl}
              </span>
            </div>
            <p className="ys-share-subtitle">
              {isKo
                ? "링크를 받은 팀원이나 대표님은 로그인 없이 원하는 레이아웃(Grid · Reel · Player)으로 영상을 재생하고 화면 위 위치(x%, y%)에 핀 피드백을 남길 수 있습니다."
                : "Share a clean review page with executives or teammates—choose Grid, Reel, or Cinema Player layout and control download/passphrase permissions."}
            </p>
          </div>
          <div className="ys-share-controls">
            <select
              className="ys-share-select"
              aria-label={isKo ? "공유 링크 권한 설정" : "Share link permission"}
              value={shareScope}
              onChange={(e) => {
                const next = e.currentTarget.value as "comment_only" | "allow_approve";
                setShareScope(next);
                setShareConfig((prev) => ({
                  ...prev,
                  allowApprovals: next === "allow_approve",
                }));
              }}
            >
              <option value="comment_only">
                {isKo ? "시사·코멘트만 허용 (최종 승인은 담당자만)" : "View & comment only (recommended)"}
              </option>
              <option value="allow_approve">
                {isKo ? "링크 보유자 최종 승인까지 허용" : "Allow final approval via link"}
              </option>
            </select>
            <button
              type="button"
              className="ys-pin-toggle"
              aria-pressed={pinProtected}
              onClick={() => {
                setPinProtected((prev) => {
                  const next = !prev;
                  setShareConfig((cfg) => ({ ...cfg, passphraseEnabled: next }));
                  return next;
                });
              }}
            >
              {pinProtected
                ? isKo
                  ? "🔒 4자리 PIN 보호 켜짐"
                  : "🔒 4-digit PIN ON"
                : isKo
                  ? "🔓 PIN 없이 열람"
                  : "🔓 No PIN"}
            </button>
            <button
              type="button"
              className="bw-button"
              data-share-settings-toggle
              aria-expanded={shareBuilderOpen}
              onClick={() => setShareBuilderOpen((prev) => !prev)}
            >
              {shareBuilderOpen
                ? isEn
                  ? "Close Share Options"
                  : "공유 설정 접기"
                : isEn
                  ? "⚙ Layout & Security Settings"
                  : "⚙ 레이아웃 · 보안 상세 설정"}
            </button>
            <button
              type="button"
              className="bw-button bw-primary ys-share-copy-btn"
              data-copy-share-link
              onClick={copyShareLink}
            >
              {shareCopied
                ? isKo
                  ? "✓ 시사 링크가 복사되었습니다"
                  : "✓ Review link copied"
                : isKo
                  ? "공유용 시사 링크 복사"
                  : "Copy Stakeholder Link"}
            </button>
          </div>
        </div>

        {shareBuilderOpen && (
          <div className="ys-share-builder-drawer" data-share-settings-panel>
            <div className="ys-share-settings-col">
              <div className="ys-share-setting-group">
                <span className="ys-share-setting-label">
                  {isEn ? "Presentation Layout" : "공유 화면 레이아웃 (Layout)"}
                </span>
                <div
                  className="ys-share-layout-picker"
                  data-share-layout-picker
                  role="radiogroup"
                  aria-label={isEn ? "Presentation Layout" : "공유 화면 레이아웃"}
                >
                  {(
                    [
                      { id: "grid" as const, label: isEn ? "⊞ Grid" : "⊞ 그리드(Grid)" },
                      { id: "list" as const, label: isEn ? "☰ List" : "☰ 리스트(List)" },
                      { id: "reel" as const, label: isEn ? "📱 Reel" : "📱 릴스(Reel)" },
                      { id: "player" as const, label: isEn ? "🎬 Player" : "🎬 플레이어(Player)" },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="radio"
                      aria-checked={shareConfig.layout === mode.id}
                      data-share-layout={mode.id}
                      className={`ys-layout-btn ${
                        shareConfig.layout === mode.id ? "ys-layout-btn-active" : ""
                      }`}
                      onClick={() =>
                        setShareConfig((prev) => ({
                          ...prev,
                          layout: mode.id as ShareLayoutMode,
                        }))
                      }
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ys-share-toggles-list">
                <label className="ys-share-toggle-row">
                  <div>
                    <strong>
                      {isEn ? "Allow timecode & pin comments" : "타임코드 · 화면 핀 코멘트 허용"}
                    </strong>
                    <small>
                      {isEn
                        ? "Reviewers can leave frame-accurate notes without signing in"
                        : "공유 링크 열람자가 프레임 단위 수정 코멘트를 남길 수 있습니다"}
                    </small>
                  </div>
                  <input
                    type="checkbox"
                    data-share-toggle="allowComments"
                    checked={shareConfig.allowComments}
                    onChange={(e) =>
                      setShareConfig((prev) => ({
                        ...prev,
                        allowComments: e.target.checked,
                      }))
                    }
                  />
                </label>

                <label className="ys-share-toggle-row">
                  <div>
                    <strong>
                      {isEn ? "Allow 1080p MP4 downloads" : "1080p 원본 MP4 다운로드 허용"}
                    </strong>
                    <small>
                      {isEn
                        ? "Enable direct download of clean 1080p deliverables and audio stems"
                        : "시사 완료 후 공유 페이지에서 무로고 1080p 원본 파일 다운로드를 허용합니다"}
                    </small>
                  </div>
                  <input
                    type="checkbox"
                    data-share-toggle="allowDownloads"
                    checked={shareConfig.allowDownloads}
                    onChange={(e) =>
                      setShareConfig((prev) => ({
                        ...prev,
                        allowDownloads: e.target.checked,
                      }))
                    }
                  />
                </label>

                <label className="ys-share-toggle-row">
                  <div>
                    <strong>{isEn ? "Preview watermark" : "시사용 보호 워터마크 표시"}</strong>
                    <small>
                      {isEn
                        ? "Overlay reviewer timestamp watermark prior to final sign-off"
                        : "최종 승인 전 외부 유출 방지를 위해 시사용 타임스탬프 워터마크를 표시합니다"}
                    </small>
                  </div>
                  <input
                    type="checkbox"
                    data-share-toggle="watermark"
                    checked={shareConfig.watermark}
                    onChange={(e) =>
                      setShareConfig((prev) => ({
                        ...prev,
                        watermark: e.target.checked,
                      }))
                    }
                  />
                </label>
              </div>
            </div>

            <div
              className="ys-share-preview-col"
              data-share-live-preview={shareConfig.layout}
            >
              <div className="ys-share-preview-header">
                <strong>{shareConfig.title}</strong>
                <div className="ys-share-preview-badges">
                  <span>{shareConfig.layout.toUpperCase()} VIEW</span>
                  {shareConfig.passphraseEnabled && <span>🔒 PIN</span>}
                  {shareConfig.watermark && <span>💧 WATERMARK</span>}
                </div>
              </div>
              <div className={`ys-share-preview-canvas ys-preview-${shareConfig.layout}`}>
                {deliverables.slice(0, shareConfig.layout === "player" ? 1 : 2).map((d) => (
                  <div key={d.id} className="ys-share-preview-item">
                    <div className="ys-share-preview-thumb">
                      <span>{d.aspect} · 1080p</span>
                      {shareConfig.watermark && (
                        <em className="ys-watermark-chip">PREVIEW ONLY</em>
                      )}
                    </div>
                    <div className="ys-share-preview-caption">
                      <strong>{d.title}</strong>
                      <span>
                        {d.status === "ready_for_release"
                          ? "✅ Ready for Release"
                          : d.status === "needs_revision"
                            ? "🛠 Needs Revision"
                            : "⏳ Awaiting Approval"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="ys-share-preview-footer">
                <span>
                  {shareConfig.allowComments ? "💬 Comments ON" : "💬 Comments OFF"} ·{" "}
                  {shareConfig.allowApprovals ? "✅ Approvals ON" : "✅ Approvals OFF"} ·{" "}
                  {shareConfig.allowDownloads ? "⬇ Downloads ON" : "⬇ Downloads Locked"}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 4. Cinema Video Stage (#050505) */}
      <div
        className="ys-cinema-theater"
        id="tour-player"
        data-two-stage-gate-bar
        data-gate-status={twoStageGate}
        data-quality-assurance-bar
        data-oled-look-selector={selectedOledLook}
        data-continuity-audit-badge={continuityAudit.status}
        data-optical-identity-badge={opticalIdentityReport.selectedStage}
      >
        <div className="ys-cinema-topbar">
          <div
            className="ys-version-pills"
            data-version-switcher
            role="group"
            aria-label={isKo ? "버전 및 사운드 선택" : "Version & audio switcher"}
          >
            {sorted.length > 0 ? (
              sorted.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-version={c.version}
                  className={
                    c.id === activeContent?.id
                      ? "ys-version-pill ys-version-pill-active"
                      : "ys-version-pill"
                  }
                  onClick={() => setSelectedVersionId(c.id)}
                >
                  v{c.version} · {c.title}
                </button>
              ))
            ) : (
              <span className="ys-version-pill ys-version-pill-active" data-version="1">
                {isKo ? "v1 시사 영상" : "Cut v1"}
              </span>
            )}
            <button
              type="button"
              className={
                spatialPinMode
                  ? "ys-version-pill ys-version-pill-active"
                  : "ys-version-pill"
              }
              aria-pressed={spatialPinMode}
              onClick={() => setSpatialPinMode((prev) => !prev)}
              data-spatial-pin-toggle
            >
              {spatialPinMode
                ? isKo
                  ? "📍 화면 클릭 메모 켜짐"
                  : "📍 Pin Mode ON"
                : isKo
                  ? "📍 화면 클릭 메모"
                  : "📍 Pin Mode"}
            </button>
            <button
              type="button"
              className={
                audioStemMode === "clean_foley_only"
                  ? "ys-version-pill ys-version-pill-active"
                  : "ys-version-pill"
              }
              onClick={() =>
                setAudioStemMode((prev) =>
                  prev === "master_with_bgm" ? "clean_foley_only" : "master_with_bgm",
                )
              }
              data-audio-stem-toggle
            >
              {audioStemMode === "master_with_bgm"
                ? isKo
                  ? "🔊 음악 포함"
                  : "🔊 With Music"
                : isKo
                  ? "🎙️ 현장음만 (릴스 음원용)"
                  : "🎙️ Clean Sound Only"}
            </button>
            <button
              type="button"
              className={
                safeZoneOverlayOn
                  ? "ys-version-pill ys-version-pill-active"
                  : "ys-version-pill"
              }
              aria-pressed={safeZoneOverlayOn}
              onClick={() => setSafeZoneOverlayOn((prev) => !prev)}
              data-safe-zone-toggle
            >
              {isKo ? "📱 화면 가림 가이드" : "📱 Safe-Zone Guide"}
            </button>
            {sorted.length > 1 && (
              <button
                type="button"
                className={
                  compareMode
                    ? "ys-version-pill ys-version-pill-compare"
                    : "ys-version-pill"
                }
                aria-pressed={compareMode}
                onClick={() => setCompareMode((prev) => !prev)}
              >
                {isKo ? "⇄ 이전 버전과 나란히 비교" : "⇄ Compare v1 / v2"}
              </button>
            )}
          </div>
          <div className="ys-timecode-readout" data-timecode aria-live="polite">
            <span className="ys-tc-label">TC</span>
            <code>{formatTimecode(currentTime)}</code>
            <span className="ys-tc-sep">/</span>
            <code>{formatTimecode(duration)}</code>
          </div>
        </div>

        <div className={compareMode && previousContent ? "ys-video-viewport ys-video-split" : "ys-video-viewport"}>
          <div
            ref={stageOverlayRef}
            className="ys-video-primary"
            style={{ position: "relative", cursor: spatialPinMode ? "crosshair" : "pointer" }}
            onClick={handleStageClick}
            data-spatial-video-canvas
          >
            {videoMounted ? (
              <video
                ref={videoRef}
                src={activeMediaUrl.includes("#") ? activeMediaUrl : `${activeMediaUrl}#t=0.1`}
                poster="/reel/brands/house-french-blue-hero-1080p.jpg"
                playsInline
                preload="metadata"
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
                    setDuration(e.currentTarget.duration);
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            ) : (
              <div
                data-deferred-video-poster
                style={{
                  minHeight: 280,
                  borderRadius: 12,
                  background: "linear-gradient(135deg, #0F172A 0%, #1E293B 55%, #1E3A8A 100%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 24,
                  color: "#F8FAFC",
                  textAlign: "center",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {isKo
                    ? "프레임 시사 캔버스 · 화면을 클릭해 공간 핀(x%, y%) 좌표를 지정하거나 재생을 눌러 스트림을 여세요"
                    : "Frame Review Canvas · Click anywhere to place a Spatial Pin (x%, y%) or press Play to stream"}
                </span>
                <span style={{ fontSize: 12, color: "#94A3B8" }}>
                  {activeContent?.title ?? "1080p Master Cut"} · TC {formatTimecode(currentTime)} / {formatTimecode(duration)}
                </span>
              </div>
            )}

            {/* Spatial Pin Crosshair & ROI Box Overlay on Frame */}
            {spatialPinMode && (
              <div
                data-spatial-pin-reticle
                style={{
                  position: "absolute",
                  left: `${cursorCoords.xPct}%`,
                  top: `${cursorCoords.yPct}%`,
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    border: "2px solid #3875C5",
                    background: "rgba(56, 117, 197, 0.18)",
                    boxShadow: "0 0 0 3px rgba(255,255,255,0.85)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#FFFFFF",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  📍
                </div>
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 4,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: "rgba(15, 23, 42, 0.88)",
                    color: "#F8FAFC",
                    fontSize: 11,
                    fontFamily: "var(--font-mono, monospace)",
                    whiteSpace: "nowrap",
                  }}
                >
                  @{formatTimecode(currentTime)} · ({cursorCoords.xPct}%, {cursorCoords.yPct}%)
                </span>
              </div>
            )}

            {/* Reels / TikTok UI Safe-Zone Overlay Guide for Marketers */}
            {safeZoneOverlayOn && (
              <div
                data-safe-zone-overlay
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  zIndex: 3,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  padding: 12,
                }}
              >
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.22)",
                    border: "1px dashed rgba(248, 113, 113, 0.85)",
                    borderRadius: 8,
                    padding: "4px 10px",
                    color: "#FEE2E2",
                    fontSize: 11,
                    fontWeight: 600,
                    textAlign: "center",
                  }}
                >
                  {isEn
                    ? "⚠️ Top 12% Reels/TikTok Status & Header Dead Zone (Keep Logos Below)"
                    : "⚠️ 상단 12% 릴스·틱톡 상단바 가림 주의 구역 (로고·핵심 텍스트 배치 금지)"}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      background: "rgba(239, 68, 68, 0.22)",
                      border: "1px dashed rgba(248, 113, 113, 0.85)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      color: "#FEE2E2",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {isEn
                      ? "⚠️ Bottom 22% Caption, Account Handle & Audio Marquee Dead Zone"
                      : "⚠️ 하단 22% 계정명·캡션·음원 바 가림 구역 (제품·자막은 중앙 안전 영역에 배치됨)"}
                  </div>
                  <div
                    style={{
                      width: 64,
                      height: 140,
                      background: "rgba(239, 68, 68, 0.22)",
                      border: "1px dashed rgba(248, 113, 113, 0.85)",
                      borderRadius: 8,
                      padding: 6,
                      color: "#FEE2E2",
                      fontSize: 10,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                    }}
                  >
                    {isEn ? "Right UI Icons (Like/Share)" : "우측 좋아요·댓글·공유 버튼 구역"}
                  </div>
                </div>
              </div>
            )}
          </div>
          {compareMode && previousContent && (
            <div className="ys-video-secondary">
              <span className="ys-compare-tag">
                v{previousContent.version} · {previousContent.title}
              </span>
              <video
                src={previousContent.mediaUrl}
                playsInline
                preload="none"
                muted
                controls
              />
            </div>
          )}
        </div>

        {/* Interactive Timeline + Marker Pins */}
        <div className="ys-timeline-scrub-area">
          <div className="ys-timeline-pins-track">
            <input
              type="range"
              className="ys-scrub-range"
              min={0}
              max={duration || 15}
              step={0.03}
              value={Math.min(currentTime, duration || 15)}
              aria-label={isKo ? "영상 타임라인 탐색" : "Seek video timeline"}
              onChange={(e) => seekTo(Number.parseFloat(e.currentTarget.value))}
            />
            {pins.map((pin) => {
              const pct = Math.min(98, Math.max(2, (pin.seconds / (duration || 15)) * 100));
              return (
                <button
                  key={pin.id}
                  type="button"
                  className="ys-timeline-pin"
                  data-pin-author={pin.author}
                  style={{ left: `${pct}%` }}
                  title={`${pin.label} · ${pin.body}`}
                  onClick={() => seekTo(pin.seconds, { xPct: pin.xPct, yPct: pin.yPct })}
                >
                  <span className="bw-sr-only">{pin.label}</span>
                </button>
              );
            })}
          </div>

          <div className="ys-transport-bar">
            <div className="ys-transport-left">
              <button
                type="button"
                className="ys-transport-btn ys-transport-play"
                onClick={togglePlay}
              >
                {playing ? (isKo ? "⏸ 일시정지" : "⏸ Pause") : isKo ? "▶ 시안 재생" : "▶ Play Cut"}
              </button>
              <button
                type="button"
                className="ys-transport-btn"
                onClick={() => stepFrame(-1)}
                title={isKo ? "1프레임 뒤로 (←)" : "Step back 1 frame"}
              >
                -1f
              </button>
              <button
                type="button"
                className="ys-transport-btn"
                onClick={() => stepFrame(1)}
                title={isKo ? "1프레임 앞으로 (→)" : "Step forward 1 frame"}
              >
                +1f
              </button>
              <button
                type="button"
                className="ys-transport-btn"
                onClick={cycleSpeed}
              >
                {playbackRate}x
              </button>
            </div>

            <div className="ys-transport-right">
              <button
                type="button"
                className="ys-stamp-btn"
                onClick={stampTimecodeToComment}
              >
                {stampedNotice
                  ? isKo
                    ? `✓ [${stampedNotice}] 프레임 핀이 기록됨`
                    : `✓ Stamped [${stampedNotice}]`
                  : isKo
                    ? `📌 현재 프레임(${formatTimecode(currentTime)} · ${cursorCoords.xPct}%, ${cursorCoords.yPct}%) 핀 찍기`
                    : `📌 Stamp [${formatTimecode(currentTime)}] & write comment`}
              </button>
            </div>
          </div>
        </div>

        {/* Frame.io-Grade Pipeline Action Bar (only rendered when Studio callbacks are wired) */}
        {(onSendPinToMicroRoi || onSetMusicDropRevealSec) && (
          <div
            data-review-pin-actions
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>
                {isKo
                  ? `⚡ 공간 핀 파이프라인 직결 — @${formatTimecode(currentTime)} · 좌표 (${cursorCoords.xPct}%, ${cursorCoords.yPct}%) → 2K ROI (${computedRoiBox.x0}, ${computedRoiBox.y0})~(${computedRoiBox.x1}, ${computedRoiBox.y1})`
                  : `⚡ Spatial Pin Pipeline — @${formatTimecode(currentTime)} (${cursorCoords.xPct}%, ${cursorCoords.yPct}%)`}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <select
                  aria-label={isKo ? "극소 부위 수선 타깃 모드" : "Micro-ROI target mode"}
                  value={pinRoiMode}
                  onChange={(e) => setPinRoiMode(e.currentTarget.value as MicroRoiTargetMode)}
                  style={{
                    background: "#0F172A",
                    color: "#F8FAFC",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 8,
                    padding: "4px 8px",
                    fontSize: 12,
                  }}
                >
                  <option value="brand_logo_packaging">
                    {isKo ? "보틀 라벨·로고 각인 복원 (ECC)" : "Brand Logo & Packaging (ECC)"}
                  </option>
                  <option value="face_expression_retake">
                    {isKo ? "눈매·입매 1~2mm 표정 리테이크 (랜드마크 정렬)" : "Face Expression Retake"}
                  </option>
                  <option value="hand_artifact_repair">
                    {isKo ? "손가락·파지 아티팩트 정밀 수선" : "Hand & Grip Repair"}
                  </option>
                  <option value="skin_hair_patch">
                    {isKo ? "피부 결·솜털·잔머리 복원" : "Skin & Stray Hair Patch"}
                  </option>
                </select>
                <button
                  type="button"
                  className="ys-transport-btn"
                  onClick={triggerMicroRoiHandoff}
                  data-pin-send-micro-roi
                  style={{
                    background: "#3875C5",
                    color: "#FFFFFF",
                    border: "none",
                    padding: "6px 11px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {isKo
                    ? "🔬 이 핀 좌표를 극소 부위 5단계 수선으로 전달"
                    : "🔬 Send Pin to 5-Step Micro-ROI Repair"}
                </button>
                <button
                  type="button"
                  className="ys-transport-btn"
                  onClick={triggerMusicDropHandoff}
                  data-pin-set-music-drop
                  style={{
                    background: "rgba(56, 117, 197, 0.22)",
                    color: "#E2E8F0",
                    border: "1px solid rgba(56, 117, 197, 0.55)",
                    padding: "6px 11px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {isKo
                    ? `🎵 현재 프레임(${formatTimecode(currentTime)})을 0ms 음악 드롭(T_reveal)으로 지정`
                    : `🎵 Set ${formatTimecode(currentTime)} as 0ms Music Drop`}
                </button>
              </div>
            </div>

            <input
              type="text"
              value={pinNoteDraft}
              onChange={(e) => setPinNoteDraft(e.currentTarget.value)}
              aria-label={isKo ? "공간 핀 디렉팅 메모" : "Spatial pin note"}
              placeholder={
                isKo
                  ? "프레임 핀 피드백 또는 극소 부위 수선 지시문을 입력하세요..."
                  : "Enter frame pin note or micro-repair instruction..."
              }
              style={{
                width: "100%",
                background: "rgba(15, 23, 42, 0.75)",
                color: "#F8FAFC",
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 12,
              }}
            />

            {handoffBanner && (
              <div
                role="status"
                data-review-pin-status
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  background: "rgba(56, 117, 197, 0.22)",
                  border: "1px solid rgba(56, 117, 197, 0.5)",
                  color: "#F8FAFC",
                  fontSize: 12,
                }}
              >
                {handoffBanner}
              </div>
            )}
          </div>
        )}

        {/* Timecode Pin Strip */}
        <div className="ys-pin-chips">
          {pins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              data-pin-chip={pin.label}
              className="ys-pin-chip"
              onClick={() => seekTo(pin.seconds, { xPct: pin.xPct, yPct: pin.yPct })}
            >
              <code>
                @{pin.label}
                {pin.xPct !== undefined && pin.yPct !== undefined
                  ? ` (${pin.xPct}%,${pin.yPct}%)`
                  : ""}
              </code>
              <span>{pin.body}</span>
            </button>
          ))}
        </div>

        {/* Compact 1-Line Download & Approval Bar (No verbose technical cards) */}
        <div
          data-platform-delivery-utility
          data-ig-edits-checklist
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {twoStagePlan.deliverableStems.slice(0, 2).map((stem) => (
              <button
                key={stem.id}
                type="button"
                className="ys-transport-btn"
                data-download-stem-btn={stem.id}
                onClick={() =>
                  setStemDownloadNotice(
                    isEn ? "Ready for download" : "다운로드 준비 완료",
                  )
                }
              >
                {stem.id === "reels_trending_clean_foley"
                  ? isEn
                    ? "⬇ Download (Clean Sound for Reels)"
                    : "⬇ 릴스·틱톡용 다운로드 (배경음악 없음)"
                  : isEn
                    ? "⬇ Download (Master with Music)"
                    : "⬇ 공식·광고용 다운로드 (음악 포함)"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {stemDownloadNotice && (
              <span style={{ fontSize: 12, color: "#93C5FD" }} data-stem-download-notice>
                ✓ {stemDownloadNotice}
              </span>
            )}
            <button
              type="button"
              className="ys-stamp-btn"
              data-approve-stage1-to-stage2
              onClick={() => setTwoStageGate("stage2_1080p_master")}
            >
              {isEn ? "✓ Approve Cut" : "✓ 이 시안 승인하기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
