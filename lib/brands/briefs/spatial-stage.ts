import { z } from 'zod';
import type { ConfirmedBrandIdentity } from '@/lib/brands/identity/schema';
import {
  SHOT_ASPECTS,
  SHOT_REFERENCE_ROLES,
  ShotSpecSchema,
  type ShotAspect,
  type ShotReferenceRole,
  type ShotSpec,
} from './schema';

/**
 * ArtCraft-inspired Pre-Render 2D Spatial Stage & Multi-Asset Layer Composer (`spatial-stage.ts`)
 *
 * Adapted to TWINGS Brand Studio:
 * - Interactive 2D stage for blocking Subject `(x%, y%, height%, torso°, off-axis eyeline)`,
 *   Hero Product `(x%, y%, scale%, palm-scale lock)`, Optional Foreground Occluder,
 *   Camera Rig `(focal mm, distance m, angle preset, aperture)`,
 *   3-Point Light Vector `(azimuth°, elevation°, modifier, fill ratio, K)`,
 *   and Multi-Asset Reference Layer Stack (`@Image 1..4`) with single-authority role locks
 *   (`controls[]` vs `ignore[]`) so references never cross-contaminate.
 * - Customer-safe: never exposes internal model or engine names.
 */

export const EyelineDirectionSchema = z.enum([
  'off_axis_12deg_left',
  'off_axis_12deg_right',
  'downward_product_gaze',
  'horizon_editorial',
]);
export type EyelineDirection = z.infer<typeof EyelineDirectionSchema>;

export const SpatialCameraAngleSchema = z.enum([
  'eye_level',
  'three_quarter_18',
  'three_quarter_45',
  'side_profile_90',
  'over_the_shoulder',
  'low_angle',
  'high_angle_diagonal',
]);
export type SpatialCameraAngle = z.infer<typeof SpatialCameraAngleSchema>;

export const SpatialSubjectNodeSchema = z.object({
  enabled: z.boolean().default(true),
  label: z.string().trim().min(1).max(80).default('주인공 인물'),
  /** Horizontal stage coordinate in % (10..90). */
  xPct: z.number().min(10).max(90).default(44),
  /** Vertical stage coordinate in % (15..88). */
  yPct: z.number().min(15).max(88).default(52),
  /** Frame height occupancy in % — auto-clamped to 35..50% for dynamic scenes to prevent body clipping. */
  frameHeightPct: z.number().int().min(25).max(75).default(44),
  /** Torso orientation angle in degrees (-65..65). Non-zero prevents frontal passport-photo lock. */
  torsoAngleDeg: z.number().int().min(-65).max(65).default(24),
  eyeline: EyelineDirectionSchema.default('off_axis_12deg_right'),
  microActingCue: z
    .string()
    .trim()
    .min(4)
    .max(200)
    .default('입술 1~2mm 자연스러운 이완, 턱선 긴장 해제, 렌즈 비응시 오프축 시선'),
});
export type SpatialSubjectNode = z.infer<typeof SpatialSubjectNodeSchema>;

export const SpatialProductNodeSchema = z.object({
  enabled: z.boolean().default(true),
  label: z.string().trim().min(1).max(80).default('히어로 제품 (실측 고정)'),
  xPct: z.number().min(10).max(90).default(62),
  yPct: z.number().min(15).max(90).default(64),
  /** Relative visual footprint in % (8..55). */
  scalePct: z.number().min(8).max(55).default(22),
  /** Locks product geometry to 50mL palm-sized physical proportions (prevents giant bottle artifacts). */
  palmScaleLocked: z.boolean().default(true),
  surfaceAnchor: z
    .enum(['hand_held_3finger', 'travertine_plinth', 'brushed_steel_table', 'floating_macro_rig'])
    .default('hand_held_3finger'),
  materialCallout: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .default('크림프 넥 황동 링 · 굴절 유리 보틀 · 무광 보드지 라벨 엠보싱 고정'),
});
export type SpatialProductNode = z.infer<typeof SpatialProductNodeSchema>;

export const SpatialOccluderNodeSchema = z.object({
  enabled: z.boolean().default(true),
  label: z.string().trim().min(1).max(80).default('전경 보케 레이어 (깊이감 형성)'),
  xPct: z.number().min(0).max(100).default(18),
  yPct: z.number().min(0).max(100).default(74),
  blurStrength: z.enum(['subtle_f4', 'creamy_f2', 'anamorphic_streak']).default('creamy_f2'),
});
export type SpatialOccluderNode = z.infer<typeof SpatialOccluderNodeSchema>;

export const SpatialCameraRigSchema = z.object({
  focal_mm: z.number().int().min(14).max(200).default(85),
  aperture: z.string().trim().min(2).max(16).default('f/2.8'),
  angle: SpatialCameraAngleSchema.default('three_quarter_45'),
  distance_m: z.number().min(0.4).max(15).default(1.8),
  height_bias: z.enum(['eye_level', 'slightly_low', 'slightly_high']).default('eye_level'),
});
export type SpatialCameraRig = z.infer<typeof SpatialCameraRigSchema>;

export const SpatialLightRigSchema = z.object({
  /** Key light azimuth on top-down radar (0° = front, -45° = camera-left 45°, +45° = camera-right 45°). */
  keyAzimuthDeg: z.number().int().min(-175).max(175).default(-42),
  /** Key light elevation in degrees (10..80). */
  keyElevationDeg: z.number().int().min(10).max(80).default(34),
  modifier: z
    .enum([
      'octabox_120cm_grid',
      'scrim_diffused_window',
      'fresnel_barn_door',
      'overhead_silk_butterfly',
    ])
    .default('octabox_120cm_grid'),
  /** Negative fill ratio in stops (-0.5 to -3.0). */
  fillRatioStop: z.number().min(-3.0).max(-0.5).default(-1.5),
  rimBacklightEnabled: z.boolean().default(true),
  colourTempK: z.number().int().min(2700).max(6500).default(5200),
  /** Enforces single-light-source shadow direction across subject and background (Anti-Composite Law). */
  antiCompositeLock: z.boolean().default(true),
});
export type SpatialLightRig = z.infer<typeof SpatialLightRigSchema>;

export const SpatialReferenceSlotSchema = z.object({
  slotIndex: z.number().int().min(1).max(4),
  tag: z.enum(['@Image1', '@Image2', '@Image3', '@Image4']),
  role: z.enum(SHOT_REFERENCE_ROLES),
  assetTitle: z.string().trim().min(1).max(120),
  consented: z.boolean().optional(),
  controls: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
  ignore: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
});
export type SpatialReferenceSlot = z.infer<typeof SpatialReferenceSlotSchema>;

export const SpatialStageSpecSchema = z.object({
  presetId: z.string().trim().min(1).max(64).default('editorial_duo_stage'),
  title: z.string().trim().min(1).max(120).default('2D 공간 블로킹 & 멀티 레퍼런스 스테이지'),
  aspectRatio: z.enum(SHOT_ASPECTS).default('9:16'),
  dynamicMotionScene: z.boolean().default(true),
  subject: SpatialSubjectNodeSchema.default(() =>
    SpatialSubjectNodeSchema.parse({}),
  ),
  product: SpatialProductNodeSchema.default(() =>
    SpatialProductNodeSchema.parse({}),
  ),
  occluder: SpatialOccluderNodeSchema.default(() =>
    SpatialOccluderNodeSchema.parse({}),
  ),
  camera: SpatialCameraRigSchema.default(() =>
    SpatialCameraRigSchema.parse({}),
  ),
  lightRig: SpatialLightRigSchema.default(() =>
    SpatialLightRigSchema.parse({}),
  ),
  referenceStack: z
    .array(SpatialReferenceSlotSchema)
    .min(1)
    .max(4)
    .default([
      {
        slotIndex: 1,
        tag: '@Image1',
        role: 'identity',
        assetTitle: '브랜드 뮤즈 마스터 시트',
        consented: true,
        controls: ['얼굴 골격 · 피부 언더톤 · 헤어라인 고정'],
        ignore: ['배경 공간 · 기존 조명 색온도 무시'],
      },
      {
        slotIndex: 2,
        tag: '@Image2',
        role: 'product',
        assetTitle: '히어로 제품 정밀 팩샷 (원본 에셋)',
        controls: ['보틀 실루엣 · 황동 넥 링 · 타이포그래피 1:1 고정'],
        ignore: ['스튜디오 흰 배경 · 그림자 무시'],
      },
      {
        slotIndex: 3,
        tag: '@Image3',
        role: 'scene',
        assetTitle: '성수 플래그십 트래버틴 라운지 플레이트',
        controls: ['석재 질감 · 깊이감 · 건축 몰딩 구조만 참조'],
        ignore: ['기존 가구 배치 · 인물 유무 무시'],
      },
    ]),
});
export type SpatialStageSpec = z.infer<typeof SpatialStageSpecSchema>;

export interface SpatialStageCompileResult {
  normalizedSpec: SpatialStageSpec;
  shotSpec: ShotSpec;
  /** Ready-to-render spatial blocking directive in Korean & English. */
  spatialPromptKo: string;
  spatialPromptEn: string;
  /** Geometry & reference separation diagnostics. */
  diagnostics: {
    subjectProductDistancePct: number;
    frameHeightSafe: boolean;
    frontalLockAvoided: boolean;
    referenceRoleUnique: boolean;
    antiCompositeLightingVerified: boolean;
    warnings: string[];
  };
}

export const SPATIAL_STAGE_PRESETS: ReadonlyArray<{
  id: string;
  labelKo: string;
  summaryKo: string;
  spec: SpatialStageSpec;
}> = [
  {
    id: 'editorial_duo_stage',
    labelKo: '에디토리얼 인물 + 손 파지 제품 (85mm · 45° 오프축)',
    summaryKo:
      '인물 좌측 44% 배치 · 토르소 24° 회전 · 우측 하단 62% 손 파지 제품(50mL 실측 잠금) · 좌측 전경 보케 레이어',
    spec: SpatialStageSpecSchema.parse({
      presetId: 'editorial_duo_stage',
      title: '에디토리얼 인물 + 손 파지 제품 블로킹',
      aspectRatio: '9:16',
      dynamicMotionScene: true,
    }),
  },
  {
    id: 'macro_plinth_stage',
    labelKo: '트래버틴 석재 단상 클로즈업 + 배경 인물 실루엣 (100mm 매크로)',
    summaryKo:
      '제품 정중앙 하단(54%, 66%) 전면 배치 · 인물 후경 오프축 보케 배치 · 황동 크림프 넥과 유리 굴절 강조',
    spec: SpatialStageSpecSchema.parse({
      presetId: 'macro_plinth_stage',
      title: '트래버틴 단상 매크로 제품 + 후경 인물 레이어',
      aspectRatio: '4:5',
      dynamicMotionScene: false,
      subject: {
        enabled: true,
        label: '후경 인물 실루엣 (보케)',
        xPct: 34,
        yPct: 38,
        frameHeightPct: 42,
        torsoAngleDeg: 32,
        eyeline: 'downward_product_gaze',
        microActingCue: '제품 단상을 향한 차분한 하향 시선, 입술 1mm 이완',
      },
      product: {
        enabled: true,
        label: '히어로 향수 보틀 (트래버틴 단상)',
        xPct: 54,
        yPct: 66,
        scalePct: 34,
        palmScaleLocked: true,
        surfaceAnchor: 'travertine_plinth',
        materialCallout: '보틀 하단 접촉 그림자 · 황동 넥 반사 · 액체 메니스커스 굴절',
      },
      camera: {
        focal_mm: 100,
        aperture: 'f/2.8',
        angle: 'low_angle',
        distance_m: 0.9,
        height_bias: 'slightly_low',
      },
      lightRig: {
        keyAzimuthDeg: -58,
        keyElevationDeg: 28,
        modifier: 'scrim_diffused_window',
        fillRatioStop: -2.0,
        rimBacklightEnabled: true,
        colourTempK: 5000,
        antiCompositeLock: true,
      },
    }),
  },
  {
    id: 'runway_depth_stage',
    labelKo: '워킹 미드와이드 전신 구도 (50mm · 35~45% 안전 비율)',
    summaryKo:
      '인물 화면 높이 42% 강제 캡(머리·발 잘림 원천 차단) · 상하단 15% 여백 · 전경 건축 기둥 오클루더로 입체감 확보',
    spec: SpatialStageSpecSchema.parse({
      presetId: 'runway_depth_stage',
      title: '워킹 미드와이드 3레이어 깊이 블로킹',
      aspectRatio: '9:16',
      dynamicMotionScene: true,
      subject: {
        enabled: true,
        label: '워킹 주인공 (Mid-Wide)',
        xPct: 44,
        yPct: 48,
        frameHeightPct: 42,
        torsoAngleDeg: -22,
        eyeline: 'off_axis_12deg_left',
        microActingCue: '자연스러운 보폭 이동, 코트 자락 미세 흔들림, 렌즈 비응시 시선',
      },
      product: {
        enabled: true,
        label: '크로스바디 가죽 제품 파지',
        xPct: 60,
        yPct: 62,
        scalePct: 16,
        palmScaleLocked: true,
        surfaceAnchor: 'hand_held_3finger',
        materialCallout: '가죽 스티치 결 · 무광 버클 금속 반사 유지',
      },
      camera: {
        focal_mm: 50,
        aperture: 'f/4',
        angle: 'three_quarter_45',
        distance_m: 3.4,
        height_bias: 'eye_level',
      },
    }),
  },
];

function quadrantDescriptionKo(xPct: number, yPct: number): string {
  const horiz = xPct < 40 ? '좌측 3분할선' : xPct > 60 ? '우측 3분할선' : '중앙 축';
  const vert = yPct < 40 ? '상단' : yPct > 62 ? '하단' : '중단';
  return `${horiz} ${vert} (${Math.round(xPct)}%, ${Math.round(yPct)}%)`;
}

/**
 * Normalizes and compiles a 2D Spatial Stage specification into a deterministic `ShotSpec`
 * and bilingual spatial blocking prompts while enforcing TWINGS physical & composition guards.
 */
export function compileSpatialStageToShotSpec(
  input: SpatialStageSpec,
  identity?: ConfirmedBrandIdentity
): SpatialStageCompileResult {
  const parsed = SpatialStageSpecSchema.parse(input);
  const warnings: string[] = [];

  // 0. Prevent empty stage crash: if both subject and product are disabled, re-enable hero product
  const ensureProductEnabled =
    !parsed.subject.enabled && !parsed.product.enabled ? true : parsed.product.enabled;
  if (!parsed.subject.enabled && !parsed.product.enabled) {
    warnings.push(
      '인물과 제품 레이어가 모두 비활성화되어 최소 피사체 보장을 위해 히어로 제품 레이어를 자동 활성화했습니다.',
    );
  }

  // 1. Dynamic scene Mid-Wide height guard (35..50%)
  let safeHeightPct = parsed.subject.frameHeightPct;
  if (parsed.dynamicMotionScene && safeHeightPct > 50) {
    safeHeightPct = 46;
    warnings.push(
      '동적 모션 장면에서 인물 크기가 50%를 초과해 머리·발 잘림 방지를 위해 46% 미드와이드 안전 비율로 자동 보정했습니다.',
    );
  } else if (parsed.dynamicMotionScene && safeHeightPct < 35) {
    safeHeightPct = 36;
  }

  // 2. Anti-Frontal-Lock guard (avoid dead-on 0° passport pose unless explicitly macro)
  let safeTorsoDeg = parsed.subject.torsoAngleDeg;
  let safeCameraAngle: SpatialCameraAngle = parsed.camera.angle;
  if (Math.abs(safeTorsoDeg) < 10) {
    safeTorsoDeg = safeTorsoDeg < 0 ? -18 : 18;
    warnings.push(
      '정면 증명사진 경직(Frontal Lock) 방지를 위해 인물 토르소 각도를 18° 오프축으로 자동 보정했습니다.',
    );
  }
  if (safeCameraAngle === 'eye_level') {
    safeCameraAngle = 'three_quarter_45';
  }

  // 3. Enforce unique roles across `@Image 1..4` reference slots
  const usedRoles = new Set<ShotReferenceRole>();
  const dedupedStack: SpatialReferenceSlot[] = [];
  for (const slot of parsed.referenceStack) {
    if (usedRoles.has(slot.role)) {
      warnings.push(
        `${slot.tag}(${slot.assetTitle})의 역할(${slot.role})이 중복되어 단일 역할 분리 원칙에 따라 통합했습니다.`,
      );
      continue;
    }
    usedRoles.add(slot.role);
    dedupedStack.push(slot);
  }

  const normalizedSpec: SpatialStageSpec = {
    ...parsed,
    subject: {
      ...parsed.subject,
      frameHeightPct: safeHeightPct,
      torsoAngleDeg: safeTorsoDeg,
    },
    product: {
      ...parsed.product,
      enabled: ensureProductEnabled,
    },
    camera: {
      ...parsed.camera,
      angle: safeCameraAngle,
    },
    referenceStack: dedupedStack.map((item, idx) => ({
      ...item,
      slotIndex: idx + 1,
      tag: `@Image${idx + 1}` as '@Image1' | '@Image2' | '@Image3' | '@Image4',
    })),
  };

  const dx = normalizedSpec.subject.xPct - normalizedSpec.product.xPct;
  const dy = normalizedSpec.subject.yPct - normalizedSpec.product.yPct;
  const subjectProductDistancePct = Number(Math.hypot(dx, dy).toFixed(1));

  if (
    normalizedSpec.subject.enabled &&
    normalizedSpec.product.enabled &&
    subjectProductDistancePct < 10
  ) {
    warnings.push(
      '인물 노드와 제품 노드가 너무 가깝습니다(10% 미만). 얼굴 가림 방지를 위해 제품 위치를 하단 또는 측면으로 12% 이상 분리하는 것을 권장합니다.',
    );
  }

  const subjectPosKo = quadrantDescriptionKo(
    normalizedSpec.subject.xPct,
    normalizedSpec.subject.yPct,
  );
  const productPosKo = quadrantDescriptionKo(
    normalizedSpec.product.xPct,
    normalizedSpec.product.yPct,
  );

  const refDirectivesKo = normalizedSpec.referenceStack
    .map(
      (r) =>
        `${r.tag}[${r.assetTitle}]: 허용(${r.controls.join(', ')}) / 차단(${r.ignore.join(', ')})`,
    )
    .join(' · ');

  const spatialPromptKo = [
    `[2D 공간 블로킹 지시서 · ${normalizedSpec.aspectRatio}]`,
    normalizedSpec.subject.enabled
      ? `인물 레이어: ${subjectPosKo}, 화면 높이 ${normalizedSpec.subject.frameHeightPct}% 점유(상하단 15% 안전 여백), 토르소 ${normalizedSpec.subject.torsoAngleDeg}° 오프축 회전, 시선 ${normalizedSpec.subject.eyeline}, 마이크로 디렉팅(${normalizedSpec.subject.microActingCue}).`
      : '인물 레이어: 비활성(제품 단독 매크로 스테이지).',
    normalizedSpec.product.enabled
      ? `히어로 제품 레이어: ${productPosKo}, 화면 비중 ${normalizedSpec.product.scalePct}%${normalizedSpec.product.palmScaleLocked ? ' (50mL 손바닥 실측 스케일 잠금)' : ''}, 거치 방식(${normalizedSpec.product.surfaceAnchor}), 디테일(${normalizedSpec.product.materialCallout}).`
      : '히어로 제품 레이어: 비활성.',
    normalizedSpec.occluder.enabled
      ? `전경 깊이감 레이어: (${Math.round(normalizedSpec.occluder.xPct)}%, ${Math.round(normalizedSpec.occluder.yPct)}%) 위치에 ${normalizedSpec.occluder.label} 배치(${normalizedSpec.occluder.blurStrength}).`
      : '',
    `카메라 리그: ${normalizedSpec.camera.focal_mm}mm 단렌즈, 조리개 ${normalizedSpec.camera.aperture}, 앵글 ${normalizedSpec.camera.angle}, 피사체 거리 ${normalizedSpec.camera.distance_m}m.`,
    `단일 광원 벡터(합성티 차단): 주광 방위각 ${normalizedSpec.lightRig.keyAzimuthDeg}° · 고도 ${normalizedSpec.lightRig.keyElevationDeg}° (${normalizedSpec.lightRig.modifier}), 네거티브 필 ${normalizedSpec.lightRig.fillRatioStop} stop, 색온도 ${normalizedSpec.lightRig.colourTempK}K${normalizedSpec.lightRig.rimBacklightEnabled ? ', 헤어·보틀 림 백라이트 활성' : ''}.`,
    `레퍼런스 역할 잠금: ${refDirectivesKo}.`,
  ]
    .filter(Boolean)
    .join(' ');

  const spatialPromptEn = [
    `[Spatial Stage Blocking · ${normalizedSpec.aspectRatio}]`,
    normalizedSpec.subject.enabled
      ? `Subject Layer at (${Math.round(normalizedSpec.subject.xPct)}%, ${Math.round(normalizedSpec.subject.yPct)}%) occupying ${normalizedSpec.subject.frameHeightPct}% frame height with 15% top/bottom headroom, torso rotated ${normalizedSpec.subject.torsoAngleDeg} deg off-axis, eyeline ${normalizedSpec.subject.eyeline}, matte skin micro-texture with fine stray hair strands.`
      : 'Product-only macro stage (no human figure).',
    normalizedSpec.product.enabled
      ? `Hero Product Layer at (${Math.round(normalizedSpec.product.xPct)}%, ${Math.round(normalizedSpec.product.yPct)}%), footprint ${normalizedSpec.product.scalePct}%${normalizedSpec.product.palmScaleLocked ? ' locked to true 50mL palm-scale geometry' : ''}, anchor ${normalizedSpec.product.surfaceAnchor}.`
      : '',
    `Camera Rig: ${normalizedSpec.camera.focal_mm}mm prime at ${normalizedSpec.camera.aperture}, ${normalizedSpec.camera.angle}, ${normalizedSpec.camera.distance_m}m distance.`,
    `Unified Light Vector: key light at azimuth ${normalizedSpec.lightRig.keyAzimuthDeg} deg, elevation ${normalizedSpec.lightRig.keyElevationDeg} deg (${normalizedSpec.lightRig.modifier}), negative fill ${normalizedSpec.lightRig.fillRatioStop} stop, ${normalizedSpec.lightRig.colourTempK}K, strict single-source shadow alignment.`,
  ]
    .filter(Boolean)
    .join(' ');

  const lightSide =
    normalizedSpec.lightRig.keyAzimuthDeg < -15
      ? `camera-left ${Math.abs(normalizedSpec.lightRig.keyAzimuthDeg)}deg`
      : normalizedSpec.lightRig.keyAzimuthDeg > 15
        ? `camera-right ${normalizedSpec.lightRig.keyAzimuthDeg}deg`
        : 'frontal-axis key';

  const shotSpec: ShotSpec = ShotSpecSchema.parse({
    brief: spatialPromptEn.slice(0, 580),
    cutKind:
      normalizedSpec.subject.enabled && normalizedSpec.product.enabled
        ? 'editorial_full_body'
        : 'reference_exact_product',
    deliverable: {
      medium: normalizedSpec.subject.enabled ? 'editorial still' : 'product still',
      aspect: normalizedSpec.aspectRatio as ShotAspect,
      use: normalizedSpec.aspectRatio === '9:16' ? 'reel' : 'feed',
    },
    references: normalizedSpec.referenceStack.map((slot) => ({
      asset_id: `${slot.tag.toLowerCase()}-${slot.role}`,
      role: slot.role,
      ...(slot.role === 'identity' ? { consented: slot.consented ?? true } : {}),
      controls: slot.controls,
      ignore: slot.ignore,
    })),
    subject: normalizedSpec.subject.enabled
      ? {
          kind: normalizedSpec.referenceStack.some((r) => r.role === 'identity')
            ? 'consented_creator'
            : 'fictional',
          age_band: '20s',
          hair: 'natural editorial hair with fine flyaway strands along temples',
          pose: {
            torso_deg: normalizedSpec.subject.torsoAngleDeg,
            head_tilt: 'subtle 8-degree tilt',
            gaze: normalizedSpec.subject.eyeline,
            hands: normalizedSpec.product.enabled
              ? `three-finger natural grip at (${Math.round(normalizedSpec.product.xPct)}%, ${Math.round(normalizedSpec.product.yPct)}%)`
              : 'relaxed editorial posture',
          },
        }
      : null,
    product: normalizedSpec.product.enabled
      ? {
          name: normalizedSpec.product.label,
          vessel_geometry: `${normalizedSpec.product.palmScaleLocked ? '50mL palm-scale locked geometry, ' : ''}anchored at (${Math.round(normalizedSpec.product.xPct)}%, ${Math.round(normalizedSpec.product.yPct)}%), footprint ${normalizedSpec.product.scalePct}%`,
          label_lock: 'front brand typography locked 1:1 without distortion',
          material_finish: normalizedSpec.product.materialCallout,
        }
      : null,
    wardrobe: normalizedSpec.subject.enabled
      ? {
          silhouette: 'tailored editorial silhouette with structured shoulder',
          fabric: 'matte virgin wool and crisp poplin weave',
          construction: 'clean lapel seam and concealed placket',
          lock: true,
        }
      : null,
    space: {
      foreground: normalizedSpec.occluder.enabled
        ? `${normalizedSpec.occluder.label} at (${Math.round(normalizedSpec.occluder.xPct)}%, ${Math.round(normalizedSpec.occluder.yPct)}%) with ${normalizedSpec.occluder.blurStrength}`
        : 'clean unobstructed foreground',
      midground: `Subject at (${Math.round(normalizedSpec.subject.xPct)}%, ${Math.round(normalizedSpec.subject.yPct)}%) and product at (${Math.round(normalizedSpec.product.xPct)}%, ${Math.round(normalizedSpec.product.yPct)}%)`,
      background: 'travertine stone architectural wall and brushed steel column depth',
      surface: normalizedSpec.product.surfaceAnchor,
    },
    camera: {
      focal_mm: normalizedSpec.camera.focal_mm,
      distance_m: normalizedSpec.camera.distance_m,
      tilt_deg: normalizedSpec.camera.angle === 'low_angle' ? 8 : 0,
      height: normalizedSpec.camera.height_bias,
      head_y_pct: Math.max(15, Math.min(85, normalizedSpec.subject.yPct - 18)),
      subject_width_pct: Math.max(18, Math.min(60, normalizedSpec.subject.frameHeightPct)),
      margin_pct: 15,
      aperture: normalizedSpec.camera.aperture,
      dof_ratio: 2.2,
    },
    light: {
      key: {
        modifier: normalizedSpec.lightRig.modifier,
        side: lightSide,
        height: `${normalizedSpec.lightRig.keyElevationDeg}deg elevation`,
        distance: 'medium',
        effect: 'single-source directional falloff with unified shadow vector across subject and set',
      },
      fill: `negative fill ${normalizedSpec.lightRig.fillRatioStop} stop on opposite side`,
      colour_k: normalizedSpec.lightRig.colourTempK,
    },
    tone: {
      key_classification: 'balanced',
      lifted_black_hex: identity?.colour.ink ?? '#14171c',
      shadow_hex: identity?.colour.body ?? '#16233f',
      mid_hex: identity?.colour.accent ?? '#3875c5',
      highlight_hex: identity?.colour.paper ?? '#f3f7fa',
      saturation_pct: 24,
      shadow_share_pct: 34,
      halation: 0.14,
      grain_sigma: 1.5,
    },
    palette: {
      world: 'blue',
      hex_values: identity
        ? [
            identity.colour.paper,
            identity.colour.canvas,
            identity.colour.accent,
            identity.colour.ink,
          ]
        : ['#f3f7fa', '#d0dbe7', '#3875c5', '#16233f'],
      warm_notes: ['skin', 'lips'],
    },
    skin_contract: true,
    equipment_names: false,
  });

  return {
    normalizedSpec,
    shotSpec,
    spatialPromptKo,
    spatialPromptEn,
    diagnostics: {
      subjectProductDistancePct,
      frameHeightSafe:
        !normalizedSpec.dynamicMotionScene ||
        (normalizedSpec.subject.frameHeightPct >= 35 &&
          normalizedSpec.subject.frameHeightPct <= 50),
      frontalLockAvoided: Math.abs(normalizedSpec.subject.torsoAngleDeg) >= 15,
      referenceRoleUnique: dedupedStack.length === parsed.referenceStack.length,
      antiCompositeLightingVerified: normalizedSpec.lightRig.antiCompositeLock,
      warnings,
    },
  };
}
