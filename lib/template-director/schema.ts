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

export const DIRECTOR_EDITABLE_SLOTS = ['hair', 'outfit', 'prop', 'shot_action', 'lighting_mood'] as const;
export type DirectorEditableSlot = (typeof DIRECTOR_EDITABLE_SLOTS)[number];

export const CLEANUP_MODES = [
  'none',
  'inpaint_occlusion',
  'normalize_retouch',
  'restore_detail',
  'prompt_strict_lock_only'
] as const;
export type CleanupMode = (typeof CLEANUP_MODES)[number];

export const CLEANUP_ENGINES = ['nano-banana-2.1', 'seedream-5.0-pro', 'seedvr2-local'] as const;
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

export interface MultiPhotoIdentityInput {
  photos: ReadonlyArray<{
    bytes: Uint8Array;
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
    filename?: string;
  }>;
  /** Optional creator or user feedback (e.g., "이마 조금 줄이고 턱선 둥글게"). */
  creatorNoteKo?: string | null;
}

export interface OpticalIdentityMasterPlan {
  /** 0-based index of the photo that best represents preferred hairstyle, bangs, and facial charm. */
  styleAnchorIndex: number;
  /** 0-based index of the photo that best represents true frontal bone symmetry, nose, and eye spacing. */
  structureAnchorIndex: number;
  detectedIssues: PhotoIssueCode[];
  requiresMasterSynthesis: boolean;
  engine: 'nano-banana-2.1';
  extractedIdentityLockEn: string;
  extractedHairLockEn: string;
  /** Server-only prompt fed to Nano Banana 2.1 in the background to synthesize the 85mm optical master portrait. */
  opticalMasterPromptEn: OpaqueCompiledPrompt;
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
  styleAnchorIndex: z.number().int().min(0).max(7),
  structureAnchorIndex: z.number().int().min(0).max(7),
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
  opticalMasterPromptEn: z.string().trim().min(40).max(1600)
});
