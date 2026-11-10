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

/**
 * Customer-safe labels for `ShotCutKind` (never exposes internal model/engine IDs on customer surfaces).
 */
export const SHOT_CUT_KIND_LABELS: Record<
  ShotCutKind,
  { code: string; ko: string; en: string; roleKo: string; roleEn: string }
> = {
  editorial_full_body: {
    code: 'editorial_full_body',
    ko: '에디토리얼 전신·룩북',
    en: 'Editorial Full-Body Look',
    roleKo: '의상 비대칭 실루엣과 공간 무드 중심 에디토리얼 스틸',
    roleEn: 'Garment silhouette and atmospheric editorial still'
  },
  reference_exact_product: {
    code: 'reference_exact_product',
    ko: '제품 정밀 보존 컷',
    en: 'Reference-Exact Product Cut',
    roleKo: '용기 기하·라벨·재질 굴절률 고정 제품 스틸',
    roleEn: 'Vessel geometry, label lock, and material finish precision still'
  },
  logo_mark_preserve: {
    code: 'logo_mark_preserve',
    ko: '로고·마크 정밀 보존',
    en: 'Logo & Mark Preservation',
    roleKo: '원본 로고 철자와 그래픽 비례 고정',
    roleEn: 'Preserves exact logo spelling and mark geometry'
  },
  person_portrait: {
    code: 'person_portrait',
    ko: '인물 포트레이트 (사전 동의)',
    en: 'Consented Portrait Close-up',
    roleKo: '사전 동의 인물 기준 매트 피부 질감·광원 보호',
    roleEn: 'Matte skin reflectance and key light protected for consented talent'
  },
  typography_layout: {
    code: 'typography_layout',
    ko: '타이포그래피·레이아웃 카드',
    en: 'Typography & Layout Card',
    roleKo: '브랜드 서체 위계·지정 문구·여백 그리드 고정',
    roleEn: 'Exact quoted typography, brand hex palette, and grid hierarchy'
  },
  seedance_start_frame: {
    code: 'opening_keyframe',
    ko: '필름 시작 프레임 (키프레임)',
    en: 'Film Opening Keyframe',
    roleKo: '숏필름 도입부 구도·색 대역·할레이션 고정 프레임',
    roleEn: 'Opening composition, colour world, and halation keyframe'
  },
  short_film_clip: {
    code: 'short_film_clip',
    ko: '타임라인 숏필름 클립',
    en: 'Timeline Short Film Clip',
    roleKo: '샷 단위 타임라인 컷·카메라 궤적·제품 형태 유지',
    roleEn: 'Timeline shot cuts, camera trajectory, and product lock'
  },
  video_object_replace: {
    code: 'video_object_replace',
    ko: '영상 오브젝트 교체',
    en: 'Video Object Replacement',
    roleKo: '기존 카메라 모션 유지 + 지정 제품·의상 교체',
    roleEn: 'Motion-preserving video edit with product or wardrobe injection'
  }
};

export const PUBLIC_CUT_KIND_CODES = [
  'editorial_full_body',
  'reference_exact_product',
  'logo_mark_preserve',
  'person_portrait',
  'typography_layout',
  'opening_keyframe',
  'short_film_clip',
  'video_object_replace'
] as const;

export type PublicCutKindCode = (typeof PUBLIC_CUT_KIND_CODES)[number];

export function resolveInternalCutKind(
  input: ShotCutKind | PublicCutKindCode
): ShotCutKind {
  return input === 'opening_keyframe' ? 'seedance_start_frame' : input;
}

export type CustomerGrammarCode =
  | 'G1_structured_blocks'
  | 'G2_identity_composition_lock'
  | 'G3_reference_paragraphs'
  | 'G4_camera_first_optics'
  | 'G5_editorial_atmosphere'
  | 'G6_typography_grid'
  | 'G7_timeline_film';

/**
 * Customer-facing brief view stripped of raw internal engine/model identifiers.
 */
export interface CustomerBriefView {
  id: string;
  organizationId: string;
  stage: 'draft' | 'approved' | 'final';
  round: number;
  maxRounds: number;
  lastChangedAxis:
    | 'light'
    | 'camera'
    | 'space'
    | 'tone'
    | 'palette'
    | 'subject'
    | 'product'
    | 'wardrobe'
    | 'references'
    | 'deliverable'
    | 'timeline'
    | 'brief'
    | 'exclusions'
    | null;
  identitySource: 'confirmed' | 'default_fallback';
  cutKindCode: string;
  cutKindLabel: { ko: string; en: string; roleKo: string; roleEn: string };
  deliverable: ShotSpec['deliverable'];
  grammarCode: CustomerGrammarCode;
  grammarLabel: { ko: string; en: string };
  prompt: string;
  renderStage: 'draft' | 'approved' | 'final';
  resolution: '480p' | '720p' | '1080p' | '2k' | '4k';
  draftFlag: boolean;
  bitrateMode: 'high' | 'standard';
  lint: Array<{
    rule: string;
    severity: 'error' | 'warn';
    text: string;
  }>;
  lockedSpecHash: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
  updatedAt: string;
  directionCascade?: {
    mode: 'base_inherited' | 'project_override';
    projectId: string | null;
    projectTitle: string | null;
    lockedFromBase: string[];
    overriddenByProject: string[];
    isolateProjectMemory: boolean;
  };
  principleAttachment?: {
    mode: 'full_attach' | 'custom_partial' | 'unbound_free';
    attachedKeys: string[];
    detachedKeys: string[];
  };
}
