'use client';

import { useRef, useState } from 'react';
import {
  extractRealTimecodePins,
  formatTimecode,
} from '@/lib/brands/workspace/timecode-pins';
import type {
  BrandContentVersion,
  BrandDecision,
  BrandMessage,
} from '@/lib/brands/workspace/types';

export function RealReviewPlayer({
  contents,
  messages,
  decisions,
  locale,
}: {
  contents: readonly BrandContentVersion[];
  messages: readonly BrandMessage[];
  decisions: readonly BrandDecision[];
  locale: string;
}) {
  const isKo = locale !== 'en';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sorted = [...contents].sort((a, b) => b.version - a.version);
  const [selectedId, setSelectedId] = useState<string>(sorted[0]?.id ?? '');
  const [compareMode, setCompareMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [stampedNotice, setStampedNotice] = useState<string | null>(null);

  const activeContent = sorted.find((c) => c.id === selectedId) ?? sorted[0] ?? null;
  if (!activeContent) return null;

  const previousContent = sorted.find((c) => c.id !== activeContent.id) ?? null;
  const pins = extractRealTimecodePins(messages, decisions);
  const effectiveDuration = duration > 0 ? duration : Math.max(15, ...pins.map((p) => p.seconds + 1));

  const seekTo = (sec: number) => {
    const clamped = Math.max(0, Math.min(effectiveDuration, sec));
    if (videoRef.current) videoRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  };

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
    const next = Math.max(0, Math.min(effectiveDuration, currentTime + deltaFrames * (1 / 24)));
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = next;
    }
    setPlaying(false);
    setCurrentTime(next);
  };

  const cycleSpeed = () => {
    const rates = [0.5, 1, 1.5] as const;
    const next = rates[(rates.indexOf(playbackRate as 0.5 | 1 | 1.5) + 1) % rates.length]!;
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const stampTimecodeToComment = () => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setPlaying(false);
    }
    const label = formatTimecode(currentTime);
    const code = `[${label}] `;
    if (typeof document !== 'undefined') {
      const target =
        document.querySelector<HTMLTextAreaElement>('#review textarea[name="comment"]') ??
        document.querySelector<HTMLTextAreaElement>('#conversation textarea[name="body"]');
      if (target) {
        target.value = target.value ? `${target.value.trim()} ${code}` : code;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
      }
    }
    setStampedNotice(label);
    setTimeout(() => setStampedNotice(null), 2400);
  };

  return (
    <div className="ys-review-stage" data-real-review-player>
      <div className="ys-cinema-topbar">
        <div className="ys-version-pills" role="group" aria-label={isKo ? '버전 선택' : 'Select version'}>
          {sorted.map((c) => (
            <button
              key={c.id}
              type="button"
              data-version={c.version}
              className={c.id === activeContent.id ? 'ys-version-pill ys-version-pill-active' : 'ys-version-pill'}
              onClick={() => setSelectedId(c.id)}
            >
              v{c.version} · {c.title}
            </button>
          ))}
          {previousContent ? (
            <button
              type="button"
              className={compareMode ? 'ys-version-pill ys-version-pill-compare' : 'ys-version-pill'}
              aria-pressed={compareMode}
              onClick={() => setCompareMode((prev) => !prev)}
            >
              {isKo ? '이전 버전과 비교' : 'Compare previous version'}
            </button>
          ) : null}
        </div>
        <div className="ys-timecode-readout" data-timecode aria-live="polite">
          <span className="ys-tc-label">TC</span>
          <code>{formatTimecode(currentTime)}</code>
          <span className="ys-tc-sep">/</span>
          <code>{formatTimecode(effectiveDuration)}</code>
        </div>
      </div>

      <div className={compareMode && previousContent ? 'ys-video-viewport ys-video-split' : 'ys-video-viewport'}>
        <div className="ys-video-primary">
          <video
            ref={videoRef}
            src={activeContent.mediaUrl}
            playsInline
            controls
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
        </div>
        {compareMode && previousContent ? (
          <div className="ys-video-secondary">
            <span className="ys-compare-tag">
              v{previousContent.version} · {previousContent.title}
            </span>
            <video src={previousContent.mediaUrl} playsInline controls muted preload="none" />
          </div>
        ) : null}
      </div>

      <div className="ys-timeline-scrub-area">
        <div className="ys-timeline-pins-track">
          <input
            type="range"
            className="ys-scrub-range"
            min={0}
            max={effectiveDuration}
            step={0.03}
            value={Math.min(currentTime, effectiveDuration)}
            aria-label={isKo ? '영상 타임라인 탐색' : 'Seek video timeline'}
            onChange={(e) => seekTo(Number.parseFloat(e.currentTarget.value))}
          />
          {pins.map((pin) => {
            const pct = Math.min(98, Math.max(2, (pin.seconds / effectiveDuration) * 100));
            return (
              <button
                key={pin.id}
                type="button"
                className="ys-timeline-pin"
                data-pin-author={pin.author}
                data-real-pin={pin.id}
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
            <button type="button" className="ys-transport-btn ys-transport-play" onClick={togglePlay}>
              {playing ? (isKo ? '일시정지' : 'Pause') : isKo ? '재생' : 'Play'}
            </button>
            <button type="button" className="ys-transport-btn" onClick={() => stepFrame(-1)}>
              -1f
            </button>
            <button type="button" className="ys-transport-btn" onClick={() => stepFrame(1)}>
              +1f
            </button>
            <button type="button" className="ys-transport-btn" onClick={cycleSpeed}>
              {playbackRate}x
            </button>
          </div>
          <div className="ys-transport-right">
            <button type="button" className="ys-stamp-btn" onClick={stampTimecodeToComment}>
              {stampedNotice
                ? isKo
                  ? `${stampedNotice} 시간 입력됨`
                  : `Inserted ${stampedNotice}`
                : isKo
                  ? `현재 위치(${formatTimecode(currentTime)}) 코멘트 입력`
                  : `Stamp ${formatTimecode(currentTime)} to comment`}
            </button>
          </div>
        </div>
      </div>

      {pins.length > 0 ? (
        <ul className="bw-list" data-real-pin-list>
          {pins.map((pin) => (
            <li key={pin.id}>
              <button type="button" className="ys-transport-btn" onClick={() => seekTo(pin.seconds)}>
                <code>{pin.label}</code>
              </button>{' '}
              <span>{pin.body}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
