import { z } from 'zod';
import type { ConfirmedBrandIdentity } from '@/lib/brands/identity/schema';
import {
  SHOT_ASPECTS,
  ShotSpecSchema,
  TONAL_KEYS,
  type DeliverableMedium,
  type DeliverableUse,
  type ShotAspect,
  type ShotCutKind,
  type ShotProduct,
  type ShotReference,
  type ShotSpec,
  type ShotSubject,
  type ShotWardrobe
} from './schema';

const HexSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex colour')
  .transform((v) => v.toLowerCase() as `#${string}`);

export const TEMPERATURE_TENDENCIES = [
  'warm golden/ivory',
  'cool cyan/slate',
  'neutral'
] as const;
export type TemperatureTendency = (typeof TEMPERATURE_TENDENCIES)[number];

export const TINT_TENDENCIES = ['green foliage', 'rose/blush', 'neutral'] as const;
export type TintTendency = (typeof TINT_TENDENCIES)[number];

export const OPTICS_CLASSIFICATIONS = [
  'crisp commercial',
  'shallow editorial',
  'soft diffused',
  'balanced optical'
] as const;
export type OpticsClassification = (typeof OPTICS_CLASSIFICATIONS)[number];

/**
 * Schema for `extract_image.py` v1.0.0 (`image_analysis.json`, 40+ metrics across metadata,
 * tonal_summary, color_summary, and optics_and_texture; knowhow-corpus.md §3.1).
 */
export const ImageAnalysisSchema = z.object({
  metadata: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: z.string().trim().min(1).max(32),
    mode: z.string().trim().min(1).max(16),
    exif: z.record(z.string(), z.unknown()).optional(),
    info_keys: z.array(z.string()).default([]),
    aspect_ratio: z.object({
      exact_integer: z.string().trim().min(1).max(32),
      decimal: z.number().positive(),
      nearest_standard: z.string().trim().min(1).max(16),
      deviation_pct: z.number().min(0).max(100)
    }),
    sha256: z.string().trim().optional(),
    source_path: z.string().trim().optional(),
    embedded_text: z.string().optional()
  }),
  tonal_summary: z.object({
    key_classification: z.enum(TONAL_KEYS),
    mean_luminance: z.number().min(0).max(255),
    std_contrast: z.number().min(0).max(255),
    dynamic_range_p99_p01: z.number().min(0).max(255),
    percentiles: z.object({
      p01: z.number().min(0).max(255),
      p05_black_floor: z.number().min(0).max(255),
      p50_median: z.number().min(0).max(255),
      p95_white_shoulder: z.number().min(0).max(255),
      p99: z.number().min(0).max(255)
    }),
    zone_shares_pct: z.object({
      dark_below_64: z.number().min(0).max(100),
      mid_64_to_191: z.number().min(0).max(100),
      bright_above_191: z.number().min(0).max(100)
    }),
    tonal_hex: z.object({
      lifted_black_p05: HexSchema,
      shadow_15pct: HexSchema,
      midtone_50pct: HexSchema,
      highlight_15pct: HexSchema
    })
  }),
  color_summary: z.object({
    temperature_tendency: z.enum(TEMPERATURE_TENDENCIES),
    tint_tendency: z.enum(TINT_TENDENCIES),
    lab_a_green_magenta_shift: z.number().min(-128).max(128),
    lab_b_blue_yellow_shift: z.number().min(-128).max(128),
    midtone_lab_a_shift: z.number().min(-128).max(128),
    midtone_lab_b_shift: z.number().min(-128).max(128),
    mean_saturation_pct: z.number().min(0).max(100),
    p90_saturation_pct: z.number().min(0).max(100),
    dominant_palette: z
      .array(
        z.object({
          hex: HexSchema,
          rgb: z.tuple([
            z.number().int().min(0).max(255),
            z.number().int().min(0).max(255),
            z.number().int().min(0).max(255)
          ]),
          share_pct: z.number().min(0).max(100),
          luminance: z.number().min(0).max(255)
        })
      )
      .min(1)
      .max(6)
  }),
  optics_and_texture: z.object({
    optics_classification: z.enum(OPTICS_CLASSIFICATIONS),
    global_sharpness_laplacian: z.number().min(0),
    center_sharpness: z.number().min(0),
    periphery_sharpness: z.number().min(0),
    center_to_periphery_dof_ratio: z.number().min(0),
    bloom_halation_index: z.number().min(-5).max(10),
    grain_micro_sigma: z.number().min(0).max(20),
    quadrant_luminance: z.object({
      top_left: z.number().min(0).max(255),
      top_right: z.number().min(0).max(255),
      bottom_left: z.number().min(0).max(255),
      bottom_right: z.number().min(0).max(255)
    })
  })
});

export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

/**
 * W1 rule (knowhow-corpus.md §3.1): strip `source_path`, `sha256`, `exif`, and `embedded_text`
 * before storing or rendering an analysis-only reference in client-facing payloads.
 */
export function stripPrivateMeasurementFields(analysis: ImageAnalysis): ImageAnalysis {
  const {
    sha256: _sha,
    source_path: _src,
    exif: _exif,
    embedded_text: _txt,
    ...publicMetadata
  } = analysis.metadata;
  return {
    ...analysis,
    metadata: {
      ...publicMetadata,
      info_keys: []
    }
  };
}

/** Compute hue in degrees [0, 360) and saturation in [0, 1] from a `#rrggbb` hex string. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function isWithinOwnedHueOrNeutral(
  hex: string,
  ownedHue: readonly [number, number]
): boolean {
  const { h, s } = hexToHsl(hex);
  // Near-neutrals (saturation <= 14%) are always allowed alongside the brand's owned hue band.
  if (s <= 0.14) return true;
  return h >= ownedHue[0] && h <= ownedHue[1];
}

function coerceAspect(nearest: string): ShotAspect {
  if ((SHOT_ASPECTS as readonly string[]).includes(nearest)) {
    return nearest as ShotAspect;
  }
  return '4:5';
}

export interface MeasurementToShotSpecInput {
  brief: string;
  identity: ConfirmedBrandIdentity;
  cutKind?: ShotCutKind;
  deliverable?: {
    medium?: DeliverableMedium;
    aspect?: ShotAspect;
    use?: DeliverableUse;
  };
  references?: ShotReference[];
  subject?: ShotSubject | null;
  product?: ShotProduct | null;
  wardrobe?: ShotWardrobe | null;
  space?: Partial<ShotSpec['space']>;
  duration_s?: number;
  timeline?: ShotSpec['timeline'];
  memory_refs?: string[];
}

/**
 * Deterministically converts an `extract_image.py` 40-metric `ImageAnalysis` + `ConfirmedBrandIdentity`
 * into a validated `ShotSpec` (knowhow-corpus.md §3.1 -> §3.3).
 */
export function measurementToShotSpec(
  rawAnalysis: ImageAnalysis,
  input: MeasurementToShotSpecInput
): ShotSpec {
  const analysis = stripPrivateMeasurementFields(ImageAnalysisSchema.parse(rawAnalysis));
  const { identity } = input;
  const q = analysis.optics_and_texture.quadrant_luminance;
  const leftLuma = (q.top_left + q.bottom_left) / 2;
  const rightLuma = (q.top_right + q.bottom_right) / 2;
  const topLuma = (q.top_left + q.top_right) / 2;
  const bottomLuma = (q.bottom_left + q.bottom_right) / 2;

  const keySide =
    Math.abs(leftLuma - rightLuma) < 6
      ? 'frontal-centered'
      : leftLuma > rightLuma
        ? 'camera-left'
        : 'camera-right';
  const keyHeight =
    topLuma >= bottomLuma + 8
      ? 'slightly above eye-level'
      : bottomLuma > topLuma + 8
        ? 'low-angle bounce'
        : 'eye-level';

  const modifier =
    analysis.optics_and_texture.optics_classification === 'crisp commercial'
      ? 'focused gridded strip'
      : analysis.optics_and_texture.optics_classification === 'soft diffused'
        ? 'overhead silk scrim'
        : 'large strip softbox';

  const colourK =
    analysis.color_summary.temperature_tendency === 'warm golden/ivory'
      ? 4800
      : analysis.color_summary.temperature_tendency === 'cool cyan/slate'
        ? 6200
        : 5600;

  const dof = analysis.optics_and_texture.center_to_periphery_dof_ratio;
  const aperture = dof >= 2.2 ? 'f/2.8' : dof >= 1.5 ? 'f/4' : 'f/5.6';
  const focalMm =
    analysis.optics_and_texture.optics_classification === 'shallow editorial' ? 85 : 50;

  const rawSwatches = analysis.color_summary.dominant_palette.map((s) => s.hex);
  const filteredSwatches = identity.rules.paletteOnly
    ? rawSwatches.filter((hex) => isWithinOwnedHueOrNeutral(hex, identity.world.ownedHue))
    : rawSwatches;

  const paletteHexes = Array.from(
    new Set([
      ...filteredSwatches,
      identity.colour.canvas,
      identity.colour.sky,
      identity.colour.accent,
      identity.colour.ink
    ])
  ).slice(0, 6) as `#${string}`[];

  const exclusions = Array.from(
    new Set([
      'text',
      'watermark',
      'logo',
      'beauty-filter smoothing',
      'visible blush',
      ...identity.rules.forbiddenTerms,
      ...identity.voice.forbiddenWords
    ])
  ).slice(0, 30);

  const aspect =
    input.deliverable?.aspect ?? coerceAspect(analysis.metadata.aspect_ratio.nearest_standard);
  const medium: DeliverableMedium =
    input.deliverable?.medium ??
    (input.cutKind === 'short_film_clip' || input.cutKind === 'video_object_replace'
      ? 'short film'
      : input.subject
        ? 'editorial still'
        : 'product still');

  const analysisRef: ShotReference = {
    asset_id: 'ref_measured_analysis',
    role: 'analysis-only',
    controls: ['lighting-ratio', 'tonal-anchors', 'depth-of-field'],
    ignore: ['subject-identity', 'brand-mark', 'garment-design'],
    measured: analysis as unknown as Record<string, unknown>
  };

  return ShotSpecSchema.parse({
    brief: input.brief,
    cutKind: input.cutKind ?? (input.subject ? 'editorial_full_body' : 'reference_exact_product'),
    deliverable: {
      medium,
      aspect,
      use: input.deliverable?.use ?? (medium === 'short film' ? 'reel' : 'feed')
    },
    references: [...(input.references ?? []), analysisRef],
    subject: input.subject ?? null,
    product: input.product ?? null,
    wardrobe: input.wardrobe ?? null,
    space: {
      foreground: input.space?.foreground ?? 'clean unobstructed foreground plane',
      midground: input.space?.midground ?? 'primary subject anchored on clean studio plane',
      background: input.space?.background ?? 'architectural matte paper backdrop with soft tonal gradient',
      surface: input.space?.surface ?? 'seamless matte paper'
    },
    camera: {
      focal_mm: focalMm,
      distance_m: focalMm >= 85 ? 3.2 : 2.2,
      tilt_deg: 0,
      height: 'shoulder',
      ...(input.subject ? { head_y_pct: 35 } : {}),
      subject_width_pct: input.subject ? 24 : 32,
      margin_pct: 15,
      aperture,
      dof_ratio: Math.max(0.5, Math.min(12, Number(dof.toFixed(2))))
    },
    light: {
      key: {
        modifier,
        side: keySide,
        height: keyHeight,
        distance: 'close',
        effect: 'controlled directional highlight roll-off without clipping'
      },
      fill:
        keySide === 'camera-left'
          ? 'white bounce card camera-right, one stop under'
          : 'white bounce card camera-left, one stop under',
      colour_k: colourK
    },
    tone: {
      key_classification: analysis.tonal_summary.key_classification,
      lifted_black_hex: analysis.tonal_summary.tonal_hex.lifted_black_p05,
      shadow_hex: analysis.tonal_summary.tonal_hex.shadow_15pct,
      mid_hex: analysis.tonal_summary.tonal_hex.midtone_50pct,
      highlight_hex: analysis.tonal_summary.tonal_hex.highlight_15pct,
      saturation_pct: Math.round(analysis.color_summary.mean_saturation_pct),
      shadow_share_pct: Math.round(
        analysis.tonal_summary.zone_shares_pct.dark_below_64 +
          analysis.tonal_summary.zone_shares_pct.mid_64_to_191 * 0.5
      ),
      halation: Math.max(
        0,
        Math.min(2, Number(Math.max(0, analysis.optics_and_texture.bloom_halation_index * 0.25).toFixed(2)))
      ),
      grain_sigma: Math.max(
        0,
        Math.min(8, Number(analysis.optics_and_texture.grain_micro_sigma.toFixed(2)))
      )
    },
    palette: {
      world: 'blue',
      hex_values: paletteHexes,
      warm_notes: ['skin', 'lips']
    },
    ...(input.timeline ? { timeline: input.timeline } : {}),
    ...(input.duration_s ? { duration_s: input.duration_s } : {}),
    skin_contract: true,
    equipment_names: false,
    exclusions,
    memory_refs: input.memory_refs ?? []
  });
}
