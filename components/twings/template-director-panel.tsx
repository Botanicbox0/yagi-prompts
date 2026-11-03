'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type {
  DirectorEditableSlot,
  DirectorSummaryChip,
  PhotoInspectionVerdict
} from '@/lib/template-director/schema';

export interface DirectorReferenceSlotValue {
  slotName: 'outfit' | 'prop';
  role: 'look' | 'product';
  file: File;
  previewUrl: string;
}

export interface TemplateDirectorCopy {
  toggleOpen: string;
  toggleClose: string;
  subtitle: string;
  outfitSlotLabel: string;
  outfitSlotHint: string;
  propSlotLabel: string;
  propSlotHint: string;
  removeSlotLabel: string;
  inputLabel: string;
  inputPlaceholder: string;
  defaultReferencePrompt: string;
  applyButton: string;
  applyingButton: string;
  resetButton: string;
  activeChipsLabel: string;
  removeChipLabel: string;
  cleanupAcceptOcclusion: string;
  cleanupAcceptRetouch: string;
  cleanupAcceptDetail: string;
  cleanupAcceptedBadge: string;
  cleanupSkipButton: string;
  cleanupSkippedBadge: string;
  cleanupChangeButton: string;
  retakeRecommendedBadge: string;
  fileInvalidError: string;
  quickPresets: ReadonlyArray<{
    slot: DirectorEditableSlot;
    label: string;
    samplePrompt: string;
  }>;
}

export const DEFAULT_TEMPLATE_DIRECTOR_COPY_KO: TemplateDirectorCopy = {
  toggleOpen: '+ 의상 · 소품 · 장면 조금 바꾸기',
  toggleClose: '장면 바꾸기 접기',
  subtitle: '원본 템플릿의 카메라 구도와 색감은 그대로 두고, 내 옷·소품 사진이나 원하는 표정을 자연스럽게 반영합니다.',
  outfitSlotLabel: '입힐 의상 사진',
  outfitSlotHint: '@Image 2 · 룩 레퍼런스',
  propSlotLabel: '들려줄 소품 · 제품',
  propSlotHint: '@Image 3 · 소품 레퍼런스',
  removeSlotLabel: '참조 사진 빼기',
  inputLabel: '디렉터에게 한 줄 요청',
  inputPlaceholder: '예: 2번째 컷에서 컵 대신 내 향수를 들고 정면을 보며 살짝 웃게 해줘',
  defaultReferencePrompt: '첨부한 레퍼런스 사진을 장면에 자연스럽게 반영해 줘',
  applyButton: '장면에 반영',
  applyingButton: '반영 중…',
  resetButton: '원본 설정으로 초기화',
  activeChipsLabel: '적용된 커스텀 설정',
  removeChipLabel: '설정 해제',
  cleanupAcceptOcclusion: 'TWINGS가 가려진 부분 정리해서 진행 (+2 크레딧)',
  cleanupAcceptRetouch: 'TWINGS가 자연스러운 카메라 비율·피부 결로 정돈해서 진행 (+2 크레딧)',
  cleanupAcceptDetail: 'TWINGS 광학 선명도 복원 적용 (무료)',
  cleanupAcceptedBadge: '사진 자동 정리 적용됨',
  cleanupSkipButton: '원본 사진 그대로 쓰기',
  cleanupSkippedBadge: '원본 사진 그대로 진행',
  cleanupChangeButton: '다시 선택',
  retakeRecommendedBadge: '정면 독사진 권장',
  fileInvalidError: 'JPG, PNG, WEBP 사진(5MB 이하)만 첨부할 수 있습니다.',
  quickPresets: [
    {
      slot: 'outfit',
      label: '의상 바꾸기',
      samplePrompt: '첨부한 의상 사진 스타일로 자연스럽게 갈아입혀 줘'
    },
    {
      slot: 'prop',
      label: '손에 든 소품 바꾸기',
      samplePrompt: '기존 소품은 빼고 첨부한 제품을 손에 자연스럽게 들려줘'
    },
    {
      slot: 'shot_action',
      label: '표정 · 시선 다듬기',
      samplePrompt: '마지막 컷에서 카메라를 보며 여유 있게 미소 짓게 해줘'
    },
    {
      slot: 'hair',
      label: '내 헤어스타일 고정',
      samplePrompt: '내 셀카 속 원래 머리 길이와 앞머리 스타일을 끝까지 유지해 줘'
    }
  ]
};

export const DEFAULT_TEMPLATE_DIRECTOR_COPY_EN: TemplateDirectorCopy = {
  toggleOpen: '+ Customize outfit, prop, or scene',
  toggleClose: 'Hide customization',
  subtitle: 'Keep the template camera work and colour world while swapping in your look, prop, or micro-acting.',
  outfitSlotLabel: 'Outfit reference',
  outfitSlotHint: '@Image 2 · Look authority',
  propSlotLabel: 'Prop or product',
  propSlotHint: '@Image 3 · Object authority',
  removeSlotLabel: 'Remove reference',
  inputLabel: 'One-line note to the director',
  inputPlaceholder: 'e.g. In shot 2, hold my perfume bottle instead of the cup and smile softly at the lens',
  defaultReferencePrompt: 'Apply the attached reference image naturally to the scene',
  applyButton: 'Apply to scene',
  applyingButton: 'Applying…',
  resetButton: 'Reset to original',
  activeChipsLabel: 'Applied customizations',
  removeChipLabel: 'Remove customization',
  cleanupAcceptOcclusion: 'Clean up occlusion with TWINGS (+2 credits)',
  cleanupAcceptRetouch: 'Normalize beauty-filter proportions with TWINGS (+2 credits)',
  cleanupAcceptDetail: 'Restore optical sharpness with TWINGS (Free)',
  cleanupAcceptedBadge: 'Auto photo cleanup active',
  cleanupSkipButton: 'Use original photo as-is',
  cleanupSkippedBadge: 'Using original photo as-is',
  cleanupChangeButton: 'Change choice',
  retakeRecommendedBadge: 'Front solo photo recommended',
  fileInvalidError: 'Please attach a JPG, PNG, or WEBP image under 5 MB.',
  quickPresets: [
    {
      slot: 'outfit',
      label: 'Swap outfit',
      samplePrompt: 'Dress me in the attached outfit reference while keeping the scene lighting'
    },
    {
      slot: 'prop',
      label: 'Swap held prop',
      samplePrompt: 'Remove the default prop and hold the attached product naturally'
    },
    {
      slot: 'shot_action',
      label: 'Refine expression',
      samplePrompt: 'In the final cut, glance toward the camera with a calm, understated smile'
    },
    {
      slot: 'hair',
      label: 'Lock my hairstyle',
      samplePrompt: 'Preserve my exact hair length and bangs from my selfie across every cut'
    }
  ]
};

const MAX_REFERENCE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DIRECTOR_INPUT_CHARS = 320;
const ALLOWED_REFERENCE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Upserts summary chips by slot so applying a new `outfit`, `prop`, `hair`, or `lighting_mood`
 * cleanly replaces the previous chip for that slot instead of accumulating duplicates.
 */
export function upsertSummaryChips(
  existing: readonly DirectorSummaryChip[],
  incoming: readonly DirectorSummaryChip[]
): DirectorSummaryChip[] {
  const map = new Map<string, DirectorSummaryChip>();
  for (const chip of existing) {
    const key = chip.slot === 'shot_action' ? `${chip.slot}:${chip.labelKo}` : chip.slot;
    map.set(key, chip);
  }
  for (const chip of incoming) {
    const key = chip.slot === 'shot_action' ? `${chip.slot}:${chip.labelKo}` : chip.slot;
    map.set(key, chip);
  }
  return [...map.values()];
}

export interface TemplateDirectorPanelProps {
  locale?: string;
  copy?: TemplateDirectorCopy;
  photoInspection?: PhotoInspectionVerdict | null;
  initialExpanded?: boolean;
  initialChips?: DirectorSummaryChip[];
  initialAssistantMessage?: string | null;
  disabled?: boolean;
  onCleanupChoice?: (choice: 'accept' | 'skip' | 'pending') => void;
  onSubmitTurn?: (input: {
    userMessage: string;
    references: ReadonlyArray<{ slotName: 'outfit' | 'prop'; role: 'look' | 'product'; file: File }>;
  }) => Promise<{
    accepted: boolean;
    assistantMessage: string;
    summaryChips: DirectorSummaryChip[];
  }>;
  onChipsChange?: (chips: DirectorSummaryChip[]) => void;
}

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3875C5]';

export function TemplateDirectorPanel({
  locale = 'ko',
  copy = locale === 'en' ? DEFAULT_TEMPLATE_DIRECTOR_COPY_EN : DEFAULT_TEMPLATE_DIRECTOR_COPY_KO,
  photoInspection = null,
  initialExpanded = false,
  initialChips = [],
  initialAssistantMessage = null,
  disabled = false,
  onCleanupChoice,
  onSubmitTurn,
  onChipsChange
}: TemplateDirectorPanelProps) {
  const baseId = useId();
  const drawerId = `${baseId}-drawer`;
  const inputId = `${baseId}-input`;
  const statusId = `${baseId}-status`;

  const [expanded, setExpanded] = useState(initialExpanded || initialChips.length > 0);
  const [cleanupChoice, setCleanupChoice] = useState<'pending' | 'accepted' | 'skipped'>('pending');
  const [userMessage, setUserMessage] = useState('');
  const [chips, setChips] = useState<DirectorSummaryChip[]>(initialChips);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(initialAssistantMessage);
  const [turnAccepted, setTurnAccepted] = useState<boolean>(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draggingSlot, setDraggingSlot] = useState<'outfit' | 'prop' | null>(null);
  const [, startTransition] = useTransition();

  const [outfitSlot, setOutfitSlot] = useState<DirectorReferenceSlotValue | null>(null);
  const [propSlot, setPropSlot] = useState<DirectorReferenceSlotValue | null>(null);

  const outfitInputRef = useRef<HTMLInputElement>(null);
  const propInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const activeUrlsRef = useRef<Set<string>>(new Set());
  const requestEpochRef = useRef(0);

  // Clean up all created object URLs on unmount so mobile Safari never leaks blob memory.
  useEffect(() => {
    const urls = activeUrlsRef.current;
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  // Reset cleanup decision if the inspected photo verdict changes.
  useEffect(() => {
    setCleanupChoice('pending');
  }, [photoInspection?.status, photoInspection?.userMessageKo]);

  const assignReferenceSlot = (
    slotName: 'outfit' | 'prop',
    role: 'look' | 'product',
    file: File | null | undefined
  ) => {
    if (!file) return;
    if (!ALLOWED_REFERENCE_MIMES.has(file.type) || file.size > MAX_REFERENCE_FILE_BYTES) {
      setFileError(copy.fileInvalidError);
      return;
    }
    setFileError(null);
    const previewUrl = URL.createObjectURL(file);
    activeUrlsRef.current.add(previewUrl);

    if (slotName === 'outfit') {
      if (outfitSlot?.previewUrl) {
        URL.revokeObjectURL(outfitSlot.previewUrl);
        activeUrlsRef.current.delete(outfitSlot.previewUrl);
      }
      setOutfitSlot({ slotName, role, file, previewUrl });
    } else {
      if (propSlot?.previewUrl) {
        URL.revokeObjectURL(propSlot.previewUrl);
        activeUrlsRef.current.delete(propSlot.previewUrl);
      }
      setPropSlot({ slotName, role, file, previewUrl });
    }
  };

  const clearReferenceSlot = (slotName: 'outfit' | 'prop') => {
    if (slotName === 'outfit' && outfitSlot) {
      URL.revokeObjectURL(outfitSlot.previewUrl);
      activeUrlsRef.current.delete(outfitSlot.previewUrl);
      setOutfitSlot(null);
      if (outfitInputRef.current) outfitInputRef.current.value = '';
    }
    if (slotName === 'prop' && propSlot) {
      URL.revokeObjectURL(propSlot.previewUrl);
      activeUrlsRef.current.delete(propSlot.previewUrl);
      setPropSlot(null);
      if (propInputRef.current) propInputRef.current.value = '';
    }
  };

  const removeChip = (indexToRemove: number) => {
    startTransition(() => {
      const next = chips.filter((_, idx) => idx !== indexToRemove);
      setChips(next);
      onChipsChange?.(next);
    });
  };

  const resetAll = () => {
    requestEpochRef.current += 1;
    setSubmitting(false);
    clearReferenceSlot('outfit');
    clearReferenceSlot('prop');
    setUserMessage('');
    setFileError(null);
    setAssistantMessage(null);
    setTurnAccepted(true);
    startTransition(() => {
      setChips([]);
      onChipsChange?.([]);
    });
  };

  const handleApplyTurn = async () => {
    const trimmed = userMessage.trim();
    const refs = [outfitSlot, propSlot].filter(
      (item): item is DirectorReferenceSlotValue => item !== null
    );
    if ((!trimmed && refs.length === 0) || submitting || disabled) return;

    const effectiveMessage = trimmed || copy.defaultReferencePrompt;

    if (!onSubmitTurn) {
      const generatedChips: DirectorSummaryChip[] = [];
      if (outfitSlot) {
        generatedChips.push({
          slot: 'outfit',
          labelKo: locale === 'en' ? 'Outfit' : '의상',
          summaryKo: trimmed ? trimmed.slice(0, 36) : outfitSlot.file.name.slice(0, 28)
        });
      }
      if (propSlot) {
        generatedChips.push({
          slot: 'prop',
          labelKo: locale === 'en' ? 'Prop' : '소품',
          summaryKo: trimmed ? trimmed.slice(0, 36) : propSlot.file.name.slice(0, 28)
        });
      }
      if (generatedChips.length === 0 && trimmed) {
        generatedChips.push({
          slot: 'shot_action',
          labelKo: locale === 'en' ? 'Direction' : '연출',
          summaryKo: trimmed.slice(0, 36)
        });
      }
      const next = upsertSummaryChips(chips, generatedChips);
      setChips(next);
      setUserMessage('');
      onChipsChange?.(next);
      return;
    }

    const myEpoch = ++requestEpochRef.current;
    setSubmitting(true);
    setFileError(null);
    try {
      const result = await onSubmitTurn({
        userMessage: effectiveMessage,
        references: refs.map(({ slotName, role, file }) => ({ slotName, role, file }))
      });
      if (requestEpochRef.current !== myEpoch) return;
      setTurnAccepted(result.accepted);
      setAssistantMessage(result.assistantMessage);
      if (result.accepted) {
        const next = upsertSummaryChips(chips, result.summaryChips);
        setChips(next);
        setUserMessage('');
        onChipsChange?.(next);
      }
    } finally {
      if (requestEpochRef.current === myEpoch) {
        setSubmitting(false);
      }
    }
  };

  const showInspectionCard =
    photoInspection !== null &&
    (photoInspection.status === 'needs_cleanup' || photoInspection.status === 'needs_retake');

  const inspectionMessage =
    photoInspection === null
      ? null
      : locale === 'en'
        ? photoInspection.userMessageEn
        : photoInspection.userMessageKo;

  const cleanupMode = photoInspection?.recommendedCleanup.mode ?? 'none';
  const cleanupAcceptLabel =
    cleanupMode === 'inpaint_occlusion'
      ? copy.cleanupAcceptOcclusion
      : cleanupMode === 'normalize_retouch'
        ? copy.cleanupAcceptRetouch
        : copy.cleanupAcceptDetail;

  return (
    <div
      data-template-director-panel
      data-director-expanded={expanded ? 'true' : 'false'}
      className="mt-4 flex flex-col gap-3 text-[#0E1013]"
    >
      {/* Step 0: Uploaded Photo Inspection & Auto-Cleanup Advisory Banner (Sky Tint + Double-Ring Specular Border) */}
      {showInspectionCard && photoInspection && (
        <aside
          data-photo-inspection-banner={photoInspection.status}
          data-photo-cleanup-mode={photoInspection.recommendedCleanup.mode}
          data-photo-cleanup-choice={cleanupChoice}
          aria-label="사진 자동 검수 안내"
          className="rounded-[20px] border border-[#E4E6EA] bg-[#F3F7FA] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_2px_8px_rgba(14,16,19,0.03)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8EFF7] px-2.5 py-1 font-mono text-[0.7rem] font-medium tracking-tight text-[#3063A7] tabular-nums">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3875C5]" />
              {photoInspection.status === 'needs_retake'
                ? copy.retakeRecommendedBadge
                : cleanupChoice === 'accepted'
                  ? copy.cleanupAcceptedBadge
                  : cleanupChoice === 'skipped'
                    ? copy.cleanupSkippedBadge
                    : `FACE RATIO ${Math.round(photoInspection.faceWidthRatio * 100)}%`}
            </span>

            {photoInspection.status === 'needs_cleanup' && cleanupChoice !== 'pending' && (
              <button
                type="button"
                data-photo-cleanup-change
                disabled={disabled}
                onClick={() => {
                  setCleanupChoice('pending');
                  onCleanupChoice?.('pending');
                }}
                className={`inline-flex min-h-9 items-center rounded-full px-2.5 text-xs font-medium text-[#3063A7] underline underline-offset-4 hover:text-[#0E1013] ${FOCUS_RING}`}
              >
                {copy.cleanupChangeButton}
              </button>
            )}
          </div>

          <p className="mt-2.5 text-[0.9rem] leading-[1.58] text-[#0E1013]">{inspectionMessage}</p>

          {photoInspection.status === 'needs_cleanup' && cleanupChoice === 'pending' && (
            <div className="mt-3.5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                data-photo-cleanup-accept
                disabled={disabled}
                onClick={() => {
                  setCleanupChoice('accepted');
                  onCleanupChoice?.('accept');
                }}
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-[#3875C5] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 ${FOCUS_RING}`}
              >
                {cleanupAcceptLabel}
              </button>
              <button
                type="button"
                data-photo-cleanup-skip
                disabled={disabled}
                onClick={() => {
                  setCleanupChoice('skipped');
                  onCleanupChoice?.('skip');
                }}
                className={`inline-flex min-h-11 items-center justify-center rounded-full border border-[#C7CCD3] bg-white px-4 py-2 text-xs font-medium text-[#41444D] transition-colors hover:border-[#0E1013] hover:text-[#0E1013] disabled:opacity-40 ${FOCUS_RING}`}
              >
                {copy.cleanupSkipButton}
              </button>
            </div>
          )}
        </aside>
      )}

      {/* Progressive Disclosure Trigger Pill + Active Chip Count Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          data-director-toggle
          aria-expanded={expanded}
          aria-controls={drawerId}
          disabled={disabled}
          onClick={() => setExpanded((prev) => !prev)}
          className={[
            'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors',
            FOCUS_RING,
            expanded
              ? 'border-[#3875C5] bg-[#E8EFF7] text-[#3063A7]'
              : 'border-[#E4E6EA] bg-white text-[#41444D] hover:border-[#C7CCD3] hover:text-[#0E1013]'
          ].join(' ')}
        >
          <span>{expanded ? copy.toggleClose : copy.toggleOpen}</span>
          {chips.length > 0 && (
            <span
              data-director-chip-count
              className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#3875C5] px-1.5 py-0.5 font-mono text-[0.68rem] font-semibold text-white tabular-nums"
            >
              {chips.length}
            </span>
          )}
        </button>

        {chips.length > 0 && (
          <button
            type="button"
            data-director-reset
            disabled={disabled || submitting}
            onClick={resetAll}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs text-[#676B75] underline underline-offset-4 hover:text-[#0E1013] disabled:opacity-40 ${FOCUS_RING}`}
          >
            {copy.resetButton}
          </button>
        )}
      </div>

      {/* Applied Customization Summary Chips (Visible even when drawer is collapsed) */}
      {chips.length > 0 && (
        <div
          data-director-summary-chips
          aria-label={copy.activeChipsLabel}
          className="flex flex-wrap gap-1.5"
        >
          {chips.map((chip, index) => (
            <span
              key={`${chip.slot}-${chip.summaryKo}-${index}`}
              data-director-chip={chip.slot}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#0E1013] py-1 pr-1 pl-3.5 text-xs font-medium text-white"
            >
              <span className="font-mono text-[0.68rem] text-[#DCE8F5] uppercase">
                {chip.labelKo}
              </span>
              <span>· {chip.summaryKo}</span>
              <button
                type="button"
                data-director-chip-remove={index}
                aria-label={`${chip.labelKo} ${chip.summaryKo} ${copy.removeChipLabel}`}
                disabled={disabled || submitting}
                onClick={() => removeChip(index)}
                className={`inline-flex size-8 items-center justify-center rounded-full text-sm text-white/80 hover:bg-white/15 hover:text-white ${FOCUS_RING}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dynamic Contextual Island: Expandable Personal Director Tray */}
      <div
        id={drawerId}
        hidden={!expanded}
        data-director-island
        className="rounded-[24px] border border-[#E4E6EA] bg-white p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_4px_16px_rgba(14,16,19,0.04)] transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      >
        <p className="text-xs leading-[1.6] text-[#676B75]">{copy.subtitle}</p>

        {/* Quick 1-Tap Preset Pills */}
        <div data-director-presets className="mt-3 flex flex-wrap gap-1.5">
          {copy.quickPresets.map((preset) => (
            <button
              key={preset.slot}
              type="button"
              data-director-preset={preset.slot}
              disabled={disabled || submitting}
              onClick={() => {
                setUserMessage(preset.samplePrompt);
                textInputRef.current?.focus();
              }}
              className={`inline-flex min-h-9 items-center rounded-full border border-[#E4E6EA] bg-[#F6F7F9] px-3 py-1 text-xs text-[#41444D] transition-colors hover:border-[#3875C5] hover:bg-[#E8EFF7] hover:text-[#3063A7] disabled:opacity-40 ${FOCUS_RING}`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Recessed Tactile Wells for Optional User Reference Images (@Image 2 Look, @Image 3 Prop) */}
        <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <input
            ref={outfitInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || submitting}
            onChange={(e) => assignReferenceSlot('outfit', 'look', e.currentTarget.files?.[0])}
          />
          <input
            ref={propInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || submitting}
            onChange={(e) => assignReferenceSlot('prop', 'product', e.currentTarget.files?.[0])}
          />

          {/* Slot 1: @Image 2 Outfit Reference */}
          <div
            data-director-slot="outfit"
            data-slot-filled={outfitSlot ? 'true' : 'false'}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled && !submitting) setDraggingSlot('outfit');
            }}
            onDragLeave={() => setDraggingSlot((prev) => (prev === 'outfit' ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingSlot(null);
              if (!disabled && !submitting) {
                assignReferenceSlot('outfit', 'look', e.dataTransfer.files?.[0]);
              }
            }}
            className={[
              'flex items-center justify-between gap-3 rounded-[18px] border p-3 shadow-[inset_0_1px_2px_rgba(14,16,19,0.04)] transition-colors',
              draggingSlot === 'outfit'
                ? 'border-[#3875C5] bg-[#E8EFF7]'
                : 'border-[#E4E6EA] bg-[#F6F7F9]'
            ].join(' ')}
          >
            {outfitSlot ? (
              <>
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-[#E4E6EA] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    <img
                      src={outfitSlot.previewUrl}
                      alt={copy.outfitSlotLabel}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#0E1013]">
                      {outfitSlot.file.name}
                    </p>
                    <p className="font-mono text-[0.68rem] text-[#3063A7] tabular-nums">
                      {copy.outfitSlotHint}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-director-slot-clear="outfit"
                  aria-label={`${copy.outfitSlotLabel} ${copy.removeSlotLabel}`}
                  onClick={() => clearReferenceSlot('outfit')}
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-sm text-[#676B75] hover:bg-black/5 hover:text-[#0E1013] ${FOCUS_RING}`}
                >
                  ×
                </button>
              </>
            ) : (
              <button
                type="button"
                data-director-slot-pick="outfit"
                disabled={disabled || submitting}
                onClick={() => outfitInputRef.current?.click()}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left disabled:opacity-40 ${FOCUS_RING}`}
              >
                <div>
                  <p className="text-xs font-semibold text-[#0E1013]">+ {copy.outfitSlotLabel}</p>
                  <p className="font-mono text-[0.68rem] text-[#676B75] tabular-nums">
                    {copy.outfitSlotHint}
                  </p>
                </div>
                <span className="rounded-full border border-[#C7CCD3] bg-white px-2.5 py-1 font-mono text-[0.68rem] text-[#41444D]">
                  JPG·PNG
                </span>
              </button>
            )}
          </div>

          {/* Slot 2: @Image 3 Prop / Product Reference */}
          <div
            data-director-slot="prop"
            data-slot-filled={propSlot ? 'true' : 'false'}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled && !submitting) setDraggingSlot('prop');
            }}
            onDragLeave={() => setDraggingSlot((prev) => (prev === 'prop' ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingSlot(null);
              if (!disabled && !submitting) {
                assignReferenceSlot('prop', 'product', e.dataTransfer.files?.[0]);
              }
            }}
            className={[
              'flex items-center justify-between gap-3 rounded-[18px] border p-3 shadow-[inset_0_1px_2px_rgba(14,16,19,0.04)] transition-colors',
              draggingSlot === 'prop'
                ? 'border-[#3875C5] bg-[#E8EFF7]'
                : 'border-[#E4E6EA] bg-[#F6F7F9]'
            ].join(' ')}
          >
            {propSlot ? (
              <>
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-[#E4E6EA] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    <img
                      src={propSlot.previewUrl}
                      alt={copy.propSlotLabel}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#0E1013]">
                      {propSlot.file.name}
                    </p>
                    <p className="font-mono text-[0.68rem] text-[#3063A7] tabular-nums">
                      {copy.propSlotHint}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-director-slot-clear="prop"
                  aria-label={`${copy.propSlotLabel} ${copy.removeSlotLabel}`}
                  onClick={() => clearReferenceSlot('prop')}
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-sm text-[#676B75] hover:bg-black/5 hover:text-[#0E1013] ${FOCUS_RING}`}
                >
                  ×
                </button>
              </>
            ) : (
              <button
                type="button"
                data-director-slot-pick="prop"
                disabled={disabled || submitting}
                onClick={() => propInputRef.current?.click()}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left disabled:opacity-40 ${FOCUS_RING}`}
              >
                <div>
                  <p className="text-xs font-semibold text-[#0E1013]">+ {copy.propSlotLabel}</p>
                  <p className="font-mono text-[0.68rem] text-[#676B75] tabular-nums">
                    {copy.propSlotHint}
                  </p>
                </div>
                <span className="rounded-full border border-[#C7CCD3] bg-white px-2.5 py-1 font-mono text-[0.68rem] text-[#41444D]">
                  JPG·PNG
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Recessed Tactile Text Input + Apply Pill CTA */}
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={inputId} className="block text-xs font-semibold text-[#0E1013]">
              {copy.inputLabel}
            </label>
            <span
              data-director-char-count
              className="font-mono text-[0.68rem] text-[#676B75] tabular-nums"
            >
              {userMessage.length}/{MAX_DIRECTOR_INPUT_CHARS}
            </span>
          </div>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              ref={textInputRef}
              id={inputId}
              data-director-input
              rows={2}
              maxLength={MAX_DIRECTOR_INPUT_CHARS}
              disabled={disabled || submitting}
              value={userMessage}
              placeholder={copy.inputPlaceholder}
              onChange={(e) => setUserMessage(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleApplyTurn();
                }
              }}
              className="w-full flex-1 resize-none rounded-[18px] border border-[#E4E6EA] bg-[#F6F7F9] px-3.5 py-2.5 text-sm leading-relaxed text-[#0E1013] shadow-[inset_0_1px_2px_rgba(14,16,19,0.05)] placeholder:text-[#676B75]/75 focus:border-[#3875C5] focus:bg-white focus:outline-none"
            />
            <button
              type="button"
              data-director-apply
              disabled={
                disabled ||
                submitting ||
                (!userMessage.trim() && outfitSlot === null && propSlot === null)
              }
              onClick={() => void handleApplyTurn()}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[#3875C5] px-5 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:bg-[#E4E6EA] disabled:text-[#676B75] ${FOCUS_RING}`}
            >
              {submitting ? copy.applyingButton : copy.applyButton}
            </button>
          </div>
        </div>

        {/* Live Region for Director Feedback & File Validation Errors */}
        <div id={statusId} role="status" aria-live="polite" className="mt-2">
          {fileError && (
            <p data-director-file-error className="text-xs font-medium text-[#3063A7]">
              {fileError}
            </p>
          )}
          {assistantMessage && (
            <p
              data-director-assistant-message
              data-director-accepted={turnAccepted ? 'true' : 'false'}
              className={[
                'mt-1 rounded-xl px-3 py-2 text-xs leading-relaxed',
                turnAccepted
                  ? 'bg-[#E8EFF7] text-[#3063A7]'
                  : 'border border-[#C7CCD3] bg-[#F6F7F9] text-[#41444D]'
              ].join(' ')}
            >
              {assistantMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
