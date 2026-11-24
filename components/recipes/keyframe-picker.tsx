'use client';

import { useRef, useState } from 'react';
import {
  KEYFRAMES_MAX,
  MARKS_PER_PART_MAX,
  defaultTimelineKeyframes,
  formatKeyframeSeconds,
  type VideoKeyframe,
} from '@/lib/prompts/keyframes';

/** The marks editor's words (admin dictionary, `admin.templateMarks`). */
export interface KeyframeMarksCopy {
  heading: string;
  lede: string;
  part: string;
  start: string;
  end: string;
  descKo: string;
  descEn: string;
  add: string;
  remove: string;
  empty: string;
  selected: string;
  save: string;
  saving: string;
  saved: string;
  failed: string;
}

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
  /**
   * Marks mode (docs/PERSONAL-STUDIO.md §3.4.4, T1a — the admin template page): every entry names one of these
   * declared parts and carries an end time and a ko/en description; the list may be empty. Absent, the picker is the
   * maker's beat picker exactly as before.
   */
  parts?: ReadonlyArray<{ key: string; label: string }> | null;
  marksCopy?: KeyframeMarksCopy | null;
  /** Marks mode: how many entries fit next to the row's beats. */
  maxEntries?: number;
  /** Saves through the caller instead of the maker endpoint (the admin page posts `prompt.marks`). */
  saveAction?: (keyframes: VideoKeyframe[]) => Promise<{ ok: boolean; keyframes?: VideoKeyframe[] }>;
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
  parts = null,
  marksCopy = null,
  maxEntries = KEYFRAMES_MAX,
  saveAction,
}: KeyframePickerProps) {
  const marksMode = Boolean(parts && parts.length > 0 && marksCopy);
  const safeDuration = Math.max(2, Math.min(120, Math.round(durationSeconds * 10) / 10 || 10));
  const [keyframes, setKeyframes] = useState<VideoKeyframe[]>(() =>
    marksMode
      ? [...(initialKeyframes ?? [])]
      : initialKeyframes?.length
        ? [...initialKeyframes]
        : defaultTimelineKeyframes(safeDuration, 4),
  );
  const [activeSlot, setActiveSlot] = useState<number>(0);
  const [busy, setBusy] = useState<'recommend' | 'save' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

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
      if (saveAction) {
        const result = await saveAction(keyframes).catch(() => ({ ok: false as const, keyframes: undefined }));
        if (result.ok && result.keyframes) {
          setKeyframes(result.keyframes);
          onChange?.(result.keyframes);
        }
        setStatusMessage(
          marksCopy
            ? result.ok
              ? marksCopy.saved
              : marksCopy.failed
            : result.ok
              ? locale === 'en'
                ? 'Keyframe timestamps saved.'
                : '핵심 프레임 시점을 저장했어요.'
              : locale === 'en'
                ? 'Save draft first before storing keyframes.'
                : '초안을 먼저 저장한 뒤 시점을 고정할 수 있어요.',
        );
        return;
      }
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

  if (marksMode && parts && marksCopy) {
    return (
      <MarksEditor
        parts={parts}
        copy={marksCopy}
        keyframes={keyframes}
        activeSlot={activeSlot}
        safeDuration={safeDuration}
        maxEntries={Math.max(0, Math.min(KEYFRAMES_MAX, maxEntries))}
        exampleVideoSrc={exampleVideoSrc}
        previewRef={previewRef}
        disabled={disabled}
        busy={busy}
        statusMessage={statusMessage}
        onSelect={setActiveSlot}
        onChange={(next, slot) => {
          setKeyframes(next);
          onChange?.(next);
          setStatusMessage(null);
          if (slot !== undefined) setActiveSlot(slot);
        }}
        onSave={() => void saveKeyframes()}
      />
    );
  }

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

const FIELD = 'mt-1 w-full rounded-lg border border-[#E4E4E7] bg-[#FFFFFF] px-2.5 py-1.5 text-xs text-[#09090B]';
const FIELD_LABEL = 'block text-[0.72rem] font-medium text-[#52525B]';

/**
 * The marks editor (admin only, docs/PERSONAL-STUDIO.md §3.4.4): one entry per range of the example video, each naming
 * a declared part, with a start, an end and a ko/en description. Moving a slider shows that moment in the clip.
 */
function MarksEditor({
  parts,
  copy,
  keyframes,
  activeSlot,
  safeDuration,
  maxEntries,
  exampleVideoSrc,
  previewRef,
  disabled,
  busy,
  statusMessage,
  onSelect,
  onChange,
  onSave,
}: {
  parts: ReadonlyArray<{ key: string; label: string }>;
  copy: KeyframeMarksCopy;
  keyframes: VideoKeyframe[];
  activeSlot: number;
  safeDuration: number;
  maxEntries: number;
  exampleVideoSrc: string | null;
  previewRef: { current: HTMLVideoElement | null };
  disabled: boolean;
  busy: 'recommend' | 'save' | null;
  statusMessage: string | null;
  onSelect: (slot: number) => void;
  onChange: (next: VideoKeyframe[], slot?: number) => void;
  onSave: () => void;
}) {
  const selected = keyframes[activeSlot] ?? null;
  const labelOf = (key: string | undefined) => parts.find((p) => p.key === key)?.label ?? key ?? '';
  const round = (value: number) => Math.round(Math.max(0, Math.min(safeDuration, value)) * 10) / 10;
  const countFor = (key: string, except = -1) => keyframes.filter((kf, i) => i !== except && kf.part === key).length;
  const freePart = parts.find((p) => countFor(p.key) < MARKS_PER_PART_MAX) ?? null;

  const show = (seconds: number) => {
    const el = previewRef.current;
    if (!el) return;
    try {
      el.currentTime = seconds;
    } catch {
      // Not loaded yet: the slider value is still kept.
    }
  };
  const update = (patch: Partial<VideoKeyframe>) => {
    if (!selected) return;
    onChange(keyframes.map((kf, i) => (i === activeSlot ? { ...kf, ...patch } : kf)));
  };
  const setStart = (value: number) => {
    const start = round(value);
    const end = selected?.endSeconds ?? start;
    update({ timeSeconds: start, endSeconds: end > start ? end : round(start + 0.5) });
    show(start);
  };
  const setEnd = (value: number) => {
    const end = round(value);
    update({ endSeconds: end });
    show(end);
  };
  const add = () => {
    if (!freePart || keyframes.length >= maxEntries) return;
    const next = [...keyframes, { index: keyframes.length, timeSeconds: 0, endSeconds: round(Math.min(2, safeDuration)), part: freePart.key }];
    onChange(next, next.length - 1);
  };
  const remove = () => {
    if (!selected) return;
    const next = keyframes.filter((_, i) => i !== activeSlot).map((kf, index) => ({ ...kf, index }));
    onChange(next, Math.max(0, activeSlot - 1));
  };

  return (
    <section data-maker-keyframe-picker data-keyframe-marks className="space-y-4 rounded-[20px] border border-[#E4E4E7] bg-[#FFFFFF] p-5">
      <div>
        <h3 className="text-base font-semibold tracking-tight text-[#09090B]">{copy.heading}</h3>
        <p className="mt-1 text-xs leading-relaxed text-[#52525B]">{copy.lede}</p>
      </div>

      {exampleVideoSrc ? (
        <video
          ref={previewRef}
          src={exampleVideoSrc}
          muted
          playsInline
          preload="metadata"
          controls
          className="max-h-56 w-full rounded-xl border border-[#E4E4E7] bg-[#09090B] object-contain"
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keyframes.map((kf, idx) => (
          <button
            key={idx}
            type="button"
            data-keyframe-slot={idx}
            data-keyframe-slot-part={kf.part}
            aria-pressed={idx === activeSlot}
            onClick={() => {
              onSelect(idx);
              show(kf.timeSeconds);
            }}
            className={`rounded-xl border p-2.5 text-left transition-colors ${
              idx === activeSlot ? 'border-[#09090B] bg-[#F4F4F5]' : 'border-[#E4E4E7] bg-[#FFFFFF] hover:border-[#09090B]'
            }`}
          >
            <span className="block truncate text-xs font-semibold text-[#09090B]">{labelOf(kf.part)}</span>
            <span className="mt-0.5 block font-mono text-[0.72rem] text-[#52525B] tabular-nums">
              {formatKeyframeSeconds(kf.timeSeconds)}–{formatKeyframeSeconds(kf.endSeconds ?? kf.timeSeconds)}
            </span>
          </button>
        ))}
        <button
          type="button"
          data-keyframe-add
          disabled={disabled || !freePart || keyframes.length >= maxEntries}
          onClick={add}
          className="rounded-xl border border-dashed border-[#D4D4D8] p-2.5 text-left text-xs font-semibold text-[#09090B] hover:border-[#09090B] disabled:opacity-45"
        >
          + {copy.add}
        </button>
      </div>
      {keyframes.length === 0 ? <p data-keyframe-empty className="text-xs text-[#71717A]">{copy.empty}</p> : null}

      <div className="space-y-3 rounded-xl border border-[#E4E4E7] bg-[#F4F4F5] p-3">
        {selected ? (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#09090B]">{copy.selected}</span>
              <span className="font-mono font-semibold text-[#09090B] tabular-nums">
                {formatKeyframeSeconds(selected.timeSeconds)}–{formatKeyframeSeconds(selected.endSeconds ?? selected.timeSeconds)} / {formatKeyframeSeconds(safeDuration)}
              </span>
            </div>
            <label className={FIELD_LABEL}>
              {copy.part}
              <select
                data-keyframe-part
                value={selected.part ?? ''}
                disabled={disabled}
                onChange={(e) => update({ part: e.target.value })}
                className={FIELD}
              >
                {parts.map((p) => (
                  <option key={p.key} value={p.key} disabled={p.key !== selected.part && countFor(p.key, activeSlot) >= MARKS_PER_PART_MAX}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD_LABEL}>
              {copy.start}
              <input
                type="range"
                min={0}
                max={safeDuration}
                step={0.1}
                value={selected.timeSeconds}
                data-keyframe-scrubber
                disabled={disabled}
                onChange={(e) => setStart(Number(e.target.value))}
                className="mt-1 h-2 w-full cursor-pointer accent-[#09090B]"
              />
            </label>
            <label className={FIELD_LABEL}>
              {copy.end}
              <input
                type="range"
                min={0}
                max={safeDuration}
                step={0.1}
                value={selected.endSeconds ?? selected.timeSeconds}
                data-keyframe-end
                disabled={disabled}
                onChange={(e) => setEnd(Number(e.target.value))}
                className="mt-1 h-2 w-full cursor-pointer accent-[#09090B]"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={FIELD_LABEL}>
                {copy.descKo}
                <input
                  type="text"
                  maxLength={40}
                  value={selected.labelKo ?? ''}
                  data-keyframe-label-ko
                  disabled={disabled}
                  onChange={(e) => update({ labelKo: e.target.value.slice(0, 40) })}
                  className={FIELD}
                />
              </label>
              <label className={FIELD_LABEL}>
                {copy.descEn}
                <input
                  type="text"
                  maxLength={40}
                  value={selected.labelEn ?? ''}
                  data-keyframe-label-en
                  disabled={disabled}
                  onChange={(e) => update({ labelEn: e.target.value.slice(0, 40) })}
                  className={FIELD}
                />
              </label>
            </div>
            <button
              type="button"
              data-keyframe-remove
              disabled={disabled}
              onClick={remove}
              className="text-xs font-medium text-[#52525B] underline-offset-2 hover:text-[#09090B] hover:underline disabled:opacity-45"
            >
              {copy.remove}
            </button>
          </>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs font-medium text-[#09090B]" aria-live="polite">{statusMessage ?? ''}</span>
          <button
            type="button"
            data-keyframe-save
            disabled={disabled || busy !== null}
            onClick={onSave}
            className="inline-flex min-h-8 items-center rounded-full bg-[#09090B] px-3.5 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:opacity-45"
          >
            {busy === 'save' ? copy.saving : copy.save}
          </button>
        </div>
      </div>
    </section>
  );
}
