'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
  resolveTemplateBaseline,
  type DirectorEditableSlot,
  type DirectorSummaryChip,
  type DualIdentityCandidateEngine,
  type IdentityCandidateChoiceId,
  type IdentityCandidatePreview,
  type PhotoInspectionVerdict,
  type TemplateBaselineSpec
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
  dualCandidateHeading: string;
  dualCandidateSeedreamTitle: string;
  dualCandidateSeedreamDesc: string;
  dualCandidateNanoBananaTitle: string;
  dualCandidateNanoBananaDesc: string;
  dualCandidatePickButton: string;
  dualCandidateSelectedBadge: string;
  dualCandidateRecommendedBadge?: string;
  dualCandidateCompareOriginal?: string;
  dualCandidateCompareHide?: string;
  dualCandidateOriginalLabel?: string;
  dualCandidateGenerating?: string;
  baselineLockedLabel: string;
  baselineCustomizeButton: string;
  predictivePresetsLabel: string;
  fileInvalidError: string;
  quickPresets: ReadonlyArray<{
    slot: DirectorEditableSlot;
    label: string;
    samplePrompt: string;
  }>;
}

export const DEFAULT_TEMPLATE_DIRECTOR_COPY_KO: TemplateDirectorCopy = {
  toggleOpen: '+ 의상 · 메이크업 · 장면 조금 바꾸기',
  toggleClose: '장면 바꾸기 접기',
  subtitle:
    '템플릿에 고정된 기본 스타일을 확인하고, 내 취향에 맞지 않는 의상·메이크업·헤어·표정을 사진이나 한 줄 요청으로 자연스럽게 바꿔보세요.',
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
  dualCandidateHeading:
    '사진에 가림·보정이 있어 영상에서 얼굴이 달라 보일 수 있어요. 두 가지 엔진 버전 중 내 실물과 더 닮은 쪽을 골라주세요.',
  dualCandidateSeedreamTitle: '후보 A · 부드러운 자연 인상 (Seedream 5.0 Pro)',
  dualCandidateSeedreamDesc: '이목구비 조화와 맑고 자연스러운 피부 톤을 부드럽게 살립니다',
  dualCandidateNanoBananaTitle: '후보 B · 선명한 윤곽 · 가림 정돈 (Nano Banana 2.1)',
  dualCandidateNanoBananaDesc: '손·소품 제거와 또렷한 눈코입·턱선 정리에 강합니다',
  dualCandidatePickButton: '이 버전이 더 닮았어요',
  dualCandidateSelectedBadge: '선택됨',
  dualCandidateRecommendedBadge: '가장 닮은 추천',
  dualCandidateCompareOriginal: '원본 셀카 대조하기',
  dualCandidateCompareHide: '원본 대조 닫기',
  dualCandidateOriginalLabel: '내 원본 셀카',
  dualCandidateGenerating: '두 가지 맞춤형 얼굴 후보를 생성하고 있어요…',
  baselineLockedLabel: '템플릿 고정 (변경 불가)',
  baselineCustomizeButton: '이 항목 바꾸기',
  predictivePresetsLabel: '가장 많이 요청하는 맞춤 변경 (원클릭 적용)',
  fileInvalidError: 'JPG, PNG, WEBP 사진(5MB 이하)만 첨부할 수 있습니다.',
  quickPresets: [
    {
      slot: 'outfit',
      label: '의상 바꾸기',
      samplePrompt: '첨부한 의상 사진 스타일로 자연스럽게 갈아입혀 줘'
    },
    {
      slot: 'makeup',
      label: '내 평소 메이크업 유지',
      samplePrompt: '템플릿의 진한 화장 대신 내 사진 속 평소 데일리 메이크업과 맑은 피부 톤을 그대로 유지해 줘'
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
  toggleOpen: '+ Customize outfit, makeup, or scene',
  toggleClose: 'Hide customization',
  subtitle:
    'Review the template defaults below and override any outfit, makeup, hair, or expression via reference photo or text.',
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
  dualCandidateHeading:
    'To prevent facial drift from occlusion or retouching, compare both engine masters and pick the one that looks most like you.',
  dualCandidateSeedreamTitle: 'Candidate A · Soft Natural Likeness (Seedream 5.0 Pro)',
  dualCandidateSeedreamDesc: 'Preserves soft facial harmony and natural warm skin tone',
  dualCandidateNanoBananaTitle: 'Candidate B · Crisp Contour & Cleanup (Nano Banana 2.1)',
  dualCandidateNanoBananaDesc: 'Excels at removing hands/props and sharpening feature lines',
  dualCandidatePickButton: 'Looks most like me',
  dualCandidateSelectedBadge: 'Selected',
  dualCandidateRecommendedBadge: 'Best match',
  dualCandidateCompareOriginal: 'Compare original selfie',
  dualCandidateCompareHide: 'Hide original selfie',
  dualCandidateOriginalLabel: 'Original selfie',
  dualCandidateGenerating: 'Generating both facial likeness candidates…',
  baselineLockedLabel: 'Locked by template',
  baselineCustomizeButton: 'Customize',
  predictivePresetsLabel: 'Most requested customizations (1-tap)',
  fileInvalidError: 'Please attach a JPG, PNG, or WEBP image under 5 MB.',
  quickPresets: [
    {
      slot: 'outfit',
      label: 'Swap outfit',
      samplePrompt: 'Dress me in the attached outfit reference while keeping the scene lighting'
    },
    {
      slot: 'makeup',
      label: 'Keep my daily makeup',
      samplePrompt: 'Keep my natural daily makeup and clean complexion from my photo instead of heavy template makeup'
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
 * Formats an attached reference image's byte size and MIME subtype as a crisp mono spec string
 * (e.g. `184 KB · PNG`, `1.4 MB · JPG`) for `tabular-nums` display inside tactile wells.
 */
export function formatReferenceFileSpec(file: { size: number; type: string }): string {
  const subtype =
    file.type === 'image/png' ? 'PNG' : file.type === 'image/webp' ? 'WEBP' : 'JPG';
  if (file.size >= 1024 * 1024) {
    return `${(file.size / (1024 * 1024)).toFixed(1)} MB · ${subtype}`;
  }
  const kb = Math.max(1, Math.round(file.size / 1024));
  return `${kb} KB · ${subtype}`;
}

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
  /** Optional template ID or archetype ('90s-apgujeong-interview', 'red-carpet-arrival', 'default-editorial') to auto-resolve baseline defaults. */
  templateId?: string | null;
  /** Explicit template baseline specification overriding `templateId` resolution. */
  templateBaseline?: TemplateBaselineSpec;
  photoInspection?: PhotoInspectionVerdict | null;
  /** Optional generated candidate previews for Seedream 5.0 Pro & Nano Banana 2.1 when dual-candidate selection is active. */
  identityCandidates?: readonly IdentityCandidatePreview[];
  /** Optional original uploaded selfie URL so the user can compare Candidate A/B directly against their original photo. */
  originalPhotoUrl?: string | null;
  /** True while the dual candidates are being generated in the background; renders a 3:4 frosted skeleton. */
  candidatesLoading?: boolean;
  initialSelectedCandidate?: IdentityCandidateChoiceId | null;
  initialExpanded?: boolean;
  initialChips?: DirectorSummaryChip[];
  initialAssistantMessage?: string | null;
  disabled?: boolean;
  onCleanupChoice?: (choice: 'accept' | 'skip' | 'pending') => void;
  onSelectIdentityCandidate?: (choice: IdentityCandidateChoiceId) => void;
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
  templateId = null,
  templateBaseline,
  photoInspection = null,
  identityCandidates = [],
  originalPhotoUrl = null,
  candidatesLoading = false,
  initialSelectedCandidate = null,
  initialExpanded = false,
  initialChips = [],
  initialAssistantMessage = null,
  disabled = false,
  onCleanupChoice,
  onSelectIdentityCandidate,
  onSubmitTurn,
  onChipsChange
}: TemplateDirectorPanelProps) {
  const baseId = useId();
  const drawerId = `${baseId}-drawer`;
  const inputId = `${baseId}-input`;
  const statusId = `${baseId}-status`;

  const resolvedBaseline: TemplateBaselineSpec =
    templateBaseline ??
    (templateId ? resolveTemplateBaseline(templateId) : DEFAULT_EDITORIAL_TEMPLATE_BASELINE);

  const [expanded, setExpanded] = useState(initialExpanded || initialChips.length > 0);
  const [cleanupChoice, setCleanupChoice] = useState<'pending' | 'accepted' | 'skipped'>('pending');
  const [selectedCandidate, setSelectedCandidate] = useState<IdentityCandidateChoiceId | null>(
    initialSelectedCandidate
  );
  const [compareOriginalOpen, setCompareOriginalOpen] = useState(false);
  const candidateButtonRefs = useRef<Record<DualIdentityCandidateEngine, HTMLButtonElement | null>>({
    'seedream-5.0-pro': null,
    'nano-banana-2.1': null
  });
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
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

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

  const revertSlotToDefault = (slot: DirectorEditableSlot) => {
    if (slot === 'outfit') {
      clearReferenceSlot('outfit');
    } else if (slot === 'prop') {
      clearReferenceSlot('prop');
    }
    startTransition(() => {
      const next = chips.filter((chip) => chip.slot !== slot);
      setChips(next);
      onChipsChange?.(next);
    });
  };

  const handleClipboardPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    if (disabled || submitting) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && item.kind === 'file' && ALLOWED_REFERENCE_MIMES.has(item.type)) {
        const pastedFile = item.getAsFile();
        if (pastedFile) {
          event.preventDefault();
          const targetSlot: 'outfit' | 'prop' = outfitSlot === null ? 'outfit' : 'prop';
          const targetRole: 'look' | 'product' = targetSlot === 'outfit' ? 'look' : 'product';
          assignReferenceSlot(targetSlot, targetRole, pastedFile);
          setPasteNotice(
            locale === 'en'
              ? `Pasted image into ${targetSlot === 'outfit' ? '@Image 2 (Outfit)' : '@Image 3 (Prop)'}`
              : `클립보드 사진을 ${targetSlot === 'outfit' ? '@Image 2 (의상 레퍼런스)' : '@Image 3 (소품 레퍼런스)'}에 첨부했어요`
          );
          return;
        }
      }
    }
  };

  const resetAll = () => {
    requestEpochRef.current += 1;
    setSubmitting(false);
    clearReferenceSlot('outfit');
    clearReferenceSlot('prop');
    setUserMessage('');
    setFileError(null);
    setPasteNotice(null);
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
  const showDualCandidates =
    cleanupMode === 'inpaint_occlusion' ||
    cleanupMode === 'normalize_retouch' ||
    Boolean(photoInspection?.recommendedCleanup.requiresDualCandidateSelection);

  const cleanupAcceptLabel =
    cleanupMode === 'inpaint_occlusion'
      ? copy.cleanupAcceptOcclusion
      : cleanupMode === 'normalize_retouch'
        ? copy.cleanupAcceptRetouch
        : copy.cleanupAcceptDetail;

  const seedreamScore =
    identityCandidates.find((c) => c.engine === 'seedream-5.0-pro')?.similarityScore ?? null;
  const nanoBananaScore =
    identityCandidates.find((c) => c.engine === 'nano-banana-2.1')?.similarityScore ?? null;
  const recommendedEngine: DualIdentityCandidateEngine | null =
    seedreamScore !== null && nanoBananaScore !== null
      ? seedreamScore >= nanoBananaScore
        ? 'seedream-5.0-pro'
        : 'nano-banana-2.1'
      : null;

  const candidateCards: ReadonlyArray<{
    engine: DualIdentityCandidateEngine;
    title: string;
    desc: string;
    previewUrl: string | null;
    similarityScore: number | null;
    isRecommended: boolean;
  }> = [
    {
      engine: 'seedream-5.0-pro',
      title: copy.dualCandidateSeedreamTitle,
      desc: copy.dualCandidateSeedreamDesc,
      previewUrl:
        identityCandidates.find((c) => c.engine === 'seedream-5.0-pro')?.previewUrl ?? null,
      similarityScore: seedreamScore,
      isRecommended: recommendedEngine === 'seedream-5.0-pro'
    },
    {
      engine: 'nano-banana-2.1',
      title: copy.dualCandidateNanoBananaTitle,
      desc: copy.dualCandidateNanoBananaDesc,
      previewUrl:
        identityCandidates.find((c) => c.engine === 'nano-banana-2.1')?.previewUrl ?? null,
      similarityScore: nanoBananaScore,
      isRecommended: recommendedEngine === 'nano-banana-2.1'
    }
  ];

  const handleCandidateArrowKey = (
    currentEngine: DualIdentityCandidateEngine,
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp'
    ) {
      return;
    }
    event.preventDefault();
    const nextEngine: DualIdentityCandidateEngine =
      currentEngine === 'seedream-5.0-pro' ? 'nano-banana-2.1' : 'seedream-5.0-pro';
    setSelectedCandidate(nextEngine);
    setCleanupChoice('accepted');
    onSelectIdentityCandidate?.(nextEngine);
    onCleanupChoice?.('accept');
    candidateButtonRefs.current[nextEngine]?.focus();
  };

  return (
    <div
      data-template-director-panel
      data-director-expanded={expanded ? 'true' : 'false'}
      data-template-archetype={resolvedBaseline.templateArchetypeId}
      className="mt-4 flex flex-col gap-3 text-[#0E1013]"
    >
      {/* Step 0: Uploaded Photo Inspection & Dual-Candidate Selection Banner (Sky Tint + Double-Ring Specular Border) */}
      {showInspectionCard && photoInspection && (
        <aside
          data-photo-inspection-banner={photoInspection.status}
          data-photo-cleanup-mode={photoInspection.recommendedCleanup.mode}
          data-photo-cleanup-choice={cleanupChoice}
          data-photo-selected-candidate={selectedCandidate ?? 'none'}
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
                  setSelectedCandidate(null);
                  onCleanupChoice?.('pending');
                }}
                className={`inline-flex min-h-9 items-center rounded-full px-2.5 text-xs font-medium text-[#3063A7] underline underline-offset-4 hover:text-[#0E1013] ${FOCUS_RING}`}
              >
                {copy.cleanupChangeButton}
              </button>
            )}
          </div>

          <p className="mt-2.5 text-[0.9rem] leading-[1.58] text-[#0E1013]">{inspectionMessage}</p>

          {/* Dual-Candidate Likeness Picker (Seedream 5.0 Pro vs Nano Banana 2.1) */}
          {photoInspection.status === 'needs_cleanup' && showDualCandidates && (
            <div
              data-photo-dual-candidates
              role="radiogroup"
              aria-label={copy.dualCandidateHeading}
              className="mt-3 rounded-[18px] border border-[#E4E6EA] bg-white p-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-[#41444D]">{copy.dualCandidateHeading}</p>
                {originalPhotoUrl && (
                  <button
                    type="button"
                    data-candidate-compare-toggle
                    aria-pressed={compareOriginalOpen}
                    disabled={disabled}
                    onClick={() => setCompareOriginalOpen((prev) => !prev)}
                    className={`inline-flex min-h-8 items-center rounded-full border border-[#E4E6EA] bg-[#F3F7FA] px-2.5 py-1 text-[0.7rem] font-medium text-[#3063A7] transition-colors hover:border-[#3875C5] hover:bg-[#E8EFF7] ${FOCUS_RING}`}
                  >
                    {compareOriginalOpen
                      ? (copy.dualCandidateCompareHide ?? '원본 대조 닫기')
                      : (copy.dualCandidateCompareOriginal ?? '원본 셀카 대조하기')}
                  </button>
                )}
              </div>

              {originalPhotoUrl && compareOriginalOpen && (
                <div
                  data-candidate-original-preview
                  className="mt-2.5 flex items-center gap-3 rounded-[14px] border border-[#E4E6EA] bg-[#F6F7F9] p-2.5"
                >
                  <div className="aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-xl border border-[#C7CCD3] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- original selfie preview */}
                    <img
                      src={originalPhotoUrl}
                      alt={copy.dualCandidateOriginalLabel ?? '내 원본 셀카'}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="inline-block rounded-full bg-white px-2 py-0.5 font-mono text-[0.65rem] font-semibold text-[#41444D] uppercase">
                      ORIGINAL
                    </span>
                    <p className="mt-1 text-xs font-semibold text-[#0E1013]">
                      {copy.dualCandidateOriginalLabel ?? '내 원본 셀카'}
                    </p>
                    <p className="mt-0.5 text-[0.72rem] leading-[1.45] text-[#676B75]">
                      {locale === 'en'
                        ? 'Compare eye shape, nose contour, and natural expression with Candidates A and B below.'
                        : '눈매·코 라인·자연스러운 인상이 아래 후보 A·B 중 어느 쪽과 더 가까운지 비교해 보세요.'}
                    </p>
                  </div>
                </div>
              )}

              {candidatesLoading && (
                <p
                  data-candidates-loading-status
                  role="status"
                  aria-live="polite"
                  className="mt-2 font-mono text-[0.7rem] font-medium text-[#3063A7]"
                >
                  {copy.dualCandidateGenerating ?? '두 가지 맞춤형 얼굴 후보를 생성하고 있어요…'}
                </p>
              )}

              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {candidateCards.map((card) => {
                  const isSelected = selectedCandidate === card.engine;
                  return (
                    <button
                      key={card.engine}
                      ref={(el) => {
                        candidateButtonRefs.current[card.engine] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-identity-candidate={card.engine}
                      data-candidate-selected={isSelected ? 'true' : 'false'}
                      data-candidate-recommended={card.isRecommended ? 'true' : 'false'}
                      disabled={disabled}
                      onKeyDown={(e) => handleCandidateArrowKey(card.engine, e)}
                      onClick={() => {
                        setSelectedCandidate(card.engine);
                        setCleanupChoice('accepted');
                        onSelectIdentityCandidate?.(card.engine);
                        onCleanupChoice?.('accept');
                      }}
                      className={[
                        'flex flex-col justify-between gap-2 rounded-[16px] border p-3 text-left transition-colors',
                        FOCUS_RING,
                        isSelected
                          ? 'border-[#3875C5] bg-[#E8EFF7]'
                          : 'border-[#E4E6EA] bg-[#F6F7F9] hover:border-[#C7CCD3] hover:bg-white'
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-semibold text-[#0E1013]">{card.title}</p>
                            {card.isRecommended && (
                              <span
                                data-candidate-recommended-badge
                                className="rounded-full bg-[#3875C5] px-2 py-0.5 font-mono text-[0.62rem] font-semibold text-white"
                              >
                                {copy.dualCandidateRecommendedBadge ?? '가장 닮은 추천'}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[0.75rem] leading-[1.45] text-[#41444D]">
                            {card.desc}
                          </p>
                        </div>
                        {card.similarityScore !== null && (
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-mono text-[0.65rem] font-semibold text-[#3063A7] tabular-nums">
                            {Math.round(card.similarityScore * 100)}%
                          </span>
                        )}
                      </div>

                      {card.previewUrl ? (
                        <div className="aspect-[3/4] w-full overflow-hidden rounded-xl border border-[#E4E6EA] bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element -- candidate preview */}
                          <img
                            src={card.previewUrl}
                            alt={card.title}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ) : candidatesLoading ? (
                        <div
                          data-candidate-skeleton={card.engine}
                          aria-hidden="true"
                          className="aspect-[3/4] w-full animate-pulse rounded-xl border border-[#E4E6EA] bg-[#E8EFF7]/65 motion-reduce:animate-none"
                        />
                      ) : null}

                      <span
                        className={[
                          'inline-flex min-h-8 w-full items-center justify-center rounded-full px-3 py-1 text-[0.72rem] font-semibold',
                          isSelected
                            ? 'bg-[#3875C5] text-white'
                            : 'border border-[#C7CCD3] bg-white text-[#3063A7]'
                        ].join(' ')}
                      >
                        {isSelected ? copy.dualCandidateSelectedBadge : copy.dualCandidatePickButton}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {photoInspection.status === 'needs_cleanup' && cleanupChoice === 'pending' && (
            <div className="mt-3.5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                data-photo-cleanup-accept
                disabled={disabled}
                onClick={() => {
                  const chosen = selectedCandidate ?? 'seedream-5.0-pro';
                  setSelectedCandidate(chosen);
                  setCleanupChoice('accepted');
                  if (showDualCandidates) {
                    onSelectIdentityCandidate?.(chosen);
                  }
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
                  setSelectedCandidate('original');
                  setCleanupChoice('skipped');
                  onSelectIdentityCandidate?.('original');
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
        onPaste={handleClipboardPaste}
        className="rounded-[24px] border border-[#E4E6EA] bg-white p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_4px_16px_rgba(14,16,19,0.04)] transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      >
        <p className="text-xs leading-[1.6] text-[#676B75]">{copy.subtitle}</p>

        {/* Template Baseline Disclosure Card: Shows what is fixed vs what defaults are baked into this template */}
        <section
          data-template-baseline-card={resolvedBaseline.templateArchetypeId}
          aria-label={locale === 'en' ? resolvedBaseline.titleEn : resolvedBaseline.titleKo}
          className="mt-3 rounded-[18px] border border-[#E4E6EA] bg-[#F6F7F9] p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              data-template-baseline-title
              className="text-xs font-semibold tracking-tight text-[#0E1013]"
            >
              {locale === 'en' ? resolvedBaseline.titleEn : resolvedBaseline.titleKo}
            </h3>
            <span className="rounded-full bg-[#E8EFF7] px-2.5 py-0.5 font-mono text-[0.65rem] font-medium text-[#3063A7]">
              BASELINE SPEC
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {resolvedBaseline.baselineSlots.map((slotSpec) => {
              const slotLabel = locale === 'en' ? slotSpec.labelEn : slotSpec.labelKo;
              const defaultSetting =
                locale === 'en' ? slotSpec.defaultSettingEn : slotSpec.defaultSettingKo;
              const hint =
                locale === 'en' ? slotSpec.customizableHintEn : slotSpec.customizableHintKo;
              const matchingPreset = resolvedBaseline.predictivePresets.find(
                (p) => p.slot === slotSpec.slot
              );
              const activeChipForSlot = chips.find((c) => c.slot === slotSpec.slot) ?? null;
              const attachedSlotFile =
                slotSpec.slot === 'outfit'
                  ? outfitSlot?.file ?? null
                  : slotSpec.slot === 'prop'
                    ? propSlot?.file ?? null
                    : null;
              const isSlotCustomized = activeChipForSlot !== null || attachedSlotFile !== null;
              const activeOverrideSummary =
                activeChipForSlot?.summaryKo ??
                (attachedSlotFile ? `@Image · ${attachedSlotFile.name}` : null);

              return (
                <div
                  key={slotSpec.slot}
                  data-baseline-slot={slotSpec.slot}
                  data-baseline-slot-state={isSlotCustomized ? 'customized' : 'default'}
                  className={[
                    'flex flex-col justify-between gap-1.5 rounded-[14px] border p-2.5 transition-colors',
                    isSlotCustomized
                      ? 'border-[#3875C5] bg-[#E8EFF7]/55'
                      : 'border-[#E4E6EA] bg-white'
                  ].join(' ')}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase">
                          {slotLabel}
                        </span>
                        {isSlotCustomized && (
                          <span
                            data-baseline-customized-badge={slotSpec.slot}
                            className="rounded-full bg-[#3875C5] px-2 py-0.5 font-mono text-[0.6rem] font-semibold text-white uppercase"
                          >
                            {locale === 'en' ? 'CUSTOMIZED' : '맞춤 적용됨'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {isSlotCustomized && (
                          <button
                            type="button"
                            data-baseline-revert={slotSpec.slot}
                            disabled={disabled || submitting}
                            onClick={() => revertSlotToDefault(slotSpec.slot)}
                            className={`rounded-full border border-[#C7CCD3] bg-white px-2 py-0.5 text-[0.66rem] font-medium text-[#41444D] hover:border-[#0E1013] hover:text-[#0E1013] ${FOCUS_RING}`}
                          >
                            {locale === 'en' ? 'Revert' : '기본값 복원'}
                          </button>
                        )}
                        <button
                          type="button"
                          data-baseline-customize={slotSpec.slot}
                          disabled={disabled || submitting}
                          onClick={() => {
                            if (slotSpec.acceptsReferenceImage === 'outfit') {
                              outfitInputRef.current?.click();
                            } else if (slotSpec.acceptsReferenceImage === 'prop') {
                              propInputRef.current?.click();
                            }
                            if (matchingPreset) {
                              setUserMessage(
                                locale === 'en'
                                  ? matchingPreset.samplePromptEn
                                  : matchingPreset.samplePromptKo
                              );
                            }
                            textInputRef.current?.focus();
                          }}
                          className={`rounded-full border border-[#E4E6EA] bg-[#F3F7FA] px-2.5 py-0.5 text-[0.68rem] font-medium text-[#3063A7] hover:border-[#3875C5] hover:bg-[#E8EFF7] ${FOCUS_RING}`}
                        >
                          {copy.baselineCustomizeButton}
                        </button>
                      </div>
                    </div>
                    <p
                      className={[
                        'mt-1 text-xs font-medium',
                        isSlotCustomized ? 'text-[#676B75] line-through' : 'text-[#0E1013]'
                      ].join(' ')}
                    >
                      {defaultSetting}
                    </p>
                    {isSlotCustomized && activeOverrideSummary && (
                      <p
                        data-baseline-active-override={slotSpec.slot}
                        className="mt-0.5 text-xs font-semibold text-[#3063A7]"
                      >
                        → {activeOverrideSummary}
                      </p>
                    )}
                    <p className="mt-0.5 text-[0.72rem] leading-[1.45] text-[#676B75]">{hint}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            data-template-locked-elements
            className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#E4E6EA] pt-2.5"
          >
            <span className="font-mono text-[0.66rem] font-semibold text-[#676B75] uppercase">
              {copy.baselineLockedLabel}:
            </span>
            {(locale === 'en'
              ? resolvedBaseline.lockedElementsEn
              : resolvedBaseline.lockedElementsKo
            ).map((lockedItem) => (
              <span
                key={lockedItem}
                className="inline-flex items-center rounded-full border border-[#E4E6EA] bg-white px-2.5 py-0.5 text-[0.7rem] text-[#676B75]"
              >
                {lockedItem}
              </span>
            ))}
          </div>
        </section>

        {/* Predictive 1-Tap Revision Presets (Grounded in Real Campaign Revision Data) */}
        <div data-director-predictive-presets className="mt-3.5">
          <p className="text-[0.72rem] font-semibold text-[#41444D]">
            {copy.predictivePresetsLabel}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {resolvedBaseline.predictivePresets.map((preset) => {
              const targetSample =
                locale === 'en' ? preset.samplePromptEn : preset.samplePromptKo;
              const isPresetActive =
                userMessage.trim() === targetSample.trim() ||
                chips.some((c) => c.slot === preset.slot);
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-predictive-preset={preset.id}
                  data-predictive-slot={preset.slot}
                  data-preset-active={isPresetActive ? 'true' : 'false'}
                  aria-pressed={isPresetActive}
                  disabled={disabled || submitting}
                  onClick={() => {
                    setUserMessage(targetSample);
                    if (preset.opensReferenceSlot === 'outfit') {
                      outfitInputRef.current?.click();
                    } else if (preset.opensReferenceSlot === 'prop') {
                      propInputRef.current?.click();
                    }
                    textInputRef.current?.focus();
                  }}
                  className={[
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40',
                    FOCUS_RING,
                    isPresetActive
                      ? 'border-[#3875C5] bg-[#E8EFF7] font-semibold text-[#3063A7]'
                      : 'border-[#E4E6EA] bg-[#F3F7F9] text-[#0E1013] hover:border-[#3875C5] hover:bg-[#E8EFF7] hover:text-[#3063A7]'
                  ].join(' ')}
                >
                  <span
                    className={[
                      'rounded-full px-1.5 py-0.5 font-mono text-[0.62rem] font-semibold',
                      isPresetActive ? 'bg-[#3875C5] text-white' : 'bg-[#E8EFF7] text-[#3063A7]'
                    ].join(' ')}
                  >
                    {locale === 'en' ? preset.reasonBadgeEn : preset.reasonBadgeKo}
                  </span>
                  <span>{locale === 'en' ? preset.labelEn : preset.labelKo}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick 1-Tap Category Pills */}
        <div data-director-presets className="mt-2.5 flex flex-wrap gap-1.5">
          {copy.quickPresets.map((preset) => {
            const isQuickActive = userMessage.trim() === preset.samplePrompt.trim();
            return (
              <button
                key={preset.slot}
                type="button"
                data-director-preset={preset.slot}
                aria-pressed={isQuickActive}
                disabled={disabled || submitting}
                onClick={() => {
                  setUserMessage(preset.samplePrompt);
                  textInputRef.current?.focus();
                }}
                className={[
                  'inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40',
                  FOCUS_RING,
                  isQuickActive
                    ? 'border-[#3875C5] bg-[#E8EFF7] font-semibold text-[#3063A7]'
                    : 'border-[#E4E6EA] bg-[#F6F7F9] text-[#41444D] hover:border-[#3875C5] hover:bg-[#E8EFF7] hover:text-[#3063A7]'
                ].join(' ')}
              >
                {preset.label}
              </button>
            );
          })}
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
                : outfitSlot
                  ? 'border-[#3875C5] bg-[#F3F7FA]'
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
                      {copy.outfitSlotHint} ·{' '}
                      <span data-slot-file-spec="outfit">
                        {formatReferenceFileSpec(outfitSlot.file)}
                      </span>
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
                : propSlot
                  ? 'border-[#3875C5] bg-[#F3F7FA]'
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
                      {copy.propSlotHint} ·{' '}
                      <span data-slot-file-spec="prop">
                        {formatReferenceFileSpec(propSlot.file)}
                      </span>
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

        {(outfitSlot !== null || propSlot !== null) && !userMessage.trim() && (
          <p
            data-director-reference-ready
            className="mt-2 rounded-xl bg-[#E8EFF7] px-3 py-1.5 text-[0.72rem] font-medium text-[#3063A7]"
          >
            {locale === 'en'
              ? 'Reference photo attached — you can press Apply directly even without typing a note.'
              : '레퍼런스 사진이 준비되었어요 · 한 줄 설명 없이 바로 [장면에 반영]을 눌러도 적용됩니다.'}
          </p>
        )}

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
          {pasteNotice && (
            <p data-director-paste-notice className="text-xs font-medium text-[#3063A7]">
              {pasteNotice}
            </p>
          )}
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
