import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '@/lib/brands/entitlements';
import type { BrandOutcome } from '@/lib/brands/workspace/types';

/**
 * S4 Partial Edit / Local Fix 5-Step Pipeline (`IDENTITY.md` §6-4-3, `knowhow-corpus.md` §7):
 * 1. Crop target + surrounding texture and upscale to fill canvas (`180px -> 1440px`).
 * 2. Preserve-first prompt + strict reference role (`mark_only` for logos; never full product photo).
 * 3. ECC alignment & frequency-separated composite (`sigma >= 200px` when shape changes; abort on striping).
 * 4. Soft feather mask (`hardness ~50`, reaches `0` before box boundary, avoids structural seams).
 * 5. Verify `changed_pixels_outside === 0` invariant and logo scale drift.
 */

export const LOCAL_FIX_KINDS = [
  'logo_mark',
  'skin_texture',
  'artifact_cleanup',
  'typography_label',
  'object_detail'
] as const;

export type LocalFixKind = (typeof LOCAL_FIX_KINDS)[number];

export const LOCAL_FIX_REFERENCE_KINDS = [
  'none',
  'mark_only',
  'consented_identity',
  'material_swatch',
  'full_product_photo'
] as const;

export type LocalFixReferenceKind = (typeof LOCAL_FIX_REFERENCE_KINDS)[number];

export const STRUCTURAL_SEAM_KINDS = [
  'collar',
  'jawline',
  'glass_rim',
  'bottle_shoulder',
  'garment_hem'
] as const;

export type StructuralSeamKind = (typeof STRUCTURAL_SEAM_KINDS)[number];

export const LocalCropInputSchema = z.object({
  imageWidth: z.number().int().min(64).max(16384),
  imageHeight: z.number().int().min(64).max(16384),
  box: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1)
  }),
  paddingRatio: z.number().min(0).max(1.5).default(0.35),
  targetCanvasPx: z.number().int().min(512).max(4096).default(1440)
});

export type LocalCropInput = z.input<typeof LocalCropInputSchema>;

export interface LocalCropPlan {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  scaleFactor: number;
  innerBoxInCrop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type LocalCropOutcome =
  | { ok: true; plan: LocalCropPlan }
  | { ok: false; code: 'out_of_bounds' | 'invalid_box'; message: string };

/**
 * Step 1: Computes the padded square/proportional crop box including surrounding texture and scales
 * it to fill the `1440px` working canvas (`knowhow-corpus.md` §7.1: `180px -> 1440px`).
 */
export function computeLocalCropBox(raw: unknown): LocalCropOutcome {
  const parsed = LocalCropInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_box',
      message: parsed.error.issues[0]?.message ?? 'Invalid crop box coordinates.'
    };
  }
  const { imageWidth, imageHeight, box, paddingRatio, targetCanvasPx } =
    parsed.data;

  if (
    box.x + box.width > imageWidth ||
    box.y + box.height > imageHeight
  ) {
    return {
      ok: false,
      code: 'out_of_bounds',
      message: 'Target crop box exceeds source image dimensions.'
    };
  }

  const padX =
    paddingRatio === 0 ? 0 : Math.max(16, Math.round(box.width * paddingRatio));
  const padY =
    paddingRatio === 0 ? 0 : Math.max(16, Math.round(box.height * paddingRatio));

  const cropX = Math.max(0, box.x - padX);
  const cropY = Math.max(0, box.y - padY);
  const cropRight = Math.min(imageWidth, box.x + box.width + padX);
  const cropBottom = Math.min(imageHeight, box.y + box.height + padY);

  const cropWidth = cropRight - cropX;
  const cropHeight = cropBottom - cropY;
  const longestSide = Math.max(cropWidth, cropHeight);
  const scaleFactor =
    Math.round((targetCanvasPx / longestSide) * 1000) / 1000;

  return {
    ok: true,
    plan: {
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      canvasWidth: Math.round(cropWidth * scaleFactor),
      canvasHeight: Math.round(cropHeight * scaleFactor),
      scaleFactor,
      innerBoxInCrop: {
        x: box.x - cropX,
        y: box.y - cropY,
        width: box.width,
        height: box.height
      }
    }
  };
}

export const LocalFixPromptInputSchema = z.object({
  fixKind: z.enum(LOCAL_FIX_KINDS),
  referenceKind: z.enum(LOCAL_FIX_REFERENCE_KINDS).default('none'),
  targetDescription: z.string().trim().min(2).max(300),
  locale: z.enum(['ko', 'en']).default('ko')
});

export type LocalFixPromptInput = z.input<typeof LocalFixPromptInputSchema>;

export type LocalFixPromptOutcome =
  | {
      ok: true;
      prompt: string;
      preservePrefix: string;
      referenceRoleInstruction: string;
    }
  | {
      ok: false;
      code:
        | 'full_product_photo_forbidden_for_logo'
        | 'mark_reference_required_for_logo'
        | 'consented_identity_required_for_skin'
        | 'invalid_input';
      message: string;
    };

/**
 * Step 2: Builds the preserve-first local fix prompt (`knowhow-corpus.md` §7.2, f5).
 * - Always leads with what MUST stay pixel-identical (`이미지 1의 프레임·크기·위치·배경 질감·모든 요소는 픽셀 그대로...`).
 * - Rejects `full_product_photo` for `logo_mark` fixes (prevents the model from pasting the whole product).
 * - Requires `consented_identity` for `skin_texture` fixes (`결만 살린다`).
 */
export function buildLocalFixPrompt(raw: unknown): LocalFixPromptOutcome {
  const parsed = LocalFixPromptInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      message: parsed.error.issues[0]?.message ?? 'Invalid local fix prompt input.'
    };
  }
  const { fixKind, referenceKind, targetDescription, locale } = parsed.data;

  if (fixKind === 'logo_mark') {
    if (referenceKind === 'full_product_photo') {
      return {
        ok: false,
        code: 'full_product_photo_forbidden_for_logo',
        message:
          'Logo mark local fixes must reference only the isolated mark/graphic (`mark_only`), never a full product photo (knowhow-corpus f5).'
      };
    }
    if (referenceKind !== 'mark_only') {
      return {
        ok: false,
        code: 'mark_reference_required_for_logo',
        message:
          'Logo mark local fixes require an isolated `mark_only` reference.'
      };
    }
  }

  if (fixKind === 'skin_texture' && referenceKind !== 'consented_identity') {
    return {
      ok: false,
      code: 'consented_identity_required_for_skin',
      message:
        'Skin texture restoration requires a `consented_identity` reference.'
    };
  }

  const preservePrefix =
    locale === 'ko'
      ? '이미지 1의 프레임·크기·위치·배경 질감·모든 요소는 픽셀 그대로 유지하고,'
      : 'Preserve Image 1 frame, scale, position, background texture, and all surrounding elements pixel-for-pixel;';

  let referenceRoleInstruction = '';
  if (fixKind === 'logo_mark') {
    referenceRoleInstruction =
      locale === 'ko'
        ? '참조 이미지 2에서는 로고·마크의 형태와 획 비례만 가져오고 배경이나 다른 사물은 절대 복사하지 않는다.'
        : 'From Reference Image 2, borrow only the isolated logo mark geometry and stroke proportions; never copy its background or surrounding objects.';
  } else if (fixKind === 'skin_texture') {
    referenceRoleInstruction =
      locale === 'ko'
        ? '참조 이미지 2의 자연스러운 피부 결만 살리고, 이미지 1의 조명 방향·그림자·이목구비 윤곽은 바꾸지 않는다.'
        : 'Restore only natural skin micro-texture from Reference Image 2 while keeping Image 1 lighting direction, shadows, and facial contours unchanged.';
  } else if (referenceKind === 'material_swatch') {
    referenceRoleInstruction =
      locale === 'ko'
        ? '참조 이미지 2의 표면 재질감만 반영하고 형태와 조명은 이미지 1을 유지한다.'
        : 'Borrow only surface material texture from Reference Image 2 while preserving Image 1 geometry and lighting.';
  }

  const actionClause =
    locale === 'ko'
      ? `${targetDescription} 부분만 정밀하게 복원한다.`
      : `precisely restore only ${targetDescription}.`;

  const prompt = [preservePrefix, actionClause, referenceRoleInstruction]
    .filter(Boolean)
    .join(' ');

  return {
    ok: true,
    prompt,
    preservePrefix,
    referenceRoleInstruction
  };
}

export const EccAlignmentInputSchema = z.object({
  eccScore: z.number().min(-1).max(1),
  minEccScore: z.number().min(0.5).max(0.99).default(0.88),
  maxShiftPx: z.number().min(0),
  maxAllowedShiftPx: z.number().min(1).max(40).default(12),
  edgeStripingDetected: z.boolean().default(false),
  shapeChanged: z.boolean().default(false),
  requestedLowFreqSigmaPx: z.number().min(10).max(500).optional()
});

export type EccAlignmentInput = z.input<typeof EccAlignmentInputSchema>;

export type EccAlignmentDecision =
  | {
      aligned: true;
      action: 'composite_frequency_separated';
      eccScore: number;
      lowFreqSigmaPx: number;
      highFreqSource: 'edited_crop';
      lowFreqSource: 'original_image';
    }
  | {
      aligned: false;
      action: 'reselect_crop_box';
      reason: string;
    };

/**
 * Step 3: Evaluates ECC alignment and selects frequency-separation Gaussian sigma (`knowhow-corpus.md` §7.3, f11).
 * - If ECC fails, frame shifts exceed threshold, or border striping appears (`BORDER_REPLICATE`), refuses composite
 *   and instructs to re-select the crop box.
 * - If shape/outline changed (e.g. collar or silhouette), enforces `lowFreqSigmaPx >= 200` so old outlines do not ghost.
 */
export function evaluateEccAlignment(raw: EccAlignmentInput): EccAlignmentDecision {
  const input = EccAlignmentInputSchema.parse(raw);

  if (input.edgeStripingDetected) {
    return {
      aligned: false,
      action: 'reselect_crop_box',
      reason:
        'Edge striping detected after warp alignment; aborting composite and requesting crop box re-selection (knowhow-corpus f11).'
    };
  }
  if (input.eccScore < input.minEccScore) {
    return {
      aligned: false,
      action: 'reselect_crop_box',
      reason: `ECC correlation (${input.eccScore}) is below minimum threshold (${input.minEccScore}); re-select crop box.`
    };
  }
  if (input.maxShiftPx > input.maxAllowedShiftPx) {
    return {
      aligned: false,
      action: 'reselect_crop_box',
      reason: `Alignment shift (${input.maxShiftPx}px) exceeds maximum allowed (${input.maxAllowedShiftPx}px); model altered framing.`
    };
  }

  const lowFreqSigmaPx = input.shapeChanged
    ? Math.max(200, input.requestedLowFreqSigmaPx ?? 220)
    : Math.max(32, input.requestedLowFreqSigmaPx ?? 48);

  return {
    aligned: true,
    action: 'composite_frequency_separated',
    eccScore: input.eccScore,
    lowFreqSigmaPx,
    highFreqSource: 'edited_crop',
    lowFreqSource: 'original_image'
  };
}

export const FeatherMaskInputSchema = z.object({
  edgeHardness: z.number().min(0).max(100),
  maxAlphaAtBoxBoundary: z.number().min(0).max(1),
  crossedSeams: z.array(z.enum(STRUCTURAL_SEAM_KINDS)).default([])
});

export type FeatherMaskInput = z.input<typeof FeatherMaskInputSchema>;

export interface FeatherMaskValidation {
  valid: boolean;
  reasons: string[];
}

/**
 * Step 4: Validates the feather mask (`knowhow-corpus.md` §7.4):
 * - Edge hardness around `~50` (`35..65`).
 * - Mask alpha must fall to `0` (`maxAlphaAtBoxBoundary === 0`) before reaching the crop box boundary.
 * - Mask boundary must not cut across structural seams (`collar`, `jawline`, `glass_rim`, etc.).
 */
export function validateFeatherMask(raw: FeatherMaskInput): FeatherMaskValidation {
  const input = FeatherMaskInputSchema.parse(raw);
  const reasons: string[] = [];

  if (input.edgeHardness < 35 || input.edgeHardness > 65) {
    reasons.push(
      `Feather mask edge hardness (${input.edgeHardness}) must be between 35 and 65 (target ~50).`
    );
  }
  if (input.maxAlphaAtBoxBoundary > 0) {
    reasons.push(
      `Feather mask alpha at crop box boundary must be 0 (found ${input.maxAlphaAtBoxBoundary}) to prevent rectangular seam lines.`
    );
  }
  if (input.crossedSeams.length > 0) {
    reasons.push(
      `Feather mask boundary crosses structural seam(s): ${input.crossedSeams.join(', ')}. Expand or shift mask to avoid seams.`
    );
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

export const VerifyLocalFixCompositeSchema = z.object({
  changedPixelsOutsideCrop: z.number().int().min(0),
  changedPixelsInsideMask: z.number().int().min(0),
  logoScaleDriftPct: z.number().min(0).optional(),
  maxAllowedLogoScaleDriftPct: z.number().min(0.5).max(10).default(3.0)
});

export type VerifyLocalFixCompositeInput = z.input<
  typeof VerifyLocalFixCompositeSchema
>;

export interface VerifyLocalFixCompositeResult {
  passed: boolean;
  changedPixelsOutsideCrop: number;
  reasons: string[];
}

/**
 * Step 5: Verifies the hard composite invariant `changed_pixels_outside === 0` (`BRAND-PRODUCT.md` §7.1, §12 S4)
 * and checks that logo/graphic proportions did not bloat (`knowhow-corpus.md` f12).
 */
export function verifyLocalFixComposite(
  raw: VerifyLocalFixCompositeInput
): VerifyLocalFixCompositeResult {
  const input = VerifyLocalFixCompositeSchema.parse(raw);
  const reasons: string[] = [];

  if (input.changedPixelsOutsideCrop !== 0) {
    reasons.push(
      `Invariant violation: changed_pixels_outside must be 0, but ${input.changedPixelsOutsideCrop} pixel(s) changed outside the crop box.`
    );
  }
  if (input.changedPixelsInsideMask === 0) {
    reasons.push('No pixels changed inside the target repair mask.');
  }
  if (
    input.logoScaleDriftPct !== undefined &&
    input.logoScaleDriftPct > input.maxAllowedLogoScaleDriftPct
  ) {
    reasons.push(
      `Logo scale drift (${input.logoScaleDriftPct}%) exceeds maximum allowed (${input.maxAllowedLogoScaleDriftPct}%, knowhow-corpus f12).`
    );
  }

  return {
    passed: reasons.length === 0,
    changedPixelsOutsideCrop: input.changedPixelsOutsideCrop,
    reasons
  };
}

/**
 * Authorized S4 local-fix plan builder gated by `generative_media` feature policy.
 */
export async function prepareBrandLocalFixPlan(
  deps: { sql: SqlRunner },
  input: {
    organizationId: string;
    crop: LocalCropInput;
    promptInput: LocalFixPromptInput;
  }
): Promise<
  BrandOutcome<{
    id: string;
    cropPlan: LocalCropPlan;
    prompt: string;
  }>
> {
  try {
    await assertBrandFeature(deps.sql, input.organizationId, 'generative_media');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }

  const cropRes = computeLocalCropBox(input.crop);
  if (!cropRes.ok) {
    return { ok: false, code: 'invalid', field: 'crop' };
  }
  const promptRes = buildLocalFixPrompt(input.promptInput);
  if (!promptRes.ok) {
    return { ok: false, code: 'invalid', field: 'promptInput' };
  }

  return {
    ok: true,
    id: `${input.organizationId}:${input.promptInput.fixKind}`,
    cropPlan: cropRes.plan,
    prompt: promptRes.prompt
  };
}
