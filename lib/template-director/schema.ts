import { z } from 'zod';
import type { RecipeSlotRole } from '@/lib/recipes/schema';

export const GEMINI_DIRECTOR_DEFAULT_MODEL = 'gemini-3.8-flash' as const;
export const GEMINI_DIRECTOR_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta' as const;

export const PHOTO_ISSUE_CODES = [
  'hand_occlusion',
  'prop_occlusion',
  'hair_occlusion',
  'tight_crop',
  'wide_crop',
  'asymmetrical_shoulders',
  'bare_shoulder_id_crop',
  'wide_angle_distortion',
  'low_resolution',
  'motion_blur',
  'harsh_lighting',
  'heavy_filter',
  'over_retouched_contour',
  'angle_extreme',
  'multiple_faces'
] as const;
export type PhotoIssueCode = (typeof PHOTO_ISSUE_CODES)[number];

export const DIRECTOR_EDITABLE_SLOTS = [
  'outfit',
  'makeup',
  'hair',
  'prop',
  'shot_action',
  'lighting_mood'
] as const;
export type DirectorEditableSlot = (typeof DIRECTOR_EDITABLE_SLOTS)[number];

export const DUAL_IDENTITY_CANDIDATE_ENGINES = [
  'seedream-5.0-pro',
  'nano-banana-2.1'
] as const;
export type DualIdentityCandidateEngine = (typeof DUAL_IDENTITY_CANDIDATE_ENGINES)[number];
export type IdentityCandidateChoiceId = DualIdentityCandidateEngine | 'original';

export interface IdentityCandidatePreview {
  engine: DualIdentityCandidateEngine;
  titleKo: string;
  titleEn: string;
  subtitleKo: string;
  subtitleEn: string;
  previewUrl?: string | null;
  similarityScore?: number | null;
}

export interface TemplateBaselineSlotSpec {
  slot: DirectorEditableSlot;
  labelKo: string;
  labelEn: string;
  /** Default styling baked into the template so the user knows what happens if they don't customize. */
  defaultSettingKo: string;
  defaultSettingEn: string;
  /** Guidance on how the user can override this slot via text or reference photo. */
  customizableHintKo: string;
  customizableHintEn: string;
  acceptsReferenceImage?: 'outfit' | 'prop' | null;
}

export interface TemplatePredictivePreset {
  id: string;
  slot: DirectorEditableSlot;
  labelKo: string;
  labelEn: string;
  /** Short empirical badge explaining why users frequently choose this option. */
  reasonBadgeKo: string;
  reasonBadgeEn: string;
  samplePromptKo: string;
  samplePromptEn: string;
  opensReferenceSlot?: 'outfit' | 'prop' | null;
}

export interface TemplateBaselineSpec {
  templateArchetypeId: string;
  titleKo: string;
  titleEn: string;
  /** Fixed elements that cannot be changed (camera work, background, audio timing). */
  lockedElementsKo: readonly string[];
  lockedElementsEn: readonly string[];
  /** Default template styling across customizable slots. */
  baselineSlots: readonly TemplateBaselineSlotSpec[];
  /** Predictive 1-tap customization presets grounded in real campaign revision data. */
  predictivePresets: readonly TemplatePredictivePreset[];
}

export const CLEANUP_MODES = [
  'none',
  'inpaint_occlusion',
  'normalize_retouch',
  'restore_detail',
  'prompt_strict_lock_only'
] as const;
export type CleanupMode = (typeof CLEANUP_MODES)[number];

export const CLEANUP_ENGINES = [
  'seedream-5.0-pro',
  'nano-banana-2.1',
  'gpt-image-2.5-sunburst',
  'seedvr2-local'
] as const;
export type CleanupEngineId = (typeof CLEANUP_ENGINES)[number];

export interface DirectorConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface PhotoPrecheckInput {
  width: number;
  height: number;
  byteLength: number;
  exifOrientation?: number;
}

export interface PhotoPrecheckResult {
  needsUpscale: boolean;
  needsRotationFix: boolean;
  recommendedLocalEngine: 'seedvr2-local' | null;
}

export interface PhotoInspectionInput {
  photo: { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' };
  width: number;
  height: number;
  role: RecipeSlotRole;
}

export interface RecommendedPhotoCleanup {
  mode: CleanupMode;
  engine: CleanupEngineId | null;
  fallbackEngine: CleanupEngineId | null;
  editPromptEn: string | null;
  /**
   * When true (occlusion or heavy beauty-app retouching detected), TWINGS generates two parallel
   * identity candidates (Seedream 5.0 Pro + Nano Banana 2.1) and lets the user pick the one that
   * looks most like their real face.
   */
  requiresDualCandidateSelection?: boolean;
  candidateEngines?: readonly DualIdentityCandidateEngine[] | null;
  candidatePromptsEn?: Record<DualIdentityCandidateEngine, string> | null;
}

export interface PhotoInspectionVerdict {
  status: 'ready' | 'needs_cleanup' | 'needs_retake';
  issues: PhotoIssueCode[];
  /** Ideal Seedance 2.5 Bust-Up face width ratio is 0.30..0.42. */
  faceWidthRatio: number;
  extractedHairDescription: string | null;
  userMessageKo: string;
  userMessageEn: string;
  recommendedCleanup: RecommendedPhotoCleanup;
}

export type ModelSpecificImageEngine =
  | 'seedream-5.0-pro'
  | 'nano-banana-2.1'
  | 'gpt-image-2.5-sunburst';

export interface MultiPhotoIdentityInput {
  photos: ReadonlyArray<{
    bytes: Uint8Array;
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
    filename?: string;
  }>;
  /** Optional creator or user feedback (e.g., "이마 조금 줄이고 턱선 둥글게"). */
  creatorNoteKo?: string | null;
  /** Target synthesis engine for model-specific prompt optimization (defaults to 'seedream-5.0-pro' or 'nano-banana-2.1'). */
  preferredEngine?: ModelSpecificImageEngine;
}

export const OPTICAL_IDENTITY_STRATEGIES = [
  'passthrough_crop',
  'surgical_inplace_edit',
  'fallback_to_passthrough_crop'
] as const;
export type OpticalIdentityStrategy = (typeof OPTICAL_IDENTITY_STRATEGIES)[number];

export interface OpticalIdentityMasterPlan {
  /**
   * 'passthrough_crop' (default, 0% AI distortion, preserves 100% original pixels) when any clean photo exists;
   * 'surgical_inplace_edit' ONLY when all photos have occlusions/liquify or explicit creatorNoteKo requests modification.
   */
  strategy: 'passthrough_crop' | 'surgical_inplace_edit';
  /** 0-based index of the photo that best represents preferred hairstyle, bangs, and facial charm. */
  styleAnchorIndex: number;
  /** 0-based index of the photo that best represents true frontal bone symmetry, nose, and eye spacing (never a 24mm barrel-distorted closeup). */
  structureAnchorIndex: number;
  /** Clockwise rotation needed if stripped-EXIF HEIC->JPG photo is sideways. */
  styleAnchorRotationClockwiseDegrees: 0 | 90 | 180 | 270;
  /** Normalized [ymin, xmin, ymax, xmax] (0..1000) for deterministic 3:4 bust-up optical crop. */
  bustupCropBoxNormalized: readonly [number, number, number, number];
  detectedIssues: PhotoIssueCode[];
  requiresMasterSynthesis: boolean;
  engine: ModelSpecificImageEngine | null;
  extractedIdentityLockEn: string;
  extractedHairLockEn: string;
  /** Server-only model-specific prompt fed to the selected engine when strategy === 'surgical_inplace_edit'. */
  opticalMasterPromptEn: OpaqueCompiledPrompt;
  /** Server-only fallback prompt formatted specifically for the secondary engine (e.g. Seedream 5.0 Pro <-> Nano Banana 2.1). */
  fallbackMasterPromptEn: OpaqueCompiledPrompt;
  /** Parallel dual-candidate prompts (Seedream 5.0 Pro + Nano Banana 2.1) so the user can pick the closest likeness. */
  dualCandidatePromptsEn: Record<DualIdentityCandidateEngine, OpaqueCompiledPrompt>;
}

export interface IdentitySimilarityVerificationInput {
  originalPhoto: { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' };
  generatedPhoto: { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' };
  creatorNoteKo?: string | null;
}

export interface IdentitySimilarityVerdict {
  identitySimilarityScore: number;
  agingOrDistortionDetected: boolean;
  passedGate: boolean;
  recommendedAction: 'keep_surgical_edit' | 'fallback_to_passthrough_crop';
  reasonKo: string;
}

export interface DirectorSummaryChip {
  slot: DirectorEditableSlot;
  labelKo: string;
  summaryKo: string;
}

export interface DirectorShotEdit {
  shotIndex: number;
  actionEn: string;
}

export interface DirectorEditIntent {
  hairOverrideEn: string | null;
  makeupOverrideEn?: string | null;
  outfitOverrideEn: string | null;
  propOverrideEn: string | null;
  shotEdits: DirectorShotEdit[];
  strictExclusionsEn: string[];
}

export interface DirectorReferenceAttachment {
  slotName: string;
  role: Exclude<RecipeSlotRole, 'person'>;
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface DirectorChatTurnInput {
  templateId: string;
  /** Korean summary of the template's shots — safe for Stage 1; contains zero private English prompt text. */
  templateSummaryKo: string;
  editableSlots: readonly DirectorEditableSlot[];
  userMessage: string;
  references?: readonly DirectorReferenceAttachment[];
}

export type DirectorRefusalCode = 'none' | 'identity' | 'unsafe' | 'unsupported' | 'too_large';

export interface DirectorChatTurnResult {
  approved: boolean;
  refusal: DirectorRefusalCode;
  replyKo: string;
  guardrailAdjustmentKo: string | null;
  readyToRender: boolean;
  summaryChips: DirectorSummaryChip[];
  /** Server-only sanitized intent passed to Stage 2; stripped from client responses by `toClientDirectorTurnResponse`. */
  structuredIntent: DirectorEditIntent | null;
}

/** Client-safe projection returned to the browser. Never contains English prompt fragments or `structuredIntent`. */
export interface ClientDirectorTurnResponse {
  approved: boolean;
  refusal: DirectorRefusalCode;
  replyKo: string;
  guardrailAdjustmentKo: string | null;
  readyToRender: boolean;
  summaryChips: DirectorSummaryChip[];
}

export interface DirectorReferenceSlotMeta {
  index: number;
  slotName: string;
  role: RecipeSlotRole;
}

export interface DirectorRewriteInput {
  /** Private master prompt from the database — never leaves the server. */
  basePrompt: string;
  structuredIntent: DirectorEditIntent;
  referenceSlots: readonly DirectorReferenceSlotMeta[];
}

/**
 * Opaque handle for a server-only compiled prompt.
 * Serializing this object with `JSON.stringify` or `.toJSON()` always yields `"[REDACTED_SERVER_ONLY_PROMPT]"`
 * so accidental inclusion in an API response can never leak the master prompt or Video-Creator doctrine.
 */
export interface OpaqueCompiledPrompt {
  readonly __brand: 'OpaqueCompiledPrompt';
  toJSON(): string;
  toString(): string;
}

export interface DirectorRewriteResult {
  compiledPrompt: OpaqueCompiledPrompt;
  preservedCameraAndLighting: boolean;
  preservedAudioRule: boolean;
  preservedIdentityStrictLock: boolean;
}

const KNOWN_PHOTO_ISSUE_SET: ReadonlySet<string> = new Set(PHOTO_ISSUE_CODES);

export const rawPhotoInspectionSchema = z.object({
  status: z.enum(['ready', 'needs_cleanup', 'needs_retake']),
  issues: z
    .preprocess(
      (val) =>
        Array.isArray(val)
          ? val.filter((item): item is string => typeof item === 'string' && KNOWN_PHOTO_ISSUE_SET.has(item))
          : [],
      z.array(z.enum(PHOTO_ISSUE_CODES)).max(8)
    ),
  faceWidthRatio: z.number().min(0).max(1),
  extractedHairDescription: z.string().trim().max(400).nullable(),
  userMessageKo: z.string().trim().min(2).max(500),
  userMessageEn: z.string().trim().min(2).max(500),
  cleanupPromptEn: z.string().trim().max(1000).nullable()
});

export const rawStage1ChatSchema = z.object({
  approved: z.boolean(),
  refusal: z.enum(['none', 'identity', 'unsafe', 'unsupported', 'too_large']),
  replyKo: z.string().trim().min(2).max(600),
  guardrailAdjustmentKo: z.string().trim().max(400).nullable(),
  readyToRender: z.boolean(),
  summaryChips: z
    .array(
      z.object({
        slot: z.enum(DIRECTOR_EDITABLE_SLOTS),
        labelKo: z.string().trim().min(1).max(60),
        summaryKo: z.string().trim().min(1).max(200)
      })
    )
    .max(5),
  structuredIntent: z
    .object({
      hairOverrideEn: z.string().trim().max(400).nullable(),
      makeupOverrideEn: z.string().trim().max(400).nullable().optional().default(null),
      outfitOverrideEn: z.string().trim().max(600).nullable(),
      propOverrideEn: z.string().trim().max(400).nullable(),
      shotEdits: z
        .array(
          z.object({
            shotIndex: z.number().int().min(1).max(12),
            actionEn: z.string().trim().min(5).max(500)
          })
        )
        .max(4),
      strictExclusionsEn: z.array(z.string().trim().min(1).max(120)).max(12)
    })
    .nullable()
});

export const rawStage2RewriteSchema = z.object({
  rewrittenPrompt: z.string().trim().min(40).max(16_000),
  preservedCameraAndLighting: z.boolean(),
  preservedAudioRule: z.boolean(),
  preservedIdentityStrictLock: z.boolean()
});

export const rawOpticalIdentityMasterSchema = z.object({
  strategy: z.enum(['passthrough_crop', 'surgical_inplace_edit']).default('passthrough_crop'),
  styleAnchorIndex: z.number().int().min(0).max(7),
  structureAnchorIndex: z.number().int().min(0).max(7),
  styleAnchorRotationClockwiseDegrees: z
    .preprocess(
      (val) => (val === 90 || val === 180 || val === 270 ? val : 0),
      z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    )
    .default(0),
  bustupCropBoxNormalized: z
    .tuple([
      z.number().int().min(0).max(1000),
      z.number().int().min(0).max(1000),
      z.number().int().min(0).max(1000),
      z.number().int().min(0).max(1000)
    ])
    .default([40, 100, 960, 900]),
  detectedIssues: z
    .preprocess(
      (val) =>
        Array.isArray(val)
          ? val.filter((item): item is string => typeof item === 'string' && KNOWN_PHOTO_ISSUE_SET.has(item))
          : [],
      z.array(z.enum(PHOTO_ISSUE_CODES)).max(8)
    ),
  requiresMasterSynthesis: z.boolean(),
  extractedIdentityLockEn: z.string().trim().min(10).max(600),
  extractedHairLockEn: z.string().trim().min(10).max(400),
  opticalMasterPromptEn: z.string().trim().min(10).max(1600)
});

export const rawIdentitySimilaritySchema = z.object({
  identitySimilarityScore: z.number().min(0).max(1),
  agingOrDistortionDetected: z.boolean(),
  passedGate: z.boolean(),
  reasonKo: z.string().trim().min(2).max(400)
});

/**
 * Empirical Template Baseline Presets derived from 33+ real creator campaign deliveries
 * (90s Apgujeong Interview, Night Red Carpet Arrival, Editorial Runway).
 * Discloses what is baked into the template by default vs what the user can customize
 * via text or reference photo (@Image 2 Look, @Image 3 Prop).
 */
export const DEFAULT_EDITORIAL_TEMPLATE_BASELINE: TemplateBaselineSpec = {
  templateArchetypeId: 'default-editorial',
  titleKo: '이 템플릿의 기본 연출 · 맞춤 변경 범위',
  titleEn: 'Template Default Styling & Customizable Scope',
  lockedElementsKo: [
    '카메라 렌즈 · 컷 전환 리듬',
    '공간 배경 · 조명 무드',
    '원본 오디오 · 립싱크 타이밍'
  ],
  lockedElementsEn: [
    'Camera lens & cut rhythm',
    'Scene backdrop & lighting mood',
    'Master audio & lip-sync timing'
  ],
  baselineSlots: [
    {
      slot: 'outfit',
      labelKo: '기본 착장',
      labelEn: 'Default Outfit',
      defaultSettingKo: '템플릿 시그니처 착장 (시안의 기본 의상 적용)',
      defaultSettingEn: 'Template signature wardrobe',
      customizableHintKo: '원하는 옷 사진(@Image 2)을 올리거나 텍스트로 드레스·수트·자켓 스타일을 지정할 수 있어요',
      customizableHintEn: 'Attach an outfit photo (@Image 2) or describe your desired look',
      acceptsReferenceImage: 'outfit'
    },
    {
      slot: 'makeup',
      labelKo: '기본 메이크업 · 피부 톤',
      labelEn: 'Default Makeup & Skin',
      defaultSettingKo: '템플릿 무드 메이크업 · 매트 새틴 피부결',
      defaultSettingEn: 'Template mood makeup & matte-satin skin',
      customizableHintKo: '진한 화장이 어색하면 내 사진 속 데일리 메이크업·맑은 피부톤 그대로 유지하도록 바꿀 수 있어요',
      customizableHintEn: 'Keep your natural daily makeup and clean complexion from your photo',
      acceptsReferenceImage: null
    },
    {
      slot: 'hair',
      labelKo: '기본 헤어 · 머리 소품',
      labelEn: 'Default Hair & Headwear',
      defaultSettingKo: '내 사진 속 헤어스타일 반영 (사진 속 안경·선글라스 자동 제외)',
      defaultSettingEn: 'Your selfie hairstyle (glasses/sunglasses excluded)',
      customizableHintKo: '앞머리(시스루뱅/사이드뱅)나 긴 생머리 고정, 머리 위 선글라스·장식 제거를 지정할 수 있어요',
      customizableHintEn: 'Lock specific bangs/length or strip eyewear and hair accessories',
      acceptsReferenceImage: null
    },
    {
      slot: 'shot_action',
      labelKo: '기본 표정 · 입 모양',
      labelEn: 'Default Expression & Poise',
      defaultSettingKo: '시크한 오프축 시선 · 입을 크게 벌리지 않는 차분한 표정',
      defaultSettingEn: 'Calm off-axis poise & understated lip motion',
      customizableHintKo: '센 인상이 부담스러우면 부드러운 반미소와 편안한 눈빛으로 바꿀 수 있어요',
      customizableHintEn: 'Soften into a gentle half-smile and relaxed gaze',
      acceptsReferenceImage: null
    }
  ],
  predictivePresets: [
    {
      id: 'makeup-daily-clean',
      slot: 'makeup',
      labelKo: '진한 화장 빼고 내 평소 데일리 메이크업 유지',
      labelEn: 'Keep my natural daily makeup',
      reasonBadgeKo: '인상 왜곡 방지 1위',
      reasonBadgeEn: 'Top identity lock',
      samplePromptKo:
        '템플릿의 진한 아이·립 메이크업 대신 내 사진 속 평소 데일리 메이크업과 맑고 깨끗한 피부 톤을 그대로 유지해 줘',
      samplePromptEn:
        'Keep my natural daily eye/brow makeup and clean bright complexion from my photo instead of heavy template makeup'
    },
    {
      id: 'outfit-actress-black-dress',
      slot: 'outfit',
      labelKo: '여배우 블랙 새틴 드레스로 변경',
      labelEn: 'Black satin actress gown',
      reasonBadgeKo: '레드카펫 인기 1위',
      reasonBadgeEn: 'Most requested look',
      samplePromptKo:
        '기본 의상 대신 목 스카프 없이 우아한 여배우 느낌의 오프숄더 블랙 실크 새틴 드레스와 다이아몬드 초커 착장으로 바꿔 줘',
      samplePromptEn:
        'Replace the default outfit with an elegant strapless black silk-satin actress gown and diamond choker without any neck scarf'
    },
    {
      id: 'outfit-user-photo-ref',
      slot: 'outfit',
      labelKo: '내가 올린 옷 사진(@Image 2) 그대로 입히기',
      labelEn: 'Wear my uploaded outfit (@Image 2)',
      reasonBadgeKo: '착장 사진 연동',
      reasonBadgeEn: 'Photo reference',
      samplePromptKo: '기본 착장 대신 첨부한 의상 사진(@Image 2)의 옷 실루엣과 컬러로 전 컷 동일하게 갈아입혀 줘',
      samplePromptEn: 'Dress me in the exact garment silhouette and colour from attached @Image 2 across every shot',
      opensReferenceSlot: 'outfit'
    },
    {
      id: 'hair-bangs-no-glasses',
      slot: 'hair',
      labelKo: '내 앞머리·머리길이 고정 + 안경/선글라스 제거',
      labelEn: 'Lock bangs & remove eyewear',
      reasonBadgeKo: '헤어 고정 필수',
      reasonBadgeEn: 'Hairline lock',
      samplePromptKo:
        '내 사진 속 앞머리 볼륨과 머리 길이를 끝까지 똑같이 유지하고, 사진에 있는 안경·머리 위 선글라스·가방 끈은 완전히 빼 줘',
      samplePromptEn:
        'Preserve my exact bangs and hair length from my selfie and strictly remove any eyeglasses, head sunglasses, or bag straps'
    },
    {
      id: 'action-soft-calm-lipsync',
      slot: 'shot_action',
      labelKo: '센 인상 완화 · 부드러운 반미소 & 차분한 입 모양',
      labelEn: 'Soft half-smile & calm lip motion',
      reasonBadgeKo: '하관 왜곡 방지',
      reasonBadgeEn: 'Lower-face lock',
      samplePromptKo:
        '너무 세거나 날카로운 인상 대신 부드럽고 여유 있는 반미소를 짓게 하고, 말할 때 입을 크게 벌리지 않도록 차분하게 연출해 줘',
      samplePromptEn:
        'Soften any fierce expression into a warm, relaxed half-smile and keep lip movements small and understated'
    },
    {
      id: 'prop-user-product-ref',
      slot: 'prop',
      labelKo: '내 제품·소품 사진(@Image 3) 자연스럽게 들려주기',
      labelEn: 'Hold my uploaded product (@Image 3)',
      reasonBadgeKo: '소품 교체',
      reasonBadgeEn: 'Prop reference',
      samplePromptKo: '기존 소품은 빼고 첨부한 제품 사진(@Image 3)을 실제 손 크기에 맞춰 자연스럽게 들려줘',
      samplePromptEn: 'Remove the default prop and hold the attached product (@Image 3) at true hand scale',
      opensReferenceSlot: 'prop'
    }
  ]
};

export const TEMPLATE_BASELINE_PRESETS: Readonly<Record<string, TemplateBaselineSpec>> = {
  'default-editorial': DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
  '90s-apgujeong-interview': {
    ...DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
    templateArchetypeId: '90s-apgujeong-interview',
    titleKo: '90년대 압구정 인터뷰 템플릿 · 기본 설정 안내',
    titleEn: '1994 Apgujeong Street Interview · Baseline Guide',
    lockedElementsKo: [
      '1994년 압구정 로데오 거리 · 아날로그 캠코더 질감',
      '기자 질문(0~1.8초) 후 3문장 인터뷰 대사 타이밍',
      '8.0초 플래시 컷 · 클래식 블랙 세단 드라이빙 엔딩'
    ],
    lockedElementsEn: [
      '1994 Apgujeong street & analog Betacam texture',
      'Off-camera reporter question + 3-phrase lip-sync timing',
      '8.0s flash cut & classic black sedan driving outro'
    ],
    baselineSlots: [
      {
        slot: 'outfit',
        labelKo: '기본 착장',
        labelEn: 'Default Outfit',
        defaultSettingKo: '94년 압구정 블랙 가죽 재킷 · 차콜 팬츠 · 삐삐 벨트',
        defaultSettingEn: '1994 black leather jacket, charcoal trousers & waist pager',
        customizableHintKo: '오프화이트 블레이저·셔츠 룩이나 내가 올린 옷 사진(@Image 2)으로 바꿀 수 있어요',
        customizableHintEn: 'Swap to an off-white blazer look or attach your own outfit photo (@Image 2)',
        acceptsReferenceImage: 'outfit'
      },
      {
        slot: 'makeup',
        labelKo: '기본 메이크업 · 피부 톤',
        labelEn: 'Default Makeup & Skin',
        defaultSettingKo: '94년 레트로 딥 플럼 버건디 매트 립 & 세미 스모키 음영',
        defaultSettingEn: '1994 deep plum-burgundy matte lips & smoky socket shading',
        customizableHintKo: '90년대 진한 화장이 세 보이면 내 원래 눈화장·맑은 피부톤을 유지하고 입술만 은은하게 바꿀 수 있어요',
        customizableHintEn: 'Keep your clean skin and natural eye makeup while softening the retro lip tone',
        acceptsReferenceImage: null
      },
      {
        slot: 'hair',
        labelKo: '기본 헤어 · 머리 소품',
        labelEn: 'Default Hair & Headwear',
        defaultSettingKo: '내 사진 속 헤어스타일 + 정수리 위 90년대 오벌 선글라스',
        defaultSettingEn: 'Your hairstyle + 1990s dark oval sunglasses perched on crown',
        customizableHintKo: '머리 위 선글라스를 빼거나 내 사진의 앞머리·생머리 스타일로 고정할 수 있어요',
        customizableHintEn: 'Remove crown sunglasses or lock your exact bangs and straight hair',
        acceptsReferenceImage: null
      },
      {
        slot: 'shot_action',
        labelKo: '기본 표정 · 립싱크',
        labelEn: 'Default Expression & Lip-Sync',
        defaultSettingKo: '차분한 입 모양 립싱크 · 7.8초 당당한 미소',
        defaultSettingEn: 'Understated lip-sync & confident smile at 7.8s',
        customizableHintKo: '입을 크게 벌리지 않는 절제된 발음과 부드러운 인상으로 하관 왜곡을 막아줘요',
        customizableHintEn: 'Keep mouth opening minimal to preserve lower-face likeness',
        acceptsReferenceImage: null
      }
    ]
  },
  'red-carpet-arrival': {
    ...DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
    templateArchetypeId: 'red-carpet-arrival',
    titleKo: '나이트 레드카펫 프레스 라인 · 기본 설정 안내',
    titleEn: 'Night Red Carpet Press Arrival · Baseline Guide',
    lockedElementsKo: [
      '밤 레드카펫 프레스 라인 · 카메라 플래시 조명',
      '경호원·취재진 사이 망원 워킹 & 팬 사인회 7컷 구성',
      '11초 무음악(No-BGM) 실제 셔터음 · 다국어 기자 콜 사운드'
    ],
    lockedElementsEn: [
      'Night red-carpet chiaroscuro & press xenon flashes',
      '7-cut telephoto crowd walk & autograph sequence',
      '11s unbroken live shutter & multilingual press-call audio'
    ],
    baselineSlots: [
      {
        slot: 'outfit',
        labelKo: '기본 착장',
        labelEn: 'Default Outfit',
        defaultSettingKo: '런웨이 타우프 베이지 스웨이드 코르셋 드레스 · 화이트 실크 스카프 · 롱부츠',
        defaultSettingEn: 'Taupe-beige suede corset dress, white silk neck kerchief & boots',
        customizableHintKo: '목 스카프를 뺀 여배우 블랙 새틴 드레스나 내 드레스 사진(@Image 2)으로 바꿀 수 있어요',
        customizableHintEn: 'Switch to a strapless black satin actress gown or upload @Image 2',
        acceptsReferenceImage: 'outfit'
      },
      {
        slot: 'makeup',
        labelKo: '기본 메이크업 · 피부 톤',
        labelEn: 'Default Makeup & Skin',
        defaultSettingKo: '핑크기를 뺀 매트 새틴 피부결 · 본인 고유의 자연스러운 입술 톤',
        defaultSettingEn: 'Matte-satin warm skin with natural muted lip tone (no pink blush)',
        customizableHintKo: '플래시 조명 아래에서도 하얗게 뜨지 않는 맑고 깨끗한 피부톤으로 조율할 수 있어요',
        customizableHintEn: 'Keep flash highlights controlled with clean, luminous skin',
        acceptsReferenceImage: null
      },
      {
        slot: 'hair',
        labelKo: '기본 헤어 · 소품 정리',
        labelEn: 'Default Hair & Prop Cleanup',
        defaultSettingKo: '내 사진 헤어스타일 유지 (안경 · 머리 위 선글라스 · 가방 끈 자동 제거)',
        defaultSettingEn: 'Your hairstyle (eyeglasses, head sunglasses & bags automatically stripped)',
        customizableHintKo: '앞머리 고정이나 생머리/웨이브 변경, 다이아몬드 초커 추가가 가능해요',
        customizableHintEn: 'Lock bangs/waves or add subtle jewelry',
        acceptsReferenceImage: null
      },
      {
        slot: 'shot_action',
        labelKo: '기본 표정 · 시선',
        labelEn: 'Default Expression & Gaze',
        defaultSettingKo: '카메라를 정면 응시하지 않는 여유로운 오프축 시선 & 손인사',
        defaultSettingEn: 'Candid off-axis celebrity gaze & casual wave',
        customizableHintKo: '차분하고 도도한 무표정 또는 부드러운 반미소 중 선택할 수 있어요',
        customizableHintEn: 'Choose cool unbothered poise or a warm relaxed half-smile',
        acceptsReferenceImage: null
      }
    ]
  }
};

export function resolveTemplateBaseline(templateIdOrArchetype?: string | null): TemplateBaselineSpec {
  const key = (templateIdOrArchetype ?? '').trim().toLowerCase();
  const direct = key ? TEMPLATE_BASELINE_PRESETS[key] : undefined;
  if (direct) {
    return direct;
  }
  if (key.includes('90s') || key.includes('interview') || key.includes('apgujeong') || key.includes('jilju')) {
    return TEMPLATE_BASELINE_PRESETS['90s-apgujeong-interview'] ?? DEFAULT_EDITORIAL_TEMPLATE_BASELINE;
  }
  if (
    key.includes('red-carpet') ||
    key.includes('red_carpet') ||
    key.includes('press') ||
    key.includes('paparazzi') ||
    key.includes('01a195e5')
  ) {
    return TEMPLATE_BASELINE_PRESETS['red-carpet-arrival'] ?? DEFAULT_EDITORIAL_TEMPLATE_BASELINE;
  }
  return DEFAULT_EDITORIAL_TEMPLATE_BASELINE;
}
