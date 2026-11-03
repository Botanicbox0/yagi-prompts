import { z } from 'zod';

export const SHOT_CUT_KINDS = [
  'editorial_full_body',
  'reference_exact_product',
  'logo_mark_preserve',
  'person_portrait',
  'typography_layout',
  'seedance_start_frame',
  'short_film_clip',
  'video_object_replace'
] as const;
export type ShotCutKind = (typeof SHOT_CUT_KINDS)[number];

export const DELIVERABLE_MEDIUMS = [
  'editorial still',
  'product still',
  'typography card',
  'short film'
] as const;
export type DeliverableMedium = (typeof DELIVERABLE_MEDIUMS)[number];

export const SHOT_ASPECTS = ['1:1', '4:5', '3:4', '16:9', '9:16', '21:9'] as const;
export type ShotAspect = (typeof SHOT_ASPECTS)[number];

export const DELIVERABLE_USES = ['feed', 'reel', 'hero', 'catalog', 'story'] as const;
export type DeliverableUse = (typeof DELIVERABLE_USES)[number];

export const SHOT_REFERENCE_ROLES = [
  'identity',
  'product',
  'scene',
  'pose',
  'style',
  'palette',
  'analysis-only'
] as const;
export type ShotReferenceRole = (typeof SHOT_REFERENCE_ROLES)[number];

export const TONAL_KEYS = [
  'high-key veiled',
  'bright editorial lifted',
  'low-contrast filmic',
  'chiaroscuro',
  'low-key',
  'balanced'
] as const;
export type TonalKeyClassification = (typeof TONAL_KEYS)[number];

export const TIMELINE_EDITS = ['hard cut', 'match cut', 'continuous'] as const;
export type TimelineEdit = (typeof TIMELINE_EDITS)[number];

const HexSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex colour')
  .transform((v) => v.toLowerCase() as `#${string}`);

export const ShotReferenceSchema = z.object({
  asset_id: z.string().trim().min(1).max(160),
  role: z.enum(SHOT_REFERENCE_ROLES),
  /** Required true when `role === 'identity'` under brand rules (`consentedFacesOnly`). */
  consented: z.boolean().optional(),
  controls: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  ignore: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  measured: z.record(z.string(), z.unknown()).optional()
});
export type ShotReference = z.infer<typeof ShotReferenceSchema>;

export const ShotPoseSchema = z.object({
  torso_deg: z.number().min(-180).max(180).default(0),
  head_tilt: z.string().trim().min(1).max(80).default('neutral'),
  gaze: z.string().trim().min(1).max(120).default('camera'),
  hands: z.string().trim().min(1).max(160).default('relaxed at sides')
});

export const ShotSubjectSchema = z.object({
  kind: z.enum(['fictional', 'consented_creator']).default('fictional'),
  cast_id: z.string().trim().min(1).max(120).optional(),
  age_band: z.string().trim().min(1).max(40).default('20s'),
  hair: z.string().trim().min(1).max(120).default('natural'),
  pose: ShotPoseSchema
});
export type ShotSubject = z.infer<typeof ShotSubjectSchema>;

export const ShotProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  vessel_geometry: z.string().trim().min(1).max(240),
  label_lock: z.string().trim().min(1).max(240),
  material_finish: z.string().trim().min(1).max(240)
});
export type ShotProduct = z.infer<typeof ShotProductSchema>;

export const ShotWardrobeSchema = z.object({
  silhouette: z.string().trim().min(1).max(200),
  fabric: z.string().trim().min(1).max(200),
  construction: z.string().trim().min(1).max(200),
  lock: z.boolean().default(true)
});
export type ShotWardrobe = z.infer<typeof ShotWardrobeSchema>;

export const ShotSpaceSchema = z.object({
  foreground: z.string().trim().min(1).max(200).default('clean unobstructed foreground'),
  midground: z.string().trim().min(1).max(200),
  background: z.string().trim().min(1).max(200),
  surface: z.string().trim().min(1).max(160).default('matte architectural surface')
});
export type ShotSpace = z.infer<typeof ShotSpaceSchema>;

export const ShotCameraSchema = z.object({
  focal_mm: z.number().int().min(14).max(200).default(85),
  distance_m: z.number().min(0.3).max(30).default(2.5),
  tilt_deg: z.number().min(-45).max(45).default(0),
  height: z.string().trim().min(1).max(80).default('eye-level'),
  head_y_pct: z.number().min(5).max(95).optional(),
  subject_width_pct: z.number().min(5).max(90).default(28),
  margin_pct: z.number().min(5).max(40).default(15),
  aperture: z.string().trim().min(1).max(24).default('f/4'),
  dof_ratio: z.number().min(0.5).max(12).default(2.0)
});
export type ShotCamera = z.infer<typeof ShotCameraSchema>;

export const ShotLightKeySchema = z.object({
  modifier: z.string().trim().min(1).max(120).default('large diffused softbox'),
  side: z.string().trim().min(1).max(80).default('camera-left'),
  height: z.string().trim().min(1).max(80).default('slightly above eye-level'),
  distance: z.string().trim().min(1).max(80).default('medium'),
  effect: z.string().trim().min(1).max(200).default('soft directional falloff across the subject')
});

export const ShotLightSchema = z.object({
  key: ShotLightKeySchema,
  fill: z.string().trim().min(1).max(160).default('white bounce card camera-right, one stop under'),
  colour_k: z.number().int().min(2500).max(9000).default(5600)
});
export type ShotLight = z.infer<typeof ShotLightSchema>;

export const ShotToneSchema = z.object({
  key_classification: z.enum(TONAL_KEYS).default('balanced'),
  lifted_black_hex: HexSchema,
  shadow_hex: HexSchema,
  mid_hex: HexSchema,
  highlight_hex: HexSchema,
  saturation_pct: z.number().min(0).max(100).default(24),
  shadow_share_pct: z.number().min(0).max(100).default(35),
  halation: z.number().min(0).max(2).default(0.15),
  grain_sigma: z.number().min(0).max(8).default(1.4)
});
export type ShotTone = z.infer<typeof ShotToneSchema>;

export const ShotPaletteSchema = z.object({
  world: z.string().trim().min(1).max(80).default('blue'),
  hex_values: z.array(HexSchema).min(1).max(8),
  warm_notes: z.array(z.string().trim().min(1).max(60)).max(6).default(['skin', 'lips'])
});
export type ShotPalette = z.infer<typeof ShotPaletteSchema>;

export const TimelineAudioSchema = z.object({
  music: z.string().trim().min(1).max(200).optional(),
  sfx: z.string().trim().min(1).max(200).optional(),
  dialogue: z
    .object({
      speaker: z.string().trim().min(1).max(60),
      language: z.string().trim().min(1).max(40).default('Korean'),
      tone: z.string().trim().min(1).max(60).default('quietly'),
      line: z.string().trim().min(1).max(240)
    })
    .optional(),
  on_screen_text: z.string().trim().min(1).max(120).optional(),
  no_bgm: z.boolean().optional()
});
export type TimelineAudio = z.infer<typeof TimelineAudioSchema>;

export const TimelineShotSchema = z.object({
  shot: z.number().int().min(1).max(20),
  start: z.number().min(0).max(30),
  end: z.number().min(0.1).max(30),
  edit: z.enum(TIMELINE_EDITS).default('hard cut'),
  focal_mm: z.number().int().min(14).max(200).default(50),
  camera: z.string().trim().min(1).max(240),
  action: z.string().trim().min(1).max(320),
  audio: TimelineAudioSchema.optional()
});
export type TimelineShot = z.infer<typeof TimelineShotSchema>;

export const ShotEngineSelectionSchema = z.object({
  id: z.string().trim().min(1).max(60),
  resolution: z.enum(['480p', '720p', '1080p', '1k', '2k', '4k']).default('2k')
});

export const ShotSpecSchema = z.object({
  brief: z.string().trim().min(1).max(600),
  cutKind: z.enum(SHOT_CUT_KINDS).default('reference_exact_product'),
  deliverable: z.object({
    medium: z.enum(DELIVERABLE_MEDIUMS),
    aspect: z.enum(SHOT_ASPECTS),
    use: z.enum(DELIVERABLE_USES).default('feed')
  }),
  references: z.array(ShotReferenceSchema).max(14).default([]),
  /** Null/omitted on faceless product, architectural, or typography shots. */
  subject: ShotSubjectSchema.nullable().optional(),
  product: ShotProductSchema.nullable().optional(),
  wardrobe: ShotWardrobeSchema.nullable().optional(),
  space: ShotSpaceSchema,
  camera: ShotCameraSchema,
  light: ShotLightSchema,
  tone: ShotToneSchema,
  palette: ShotPaletteSchema,
  timeline: z.array(TimelineShotSchema).max(15).optional(),
  duration_s: z.number().int().min(3).max(30).optional(),
  skin_contract: z.boolean().default(true),
  equipment_names: z.literal(false).default(false),
  exclusions: z
    .array(z.string().trim().min(1).max(120))
    .max(30)
    .default(['text', 'watermark', 'logo', 'beauty-filter smoothing', 'visible blush']),
  engine: ShotEngineSelectionSchema.optional(),
  memory_refs: z.array(z.string().trim().min(1).max(160)).max(30).default([])
});

export type ShotSpec = z.infer<typeof ShotSpecSchema>;

/** True when the ShotSpec includes a person (either `subject` or an `'identity'` reference). */
export function shotHasPerson(spec: Pick<ShotSpec, 'subject' | 'references' | 'cutKind'>): boolean {
  if (spec.subject !== null && spec.subject !== undefined) return true;
  if (spec.references.some((ref) => ref.role === 'identity')) return true;
  if (spec.cutKind === 'person_portrait') return true;
  return false;
}
