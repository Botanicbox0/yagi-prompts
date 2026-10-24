"use client";

import { useRef, useState } from "react";
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
        body: "초반 훅(Hook) 시선 고정 프레임 포인트",
      },
      {
        id: "guide-product",
        seconds: 6.4,
        label: "00:06.40",
        author: "studio",
        body: "메인 제품·인물 클로즈업 림라이트 구간",
      },
      {
        id: "guide-payoff",
        seconds: 12.0,
        label: "00:12.00",
        author: "studio",
        body: "브랜드 엔딩 타이틀 및 로고 락업 구간",
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
}: {
  projectId: string;
  contents: readonly BrandContentVersion[];
  messages: readonly BrandMessage[];
  decisions: readonly BrandDecision[];
  locale: string;
}) {
  const isKo = locale === "ko";
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const sorted = [...contents].sort((a, b) => b.version - a.version);
  const [selectedVersionId, setSelectedVersionId] = useState<string>(
    sorted[0]?.id ?? "demo-preview",
  );
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [playing, setPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(15);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [shareScope, setShareScope] = useState<"comment_only" | "allow_approve">(
    "comment_only",
  );
  const [pinProtected, setPinProtected] = useState<boolean>(false);
  const [shareCopied, setShareCopied] = useState<boolean>(false);
  const [stampedNotice, setStampedNotice] = useState<string | null>(null);

  const activeContent =
    sorted.find((c) => c.id === selectedVersionId) ?? sorted[0] ?? null;
  const previousContent =
    sorted.find((c) => c.id !== activeContent?.id) ?? null;

  const pins = extractTimecodePins(messages, decisions);

  const togglePlay = () => {
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
    const next = Math.max(0, Math.min(duration, currentTime + deltaFrames * (1 / 30)));
    if (v) {
      v.pause();
      v.currentTime = next;
    }
    setPlaying(false);
    setCurrentTime(next);
  };

  const seekTo = (sec: number) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(duration, sec));
    if (v) {
      v.currentTime = clamped;
    }
    setCurrentTime(clamped);
  };

  const cycleSpeed = () => {
    const rates = [0.5, 1, 1.5] as const;
    const next = rates[(rates.indexOf(playbackRate as 0.5 | 1 | 1.5) + 1) % rates.length]!;
    setPlaybackRate(next);
    if (videoRef.current) {
      videoRef.current.playbackRate = next;
    }
  };

  const stampTimecodeToComment = () => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setPlaying(false);
    }
    const code = `[${formatTimecode(currentTime)}] `;
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
    setStampedNotice(formatTimecode(currentTime));
    setTimeout(() => setStampedNotice(null), 2400);
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

  return (
    <div className="ys-review-stage" data-review-stage>
      {/* Zero-Login Stakeholder Share Bar */}
      <div className="ys-share-bar" data-stakeholder-share-bar>
        <div className="ys-share-bar-info">
          <span className="ys-share-badge">
            <span className="ys-brand-live-dot" aria-hidden="true" />
            {isKo ? "임원·팀원 무로그인 시사 링크" : "Zero-Login Stakeholder Review Link"}
          </span>
          <p>
            {isKo
              ? "링크를 받은 팀원이나 대표님은 회원가입·로그인 없이 바로 영상을 재생하고 타임코드 코멘트를 남길 수 있습니다 (14일 유효)."
              : "Share with executives or teammates to review and leave frame-accurate comments without signing in (valid for 14 days)."}
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
          <div className="ys-version-pills" role="group" aria-label={isKo ? "버전 선택" : "Version switcher"}>
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
                {isKo ? "시안 대기 중 · 레퍼런스 프리뷰 스테이지" : "Awaiting Cut v1 · Reference Preview Stage"}
              </span>
            )}
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
          <div className="ys-video-primary">
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
              onClick={togglePlay}
            />
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
                  onClick={() => seekTo(pin.seconds)}
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
                    ? `✓ [${stampedNotice}] 타임코드가 코멘트 입력창에 추가됨`
                    : `✓ Stamped [${stampedNotice}] into comment box`
                  : isKo
                    ? `📌 현재 프레임(${formatTimecode(currentTime)}) 찍고 피드백 쓰기`
                    : `📌 Stamp [${formatTimecode(currentTime)}] & write comment`}
              </button>
            </div>
          </div>
        </div>

        {/* Timecode Pin Strip */}
        <div className="ys-pin-chips">
          {pins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              className="ys-pin-chip"
              onClick={() => seekTo(pin.seconds)}
            >
              <code>@{pin.label}</code>
              <span>{pin.body}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
