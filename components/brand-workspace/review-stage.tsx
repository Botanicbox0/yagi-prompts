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

function formatTimecode(sec: number): string {
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
        body: "초반 훅(Hook) 시선 고정 프레임 포인트 · 18° 오프축 앵글",
        xPct: 42,
        yPct: 44,
        handoffKind: "general_comment",
      },
      {
        id: "guide-product",
        seconds: 3.8,
        label: "00:03.80",
        author: "studio",
        body: "클라이맥스 제품 리빌(T_reveal) · 보틀 라벨 및 아토마이저 림라이트 구간",
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
        body: "트래버틴 단상 보틀 안착 및 엔딩 로고 락업 구간",
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
  deferVideoMount = false,
  onSendPinToMicroRoi,
  onSetMusicDropRevealSec,
}: {
  projectId: string;
  contents: readonly BrandContentVersion[];
  messages: readonly BrandMessage[];
  decisions: readonly BrandDecision[];
  locale: string;
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

  // Spatial Frame Pinning state
  const [spatialPinMode, setSpatialPinMode] = useState<boolean>(true);
  const [cursorCoords, setCursorCoords] = useState<{ xPct: number; yPct: number }>({
    xPct: 58,
    yPct: 62,
  });
  const [customPins, setCustomPins] = useState<TimecodePin[]>([]);
  const [pinNoteDraft, setPinNoteDraft] = useState<string>(
    "보틀 전면 라벨 세리프 획 선명도 및 황동 넥 반사 하이라이트 극소 부위 수선",
  );
  const [pinRoiMode, setPinRoiMode] = useState<MicroRoiTargetMode>("brand_logo_packaging");
  const [handoffBanner, setHandoffBanner] = useState<string | null>(null);

  const activeContent =
    sorted.find((c) => c.id === selectedVersionId) ?? sorted[0] ?? null;
  const previousContent =
    sorted.find((c) => c.id !== activeContent?.id) ?? null;

  const basePins = extractTimecodePins(messages, decisions);
  const pins = [...customPins, ...basePins];

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
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://brand.twings.app";
    const url = `${origin}/brand/projects/${projectId}?share=stakeholder&mode=${shareScope}${pinProtected ? "&pin=required" : ""}#review`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2600);
  };

  const activeMediaUrl = activeContent?.mediaUrl ?? "/reel/brands/production-paris.mp4";
  const computedRoiBox = spatialPinToMicroRoiBox({
    xPct: cursorCoords.xPct,
    yPct: cursorCoords.yPct,
    canvasWidth: 2048,
    canvasHeight: 2048,
    mode: pinRoiMode,
  });

  return (
    <div className="ys-review-stage" data-review-stage>
      {/* Zero-Login Stakeholder Share Bar */}
      <div className="ys-share-bar" data-stakeholder-share-bar>
        <div className="ys-share-bar-info">
          <span className="ys-share-badge">
            <span className="ys-brand-live-dot" aria-hidden="true" />
            {isKo ? "임원·팀원 무로그인 시사 링크 (Frame.io급 공간 핀 리뷰)" : "Zero-Login Stakeholder Review Link"}
          </span>
          <p>
            {isKo
              ? "링크를 받은 팀원이나 대표님은 로그인 없이 영상을 재생하고 화면 위 원하는 위치(x%, y%)를 클릭해 핀 피드백을 남기거나 극소 부위 수선·0ms 음악 드롭으로 즉시 넘길 수 있습니다 (14일 유효)."
              : "Share with executives or teammates to leave frame-accurate spatial pins without signing in (valid for 14 days)."}
          </p>
        </div>
        <div className="ys-share-controls">
          <select
            className="ys-share-select"
            aria-label={isKo ? "공유 링크 권한 설정" : "Share link permission"}
            value={shareScope}
            onChange={(e) =>
              setShareScope(e.currentTarget.value as "comment_only" | "allow_approve")
            }
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
            onClick={() => setPinProtected((prev) => !prev)}
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
            className="bw-button bw-primary ys-share-copy-btn"
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

      {/* Cinema Video Stage (#050505) */}
      <div className="ys-cinema-theater">
        <div className="ys-cinema-topbar">
          <div className="ys-version-pills" role="group" aria-label={isKo ? "버전 및 오디오 스템 선택" : "Version & audio stem switcher"}>
            {sorted.length > 0 ? (
              sorted.map((c) => (
                <button
                  key={c.id}
                  type="button"
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
              <span className="ys-version-pill ys-version-pill-active">
                {isKo ? "컷 v1 · 마스터 시사 스테이지" : "Cut v1 · Master Review Stage"}
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
                  ? `📍 프레임 공간 핀 켜짐 (${cursorCoords.xPct}%, ${cursorCoords.yPct}%)`
                  : `📍 Spatial Pin Mode ON (${cursorCoords.xPct}%, ${cursorCoords.yPct}%)`
                : isKo
                  ? "📍 프레임 공간 핀 끄기"
                  : "📍 Spatial Pin Mode OFF"}
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
                  ? "🔊 스템: 상업용 BGM + 실사 폴리 (-14 LUFS)"
                  : "🔊 Stem: BGM + Live Foley (-14 LUFS)"
                : isKo
                  ? "🎙️ 스템: 클린 폴리 전용 (No-BGM 릴스/틱톡용)"
                  : "🎙️ Stem: Clean Foley Only (No-BGM)"}
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
          <div className="ys-timecode-readout" aria-live="polite">
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
                src={activeMediaUrl}
                playsInline
                preload="none"
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
      </div>
    </div>
  );
}
