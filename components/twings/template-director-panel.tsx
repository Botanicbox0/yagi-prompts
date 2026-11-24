'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import {
  EditSheetCard,
  TemplateLockGlyph,
  buildSheetDirectorSpec,
  lockedPartsOf,
  pendingFoldNotice,
  readSheetTurnAnswer,
  sheetNoticeText,
  pendingLineNotice,
  visibleSheetQuestion,
  type EditSheetCopy,
  type SheetNotice
} from './edit-sheet-card';
import {
  REF_OF_SLOT,
  lockChips,
  locksFromPublic,
  type PublicTemplateLocks
} from '@/lib/template-director/locks';
import {
  chipsFromSheet,
  dropRef,
  emptyPersonalSheetState,
  hasSheetContent,
  removeLine,
  removeSlot,
  revertChange
} from '@/lib/template-director/sheet';
import type { PersonalEditSheet, PersonalSheetState } from '@/lib/template-director/schema';
import {
  DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
  diagnosePhotoSuitability,
  resolveTemplateBaseline,
  type DirectorEditableSlot,
  type DirectorSummaryChip,
  type DualIdentityCandidateEngine,
  type IdentityCandidateChoiceId,
  type IdentityCandidatePreview,
  type PhotoInspectionVerdict,
  type TemplateBaselineSpec
} from '@/lib/template-director/schema';
import {
  quoteSelectiveImageSet,
  quoteVideoResolutionTiers,
  type PersonalVideoResolution,
  type SelectiveImageSetQuote,
  type VideoResolutionMultiTierQuote,
  type VideoResolutionTierQuote
} from '@/lib/twings/template-price';
import {
  PERSONAL_NO_BGM_AUDIO_NOTICE_EN,
  PERSONAL_NO_BGM_AUDIO_NOTICE_KO
} from '@/lib/template-director/morphic-production-playbook';
import {
  PERSONAL_AUDIO_MODES,
  PERSONAL_BGM_MOODS,
  type PersonalAudioMode,
  type PersonalBgmMood,
  type PersonalDirectorSpec
} from '@/lib/template-director/schema';
import type { PublicRecipe } from '@/lib/recipes/public';

export interface DirectorVideoResolutionSpec {
  /** Video duration in seconds (4..15, defaults to 10s) */
  runtimeSeconds?: number;
  /** Video aspect ratio ('9:16' | '16:9' | '4:3' | '3:4' | '1:1' | '21:9', defaults to '9:16') */
  aspect?: string;
  /** Optional maker raise (`royalty_krw`, 0..5000) */
  royaltyKrw?: number;
}

export interface DirectorImageSetSpec {
  totalFrames: number;
  /** Per-frame provider USD (defaults to 0.043 for Seedream 5.5 2K w/ 1 ref if omitted) */
  perFrameProviderUsd?: number;
  /** Optional maker raise on the full set (`royalty_krw`, 0..5000) */
  royaltyKrw?: number;
  /** Optional thumbnail URLs for each frame */
  frameThumbnails?: readonly string[];
}

export interface DirectorReferenceSlotValue {
  slotName: 'outfit' | 'prop' | 'scene';
  role: 'look' | 'product' | 'scene';
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
  sceneSlotLabel?: string;
  sceneSlotHint?: string;
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
  outfitSlotHint: '의상 · 스타일 레퍼런스',
  propSlotLabel: '들려줄 소품 · 제품',
  propSlotHint: '소품 · 제품 레퍼런스',
  sceneSlotLabel: '배경 · 무드 사진',
  sceneSlotHint: '배경 · 공간 레퍼런스',
  removeSlotLabel: '참조 사진 빼기',
  inputLabel: '장면 디렉팅 요청',
  inputPlaceholder: '예: 2번째 컷에서 컵 대신 내 향수를 들고 정면을 보며 살짝 웃게 해줘',
  defaultReferencePrompt: '첨부한 레퍼런스 사진을 장면에 자연스럽게 반영해 줘',
  applyButton: '장면에 반영',
  applyingButton: '반영 중…',
  resetButton: '원본 설정으로 초기화',
  activeChipsLabel: '적용된 커스텀 설정',
  removeChipLabel: '설정 해제',
  cleanupAcceptOcclusion: 'TWINGS가 가려진 부분 정리해서 진행',
  cleanupAcceptRetouch: 'TWINGS가 자연스러운 카메라 비율·피부 결로 정돈해서 진행',
  cleanupAcceptDetail: 'TWINGS 광학 선명도 복원 적용 (무료)',
  cleanupAcceptedBadge: '사진 자동 정리 적용됨',
  cleanupSkipButton: '원본 사진 그대로 쓰기',
  cleanupSkippedBadge: '원본 사진 그대로 진행',
  cleanupChangeButton: '다시 선택',
  retakeRecommendedBadge: '정면 독사진 권장',
  dualCandidateHeading:
    '사진에 가림·보정이 있어 영상에서 얼굴이 달라 보일 수 있어요. 두 가지 버전 중 내 실물과 더 닮은 쪽을 골라주세요.',
  dualCandidateSeedreamTitle: '후보 A · 부드러운 자연 인상',
  dualCandidateSeedreamDesc: '이목구비 조화와 맑고 자연스러운 피부 톤을 부드럽게 살립니다',
  dualCandidateNanoBananaTitle: '후보 B · 선명한 윤곽 · 가림 정돈',
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
  outfitSlotHint: 'Outfit & styling reference',
  propSlotLabel: 'Prop or product',
  propSlotHint: 'Prop & product reference',
  sceneSlotLabel: 'Scene & backdrop photo',
  sceneSlotHint: 'Backdrop & mood reference',
  removeSlotLabel: 'Remove reference',
  inputLabel: 'One-line scene direction',
  inputPlaceholder: 'e.g. In shot 2, hold my perfume bottle instead of the cup and smile softly at the lens',
  defaultReferencePrompt: 'Apply the attached reference image naturally to the scene',
  applyButton: 'Apply to scene',
  applyingButton: 'Applying…',
  resetButton: 'Reset to original',
  activeChipsLabel: 'Applied customizations',
  removeChipLabel: 'Remove customization',
  cleanupAcceptOcclusion: 'Clean up occlusion with TWINGS',
  cleanupAcceptRetouch: 'Normalize beauty-filter proportions with TWINGS',
  cleanupAcceptDetail: 'Restore optical sharpness with TWINGS (Free)',
  cleanupAcceptedBadge: 'Auto photo cleanup active',
  cleanupSkipButton: 'Use original photo as-is',
  cleanupSkippedBadge: 'Using original photo as-is',
  cleanupChangeButton: 'Change choice',
  retakeRecommendedBadge: 'Front solo photo recommended',
  dualCandidateHeading:
    'To prevent facial drift from occlusion or retouching, compare both versions and pick the one that looks most like you.',
  dualCandidateSeedreamTitle: 'Candidate A · Soft Natural Likeness',
  dualCandidateSeedreamDesc: 'Preserves soft facial harmony and natural warm skin tone',
  dualCandidateNanoBananaTitle: 'Candidate B · Crisp Contour & Cleanup',
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
  /** Optional generated candidate previews for Seedream 5.5 & Nano Banana 2.1 when dual-candidate selection is active. */
  identityCandidates?: readonly IdentityCandidatePreview[];
  /** Optional original uploaded selfie URL so the user can compare Candidate A/B directly against their original photo. */
  originalPhotoUrl?: string | null;
  /** True while the dual candidates are being generated in the background; renders a 3:4 frosted skeleton. */
  candidatesLoading?: boolean;
  initialSelectedCandidate?: IdentityCandidateChoiceId | null;
  initialExpanded?: boolean;
  initialChips?: DirectorSummaryChip[];
  initialAssistantMessage?: string | null;
  /** Optional multi-shot image set specification (e.g., 5-shot series) so the user can pick 1..N frames with dynamic credit & KRW pricing. */
  imageSetSpec?: DirectorImageSetSpec | null;
  initialSelectedFrames?: readonly number[];
  onSelectedFramesChange?: (selectedFrameIndices: number[], quote: SelectiveImageSetQuote) => void;
  /** Optional video resolution tier specification (480p Draft, 720p Standard, 1080p Masterpiece). Rendered automatically on video templates. */
  videoResolutionSpec?: DirectorVideoResolutionSpec | null;
  initialResolution?: PersonalVideoResolution;
  onResolutionChange?: (
    resolution: PersonalVideoResolution,
    quote: VideoResolutionTierQuote
  ) => void;
  medium?: 'image' | 'video';
  pricingDisplayMode?: 'krw' | 'store_credits';
  disclosedRecipe?: PublicRecipe | null;
  onDraftChange?: (draft: {
    directorSpec: PersonalDirectorSpec | null;
    slotFiles: Partial<Record<'look_ref' | 'prop_ref' | 'scene_ref', File>>;
  }) => void;
  disabled?: boolean;
  onCleanupChoice?: (choice: 'accept' | 'skip' | 'pending') => void;
  onSelectIdentityCandidate?: (choice: IdentityCandidateChoiceId) => void;
  /** Triggered when the user clicks the primary "Upload another front photo directly (Recommended)" button. */
  onRequestReupload?: () => void;
  onSubmitTurn?: (input: {
    userMessage: string;
    references: ReadonlyArray<{
      slotName: 'outfit' | 'prop' | 'scene';
      role: 'look' | 'product' | 'scene';
      file: File;
    }>;
  }) => Promise<{
    accepted: boolean;
    assistantMessage: string;
    summaryChips: DirectorSummaryChip[];
  }>;
  onChipsChange?: (chips: DirectorSummaryChip[]) => void;
  /**
   * docs/PERSONAL-STUDIO.md §3.1 — the edit sheet's words. The page passes them only when
   * `TWINGS_PERSONAL_EDIT_SHEET` is on; present, the panel keeps an edit sheet, shows it as a card instead of the
   * chips row, sends it with every turn and hands it to the order. Absent, the panel is exactly the chips panel.
   */
  editSheet?: EditSheetCopy | null;
  /**
   * docs/PERSONAL-STUDIO.md §3.3 (C2) — the template's locked parts (the public projection only), handed in whenever
   * the template carries a `Template locks:` block, with the edit-sheet flag on or off. Present, the panel names the
   * real locked parts instead of the guessed ones, hides the pickers of closed photos, the presets that change a
   * closed part and (sound) the audio option, and the sheet card shows "can't be changed" from the start. Absent,
   * the panel is exactly as before.
   */
  locks?: PublicTemplateLocks | null;
  /** The words for the locked parts (the `editSheet` dictionary section); `editSheet` is used when absent. */
  lockCopy?: EditSheetCopy | null;
}

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#09090B]';

type ReferencePicker = 'outfit' | 'prop' | 'scene';
const REF_OF_PICKER: Readonly<Record<ReferencePicker, 'look_ref' | 'prop_ref' | 'scene_ref'>> = {
  outfit: 'look_ref',
  prop: 'prop_ref',
  scene: 'scene_ref'
};
/** With locks the picker grid has as many columns as open pickers (literal classes for Tailwind). */
const PICKER_GRID_COLS: Readonly<Record<number, string>> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3'
};

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
  imageSetSpec = null,
  initialSelectedFrames,
  onSelectedFramesChange,
  videoResolutionSpec = null,
  initialResolution = '720p',
  onResolutionChange,
  medium,
  pricingDisplayMode = 'krw',
  disclosedRecipe = null,
  onDraftChange,
  disabled = false,
  onCleanupChoice,
  onSelectIdentityCandidate,
  onRequestReupload,
  onSubmitTurn,
  onChipsChange,
  editSheet = null,
  locks = null,
  lockCopy = null
}: TemplateDirectorPanelProps) {
  const baseId = useId();
  const drawerId = `${baseId}-drawer`;
  const inputId = `${baseId}-input`;
  const statusId = `${baseId}-status`;

  const resolvedBaseline: TemplateBaselineSpec =
    templateBaseline ??
    (templateId ? resolveTemplateBaseline(templateId) : DEFAULT_EDITORIAL_TEMPLATE_BASELINE);

  // docs/PERSONAL-STUDIO.md §3.3 (C2) — the template's real locks. Null = no lock block: everything below that reads
  // these is skipped and the panel is exactly as before. The server enforces the same locks on every turn and order.
  const lockWords = lockCopy ?? editSheet;
  const activeLocks = locks && lockWords ? locks : null;
  const lockState = locksFromPublic(activeLocks);
  const slotOpen = (slot: DirectorEditableSlot): boolean => !lockState.slots.includes(slot);
  const pickerOpen = (picker: ReferencePicker): boolean => !lockState.refs.includes(REF_OF_PICKER[picker]);
  const soundLocked = lockState.named.includes('sound');
  const openPickers = (['outfit', 'prop', 'scene'] as const).filter(pickerOpen);
  const visibleBaselineSlots = resolvedBaseline.baselineSlots.filter((slotSpec) => slotOpen(slotSpec.slot));
  // A preset is not offered when its part is closed or it works from a closed photo. The quick pills carry no photo
  // field; the outfit and prop pills ask for an attached photo, so they follow that photo.
  const visiblePredictivePresets = resolvedBaseline.predictivePresets.filter(
    (preset) => slotOpen(preset.slot) && (!preset.opensReferenceSlot || pickerOpen(preset.opensReferenceSlot))
  );
  const visibleQuickPresets = copy.quickPresets.filter((preset) => {
    const ref = REF_OF_SLOT[preset.slot];
    return slotOpen(preset.slot) && (!ref || !lockState.refs.includes(ref));
  });
  // The request box's example never suggests a fixed part: with locks it is an expression change, and none at all
  // when the direction itself is fixed. Without locks it is the example it always was.
  const requestPlaceholder =
    activeLocks && lockWords ? (slotOpen('shot_action') ? lockWords.lockedPlaceholder : '') : copy.inputPlaceholder;

  const totalSetFrames =
    imageSetSpec && imageSetSpec.totalFrames > 1
      ? Math.min(10, Math.floor(imageSetSpec.totalFrames))
      : 0;

  const [selectedFrames, setSelectedFrames] = useState<number[]>(() => {
    if (totalSetFrames <= 1) return [0];
    if (initialSelectedFrames && initialSelectedFrames.length > 0) {
      const valid = Array.from(
        new Set(
          initialSelectedFrames
            .map((i) => Math.floor(i))
            .filter((i) => i >= 0 && i < totalSetFrames)
        )
      ).sort((a, b) => a - b);
      if (valid.length > 0) return valid;
    }
    return Array.from({ length: totalSetFrames }, (_, idx) => idx);
  });

  const selectiveQuote: SelectiveImageSetQuote | null =
    totalSetFrames > 1 && imageSetSpec
      ? quoteSelectiveImageSet({
          perFrameProviderUsd: imageSetSpec.perFrameProviderUsd ?? 0.09,
          totalFrames: totalSetFrames,
          selectedFrameIndices: selectedFrames,
          royaltyKrw: imageSetSpec.royaltyKrw ?? 0
        })
      : null;

  const updateSelectedFrames = (nextIndices: number[]) => {
    if (totalSetFrames <= 1 || !imageSetSpec) return;
    const valid = Array.from(
      new Set(nextIndices.filter((i) => i >= 0 && i < totalSetFrames))
    ).sort((a, b) => a - b);
    if (valid.length === 0) return;
    setSelectedFrames(valid);
    const nextQuote = quoteSelectiveImageSet({
      perFrameProviderUsd: imageSetSpec.perFrameProviderUsd ?? 0.09,
      totalFrames: totalSetFrames,
      selectedFrameIndices: valid,
      royaltyKrw: imageSetSpec.royaltyKrw ?? 0
    });
    onSelectedFramesChange?.(valid, nextQuote);
  };

  const [selectedResolution, setSelectedResolution] = useState<PersonalVideoResolution>(
    initialResolution
  );

  const isVideoContext = medium === 'video' || Boolean(videoResolutionSpec);

  const videoResolutionMultiQuote: VideoResolutionMultiTierQuote | null =
    totalSetFrames === 0 && Boolean(videoResolutionSpec)
      ? quoteVideoResolutionTiers({
          seconds: videoResolutionSpec?.runtimeSeconds ?? 10,
          aspect: videoResolutionSpec?.aspect ?? '9:16',
          royaltyKrw: videoResolutionSpec?.royaltyKrw ?? 0
        })
      : null;

  const activeResolutionQuote: VideoResolutionTierQuote | null =
    videoResolutionMultiQuote !== null
      ? videoResolutionMultiQuote.tiers[selectedResolution]
      : null;

  const handleSelectResolution = (nextRes: PersonalVideoResolution) => {
    setSelectedResolution(nextRes);
    if (videoResolutionMultiQuote) {
      onResolutionChange?.(nextRes, videoResolutionMultiQuote.tiers[nextRes]);
    }
  };

  const [expanded, setExpanded] = useState(initialExpanded || initialChips.length > 0);
  const [cleanupChoice, setCleanupChoice] = useState<'pending' | 'accepted' | 'skipped'>('pending');
  const [selectedCandidate, setSelectedCandidate] = useState<IdentityCandidateChoiceId | null>(
    initialSelectedCandidate
  );
  const [compareOriginalOpen, setCompareOriginalOpen] = useState(false);
  const candidateButtonRefs = useRef<Record<DualIdentityCandidateEngine, HTMLButtonElement | null>>({
    'seedream-5.5': null,
    'nano-banana-2.1': null
  });
  const [userMessage, setUserMessage] = useState('');
  const [chipsState, setChips] = useState<DirectorSummaryChip[]>(initialChips);
  // docs/PERSONAL-STUDIO.md §3.1 — sheet mode (`editSheet` present): the sheet is the state and the chips are
  // derived from it; without `editSheet` these stay empty and `chips` is the chips state exactly as before.
  const [sheetState, setSheetState] = useState<PersonalSheetState>(emptyPersonalSheetState);
  const [sheetNotice, setSheetNotice] = useState<SheetNotice | null>(null);
  const sheetChips = useMemo(() => chipsFromSheet(sheetState.sheet), [sheetState.sheet]);
  const chips = editSheet ? sheetChips : chipsState;
  const sheetQuestion = visibleSheetQuestion(sheetState.question, locale);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(initialAssistantMessage);
  const [turnAccepted, setTurnAccepted] = useState<boolean>(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draggingSlot, setDraggingSlot] = useState<'outfit' | 'prop' | 'scene' | null>(null);
  const [, startTransition] = useTransition();

  const [audioMode, setAudioMode] = useState<PersonalAudioMode>('ambient');
  const [bgmMood, setBgmMood] = useState<PersonalBgmMood>('cinematic');
  const [outfitSlot, setOutfitSlot] = useState<DirectorReferenceSlotValue | null>(null);
  const [propSlot, setPropSlot] = useState<DirectorReferenceSlotValue | null>(null);
  const [sceneSlot, setSceneSlot] = useState<DirectorReferenceSlotValue | null>(null);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  const outfitInputRef = useRef<HTMLInputElement>(null);
  const propInputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const onChipsChangeRef = useRef(onChipsChange);
  onChipsChangeRef.current = onChipsChange;
  const activeUrlsRef = useRef<Set<string>>(new Set());
  const requestEpochRef = useRef(0);

  // Sheet mode: what the order carries — typed text not sent yet is folded in, so it is on the card and never
  // silently dropped (docs/PERSONAL-STUDIO.md §3.1 "화면 조각이 지켜야 할 것").
  const sheetDraft = useMemo(
    () =>
      editSheet
        ? buildSheetDirectorSpec({
            sheet: sheetState.sheet,
            pendingNote: userMessage,
            audioMode: isVideoContext ? audioMode : 'ambient',
            bgmMood,
            slotOverrides: [
              ...(outfitSlot ? (['look_ref'] as const) : []),
              ...(propSlot ? (['prop_ref'] as const) : []),
              ...(sceneSlot ? (['scene_ref'] as const) : [])
            ],
            locks: activeLocks
          })
        : null,
    [activeLocks, audioMode, bgmMood, editSheet, isVideoContext, outfitSlot, propSlot, sceneSlot, sheetState.sheet, userMessage]
  );

  // Sheet mode: tell a listener when the derived chips change (the first render is not a change).
  const lastSheetChipsRef = useRef(sheetChips);
  useEffect(() => {
    if (!editSheet || lastSheetChipsRef.current === sheetChips) return;
    lastSheetChipsRef.current = sheetChips;
    onChipsChangeRef.current?.(sheetChips);
  }, [editSheet, sheetChips]);

  // Sync draft spec and attached slot files to the parent studio form without re-trigger loops.
  useEffect(() => {
    const notify = onDraftChangeRef.current;
    if (!notify) return;
    const slotFiles: Partial<Record<'look_ref' | 'prop_ref' | 'scene_ref', File>> = {
      ...(outfitSlot ? { look_ref: outfitSlot.file } : {}),
      ...(propSlot ? { prop_ref: propSlot.file } : {}),
      ...(sceneSlot ? { scene_ref: sceneSlot.file } : {})
    };
    if (sheetDraft) {
      notify({ slotFiles, directorSpec: sheetDraft.spec });
      return;
    }
    const slotOverrides: Array<'look_ref' | 'prop_ref' | 'scene_ref'> = [];
    if (outfitSlot) slotOverrides.push('look_ref');
    if (propSlot) slotOverrides.push('prop_ref');
    if (sceneSlot) slotOverrides.push('scene_ref');
    const trimmedMessage = userMessage.trim();
    const hasBgm = isVideoContext && audioMode === 'bgm';
    const hasAny =
      chips.length > 0 || trimmedMessage.length > 0 || hasBgm || slotOverrides.length > 0;
    notify({
      slotFiles,
      directorSpec: hasAny
        ? {
            userMessage: trimmedMessage || null,
            summaryChips: chips,
            audioMode: isVideoContext ? audioMode : 'ambient',
            bgmMood: hasBgm ? bgmMood : null,
            structuredIntent: null,
            slotOverrides
          }
        : null
    });
  }, [audioMode, bgmMood, chips, isVideoContext, outfitSlot, propSlot, sceneSlot, sheetDraft, userMessage]);

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
    slotName: 'outfit' | 'prop' | 'scene',
    role: 'look' | 'product' | 'scene',
    file: File | null | undefined
  ) => {
    if (!file) return;
    // A photo for a reference the template closed is never taken (its picker is not shown).
    if (!pickerOpen(slotName)) return;
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
    } else if (slotName === 'prop') {
      if (propSlot?.previewUrl) {
        URL.revokeObjectURL(propSlot.previewUrl);
        activeUrlsRef.current.delete(propSlot.previewUrl);
      }
      setPropSlot({ slotName, role, file, previewUrl });
    } else {
      if (sceneSlot?.previewUrl) {
        URL.revokeObjectURL(sceneSlot.previewUrl);
        activeUrlsRef.current.delete(sceneSlot.previewUrl);
      }
      setSceneSlot({ slotName, role, file, previewUrl });
    }
  };

  const clearReferenceSlot = (slotName: 'outfit' | 'prop' | 'scene') => {
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
    if (slotName === 'scene' && sceneSlot) {
      URL.revokeObjectURL(sceneSlot.previewUrl);
      activeUrlsRef.current.delete(sceneSlot.previewUrl);
      setSceneSlot(null);
      if (sceneInputRef.current) sceneInputRef.current.value = '';
    }
    // Sheet mode: lines that took from the photo keep their words but no longer bind it.
    const removedPhoto = slotName === 'outfit' ? outfitSlot : slotName === 'prop' ? propSlot : sceneSlot;
    if (editSheet && removedPhoto) {
      const ref = slotName === 'outfit' ? 'look_ref' : slotName === 'prop' ? 'prop_ref' : 'scene_ref';
      setSheetState((s) => ({ ...s, sheet: dropRef(s.sheet, ref) }));
    }
  };

  /** Sheet mode: a local edit (remove, revert, slot back to default). No server call; the live line clears. */
  const editSheetLocally = (edit: (sheet: PersonalEditSheet) => PersonalEditSheet) => {
    setSheetState((s) => ({ ...s, sheet: edit(s.sheet) }));
    setSheetNotice(null);
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
    } else if (slot === 'lighting_mood') {
      clearReferenceSlot('scene');
    }
    if (editSheet) {
      editSheetLocally((sheet) => removeSlot(sheet, slot));
      return;
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
        // With template locks only an open picker takes a pasted photo; with none open the paste is left alone.
        if (pastedFile && openPickers.length > 0) {
          event.preventDefault();
          const filled: Record<ReferencePicker, boolean> = {
            outfit: outfitSlot !== null,
            prop: propSlot !== null,
            scene: sceneSlot !== null
          };
          const targetSlot: ReferencePicker =
            openPickers.find((picker) => !filled[picker]) ?? openPickers[openPickers.length - 1]!;
          const targetRole: 'look' | 'product' | 'scene' =
            targetSlot === 'outfit' ? 'look' : targetSlot === 'prop' ? 'product' : 'scene';
          assignReferenceSlot(targetSlot, targetRole, pastedFile);
          setPasteNotice(
            locale === 'en'
              ? `Pasted image into ${targetSlot === 'outfit' ? 'Outfit reference' : targetSlot === 'prop' ? 'Prop reference' : 'Backdrop reference'}`
              : `클립보드 사진을 ${targetSlot === 'outfit' ? '의상 레퍼런스' : targetSlot === 'prop' ? '소품 레퍼런스' : '배경 레퍼런스'}에 첨부했어요`
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
    clearReferenceSlot('scene');
    setAudioMode('ambient');
    setBgmMood('cinematic');
    setUserMessage('');
    setFileError(null);
    setPasteNotice(null);
    setAssistantMessage(null);
    setTurnAccepted(true);
    if (editSheet) {
      setSheetState(emptyPersonalSheetState());
      setSheetNotice(null);
      return;
    }
    startTransition(() => {
      setChips([]);
      onChipsChange?.([]);
    });
  };

  /**
   * Sheet mode (docs/PERSONAL-STUDIO.md §3.1): one turn posts today's fields plus the kept state as `sheet`, and
   * reads `turn.sheet`, `question`, `asked`, `changed` back. A refusal shows dictionary copy; a rate limit or any
   * failure leaves the sheet as it was. `fromInput` clears the typed text once the request is taken (a question's
   * option leaves it alone).
   */
  const submitSheetTurn = async (message: string, fromInput: boolean) => {
    const hasPhoto = outfitSlot !== null || propSlot !== null || sceneSlot !== null;
    if ((!message && !hasPhoto) || submitting || disabled) return;
    if (!templateId || typeof fetch !== 'function') {
      setSheetNotice({ key: 'retry' });
      return;
    }
    const myEpoch = ++requestEpochRef.current;
    const prior = sheetState;
    setSubmitting(true);
    setFileError(null);
    setSheetNotice(null);
    try {
      const form = new FormData();
      form.set('template', templateId);
      form.set('locale', locale);
      // Empty with only a photo attached: the server words the request itself, in the customer's locale.
      form.set('message', message);
      form.set('audioMode', isVideoContext ? audioMode : 'ambient');
      if (isVideoContext && audioMode === 'bgm') {
        form.set('bgmMood', bgmMood);
      }
      if (outfitSlot) form.set('slot_look_ref', outfitSlot.file);
      if (propSlot) form.set('slot_prop_ref', propSlot.file);
      if (sceneSlot) form.set('slot_scene_ref', sceneSlot.file);
      form.set('sheet', JSON.stringify(prior));

      const res = await fetch('/api/template-director', {
        method: 'POST',
        body: form,
        credentials: 'same-origin'
      });
      if (requestEpochRef.current !== myEpoch) return;
      const payload: unknown = await res.json().catch(() => null);
      if (requestEpochRef.current !== myEpoch) return;
      const outcome = readSheetTurnAnswer({
        prior,
        message,
        status: res.status,
        payload,
        // The studio writes its note on a softened request (and, for now, its question) in Korean.
        locale
      });
      setSheetState(outcome.state);
      setSheetNotice(outcome.notice);
      if (outcome.accepted && fromInput) setUserMessage('');
    } catch {
      if (requestEpochRef.current === myEpoch) setSheetNotice({ key: 'retry' });
    } finally {
      if (requestEpochRef.current === myEpoch) {
        setSubmitting(false);
      }
    }
  };

  const handleApplyTurn = async () => {
    const trimmed = userMessage.trim();
    const refs = [outfitSlot, propSlot, sceneSlot].filter(
      (item): item is DirectorReferenceSlotValue => item !== null
    );
    if ((!trimmed && refs.length === 0) || submitting || disabled) return;

    if (editSheet) {
      await submitSheetTurn(trimmed, true);
      return;
    }

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

      // Include attached scene reference chip if active so users see backdrop override reflected immediately.
      if (sceneSlot) {
        generatedChips.push({
          slot: 'lighting_mood',
          labelKo: locale === 'en' ? 'Backdrop ref' : '배경 레퍼런스',
          summaryKo: sceneSlot.file.name.slice(0, 28)
        });
      }

      if (templateId && typeof fetch === 'function') {
        const myEpoch = ++requestEpochRef.current;
        setSubmitting(true);
        setFileError(null);
        try {
          const form = new FormData();
          form.set('template', templateId);
          form.set('locale', locale);
          form.set('message', effectiveMessage);
          form.set('audioMode', isVideoContext ? audioMode : 'ambient');
          if (isVideoContext && audioMode === 'bgm') {
            form.set('bgmMood', bgmMood);
          }
          if (outfitSlot) form.set('slot_look_ref', outfitSlot.file);
          if (propSlot) form.set('slot_prop_ref', propSlot.file);
          if (sceneSlot) form.set('slot_scene_ref', sceneSlot.file);

          const res = await fetch('/api/template-director', {
            method: 'POST',
            body: form,
            credentials: 'same-origin'
          });
          if (requestEpochRef.current !== myEpoch) return;
          const payload = (await res.json().catch(() => null)) as {
            ok?: boolean;
            code?: string;
            turn?: {
              approved?: boolean;
              replyKo?: string;
              summaryChips?: DirectorSummaryChip[];
              lockedHit?: boolean;
            };
          } | null;
          // docs/PERSONAL-STUDIO.md §3.3 — a request that touched a fixed part answers in dictionary words (the reply
          // may still name the part it left out), and a refused one adds no chip of its own.
          if (activeLocks && lockWords && payload?.code === 'locked_slot_photo') {
            setTurnAccepted(false);
            setAssistantMessage(lockWords.refusedLocked);
            return;
          }
          if (activeLocks && lockWords && res.ok && payload?.ok && payload.turn?.lockedHit === true) {
            const approved = payload.turn.approved === true;
            setTurnAccepted(approved);
            setAssistantMessage(approved ? lockWords.updatedLocked : lockWords.refusedLocked);
            if (approved && Array.isArray(payload.turn.summaryChips)) {
              const next = upsertSummaryChips(chips, payload.turn.summaryChips);
              setChips(next);
              onChipsChange?.(next);
            }
            setUserMessage('');
            return;
          }
          if (res.ok && payload?.ok && payload.turn) {
            setTurnAccepted(Boolean(payload.turn.approved));
            if (payload.turn.replyKo) setAssistantMessage(payload.turn.replyKo);
            if (payload.turn.approved && Array.isArray(payload.turn.summaryChips)) {
              const next = upsertSummaryChips(chips, payload.turn.summaryChips);
              setChips(next);
              setUserMessage('');
              onChipsChange?.(next);
              return;
            }
          }
        } catch {
          // Offline or unauthenticated previewers fall back to local summary chips seamlessly.
        } finally {
          if (requestEpochRef.current === myEpoch) {
            setSubmitting(false);
          }
        }
      }

      const next = upsertSummaryChips(chips, activeLocks ? lockChips(generatedChips, lockState) : generatedChips);
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

  const suitability =
    photoInspection !== null
      ? diagnosePhotoSuitability(photoInspection.issues, photoInspection.faceWidthRatio)
      : null;

  const handleTriggerReupload = () => {
    onRequestReupload?.();
    if (typeof document !== 'undefined') {
      const uploaderBtn = document.querySelector<HTMLElement>(
        '[data-selfie-change], [data-selfie-another], [data-selfie-choose]'
      );
      uploaderBtn?.click();
      uploaderBtn?.focus();
    }
  };

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
    identityCandidates.find((c) => c.engine === 'seedream-5.5')?.similarityScore ?? null;
  const nanoBananaScore =
    identityCandidates.find((c) => c.engine === 'nano-banana-2.1')?.similarityScore ?? null;
  const recommendedEngine: DualIdentityCandidateEngine | null =
    seedreamScore !== null && nanoBananaScore !== null
      ? seedreamScore >= nanoBananaScore
        ? 'seedream-5.5'
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
      engine: 'seedream-5.5',
      title: copy.dualCandidateSeedreamTitle,
      desc: copy.dualCandidateSeedreamDesc,
      previewUrl:
        identityCandidates.find((c) => c.engine === 'seedream-5.5')?.previewUrl ?? null,
      similarityScore: seedreamScore,
      isRecommended: recommendedEngine === 'seedream-5.5'
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
      currentEngine === 'seedream-5.5' ? 'nano-banana-2.1' : 'seedream-5.5';
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
      className="mt-4 flex flex-col gap-3 text-[#09090B]"
    >
      {/* Step 0: Uploaded Photo Inspection & Dual-Candidate Selection Banner (Sky Tint + Double-Ring Specular Border) */}
      {showInspectionCard && photoInspection && (
        <aside
          data-photo-inspection-banner={photoInspection.status}
          data-photo-cleanup-mode={photoInspection.recommendedCleanup.mode}
          data-photo-cleanup-choice={cleanupChoice}
          data-photo-selected-candidate={selectedCandidate ?? 'none'}
          aria-label="사진 자동 검수 안내"
          className="rounded-[20px] border border-[#E4E4E7] bg-[#F4F4F5] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-mono text-[0.7rem] font-medium tracking-tight text-[#09090B] tabular-nums">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#FF58AE]" />
              {photoInspection.status === 'needs_retake'
                ? copy.retakeRecommendedBadge
                : cleanupChoice === 'accepted'
                  ? copy.cleanupAcceptedBadge
                  : cleanupChoice === 'skipped'
                    ? copy.cleanupSkippedBadge
                    : locale === 'en'
                      ? `Face ratio ${Math.round(photoInspection.faceWidthRatio * 100)}%`
                      : `얼굴 비율 ${Math.round(photoInspection.faceWidthRatio * 100)}%`}
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
                className={`inline-flex min-h-9 items-center rounded-full px-2.5 text-xs font-medium text-[#CC1573] underline underline-offset-4 hover:text-[#09090B] ${FOCUS_RING}`}
              >
                {copy.cleanupChangeButton}
              </button>
            )}
          </div>

          <p className="mt-2.5 text-[0.9rem] leading-[1.58] text-[#09090B]">{inspectionMessage}</p>

          {/* Direct Re-Upload Recommendation Box (No-AI-Face-Transform Default Policy) */}
          {suitability && suitability.recommendDirectReupload && (
            <div
              data-photo-reupload-recommendation={suitability.issueCategory}
              data-prefer-direct-upload="true"
              className="mt-3 rounded-[16px] border border-[#09090B]/20 bg-white p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#09090B] px-2.5 py-0.5 text-[0.68rem] font-semibold text-white">
                  {locale === 'en'
                    ? 'Recommended · Direct photo upload'
                    : '가장 나답게 나오는 방법 · 다른 정면 사진 직접 업로드 권장'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-[1.55] text-[#52525B]">
                {locale === 'en' ? suitability.whyUnsuitableEn : suitability.whyUnsuitableKo}
              </p>
              <p className="mt-1 text-xs font-medium leading-[1.55] text-[#09090B]">
                {locale === 'en' ? suitability.reuploadTipEn : suitability.reuploadTipKo}
              </p>
              <div className="mt-2.5">
                <button
                  type="button"
                  data-photo-reupload-cta
                  disabled={disabled}
                  onClick={handleTriggerReupload}
                  className={`inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#09090B] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 sm:w-auto ${FOCUS_RING}`}
                >
                  {locale === 'en'
                    ? 'Upload another front-facing photo directly (Recommended)'
                    : '다른 정면 사진 직접 다시 올리기 (추천 · AI 얼굴 변형 없음)'}
                </button>
              </div>
            </div>
          )}

          {/* Dual-Candidate Likeness Picker (Seedream 5.5 vs Nano Banana 2.1) */}
          {photoInspection.status === 'needs_cleanup' && showDualCandidates && (
            <div
              data-photo-dual-candidates
              role="radiogroup"
              aria-label={copy.dualCandidateHeading}
              className="mt-3 rounded-[18px] border border-[#E4E4E7] bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-[#52525B]">{copy.dualCandidateHeading}</p>
                {originalPhotoUrl && (
                  <button
                    type="button"
                    data-candidate-compare-toggle
                    aria-pressed={compareOriginalOpen}
                    disabled={disabled}
                    onClick={() => setCompareOriginalOpen((prev) => !prev)}
                    className={`inline-flex min-h-8 items-center rounded-full border border-[#E4E4E7] bg-[#F4F4F5] px-2.5 py-1 text-[0.7rem] font-medium text-[#09090B] transition-colors hover:border-[#09090B] ${FOCUS_RING}`}
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
                  className="mt-2.5 flex items-center gap-3 rounded-[14px] border border-[#E4E4E7] bg-[#F4F4F5] p-2.5"
                >
                  <div className="aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-xl border border-[#E4E4E7] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- original selfie preview */}
                    <img
                      src={originalPhotoUrl}
                      alt={copy.dualCandidateOriginalLabel ?? '내 원본 셀카'}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="inline-block rounded-full bg-white px-2 py-0.5 text-[0.65rem] font-semibold text-[#52525B]">
                      {locale === 'en' ? 'Original' : '원본'}
                    </span>
                    <p className="mt-1 text-xs font-semibold text-[#09090B]">
                      {copy.dualCandidateOriginalLabel ?? '내 원본 셀카'}
                    </p>
                    <p className="mt-0.5 text-[0.72rem] leading-[1.45] text-[#71717A]">
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
                  className="mt-2 text-[0.72rem] font-medium text-[#52525B]"
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
                          ? 'border-[#09090B] bg-[#F4F4F5]'
                          : 'border-[#E4E4E7] bg-white hover:border-[#09090B]'
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-semibold text-[#09090B]">{card.title}</p>
                            {card.isRecommended && (
                              <span
                                data-candidate-recommended-badge
                                className="rounded-full bg-[#FF58AE] px-2 py-0.5 text-[0.62rem] font-bold text-[#09090B]"
                              >
                                {copy.dualCandidateRecommendedBadge ?? '가장 닮은 추천'}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[0.75rem] leading-[1.45] text-[#52525B]">
                            {card.desc}
                          </p>
                        </div>
                        {card.similarityScore !== null && (
                          <span className="shrink-0 rounded-full bg-[#F4F4F5] px-2 py-0.5 font-mono text-[0.65rem] font-semibold text-[#09090B] tabular-nums">
                            {Math.round(card.similarityScore * 100)}%
                          </span>
                        )}
                      </div>

                      {card.previewUrl ? (
                        <div className="aspect-[3/4] w-full overflow-hidden rounded-xl border border-[#E4E4E7] bg-white">
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
                          className="aspect-[3/4] w-full animate-pulse rounded-xl border border-[#E4E4E7] bg-[#F4F4F5] motion-reduce:animate-none"
                        />
                      ) : null}

                      <span
                        className={[
                          'inline-flex min-h-8 w-full items-center justify-center rounded-full px-3 py-1 text-[0.72rem] font-semibold',
                          isSelected
                            ? 'bg-[#09090B] text-white'
                            : 'border border-[#E4E4E7] bg-white text-[#09090B]'
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
                  const chosen = selectedCandidate ?? 'seedream-5.5';
                  setSelectedCandidate(chosen);
                  setCleanupChoice('accepted');
                  if (showDualCandidates) {
                    onSelectIdentityCandidate?.(chosen);
                  }
                  onCleanupChoice?.('accept');
                }}
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-[#FF58AE] px-4 py-2 text-xs font-bold text-[#09090B] transition-colors hover:bg-[#FF389F] disabled:opacity-40 ${FOCUS_RING}`}
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
                className={`inline-flex min-h-11 items-center justify-center rounded-full border border-[#E4E4E7] bg-white px-4 py-2 text-xs font-medium text-[#52525B] transition-colors hover:border-[#09090B] hover:text-[#09090B] disabled:opacity-40 ${FOCUS_RING}`}
              >
                {copy.cleanupSkipButton}
              </button>
            </div>
          )}
        </aside>
      )}

      {/* Multi-Shot Image Template Selective Frame Picker (Pick 1..N shots out of 5 with dynamic credits & KRW) */}
      {selectiveQuote && (
        <section
          data-selective-frame-picker
          data-selected-frame-count={selectiveQuote.selectedCount}
          data-total-frame-count={selectiveQuote.totalFrames}
          data-selective-credits={selectiveQuote.totalCredits}
          data-selective-krw={selectiveQuote.totalKrw}
          aria-label={
            locale === 'en'
              ? 'Select which shots to generate'
              : '화보 세트 중 원하는 컷 골라서 제작하기'
          }
          className="rounded-[20px] border border-[#E4E4E7] bg-[#F4F4F5] p-4"
        >
          <input
            type="hidden"
            name="selectedFrames"
            data-selective-frames-input
            value={selectiveQuote.selectedFrameIndices.join(',')}
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 font-mono text-[0.68rem] font-semibold text-[#09090B] tabular-nums">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[#FF58AE]" />
                {locale === 'en'
                  ? `Select shots (${selectiveQuote.selectedCount}/${selectiveQuote.totalFrames})`
                  : `원하는 화보 컷만 골라서 제작 (${selectiveQuote.selectedCount}/${selectiveQuote.totalFrames}컷 선택)`}
              </span>
              <p className="mt-1.5 text-xs leading-relaxed text-[#52525B]">
                {pricingDisplayMode === 'store_credits'
                  ? locale === 'en'
                    ? `Pick all ${selectiveQuote.totalFrames} shots or choose only the frames you want — credits scale automatically.`
                    : `전체 ${selectiveQuote.totalFrames}장을 다 뽑거나, 마음에 드는 구도만 골라서 제작할 수 있어요. 선택한 컷 수에 맞춰 크레딧이 계산됩니다.`
                  : locale === 'en'
                    ? `Pick all ${selectiveQuote.totalFrames} shots or choose only the frames you want — pricing adjusts per shot.`
                    : `전체 ${selectiveQuote.totalFrames}장을 다 뽑거나, 마음에 드는 구도만 골라서 제작할 수 있어요. 선택한 컷 수에 맞춰 금액이 달라집니다.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-selective-pick-all
                disabled={disabled || submitting || !selectiveQuote.isPartialSelection}
                onClick={() =>
                  updateSelectedFrames(
                    Array.from({ length: selectiveQuote.totalFrames }, (_, idx) => idx)
                  )
                }
                className={`rounded-full border border-[#E4E4E7] bg-white px-2.5 py-1 text-[0.7rem] font-medium text-[#09090B] hover:border-[#09090B] disabled:opacity-45 ${FOCUS_RING}`}
              >
                {locale === 'en' ? `All ${selectiveQuote.totalFrames} shots` : `전체 ${selectiveQuote.totalFrames}컷 선택`}
              </button>
              <button
                type="button"
                data-selective-pick-first
                disabled={
                  disabled ||
                  submitting ||
                  (selectiveQuote.selectedCount === 1 &&
                    selectiveQuote.selectedFrameIndices[0] === 0)
                }
                onClick={() => updateSelectedFrames([0])}
                className={`rounded-full border border-[#E4E4E7] bg-white px-2.5 py-1 text-[0.7rem] font-medium text-[#52525B] hover:border-[#09090B] hover:text-[#09090B] disabled:opacity-45 ${FOCUS_RING}`}
              >
                {locale === 'en' ? '1st shot only' : '1번 컷만 선택'}
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-5 gap-2">
            {Array.from({ length: selectiveQuote.totalFrames }, (_, idx) => {
              const isSelected = selectiveQuote.selectedFrameIndices.includes(idx);
              const thumb = imageSetSpec?.frameThumbnails?.[idx] ?? null;
              const isLastRemaining = isSelected && selectiveQuote.selectedCount === 1;
              return (
                <button
                  key={idx}
                  type="button"
                  data-selective-frame-button={idx}
                  aria-pressed={isSelected}
                  disabled={disabled || submitting}
                  onClick={() => {
                    if (isSelected) {
                      if (isLastRemaining) return;
                      updateSelectedFrames(
                        selectiveQuote.selectedFrameIndices.filter((item) => item !== idx)
                      );
                    } else {
                      updateSelectedFrames([...selectiveQuote.selectedFrameIndices, idx]);
                    }
                  }}
                  className={[
                    'flex flex-col items-center justify-between gap-1.5 rounded-[14px] border p-2 text-center transition-colors',
                    FOCUS_RING,
                    isSelected
                      ? 'border-[#09090B] bg-white'
                      : 'border-[#E4E4E7] bg-white/60 opacity-65 hover:opacity-100'
                  ].join(' ')}
                >
                  {thumb ? (
                    <div className="aspect-[4/5] w-full overflow-hidden rounded-[8px] bg-[#F4F4F5]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- frame thumbnail */}
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex aspect-[4/5] w-full items-center justify-center rounded-[8px] bg-[#F4F4F5] font-mono text-xs font-bold text-[#09090B] tabular-nums">
                      0{idx + 1}
                    </div>
                  )}
                  <span
                    className={[
                      'inline-flex w-full items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tabular-nums',
                      isSelected ? 'bg-[#09090B] text-white' : 'bg-[#F4F4F5] text-[#52525B]'
                    ].join(' ')}
                  >
                    {locale === 'en' ? `Shot ${idx + 1}` : `${idx + 1}컷`} {isSelected ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            data-selective-frame-quote
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#E4E4E7] bg-white px-3.5 py-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#09090B]">
                {locale === 'en'
                  ? `${selectiveQuote.selectedCount} of ${selectiveQuote.totalFrames} shots selected`
                  : `총 ${selectiveQuote.totalFrames}컷 중 ${selectiveQuote.selectedCount}컷 선택`}
              </span>
              {selectiveQuote.savedKrw > 0 && (
                <span
                  data-selective-saved-badge
                  className="rounded-full bg-[#F4F4F5] px-2.5 py-0.5 font-mono text-[0.68rem] font-semibold text-[#CC1573] tabular-nums"
                >
                  {pricingDisplayMode === 'store_credits'
                    ? locale === 'en'
                      ? `Saves ${selectiveQuote.savedCredits} credits`
                      : `전체 대비 ${selectiveQuote.savedCredits} 크레딧 절약`
                    : locale === 'en'
                      ? `Saves ₩${selectiveQuote.savedKrw.toLocaleString('en-US')}`
                      : `${selectiveQuote.savedKrw.toLocaleString('ko-KR')}원 절약`}
                </span>
              )}
            </div>
            <div className="font-mono text-xs font-bold text-[#09090B] tabular-nums">
              {pricingDisplayMode === 'store_credits'
                ? locale === 'en'
                  ? `${selectiveQuote.totalCredits} credits`
                  : `${selectiveQuote.totalCredits} 크레딧`
                : locale === 'en'
                  ? `₩${selectiveQuote.totalKrw.toLocaleString('en-US')}`
                  : `${selectiveQuote.totalKrw.toLocaleString('ko-KR')}원`}
            </div>
          </div>
        </section>
      )}

      {/* 3-Tier Video Resolution Picker (480p Draft · 720p Standard · 1080p Masterpiece) + Seedance Audio Mode */}
      {videoResolutionMultiQuote && activeResolutionQuote && (
        <section
          data-video-resolution-tiers
          data-selected-resolution={selectedResolution}
          data-selected-resolution-credits={activeResolutionQuote.totalCredits}
          data-selected-resolution-krw={activeResolutionQuote.totalKrw}
          aria-label={
            locale === 'en'
              ? 'Select video resolution'
              : '영상 화질 선택 (480p · 720p · 1080p)'
          }
          className="rounded-[20px] border border-[#E4E4E7] bg-[#F4F4F5] p-4"
        >
          <input
            type="hidden"
            name="videoResolution"
            data-video-resolution-input
            value={selectedResolution}
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 font-mono text-[0.68rem] font-semibold text-[#09090B] tabular-nums">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[#FF58AE]" />
                {locale === 'en'
                  ? `VIDEO RESOLUTION · ${selectedResolution}`
                  : `영상 화질 선택 (${selectedResolution})`}
              </span>
              <p className="mt-1.5 text-xs leading-relaxed text-[#52525B]">
                {locale === 'en'
                  ? 'Test likeness and edits with 480p Draft first, share in crisp 720p Standard, or render in flagship 1080p Masterpiece.'
                  : '의상·연출 변경이나 얼굴 닮음새가 궁금할 땐 가벼운 480p Draft로 먼저 확인하고, 일상 업로드는 선명한 720p, 최고 소장본은 1080p로 선택하세요.'}
              </p>
            </div>
            <span
              data-draft-savings-pill
              className="rounded-full border border-[#E4E4E7] bg-white px-2.5 py-1 font-mono text-[0.68rem] font-semibold text-[#CC1573] tabular-nums"
            >
              {pricingDisplayMode === 'store_credits'
                ? locale === 'en'
                  ? `480p Draft saves ${videoResolutionMultiQuote.draftWorkflow.draftSavedCreditsVs720p} cr (${videoResolutionMultiQuote.draftWorkflow.draftSavedPercentVs720p}%)`
                  : `480p Draft · 본 영상 대비 ${videoResolutionMultiQuote.draftWorkflow.draftSavedCreditsVs720p} 크레딧(${videoResolutionMultiQuote.draftWorkflow.draftSavedPercentVs720p}%) 절약`
                : locale === 'en'
                  ? `480p Draft saves ${videoResolutionMultiQuote.draftWorkflow.draftSavedPercentVs720p}%`
                  : `480p Draft · 본 영상 대비 ${videoResolutionMultiQuote.draftWorkflow.draftSavedPercentVs720p}% 절약`}
            </span>
          </div>

          <div
            role="radiogroup"
            aria-label={locale === 'en' ? 'Video resolution tiers' : '영상 화질 등급'}
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {(['480p', '720p', '1080p'] as const).map((res) => {
              const tier = videoResolutionMultiQuote.tiers[res];
              const isSelected = selectedResolution === res;
              return (
                <button
                  key={res}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  data-resolution-tier-option={res}
                  data-resolution-tier-credits={tier.totalCredits}
                  data-resolution-tier-selected={isSelected ? 'true' : 'false'}
                  disabled={disabled || submitting}
                  onClick={() => handleSelectResolution(res)}
                  className={[
                    'flex flex-col justify-between gap-2 rounded-[16px] border p-3 text-left transition-colors',
                    FOCUS_RING,
                    isSelected
                      ? 'border-[#09090B] bg-white'
                      : 'border-[#E4E4E7] bg-white/60 hover:border-[#09090B] hover:bg-white'
                  ].join(' ')}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="font-mono text-xs font-bold text-[#09090B] tabular-nums">
                        {res}
                      </span>
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-[0.62rem] font-semibold',
                          isSelected
                            ? 'bg-[#09090B] text-white'
                            : 'bg-[#F4F4F5] text-[#52525B]'
                        ].join(' ')}
                      >
                        {locale === 'en' ? tier.badgeEn : tier.badgeKo}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-[#09090B]">
                      {locale === 'en' ? tier.titleEn : tier.titleKo}
                    </p>
                    <p className="mt-0.5 text-[0.72rem] leading-[1.45] text-[#52525B]">
                      {locale === 'en' ? tier.subtitleEn : tier.subtitleKo}
                    </p>
                  </div>

                  <div className="flex items-baseline justify-between border-t border-[#E4E4E7] pt-2 font-mono tabular-nums">
                    <span className="text-xs font-bold text-[#09090B]">
                      {pricingDisplayMode === 'store_credits'
                        ? locale === 'en'
                          ? `${tier.totalCredits} cr`
                          : `${tier.totalCredits} 크레딧`
                        : locale === 'en'
                          ? `₩${tier.totalKrw.toLocaleString('en-US')}`
                          : `${tier.totalKrw.toLocaleString('ko-KR')}원`}
                    </span>
                    <span className="text-[0.68rem] text-[#71717A]">
                      {locale === 'en' ? tier.badgeEn : tier.badgeKo}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Seedance 2.5 Native Audio Option (Ambient voice/foley default vs Optional scene BGM) — not under a sound lock */}
      {isVideoContext && !soundLocked && (
        <section
          data-director-audio-toggle
          aria-label={locale === 'en' ? 'Video audio option' : '영상 사운드 설정'}
          className="rounded-[20px] border border-[#E4E4E7] bg-white p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#09090B]">
              {locale === 'en' ? 'Video audio option' : '영상 사운드 설정'}
            </span>
            <div className="inline-flex rounded-full border border-[#E4E4E7] bg-[#F4F4F5] p-0.5">
              {PERSONAL_AUDIO_MODES.map((mode) => {
                const active = audioMode === mode;
                const label =
                  mode === 'ambient'
                    ? locale === 'en'
                      ? 'Ambient & voice only (Default)'
                      : '현장음 · 목소리만 (기본)'
                    : locale === 'en'
                      ? 'Generate matching BGM'
                      : '어울리는 배경음악 함께 생성';
                return (
                  <button
                    key={mode}
                    type="button"
                    data-audio-mode-option={mode}
                    aria-pressed={active}
                    onClick={() => setAudioMode(mode)}
                    className={`rounded-full px-3 py-1 text-[0.72rem] transition-colors ${
                      active
                        ? mode === 'bgm'
                          ? 'bg-[#FF58AE] font-bold text-[#09090B]'
                          : 'bg-[#09090B] font-semibold text-white'
                        : 'font-medium text-[#52525B] hover:text-[#09090B]'
                    } ${FOCUS_RING}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {audioMode === 'bgm' ? (
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PERSONAL_BGM_MOODS.map((mood) => {
                  const selected = bgmMood === mood;
                  const label =
                    locale === 'en'
                      ? mood === 'cinematic'
                        ? 'Cinematic strings'
                        : mood === 'trendy_beat'
                          ? 'Trendy beat'
                          : 'Calm acoustic'
                      : mood === 'cinematic'
                        ? '시네마틱 무드'
                        : mood === 'trendy_beat'
                          ? '트렌디 비트'
                          : '잔잔한 어쿠스틱';
                  return (
                    <button
                      key={mood}
                      type="button"
                      data-director-bgm-mood={mood}
                      aria-pressed={selected}
                      onClick={() => setBgmMood(mood)}
                      className={`rounded-full border px-3 py-1 text-[0.72rem] transition-colors ${
                        selected
                          ? 'border-[#09090B] bg-[#F4F4F5] font-semibold text-[#09090B]'
                          : 'border-[#E4E4E7] bg-white text-[#52525B] hover:border-[#09090B]'
                      } ${FOCUS_RING}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[0.72rem] leading-[1.5] text-[#52525B]">
                {locale === 'en'
                  ? 'Scene-matched BGM is generated together with your video. To change the track later, start a new render.'
                  : '장면 분위기에 어울리는 배경음악을 함께 생성합니다. 음악을 바꾸려면 새로 제작해야 합니다.'}
              </p>
            </div>
          ) : (
            <div
              data-personal-no-bgm-notice
              className="mt-2.5 flex items-start gap-2 rounded-[10px] bg-[#F4F4F5] px-3 py-2 text-xs text-[#52525B]"
            >
              <span className="mt-0.5 shrink-0 rounded-full bg-white px-2 py-0.5 text-[0.65rem] font-semibold text-[#09090B]">
                {locale === 'en' ? 'Ambient audio' : '현장음 기본'}
              </span>
              <p className="leading-[1.5]">
                {locale === 'en'
                  ? PERSONAL_NO_BGM_AUDIO_NOTICE_EN
                  : PERSONAL_NO_BGM_AUDIO_NOTICE_KO}
              </p>
            </div>
          )}
        </section>
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
              ? 'border-[#09090B] bg-[#F4F4F5] text-[#09090B]'
              : 'border-[#E4E4E7] bg-white text-[#52525B] hover:border-[#09090B] hover:text-[#09090B]'
          ].join(' ')}
        >
          <span>{expanded ? copy.toggleClose : copy.toggleOpen}</span>
          {chips.length > 0 && (
            <span
              data-director-chip-count
              className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#FF58AE] px-1.5 py-0.5 font-mono text-[0.68rem] font-bold text-[#09090B] tabular-nums"
            >
              {chips.length}
            </span>
          )}
        </button>

        {(editSheet ? hasSheetContent(sheetState.sheet) : chips.length > 0) && (
          <button
            type="button"
            data-director-reset
            disabled={disabled || submitting}
            onClick={resetAll}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs text-[#71717A] underline underline-offset-4 hover:text-[#09090B] disabled:opacity-40 ${FOCUS_RING}`}
          >
            {copy.resetButton}
          </button>
        )}
      </div>

      {/* Applied Customization Summary Chips (Visible even when drawer is collapsed) */}
      {!editSheet && chips.length > 0 && (
        <div
          data-director-summary-chips
          aria-label={copy.activeChipsLabel}
          className="flex flex-wrap gap-1.5"
        >
          {chips.map((chip, index) => (
            <span
              key={`${chip.slot}-${chip.summaryKo}-${index}`}
              data-director-chip={chip.slot}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#09090B] py-1 pr-1 pl-3.5 text-xs font-medium text-white"
            >
              <span className="font-mono text-[0.68rem] text-white/75 uppercase">
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
        className="rounded-[20px] border border-[#E4E4E7] bg-white p-4 transition-colors"
      >
        <p className="text-xs leading-[1.6] text-[#71717A]">{copy.subtitle}</p>

        {/* Template Baseline Disclosure Card: Shows what is fixed vs what defaults are baked into this template */}
        <section
          data-template-baseline-card={resolvedBaseline.templateArchetypeId}
          aria-label={locale === 'en' ? resolvedBaseline.titleEn : resolvedBaseline.titleKo}
          className="mt-3 rounded-[16px] border border-[#E4E4E7] bg-[#F4F4F5] p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              data-template-baseline-title
              className="text-xs font-semibold tracking-tight text-[#09090B]"
            >
              {locale === 'en' ? resolvedBaseline.titleEn : resolvedBaseline.titleKo}
            </h3>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[0.68rem] font-medium text-[#52525B]">
              {locale === 'en' ? 'Template guide' : '기본 고정 · 변경 안내'}
            </span>
          </div>

          {(!activeLocks || visibleBaselineSlots.length > 0) && (
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visibleBaselineSlots.map((slotSpec) => {
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
                    : slotSpec.slot === 'lighting_mood'
                      ? sceneSlot?.file ?? null
                      : null;
              const isSlotCustomized = activeChipForSlot !== null || attachedSlotFile !== null;
              const activeOverrideSummary =
                activeChipForSlot?.summaryKo ??
                (attachedSlotFile ? attachedSlotFile.name : null);

              return (
                <div
                  key={slotSpec.slot}
                  data-baseline-slot={slotSpec.slot}
                  data-baseline-slot-state={isSlotCustomized ? 'customized' : 'default'}
                  className={[
                    'flex flex-col justify-between gap-1.5 rounded-[14px] border p-2.5 transition-colors',
                    isSlotCustomized
                      ? 'border-[#09090B] bg-[#F4F4F5]'
                      : 'border-[#E4E4E7] bg-white'
                  ].join(' ')}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[0.68rem] font-semibold text-[#52525B] uppercase">
                          {slotLabel}
                        </span>
                        {isSlotCustomized && (
                          <span
                            data-baseline-customized-badge={slotSpec.slot}
                            className="rounded-full bg-[#FF58AE] px-2 py-0.5 text-[0.62rem] font-bold text-[#09090B]"
                          >
                            {locale === 'en' ? 'Customized' : '맞춤 적용됨'}
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
                            className={`rounded-full border border-[#E4E4E7] bg-white px-2 py-0.5 text-[0.66rem] font-medium text-[#52525B] hover:border-[#09090B] hover:text-[#09090B] ${FOCUS_RING}`}
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
                            } else if (slotSpec.acceptsReferenceImage === 'scene') {
                              sceneInputRef.current?.click();
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
                          className={`rounded-full border border-[#E4E4E7] bg-[#F4F4F5] px-2.5 py-0.5 text-[0.68rem] font-medium text-[#09090B] hover:border-[#09090B] ${FOCUS_RING}`}
                        >
                          {copy.baselineCustomizeButton}
                        </button>
                      </div>
                    </div>
                    <p
                      className={[
                        'mt-1 text-xs font-medium',
                        isSlotCustomized ? 'text-[#71717A] line-through' : 'text-[#09090B]'
                      ].join(' ')}
                    >
                      {defaultSetting}
                    </p>
                    {isSlotCustomized && activeOverrideSummary && (
                      <p
                        data-baseline-active-override={slotSpec.slot}
                        className="mt-0.5 text-xs font-semibold text-[#09090B]"
                      >
                        → {activeOverrideSummary}
                      </p>
                    )}
                    <p className="mt-0.5 text-[0.72rem] leading-[1.45] text-[#71717A]">{hint}</p>
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {activeLocks && lockWords ? (
            /* docs/PERSONAL-STUDIO.md §3.4.4 — the template's own locked parts replace the guessed ones: the skeleton
               every template keeps, then one quiet pill per locked part (read-only, no controls). */
            <div
              data-template-locked-elements
              data-template-locks={activeLocks.all ? 'all' : 'parts'}
              className="mt-2.5 border-t border-[#E4E4E7] pt-2.5"
            >
              <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-[#52525B]">
                <TemplateLockGlyph />
                {lockWords.lockedHeading}
              </p>
              {activeLocks.all ? (
                <p data-template-lock-all className="mt-1 text-xs leading-[1.5] text-[#09090B]">
                  {lockWords.lockedAll}
                </p>
              ) : (
                <>
                  <p data-template-lock-skeleton className="mt-1 text-xs leading-[1.5] text-[#52525B]">
                    {lockWords.skeleton}
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {lockedPartsOf(activeLocks, lockWords).map((part) => (
                      <li
                        key={part.key}
                        data-template-lock-part={part.key}
                        className="inline-flex items-center rounded-full border border-[#E4E4E7] bg-white px-2.5 py-0.5 text-[0.7rem] font-medium text-[#09090B] tabular-nums"
                      >
                        {part.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
          <div
            data-template-locked-elements
            className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#E4E4E7] pt-2.5"
          >
            <span className="font-mono text-[0.66rem] font-semibold text-[#71717A] uppercase">
              {copy.baselineLockedLabel}:
            </span>
            {(locale === 'en'
              ? resolvedBaseline.lockedElementsEn
              : resolvedBaseline.lockedElementsKo
            ).map((lockedItem) => (
              <span
                key={lockedItem}
                className="inline-flex items-center rounded-full border border-[#E4E4E7] bg-white px-2.5 py-0.5 text-[0.7rem] text-[#71717A]"
              >
                {lockedItem}
              </span>
            ))}
          </div>
          )}
        </section>

        {/* Predictive 1-Tap Revision Presets (Grounded in Real Campaign Revision Data) */}
        {(!activeLocks || visiblePredictivePresets.length > 0) && (
        <div data-director-predictive-presets className="mt-3.5">
          <p className="text-[0.72rem] font-semibold text-[#52525B]">
            {copy.predictivePresetsLabel}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {visiblePredictivePresets.map((preset) => {
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
                    } else if (preset.opensReferenceSlot === 'scene') {
                      sceneInputRef.current?.click();
                    }
                    textInputRef.current?.focus();
                  }}
                  className={[
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40',
                    FOCUS_RING,
                    isPresetActive
                      ? 'border-[#09090B] bg-[#F4F4F5] font-semibold text-[#09090B]'
                      : 'border-[#E4E4E7] bg-white text-[#09090B] hover:border-[#09090B] hover:bg-[#F4F4F5]'
                  ].join(' ')}
                >
                  <span
                    className={[
                      'rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold',
                      isPresetActive ? 'bg-[#09090B] text-white' : 'bg-[#F4F4F5] text-[#52525B]'
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
        )}

        {/* Quick 1-Tap Category Pills */}
        {(!activeLocks || visibleQuickPresets.length > 0) && (
        <div data-director-presets className="mt-2.5 flex flex-wrap gap-1.5">
          {visibleQuickPresets.map((preset) => {
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
                    ? 'border-[#09090B] bg-[#F4F4F5] font-semibold text-[#09090B]'
                    : 'border-[#E4E4E7] bg-[#F4F4F5] text-[#52525B] hover:border-[#09090B] hover:text-[#09090B]'
                ].join(' ')}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        )}

        {/* Recessed Tactile Wells for Optional User Reference Images (only the pickers a template leaves open) */}
        {(!activeLocks || openPickers.length > 0) && (
        <>
        <div
          data-direct-upload-mode="true"
          className="mt-3.5 rounded-[14px] border border-[#E4E4E7] bg-[#F4F4F5] px-3.5 py-2.5"
        >
          <p className="text-[0.75rem] font-medium leading-[1.45] text-[#52525B]">
            {locale === 'en'
              ? 'Direct Reference Image Upload · Attach your exact outfit, product, or backdrop photo to apply it cleanly.'
              : '직접 이미지 업로드 · AI가 임의로 변형하지 않고, 직접 올리신 사진 속 의상·소품·배경 분위기를 장면에 반영합니다.'}
          </p>
        </div>
        <div
          className={`mt-2.5 grid grid-cols-1 gap-2.5 ${activeLocks ? PICKER_GRID_COLS[openPickers.length] : 'sm:grid-cols-3'}`}
        >
          {pickerOpen('outfit') && (
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
          )}
          {pickerOpen('prop') && (
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
          )}
          {pickerOpen('scene') && (
          <input
            ref={sceneInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || submitting}
            onChange={(e) => assignReferenceSlot('scene', 'scene', e.currentTarget.files?.[0])}
          />
          )}

          {/* Slot 1: Outfit Reference */}
          {pickerOpen('outfit') && (
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
              'flex items-center justify-between gap-3 rounded-[16px] border p-3 transition-colors',
              draggingSlot === 'outfit' || outfitSlot
                ? 'border-[#09090B] bg-white'
                : 'border-[#E4E4E7] bg-[#F4F4F5]'
            ].join(' ')}
          >
            {outfitSlot ? (
              <>
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-[#E4E4E7] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    <img
                      src={outfitSlot.previewUrl}
                      alt={copy.outfitSlotLabel}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#09090B]">
                      {outfitSlot.file.name}
                    </p>
                    <p className="font-mono text-[0.68rem] text-[#52525B] tabular-nums">
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
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-sm text-[#71717A] hover:bg-black/5 hover:text-[#09090B] ${FOCUS_RING}`}
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
                  <p className="text-xs font-semibold text-[#09090B]">+ {copy.outfitSlotLabel}</p>
                  <p className="font-mono text-[0.68rem] text-[#71717A] tabular-nums">
                    {copy.outfitSlotHint}
                  </p>
                </div>
                <span className="rounded-full border border-[#E4E4E7] bg-white px-2 py-0.5 font-mono text-[0.65rem] text-[#52525B]">
                  JPG·PNG
                </span>
              </button>
            )}
          </div>
          )}

          {/* Slot 2: Prop / Product Reference */}
          {pickerOpen('prop') && (
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
              'flex items-center justify-between gap-3 rounded-[16px] border p-3 transition-colors',
              draggingSlot === 'prop' || propSlot
                ? 'border-[#09090B] bg-white'
                : 'border-[#E4E4E7] bg-[#F4F4F5]'
            ].join(' ')}
          >
            {propSlot ? (
              <>
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-[#E4E4E7] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    <img
                      src={propSlot.previewUrl}
                      alt={copy.propSlotLabel}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#09090B]">
                      {propSlot.file.name}
                    </p>
                    <p className="font-mono text-[0.68rem] text-[#52525B] tabular-nums">
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
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-sm text-[#71717A] hover:bg-black/5 hover:text-[#09090B] ${FOCUS_RING}`}
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
                  <p className="text-xs font-semibold text-[#09090B]">+ {copy.propSlotLabel}</p>
                  <p className="font-mono text-[0.68rem] text-[#71717A] tabular-nums">
                    {copy.propSlotHint}
                  </p>
                </div>
                <span className="rounded-full border border-[#E4E4E7] bg-white px-2 py-0.5 font-mono text-[0.65rem] text-[#52525B]">
                  JPG·PNG
                </span>
              </button>
            )}
          </div>
          )}

          {/* Slot 3: Scene / Backdrop Reference */}
          {pickerOpen('scene') && (
          <div
            data-director-slot="scene"
            data-slot-filled={sceneSlot ? 'true' : 'false'}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled && !submitting) setDraggingSlot('scene');
            }}
            onDragLeave={() => setDraggingSlot((prev) => (prev === 'scene' ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingSlot(null);
              if (!disabled && !submitting) {
                assignReferenceSlot('scene', 'scene', e.dataTransfer.files?.[0]);
              }
            }}
            className={[
              'flex items-center justify-between gap-3 rounded-[16px] border p-3 transition-colors',
              draggingSlot === 'scene' || sceneSlot
                ? 'border-[#09090B] bg-white'
                : 'border-[#E4E4E7] bg-[#F4F4F5]'
            ].join(' ')}
          >
            {sceneSlot ? (
              <>
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-[#E4E4E7] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    <img
                      src={sceneSlot.previewUrl}
                      alt={copy.sceneSlotLabel ?? '배경 · 무드 사진'}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#09090B]">
                      {sceneSlot.file.name}
                    </p>
                    <p className="font-mono text-[0.68rem] text-[#52525B] tabular-nums">
                      {copy.sceneSlotHint ?? '배경 · 공간 레퍼런스'} ·{' '}
                      <span data-slot-file-spec="scene">
                        {formatReferenceFileSpec(sceneSlot.file)}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-director-slot-clear="scene"
                  aria-label={`${copy.sceneSlotLabel ?? '배경 · 무드 사진'} ${copy.removeSlotLabel}`}
                  onClick={() => clearReferenceSlot('scene')}
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-sm text-[#71717A] hover:bg-black/5 hover:text-[#09090B] ${FOCUS_RING}`}
                >
                  ×
                </button>
              </>
            ) : (
              <button
                type="button"
                data-director-slot-pick="scene"
                disabled={disabled || submitting}
                onClick={() => sceneInputRef.current?.click()}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left disabled:opacity-40 ${FOCUS_RING}`}
              >
                <div>
                  <p className="text-xs font-semibold text-[#09090B]">
                    + {copy.sceneSlotLabel ?? (locale === 'en' ? 'Scene & backdrop photo' : '배경 · 무드 사진')}
                  </p>
                  <p className="font-mono text-[0.68rem] text-[#71717A] tabular-nums">
                    {copy.sceneSlotHint ?? (locale === 'en' ? 'Backdrop & mood reference' : '배경 · 공간 레퍼런스')}
                  </p>
                </div>
                <span className="rounded-full border border-[#E4E4E7] bg-white px-2 py-0.5 font-mono text-[0.65rem] text-[#52525B]">
                  JPG·PNG
                </span>
              </button>
            )}
          </div>
          )}
        </div>
        </>
        )}

        {(outfitSlot !== null || propSlot !== null || sceneSlot !== null) && !userMessage.trim() && (
          <p
            data-director-reference-ready
            className="mt-2 rounded-xl bg-[#F4F4F5] px-3 py-1.5 text-[0.72rem] font-medium text-[#09090B]"
          >
            {locale === 'en'
              ? 'Reference photo attached — you can press Apply directly even without typing a note.'
              : '레퍼런스 사진이 준비되었어요 · 한 줄 설명 없이 바로 [장면에 반영]을 눌러도 적용됩니다.'}
          </p>
        )}

        {/* Disclosed Original Template References (download allowed for non-person objects, inline view-only for person photos) */}
        {disclosedRecipe?.files && disclosedRecipe.files.length > 0 && (
          <section
            data-director-original-references
            aria-label={locale === 'en' ? 'Original template references' : '원본 제작 레퍼런스'}
            className="mt-3.5 rounded-[14px] border border-[#E4E4E7] bg-[#F4F4F5] p-3"
          >
            <p className="text-[0.72rem] font-semibold text-[#09090B]">
              {locale === 'en' ? 'Original template references' : '원본 제작에 사용된 레퍼런스'}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {disclosedRecipe.files.map((file) => {
                const isPersonProtected = Boolean(file.containsPerson) || !file.download;
                return (
                  <div
                    key={file.n}
                    data-director-original-ref={file.n}
                    className="flex items-center justify-between gap-2.5 rounded-xl border border-[#E4E4E7] bg-white p-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {file.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element -- authenticated recipe file preview
                        <img
                          src={file.href}
                          alt={locale === 'en' ? `Reference ${file.n}` : `레퍼런스 ${file.n}`}
                          className="size-10 shrink-0 rounded-lg border border-[#E4E4E7] object-cover"
                        />
                      ) : file.kind === 'video' ? (
                        <video
                          src={file.href}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-10 shrink-0 rounded-lg border border-[#E4E4E7] object-cover"
                        />
                      ) : (
                        <audio
                          src={file.href}
                          controls
                          preload="none"
                          className="h-8 w-36 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#09090B]">
                          {locale === 'en' ? `Reference ${file.n}` : `레퍼런스 ${file.n}`}
                        </p>
                        {isPersonProtected ? (
                          <span
                            data-reference-person-protected={file.n}
                            className="inline-block rounded-full bg-[#F4F4F5] px-2 py-0.5 text-[0.65rem] font-medium text-[#52525B]"
                          >
                            {locale === 'en' ? 'View only (Portrait protected)' : '화면 조회 전용 (인물 보호)'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {!isPersonProtected && file.download ? (
                      <a
                        href={file.download}
                        download
                        data-reference-download={file.n}
                        className={`shrink-0 rounded-full border border-[#E4E4E7] bg-[#F4F4F5] px-2.5 py-1 text-[0.68rem] font-semibold text-[#09090B] hover:border-[#09090B] ${FOCUS_RING}`}
                      >
                        {locale === 'en' ? 'Download' : '다운로드'}
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recessed Tactile Text Input + Apply Pill CTA */}
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={inputId} className="block text-xs font-semibold text-[#09090B]">
              {copy.inputLabel}
            </label>
            <span
              data-director-char-count
              className="font-mono text-[0.68rem] text-[#71717A] tabular-nums"
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
              placeholder={requestPlaceholder}
              onChange={(e) => setUserMessage(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleApplyTurn();
                }
              }}
              className="w-full flex-1 resize-none rounded-[16px] border border-[#E4E4E7] bg-[#F4F4F5] px-3.5 py-2.5 text-sm leading-relaxed text-[#09090B] placeholder:text-[#71717A] focus:border-[#09090B] focus:bg-white focus:outline-none"
            />
            <button
              type="button"
              data-director-apply
              disabled={
                disabled ||
                submitting ||
                (!userMessage.trim() && outfitSlot === null && propSlot === null && sceneSlot === null)
              }
              onClick={() => void handleApplyTurn()}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[#FF58AE] px-5 py-2.5 text-xs font-bold text-[#09090B] transition-colors hover:bg-[#FF389F] disabled:bg-[#E4E4E7] disabled:text-[#71717A] ${FOCUS_RING}`}
            >
              {submitting ? copy.applyingButton : copy.applyButton}
            </button>
          </div>
        </div>

        {/* Live Region for Director Feedback & File Validation Errors */}
        <div id={statusId} role="status" aria-live="polite" className="mt-2">
          {pasteNotice && (
            <p data-director-paste-notice className="text-xs font-medium text-[#CC1573]">
              {pasteNotice}
            </p>
          )}
          {fileError && (
            <p data-director-file-error className="text-xs font-medium text-[#CC1573]">
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
                  ? 'bg-[#F4F4F5] text-[#09090B]'
                  : 'border border-[#E4E4E7] bg-[#F4F4F5] text-[#52525B]'
              ].join(' ')}
            >
              {assistantMessage}
            </p>
          )}
        </div>
      </div>

      {/* Sheet mode: the edit sheet card, right above the studio's price and its one button (docs §3.1). */}
      {/* With template locks the card stands from the start: "can't be changed" is seen before anything is asked. */}
      {editSheet &&
        sheetDraft &&
        (activeLocks !== null ||
          expanded ||
          hasSheetContent(sheetDraft.fold.sheet) ||
          sheetQuestion !== null ||
          sheetNotice !== null) && (
          <EditSheetCard
            copy={editSheet}
            sheet={sheetDraft.fold.sheet}
            pendingIndex={sheetDraft.fold.pendingIndex}
            pendingNotice={pendingLineNotice(sheetDraft.fold, editSheet)}
            question={sheetQuestion}
            notice={sheetNoticeText(sheetNotice, editSheet)}
            noticeDetail={sheetNotice?.detail ?? null}
            foldNotice={pendingFoldNotice(sheetDraft.fold, editSheet)}
            locks={activeLocks}
            disabled={disabled || submitting}
            onRemove={(block, index) => editSheetLocally((sheet) => removeLine(sheet, block, index))}
            onRevert={(index) => editSheetLocally((sheet) => revertChange(sheet, index))}
            onDiscardPending={() => {
              setUserMessage('');
              textInputRef.current?.focus();
            }}
            onAnswer={(option) => void submitSheetTurn(option, false)}
          />
        )}
    </div>
  );
}
