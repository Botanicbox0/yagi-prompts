import { z } from 'zod';
import type { ConfirmedBrandIdentity } from '@/lib/brands/identity/schema';
import { hexToHsl } from './measurements';
import {
  SHOT_ASPECTS,
  ShotSpecSchema,
  TIMELINE_EDITS,
  TONAL_KEYS,
  type ShotAspect,
  type ShotReference,
  type ShotSpec,
  type TimelineShot
} from './schema';

const HexSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex colour')
  .transform((v) => v.toLowerCase() as `#${string}`);

export const CAMERA_ANGLE_CLASSES = [
  'frontal_0',
  'three_quarter_18',
  'three_quarter_45',
  'side_profile_90',
  'over_the_shoulder',
  'high_angle_diagonal',
  'tactile_macro_insert'
] as const;

export type CameraAngleClass = (typeof CAMERA_ANGLE_CLASSES)[number];

export const CAMERA_ANGLE_LABELS: Record<
  CameraAngleClass,
  { ko: string; en: string; promptPhrase: string }
> = {
  frontal_0: {
    ko: '0° 정면 축 (아이레벨)',
    en: '0° Frontal Axis (Eye-Level)',
    promptPhrase: 'straight-on eye-level axis'
  },
  three_quarter_18: {
    ko: '18° 미세 사선 3/4 앵글',
    en: '18° Subtle Diagonal 3/4',
    promptPhrase: '18-degree diagonal three-quarter profile'
  },
  three_quarter_45: {
    ko: '45° 입체 3/4 프로필',
    en: '45° Dimensional 3/4 Profile',
    promptPhrase: '45-degree three-quarter spatial angle'
  },
  side_profile_90: {
    ko: '90° 순수 측면 실루엣',
    en: '90° Pure Side Profile',
    promptPhrase: 'pure 90-degree lateral profile'
  },
  over_the_shoulder: {
    ko: 'OTS 어깨 너머 전경 포커스',
    en: 'Over-the-Shoulder (OTS) Depth',
    promptPhrase: 'over-the-shoulder angle with softly blurred foreground occlusion'
  },
  high_angle_diagonal: {
    ko: '하이앵글 사선 부감',
    en: 'High-Angle Diagonal',
    promptPhrase: 'elevated high-angle diagonal perspective'
  },
  tactile_macro_insert: {
    ko: '매크로 질감·제품 클로즈업 인서트',
    en: 'Tactile Macro Product Insert',
    promptPhrase: 'tight macro close-up insert on surface and material detail'
  }
};

export const VideoShotCameraTelemetrySchema = z.object({
  pan_x_px_per_s: z.number().min(-2000).max(2000).default(0),
  tilt_y_px_per_s: z.number().min(-2000).max(2000).default(0),
  /** Positive = push-in, negative = pull-back (`extract_video.py` Farneback flow). */
  radial_divergence_per_s: z.number().min(-5).max(5).default(0),
  subject_motion_px_per_s: z.number().min(0).max(3000).default(40),
  bg_motion_px_per_s: z.number().min(0).max(3000).default(15),
  angle: z.enum(CAMERA_ANGLE_CLASSES).default('three_quarter_18'),
  screen_anchor: z.object({
    x_pct: z.number().min(10).max(90).default(42),
    y_pct: z.number().min(10).max(90).default(48),
    /** Mid-Wide cap: characters occupy at least 35-50% of frame height. */
    subject_height_pct: z.number().min(20).max(90).default(48),
    margin_pct: z.number().min(8).max(35).default(15)
  }),
  motion_hint: z.string().trim().min(2).max(200)
});

export type VideoShotCameraTelemetry = z.infer<typeof VideoShotCameraTelemetrySchema>;

export const VideoReverseShotSchema = z.object({
  shot: z.number().int().min(1).max(15),
  start_s: z.number().min(0).max(30),
  end_s: z.number().min(0.1).max(30),
  edit: z.enum(TIMELINE_EDITS).default('hard cut'),
  focal_mm: z.number().int().min(14).max(200).default(50),
  camera_analysis: VideoShotCameraTelemetrySchema,
  action_mechanism: z.string().trim().min(4).max(260),
  sfx_cue: z.string().trim().min(2).max(180).optional()
});

export type VideoReverseShot = z.infer<typeof VideoReverseShotSchema>;

/**
 * Schema for `extract_video.py` v1.1.0 + `earshot` telemetry (`knowhow-corpus.md` §3.2).
 * Source video files/frames are NEVER forwarded to generation APIs (`seedance-film-director`).
 */
export const VideoReverseAnalysisSchema = z.object({
  referenceId: z.string().trim().min(1).max(100),
  title: z.object({
    ko: z.string().trim().min(1).max(160),
    en: z.string().trim().min(1).max(160)
  }),
  aspect: z.enum(SHOT_ASPECTS).default('9:16'),
  pacing_summary: z.object({
    duration_s: z.number().int().min(3).max(30),
    fps: z.number().int().min(12).max(60).default(24),
    shot_count: z.number().int().min(1).max(15),
    mean_shot_duration_s: z.number().min(0.1).max(30),
    sub_second_cuts: z.number().int().min(0).max(15),
    long_holds: z.number().int().min(0).max(15),
    reveal_timestamp_s: z.number().min(0.2).max(29.5)
  }),
  shots: z.array(VideoReverseShotSchema).min(1).max(15),
  tonal_anchor: z.object({
    key_classification: z.enum(TONAL_KEYS).default('balanced'),
    lifted_black_hex: HexSchema,
    shadow_hex: HexSchema,
    mid_hex: HexSchema,
    highlight_hex: HexSchema,
    mean_saturation_pct: z.number().min(0).max(100).default(22),
    shadow_share_pct: z.number().min(0).max(100).default(42),
    dominant_palette: z.array(HexSchema).min(1).max(6),
    halation: z.number().min(0).max(2).default(0.18),
    grain_sigma: z.number().min(0).max(8).default(1.6)
  }),
  audio_telemetry: z.object({
    bpm: z.number().min(50).max(200).default(118),
    drop_timestamp_s: z.number().min(0.2).max(29.5),
    silent_cuts_pct: z.number().min(0).max(100).default(82),
    within_1f_sync_pct: z.number().min(0).max(100).default(94),
    ambient_profile: z.string().trim().min(2).max(180)
  }),
  /** Private local extraction paths that must be stripped before persistence or prompt compilation. */
  source_path: z.string().optional(),
  sha256: z.string().optional(),
  raw_video_url: z.string().optional(),
  extracted_frame_paths: z.array(z.string()).optional()
});

export type VideoReverseAnalysis = z.infer<typeof VideoReverseAnalysisSchema>;

/**
 * Strips local file paths, SHA256 hashes, raw source video URLs, and frame paths (`seedance-film-director`
 * rule: source videos are local analysis material only and never become generation inputs).
 */
export function sanitizeVideoReverseAnalysis(
  raw: VideoReverseAnalysis
): Omit<
  VideoReverseAnalysis,
  'source_path' | 'sha256' | 'raw_video_url' | 'extracted_frame_paths'
> {
  const parsed = VideoReverseAnalysisSchema.parse(raw);
  const {
    source_path: _sp,
    sha256: _sha,
    raw_video_url: _url,
    extracted_frame_paths: _frames,
    ...clean
  } = parsed;
  return clean;
}

export const PreserveChangeMatrixSchema = z.object({
  preserve: z
    .object({
      cameraChoreography: z.boolean().default(true),
      cutRhythmAndSubsecondBeats: z.boolean().default(true),
      lightingContrastAndKey: z.boolean().default(true),
      revealClimaxTiming: z.boolean().default(true)
    })
    .default({
      cameraChoreography: true,
      cutRhythmAndSubsecondBeats: true,
      lightingContrastAndKey: true,
      revealClimaxTiming: true
    }),
  change: z
    .object({
      brandProductName: z
        .string()
        .trim()
        .min(2)
        .max(160)
        .default('TWINGS Heart Eau de Parfum 50ml'),
      brandProductGeometryLock: z
        .string()
        .trim()
        .min(4)
        .max(240)
        .default(
          'sculptural heart-shaped glass bottle with French-blue liquid, silver cap, visible atomizer pump stem, and ice-white ribbon at palm-sized scale'
        ),
      subjectMode: z
        .enum(['consented_cast', 'fictional_cast', 'faceless_product_only'])
        .default('fictional_cast'),
      consentedCastAssetId: z.string().trim().max(120).optional(),
      wardrobeDescription: z
        .string()
        .trim()
        .max(200)
        .default(
          'asymmetric tailored wool-silk coat in deep navy #16233f layered over powder-blue #dce8f5 poplin'
        ),
      environmentSurface: z
        .string()
        .trim()
        .min(2)
        .max(160)
        .default('brushed steel studio floor #b4c3d7 and mist-blue architectural wall #d0dbe7'),
      enforceBrandColourWorld: z.boolean().default(true),
      enforceAntiPlasticAndAntiComposite: z.boolean().default(true),
      enforceStrictNoBgm: z.boolean().default(true)
    })
    .default(() => ({
      brandProductName: 'TWINGS Heart Eau de Parfum 50ml',
      brandProductGeometryLock:
        'sculptural heart-shaped glass bottle with French-blue liquid, silver cap, visible atomizer pump stem, and ice-white ribbon at palm-sized scale',
      subjectMode: 'fictional_cast' as const,
      wardrobeDescription:
        'asymmetric tailored wool-silk coat in deep navy #16233f layered over powder-blue #dce8f5 poplin',
      environmentSurface:
        'brushed steel studio floor #b4c3d7 and mist-blue architectural wall #d0dbe7',
      enforceBrandColourWorld: true,
      enforceAntiPlasticAndAntiComposite: true,
      enforceStrictNoBgm: true
    }))
});

export type PreserveChangeMatrix = z.infer<typeof PreserveChangeMatrixSchema>;

/**
 * Built-in verified reference video telemetry presets derived from `Video-Creator` benchmarks
 * (`IDENTITY.md` §6-4, `2026-10-30-twings-fashion-reverse`, `2026-09-26-beauty-ad-template`).
 */
export const VIDEO_REVERSE_PRESETS: Record<string, VideoReverseAnalysis> = {
  runway_flash_15s: {
    referenceId: 'runway_flash_15s',
    title: {
      ko: '패션 런웨이 · 서브초 플래시 & 다각도 교차 (15초 · 6샷)',
      en: 'Fashion Runway · Sub-Second Flash & Multi-Angle Cut (15s · 6 Shots)'
    },
    aspect: '9:16',
    pacing_summary: {
      duration_s: 15,
      fps: 24,
      shot_count: 6,
      mean_shot_duration_s: 2.5,
      sub_second_cuts: 2,
      long_holds: 1,
      reveal_timestamp_s: 3.8
    },
    shots: [
      {
        shot: 1,
        start_s: 0.0,
        end_s: 0.8,
        edit: 'hard cut',
        focal_mm: 50,
        camera_analysis: {
          pan_x_px_per_s: 140,
          tilt_y_px_per_s: -20,
          radial_divergence_per_s: 0.35,
          subject_motion_px_per_s: 220,
          bg_motion_px_per_s: 65,
          angle: 'three_quarter_18',
          screen_anchor: {
            x_pct: 42,
            y_pct: 46,
            subject_height_pct: 54,
            margin_pct: 15
          },
          motion_hint: 'brisk lateral tracking snap across mid-stride silhouette'
        },
        action_mechanism:
          'Subject already in brisk forward stride; hem of tailored coat sweeps outward as cold key light catches fabric weave',
        sfx_cue: 'crisp leather heel strike on brushed stone, brisk wool-silk fabric swish'
      },
      {
        shot: 2,
        start_s: 0.8,
        end_s: 1.5,
        edit: 'hard cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: -90,
          tilt_y_px_per_s: 15,
          radial_divergence_per_s: 0.15,
          subject_motion_px_per_s: 150,
          bg_motion_px_per_s: 40,
          angle: 'tactile_macro_insert',
          screen_anchor: {
            x_pct: 58,
            y_pct: 52,
            subject_height_pct: 46,
            margin_pct: 16
          },
          motion_hint: 'tight macro insert tracking hand and hero bottle refraction'
        },
        action_mechanism:
          'Fingers grip the palm-sized glass bottle; internal liquid shifts and catches a crisp specular line along the glass shoulder',
        sfx_cue: 'subtle glass-on-ring metallic click, quiet studio air tone'
      },
      {
        shot: 3,
        start_s: 1.5,
        end_s: 3.8,
        edit: 'match cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: 60,
          tilt_y_px_per_s: -10,
          radial_divergence_per_s: 0.42,
          subject_motion_px_per_s: 110,
          bg_motion_px_per_s: 35,
          angle: 'three_quarter_45',
          screen_anchor: {
            x_pct: 38,
            y_pct: 40,
            subject_height_pct: 52,
            margin_pct: 15
          },
          motion_hint: 'controlled 45-degree arc dolly around shoulder toward collarbone'
        },
        action_mechanism:
          'Subject turns head 20 degrees off-axis with calm almond eyes and softly closed lips; stray flyaway hair strands catch cool rim light',
        sfx_cue: 'soft breath intake, quiet cloth rustle'
      },
      {
        shot: 4,
        start_s: 3.8,
        end_s: 7.2,
        edit: 'hard cut',
        focal_mm: 35,
        camera_analysis: {
          pan_x_px_per_s: 180,
          tilt_y_px_per_s: 25,
          radial_divergence_per_s: -0.28,
          subject_motion_px_per_s: 240,
          bg_motion_px_per_s: 95,
          angle: 'high_angle_diagonal',
          screen_anchor: {
            x_pct: 48,
            y_pct: 52,
            subject_height_pct: 48,
            margin_pct: 16
          },
          motion_hint: 'elevated diagonal pull-back revealing architectural blue set floor'
        },
        action_mechanism:
          'Climax reveal: full-length editorial stride across the steel-blue studio floor as the asymmetric coat lapel opens in motion',
        sfx_cue: 'resonant heel cadence in open studio gallery, crisp garment snap'
      },
      {
        shot: 5,
        start_s: 7.2,
        end_s: 11.0,
        edit: 'hard cut',
        focal_mm: 105,
        camera_analysis: {
          pan_x_px_per_s: -45,
          tilt_y_px_per_s: 0,
          radial_divergence_per_s: 0.3,
          subject_motion_px_per_s: 80,
          bg_motion_px_per_s: 20,
          angle: 'over_the_shoulder',
          screen_anchor: {
            x_pct: 62,
            y_pct: 44,
            subject_height_pct: 50,
            margin_pct: 15
          },
          motion_hint: 'telephoto compression past foreground shoulder into crisp bottle profile'
        },
        action_mechanism:
          'Over-the-shoulder framing with left 35% softly blurred foreground shoulder; fingertip presses the silver atomizer pump once',
        sfx_cue: 'crisp micro-atomizer mist burst, delicate glass resonance'
      },
      {
        shot: 6,
        start_s: 11.0,
        end_s: 15.0,
        edit: 'hard cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: 15,
          tilt_y_px_per_s: -5,
          radial_divergence_per_s: 0.12,
          subject_motion_px_per_s: 45,
          bg_motion_px_per_s: 10,
          angle: 'side_profile_90',
          screen_anchor: {
            x_pct: 46,
            y_pct: 48,
            subject_height_pct: 50,
            margin_pct: 16
          },
          motion_hint: 'composed lateral profile hold with subtle optical breathing'
        },
        action_mechanism:
          'Subject settles into a composed 90-degree profile beside the hero bottle on a honed plinth, leaving clean upper negative space',
        sfx_cue: 'gentle bottle base contact on stone plinth, decaying room tone'
      }
    ],
    tonal_anchor: {
      key_classification: 'bright editorial lifted',
      lifted_black_hex: '#14171c',
      shadow_hex: '#16233f',
      mid_hex: '#3875c5',
      highlight_hex: '#f3f7fa',
      mean_saturation_pct: 24,
      shadow_share_pct: 36,
      dominant_palette: ['#f3f7fa', '#d0dbe7', '#b4c3d7', '#3875c5', '#16233f'],
      halation: 0.18,
      grain_sigma: 1.6
    },
    audio_telemetry: {
      bpm: 122,
      drop_timestamp_s: 3.8,
      silent_cuts_pct: 83,
      within_1f_sync_pct: 96,
      ambient_profile: 'clean studio room tone + leather heel cadence + glass/atomizer foley'
    }
  },
  perfume_macro_reveal_12s: {
    referenceId: 'perfume_macro_reveal_12s',
    title: {
      ko: '뷰티·향수 매크로 교차 편집 · 보틀 기하 & 피부결 고정 (12초 · 5샷)',
      en: 'Beauty & Perfume Macro Intercut · Vessel & Skin Lock (12s · 5 Shots)'
    },
    aspect: '4:5',
    pacing_summary: {
      duration_s: 12,
      fps: 24,
      shot_count: 5,
      mean_shot_duration_s: 2.4,
      sub_second_cuts: 1,
      long_holds: 1,
      reveal_timestamp_s: 3.2
    },
    shots: [
      {
        shot: 1,
        start_s: 0.0,
        end_s: 0.7,
        edit: 'hard cut',
        focal_mm: 100,
        camera_analysis: {
          pan_x_px_per_s: 80,
          tilt_y_px_per_s: -35,
          radial_divergence_per_s: 0.25,
          subject_motion_px_per_s: 120,
          bg_motion_px_per_s: 20,
          angle: 'tactile_macro_insert',
          screen_anchor: {
            x_pct: 50,
            y_pct: 52,
            subject_height_pct: 48,
            margin_pct: 16
          },
          motion_hint: 'macro lateral sweep across glass caustics and silver cap'
        },
        action_mechanism:
          'Refracted cool blue caustic light sweeps across the thick glass shoulder and crisp front typography',
        sfx_cue: 'crystalline glass chime resonance, subtle liquid swirl'
      },
      {
        shot: 2,
        start_s: 0.7,
        end_s: 3.2,
        edit: 'hard cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: -55,
          tilt_y_px_per_s: 12,
          radial_divergence_per_s: 0.3,
          subject_motion_px_per_s: 95,
          bg_motion_px_per_s: 25,
          angle: 'three_quarter_18',
          screen_anchor: {
            x_pct: 40,
            y_pct: 38,
            subject_height_pct: 50,
            margin_pct: 15
          },
          motion_hint: 'gentle 18-degree diagonal glide across collarbone and jawline'
        },
        action_mechanism:
          'Subject glances downward-right with natural warm skin tone and zero pink blush as cool window light traces the jawline',
        sfx_cue: 'quiet linen rustle, natural breath tone'
      },
      {
        shot: 3,
        start_s: 3.2,
        end_s: 6.0,
        edit: 'match cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: 110,
          tilt_y_px_per_s: 0,
          radial_divergence_per_s: 0.45,
          subject_motion_px_per_s: 160,
          bg_motion_px_per_s: 45,
          angle: 'three_quarter_45',
          screen_anchor: {
            x_pct: 56,
            y_pct: 48,
            subject_height_pct: 46,
            margin_pct: 15
          },
          motion_hint: 'match-cut arc as palm-sized bottle rises beside the collarbone'
        },
        action_mechanism:
          'Climax reveal: hand brings the palm-sized bottle to neck level; fine mist disperses through directional side backlight',
        sfx_cue: 'crisp atomizer spray transient, airy mist shimmer'
      },
      {
        shot: 4,
        start_s: 6.0,
        end_s: 8.8,
        edit: 'hard cut',
        focal_mm: 50,
        camera_analysis: {
          pan_x_px_per_s: -70,
          tilt_y_px_per_s: -18,
          radial_divergence_per_s: -0.2,
          subject_motion_px_per_s: 110,
          bg_motion_px_per_s: 30,
          angle: 'over_the_shoulder',
          screen_anchor: {
            x_pct: 44,
            y_pct: 46,
            subject_height_pct: 48,
            margin_pct: 15
          },
          motion_hint: 'over-the-shoulder pull-back through powder-blue silk drape'
        },
        action_mechanism:
          'Powder-blue silk fabric drifts across the foreground edge while subject lowers the bottle onto a cool steel tray',
        sfx_cue: 'silk fabric glide, soft metallic tray contact'
      },
      {
        shot: 5,
        start_s: 8.8,
        end_s: 12.0,
        edit: 'hard cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: 10,
          tilt_y_px_per_s: 0,
          radial_divergence_per_s: 0.1,
          subject_motion_px_per_s: 25,
          bg_motion_px_per_s: 5,
          angle: 'tactile_macro_insert',
          screen_anchor: {
            x_pct: 50,
            y_pct: 54,
            subject_height_pct: 44,
            margin_pct: 18
          },
          motion_hint: 'locked tabletop hero hold with slow caustic shimmer'
        },
        action_mechanism:
          'Hero bottle rests centered on brushed steel with crisp front label and ice-white ribbon catching a final key-light sweep',
        sfx_cue: 'subtle glass settle, clean studio silence'
      }
    ],
    tonal_anchor: {
      key_classification: 'high-key veiled',
      lifted_black_hex: '#14171c',
      shadow_hex: '#2e5f9f',
      mid_hex: '#3875c5',
      highlight_hex: '#f3f7fa',
      mean_saturation_pct: 21,
      shadow_share_pct: 28,
      dominant_palette: ['#f3f7fa', '#dce8f5', '#d0dbe7', '#3875c5', '#16233f'],
      halation: 0.22,
      grain_sigma: 1.4
    },
    audio_telemetry: {
      bpm: 108,
      drop_timestamp_s: 3.2,
      silent_cuts_pct: 80,
      within_1f_sync_pct: 95,
      ambient_profile: 'intimate macro foley + atomizer spray transient + silk rustle'
    }
  },
  outdoor_golden_campaign_10s: {
    referenceId: 'outdoor_golden_campaign_10s',
    title: {
      ko: '시즌 아웃도어 캠페인 · 역광 트래킹 & 매치컷 (10초 · 4샷)',
      en: 'Seasonal Outdoor Campaign · Backlit Tracking & Match Cut (10s · 4 Shots)'
    },
    aspect: '16:9',
    pacing_summary: {
      duration_s: 10,
      fps: 24,
      shot_count: 4,
      mean_shot_duration_s: 2.5,
      sub_second_cuts: 1,
      long_holds: 1,
      reveal_timestamp_s: 2.6
    },
    shots: [
      {
        shot: 1,
        start_s: 0.0,
        end_s: 0.9,
        edit: 'hard cut',
        focal_mm: 35,
        camera_analysis: {
          pan_x_px_per_s: 165,
          tilt_y_px_per_s: 10,
          radial_divergence_per_s: 0.3,
          subject_motion_px_per_s: 210,
          bg_motion_px_per_s: 85,
          angle: 'three_quarter_45',
          screen_anchor: {
            x_pct: 38,
            y_pct: 48,
            subject_height_pct: 48,
            margin_pct: 15
          },
          motion_hint: 'dynamic 35mm lateral tracking alongside architectural terrace'
        },
        action_mechanism:
          'Subject walks briskly across an open limestone terrace as wind moves stray hair strands and jacket hem',
        sfx_cue: 'open terrace wind tone, brisk step on limestone'
      },
      {
        shot: 2,
        start_s: 0.9,
        end_s: 2.6,
        edit: 'hard cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: -60,
          tilt_y_px_per_s: -15,
          radial_divergence_per_s: 0.2,
          subject_motion_px_per_s: 90,
          bg_motion_px_per_s: 30,
          angle: 'tactile_macro_insert',
          screen_anchor: {
            x_pct: 58,
            y_pct: 50,
            subject_height_pct: 45,
            margin_pct: 16
          },
          motion_hint: 'tight telephoto insert on garment hardware and brand mark'
        },
        action_mechanism:
          'Directional side light glides across the woven fabric texture and crisp brand hardware without lens flare washout',
        sfx_cue: 'tactile fabric brush, subtle hardware click'
      },
      {
        shot: 3,
        start_s: 2.6,
        end_s: 6.4,
        edit: 'match cut',
        focal_mm: 50,
        camera_analysis: {
          pan_x_px_per_s: 120,
          tilt_y_px_per_s: 20,
          radial_divergence_per_s: -0.25,
          subject_motion_px_per_s: 175,
          bg_motion_px_per_s: 70,
          angle: 'over_the_shoulder',
          screen_anchor: {
            x_pct: 44,
            y_pct: 45,
            subject_height_pct: 50,
            margin_pct: 15
          },
          motion_hint: 'match-cut orbital pull-back revealing horizon line and full silhouette'
        },
        action_mechanism:
          'Climax reveal: camera orbits from over-the-shoulder into a 3/4 mid-wide stance as the coat silhouette catches crisp rim light',
        sfx_cue: 'expansive outdoor air swell, crisp coat movement'
      },
      {
        shot: 4,
        start_s: 6.4,
        end_s: 10.0,
        edit: 'hard cut',
        focal_mm: 85,
        camera_analysis: {
          pan_x_px_per_s: 20,
          tilt_y_px_per_s: 0,
          radial_divergence_per_s: 0.12,
          subject_motion_px_per_s: 35,
          bg_motion_px_per_s: 12,
          angle: 'three_quarter_18',
          screen_anchor: {
            x_pct: 42,
            y_pct: 44,
            subject_height_pct: 52,
            margin_pct: 16
          },
          motion_hint: 'composed 85mm portrait hold with off-axis eyeline'
        },
        action_mechanism:
          'Subject pauses in an 18-degree three-quarter stance looking off-camera toward the horizon with calm expression and warm natural skin',
        sfx_cue: 'gentle wind decay, quiet ambient room/terrace floor'
      }
    ],
    tonal_anchor: {
      key_classification: 'balanced',
      lifted_black_hex: '#14171c',
      shadow_hex: '#16233f',
      mid_hex: '#3875c5',
      highlight_hex: '#f3f7fa',
      mean_saturation_pct: 23,
      shadow_share_pct: 34,
      dominant_palette: ['#f3f7fa', '#d0dbe7', '#b4c3d7', '#3875c5', '#16233f'],
      halation: 0.16,
      grain_sigma: 1.5
    },
    audio_telemetry: {
      bpm: 116,
      drop_timestamp_s: 2.6,
      silent_cuts_pct: 85,
      within_1f_sync_pct: 94,
      ambient_profile: 'clean architectural outdoor breeze + limestone footsteps + fabric foley'
    }
  }
};

export interface VideoReverseCompilationResult {
  spec: ShotSpec;
  sanitizedAnalysis: ReturnType<typeof sanitizeVideoReverseAnalysis>;
  adaptationSummary: {
    preservedKo: string[];
    preservedEn: string[];
    changedKo: string[];
    changedEn: string[];
    angleAlternationFixes: number;
    subsecondPushInFixes: number;
  };
  twoStageGate: {
    stage1Draft: {
      resolution: '480p';
      draft: true;
      bitrateMode: 'high';
      audioPolicy: 'strict_no_bgm_diegetic_only' | 'standard';
    };
    stage2Master: {
      resolution: '1080p';
      upscaleProfile: 'optical_diffusion_1080p_cfr24';
      colorLookPreset: 'oled-editorial-punch';
      audioMasterTarget: '-14.0 LUFS / -1.0 dBTP';
      revealDropTimestampSec: number;
    };
  };
}

function alternateAngleIfDuplicate(
  current: CameraAngleClass,
  prev: CameraAngleClass | null
): { next: CameraAngleClass; changed: boolean } {
  if (!prev || current !== prev) {
    return { next: current, changed: false };
  }
  const cycle: CameraAngleClass[] = [
    'three_quarter_18',
    'three_quarter_45',
    'over_the_shoulder',
    'side_profile_90',
    'high_angle_diagonal'
  ];
  const fallback = cycle.find((c) => c !== prev) ?? 'three_quarter_45';
  return { next: fallback, changed: true };
}

function buildMeasuredCameraDescription(
  shot: VideoReverseShot,
  angle: CameraAngleClass,
  preserveChoreography: boolean
): string {
  const anglePhrase = CAMERA_ANGLE_LABELS[angle].promptPhrase;
  const anchor = shot.camera_analysis.screen_anchor;
  const clampedHeight = Math.max(35, Math.min(60, anchor.subject_height_pct));
  const margin = Math.max(15, anchor.margin_pct);

  if (!preserveChoreography) {
    return `${anglePhrase}, subject anchored at x=${anchor.x_pct}% y=${anchor.y_pct}% (${clampedHeight}% frame height, ${margin}% safety margin)`;
  }

  const rad = shot.camera_analysis.radial_divergence_per_s;
  const radialDesc =
    rad > 0.15
      ? `deliberate optical push-in (+${rad.toFixed(2)}/s)`
      : rad < -0.15
        ? `measured pull-back (${rad.toFixed(2)}/s)`
        : 'locked focal distance';

  return (
    `${anglePhrase}, ${shot.camera_analysis.motion_hint} (${radialDesc}), ` +
    `anchored off-center at x=${anchor.x_pct}% y=${anchor.y_pct}% ` +
    `(Mid-Wide ${clampedHeight}% height, ${margin}% frame margin)`
  );
}

/**
 * Compiles `VideoReverseAnalysis` (`extract_video.py` + `earshot` telemetry) + `PreserveChangeMatrix`
 * + `ConfirmedBrandIdentity` into a gap-free sub-second `ShotSpec` with `Two-Stage 480p Draft -> Master` gate.
 */
export function compileVideoReverseAdaptation(input: {
  analysis: VideoReverseAnalysis;
  matrix: PreserveChangeMatrix;
  identity: ConfirmedBrandIdentity;
  customBrief?: string;
}): VideoReverseCompilationResult {
  const sanitized = sanitizeVideoReverseAnalysis(input.analysis);
  const matrix = PreserveChangeMatrixSchema.parse(input.matrix);
  const { identity } = input;

  let angleAlternationFixes = 0;
  let subsecondPushInFixes = 0;
  let prevAngle: CameraAngleClass | null = null;

  const durationS = sanitized.pacing_summary.duration_s;
  const rawShots = [...sanitized.shots].sort((a, b) => a.start_s - b.start_s);

  // Normalize timeline boundaries so start=0, end=durationS, zero gaps/overlaps
  const timeline: TimelineShot[] = rawShots.map((s, idx) => {
    const start = idx === 0 ? 0 : Math.round(rawShots[idx - 1]!.end_s * 10) / 10;
    const end =
      idx === rawShots.length - 1
        ? durationS
        : Math.max(
            Math.round((start + 0.2) * 10) / 10,
            Math.min(durationS - 0.2, Math.round(s.end_s * 10) / 10)
          );
    const dur = Math.max(0.1, Math.round((end - start) * 10) / 10);

    const { next: resolvedAngle, changed: angleFixed } = alternateAngleIfDuplicate(
      s.camera_analysis.angle,
      prevAngle
    );
    if (angleFixed) angleAlternationFixes += 1;
    prevAngle = resolvedAngle;

    let edit = s.edit;
    let cameraStr = buildMeasuredCameraDescription(
      s,
      resolvedAngle,
      matrix.preserve.cameraChoreography
    );

    // Guard against Seedance sub-second continuous push-in bug (stretches <1.0s shot to 3-4s)
    if (dur < 1.0 && edit === 'continuous' && /push-in|push in/i.test(cameraStr)) {
      edit = 'hard cut';
      cameraStr = cameraStr.replace(/deliberate optical push-in \([^)]+\)/gi, 'instant optical snap framing');
      subsecondPushInFixes += 1;
    }

    const microActingClause =
      matrix.change.subjectMode !== 'faceless_product_only' &&
      matrix.change.enforceAntiPlasticAndAntiComposite
        ? ' Subject keeps softly closed lips (1-2mm part), calm off-axis eyeline, unretouched matte-satin skin with fine stray flyaway hair catching rim light, and ambient shadow floor matching the room.'
        : '';

    const actionText = `${s.action_mechanism} featuring ${matrix.change.brandProductName}.${microActingClause}`.slice(
      0,
      320
    );

    return {
      shot: idx + 1,
      start,
      end,
      edit,
      focal_mm: s.focal_mm,
      camera: cameraStr.slice(0, 240),
      action: actionText,
      audio: {
        ...(s.sfx_cue ? { sfx: s.sfx_cue } : {}),
        no_bgm: matrix.change.enforceStrictNoBgm
      }
    };
  });

  // Ensure exact continuity across normalized shots
  for (let i = 1; i < timeline.length; i += 1) {
    timeline[i]!.start = timeline[i - 1]!.end;
    if (timeline[i]!.end <= timeline[i]!.start) {
      timeline[i]!.end = Math.min(durationS, Number((timeline[i]!.start + 0.4).toFixed(1)));
    }
  }
  if (timeline.length > 0) {
    timeline[0]!.start = 0;
    timeline[timeline.length - 1]!.end = durationS;
  }

  const references: ShotReference[] = [];
  if (matrix.change.subjectMode === 'consented_cast') {
    references.push({
      asset_id: matrix.change.consentedCastAssetId?.trim() || 'cast_consented_primary',
      role: 'identity',
      consented: true,
      controls: ['face-geometry', 'skin-undertone', 'hair-silhouette'],
      ignore: ['studio-flash-background', 'pink-blush', 'source-wardrobe']
    });
  }
  references.push({
    asset_id: 'brand_hero_product_cutout',
    role: 'product',
    controls: ['vessel-geometry', 'label-typography', 'palm-scale-lock'],
    ignore: ['background-clutter']
  });
  references.push({
    asset_id: `ref_video_telemetry_${sanitized.referenceId}`,
    role: 'analysis-only',
    controls: ['camera-velocity-curve', 'subsecond-cut-rhythm', 'tonal-contrast-ratio'],
    ignore: ['source-identity', 'source-brand-marks', 'source-audio-track'],
    measured: {
      pacing_summary: sanitized.pacing_summary,
      audio_telemetry: sanitized.audio_telemetry
    }
  });

  const [hueLo, hueHi] = identity.world.ownedHue;
  const filteredPalette = matrix.change.enforceBrandColourWorld
    ? sanitized.tonal_anchor.dominant_palette.filter((hex) => {
        const { h, s } = hexToHsl(hex);
        return s <= 0.14 || (h >= hueLo && h <= hueHi);
      })
    : sanitized.tonal_anchor.dominant_palette;

  const paletteHexes = Array.from(
    new Set([
      ...filteredPalette,
      identity.colour.paper,
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

  const briefLine =
    input.customBrief?.trim() ||
    `${sanitized.title.en} adaptation for ${matrix.change.brandProductName} on ${matrix.change.environmentSurface}`;

  const spec = ShotSpecSchema.parse({
    brief: briefLine.slice(0, 500),
    cutKind: 'short_film_clip',
    deliverable: {
      medium: 'short film',
      aspect: sanitized.aspect as ShotAspect,
      use: 'reel'
    },
    references,
    subject:
      matrix.change.subjectMode === 'faceless_product_only'
        ? null
        : {
            kind:
              matrix.change.subjectMode === 'consented_cast'
                ? 'consented_creator'
                : 'fictional',
            ...(matrix.change.consentedCastAssetId
              ? { cast_id: matrix.change.consentedCastAssetId }
              : {}),
            age_band: '20s',
            hair: 'natural slightly wind-rumpled texture with fine stray flyaway strands catching rim light',
            pose: {
              torso_deg: 24,
              head_tilt: 'subtle 8-degree tilt',
              gaze: 'off-axis eyeline away from lens',
              hands: 'holding palm-sized hero product with natural finger articulation'
            }
          },
    product: {
      name: matrix.change.brandProductName,
      vessel_geometry: matrix.change.brandProductGeometryLock,
      label_lock:
        identity.productChecklist[0] ??
        'front typography centered and unwarped across glass curvature',
      material_finish: 'optical glass refraction with brushed metallic atomizer cap'
    },
    wardrobe:
      matrix.change.subjectMode === 'faceless_product_only'
        ? null
        : {
            silhouette: matrix.change.wardrobeDescription,
            fabric: 'matte architectural wool-silk blend with crisp drape',
            construction: 'asymmetric lapel and clean tailored shoulder seam',
            lock: true
          },
    space: {
      foreground: 'subtle off-axis foreground depth plane with clean framing margin',
      midground: `${matrix.change.brandProductName} and subject in continuous physical motion`,
      background: matrix.change.environmentSurface,
      surface: matrix.change.environmentSurface
    },
    camera: {
      focal_mm: timeline[0]?.focal_mm ?? 50,
      distance_m: 2.4,
      tilt_deg: 0,
      height: 'eye-level',
      head_y_pct: 38,
      subject_width_pct: 36,
      margin_pct: 15,
      aperture: 'f/2.8',
      dof_ratio: 2.2
    },
    light: {
      key: {
        modifier: 'large diffused architectural daylight bank',
        side: 'camera-left',
        height: 'slightly above eye-level',
        distance: 'medium',
        effect: 'chiaroscuro falloff across away side of face matching ambient room floor'
      },
      fill: 'negative fill on shadow side with subtle cool bounce camera-right',
      colour_k: 5600
    },
    tone: {
      key_classification: matrix.preserve.lightingContrastAndKey
        ? sanitized.tonal_anchor.key_classification
        : 'balanced',
      lifted_black_hex: sanitized.tonal_anchor.lifted_black_hex,
      shadow_hex: sanitized.tonal_anchor.shadow_hex,
      mid_hex: identity.colour.accent,
      highlight_hex: sanitized.tonal_anchor.highlight_hex,
      saturation_pct: sanitized.tonal_anchor.mean_saturation_pct,
      shadow_share_pct: sanitized.tonal_anchor.shadow_share_pct,
      halation: sanitized.tonal_anchor.halation,
      grain_sigma: sanitized.tonal_anchor.grain_sigma
    },
    palette: {
      world: 'blue',
      hex_values: paletteHexes,
      warm_notes: ['skin', 'lips']
    },
    timeline,
    duration_s: durationS,
    skin_contract: true,
    equipment_names: false,
    exclusions,
    memory_refs: [`video_reverse:${sanitized.referenceId}`]
  });

  const preservedKo: string[] = [];
  const preservedEn: string[] = [];
  if (matrix.preserve.cameraChoreography) {
    preservedKo.push(
      `0.1초 광학 플로우 카메라 궤적 보존 (${sanitized.pacing_summary.shot_count}샷 팬·틸트·줌 속도 벡터)`
    );
    preservedEn.push(
      `0.1s optical-flow camera choreography (${sanitized.pacing_summary.shot_count} shots pan/tilt/zoom vectors)`
    );
  }
  if (matrix.preserve.cutRhythmAndSubsecondBeats) {
    preservedKo.push(
      `서브초 컷 편집 리듬 보존 (서브초 인서트 ${sanitized.pacing_summary.sub_second_cuts}회 · 총 ${durationS}초 무공백 타임라인)`
    );
    preservedEn.push(
      `Sub-second cut rhythm (${sanitized.pacing_summary.sub_second_cuts} sub-second inserts · ${durationS}s gap-free timeline)`
    );
  }
  if (matrix.preserve.revealClimaxTiming) {
    preservedKo.push(
      `T_reveal 클라이맥스 전환점 고정 (${sanitized.pacing_summary.reveal_timestamp_s.toFixed(2)}s — 사운드 0ms 드롭 연동)`
    );
    preservedEn.push(
      `T_reveal climax anchor locked at ${sanitized.pacing_summary.reveal_timestamp_s.toFixed(2)}s (0ms sound drop sync)`
    );
  }
  if (matrix.preserve.lightingContrastAndKey) {
    preservedKo.push(
      `암부 비율(${sanitized.tonal_anchor.shadow_share_pct}%) 및 35mm 필름 그레인(σ=${sanitized.tonal_anchor.grain_sigma}) 계측치 유지`
    );
    preservedEn.push(
      `Measured shadow share (${sanitized.tonal_anchor.shadow_share_pct}%) and 35mm grain (σ=${sanitized.tonal_anchor.grain_sigma})`
    );
  }

  const changedKo: string[] = [
    `주인공 제품 교체: ${matrix.change.brandProductName} (손 크기 실측 비례 및 라벨 기하 고정)`,
    matrix.change.enforceBrandColourWorld
      ? `브랜드 프렌치 블루 색 대역(${hueLo}°–${hueHi}°) 이식 + 피부·입술 웜톤 단독 보존`
      : '원본 색채 팔레트 유지',
    matrix.change.enforceAntiPlasticAndAntiComposite
      ? '반(反)플라스틱 매트 스킨·잔머리·밀리미터 미세연기(1–2mm 입술, 오프축 시선) 및 배경 조도 일치(Anti-Composite Law)'
      : '기본 인물 렌더링',
    matrix.change.enforceStrictNoBgm
      ? 'Strict No-BGM 다이제틱 폴리·룸톤 분리 (배경음악은 후반 마스터에서 0ms 싱크 합성)'
      : '일반 오디오 생성'
  ];

  const changedEn: string[] = [
    `Product injected: ${matrix.change.brandProductName} (palm-sized scale & label geometry locked)`,
    matrix.change.enforceBrandColourWorld
      ? `Brand French-Blue hue band (${hueLo}°–${hueHi}°) applied with warm skin/lips protection`
      : 'Original palette retained',
    matrix.change.enforceAntiPlasticAndAntiComposite
      ? 'Anti-plastic matte skin, flyaway hair, millimeter micro-acting (1-2mm lips, off-axis gaze) & Anti-Composite lighting'
      : 'Standard subject rendering',
    matrix.change.enforceStrictNoBgm
      ? 'Strict No-BGM diegetic Foley & room tone isolation (music synced at 0ms in post-master)'
      : 'Standard audio'
  ];

  return {
    spec,
    sanitizedAnalysis: sanitized,
    adaptationSummary: {
      preservedKo,
      preservedEn,
      changedKo,
      changedEn,
      angleAlternationFixes,
      subsecondPushInFixes
    },
    twoStageGate: {
      stage1Draft: {
        resolution: '480p',
        draft: true,
        bitrateMode: 'high',
        audioPolicy: matrix.change.enforceStrictNoBgm
          ? 'strict_no_bgm_diegetic_only'
          : 'standard'
      },
      stage2Master: {
        resolution: '1080p',
        upscaleProfile: 'optical_diffusion_1080p_cfr24',
        colorLookPreset: 'oled-editorial-punch',
        audioMasterTarget: '-14.0 LUFS / -1.0 dBTP',
        revealDropTimestampSec: sanitized.pacing_summary.reveal_timestamp_s
      }
    }
  };
}
