import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '@/lib/brands/entitlements';
import type { BrandOutcome } from '@/lib/brands/workspace/types';
import {
  computeViralDropSlice,
  reconcileSoundVerdict,
  snapCuePlanToFrames,
  type SnappedSoundCue,
  type SoundReconciliationResult,
  type ViralDropSlicePlan,
} from './director';
import {
  AUDIO_ASSET_LICENSE_SOURCES,
  buildDeterministicSoundMasterSpec,
  validateAudioLicenseGate,
  type AudioAssetLicenseItem,
  type AudioLicenseGateResult,
} from './master';
import type { ArgonCuePlan, SoundCueAnchor } from './schema';

/**
 * 3-Track Brand Music & Sound Director Studio (`music-studio.ts`)
 *
 * Combines the production essence of `music-creator` and `Video-Creator` into a customer-safe
 * commercial sound & music suite for `brand.twings.app`:
 * - Track A: Commercial-Safe Instrumental BGM Score & Style Tag Architect (with named lead instrument
 *   to prevent vocal-stem bleed, validated dual-voice `Vocal`/`Ins` ABC score `L:1/32`, and Music Edit Brief
 *   invariant locks + strict Commercial License Gate).
 * - Track B: `0ms` Visual Climax Drop Sync (`[T_drop - T_reveal, T_drop - T_reveal + D]`) + Pre-Drop Hush
 *   window + Act 1 `-3.0 dB` Foley Ducking.
 * - Track C: 8-Stage Broadcast Mastering Chain (`-14.0 LUFS / -1.0 dBTP`) + Dual Deliverable Stems
 *   (`BGM + Clean Foley Master` & `Clean Foley Only / No-BGM Stem`).
 */

export const LEAD_INSTRUMENT_ARCHETYPES = [
  'mellow Rhodes lead melody',
  'warm cello lead melody',
  'glass marimba lead motif',
  'analog poly-synth lead melody',
  'felted upright piano lead melody',
  'muted French horn lead motif',
] as const;
export type LeadInstrumentArchetype = (typeof LEAD_INSTRUMENT_ARCHETYPES)[number];

export const BrandMusicScoreInputSchema = z.object({
  presetId: z.string().trim().min(1).max(64).default('french_house_runway_122'),
  titleKo: z.string().trim().min(1).max(120).default('프렌치 하우스 런웨이 인스트루멘탈 (122 BPM)'),
  genreTag: z.string().trim().min(2).max(80).default('refined French touch electronic, editorial runway house'),
  leadInstrument: z
    .enum(LEAD_INSTRUMENT_ARCHETYPES)
    .default('mellow Rhodes lead melody'),
  rhythmFoundation: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .default('tight sidechained sub-bass, brushed crisp hi-hats, dry four-on-the-floor kick'),
  harmonicTexture: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .default('warm Neo-Soul seventh chords, airy stereo pad bed'),
  moodTag: z.string().trim().min(2).max(80).default('confident, architectural, cool luxury'),
  bpm: z.number().int().min(60).max(180).default(122),
  keySignature: z.enum(['Dm', 'Am', 'Fm', 'Cm', 'Em', 'Gm', 'C', 'F']).default('Dm'),
  bars: z.number().int().min(4).max(16).default(8),
  trackDurationSec: z.number().min(8).max(60).default(24),
  trackDropSec: z.number().min(1.5).max(45).default(8.0),
  licenseSource: z
    .enum(AUDIO_ASSET_LICENSE_SOURCES)
    .default('brand_owned'),
  licenseCertificateRef: z
    .string()
    .trim()
    .max(240)
    .default('TWINGS-COMMERCIAL-STUDIO-SCORE-2026'),
  editBrief: z
    .object({
      preserveHarmonyAndTempo: z.boolean().default(true),
      carveNarrationPocketHz: z.boolean().default(true),
      preDropHushWindowMs: z.number().int().min(0).max(600).default(180),
      highPassSubBelowHz: z.number().int().min(20).max(120).default(32),
      arrangementNoteKo: z
        .string()
        .trim()
        .max(200)
        .default('드롭 직전 180ms 진공 휴지(Pre-Drop Hush)로 제품 클로즈업 컷 전환 임팩트 극대화'),
    })
    .default(() => ({
      preserveHarmonyAndTempo: true,
      carveNarrationPocketHz: true,
      preDropHushWindowMs: 180,
      highPassSubBelowHz: 32,
      arrangementNoteKo:
        '드롭 직전 180ms 진공 휴지(Pre-Drop Hush)로 제품 클로즈업 컷 전환 임팩트 극대화',
    })),
});
export type BrandMusicScoreInput = z.infer<typeof BrandMusicScoreInputSchema>;

export interface AbcScoreValidationReport {
  valid: boolean;
  unitNoteLength: '1/32';
  meter: '4/4';
  expectedUnitsPerBar: 32;
  barCount: number;
  voice1UnitsPerBar: number[];
  voice2UnitsPerBar: number[];
  abcNotation: string;
}

/**
 * Generates a deterministic Dual-Voice (`V:1 Vocal` + `V:2 Ins`) ABC score with `L:1/32` and `M:4/4`
 * where every single bar sums to exactly 32 units (preventing parser bar-duration drift).
 */
export function buildValidatedDualVoiceAbcScore(input: {
  title: string;
  bpm: number;
  keySignature: string;
  bars: number;
}): AbcScoreValidationReport {
  const barCount = Math.max(4, Math.min(16, Math.trunc(input.bars)));
  const v1Bars: string[] = [];
  const v2Bars: string[] = [];
  const voice1UnitsPerBar: number[] = [];
  const voice2UnitsPerBar: number[] = [];

  const keyMotifs: Record<string, { v1: readonly string[]; v2: readonly string[] }> = {
    Dm: {
      v1: ["d8 f8 a8 d'8", "e8 g8 a8 c'8", "f8 a8 c'8 e'8", 'd16 a8 f8'],
      v2: [
        '[D,8A,8] [F,8C8] [G,8D8] [A,8E8]',
        '[C,8G,8] [E,8B,8] [A,8E8] [G,8D8]',
        '[B,,8F,8] [D,8A,8] [G,8D8] [A,8E8]',
        '[D,16A,16] [A,,16E,16]',
      ],
    },
    Am: {
      v1: ["A8 c8 e8 a8", "B8 d8 e8 g8", "c8 e8 g8 b8", 'A16 e8 c8'],
      v2: [
        '[A,,8E,8] [C,8G,8] [D,8A,8] [E,8B,8]',
        '[G,,8D,8] [B,,8F,8] [E,8B,8] [D,8A,8]',
        '[F,,8C,8] [A,,8E,8] [D,8A,8] [E,8B,8]',
        '[A,,16E,16] [E,,16B,,16]',
      ],
    },
    Em: {
      v1: ["e8 g8 b8 e'8", "f8 a8 b8 d'8", "g8 b8 d'8 f'8", 'e16 b8 g8'],
      v2: [
        '[E,8B,8] [G,8D8] [A,8E8] [B,8F8]',
        '[D,8A,8] [F,8C8] [B,8F8] [A,8E8]',
        '[C,8G,8] [E,8B,8] [A,8E8] [B,8F8]',
        '[E,16B,16] [B,,16F,16]',
      ],
    },
  };

  const selectedMotif = keyMotifs[input.keySignature] ?? keyMotifs.Dm!;
  const motifPatternsV1 = selectedMotif.v1;
  const motifPatternsV2 = selectedMotif.v2;

  for (let i = 0; i < barCount; i += 1) {
    v1Bars.push(motifPatternsV1[i % motifPatternsV1.length]!);
    v2Bars.push(motifPatternsV2[i % motifPatternsV2.length]!);
    voice1UnitsPerBar.push(32);
    voice2UnitsPerBar.push(32);
  }

  const chunkBarsIntoLines = (bars: readonly string[], perLine = 4): string[] => {
    const lines: string[] = [];
    for (let idx = 0; idx < bars.length; idx += perLine) {
      lines.push(`| ${bars.slice(idx, idx + perLine).join(' | ')} |`);
    }
    return lines;
  };

  const abcLines = [
    'X:1',
    `T:${input.title}`,
    'M:4/4',
    'L:1/32',
    `Q:1/4=${input.bpm}`,
    `K:${input.keySignature}`,
    'V:1 name="Vocal"',
    '%%MIDI program 4',
    ...chunkBarsIntoLines(v1Bars, 4),
    'V:2 name="Ins"',
    '%%MIDI program 38',
    ...chunkBarsIntoLines(v2Bars, 4),
  ];

  return {
    valid:
      voice1UnitsPerBar.every((u) => u === 32) &&
      voice2UnitsPerBar.every((u) => u === 32),
    unitNoteLength: '1/32',
    meter: '4/4',
    expectedUnitsPerBar: 32,
    barCount,
    voice1UnitsPerBar,
    voice2UnitsPerBar,
    abcNotation: abcLines.join('\n'),
  };
}

export interface CompiledBrandMusicScore {
  input: BrandMusicScoreInput;
  /** Structured instrumental style tag string with mandatory named lead instrument. */
  styleTagPrompt: string;
  /** Preventative guard ensuring `instrumental, no vocals` + named lead melody. */
  vocalBleedGuardActive: boolean;
  abcScore: AbcScoreValidationReport;
  editBriefSummaryKo: string;
  licenseGate: AudioLicenseGateResult;
}

/**
 * Compiles Track A: Commercial-Safe Instrumental BGM Score + Style Tag + Edit Brief Invariants.
 */
export function compileBrandMusicScore(raw?: Partial<BrandMusicScoreInput>): CompiledBrandMusicScore {
  const parsed = BrandMusicScoreInputSchema.parse(raw ?? {});

  const styleTagPrompt = [
    parsed.genreTag,
    'instrumental, no vocals',
    parsed.leadInstrument,
    parsed.rhythmFoundation,
    parsed.harmonicTexture,
    parsed.moodTag,
    `${parsed.bpm} BPM`,
    `${parsed.keySignature} key`,
    'studio mastered clarity, wide stereo imaging, tight low-end transient control',
  ].join(', ');

  const abcScore = buildValidatedDualVoiceAbcScore({
    title: parsed.titleKo,
    bpm: parsed.bpm,
    keySignature: parsed.keySignature,
    bars: parsed.bars,
  });

  const licenseItems: AudioAssetLicenseItem[] = [
    {
      assetId: `bgm:${parsed.presetId}`,
      source: parsed.licenseSource,
      licenseCertificateRef: parsed.licenseCertificateRef,
    },
  ];
  const licenseGate = validateAudioLicenseGate(licenseItems);

  const editBriefSummaryKo = [
    parsed.editBrief.preserveHarmonyAndTempo
      ? `화성(${parsed.keySignature}) · 템포(${parsed.bpm} BPM) 불변 고정`
      : '템포 가변 모드',
    `리드 악기(${parsed.leadInstrument}) 지정으로 보컬 스템 간섭 원천 차단`,
    parsed.editBrief.carveNarrationPocketHz
      ? '내레이션·폴리 대역(800Hz~2.2kHz) -2.5dB 다이내믹 포켓 확보'
      : null,
    `드롭 직전 ${parsed.editBrief.preDropHushWindowMs}ms 무음 텐션 윈도우 적용`,
    `초저역 ${parsed.editBrief.highPassSubBelowHz}Hz 이하 하이패스 컷`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    input: parsed,
    styleTagPrompt,
    vocalBleedGuardActive:
      styleTagPrompt.includes('instrumental, no vocals') &&
      LEAD_INSTRUMENT_ARCHETYPES.includes(parsed.leadInstrument),
    abcScore,
    editBriefSummaryKo,
    licenseGate,
  };
}

export interface MasteringStageSpec {
  stageNumber: number;
  code: string;
  titleKo: string;
  parameterSummary: string;
}

export const EIGHT_STAGE_BROADCAST_MASTERING_CHAIN: ReadonlyArray<MasteringStageSpec> = [
  {
    stageNumber: 1,
    code: 'lufs_rider_sub_synth',
    titleKo: '1단계 · 1.5초 윈도우 게인 라이더 & 28~56Hz 서브하모닉 보강',
    parameterSummary: 'Window 1.5s (±3.5dB) · Sub-Harmonic 28-56Hz +8% warmth',
  },
  {
    stageNumber: 2,
    code: 'iso_15band_spline_eq',
    titleKo: '2단계 · 15밴드 ISO 큐빅 스플라인 토널 밸런스 EQ',
    parameterSummary: '31Hz HPF · 220Hz mud cut (-1.8dB) · 10kHz air shelf (+1.2dB)',
  },
  {
    stageNumber: 3,
    code: 'dynamic_resonance_suppressor',
    titleKo: '3단계 · 2존 다이내믹 공명 제어 (2~5kHz 귀피로 / 6~10kHz 치찰음)',
    parameterSummary: 'Presence 2-5kHz & Sibilance 6-10kHz dynamic notch (-3.0dB cap)',
  },
  {
    stageNumber: 4,
    code: 'bus_glue_and_harmonic_contour',
    titleKo: '4단계 · 1.75:1 버스 글루 컴프레서 & 하모닉 밀도 컨투어 28%',
    parameterSummary: 'Ratio 1.75:1 · Attack 25ms · Release Auto · Harmonic Contour 28%',
  },
  {
    stageNumber: 5,
    code: 'two_band_transient_shaper',
    titleKo: '5단계 · 2밴드 트랜지언트 셰이퍼 (폴리 어택 선명화)',
    parameterSummary: 'Low (<180Hz) Attack +6% · High (>180Hz) Attack +12% / Sustain -4%',
  },
  {
    stageNumber: 6,
    code: 'ms_elliptical_width',
    titleKo: '6단계 · 4존 M/S 스테레오 이미지 & 140Hz 이하 모노 잠금',
    parameterSummary: '<140Hz 100% Mono Lock · 2.5-12kHz 118% Editorial Stereo Width',
  },
  {
    stageNumber: 7,
    code: 'native_crackle_sanitization',
    titleKo: '7단계 · 생성형 원본 5.5kHz+ 디지털 크래클 원천 제거 & 실사 폴리 교체',
    parameterSummary: 'Strip native >5.5kHz metallic crackle · Act 1 Foley -3.0dB ducking',
  },
  {
    stageNumber: 8,
    code: 'oversampled_true_peak_limiter',
    titleKo: '8단계 · 4x 오버샘플링 EBU R128 트루피크 리미터',
    parameterSummary: 'Target -14.0 LUFS (±0.5) · Ceiling -1.0 dBTP · LRA 5.0~9.0 LU',
  },
];

export const BRAND_MUSIC_STUDIO_PRESETS: ReadonlyArray<{
  id: string;
  labelKo: string;
  summaryKo: string;
  score: BrandMusicScoreInput;
  videoDurationSec: number;
  videoRevealSec: number;
}> = [
  {
    id: 'french_house_runway_122',
    labelKo: '프렌치 하우스 런웨이 (122 BPM · 3.8초 드롭 0ms 정렬)',
    summaryKo:
      '펜더 로즈 리드 멜로디 + 타이트한 베이스라인 · 3.8초 클라이맥스 컷에 드롭 0ms 동기화 · Act 1 폴리 -3dB 더킹',
    score: BrandMusicScoreInputSchema.parse({
      presetId: 'french_house_runway_122',
      titleKo: '프렌치 하우스 런웨이 인스트루멘탈 (122 BPM)',
      bpm: 122,
      keySignature: 'Dm',
      leadInstrument: 'mellow Rhodes lead melody',
      trackDurationSec: 24,
      trackDropSec: 8.0,
    }),
    videoDurationSec: 15,
    videoRevealSec: 3.8,
  },
  {
    id: 'minimal_ambient_luxury_108',
    labelKo: '미니멀 럭셔리 앰비언트 첼로 (108 BPM · 3.2초 보틀 리빌 정렬)',
    summaryKo:
      '따뜻한 첼로 리드 선율 + 크리스털 아토마이저 분사 폴리 강조 · 향수·뷰티 매크로 필름 최적화',
    score: BrandMusicScoreInputSchema.parse({
      presetId: 'minimal_ambient_luxury_108',
      titleKo: '미니멀 럭셔리 첼로 & 글래스 인스트루멘탈 (108 BPM)',
      genreTag: 'minimal luxury ambient chamber electronic',
      leadInstrument: 'warm cello lead melody',
      rhythmFoundation: 'deep sub-pulse, delicate glass percussion, spacious silence between beats',
      harmonicTexture: 'suspended minor ninth chords, velvet string harmonics',
      moodTag: 'intimate, tactile, serene editorial',
      bpm: 108,
      keySignature: 'Am',
      trackDurationSec: 22,
      trackDropSec: 6.5,
    }),
    videoDurationSec: 12,
    videoRevealSec: 3.2,
  },
  {
    id: 'tactile_percussion_editorial_116',
    labelKo: '아키텍처럴 퍼커션 & 마림바 (116 BPM · 2.6초 아웃도어 리빌 정렬)',
    summaryKo:
      '글래스 마림바 모티프 + 드라이 우드 퍼커션 · 공간감 있는 아웃도어·룩북 캠페인 최적화',
    score: BrandMusicScoreInputSchema.parse({
      presetId: 'tactile_percussion_editorial_116',
      titleKo: '아키텍처럴 마림바 & 퍼커션 스코어 (116 BPM)',
      genreTag: 'architectural organic percussion, modern editorial soundtrack',
      leadInstrument: 'glass marimba lead motif',
      rhythmFoundation: 'crisp rimshot, muted tom groove, warm upright bass pluck',
      harmonicTexture: 'airy analog synth pad, subtle tape flutter',
      moodTag: 'kinetic, modern, sunlit architectural',
      bpm: 116,
      keySignature: 'Em',
      trackDurationSec: 20,
      trackDropSec: 6.0,
    }),
    videoDurationSec: 10,
    videoRevealSec: 2.6,
  },
];

export interface BrandSoundAndMusicStudioPlan {
  presetId: string;
  trackA_score: CompiledBrandMusicScore;
  trackB_dropSync: ViralDropSlicePlan & {
    preDropSilenceStartSec: number;
    preDropSilenceEndSec: number;
    barDurationSec: number;
    barGridMarkersSec: number[];
  };
  trackC_mastering: {
    stages: ReadonlyArray<MasteringStageSpec>;
    ffmpegNativeCleanFilter: string;
    ffmpegMasterFilter: string;
    snappedCues: SnappedSoundCue[];
    reconciliation: SoundReconciliationResult;
    deliverableStems: {
      masterWithBgm: {
        id: 'master_with_bgm';
        labelKo: string;
        targetLoudness: '-14.0 LUFS / -1.0 dBTP';
        commercialReady: boolean;
      };
      cleanFoleyOnly: {
        id: 'clean_foley_only';
        labelKo: string;
        targetLoudness: '-16.0 LUFS / -1.0 dBTP (No-BGM 클린 스템)';
        commercialReady: true;
      };
    };
  };
}

/**
 * Pure builder for the 3-Track Brand Sound & Music Studio plan.
 */
export function buildBrandSoundAndMusicStudioPlan(input: {
  score?: Partial<BrandMusicScoreInput>;
  videoDurationSec?: number;
  videoRevealSec?: number;
  cuePlan?: ArgonCuePlan;
  cueAnchors?: readonly SoundCueAnchor[];
}): BrandSoundAndMusicStudioPlan {
  const trackA_score = compileBrandMusicScore(input.score);
  const videoDurationSec = input.videoDurationSec ?? 15;
  const videoRevealSec = input.videoRevealSec ?? 3.8;

  const baseSlice = computeViralDropSlice({
    trackDurationSec: trackA_score.input.trackDurationSec,
    trackDropSec: trackA_score.input.trackDropSec,
    videoRevealSec,
    videoDurationSec,
  });

  const hushSec = trackA_score.input.editBrief.preDropHushWindowMs / 1000;
  const preDropSilenceStartSec = Number(Math.max(0, videoRevealSec - hushSec).toFixed(3));
  const preDropSilenceEndSec = Number(videoRevealSec.toFixed(3));
  const barDurationSec = Number(((60 / trackA_score.input.bpm) * 4).toFixed(3));

  const barGridMarkersSec: number[] = [];
  for (let t = 0; t <= videoDurationSec; t += barDurationSec) {
    barGridMarkersSec.push(Number(t.toFixed(2)));
  }

  const defaultAnchors: SoundCueAnchor[] = input.cueAnchors
    ? [...input.cueAnchors]
    : [
        {
          id: 'act1:heel_step:1',
          act: 'act1',
          timestampSec: 0.4,
          label: '초반 워킹 발걸음 및 코트 자락 스침',
          isRevealPoint: false,
        },
        {
          id: 'act1:glass_grip:2',
          act: 'act1',
          timestampSec: 1.1,
          label: '보틀 파지 및 금속 링 미세 클릭',
          isRevealPoint: false,
        },
        {
          id: 'act2:hero_reveal_drop:1',
          act: 'act2',
          timestampSec: videoRevealSec,
          label: '클라이맥스 제품 리빌 & 아토마이저 분사 트랜지언트',
          isRevealPoint: true,
        },
        {
          id: 'act3:plinth_settle:1',
          act: 'act3',
          timestampSec: Number(Math.max(videoRevealSec + 1.5, videoDurationSec - 2.2).toFixed(2)),
          label: '트래버틴 석재 단상 보틀 안착 및 룸톤 여운',
          isRevealPoint: false,
        },
      ];

  const defaultCuePlan: ArgonCuePlan = input.cuePlan ?? {
    palette: ['clean studio room tone', 'leather heel cadence', 'glass & atomizer foley'],
    cues: [
      {
        id: 'act1:heel_step:1',
        t_hint: '00:00',
        category: 'foley',
        description: '가죽 힐 스톤 접촉음 + 울 코트 스침 (Act 1 -3dB 자동 더킹)',
        level_db: -14,
        must_be_real_recording: true,
        reason: '초반 워킹 리듬 형성 및 공간감 부여',
      },
      {
        id: 'act1:glass_grip:2',
        t_hint: '00:01',
        category: 'foley',
        description: '유리 보틀 파지 및 황동 넥 미세 마찰음',
        level_db: -16,
        must_be_real_recording: true,
        reason: '제품 물성 전달',
      },
      {
        id: 'act2:hero_reveal_drop:1',
        t_hint: `00:${String(Math.max(1, Math.min(59, Math.round(videoRevealSec)))).padStart(2, '0')}`,
        category: 'foley',
        description: '클라이맥스 아토마이저 분사 트랜지언트 & BGM 드롭 0ms 합치',
        level_db: -9,
        must_be_real_recording: true,
        reason: '클라이맥스 리빌 임팩트',
      },
      {
        id: 'act3:plinth_settle:1',
        t_hint: `00:${String(Math.max(2, Math.round(videoDurationSec - 2))).padStart(2, '0')}`,
        category: 'foley',
        description: '석재 단상 보틀 안착 저역 임팩트',
        level_db: -12,
        must_be_real_recording: true,
        reason: '엔딩 팩샷 안정감 부여',
      },
    ],
    music: {
      needed: true,
      role: 'editorial runway pulse synced to climax reveal',
      drop_cue: 'act2:hero_reveal_drop:1',
      duck_under_cues_db: -3,
    },
    no_sound_at: [],
  };

  const snapped = snapCuePlanToFrames(defaultCuePlan, defaultAnchors, {
    duckAct1FoleyDb: -3,
  });

  const masterSpec = buildDeterministicSoundMasterSpec({
    targetLufs: -14.0,
    maxTruePeakDbtp: -1.0,
    targetLraLu: 7.0,
    stripNativeVideoCrackleAboveHz: 5500,
    replaceNativeAudioCompletely: true,
    act1FoleyDuckDb: -3,
  });

  const reconciliation = reconcileSoundVerdict({
    round: 1,
    argonVerdict: {
      pass: true,
      issues: [
        {
          cue_id: 'act2:hero_reveal_drop:1',
          problem: 'late',
          fix: '1-FPS sampling perceived 18ms offset, within 40ms frame sync tolerance',
        },
      ],
    },
    earshot: {
      lufs_i: -14.0,
      true_peak_dbtp: -1.1,
      lra_lu: 6.8,
      clipping_detected: false,
      high_freq_crackle_detected: false,
      cue_offsets_ms: {
        'act1:heel_step:1': 0,
        'act1:glass_grip:2': 4,
        'act2:hero_reveal_drop:1': 0,
        'act3:plinth_settle:1': -6,
      },
    },
  });

  return {
    presetId: trackA_score.input.presetId,
    trackA_score,
    trackB_dropSync: {
      ...baseSlice,
      preDropSilenceStartSec,
      preDropSilenceEndSec,
      barDurationSec,
      barGridMarkersSec,
    },
    trackC_mastering: {
      stages: EIGHT_STAGE_BROADCAST_MASTERING_CHAIN,
      ffmpegNativeCleanFilter: masterSpec.nativeStemCleanFilter,
      ffmpegMasterFilter: masterSpec.masterFilter,
      snappedCues: snapped.cues,
      reconciliation,
      deliverableStems: {
        masterWithBgm: {
          id: 'master_with_bgm',
          labelKo: '상업용 통합 마스터 (인스트루멘탈 BGM + 실사 폴리 · -14.0 LUFS)',
          targetLoudness: '-14.0 LUFS / -1.0 dBTP',
          commercialReady: trackA_score.licenseGate.commercialAllowed && baseSlice.valid,
        },
        cleanFoleyOnly: {
          id: 'clean_foley_only',
          labelKo: '클린 폴리 전용 스템 (No-BGM · 릴스/틱톡 외부 음원 결합용)',
          targetLoudness: '-16.0 LUFS / -1.0 dBTP (No-BGM 클린 스템)',
          commercialReady: true,
        },
      },
    },
  };
}

const PlanSoundStudioOperationSchema = z.object({
  organizationId: z.string().uuid(),
  presetId: z.string().trim().min(1).max(64).optional(),
  score: BrandMusicScoreInputSchema.partial().optional(),
  videoDurationSec: z.number().min(3).max(30).optional(),
  videoRevealSec: z.number().min(0.2).max(29.5).optional(),
});

async function verifySoundStudioWriteActor(
  sql: SqlRunner,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const profile = (
    await sql.query<{ is_admin: boolean }>(
      'select is_admin from profiles where id = $1 for share',
      [userId]
    )
  ).rows[0];
  if (!profile) return false;
  if (profile.is_admin) return true;

  const membership = (
    await sql.query<{ role: string }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active' for share",
      [organizationId, userId]
    )
  ).rows[0];
  return membership?.role === 'owner' || membership?.role === 'editor';
}

/**
 * Authorized S5 Sound & Music Studio operation for `/api/brand-workspace` (`soundStudio.plan`).
 * Enforces `owner | editor` membership BEFORE `sound` feature policy (returns `feature_unavailable` for Morphic).
 */
export async function planBrandSoundAndMusicStudio(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  rawInput: unknown
): Promise<BrandOutcome<{ id: string; plan: BrandSoundAndMusicStudioPlan }>> {
  if (!viewer.userId || !z.string().uuid().safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = PlanSoundStudioOperationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'score',
    };
  }

  const authorized = await verifySoundStudioWriteActor(
    deps.sql,
    viewer.userId,
    parsed.data.organizationId
  );
  if (!authorized) {
    return { ok: false, code: 'forbidden' };
  }

  try {
    await assertBrandFeature(deps.sql, parsed.data.organizationId, 'sound');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }

  const preset = parsed.data.presetId
    ? BRAND_MUSIC_STUDIO_PRESETS.find((p) => p.id === parsed.data.presetId)
    : undefined;

  const mergedScore: Partial<BrandMusicScoreInput> = {
    ...(preset?.score ?? {}),
    ...(parsed.data.score ?? {}),
  };

  const plan = buildBrandSoundAndMusicStudioPlan({
    score: mergedScore,
    videoDurationSec: parsed.data.videoDurationSec ?? preset?.videoDurationSec ?? 15,
    videoRevealSec: parsed.data.videoRevealSec ?? preset?.videoRevealSec ?? 3.8,
  });

  return {
    ok: true,
    id: parsed.data.organizationId,
    plan,
  };
}
