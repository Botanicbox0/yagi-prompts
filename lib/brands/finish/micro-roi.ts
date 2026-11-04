import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '@/lib/brands/entitlements';
import type { BrandOutcome, BrandRole } from '@/lib/brands/workspace/types';
import { confirmedIdentityFor, recordMemory } from '@/lib/brands/identity/service';
import {
  LOCAL_FIX_REFERENCE_KINDS,
  STRUCTURAL_SEAM_KINDS,
  type LocalFixReferenceKind,
  type StructuralSeamKind
} from './local-fix';
import {
  createWorkstationFinishTask,
  type WorkstationFinishTask
} from './worker';

/**
 * AMERICANO & TWINGS 5-Step Micro-ROI Crop → Pixel-Locked Edit → Deterministic CV Composite Harness
 * (`lib/brands/finish/micro-roi.ts` + `scripts/brand-micro-roi-harness.py`).
 *
 * Why Micro-ROI instead of full-canvas image editing:
 * - Full-canvas edits pass the entire frame through the model's tokenizer/decoder, causing 5-15% drift
 *   in untouched facial geometry (eyes, nose, philtrum), allocating only 200-400px to the target region,
 *   and shifting global skin/lighting tone.
 * - This harness never grants the generative model ownership of the full canvas. The model acts strictly
 *   as a high-resolution patch generator (1400-1600px working canvas) on a small bounding box `(x0, y0, x1, y1)`,
 *   followed by local OpenCV subpixel registration (ECC Affine or 5-Point / MediaPipe 478-Point Rigid Similarity),
 *   frequency-separated / LAB L-median tone locking, and an inward zero-leak feather mask (`alpha < 0.012 -> 0`,
 *   `outside_pixels_changed === 0`).
 */

export const MICRO_ROI_MODES = [
  'micro_patch_ecc',
  'logo_mark_lock',
  'face_detail_refine',
  'face_identity_inward',
  'expression_au_retake',
  'product_geometry_lock'
] as const;

export type MicroRoiMode = (typeof MICRO_ROI_MODES)[number];

export const MICRO_ROI_PATCH_ENGINES = [
  'nano-banana-pro',
  'nano-banana-2.1',
  'gpt-image-2.5'
] as const;

export type MicroRoiPatchEngine = (typeof MICRO_ROI_PATCH_ENGINES)[number];

export const MICRO_ROI_ALIGNMENT_METHODS = [
  'ecc_affine',
  'rigid_5point_lmeds',
  'mediapipe_action_units'
] as const;

export type MicroRoiAlignmentMethod =
  (typeof MICRO_ROI_ALIGNMENT_METHODS)[number];

export const MICRO_ROI_TONE_LOCK_METHODS = [
  'frequency_separated_keep_tone',
  'lab_skin_l_median_and_keep_tone',
  'lab_foreground_exposure_match'
] as const;

export type MicroRoiToneLockMethod =
  (typeof MICRO_ROI_TONE_LOCK_METHODS)[number];

export const MICRO_ROI_MATTE_METHODS = [
  'soft_box_gaussian',
  'inset_rect_feather',
  'shared_skin_inward_distance',
  'mediapipe_convex_hull_au'
] as const;

export type MicroRoiMatteMethod = (typeof MICRO_ROI_MATTE_METHODS)[number];

/**
 * MediaPipe 478-point landmark indices ported from `expression_retake.py` and `face_swap_composite.py`.
 */
export const MEDIAPIPE_RIGHT_EYE_BROW: readonly number[] = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  46, 53, 52, 65, 55, 70, 63, 105, 66, 107
] as const;

export const MEDIAPIPE_LEFT_EYE_BROW: readonly number[] = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388,
  466, 276, 283, 282, 295, 285, 336, 296, 334, 293, 300
] as const;

export const MEDIAPIPE_MOUTH: readonly number[] = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317,
  14, 87, 178, 88, 95, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415
] as const;

export const MEDIAPIPE_FACE_OVAL: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162,
  21, 54, 103, 67, 109
] as const;

export const DENSE_FACE_COMPATIBILITY_GATES = {
  postwarpRmsMaxIod: 0.18,
  expressionRetakeRmsMaxIod: 0.10,
  featureRmsMaxIod: 0.048,
  featureP95MaxIod: 0.070,
  mouthRmsMaxIod: 0.052,
  faceOvalRmsMaxIod: 0.070,
  sharedSkinMinIou: 0.70,
  sharedSkinMinTargetCoverage: 0.78,
  zeroLeakAlphaFloor: 0.012
} as const;

export interface MicroRoiModeSpec {
  mode: MicroRoiMode;
  code: string;
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  defaultCanvasPx: 1400 | 1440 | 1600;
  defaultTemperature: number;
  alignmentMethod: MicroRoiAlignmentMethod;
  toneLockMethod: MicroRoiToneLockMethod;
  matteMethod: MicroRoiMatteMethod;
  requiresConsentedIdentity: boolean;
  requiresIsolatedMarkReference: boolean;
  defaultMaskInset: {
    mx0: number;
    my0: number;
    mx1: number;
    my1: number;
    blurFrac: number;
  };
}

export const MICRO_ROI_MODE_SPECS: Record<MicroRoiMode, MicroRoiModeSpec> = {
  micro_patch_ecc: {
    mode: 'micro_patch_ecc',
    code: 'M1_ECC_PATCH',
    titleKo: '극소 부위 패치 복원 (손·의류·피부·배경)',
    titleEn: 'Micro-ROI Patch Repair (Hand / Garment / Skin / Artifact)',
    summaryKo:
      '180~400px 국소 영역을 1440px로 확대 편집한 뒤 정밀 정렬과 주변 톤 맞춤으로 티 나지 않게 합성합니다.',
    summaryEn:
      'Upscales a 180-400px local crop to 1440px, then composites via precision alignment and seamless tone matching.',
    defaultCanvasPx: 1440,
    defaultTemperature: 0.25,
    alignmentMethod: 'ecc_affine',
    toneLockMethod: 'frequency_separated_keep_tone',
    matteMethod: 'soft_box_gaussian',
    requiresConsentedIdentity: false,
    requiresIsolatedMarkReference: false,
    defaultMaskInset: { mx0: 0.09, my0: 0.09, mx1: 0.91, my1: 0.91, blurFrac: 0.024 }
  },
  logo_mark_lock: {
    mode: 'logo_mark_lock',
    code: 'M2_LOGO_MARK_LOCK',
    titleKo: '브랜드 로고·심볼·라벨 정밀 복원',
    titleEn: 'Brand Logo, Mark & Typography Lock',
    summaryKo:
      '단독 로고 원본만 참조해 1440px에서 선명하게 다시 그린 뒤, 원본 로고 크기와 중심 위치에 정확히 맞춰 합성합니다.',
    summaryEn:
      'Re-renders the mark at 1440px using an isolated logo reference and locks exact original mark height and centre.',
    defaultCanvasPx: 1440,
    defaultTemperature: 0.2,
    alignmentMethod: 'ecc_affine',
    toneLockMethod: 'frequency_separated_keep_tone',
    matteMethod: 'soft_box_gaussian',
    requiresConsentedIdentity: false,
    requiresIsolatedMarkReference: true,
    defaultMaskInset: { mx0: 0.36, my0: 0.33, mx1: 0.68, my1: 0.70, blurFrac: 0.018 }
  },
  face_detail_refine: {
    mode: 'face_detail_refine',
    code: 'M3_FACE_REFINE',
    titleKo: '전신·화보 얼굴 피부결 디테일 복원',
    titleEn: 'Full-Body Face Micro-Texture Refinement',
    summaryKo:
      '전신 샷의 작은 얼굴 박스를 1400px로 확대해 사전 동의 인물 앵커 기준의 실제 피부결·홍채·속눈썹 디테일만 복원합니다.',
    summaryEn:
      'Upscales the face crop from a full-body shot to 1400px to restore non-uniform skin pores, iris catchlights, and eyelashes.',
    defaultCanvasPx: 1400,
    defaultTemperature: 0.2,
    alignmentMethod: 'ecc_affine',
    toneLockMethod: 'lab_skin_l_median_and_keep_tone',
    matteMethod: 'inset_rect_feather',
    requiresConsentedIdentity: true,
    requiresIsolatedMarkReference: false,
    defaultMaskInset: { mx0: 0.12, my0: 0.12, mx1: 0.88, my1: 0.88, blurFrac: 0.06 }
  },
  face_identity_inward: {
    mode: 'face_identity_inward',
    code: 'M4_FACE_INWARD_SWAP',
    titleKo: '동적 4:5 크롭 · 5점 강체 정렬 · 내향 마스크 얼굴 복원',
    titleEn: 'Dynamic 4:5 Crop · 5-Point Rigid Align · Inward Matte',
    summaryKo:
      '1600px 동적 크롭 후 5점 강체 유사 변환(RMS ≤ 0.18 IOD)과 MediaPipe 478점 호환성 검사를 통과한 후보만 LAB 노출 보정 및 내향 거리 변환 마스크로 합성합니다.',
    summaryEn:
      '1600px dynamic crop, 5-point LMEDS rigid similarity transform, MediaPipe 478-point gate, LAB L-median match, and inward distance feather.',
    defaultCanvasPx: 1600,
    defaultTemperature: 0.3,
    alignmentMethod: 'rigid_5point_lmeds',
    toneLockMethod: 'lab_foreground_exposure_match',
    matteMethod: 'shared_skin_inward_distance',
    requiresConsentedIdentity: true,
    requiresIsolatedMarkReference: false,
    defaultMaskInset: { mx0: 0.10, my0: 0.10, mx1: 0.90, my1: 0.90, blurFrac: 0.035 }
  },
  expression_au_retake: {
    mode: 'expression_au_retake',
    code: 'M5_EXPRESSION_AU_RETAKE',
    titleKo: 'MediaPipe 478점 국소 표정 리테이크 (눈·눈썹·입매 전용)',
    titleEn: 'MediaPipe 478-Point Expression Action-Unit Retake',
    summaryKo:
      '눈·눈썹(RIGHT/LEFT_EYE_BROW)과 입매(MOUTH) 3개 근육군만 국소 아핀 정렬·합성하고 얼굴형·코·볼·턱선·조명은 100% 원본 픽셀을 유지합니다.',
    summaryEn:
      'Locally aligns and composites only RIGHT_EYE_BROW, LEFT_EYE_BROW, and MOUTH while keeping skull, nose, cheeks, and jaw 100% original.',
    defaultCanvasPx: 1600,
    defaultTemperature: 0.25,
    alignmentMethod: 'mediapipe_action_units',
    toneLockMethod: 'lab_foreground_exposure_match',
    matteMethod: 'mediapipe_convex_hull_au',
    requiresConsentedIdentity: true,
    requiresIsolatedMarkReference: false,
    defaultMaskInset: { mx0: 0.14, my0: 0.14, mx1: 0.86, my1: 0.86, blurFrac: 0.035 }
  },
  product_geometry_lock: {
    mode: 'product_geometry_lock',
    code: 'M6_PRODUCT_GEOMETRY_LOCK',
    titleKo: '제품 용기·패키지 구조선 보존 국소 복원',
    titleEn: 'Product Vessel & Packaging Micro-ROI Repair',
    summaryKo:
      '병 어깨선·림·바닥 접지면 등 구조선을 피해 평탄한 영역으로 크롭 경계를 잡고 1440px ECC 정렬 및 주파수 분리로 합성합니다.',
    summaryEn:
      'Routes crop boundaries through flat regions away from bottle shoulders/rims, then composites at 1440px via ECC and keep_tone.',
    defaultCanvasPx: 1440,
    defaultTemperature: 0.2,
    alignmentMethod: 'ecc_affine',
    toneLockMethod: 'frequency_separated_keep_tone',
    matteMethod: 'soft_box_gaussian',
    requiresConsentedIdentity: false,
    requiresIsolatedMarkReference: false,
    defaultMaskInset: { mx0: 0.08, my0: 0.08, mx1: 0.92, my1: 0.92, blurFrac: 0.022 }
  }
};

/**
 * Step 1: Bounding Box Crop & Full-Canvas LANCZOS4 Upscale Plan (`box = (x0, y0, x1, y1)`).
 */
export const MicroRoiCropBoxSchema = z
  .object({
    imageWidth: z.number().int().min(64).max(16384),
    imageHeight: z.number().int().min(64).max(16384),
    x0: z.number().int().min(0),
    y0: z.number().int().min(0),
    x1: z.number().int().min(1),
    y1: z.number().int().min(1),
    mode: z.enum(MICRO_ROI_MODES).default('micro_patch_ecc'),
    targetCanvasPx: z.number().int().min(512).max(4096).optional(),
    crossedSeams: z.array(z.enum(STRUCTURAL_SEAM_KINDS)).default([]),
    maskInset: z
      .object({
        mx0: z.number().min(0.01).max(0.49),
        my0: z.number().min(0.01).max(0.49),
        mx1: z.number().min(0.51).max(0.99),
        my1: z.number().min(0.51).max(0.99),
        blurFrac: z.number().min(0.005).max(0.15)
      })
      .optional()
  })
  .superRefine((data, ctx) => {
    if (data.x1 <= data.x0 || data.y1 <= data.y0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x1'],
        message: 'Crop box x1/y1 must be strictly greater than x0/y0.'
      });
    }
    if (data.x1 > data.imageWidth || data.y1 > data.imageHeight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x1'],
        message: 'Crop box exceeds source image dimensions.'
      });
    }
    if (data.crossedSeams.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['crossedSeams'],
        message: `Crop/mask boundary must not cross structural seams (${data.crossedSeams.join(', ')}). Expand box into flat skin, hair, or background.`
      });
    }
  });

export type MicroRoiCropBoxInput = z.input<typeof MicroRoiCropBoxSchema>;

export interface MicroRoiStep1CropPlan {
  mode: MicroRoiMode;
  box: { x0: number; y0: number; x1: number; y1: number };
  cropWidth: number;
  cropHeight: number;
  normalizedBox: { fx0: number; fy0: number; fx1: number; fy1: number };
  upscaleLongEdgePx: number;
  canvasWidth: number;
  canvasHeight: number;
  upscaleFactor: number;
  interpolationUp: 'LANCZOS4';
  interpolationDown: 'INTER_AREA';
  maskInset: {
    mx0: number;
    my0: number;
    mx1: number;
    my1: number;
    blurFrac: number;
  };
}

export function computeMicroRoiCropPlan(
  raw: MicroRoiCropBoxInput
):
  | { ok: true; plan: MicroRoiStep1CropPlan }
  | { ok: false; code: 'invalid_crop_box'; message: string } {
  const parsed = MicroRoiCropBoxSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_crop_box',
      message: parsed.error.issues[0]?.message ?? 'Invalid Micro-ROI crop box.'
    };
  }
  const v = parsed.data;
  const spec = MICRO_ROI_MODE_SPECS[v.mode];
  const cropWidth = v.x1 - v.x0;
  const cropHeight = v.y1 - v.y0;
  const upscaleLongEdgePx = v.targetCanvasPx ?? spec.defaultCanvasPx;
  const maxEdge = Math.max(cropWidth, cropHeight);
  const upscaleFactor =
    Math.round((upscaleLongEdgePx / maxEdge) * 10000) / 10000;

  // For square ECC patch modes (`fix-composite3.py`), canvas is square (e.g. 1440x1440).
  // For proportional face modes (`face_refine.py`, `face_swap_composite.py`), preserve aspect ratio.
  const squareCanvas =
    v.mode === 'micro_patch_ecc' ||
    v.mode === 'logo_mark_lock' ||
    v.mode === 'product_geometry_lock';

  const canvasWidth = squareCanvas
    ? upscaleLongEdgePx
    : Math.round(cropWidth * (upscaleLongEdgePx / maxEdge));
  const canvasHeight = squareCanvas
    ? upscaleLongEdgePx
    : Math.round(cropHeight * (upscaleLongEdgePx / maxEdge));

  return {
    ok: true,
    plan: {
      mode: v.mode,
      box: { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 },
      cropWidth,
      cropHeight,
      normalizedBox: {
        fx0: Math.round((v.x0 / v.imageWidth) * 10000) / 10000,
        fy0: Math.round((v.y0 / v.imageHeight) * 10000) / 10000,
        fx1: Math.round((v.x1 / v.imageWidth) * 10000) / 10000,
        fy1: Math.round((v.y1 / v.imageHeight) * 10000) / 10000
      },
      upscaleLongEdgePx,
      canvasWidth,
      canvasHeight,
      upscaleFactor,
      interpolationUp: 'LANCZOS4',
      interpolationDown: 'INTER_AREA',
      maskInset: v.maskInset ?? spec.defaultMaskInset
    }
  };
}

/**
 * Step 2: Pixel-Locked Edit Prompt & Low-Temperature Patch Generator Spec.
 */
export const MicroRoiEditSpecInputSchema = z.object({
  mode: z.enum(MICRO_ROI_MODES),
  targetDescription: z.string().trim().min(2).max(400),
  referenceKind: z.enum(LOCAL_FIX_REFERENCE_KINDS).default('none'),
  referenceAssetKey: z.string().trim().max(400).optional(),
  patchEngine: z.enum(MICRO_ROI_PATCH_ENGINES).default('nano-banana-pro'),
  aspectRatio: z.enum(['1:1', '4:5', '3:4', '16:9', '9:16']).default('1:1'),
  temperature: z.number().min(0.1).max(0.5).optional(),
  locale: z.enum(['ko', 'en']).default('ko')
});

export type MicroRoiEditSpecInput = z.input<typeof MicroRoiEditSpecInputSchema>;

export interface MicroRoiStep2EditSpec {
  mode: MicroRoiMode;
  prompt: string;
  customerSummary: string;
  referenceKind: LocalFixReferenceKind;
  referenceAssetKey: string | null;
  workerEngineConfig: {
    engine: MicroRoiPatchEngine;
    temperature: number;
    topP: number;
    imageSize: '2K';
    quality: 'high';
    aspectRatio: string;
  };
}

export type MicroRoiEditSpecOutcome =
  | { ok: true; spec: MicroRoiStep2EditSpec }
  | {
      ok: false;
      code:
        | 'full_product_photo_forbidden_for_logo'
        | 'mark_reference_required_for_logo'
        | 'consented_identity_required_for_face'
        | 'invalid_edit_input';
      message: string;
    };

export function buildMicroRoiEditSpec(
  raw: MicroRoiEditSpecInput
): MicroRoiEditSpecOutcome {
  const parsed = MicroRoiEditSpecInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_edit_input',
      message: parsed.error.issues[0]?.message ?? 'Invalid Micro-ROI edit spec.'
    };
  }
  const v = parsed.data;
  const modeSpec = MICRO_ROI_MODE_SPECS[v.mode];

  if (v.mode === 'logo_mark_lock') {
    if (v.referenceKind === 'full_product_photo') {
      return {
        ok: false,
        code: 'full_product_photo_forbidden_for_logo',
        message:
          'Logo mark repair must reference only the isolated mark/graphic (mark_only), never a full product photo.'
      };
    }
    if (v.referenceKind !== 'mark_only') {
      return {
        ok: false,
        code: 'mark_reference_required_for_logo',
        message:
          'Logo mark repair requires an isolated mark_only reference image.'
      };
    }
  }

  if (
    modeSpec.requiresConsentedIdentity &&
    v.referenceKind !== 'consented_identity'
  ) {
    return {
      ok: false,
      code: 'consented_identity_required_for_face',
      message:
        'Face detail refinement, inward identity swap, and expression retake require a pre-consented identity anchor (consented_identity).'
    };
  }

  const temperature = v.temperature ?? modeSpec.defaultTemperature;
  let prompt = '';

  if (v.mode === 'face_detail_refine') {
    // Ported from `D:\dev\Americano\scripts\face_refine.py`
    prompt = [
      "Image 1 is the identity master of this exact person. Image 2 is a cropped, slightly soft close-up of the SAME person's face taken from a larger photograph.",
      'Re-render Image 2 to add realistic skin DETAIL while keeping the subject completely identical: same face structure, same features and proportions, same expression, same eye direction, same hairline and hair, same head angle, same lighting, same background, same framing and crop as Image 2.',
      `Only improve fine detail (${v.targetDescription}): natural NON-UNIFORM skin micro-texture with subtle pores across the T-zone and softer cheeks, sharpen the eyes (clear iris, catchlights, eyelashes), crisp individual hair strands, natural lip texture.`,
      'Matte-to-natural finish, NOT airbrushed, NOT waxy, NOT plastic, NOT over-retouched, no flat eyes, not oversharpened. Keep the exact same crop and composition as Image 2.'
    ].join('\n');
  } else if (
    v.mode === 'face_identity_inward' ||
    v.mode === 'expression_au_retake'
  ) {
    // Ported from `D:\dev\Americano\scripts\face_swap_composite.py`
    prompt = [
      'Image 1 is the target crop to edit. Image 2 is the high-detail face identity and skin texture reference.',
      `Follow Image 1 as the strict two-dimensional geometry authority: keep the exact pixel-level pose, head size, skull angle, hairline connection, neck connection, lighting direction, and background. Target adjustment: ${v.targetDescription}.`,
      'Reconstruct natural high-resolution photographic skin detail: spatially varied subtle pores, natural skin grain, real under-eye texture, realistic lips, and natural eyebrows.',
      'Do not copy Image 2 crop, shoulder framing, background, or lighting. Avoid plastic skin, wax skin, porcelain skin, airbrushing, beauty filter, or changing the person identity.'
    ].join('\n');
  } else if (v.mode === 'logo_mark_lock') {
    // Ported from `morphic-fix3.md` / `fix-composite3.py`
    prompt = [
      'Precision local repair. Image 1 is a small crop from a larger photograph, enlarged.',
      'Keep every element of Image 1 fixed, pixel for pixel: the exact same framing, scale, position, light, colour and grain.',
      `Re-render ONLY ${v.targetDescription} using Reference Image 2 strictly for the isolated mark geometry and stroke proportions. Never copy Reference Image 2 background or surrounding objects.`
    ].join(' ');
  } else {
    // General `micro_patch_ecc` & `product_geometry_lock`
    prompt = [
      'Precision local repair. Image 1 is a small crop from a larger photograph, enlarged.',
      'Keep every element of Image 1 fixed, pixel for pixel: the exact same framing, scale, position, light, colour and grain.',
      `Re-render ONLY ${v.targetDescription}. Do not alter any surrounding texture, edges, or lighting.`
    ].join(' ');
  }

  const customerSummary =
    v.locale === 'ko'
      ? `[${modeSpec.titleKo}] 원본 캔버스 픽셀 고정(temp=${temperature}) · 수정 대상: ${v.targetDescription}`
      : `[${modeSpec.titleEn}] Pixel-locked crop edit (temp=${temperature}) · Target: ${v.targetDescription}`;

  return {
    ok: true,
    spec: {
      mode: v.mode,
      prompt,
      customerSummary,
      referenceKind: v.referenceKind,
      referenceAssetKey: v.referenceAssetKey ?? null,
      workerEngineConfig: {
        engine: v.patchEngine,
        temperature,
        topP: 0.5,
        imageSize: '2K',
        quality: 'high',
        aspectRatio: v.aspectRatio
      }
    }
  };
}

/**
 * Step 3: Subpixel Geometric Registration Validator (ECC Affine & 5-Point / MediaPipe Rigid Similarity).
 */
export const MicroRoiAlignmentEvalInputSchema = z.object({
  method: z.enum(MICRO_ROI_ALIGNMENT_METHODS),
  // ECC fields (`fix-composite3.py`)
  eccScore: z.number().min(-1).max(1).optional(),
  minEccScore: z.number().min(0.5).max(0.99).default(0.88),
  maxShiftPx: z.number().min(0).default(0),
  maxAllowedShiftPx: z.number().min(1).max(40).default(12),
  edgeStripingDetected: z.boolean().default(false),
  // Rigid 5-point / MediaPipe 478-point fields (`face_swap_composite.py`, `expression_retake.py`)
  alignmentScale: z.number().min(0.01).max(10).optional(),
  postwarpRmsIod: z.number().min(0).optional(),
  maxAllowedRmsIod: z.number().min(0.02).max(0.3).optional(),
  denseMetrics: z
    .object({
      featureRmsIod: z.number().min(0),
      featureP95Iod: z.number().min(0),
      mouthRmsIod: z.number().min(0),
      faceOvalRmsIod: z.number().min(0)
    })
    .optional(),
  sharedSkinMetrics: z
    .object({
      iou: z.number().min(0).max(1),
      targetCoverage: z.number().min(0).max(1)
    })
    .optional()
});

export type MicroRoiAlignmentEvalInput = z.input<
  typeof MicroRoiAlignmentEvalInputSchema
>;

export interface MicroRoiStep3AlignmentResult {
  passed: boolean;
  method: MicroRoiAlignmentMethod;
  opticalPrefilterSigma: number;
  actionUnits: readonly ('RIGHT_EYE_BROW' | 'LEFT_EYE_BROW' | 'MOUTH')[];
  reasons: string[];
}

export function evaluateMicroRoiAlignment(
  raw: MicroRoiAlignmentEvalInput
): MicroRoiStep3AlignmentResult {
  const v = MicroRoiAlignmentEvalInputSchema.parse(raw);
  const reasons: string[] = [];

  if (v.edgeStripingDetected) {
    reasons.push(
      'Border striping detected after affine warp; re-select crop box inside a flatter region.'
    );
  }

  let opticalPrefilterSigma = 0;

  if (v.method === 'ecc_affine') {
    const score = v.eccScore ?? 0;
    if (score < v.minEccScore) {
      reasons.push(
        `ECC correlation score (${score.toFixed(4)}) is below minimum required (${v.minEccScore}).`
      );
    }
    if (v.maxShiftPx > v.maxAllowedShiftPx) {
      reasons.push(
        `ECC translation shift (${v.maxShiftPx}px) exceeds maximum allowed (${v.maxAllowedShiftPx}px).`
      );
    }
  } else {
    // `rigid_5point_lmeds` or `mediapipe_action_units`
    const scale = v.alignmentScale ?? 1.0;
    if (scale <= 0.1 || scale >= 3.0) {
      reasons.push(
        `Rigid similarity scale (${scale.toFixed(3)}) is outside valid range (0.1..3.0).`
      );
    } else if (scale < 0.75) {
      // Ported from `face_swap_composite.py`: optical anti-aliasing prefilter before Lanczos4 reduction
      const sigma = Math.max(0, 0.45 * (1.0 / Math.max(scale, 1e-3) - 1.0));
      opticalPrefilterSigma = sigma > 0.15 ? Math.round(sigma * 1000) / 1000 : 0;
    }

    const maxRms =
      v.maxAllowedRmsIod ??
      (v.method === 'mediapipe_action_units'
        ? DENSE_FACE_COMPATIBILITY_GATES.expressionRetakeRmsMaxIod
        : DENSE_FACE_COMPATIBILITY_GATES.postwarpRmsMaxIod);

    const rms = v.postwarpRmsIod ?? 0;
    if (rms > maxRms) {
      reasons.push(
        `Post-warp landmark residual (${rms.toFixed(4)} IOD) exceeds threshold (${maxRms.toFixed(4)} IOD).`
      );
    }

    if (v.denseMetrics) {
      const d = v.denseMetrics;
      if (d.featureRmsIod > DENSE_FACE_COMPATIBILITY_GATES.featureRmsMaxIod) {
        reasons.push(
          `Dense feature RMS (${d.featureRmsIod.toFixed(3)} IOD) exceeds ${DENSE_FACE_COMPATIBILITY_GATES.featureRmsMaxIod} IOD.`
        );
      }
      if (d.featureP95Iod > DENSE_FACE_COMPATIBILITY_GATES.featureP95MaxIod) {
        reasons.push(
          `Dense feature p95 (${d.featureP95Iod.toFixed(3)} IOD) exceeds ${DENSE_FACE_COMPATIBILITY_GATES.featureP95MaxIod} IOD.`
        );
      }
      if (d.mouthRmsIod > DENSE_FACE_COMPATIBILITY_GATES.mouthRmsMaxIod) {
        reasons.push(
          `Dense mouth RMS (${d.mouthRmsIod.toFixed(3)} IOD) exceeds ${DENSE_FACE_COMPATIBILITY_GATES.mouthRmsMaxIod} IOD.`
        );
      }
      if (d.faceOvalRmsIod > DENSE_FACE_COMPATIBILITY_GATES.faceOvalRmsMaxIod) {
        reasons.push(
          `Dense face-oval RMS (${d.faceOvalRmsIod.toFixed(3)} IOD) exceeds ${DENSE_FACE_COMPATIBILITY_GATES.faceOvalRmsMaxIod} IOD.`
        );
      }
    }

    if (v.sharedSkinMetrics) {
      const s = v.sharedSkinMetrics;
      if (
        s.iou < DENSE_FACE_COMPATIBILITY_GATES.sharedSkinMinIou ||
        s.targetCoverage <
          DENSE_FACE_COMPATIBILITY_GATES.sharedSkinMinTargetCoverage
      ) {
        reasons.push(
          `Unsafe shared-skin face oval overlap (IoU=${s.iou.toFixed(3)}, targetCoverage=${s.targetCoverage.toFixed(3)}).`
        );
      }
    }
  }

  return {
    passed: reasons.length === 0,
    method: v.method,
    opticalPrefilterSigma,
    actionUnits:
      v.method === 'mediapipe_action_units'
        ? (['RIGHT_EYE_BROW', 'LEFT_EYE_BROW', 'MOUTH'] as const)
        : [],
    reasons
  };
}

/**
 * Step 4: Frequency-Separated Tone Lock (`keep_tone`) & LAB L-Channel Median Skin Nudge + Mark Scale Lock.
 */
export const MicroRoiToneLockInputSchema = z.object({
  method: z.enum(MICRO_ROI_TONE_LOCK_METHODS),
  canvasPx: z.number().int().min(512).max(4096).default(1440),
  shapeChanged: z.boolean().default(false),
  sigmaFrac: z.number().min(0.01).max(0.25).default(0.05),
  targetSkinMedianL: z.number().min(0).max(255).optional(),
  sourceSkinMedianL: z.number().min(0).max(255).optional(),
  logoMarkLock: z
    .object({
      targetMarkHeightPx: z.number().int().min(8).max(2048),
      detectedMarkHeightPx: z.number().int().min(8).max(2048),
      targetCentreX: z.number().int().min(0).max(4096),
      targetCentreY: z.number().int().min(0).max(4096)
    })
    .optional()
});

export type MicroRoiToneLockInput = z.input<typeof MicroRoiToneLockInputSchema>;

export interface MicroRoiStep4ToneLockPlan {
  method: MicroRoiToneLockMethod;
  keepToneFormula: 'np.clip(b + cv2.GaussianBlur(a, (0, 0), sigma) - cv2.GaussianBlur(b, (0, 0), sigma), 0, 255)';
  gaussianSigmaPx: number;
  labSkinDeltaL: number;
  labSkinAppliedNudgeL: number;
  logoResizePlan: {
    scaleRatio: number;
    targetMarkHeightPx: number;
    targetCentre: [number, number];
  } | null;
}

export function computeMicroRoiToneLockPlan(
  raw: MicroRoiToneLockInput
): MicroRoiStep4ToneLockPlan {
  const v = MicroRoiToneLockInputSchema.parse(raw);

  // `fix-composite3.py`: `0.05 * CANVAS` (72px on 1440px), or >= 200px when silhouette/shape changes
  const baseSigma = Math.round(v.canvasPx * v.sigmaFrac * 100) / 100;
  const gaussianSigmaPx = v.shapeChanged ? Math.max(200, baseSigma) : baseSigma;

  // `face_swap_composite.py` `harmonize_foreground`:
  // d_l = clip(median(dst_L) - median(src_L), -10.0, 10.0); nudge = 0.35 * d_l
  let labSkinDeltaL = 0;
  let labSkinAppliedNudgeL = 0;
  if (
    v.targetSkinMedianL !== undefined &&
    v.sourceSkinMedianL !== undefined
  ) {
    const rawDelta = v.targetSkinMedianL - v.sourceSkinMedianL;
    labSkinDeltaL = Math.max(-10, Math.min(10, rawDelta));
    labSkinAppliedNudgeL = Math.round(0.35 * labSkinDeltaL * 1000) / 1000;
  }

  const logoResizePlan = v.logoMarkLock
    ? {
        scaleRatio:
          Math.round(
            (v.logoMarkLock.targetMarkHeightPx /
              v.logoMarkLock.detectedMarkHeightPx) *
              10000
          ) / 10000,
        targetMarkHeightPx: v.logoMarkLock.targetMarkHeightPx,
        targetCentre: [
          v.logoMarkLock.targetCentreX,
          v.logoMarkLock.targetCentreY
        ] as [number, number]
      }
    : null;

  return {
    method: v.method,
    keepToneFormula:
      'np.clip(b + cv2.GaussianBlur(a, (0, 0), sigma) - cv2.GaussianBlur(b, (0, 0), sigma), 0, 255)',
    gaussianSigmaPx,
    labSkinDeltaL,
    labSkinAppliedNudgeL,
    logoResizePlan
  };
}

/**
 * Step 5: Deterministic Zero-Leak Feather Composite on Raw RGBA Buffers.
 * Guarantees:
 * 1. `alpha < 0.012` is clamped strictly to `0.0` (`face_swap_composite.py` line 662 / 915).
 * 2. Mask alpha reaches `0.0` before the crop box boundary (`maxAlphaAtBoxEdge === 0`).
 * 3. Every pixel outside `box = (x0, y0, x1, y1)` is bit-for-bit identical to `originalRgba`
 *    (`outsidePixelsChanged === 0`).
 */
export interface MicroRoiBufferCompositeParams {
  width: number;
  height: number;
  originalRgba: Uint8ClampedArray;
  box: { x0: number; y0: number; x1: number; y1: number };
  alignedPatchRgba: Uint8ClampedArray;
  maskInset?: {
    mx0: number;
    my0: number;
    mx1: number;
    my1: number;
    featherRatio?: number;
  };
  applyKeepTone?: boolean;
}

export interface MicroRoiBufferCompositeResult {
  compositedRgba: Uint8ClampedArray;
  outsidePixelsChanged: number;
  insidePixelsChanged: number;
  maxAlphaAtBoxEdge: number;
  zeroLeakGuaranteePassed: boolean;
}

export function compositeMicroRoiRgbaBuffer(
  params: MicroRoiBufferCompositeParams
): MicroRoiBufferCompositeResult {
  const { width, height, originalRgba, box, alignedPatchRgba } = params;
  const { x0, y0, x1, y1 } = box;
  const bw = x1 - x0;
  const bh = y1 - y0;

  if (originalRgba.length !== width * height * 4) {
    throw new Error('originalRgba length does not match width * height * 4.');
  }
  if (alignedPatchRgba.length !== bw * bh * 4) {
    throw new Error('alignedPatchRgba length does not match crop box dimensions.');
  }

  const inset = params.maskInset ?? {
    mx0: 0.12,
    my0: 0.12,
    mx1: 0.88,
    my1: 0.88,
    featherRatio: 0.12
  };
  const featherRatio = inset.featherRatio ?? 0.12;

  // Compute low-frequency mean RGB of original crop vs aligned patch for keep_tone harmonization
  let origMeanR = 0,
    origMeanG = 0,
    origMeanB = 0;
  let patchMeanR = 0,
    patchMeanG = 0,
    patchMeanB = 0;
  const totalCropPixels = bw * bh;

  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      const fullIdx = ((y0 + py) * width + (x0 + px)) * 4;
      const patchIdx = (py * bw + px) * 4;
      origMeanR += originalRgba[fullIdx]!;
      origMeanG += originalRgba[fullIdx + 1]!;
      origMeanB += originalRgba[fullIdx + 2]!;
      patchMeanR += alignedPatchRgba[patchIdx]!;
      patchMeanG += alignedPatchRgba[patchIdx + 1]!;
      patchMeanB += alignedPatchRgba[patchIdx + 2]!;
    }
  }
  const toneOffsetR =
    params.applyKeepTone !== false
      ? (origMeanR - patchMeanR) / totalCropPixels
      : 0;
  const toneOffsetG =
    params.applyKeepTone !== false
      ? (origMeanG - patchMeanG) / totalCropPixels
      : 0;
  const toneOffsetB =
    params.applyKeepTone !== false
      ? (origMeanB - patchMeanB) / totalCropPixels
      : 0;

  const out = new Uint8ClampedArray(originalRgba);
  let maxAlphaAtBoxEdge = 0;
  let insidePixelsChanged = 0;

  for (let py = 0; py < bh; py++) {
    const ny = (py + 0.5) / bh;
    for (let px = 0; px < bw; px++) {
      const nx = (px + 0.5) / bw;

      // Strictly zero on the outer crop boundary ring so box edges never leak
      const isBoxBorder =
        px === 0 || py === 0 || px === bw - 1 || py === bh - 1;
      let alpha = 0;

      if (!isBoxBorder) {
        // Smooth inward distance ramp inside [mx0..mx1, my0..my1]
        const dxLeft = (nx - inset.mx0) / Math.max(featherRatio, 0.01);
        const dxRight = (inset.mx1 - nx) / Math.max(featherRatio, 0.01);
        const dyTop = (ny - inset.my0) / Math.max(featherRatio, 0.01);
        const dyBottom = (inset.my1 - ny) / Math.max(featherRatio, 0.01);
        const rawRamp = Math.min(dxLeft, dxRight, dyTop, dyBottom);
        const t = Math.max(0, Math.min(1, rawRamp));
        // Smoothstep ramp: t^2 * (3 - 2t)
        alpha = t * t * (3 - 2 * t);
      }

      // Hard zero-leak clamp (`alpha < 0.012 -> 0`)
      if (alpha < DENSE_FACE_COMPATIBILITY_GATES.zeroLeakAlphaFloor) {
        alpha = 0;
      }

      if (isBoxBorder && alpha > maxAlphaAtBoxEdge) {
        maxAlphaAtBoxEdge = alpha;
      }

      if (alpha === 0) {
        continue;
      }

      const fullIdx = ((y0 + py) * width + (x0 + px)) * 4;
      const patchIdx = (py * bw + px) * 4;

      const harmonizedR = Math.max(
        0,
        Math.min(255, alignedPatchRgba[patchIdx]! + toneOffsetR)
      );
      const harmonizedG = Math.max(
        0,
        Math.min(255, alignedPatchRgba[patchIdx + 1]! + toneOffsetG)
      );
      const harmonizedB = Math.max(
        0,
        Math.min(255, alignedPatchRgba[patchIdx + 2]! + toneOffsetB)
      );

      const nextR = Math.round(
        originalRgba[fullIdx]! * (1 - alpha) + harmonizedR * alpha
      );
      const nextG = Math.round(
        originalRgba[fullIdx + 1]! * (1 - alpha) + harmonizedG * alpha
      );
      const nextB = Math.round(
        originalRgba[fullIdx + 2]! * (1 - alpha) + harmonizedB * alpha
      );

      if (
        nextR !== originalRgba[fullIdx] ||
        nextG !== originalRgba[fullIdx + 1] ||
        nextB !== originalRgba[fullIdx + 2]
      ) {
        insidePixelsChanged++;
      }

      out[fullIdx] = nextR;
      out[fullIdx + 1] = nextG;
      out[fullIdx + 2] = nextB;
      out[fullIdx + 3] = originalRgba[fullIdx + 3]!;
    }
  }

  // Verify `outside_pixels_changed === 0` across the entire canvas
  let outsidePixelsChanged = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const idx = (y * width + x) * 4;
      if (
        out[idx] !== originalRgba[idx] ||
        out[idx + 1] !== originalRgba[idx + 1] ||
        out[idx + 2] !== originalRgba[idx + 2] ||
        out[idx + 3] !== originalRgba[idx + 3]
      ) {
        outsidePixelsChanged++;
      }
    }
  }

  return {
    compositedRgba: out,
    outsidePixelsChanged,
    insidePixelsChanged,
    maxAlphaAtBoxEdge,
    zeroLeakGuaranteePassed:
      outsidePixelsChanged === 0 && maxAlphaAtBoxEdge === 0
  };
}

/**
 * Full 5-Step Brand Micro-ROI Plan & Workstation Queue Service (`planBrandMicroRoiRepair`, `queueBrandMicroRoiRepair`).
 */
export const PlanBrandMicroRoiInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().trim().min(1).max(80).optional(),
  mode: z.enum(MICRO_ROI_MODES).default('micro_patch_ecc'),
  sourceImageKey: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .default('brands/studio/approved-master.png'),
  imageWidth: z.number().int().min(64).max(16384).default(2048),
  imageHeight: z.number().int().min(64).max(16384).default(2560),
  box: z.object({
    x0: z.number().int().min(0),
    y0: z.number().int().min(0),
    x1: z.number().int().min(1),
    y1: z.number().int().min(1)
  }),
  targetDescription: z.string().trim().min(2).max(400),
  referenceKind: z.enum(LOCAL_FIX_REFERENCE_KINDS).default('none'),
  referenceAssetKey: z.string().trim().max(400).optional(),
  patchEngine: z.enum(MICRO_ROI_PATCH_ENGINES).default('nano-banana-pro'),
  shapeChanged: z.boolean().default(false),
  crossedSeams: z.array(z.enum(STRUCTURAL_SEAM_KINDS)).default([]),
  logoMarkLock: z
    .object({
      targetMarkHeightPx: z.number().int().min(8).max(2048),
      detectedMarkHeightPx: z.number().int().min(8).max(2048),
      targetCentreX: z.number().int().min(0).max(4096),
      targetCentreY: z.number().int().min(0).max(4096)
    })
    .optional(),
  locale: z.enum(['ko', 'en']).default('ko'),
  enqueueWorkstationJob: z.boolean().default(false)
});

export type PlanBrandMicroRoiInput = z.input<
  typeof PlanBrandMicroRoiInputSchema
>;

export interface BrandMicroRoiPlanView {
  organizationId: string;
  projectId: string | null;
  mode: MicroRoiMode;
  modeCode: string;
  modeTitle: { ko: string; en: string };
  sourceImageKey: string;
  step1Crop: MicroRoiStep1CropPlan;
  step2Edit: {
    customerSummary: string;
    prompt: string;
    referenceKind: LocalFixReferenceKind;
    referenceAssetKey: string | null;
    temperature: number;
  };
  step3Alignment: {
    method: MicroRoiAlignmentMethod;
    gates: typeof DENSE_FACE_COMPATIBILITY_GATES;
    actionUnits: readonly string[];
  };
  step4ToneLock: MicroRoiStep4ToneLockPlan;
  step5FeatherComposite: {
    matteMethod: MicroRoiMatteMethod;
    zeroLeakAlphaFloor: number;
    invariant: 'outside_pixels_changed === 0';
    cliHarnessCommand: string;
  };
  workstationTask: WorkstationFinishTask | null;
}

const uuid = z.string().uuid();

async function authorizeMicroRoiActor(
  sql: SqlRunner,
  userId: string,
  organizationId: string
): Promise<BrandRole | 'admin'> {
  const profile = (
    await sql.query<{ is_admin: boolean }>(
      'select is_admin from profiles where id = $1 for share',
      [userId]
    )
  ).rows[0];
  if (!profile) throw new Error('sign_in_required');

  const org = (
    await sql.query<{ id: string }>(
      'select id from brand_organizations where id = $1 for share',
      [organizationId]
    )
  ).rows[0];
  if (!org) throw new Error('not_found');

  if (profile.is_admin === true) return 'admin';

  const membership = (
    await sql.query<{ role: BrandRole }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active' for share",
      [organizationId, userId]
    )
  ).rows[0];
  if (
    !membership ||
    (membership.role !== 'owner' && membership.role !== 'editor')
  ) {
    throw new Error('forbidden');
  }
  return membership.role;
}

export async function planBrandMicroRoiRepair(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  raw: unknown
): Promise<BrandOutcome<{ plan: BrandMicroRoiPlanView }>> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = PlanBrandMicroRoiInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'box'
    };
  }
  const v = parsed.data;

  try {
    await authorizeMicroRoiActor(deps.sql, viewer.userId!, v.organizationId);
    await assertBrandFeature(deps.sql, v.organizationId, 'generative_media');
  } catch (err) {
    if (err instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    if (err instanceof Error) {
      if (err.message === 'sign_in_required')
        return { ok: false, code: 'sign_in_required' };
      if (err.message === 'not_found') return { ok: false, code: 'not_found' };
      if (err.message === 'forbidden') return { ok: false, code: 'forbidden' };
    }
    throw err;
  }

  // Enforce Brand Base DNA `consentedFacesOnly` hard lock
  const confirmed = await confirmedIdentityFor(deps.sql, v.organizationId).catch(
    () => null
  );
  if (confirmed && confirmed.rules.consentedFacesOnly !== true) {
    return { ok: false, code: 'invalid', field: 'consentedFacesOnly' };
  }

  const cropOut = computeMicroRoiCropPlan({
    imageWidth: v.imageWidth,
    imageHeight: v.imageHeight,
    x0: v.box.x0,
    y0: v.box.y0,
    x1: v.box.x1,
    y1: v.box.y1,
    mode: v.mode,
    crossedSeams: v.crossedSeams
  });
  if (!cropOut.ok) {
    return { ok: false, code: 'invalid', field: 'box' };
  }

  const editOut = buildMicroRoiEditSpec({
    mode: v.mode,
    targetDescription: v.targetDescription,
    referenceKind: v.referenceKind,
    referenceAssetKey: v.referenceAssetKey,
    patchEngine: v.patchEngine,
    locale: v.locale
  });
  if (!editOut.ok) {
    return { ok: false, code: 'invalid', field: 'referenceKind' };
  }

  const modeSpec = MICRO_ROI_MODE_SPECS[v.mode];
  const toneLock = computeMicroRoiToneLockPlan({
    method: modeSpec.toneLockMethod,
    canvasPx: cropOut.plan.upscaleLongEdgePx,
    shapeChanged: v.shapeChanged,
    logoMarkLock: v.logoMarkLock
  });

  const cliHarnessCommand = [
    'python scripts/brand-micro-roi-harness.py composite',
    `--mode ${v.mode}`,
    `--source "${v.sourceImageKey}"`,
    `--box ${v.box.x0},${v.box.y0},${v.box.x1},${v.box.y1}`,
    `--canvas ${cropOut.plan.upscaleLongEdgePx}`,
    `--sigma ${toneLock.gaussianSigmaPx}`
  ].join(' ');

  let workstationTask: WorkstationFinishTask | null = null;
  if (v.enqueueWorkstationJob) {
    const taskRes = await createWorkstationFinishTask(deps, {
      organizationId: v.organizationId,
      op: 'inpaint',
      inputStorageKey: v.sourceImageKey,
      outputStoragePrefix: `brands/${v.organizationId}/micro-roi`,
      params: {
        pipeline: 'micro_roi_5step',
        mode: v.mode,
        projectId: v.projectId ?? null,
        box: cropOut.plan.box,
        canvasPx: cropOut.plan.upscaleLongEdgePx,
        maskInset: cropOut.plan.maskInset,
        workerEngineConfig: editOut.spec.workerEngineConfig,
        prompt: editOut.spec.prompt,
        referenceKind: editOut.spec.referenceKind,
        referenceAssetKey: editOut.spec.referenceAssetKey,
        alignmentMethod: modeSpec.alignmentMethod,
        toneLock,
        cliHarnessCommand
      }
    });
    if (!taskRes.ok) return taskRes;
    workstationTask = taskRes.task;

    // Record the Micro-ROI repair invocation in operational memory (`brand_memory_events`)
    await recordMemory(deps, viewer, {
      organizationId: v.organizationId,
      kind: 'note',
      payload: {
        scope: 'micro_roi_repair',
        projectId: v.projectId ?? null,
        mode: v.mode,
        box: cropOut.plan.box,
        targetDescription: v.targetDescription,
        taskId: workstationTask.id
      }
    }).catch(() => null);
  }

  const plan: BrandMicroRoiPlanView = {
    organizationId: v.organizationId,
    projectId: v.projectId ?? null,
    mode: v.mode,
    modeCode: modeSpec.code,
    modeTitle: { ko: modeSpec.titleKo, en: modeSpec.titleEn },
    sourceImageKey: v.sourceImageKey,
    step1Crop: cropOut.plan,
    step2Edit: {
      customerSummary: editOut.spec.customerSummary,
      prompt: editOut.spec.prompt,
      referenceKind: editOut.spec.referenceKind,
      referenceAssetKey: editOut.spec.referenceAssetKey,
      temperature: editOut.spec.workerEngineConfig.temperature
    },
    step3Alignment: {
      method: modeSpec.alignmentMethod,
      gates: DENSE_FACE_COMPATIBILITY_GATES,
      actionUnits:
        modeSpec.alignmentMethod === 'mediapipe_action_units'
          ? ['RIGHT_EYE_BROW', 'LEFT_EYE_BROW', 'MOUTH']
          : []
    },
    step4ToneLock: toneLock,
    step5FeatherComposite: {
      matteMethod: modeSpec.matteMethod,
      zeroLeakAlphaFloor: DENSE_FACE_COMPATIBILITY_GATES.zeroLeakAlphaFloor,
      invariant: 'outside_pixels_changed === 0',
      cliHarnessCommand
    },
    workstationTask
  };

  return { ok: true, plan };
}
