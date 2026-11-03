import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '@/lib/brands/entitlements';
import type { BrandOutcome } from '@/lib/brands/workspace/types';

/**
 * S4 Colour Grading & Deterministic Look Matching (`BRAND-PRODUCT.md` §5.3, `knowhow-corpus.md` §6).
 * Ported from `viral_color_grade.py` specifications into deterministic TypeScript schemas and filter builders.
 * Always gated by `assertBrandFeature(sql, organizationId, 'color_grading')`.
 */

export const BrandLookDefaultsSchema = z.object({
  auto_levels: z.boolean().default(true),
  target_black_ire: z.number().min(0).max(15).default(1.5),
  target_white_ire: z.number().min(85).max(100).default(97.5),
  max_black_shift: z.number().min(0).max(0.15).default(0.06),
  max_white_gain: z.number().min(1.0).max(1.3).default(1.12),
  luma_micro_contrast: z.number().min(0).max(1.5).default(0.45),
  halation_strength: z.number().min(0).max(0.2).default(0.045),
  grain_strength: z.number().min(0).max(10).default(2.2)
});

export type BrandLookDefaults = z.infer<typeof BrandLookDefaultsSchema>;

export const DEFAULT_BRAND_LOOK_DEFAULTS: BrandLookDefaults =
  BrandLookDefaultsSchema.parse({});

export const LookZoneStatsSchema = z.object({
  l_mean: z.number().min(0).max(100),
  a_mean: z.number().min(-128).max(127),
  b_mean: z.number().min(-128).max(127),
  a_std: z.number().min(0).default(4),
  b_std: z.number().min(0).default(4),
  rgb_mean: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1)
  ]),
  weight_share: z.number().min(0).max(1)
});

export type LookZoneStats = z.infer<typeof LookZoneStatsSchema>;

export const LookLumaPercentilesSchema = z.object({
  p1: z.number().min(0).max(100),
  p5: z.number().min(0).max(100),
  p10: z.number().min(0).max(100),
  p25: z.number().min(0).max(100),
  p50: z.number().min(0).max(100),
  p75: z.number().min(0).max(100),
  p90: z.number().min(0).max(100),
  p95: z.number().min(0).max(100),
  p99: z.number().min(0).max(100),
  std: z.number().min(0).max(100),
  dynamic_range: z.number().min(0).max(100)
});

export type LookLumaPercentiles = z.infer<typeof LookLumaPercentilesSchema>;

export const LookProfileSchema = z.object({
  luma: LookLumaPercentilesSchema,
  zones: z.object({
    shadows: LookZoneStatsSchema,
    midtones: LookZoneStatsSchema,
    highlights: LookZoneStatsSchema
  }),
  density_slope: z.number(),
  mid_chroma: z.number().min(0),
  saturation_pct: z.number().min(0).max(100),
  skin_share: z.number().min(0).max(1),
  texture: z.object({
    laplacian_std: z.number().min(0),
    high_freq_energy: z.number().min(0)
  })
});

export type LookProfile = z.infer<typeof LookProfileSchema>;

export const LookMatchSettingsSchema = z.object({
  intensity: z.number().min(0).max(1).default(0.85),
  skin_protect: z.number().min(0).max(1).default(0.7),
  auto_levels: z.boolean().default(true),
  exclude_captions: z.boolean().default(false),
  halation: z.number().min(0).max(0.2).default(0.045),
  grain: z.number().min(0).max(10).default(2.2),
  lut_size: z.union([z.literal(17), z.literal(33), z.literal(65)]).default(33)
});

export type LookMatchSettings = z.infer<typeof LookMatchSettingsSchema>;

export const PRESET_BRAND_LOOK_IDS = [
  'twings-french-blue',
  'clean-high-key',
  'editorial-cool-porcelain',
  'kodak-2383-warm',
  'moody-teal-amber',
  'pastel-airy-film'
] as const;

export type PresetBrandLookId = (typeof PRESET_BRAND_LOOK_IDS)[number];

export interface PresetBrandLookSpec {
  id: PresetBrandLookId;
  titleKo: string;
  titleEn: string;
  lutKey: string;
  defaults: BrandLookDefaults;
  ownedHueBand: readonly [number, number];
  skinProtectDefault: boolean;
}

export const PRESET_BRAND_LOOKS: Record<PresetBrandLookId, PresetBrandLookSpec> = {
  'twings-french-blue': {
    id: 'twings-french-blue',
    titleKo: 'TWINGS 프렌치 블루 에디토리얼',
    titleEn: 'TWINGS French Blue Editorial',
    lutKey: 'luts/twings-french-blue-33.cube',
    defaults: BrandLookDefaultsSchema.parse({
      auto_levels: true,
      target_black_ire: 1.5,
      target_white_ire: 97.5,
      luma_micro_contrast: 0.45,
      halation_strength: 0.035,
      grain_strength: 2.0
    }),
    ownedHueBand: [195, 225],
    skinProtectDefault: true
  },
  'clean-high-key': {
    id: 'clean-high-key',
    titleKo: '클린 하이키 스튜디오',
    titleEn: 'Clean High-Key Studio',
    lutKey: 'luts/clean-high-key-33.cube',
    defaults: BrandLookDefaultsSchema.parse({
      target_black_ire: 2.0,
      target_white_ire: 98.5,
      luma_micro_contrast: 0.4,
      halation_strength: 0.02,
      grain_strength: 1.4
    }),
    ownedHueBand: [195, 225],
    skinProtectDefault: true
  },
  'editorial-cool-porcelain': {
    id: 'editorial-cool-porcelain',
    titleKo: '에디토리얼 쿨 포슬린',
    titleEn: 'Editorial Cool Porcelain',
    lutKey: 'luts/editorial-cool-porcelain-33.cube',
    defaults: BrandLookDefaultsSchema.parse({
      target_black_ire: 1.5,
      target_white_ire: 97.0,
      luma_micro_contrast: 0.5,
      halation_strength: 0.04,
      grain_strength: 2.0
    }),
    ownedHueBand: [195, 225],
    skinProtectDefault: true
  },
  'kodak-2383-warm': {
    id: 'kodak-2383-warm',
    titleKo: '2383 필름 프린트 웜',
    titleEn: '2383 Film Print Warm',
    lutKey: 'luts/kodak-2383-warm-33.cube',
    defaults: BrandLookDefaultsSchema.parse({
      target_black_ire: 1.2,
      target_white_ire: 96.5,
      luma_micro_contrast: 0.5,
      halation_strength: 0.055,
      grain_strength: 2.8
    }),
    ownedHueBand: [25, 55],
    skinProtectDefault: true
  },
  'moody-teal-amber': {
    id: 'moody-teal-amber',
    titleKo: '무디 틸 앤 앰버',
    titleEn: 'Moody Teal & Amber',
    lutKey: 'luts/moody-teal-amber-33.cube',
    defaults: BrandLookDefaultsSchema.parse({
      target_black_ire: 1.0,
      target_white_ire: 96.0,
      luma_micro_contrast: 0.55,
      halation_strength: 0.05,
      grain_strength: 2.6
    }),
    ownedHueBand: [190, 215],
    skinProtectDefault: true
  },
  'pastel-airy-film': {
    id: 'pastel-airy-film',
    titleKo: '파스텔 에어리 필름',
    titleEn: 'Pastel Airy Film',
    lutKey: 'luts/pastel-airy-film-33.cube',
    defaults: BrandLookDefaultsSchema.parse({
      target_black_ire: 2.5,
      target_white_ire: 98.0,
      luma_micro_contrast: 0.35,
      halation_strength: 0.05,
      grain_strength: 1.8
    }),
    ownedHueBand: [195, 230],
    skinProtectDefault: true
  }
};

export interface LookDistanceMetrics {
  deltaLumaP50: number;
  deltaDynamicRange: number;
  zoneDeltaAb: {
    shadows: number;
    midtones: number;
    highlights: number;
    mean: number;
  };
  chromaRatio: number;
  compositeScore: number;
}

export interface LookDistanceComparison {
  before: LookDistanceMetrics;
  after?: LookDistanceMetrics;
  improved?: boolean;
}

function hypot2(da: number, db: number): number {
  return Math.round(Math.hypot(da, db) * 1000) / 1000;
}

/**
 * Computes `look_distance(source, reference)` (`|ΔL*|`, 3-way `Δ(a,b)`, and `chroma_ratio`).
 */
export function computeLookDistance(
  source: LookProfile,
  reference: LookProfile,
  afterProfile?: LookProfile
): LookDistanceComparison {
  const measure = (cand: LookProfile): LookDistanceMetrics => {
    const deltaLumaP50 =
      Math.round(Math.abs(cand.luma.p50 - reference.luma.p50) * 1000) / 1000;
    const deltaDynamicRange =
      Math.round(
        Math.abs(cand.luma.dynamic_range - reference.luma.dynamic_range) * 1000
      ) / 1000;

    const shadows = hypot2(
      cand.zones.shadows.a_mean - reference.zones.shadows.a_mean,
      cand.zones.shadows.b_mean - reference.zones.shadows.b_mean
    );
    const midtones = hypot2(
      cand.zones.midtones.a_mean - reference.zones.midtones.a_mean,
      cand.zones.midtones.b_mean - reference.zones.midtones.b_mean
    );
    const highlights = hypot2(
      cand.zones.highlights.a_mean - reference.zones.highlights.a_mean,
      cand.zones.highlights.b_mean - reference.zones.highlights.b_mean
    );
    const mean =
      Math.round(((shadows + midtones + highlights) / 3) * 1000) / 1000;

    const refChroma = Math.max(0.001, reference.mid_chroma);
    const chromaRatio =
      Math.round((cand.mid_chroma / refChroma) * 1000) / 1000;

    const compositeScore =
      Math.round(
        (deltaLumaP50 * 0.35 +
          mean * 0.5 +
          Math.abs(1 - chromaRatio) * 10 * 0.15) *
          1000
      ) / 1000;

    return {
      deltaLumaP50,
      deltaDynamicRange,
      zoneDeltaAb: { shadows, midtones, highlights, mean },
      chromaRatio,
      compositeScore
    };
  };

  const before = measure(source);
  if (!afterProfile) {
    return { before };
  }
  const after = measure(afterProfile);
  return {
    before,
    after,
    improved: after.compositeScore <= before.compositeScore
  };
}

export interface ColorLevelsParams {
  rimin: number;
  gimin: number;
  bimin: number;
  rimax: number;
  gimax: number;
  bimax: number;
}

/**
 * Computes conservative `colorlevels` black/white point normalization clamped by `max_black_shift`
 * and `max_white_gain` (`knowhow-corpus.md` §6.2 Stage 1).
 */
export function computeColorLevelsParams(
  luma: Pick<LookLumaPercentiles, 'p1' | 'p99'>,
  defaults: BrandLookDefaults = DEFAULT_BRAND_LOOK_DEFAULTS
): ColorLevelsParams {
  if (!defaults.auto_levels) {
    return { rimin: 0, gimin: 0, bimin: 0, rimax: 1, gimax: 1, bimax: 1 };
  }
  const currentBlack = Math.max(0, Math.min(1, luma.p1 / 100));
  const targetBlack = defaults.target_black_ire / 100;
  const rawBlackShift = Math.max(0, currentBlack - targetBlack);
  const blackIn =
    Math.round(Math.min(defaults.max_black_shift, rawBlackShift) * 10000) /
    10000;

  const currentWhite = Math.max(0.5, Math.min(1, luma.p99 / 100));
  const targetWhite = defaults.target_white_ire / 100;
  const minWhiteIn = 1 / defaults.max_white_gain;
  const rawWhiteIn =
    currentWhite < targetWhite
      ? Math.max(minWhiteIn, currentWhite / targetWhite)
      : 1;
  const whiteIn = Math.round(Math.min(1, rawWhiteIn) * 10000) / 10000;

  return {
    rimin: blackIn,
    gimin: blackIn,
    bimin: blackIn,
    rimax: whiteIn,
    gimax: whiteIn,
    bimax: whiteIn
  };
}

export interface CyanToFrenchBlueCheckInput {
  /** Hue band in degrees targeted for rotation (must stay within cyan [165, 210]). */
  sourceHueBandDeg: readonly [number, number];
  /** Target hue band in degrees (must stay within French Blue [195, 225]). */
  targetHueBandDeg: readonly [number, number];
  /** Whether red/warm hues (340..360, 0..50) are protected from hue rotation. */
  protectsRedAndSkinHues: boolean;
  /** Fraction of pixels falling in green hue band (85..155 deg) before and after grade. */
  greenPixelRatioBefore: number;
  greenPixelRatioAfter: number;
}

export interface CyanToFrenchBlueCheckResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Enforces `IDENTITY.md` §6-4-1 & `knowhow-corpus.md` f4:
 * Cyan -> French Blue grading must ONLY rotate the cyan hue band (`165..210°`) into `[195..225°]`,
 * never rotate red/warm hues through green, and never increase green pixel cast.
 */
export function evaluateCyanToFrenchBlueGrade(
  input: CyanToFrenchBlueCheckInput
): CyanToFrenchBlueCheckResult {
  const reasons: string[] = [];
  const [srcMin, srcMax] = input.sourceHueBandDeg;
  const [dstMin, dstMax] = input.targetHueBandDeg;

  if (srcMin < 165 || srcMax > 210 || srcMin >= srcMax) {
    reasons.push(
      `Source hue band [${srcMin}, ${srcMax}] must be restricted to cyan [165, 210] deg.`
    );
  }
  if (dstMin < 195 || dstMax > 225 || dstMin >= dstMax) {
    reasons.push(
      `Target hue band [${dstMin}, ${dstMax}] must stay within TWINGS French Blue [195, 225] deg.`
    );
  }
  if (!input.protectsRedAndSkinHues) {
    reasons.push(
      'Red and warm skin hues (340..360, 0..50 deg) must be locked against hue rotation (knowhow-corpus f4).'
    );
  }
  if (input.greenPixelRatioAfter > input.greenPixelRatioBefore + 0.002) {
    reasons.push(
      `Green pixel ratio increased from ${input.greenPixelRatioBefore} to ${input.greenPixelRatioAfter} (global hue rotation leak detected).`
    );
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

export interface BuildActiveGradeFilterInput {
  lutPath: string;
  levels?: ColorLevelsParams;
  defaults?: Partial<BrandLookDefaults>;
}

/**
 * Builds the deterministic 5-stage active FFmpeg filter chain (`knowhow-corpus.md` §6.2):
 * 1. `colorlevels` -> 2. `lut3d=interp=tetrahedral` -> 3. `gbrp` highlight bloom (`halation`)
 * -> 4. `unsharp` luma micro-contrast -> 5. `noise` temporal+uniform film grain.
 */
export function buildActiveGradeFilterChain(
  input: BuildActiveGradeFilterInput
): {
  videoFilter: string;
  ffmpegArgs: string[];
} {
  const defaults = BrandLookDefaultsSchema.parse(input.defaults ?? {});
  const levels =
    input.levels ??
    computeColorLevelsParams({ p1: 1.5, p99: 97.5 }, defaults);

  const stages: string[] = [];

  if (defaults.auto_levels) {
    stages.push(
      `colorlevels=rimin=${levels.rimin}:gimin=${levels.gimin}:bimin=${levels.bimin}:rimax=${levels.rimax}:gimax=${levels.gimax}:bimax=${levels.bimax}`
    );
  }

  stages.push(`lut3d=file='${input.lutPath}':interp=tetrahedral`);

  if (defaults.halation_strength > 0) {
    const h = Number(defaults.halation_strength.toFixed(4));
    stages.push(
      `format=gbrp,split[base][hi];[hi]lutyuv=y='if(gt(val,200),(val-200)*2,0)',gblur=sigma=14[glow];[base][glow]blend=all_mode=screen:all_opacity=${h},format=yuv420p`
    );
  }

  if (defaults.luma_micro_contrast > 0) {
    const amount = Number(defaults.luma_micro_contrast.toFixed(2));
    stages.push(`unsharp=5:5:${amount}:5:5:0.0`);
  }

  if (defaults.grain_strength > 0) {
    const g = Number(defaults.grain_strength.toFixed(2));
    stages.push(`noise=c0s=${g}:c0f=t+u`);
  }

  const videoFilter = stages.join(',');
  return {
    videoFilter,
    ffmpegArgs: [
      '-vf',
      videoFilter,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '14',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart'
    ]
  };
}

const PrepareColorGradeInputSchema = z.object({
  organizationId: z.string().uuid(),
  presetId: z.enum(PRESET_BRAND_LOOK_IDS).default('twings-french-blue'),
  settings: LookMatchSettingsSchema.optional(),
  lumaSample: z
    .object({
      p1: z.number().min(0).max(100),
      p99: z.number().min(0).max(100)
    })
    .optional()
});

export interface PreparedColorGradeSpec {
  organizationId: string;
  preset: PresetBrandLookSpec;
  settings: LookMatchSettings;
  levels: ColorLevelsParams;
  videoFilter: string;
  ffmpegArgs: string[];
}

/**
 * Authorized S4 colour-grading preparation entry point gated by `color_grading` feature policy.
 */
export async function prepareBrandColorGradeSpec(
  deps: { sql: SqlRunner },
  _viewer: Viewer,
  input: unknown
): Promise<BrandOutcome<{ id: string; spec: PreparedColorGradeSpec }>> {
  const parsed = PrepareColorGradeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'presetId'
    };
  }
  const { organizationId, presetId, lumaSample } = parsed.data;
  try {
    await assertBrandFeature(deps.sql, organizationId, 'color_grading');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }

  const preset = PRESET_BRAND_LOOKS[presetId];
  const settings = LookMatchSettingsSchema.parse(parsed.data.settings ?? {});
  const mergedDefaults: BrandLookDefaults = {
    ...preset.defaults,
    auto_levels: settings.auto_levels,
    halation_strength: settings.halation,
    grain_strength: settings.grain
  };
  const levels = computeColorLevelsParams(
    lumaSample ?? { p1: 2.2, p99: 96.0 },
    mergedDefaults
  );
  const { videoFilter, ffmpegArgs } = buildActiveGradeFilterChain({
    lutPath: preset.lutKey,
    levels,
    defaults: mergedDefaults
  });

  return {
    ok: true,
    id: preset.id,
    spec: {
      organizationId,
      preset,
      settings,
      levels,
      videoFilter,
      ffmpegArgs
    }
  };
}
