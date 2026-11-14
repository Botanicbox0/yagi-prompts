'use client';

import { useState } from 'react';
import {
  defaultTimelineKeyframes,
  formatKeyframeSeconds,
  type VideoKeyframe,
} from '@/lib/prompts/keyframes';

export interface KeyframePickerProps {
  formatId: string;
  durationSeconds: number;
  title?: string;
  initialKeyframes?: readonly VideoKeyframe[] | null;
  exampleVideoSrc?: string | null;
  locale?: string;
  disabled?: boolean;
  onChange?: (keyframes: VideoKeyframe[]) => void;
  onBeforeSave?: () => Promise<boolean>;
}

export function KeyframePicker({
  formatId,
  durationSeconds,
  title = '',
  initialKeyframes = null,
  exampleVideoSrc = null,
  locale = 'ko',
  disabled = false,
  onChange,
  onBeforeSave,
}: KeyframePickerProps) {
  const safeDuration = Math.max(2, Math.min(120, Math.round(durationSeconds * 10) / 10 || 10));
  const [keyframes, setKeyframes] = useState<VideoKeyframe[]>(() =>
    initialKeyframes?.length
      ? [...initialKeyframes]
      : defaultTimelineKeyframes(safeDuration, 4),
  );
  const [activeSlot, setActiveSlot] = useState<number>(0);
  const [busy, setBusy] = useState<'recommend' | 'save' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const selected = keyframes[activeSlot] ?? keyframes[0]!;

  const updateSlotTime = (timeRaw: number) => {
    const clamped = Math.round(Math.max(0, Math.min(safeDuration, timeRaw)) * 10) / 10;
    const next = keyframes
      .map((kf, i) => (i === activeSlot ? { ...kf, timeSeconds: clamped } : kf))
      .map((kf, i) => ({ ...kf, index: i }));
    setKeyframes(next);
    onChange?.(next);
    setStatusMessage(null);
  };

  const recommendBeats = async () => {
    setBusy('recommend');
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/makers/formats/${formatId}/keyframes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recommend',
          durationSeconds: safeDuration,
          title,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        keyframes?: VideoKeyframe[];
      };
      if (response.ok && json.ok && json.keyframes?.length) {
        setKeyframes(json.keyframes);
        setActiveSlot(0);
        onChange?.(json.keyframes);
        setStatusMessage(
          locale === 'en' ? 'Suggested narrative beats applied.' : '핵심 장면 시점을 추천해 배치했어요.',
        );
      } else {
        const fallback = defaultTimelineKeyframes(safeDuration, 4);
        setKeyframes(fallback);
        onChange?.(fallback);
      }
    } finally {
      setBusy(null);
    }
  };

  const saveKeyframes = async () => {
    setBusy('save');
    setStatusMessage(null);
    try {
      if (onBeforeSave && !(await onBeforeSave())) return;
      const response = await fetch(`/api/makers/formats/${formatId}/keyframes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', keyframes }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        keyframes?: VideoKeyframe[];
      };
      if (response.ok && json.ok && json.keyframes?.length) {
        setKeyframes(json.keyframes);
        onChange?.(json.keyframes);
        setStatusMessage(
          locale === 'en' ? 'Keyframe timestamps saved.' : '핵심 프레임 시점을 저장했어요.',
        );
      } else {
        setStatusMessage(
          locale === 'en' ? 'Save draft first before storing keyframes.' : '초안을 먼저 저장한 뒤 시점을 고정할 수 있어요.',
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const isEn = locale === 'en';

  return (
    <section
      data-maker-keyframe-picker
      className="space-y-4 rounded-[20px] border border-[#E4E4E7] bg-[#FFFFFF] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-[#09090B]">
            {isEn ? '3-Second Keyframe Beat Strip' : '핵심 프레임 구간 설정'}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[#52525B]">
            {isEn
              ? 'Viewers inspect 4 key moments beneath the video player before buying. Adjust timestamps along the timeline.'
              : '구매 전 3초 만에 영상의 흐름을 볼 수 있도록 영상 아래 4개 장면을 띄워 줍니다. 타임라인 슬라이더로 시점을 직접 바꿀 수 있어요.'}
          </p>
        </div>
        <button
          type="button"
          data-keyframe-recommend
          disabled={disabled || busy !== null}
          onClick={() => void recommendBeats()}
          className="inline-flex min-h-9 items-center rounded-full border border-[#E4E4E7] bg-[#F4F4F5] px-3.5 text-xs font-semibold text-[#09090B] transition-colors hover:border-[#09090B] disabled:opacity-45"
        >
          {busy === 'recommend'
            ? isEn
              ? 'Analyzing...'
              : '추천 분석 중...'
            : isEn
              ? 'Auto-recommend beats'
              : '핵심 구간 자동 추천'}
        </button>
      </div>

      {exampleVideoSrc ? (
        <video
          src={exampleVideoSrc}
          muted
          playsInline
          preload="metadata"
          controls
          className="max-h-56 w-full rounded-xl border border-[#E4E4E7] bg-[#09090B] object-contain"
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keyframes.map((kf, idx) => {
          const active = idx === activeSlot;
          return (
            <button
              key={idx}
              type="button"
              data-keyframe-slot={idx}
              aria-pressed={active}
              onClick={() => setActiveSlot(idx)}
              className={`rounded-xl border p-2.5 text-left transition-colors ${
                active
                  ? 'border-[#09090B] bg-[#F4F4F5]'
                  : 'border-[#E4E4E7] bg-[#FFFFFF] hover:border-[#09090B]'
              }`}
            >
              <span className="block font-mono text-xs font-semibold text-[#09090B] tabular-nums">
                {formatKeyframeSeconds(kf.timeSeconds)}
              </span>
              <span className="mt-0.5 block truncate text-[0.72rem] text-[#52525B]">
                {(isEn ? kf.labelEn : kf.labelKo) || `${isEn ? 'Beat' : '장면'} ${idx + 1}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2 rounded-xl border border-[#E4E4E7] bg-[#F4F4F5] p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-[#09090B]">
            {isEn ? `Selected Beat #${activeSlot + 1}` : `선택한 장면 #${activeSlot + 1}`}
          </span>
          <span className="font-mono font-semibold text-[#09090B] tabular-nums">
            {formatKeyframeSeconds(selected.timeSeconds)} / {formatKeyframeSeconds(safeDuration)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.1}
          value={selected.timeSeconds}
          data-keyframe-scrubber
          aria-label={isEn ? 'Keyframe timeline timestamp' : '핵심 프레임 시점 슬라이더'}
          disabled={disabled}
          onChange={(e) => updateSlotTime(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[#09090B]"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {statusMessage ? (
            <span className="text-xs font-medium text-[#09090B]">{statusMessage}</span>
          ) : (
            <span className="text-[0.7rem] text-[#71717A]">
              {isEn ? '0.1s precision scrubber' : '0.1초 단위로 원하는 장면을 고를 수 있어요.'}
            </span>
          )}
          <button
            type="button"
            data-keyframe-save
            disabled={disabled || busy !== null}
            onClick={() => void saveKeyframes()}
            className="inline-flex min-h-8 items-center rounded-full bg-[#FF58AE] px-3.5 text-xs font-bold text-[#09090B] transition-opacity hover:opacity-90 disabled:opacity-45"
          >
            {busy === 'save' ? (isEn ? 'Saving...' : '저장 중...') : isEn ? 'Save keyframes' : '핵심 프레임 저장'}
          </button>
        </div>
      </div>
    </section>
  );
}
