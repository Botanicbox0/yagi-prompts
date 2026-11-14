import { z } from 'zod';
import type { RecipeSlotRole } from '@/lib/recipes/schema';

export const GEMINI_DIRECTOR_DEFAULT_MODEL = 'gemini-4-hydrogen' as const;
export const GEMINI_DIRECTOR_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta' as const;

export const PERSONAL_AUDIO_MODES = ['ambient', 'bgm'] as const;
export type PersonalAudioMode = (typeof PERSONAL_AUDIO_MODES)[number];

export const PERSONAL_BGM_MOODS = ['cinematic', 'trendy_beat', 'calm_mood'] as const;
export type PersonalBgmMood = (typeof PERSONAL_BGM_MOODS)[number];

export const CUSTOM_DIRECTOR_REF_SLOTS = ['look_ref', 'prop_ref', 'scene_ref'] as const;
export type CustomDirectorRefSlot = (typeof CUSTOM_DIRECTOR_REF_SLOTS)[number];

export const PHOTO_ISSUE_CODES = [
  'hand_occlusion',
  'prop_occlusion',
  'hair_occlusion',
  'tight_crop',
  'wide_crop',
  'asymmetrical_shoulders',
  'bare_shoulder_id_crop',
  'wide_sleeve_silhouette_risk',
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
  'seedream-5.5',
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
  acceptsReferenceImage?: 'outfit' | 'prop' | 'scene' | null;
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
  opensReferenceSlot?: 'outfit' | 'prop' | 'scene' | null;
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
  'seedream-5.5',
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
   * Always true when any photo issue is detected: TWINGS recommends uploading another clean
   * front-facing photo first rather than relying on AI face transformation, which can subtly
   * alter facial likeness.
   */
  preferDirectReupload?: boolean;
  /**
   * When true (occlusion or heavy beauty-app retouching detected), TWINGS generates two parallel
   * identity candidates (Seedream 5.5 + Nano Banana 2.1) and lets the user pick the one that
   * looks most like their real face if they cannot upload another photo.
   */
  requiresDualCandidateSelection?: boolean;
  candidateEngines?: readonly DualIdentityCandidateEngine[] | null;
  candidatePromptsEn?: Record<DualIdentityCandidateEngine, string> | null;
}

export interface PhotoSuitabilityDiagnosis {
  isSuitable: boolean;
  /** True whenever any issue is present: direct re-upload of a clean photo is always preferred over AI face transformation. */
  recommendDirectReupload: boolean;
  /** Always false: TWINGS never forces or defaults to AI face transformation on user selfies. */
  aiFaceTransformRecommendedByDefault: false;
  issueCategory:
    | 'none'
    | 'occlusion'
    | 'beauty_retouch'
    | 'angle_or_framing'
    | 'quality_or_lighting';
  whyUnsuitableKo: string | null;
  whyUnsuitableEn: string | null;
  reuploadTipKo: string | null;
  reuploadTipEn: string | null;
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
  | 'seedream-5.5'
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
  /** Target synthesis engine for model-specific prompt optimization (defaults to 'seedream-5.5' or 'nano-banana-2.1'). */
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
  /** Server-only fallback prompt formatted specifically for the secondary engine (e.g. Seedream 5.5 <-> Nano Banana 2.1). */
  fallbackMasterPromptEn: OpaqueCompiledPrompt;
  /** Parallel dual-candidate prompts (Seedream 5.5 + Nano Banana 2.1) so the user can pick the closest likeness. */
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
  /** Native video audio preference (`ambient` = natural voice/foley only; `bgm` = Hydrogen scene-matched score). */
  audioMode?: PersonalAudioMode;
  bgmMood?: PersonalBgmMood | null;
}

export const personalDirectorSpecSchema = z.object({
  userMessage: z.string().trim().max(1000).nullable().optional(),
  summaryChips: z
    .array(
      z.object({
        slot: z.enum(DIRECTOR_EDITABLE_SLOTS),
        labelKo: z.string().trim().min(1).max(60),
        summaryKo: z.string().trim().min(1).max(200),
      }),
    )
    .max(8)
    .optional(),
  audioMode: z.enum(PERSONAL_AUDIO_MODES).optional().default('ambient'),
  bgmMood: z.enum(PERSONAL_BGM_MOODS).nullable().optional(),
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
            actionEn: z.string().trim().min(1).max(500),
          }),
        )
        .max(4),
      strictExclusionsEn: z.array(z.string().trim().min(1).max(120)).max(12),
    })
    .nullable()
    .optional(),
  slotOverrides: z.array(z.enum(CUSTOM_DIRECTOR_REF_SLOTS)).max(3).optional(),
});

export type PersonalDirectorSpec = z.infer<typeof personalDirectorSpecSchema>;

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
 * via text or reference photo without internal technical jargon.
 */
export const DEFAULT_EDITORIAL_TEMPLATE_BASELINE: TemplateBaselineSpec = {
  templateArchetypeId: 'default-editorial',
  titleKo: '이 템플릿의 고정 연출 · 맞춤 변경 범위',
  titleEn: 'Locked Direction & Customizable Scope',
  lockedElementsKo: [
    '카메라 렌즈 · 컷 전환 리듬',
    '공간 배경 · 조명 무드',
    '장면 타이밍 · 입 모양 립싱크 리듬'
  ],
  lockedElementsEn: [
    'Camera lens & cut rhythm',
    'Scene backdrop & lighting mood',
    'Shot pacing & lip-sync timing'
  ],
  baselineSlots: [
    {
      slot: 'outfit',
      labelKo: '기본 착장',
      labelEn: 'Default Outfit',
      defaultSettingKo: '템플릿 시그니처 착장 (시안의 기본 의상 적용)',
      defaultSettingEn: 'Template signature wardrobe',
      customizableHintKo: '원하는 옷 사진을 올리거나 텍스트로 드레스·수트·자켓 스타일을 지정할 수 있어요',
      customizableHintEn: 'Attach an outfit reference photo or describe your desired look',
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
      id: 'makeup-no-pink-blush',
      slot: 'makeup',
      labelKo: '핑크 블러셔·립 빼고 창백하지 않은 피부 톤',
      labelEn: 'No pink blush · warm matte complexion',
      reasonBadgeKo: '플래시 핑크기 차단',
      reasonBadgeEn: 'Flash tone lock',
      samplePromptKo:
        '볼터치나 입술에 인위적인 핑크기가 돌지 않게 하고, 플래시 조명에서도 하얗게 뜨지 않는 차분한 웜 매트 피부결과 자연스러운 입술 톤으로 맞춰 줘',
      samplePromptEn:
        'Remove any pink blush or pink lip tint and keep a warm matte-satin complexion with natural muted lip colour under flash lighting'
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
      labelKo: '내가 올린 의상 레퍼런스 그대로 입히기',
      labelEn: 'Wear my uploaded outfit reference',
      reasonBadgeKo: '직접 이미지 업로드',
      reasonBadgeEn: 'Direct photo upload',
      samplePromptKo: '기본 착장 대신 첨부한 의상 레퍼런스 사진의 옷 실루엣과 컬러로 전 컷 동일하게 갈아입혀 줘',
      samplePromptEn: 'Dress me in the exact garment silhouette and colour from my uploaded outfit photo across every shot',
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
      id: 'framing-bust-breathing-room',
      slot: 'shot_action',
      labelKo: '얼굴 클로즈업 부담 완화 · 여유 있는 상반신 구도',
      labelEn: 'Balanced bust-up framing without tight closeup',
      reasonBadgeKo: '얼빡 부담 완화',
      reasonBadgeEn: 'Breathing room',
      samplePromptKo:
        '얼굴이 화면에 너무 꽉 차게 클로즈업되지 않도록 어깨선과 상반신 여유 공간이 자연스럽게 보이는 바스트샷 거리감을 유지해 줘',
      samplePromptEn:
        'Avoid overly tight extreme face closeups and maintain comfortable bust-up framing with natural shoulder and headroom'
    },
    {
      id: 'prop-user-product-ref',
      slot: 'prop',
      labelKo: '내 제품·소품 레퍼런스 자연스럽게 들려주기',
      labelEn: 'Hold my uploaded product reference',
      reasonBadgeKo: '직접 이미지 업로드',
      reasonBadgeEn: 'Direct photo upload',
      samplePromptKo: '기존 소품은 빼고 첨부한 제품·소품 레퍼런스 사진을 실제 손 크기에 맞춰 자연스럽게 들려줘',
      samplePromptEn: 'Remove the default prop and hold the uploaded product reference at true hand scale',
      opensReferenceSlot: 'prop'
    },
    {
      id: 'silhouette-slim-arms-collarbone',
      slot: 'outfit',
      labelKo: '셀카 속 넓은 소매 부피 무시 · 슬림한 팔·어깨 라인 고정',
      labelEn: 'Ignore wide selfie sleeves · lock slender arm & collarbone silhouette',
      reasonBadgeKo: '팔뚝 부피 왜곡 차단',
      reasonBadgeEn: 'Slender arm lock',
      samplePromptKo:
        '셀카 사진 속 상의나 넓은 소매 부피는 완전히 무시하고, 원래 체형처럼 여리여리하고 슬림한 어깨·쇄골·팔 라인으로 착장이 자연스럽게 핏되게 해 줘',
      samplePromptEn:
        'Completely ignore any wide blouse sleeves or bulky top from my selfie and maintain naturally slender shoulders, collarbones, and slim arms'
    },
    {
      id: 'hair-updo-lowbun-sync',
      slot: 'hair',
      labelKo: '묶은 머리(로우번)·단발 전 컷 풀림 방지 고정',
      labelEn: 'Lock sleek low-bun / bob across every cut without untying',
      reasonBadgeKo: '전 컷 헤어 고정',
      reasonBadgeEn: 'Multi-shot hair lock',
      samplePromptKo:
        '내 사진 속 깔끔하게 묶은 로우번(또는 단발) 스타일이 중간 컷에서 긴 머리로 풀리지 않도록 첫 컷부터 마지막 컷까지 동일하게 고정해 줘',
      samplePromptEn:
        'Keep my sleek tied low-bun (or bob) hairstyle strictly locked across every shot without ever untying into loose long hair'
    },
    {
      id: 'skin-zero-mole-matte',
      slot: 'makeup',
      labelKo: '번들거림·원치 않는 점 없는 맑은 매트 새틴 피부결',
      labelEn: 'Matte-satin skin with zero artificial moles or oily glare',
      reasonBadgeKo: '피부 잡티·광택 차단',
      reasonBadgeEn: 'Clean skin lock',
      samplePromptKo:
        '피부가 기름지게 번들거리거나 얼굴·목에 원래 없는 점·잡티가 생기지 않도록 깨끗하고 맑은 매트 새틴 피부결로 유지해 줘',
      samplePromptEn:
        'Keep a clean matte-satin complexion with zero oily plastic shine and zero artificial moles, beauty marks, or blemishes on face or neck'
    }
  ]
};

export const TEMPLATE_BASELINE_PRESETS: Readonly<Record<string, TemplateBaselineSpec>> = {
  'default-editorial': DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
  'fashion-runway-walk': {
    ...DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
    templateArchetypeId: 'fashion-runway-walk',
    titleKo: '하이패션 런웨이 워킹 · 기본 설정 안내',
    titleEn: 'High-Fashion Runway Walk · Baseline Guide',
    lockedElementsKo: [
      '85mm 망원 런웨이 트래킹 · 프론트 로우 플래시 세례',
      '다크 스튜디오 바닥 반사광 & 모델 워킹 리듬',
      '힐 구두 발걸음 · 카메라 셔터 현장 음향'
    ],
    lockedElementsEn: [
      '85mm telephoto runway tracking & front-row flashes',
      'Dark studio floor reflections & runway stride rhythm',
      'Live heel footsteps & press shutter acoustics'
    ],
    baselineSlots: [
      {
        slot: 'outfit',
        labelKo: '기본 착장 · 체형 핏',
        labelEn: 'Default Outfit & Silhouette Fit',
        defaultSettingKo: '시그니처 런웨이 드레스 (셀카 소매 부피 무시 · 슬림한 팔·쇄골 핏 자동 보정)',
        defaultSettingEn: 'Signature runway look (wide selfie sleeves ignored · slender arm fit locked)',
        customizableHintKo: '내 전신 의상 레퍼런스를 올리면 목선 아래 의상과 신발만 1:1로 갈아입혀요',
        customizableHintEn: 'Attach an outfit photo for a strict neck-down wardrobe swap while keeping your face',
        acceptsReferenceImage: 'outfit'
      },
      {
        slot: 'makeup',
        labelKo: '기본 메이크업 · 피부결',
        labelEn: 'Default Makeup & Skin',
        defaultSettingKo: '번들거림 없는 매트 새틴 피부결 · 얼굴/목 임의 점 생성 차단',
        defaultSettingEn: 'Matte-satin skin texture with zero random moles or oily glare',
        customizableHintKo: '내 평소 데일리 메이크업과 자연스러운 입술 컬러로 유지할 수 있어요',
        customizableHintEn: 'Keep your natural daily makeup and lip tone',
        acceptsReferenceImage: null
      },
      {
        slot: 'hair',
        labelKo: '기본 헤어 · 전 컷 동기화',
        labelEn: 'Default Hair & Multi-Shot Sync',
        defaultSettingKo: '내 사진 속 헤어스타일(로우번/단발/생머리) 전 컷 풀림 없이 동기화',
        defaultSettingEn: 'Your selfie hairstyle synchronized across all cuts without untying',
        customizableHintKo: '묶은 머리 고정이나 잔머리·앞머리 디테일 유지를 지정할 수 있어요',
        customizableHintEn: 'Lock your low-bun, bob, or bangs across every runway cut',
        acceptsReferenceImage: null
      },
      {
        slot: 'shot_action',
        labelKo: '기본 시선 · 워킹 표정',
        labelEn: 'Default Gaze & Runway Poise',
        defaultSettingKo: '입을 다문 당당한 런웨이 포커페이스 · 흔들림 없는 정면 시선',
        defaultSettingEn: 'Composed closed-lip runway poise & steady forward gaze',
        customizableHintKo: '여유로운 반미소나 부드러운 눈빛으로 인상을 완화할 수 있어요',
        customizableHintEn: 'Soften into a relaxed half-smile at the runway turn',
        acceptsReferenceImage: null
      }
    ]
  },
  'beauty-grwm-skincare': {
    ...DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
    templateArchetypeId: 'beauty-grwm-skincare',
    titleKo: '뷰티 스킨케어 · 겟레디윗미(GRWM) 기본 설정 안내',
    titleEn: 'Beauty Skincare & GRWM · Baseline Guide',
    lockedElementsKo: [
      '자연광 뷰티 룸 조명 · 매크로 피부 디테일 컷 전환',
      '제품 클로즈업 → 볼 밀착 → 거울 미소 5컷 리듬',
      '배경음악(BGM) 없는 실제 제형 터치음 · 수분 밀착 현장 사운드'
    ],
    lockedElementsEn: [
      'Soft daylight beauty lighting & macro skin cut rhythm',
      '5-cut product macro -> cheek application -> mirror smile flow',
      'Strict No-BGM tactile skincare application & room foley'
    ]
  },
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
        customizableHintKo: '오프화이트 블레이저·셔츠 룩이나 내가 올린 의상 레퍼런스 사진으로 바꿀 수 있어요',
        customizableHintEn: 'Swap to an off-white blazer look or attach your own outfit reference photo',
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
      '11초 현장 셔터음 · 다국어 기자 콜 사운드'
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
        customizableHintKo: '목 스카프를 뺀 여배우 블랙 새틴 드레스나 내 의상 레퍼런스 사진으로 바꿀 수 있어요',
        customizableHintEn: 'Switch to a strapless black satin actress gown or upload your outfit photo',
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
  if (key.includes('runway') || key.includes('catwalk') || key.includes('fashion-walk')) {
    return TEMPLATE_BASELINE_PRESETS['fashion-runway-walk'] ?? DEFAULT_EDITORIAL_TEMPLATE_BASELINE;
  }
  if (key.includes('grwm') || key.includes('collagen') || key.includes('skincare') || key.includes('beauty')) {
    return TEMPLATE_BASELINE_PRESETS['beauty-grwm-skincare'] ?? DEFAULT_EDITORIAL_TEMPLATE_BASELINE;
  }
  return DEFAULT_EDITORIAL_TEMPLATE_BASELINE;
}

/**
 * Deterministic self-inspection diagnosis explaining why an uploaded selfie is unsuitable
 * and recommending a direct photo re-upload FIRST (avoiding AI face transformation by default).
 */
export function diagnosePhotoSuitability(
  issues: readonly PhotoIssueCode[],
  faceWidthRatio = 0.35
): PhotoSuitabilityDiagnosis {
  const hasOcclusion = issues.some(
    (code) => code === 'hand_occlusion' || code === 'prop_occlusion' || code === 'hair_occlusion'
  );
  const hasRetouch = issues.some(
    (code) => code === 'over_retouched_contour' || code === 'heavy_filter'
  );
  const hasWideSleeveSilhouetteRisk = issues.includes('wide_sleeve_silhouette_risk');
  const hasAngleOrFraming =
    hasWideSleeveSilhouetteRisk ||
    issues.some(
      (code) =>
        code === 'angle_extreme' ||
        code === 'multiple_faces' ||
        code === 'tight_crop' ||
        code === 'wide_crop' ||
        code === 'wide_angle_distortion' ||
        code === 'asymmetrical_shoulders' ||
        code === 'bare_shoulder_id_crop'
    ) ||
    faceWidthRatio < 0.22 ||
    faceWidthRatio > 0.54;

  const hasQualityOrLight = issues.some(
    (code) => code === 'low_resolution' || code === 'motion_blur' || code === 'harsh_lighting'
  );

  if (!hasOcclusion && !hasRetouch && !hasAngleOrFraming && !hasQualityOrLight) {
    return {
      isSuitable: true,
      recommendDirectReupload: false,
      aiFaceTransformRecommendedByDefault: false,
      issueCategory: 'none',
      whyUnsuitableKo: null,
      whyUnsuitableEn: null,
      reuploadTipKo: null,
      reuploadTipEn: null
    };
  }

  if (hasOcclusion) {
    return {
      isSuitable: false,
      recommendDirectReupload: true,
      aiFaceTransformRecommendedByDefault: false,
      issueCategory: 'occlusion',
      whyUnsuitableKo:
        '얼굴이나 턱선 주변에 손·소품·머리카락 가림이 감지되었어요. 가려진 부위를 AI 이미지 변형으로 채우면 내 원래 인상과 미묘하게 달라질 수 있어요.',
      whyUnsuitableEn:
        'A hand, object, or hair partially covers the face or jawline. AI-reconstructing hidden facial features can subtly alter your likeness.',
      reuploadTipKo:
        'AI 얼굴 변형 없이 100% 내 실물 그대로 가장 잘 나오도록, 손이나 물건이 얼굴을 가리지 않은 정면 사진을 직접 다시 업로드하는 것을 추천드려요.',
      reuploadTipEn:
        'For 100% authentic likeness without AI face modification, we strongly recommend uploading another clear front-facing photo.'
    };
  }

  if (hasRetouch) {
    return {
      isSuitable: false,
      recommendDirectReupload: true,
      aiFaceTransformRecommendedByDefault: false,
      issueCategory: 'beauty_retouch',
      whyUnsuitableKo:
        '뷰티앱 윤곽 보정(턱선·입술) 또는 강한 필터가 감지되었어요. 3D 영상에서 말을 하거나 고개를 돌릴 때 보정된 부위가 어색해 보이거나 AI 보정 시 인상이 달라질 수 있어요.',
      whyUnsuitableEn:
        'Heavy beauty-app contour/lip retouching or filter detected. In 3D motion, heavy 2D retouching or AI re-generation can look unnatural.',
      reuploadTipKo:
        'AI 얼굴 변형을 거치지 않고 가장 자연스럽게 제작되도록, 뷰티 필터가 적은 기본 카메라 정면 사진을 직접 다시 업로드하는 것을 추천드려요.',
      reuploadTipEn:
        'To avoid AI face transformation and get the most natural motion, we recommend uploading an unretouched standard-camera front photo.'
    };
  }

  if (hasAngleOrFraming) {
    if (hasWideSleeveSilhouetteRisk) {
      return {
        isSuitable: false,
        recommendDirectReupload: true,
        aiFaceTransformRecommendedByDefault: false,
        issueCategory: 'angle_or_framing',
        whyUnsuitableKo:
          '상의의 넓은 퍼프·벌룬 소매가 어깨선까지 크게 찍혀 있어, 드레스나 민소매 착장 영상에서 팔뚝 부피가 실제보다 두껍게 해석될 수 있어요.',
        whyUnsuitableEn:
          'Wide blouse or puff sleeves in the selfie may cause sleeveless or fitted outfits to render with thicker upper arms.',
        reuploadTipKo:
          '어깨선이 깔끔하게 드러나는 상반신 사진을 다시 올리시거나, 그대로 진행하시면 TWINGS가 얼굴·목선 위주로 크롭하고 슬림한 팔 라인 고정 규칙을 자동으로 적용해 드려요.',
        reuploadTipEn:
          'Upload a photo with clean shoulder lines, or proceed and TWINGS will automatically apply a head-and-neck crop and slender arm lock.'
      };
    }
    return {
      isSuitable: false,
      recommendDirectReupload: true,
      aiFaceTransformRecommendedByDefault: false,
      issueCategory: 'angle_or_framing',
      whyUnsuitableKo:
        '고개가 측면으로 많이 돌아가 있거나 얼굴이 화면에 너무 가깝거나(광각 왜곡) 작게 찍혀 있어, 반대쪽 이목구비를 AI가 추측하면 안 닮게 나올 수 있어요.',
      whyUnsuitableEn:
        'Extreme head angle or close/distant framing detected. Guessing unseen facial angles can reduce likeness.',
      reuploadTipKo:
        '카메라를 정면으로 바라보고 어깨선이 자연스럽게 나오는 상반신 독사진으로 다시 업로드하는 것을 추천드려요.',
      reuploadTipEn:
        'We recommend uploading a front-facing bust-up solo photo with both eyes and shoulders clearly visible.'
    };
  }

  return {
    isSuitable: false,
    recommendDirectReupload: true,
    aiFaceTransformRecommendedByDefault: false,
    issueCategory: 'quality_or_lighting',
    whyUnsuitableKo:
      '사진 해상도가 낮거나 흔들림·강한 역광이 있어 영상에서 눈매와 피부 결이 흐릿하거나 다르게 표현될 수 있어요.',
    whyUnsuitableEn:
      'Low resolution, motion blur, or harsh lighting may cause facial details to look soft or altered in video.',
    reuploadTipKo:
      '밝은 실내나 자연광에서 찍은 선명한 정면 사진을 직접 다시 업로드하시면 훨씬 또렷하고 나답게 완성돼요.',
    reuploadTipEn:
      'Uploading a sharp, evenly lit front-facing photo will preserve your exact features much more clearly.'
  };
}

/**
 * Safely parses `PersonalDirectorSpec` from JSON strings (FormData) or DB `jsonb` values.
 * Returns null when absent, empty, or malformed.
 */
export function parseDirectorSpecInput(raw: unknown): PersonalDirectorSpec | null {
  if (raw === null || raw === undefined) return null;
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  const parsed = personalDirectorSpecSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
