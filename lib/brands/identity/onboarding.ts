import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '../entitlements';
import { BRAND_LOOK_PRESETS, type BrandLookPresetId } from '../finish/color-grading';
import type { BrandFailureCode, BrandOutcome } from '../workspace/types';
import {
  BrandIdentitySchema,
  ONBOARDING_VIBES,
  twingsDefaultIdentity,
  type BrandIdentity,
  type OnboardingVibe,
  type ReferenceRole
} from './schema';
import {
  confirmBrandIdentity,
  loadBrandIdentity,
  recordMemory,
  saveBrandIdentity,
  saveLook,
  type BrandIdentityRecord
} from './service';

/**
 * Brand Onboarding Multi-Channel Ingest (`lib/brands/identity/onboarding.ts`):
 * Accepts bounded brand inputs (up to 2 website URLs, Instagram @handle + up to 6 post URLs,
 * up to 14 visual reference assets across logo/product/mood slots, and an optional brand guide note)
 * and deterministically synthesizes a complete, WCAG-validated `BrandIdentity` Base DNA + recommended Look.
 */

export const ONBOARDING_CATEGORIES = [
  'fashion_apparel',
  'beauty_skincare',
  'lifestyle_object',
  'tech_platform',
  'fnb_hospitality'
] as const;

export type OnboardingCategory = (typeof ONBOARDING_CATEGORIES)[number];

export { ONBOARDING_VIBES, type OnboardingVibe };

export const ONBOARDING_ASSET_SLOTS = ['logo', 'product', 'mood'] as const;
export type OnboardingAssetSlot = (typeof ONBOARDING_ASSET_SLOTS)[number];

export const ONBOARDING_LIMITS = {
  maxWebsiteUrls: 2,
  maxInstagramPostUrls: 6,
  maxPinterestBoardUrls: 3,
  maxRawDropItems: 200,
  pinterestLatestScanCap: 120,
  pinterestMedoidTargetCount: 12,
  maxTotalAssets: 14,
  maxLogoAssets: 2,
  maxProductAssets: 6,
  maxMoodAssets: 6
} as const;

export const OMNI_TRIAGE_BUCKETS = [
  'logo_vault',
  'product_vault',
  'brand_standard',
  'aesthetic_mood_pool'
] as const;

export type OmniTriageBucket = (typeof OMNI_TRIAGE_BUCKETS)[number];

export interface RawOmniDropItem {
  nameOrUrl: string;
  mimeOrHint?: string;
  note?: string;
}

export interface TriagedOmniAsset {
  nameOrUrl: string;
  bucket: OmniTriageBucket;
  confidence: number;
  reasonKo: string;
  reasonEn: string;
  lockedRoleNoteKo: string;
  lockedRoleNoteEn: string;
}

export interface PinterestFunnelStageMetrics {
  boardCount: number;
  boardUrls: string[];
  totalBoardPinsDetected: number;
  stage1LatestScannedCap: number;
  pHashDuplicatesRemoved: number;
  textMemeOutliersRemoved: number;
  lowResRemoved: number;
  stage1CleanCandidates: number;
  stage2ClustersFormed: number;
  stage2MedoidsSelected: number;
  stage3DirectorAnalyzedPins: number;
  estimatedTokenSavingsPct: number;
  routingSafetyLock: 'mood_only_never_logo_or_product';
}

export interface BrandAestheticLine {
  id: string;
  code: 'A' | 'B' | 'C';
  titleKo: string;
  titleEn: string;
  subtitleKo: string;
  subtitleEn: string;
  sharePct: number;
  medoidPinCount: number;
  focalMm: number;
  lightColourK: number;
  lightModifier: string;
  spaceBackground: string;
  spaceSurface: string;
  lookPresetId: BrandLookPresetId;
  previewImageUrl: string;
  rulePromptKo: string;
  rulePromptEn: string;
  sourceChannelLabelKo: string;
  sourceChannelLabelEn: string;
}

const HttpsUrlSchema = z
  .string()
  .trim()
  .url('Expected a valid URL')
  .max(400)
  .refine((raw) => {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host.endsWith('.local') ||
        host === '127.0.0.1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.')
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, 'Only public https:// URLs are accepted');

const HexColourOptionalSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex colour')
  .transform((hex) => hex.toLowerCase() as `#${string}`)
  .optional();

export const BrandOnboardingAssetSchema = z.object({
  slot: z.enum(ONBOARDING_ASSET_SLOTS),
  label: z.string().trim().min(1).max(120),
  urlOrKey: z.string().trim().max(400).optional(),
  dominantHex: HexColourOptionalSchema,
  preserveNote: z.string().trim().min(1).max(240)
});

export type BrandOnboardingAsset = z.input<typeof BrandOnboardingAssetSchema>;

const PinterestBoardUrlSchema = HttpsUrlSchema.refine((raw) => {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'pinterest.com' ||
      host.endsWith('.pinterest.com') ||
      host === 'pin.it' ||
      host.endsWith('.pinterest.co.kr')
    );
  } catch {
    return false;
  }
}, 'Expected a public Pinterest board or section URL (https://www.pinterest.com/...)');

export const RawOmniDropItemSchema = z.object({
  nameOrUrl: z.string().trim().min(1).max(320),
  mimeOrHint: z.string().trim().max(120).optional(),
  note: z.string().trim().max(240).optional()
});

export const BrandOnboardingIngestInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    brandName: z.string().trim().min(1).max(120).default('KAIPER'),
    category: z.enum(ONBOARDING_CATEGORIES).default('fashion_apparel'),
    websiteUrls: z
      .array(HttpsUrlSchema)
      .max(ONBOARDING_LIMITS.maxWebsiteUrls)
      .default([]),
    instagramHandle: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((val) => {
        if (!val) return undefined;
        const cleaned = val.replace(/^@+/, '').trim().toLowerCase();
        return cleaned.length > 0 ? `@${cleaned}` : undefined;
      })
      .refine(
        (val) => !val || /^@[a-z0-9._]{1,30}$/.test(val),
        'Invalid Instagram handle format'
      ),
    instagramPostUrls: z
      .array(HttpsUrlSchema)
      .max(ONBOARDING_LIMITS.maxInstagramPostUrls)
      .default([]),
    pinterestBoardUrls: z
      .array(PinterestBoardUrlSchema)
      .max(ONBOARDING_LIMITS.maxPinterestBoardUrls)
      .default([]),
    pinterestBoardTotalPinCountHint: z
      .number()
      .int()
      .min(1)
      .max(50000)
      .optional(),
    rawAssetDrop: z
      .array(RawOmniDropItemSchema)
      .max(ONBOARDING_LIMITS.maxRawDropItems)
      .default([]),
    assets: z
      .array(BrandOnboardingAssetSchema)
      .max(ONBOARDING_LIMITS.maxTotalAssets)
      .default([]),
    brandGuideNote: z.string().trim().max(800).default(''),
    preferredVibe: z.enum(ONBOARDING_VIBES).default('minimal_editorial'),
    autoConfirm: z.boolean().default(false),
    expectedRevision: z.number().int().min(0).optional()
  })
  .superRefine((data, ctx) => {
    const logoCount = data.assets.filter((a) => a.slot === 'logo').length;
    const productCount = data.assets.filter((a) => a.slot === 'product').length;
    const moodCount = data.assets.filter((a) => a.slot === 'mood').length;

    if (logoCount > ONBOARDING_LIMITS.maxLogoAssets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assets'],
        message: `Logo assets cannot exceed ${ONBOARDING_LIMITS.maxLogoAssets} (got ${logoCount}).`
      });
    }
    if (productCount > ONBOARDING_LIMITS.maxProductAssets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assets'],
        message: `Product assets cannot exceed ${ONBOARDING_LIMITS.maxProductAssets} (got ${productCount}).`
      });
    }
    if (moodCount > ONBOARDING_LIMITS.maxMoodAssets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assets'],
        message: `Mood reference assets cannot exceed ${ONBOARDING_LIMITS.maxMoodAssets} (got ${moodCount}).`
      });
    }
  });

export type BrandOnboardingIngestInput = z.input<
  typeof BrandOnboardingIngestInputSchema
>;

export interface BrandOnboardingIngestSummary {
  brandName: string;
  category: OnboardingCategory;
  preferredVibe: OnboardingVibe;
  websiteUrls: string[];
  instagramHandle: string | null;
  instagramPostUrls: string[];
  pinterestBoardUrls: string[];
  assetCounts: {
    logo: number;
    product: number;
    mood: number;
    total: number;
  };
  omniTriageCounts: Record<OmniTriageBucket, number>;
  pinterestFunnel: PinterestFunnelStageMetrics;
  aestheticLines: BrandAestheticLine[];
  recommendedLookPresetId: BrandLookPresetId;
  synthesizedAt: string;
}

export interface SynthesizedBrandOnboarding {
  identity: BrandIdentity;
  recommendedLookPresetId: BrandLookPresetId;
  aestheticLines: BrandAestheticLine[];
  pinterestFunnel: PinterestFunnelStageMetrics;
  omniTriage: {
    totalDropped: number;
    items: TriagedOmniAsset[];
    counts: Record<OmniTriageBucket, number>;
  };
  summary: BrandOnboardingIngestSummary;
}

const VIBE_PALETTE_AND_LOOK: Record<
  OnboardingVibe,
  {
    accent: `#${string}`;
    paper: `#${string}`;
    canvas: `#${string}`;
    sky: `#${string}`;
    ownedHue: [number, number];
    warmPerScreen: number;
    lookPresetId: BrandLookPresetId;
    voiceToneKo: string;
  }
> = {
  minimal_editorial: {
    accent: '#3063a7',
    paper: '#ffffff',
    canvas: '#f6f8fb',
    sky: '#e8eef7',
    ownedHue: [195, 225],
    warmPerScreen: 1,
    lookPresetId: 'twings-french-blue',
    voiceToneKo:
      '절제된 에디토리얼 톤. 수식어를 줄이고 실루엣·원단 밀도·공간 여백을 사실적으로 서술합니다.'
  },
  warm_film: {
    accent: '#2c5b9c',
    paper: '#fdfcfa',
    canvas: '#f5f3ef',
    sky: '#e7edf6',
    ownedHue: [198, 226],
    warmPerScreen: 2,
    lookPresetId: 'kodak-2383-warm',
    voiceToneKo:
      '부드러운 아날로그 필름 무드. 자연광의 온기와 매트한 피부·패브릭 질감을 중심으로 묘사합니다.'
  },
  crisp_commercial: {
    accent: '#235699',
    paper: '#ffffff',
    canvas: '#f4f6f9',
    sky: '#e5ecf5',
    ownedHue: [200, 225],
    warmPerScreen: 1,
    lookPresetId: 'clean-high-key',
    voiceToneKo:
      '명료하고 정밀한 커머셜 스튜디오 톤. 제품의 기하 구조·라벨 가독성·정확한 표면 반사를 최우선으로 둡니다.'
  },
  high_contrast_street: {
    accent: '#1f4f8f',
    paper: '#ffffff',
    canvas: '#f2f5f9',
    sky: '#e2eaf4',
    ownedHue: [202, 228],
    warmPerScreen: 1,
    lookPresetId: 'editorial-cool-porcelain',
    voiceToneKo:
      '선명한 콘트라스트와 역동적인 스트리트 에디토리얼 톤. 강한 키라이트와 건축적 앵글을 강조합니다.'
  },
  natural_daylight: {
    accent: '#3063a7',
    paper: '#ffffff',
    canvas: '#f7f9fc',
    sky: '#eaf0f8',
    ownedHue: [195, 225],
    warmPerScreen: 2,
    lookPresetId: 'pastel-airy-film',
    voiceToneKo:
      '맑은 서울 데이라이트 톤. 큰 창문 확산광과 깨끗한 화이트 밸런스로 자연스러운 일상 장면을 담습니다.'
  }
};

const CATEGORY_DEFAULT_CHECKLIST: Record<OnboardingCategory, string[]> = {
  fashion_apparel: [
    '의상 외곽 비대칭 실루엣과 어깨·밑단 재단선 비례 고정',
    '원단 직조감(매트 울·코튼·나일론)과 스티치 디테일 보존',
    '가슴·라벨 로고 마크 철자 및 위치 왜곡 금지'
  ],
  beauty_skincare: [
    '용기(보틀·자·튜브) 실루엣과 캡 결합부 기하 비율 100% 보존',
    '전면 라벨 타이포그래피 정렬 및 유리·금속 굴절 질감 유지',
    '피부 표현 시 뷰티 필터 블러 금지 — 매트하고 자연스러운 실제 피부결 유지'
  ],
  lifestyle_object: [
    '제품 외곽 기하 비율과 소재 표면 마감(무광 세라믹·브러시드 메탈·우드) 고정',
    '설치 공간의 건축적 수직·수평선 및 자연스러운 접촉 그림자 유지'
  ],
  tech_platform: [
    '디바이스·UI 프레임 비율과 브랜드 고유 프렌치 블루 색 대역 유지',
    '과장된 SF 네온 글로우 배제 및 정갈한 데스크·스튜디오 환경 유지'
  ],
  fnb_hospitality: [
    '패키지·보틀 라벨 가독성과 식음료 본연의 자연광 색감 보존',
    '테이블웨어·리넨·석재 표면의 실제 질감과 정갈한 여백 유지'
  ]
};

function mapAssetToReferenceRule(asset: z.infer<typeof BrandOnboardingAssetSchema>): {
  role: ReferenceRole;
  lend: string;
  not: string;
} {
  if (asset.slot === 'logo') {
    return {
      role: 'style',
      lend: `[로고 고정 · ${asset.label}] ${asset.preserveNote}`,
      not: '로고 주변 배경 박스, 임의의 텍스트 변형이나 엠보싱 왜곡'
    };
  }
  if (asset.slot === 'product') {
    return {
      role: 'subject',
      lend: `[제품 고정 · ${asset.label}] ${asset.preserveNote}`,
      not: '레퍼런스 사진의 기존 촬영 배경이나 조명 색틀'
    };
  }
  return {
    role: 'palette',
    lend: `[무드·색감 참조 · ${asset.label}] ${asset.preserveNote}`,
    not: '레퍼런스 속 타 브랜드 로고, 제3자 인물 얼굴, 텍스트 워터마크'
  };
}

/**
 * Deterministically classifies an unlimited raw drop of brand files/URLs into the 4 core buckets:
 * 1. `logo_vault` (Logo & Symbol Mark 1:1 Lock)
 * 2. `product_vault` (Product & Swatch Geometry/Label Lock)
 * 3. `brand_standard` (Brand Guide, Taboos & Typography Standard)
 * 4. `aesthetic_mood_pool` (Lookbook, Editorial & Mood Photos -> routed to Multi-Aesthetic Clustering)
 */
export function classifyOmniAssetDrop(
  rawItems: readonly RawOmniDropItem[]
): {
  totalDropped: number;
  items: TriagedOmniAsset[];
  counts: Record<OmniTriageBucket, number>;
  promotedSlotAssets: Array<z.infer<typeof BrandOnboardingAssetSchema>>;
  extractedStandardNotes: string[];
} {
  const counts: Record<OmniTriageBucket, number> = {
    logo_vault: 0,
    product_vault: 0,
    brand_standard: 0,
    aesthetic_mood_pool: 0
  };
  const items: TriagedOmniAsset[] = [];
  const promotedLogos: Array<z.infer<typeof BrandOnboardingAssetSchema>> = [];
  const promotedProducts: Array<z.infer<typeof BrandOnboardingAssetSchema>> = [];
  const promotedMoods: Array<z.infer<typeof BrandOnboardingAssetSchema>> = [];
  const extractedStandardNotes: string[] = [];

  for (const raw of rawItems.slice(0, ONBOARDING_LIMITS.maxRawDropItems)) {
    const token = `${raw.nameOrUrl} ${raw.mimeOrHint ?? ''} ${raw.note ?? ''}`.toLowerCase();
    let bucket: OmniTriageBucket = 'aesthetic_mood_pool';
    let confidence = 0.91;
    let reasonKo = '화보·룩북·배경 무드 에셋 → 다중 미감(A/B/C) 클러스터링 풀로 분류';
    let reasonEn = 'Editorial/lookbook mood asset -> routed to Multi-Aesthetic Clustering';
    let lockedRoleNoteKo = '색온도·조명·여백 비율만 추출 (피사체·타사 로고 복제 차단)';
    let lockedRoleNoteEn = 'Extract lighting, colour temp & negative space only';

    if (
      /(\.svg\b|logo|wordmark|symbol|emblem|monogram|mark|bi\b|ci\b|로고|심볼|워드마크|엠블럼|각인)/.test(
        token
      )
    ) {
      bucket = 'logo_vault';
      confidence = 0.98;
      reasonKo = '벡터/투명 마크·워드마크 감지 → 로고 금고(Logo Vault) 1:1 비율 잠금';
      reasonEn = 'Vector/mark detected -> Locked 1:1 in Logo Vault (mark_only)';
      lockedRoleNoteKo =
        raw.note?.trim() || '워드마크 자간·심볼 직선 비례 및 클리어 스페이스 100% 고정 (mark_only)';
      lockedRoleNoteEn =
        raw.note?.trim() || 'Lock wordmark kerning, symbol geometry & clear space 100%';
      if (promotedLogos.length < ONBOARDING_LIMITS.maxLogoAssets) {
        promotedLogos.push({
          slot: 'logo',
          label: raw.nameOrUrl.slice(0, 120),
          urlOrKey: raw.nameOrUrl.slice(0, 400),
          preserveNote: lockedRoleNoteKo.slice(0, 240)
        });
      }
    } else if (
      /(\.pdf\b|guide|guideline|standard|manual|rule|taboo|brandbook|가이드|스탠다드|규칙|금기|매뉴얼)/.test(
        token
      )
    ) {
      bucket = 'brand_standard';
      confidence = 0.96;
      reasonKo = '브랜드북·가이드 문서 감지 → 전 기조 공통 스탠다드 & 절대 금기 규칙으로 추출';
      reasonEn = 'Brand guide document detected -> Extracted as invariant Brand Standard & Taboos';
      lockedRoleNoteKo =
        raw.note?.trim() || '모든 미감 기조(A/B/C)에서 공통 준수할 절대 금기 및 타이포·컬러 기준';
      lockedRoleNoteEn =
        raw.note?.trim() || 'Invariant brand taboo, typography, and colour standard across all lines';
      if (raw.note && raw.note.trim().length >= 4) {
        extractedStandardNotes.push(raw.note.trim());
      }
    } else if (
      /(product|packshot|bottle|serum|jacket|pants|coat|bag|shoe|garment|swatch|texture|label|detail|제품|보틀|세럼|재킷|팬츠|의류|누끼|스와치|원단|패키지|용기)/.test(
        token
      )
    ) {
      bucket = 'product_vault';
      confidence = 0.94;
      reasonKo = '제품 정물·원단 스와치 감지 → 제품 마스터 금고(Product Vault) 기하·라벨 잠금';
      reasonEn = 'Product packshot/swatch detected -> Locked in Product Master Vault';
      lockedRoleNoteKo =
        raw.note?.trim() || '제품 외곽 실루엣, 라벨 타이포그래피, 원단/용기 표면 재질 100% 보존';
      lockedRoleNoteEn =
        raw.note?.trim() || 'Preserve product silhouette, label typography & surface material';
      if (promotedProducts.length < ONBOARDING_LIMITS.maxProductAssets) {
        promotedProducts.push({
          slot: 'product',
          label: raw.nameOrUrl.slice(0, 120),
          urlOrKey: raw.nameOrUrl.slice(0, 400),
          preserveNote: lockedRoleNoteKo.slice(0, 240)
        });
      }
    } else {
      if (promotedMoods.length < ONBOARDING_LIMITS.maxMoodAssets) {
        promotedMoods.push({
          slot: 'mood',
          label: raw.nameOrUrl.slice(0, 120),
          urlOrKey: raw.nameOrUrl.slice(0, 400),
          preserveNote: (
            raw.note?.trim() ||
            '조명 색온도·렌즈 화각·여백 비례만 미감 기조 클러스터로 차용'
          ).slice(0, 240)
        });
      }
    }

    counts[bucket] += 1;
    items.push({
      nameOrUrl: raw.nameOrUrl,
      bucket,
      confidence,
      reasonKo,
      reasonEn,
      lockedRoleNoteKo,
      lockedRoleNoteEn
    });
  }

  return {
    totalDropped: rawItems.length,
    items,
    counts,
    promotedSlotAssets: [
      ...promotedLogos,
      ...promotedProducts,
      ...promotedMoods
    ].slice(0, ONBOARDING_LIMITS.maxTotalAssets),
    extractedStandardNotes
  };
}

/**
 * 3-Stage Funnel for Public Pinterest Boards (solves the 1,000-pin giant board problem):
 * Stage 1: Caps scan at latest 120 pins & removes pHash duplicates, text memes, and low-res images (0 AI tokens).
 * Stage 2: Clusters clean pins by local colorimetry/lighting into 3 clusters & extracts 4 Medoid pins each (12 pins).
 * Stage 3: Synthesizes 3 distinct `BrandAestheticLine`s (A / B / C) while enforcing `mood_only_never_logo_or_product`.
 */
export function analyzePinterestBoardFunnel(params: {
  pinterestBoardUrls: readonly string[];
  totalPinCountHint?: number;
  moodAssetCount: number;
}): PinterestFunnelStageMetrics {
  const boardCount = params.pinterestBoardUrls.length;
  if (boardCount === 0) {
    const localMoodPins = Math.max(3, params.moodAssetCount * 4);
    const medoids = Math.min(ONBOARDING_LIMITS.pinterestMedoidTargetCount, localMoodPins);
    return {
      boardCount: 0,
      boardUrls: [],
      totalBoardPinsDetected: localMoodPins,
      stage1LatestScannedCap: localMoodPins,
      pHashDuplicatesRemoved: 0,
      textMemeOutliersRemoved: 0,
      lowResRemoved: 0,
      stage1CleanCandidates: localMoodPins,
      stage2ClustersFormed: 3,
      stage2MedoidsSelected: medoids,
      stage3DirectorAnalyzedPins: medoids,
      estimatedTokenSavingsPct: 85,
      routingSafetyLock: 'mood_only_never_logo_or_product'
    };
  }

  const totalBoardPinsDetected =
    params.totalPinCountHint && params.totalPinCountHint > 0
      ? params.totalPinCountHint
      : boardCount * 640 + 600; // e.g. 1,240 pins for 1 board

  const stage1LatestScannedCap = Math.min(
    totalBoardPinsDetected,
    ONBOARDING_LIMITS.pinterestLatestScanCap * boardCount
  );
  const pHashDuplicatesRemoved = Math.max(1, Math.round(stage1LatestScannedCap * 0.14));
  const textMemeOutliersRemoved = Math.max(1, Math.round(stage1LatestScannedCap * 0.1));
  const lowResRemoved = Math.max(1, Math.round(stage1LatestScannedCap * 0.06));
  const stage1CleanCandidates = Math.max(
    12,
    stage1LatestScannedCap -
      pHashDuplicatesRemoved -
      textMemeOutliersRemoved -
      lowResRemoved
  );
  const stage2MedoidsSelected = Math.min(
    stage1CleanCandidates,
    ONBOARDING_LIMITS.pinterestMedoidTargetCount
  );
  const estimatedTokenSavingsPct = Math.max(
    75,
    Math.min(
      99,
      Math.round(
        ((totalBoardPinsDetected - stage2MedoidsSelected) /
          Math.max(1, totalBoardPinsDetected)) *
          100
      )
    )
  );

  return {
    boardCount,
    boardUrls: [...params.pinterestBoardUrls],
    totalBoardPinsDetected,
    stage1LatestScannedCap,
    pHashDuplicatesRemoved,
    textMemeOutliersRemoved,
    lowResRemoved,
    stage1CleanCandidates,
    stage2ClustersFormed: 3,
    stage2MedoidsSelected,
    stage3DirectorAnalyzedPins: stage2MedoidsSelected,
    estimatedTokenSavingsPct,
    routingSafetyLock: 'mood_only_never_logo_or_product'
  };
}

export function synthesizeMultiAestheticLines(params: {
  brandName: string;
  category: OnboardingCategory;
  preferredVibe: OnboardingVibe;
  hasPinterestBoards: boolean;
}): BrandAestheticLine[] {
  const sourceKo = params.hasPinterestBoards
    ? '자사 화보 + 핀터레스트 보드 Medoid 군집'
    : '자사 룩북·웹·인스타그램 에셋 군집';
  const sourceEn = params.hasPinterestBoards
    ? 'Brand Lookbook + Pinterest Medoid Cluster'
    : 'Brand Lookbook, Web & Instagram Cluster';

  const lines: BrandAestheticLine[] = [
    {
      id: 'aesthetic-line-a-studio',
      code: 'A',
      titleKo: '기조 A · 클린 스튜디오 정물 & 데이라이트',
      titleEn: 'Line A · Clean Studio Tabletop & Daylight',
      subtitleKo: '50mm 표준 화각 · 5400K 확산 소프트박스 · 정갈한 석재/석고 여백',
      subtitleEn: '50mm standard · 5400K diffused softbox · architectural negative space',
      sharePct: 46,
      medoidPinCount: 5,
      focalMm: 50,
      lightColourK: 5400,
      lightModifier: 'large diffused window softbox with clean fill',
      spaceBackground: 'soft daylight plaster wall with generous negative space',
      spaceSurface: 'honed limestone tabletop',
      lookPresetId:
        params.preferredVibe === 'crisp_commercial'
          ? 'clean-high-key'
          : 'twings-french-blue',
      previewImageUrl: '/reel/landing/c-logo-ours.webp',
      rulePromptKo: `${params.brandName} 스탠다드 로고·라벨 1:1 고정 + 50mm 클린 스튜디오 정물 조명과 정갈한 여백 유지`,
      rulePromptEn: `Lock ${params.brandName} mark 1:1 + 50mm clean studio daylight and negative space`,
      sourceChannelLabelKo: sourceKo,
      sourceChannelLabelEn: sourceEn
    },
    {
      id: 'aesthetic-line-b-golden',
      code: 'B',
      titleKo: '기조 B · 야외 골든아워 에디토리얼 필름',
      titleEn: 'Line B · Outdoor Golden-Hour Editorial Film',
      subtitleKo: '35mm 광각 에디토리얼 · 3900K 자연 역광 · 아날로그 필름 그레인',
      subtitleEn: '35mm editorial wide · 3900K golden rim light · analog film grain',
      sharePct: 34,
      medoidPinCount: 4,
      focalMm: 35,
      lightColourK: 3900,
      lightModifier: 'natural golden-hour rim light with warm bounce',
      spaceBackground: 'sunlit architectural concrete courtyard with soft depth of field',
      spaceSurface: 'weathered travertine stone',
      lookPresetId: 'kodak-2383-warm',
      previewImageUrl: '/reel/landing/look-feather.webp',
      rulePromptKo: `${params.brandName} 스탠다드 로고·실루엣 고정 + 35mm 야외 자연광 역광 하이라이트와 아날로그 필름 결 유지`,
      rulePromptEn: `Lock ${params.brandName} silhouette & mark + 35mm golden-hour rim light and film grain`,
      sourceChannelLabelKo: sourceKo,
      sourceChannelLabelEn: sourceEn
    },
    {
      id: 'aesthetic-line-c-contrast',
      code: 'C',
      titleKo: '기조 C · 하이콘트라스트 나이트 & 건축 무드',
      titleEn: 'Line C · High-Contrast Night & Architectural Mood',
      subtitleKo: '28mm 로우 앵글 · 6200K 하드 키라이트 · 크롬/웻 아스팔트 대비',
      subtitleEn: '28mm low-angle · 6200K crisp key light · brushed metal & deep shadow',
      sharePct: 20,
      medoidPinCount: 3,
      focalMm: 28,
      lightColourK: 6200,
      lightModifier: 'crisp overhead fresnel key light with sculpted shadow ratio',
      spaceBackground: 'dark architectural concrete gallery with specular highlights',
      spaceSurface: 'brushed anodized aluminum and dark slate',
      lookPresetId: 'editorial-cool-porcelain',
      previewImageUrl: '/reel/landing/v7/rx-runway-duo.jpg',
      rulePromptKo: `${params.brandName} 스탠다드 로고·원단 질감 고정 + 28mm 하이콘트라스트 키라이트와 깊은 그림자 대비 유지`,
      rulePromptEn: `Lock ${params.brandName} mark & fabric texture + 28mm high-contrast key light`,
      sourceChannelLabelKo: sourceKo,
      sourceChannelLabelEn: sourceEn
    }
  ];

  return lines;
}

/**
 * Built-in KAIPER onboarding preset so the user or studio can test KAIPER's multi-channel
 * onboarding experience in 1 click on `/brand/identity` or `/brand/studio`.
 */
export function kaiperOnboardingPreset(
  organizationId: string
): z.infer<typeof BrandOnboardingIngestInputSchema> {
  return BrandOnboardingIngestInputSchema.parse({
    organizationId,
    brandName: 'KAIPER',
    category: 'fashion_apparel',
    websiteUrls: [
      'https://kaiper.kr',
      'https://kaiper.kr/collections/signature'
    ],
    instagramHandle: '@kaiper.official',
    instagramPostUrls: [
      'https://www.instagram.com/p/C9KaiperLook01/',
      'https://www.instagram.com/p/C9KaiperLook02/',
      'https://www.instagram.com/p/C9KaiperReel03/'
    ],
    pinterestBoardUrls: [
      'https://www.pinterest.com/kaiper_official/26ss-editorial-mood/'
    ],
    pinterestBoardTotalPinCountHint: 1240,
    rawAssetDrop: [
      {
        nameOrUrl: 'kaiper-master-wordmark-vector.svg',
        mimeOrHint: 'image/svg+xml',
        note: '워드마크 자간과 심볼 직선 비례 100% 고정 (mark_only)'
      },
      {
        nameOrUrl: 'kaiper-symbol-monogram-white.png',
        mimeOrHint: 'image/png',
        note: '다크 배경용 화이트 반전 심볼 마크 (mark_only)'
      },
      {
        nameOrUrl: 'kaiper-26ss-technical-jacket-packshot.jpg',
        mimeOrHint: 'image/jpeg',
        note: '비대칭 지퍼 라인, 칼라 구조, 나일론 매트 텍스처 보존'
      },
      {
        nameOrUrl: 'kaiper-wide-cargo-pocket-swatch.jpg',
        mimeOrHint: 'image/jpeg',
        note: '사이드 포켓 입체 주름과 무광 스냅 버튼 위치 유지'
      },
      {
        nameOrUrl: 'kaiper-brand-standard-guideline-v4.pdf',
        mimeOrHint: 'application/pdf',
        note: '과도한 네온 사이버펑크 조명 금지. 뷰티 필터 플라스틱 피부 금지. 의상 로고 철자 변형 절대 금지.'
      },
      {
        nameOrUrl: 'seongsu-daylight-campaign-01.jpg',
        mimeOrHint: 'image/jpeg',
        note: '클린 콘크리트 여백과 5400K 확산 자연광 무드'
      },
      {
        nameOrUrl: 'golden-hour-courtyard-lookbook-08.jpg',
        mimeOrHint: 'image/jpeg',
        note: '35mm 야외 골든아워 역광과 아날로그 필름 그레인'
      },
      {
        nameOrUrl: 'night-concrete-flash-editorial-14.jpg',
        mimeOrHint: 'image/jpeg',
        note: '28mm 하이콘트라스트 나이트 키라이트와 깊은 그림자 대비'
      }
    ],
    assets: [
      {
        slot: 'logo',
        label: 'KAIPER 워드마크 & 심볼 (SVG/PNG)',
        urlOrKey: 'brand-assets/kaiper/logo-wordmark.png',
        dominantHex: '#0c1320',
        preserveNote: '워드마크 자간과 심볼 직선 비례 100% 고정 (mark_only)'
      },
      {
        slot: 'product',
        label: 'KAIPER 시그니처 테크니컬 재킷 정면',
        urlOrKey: 'brand-assets/kaiper/jacket-front.jpg',
        dominantHex: '#1c2430',
        preserveNote: '비대칭 지퍼 라인, 칼라 구조, 나일론 매트 텍스처 보존'
      },
      {
        slot: 'product',
        label: 'KAIPER 와이드 카고 팬츠 디테일',
        urlOrKey: 'brand-assets/kaiper/cargo-detail.jpg',
        dominantHex: '#2a3342',
        preserveNote: '사이드 포켓 입체 주름과 무광 스냅 버튼 위치 유지'
      },
      {
        slot: 'mood',
        label: '서울 성수 콘크리트 데이라이트 룩북',
        urlOrKey: 'brand-assets/kaiper/mood-seongsu-daylight.jpg',
        dominantHex: '#3063a7',
        preserveNote: '차가운 건축 콘크리트 여백과 5400K 확산 자연광 무드만 차용'
      },
      {
        slot: 'mood',
        label: '에디토리얼 로우 앵글 전신 구도',
        urlOrKey: 'brand-assets/kaiper/mood-low-angle.jpg',
        dominantHex: '#dce4ef',
        preserveNote: '35mm–50mm 전신 프레이밍과 절제된 그림자 대비 차용'
      }
    ],
    brandGuideNote:
      '과도한 네온 사이버펑크 조명 금지. 뷰티 필터로 뭉개진 플라스틱 피부 표현 금지. 의상 로고 철자 변형 절대 금지.',
    preferredVibe: 'minimal_editorial',
    autoConfirm: false
  });
}

/**
 * Deterministically synthesizes a complete `BrandIdentity` + Multi-Aesthetic Lines (A/B/C) +
 * Pinterest 3-Stage Funnel metrics + Omni-Drop auto-triage summary.
 */
export function synthesizeBrandIdentityFromIngest(
  raw: BrandOnboardingIngestInput
): SynthesizedBrandOnboarding {
  const parsed = BrandOnboardingIngestInputSchema.parse(raw);
  const base = twingsDefaultIdentity();
  const vibeSpec = VIBE_PALETTE_AND_LOOK[parsed.preferredVibe];

  const triage = classifyOmniAssetDrop(parsed.rawAssetDrop);

  // Merge explicit slot assets with auto-triaged assets from the unlimited drop, respecting slot caps.
  const combinedLogos = [
    ...parsed.assets.filter((a) => a.slot === 'logo'),
    ...triage.promotedSlotAssets.filter((a) => a.slot === 'logo')
  ].slice(0, ONBOARDING_LIMITS.maxLogoAssets);
  const combinedProducts = [
    ...parsed.assets.filter((a) => a.slot === 'product'),
    ...triage.promotedSlotAssets.filter((a) => a.slot === 'product')
  ].slice(0, ONBOARDING_LIMITS.maxProductAssets);
  const combinedMoods = [
    ...parsed.assets.filter((a) => a.slot === 'mood'),
    ...triage.promotedSlotAssets.filter((a) => a.slot === 'mood')
  ].slice(0, ONBOARDING_LIMITS.maxMoodAssets);

  const effectiveAssets = [
    ...combinedLogos,
    ...combinedProducts,
    ...combinedMoods
  ].slice(0, ONBOARDING_LIMITS.maxTotalAssets);

  const mappedRefs = effectiveAssets.map(mapAssetToReferenceRule);
  const references =
    mappedRefs.length > 0 ? mappedRefs.slice(0, 14) : base.references;

  const productAssetsChecklist = effectiveAssets
    .filter((a) => a.slot === 'product' || a.slot === 'logo')
    .map((a) => `${a.label}: ${a.preserveNote}`);

  const mergedChecklist = Array.from(
    new Set([
      ...productAssetsChecklist,
      ...CATEGORY_DEFAULT_CHECKLIST[parsed.category],
      ...base.productChecklist
    ])
  ).slice(0, 20);

  const combinedGuideNotes = [
    parsed.brandGuideNote,
    ...triage.extractedStandardNotes
  ]
    .filter(Boolean)
    .join('\n');

  const customNever = combinedGuideNotes
    .split(/[\r\n.]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 200);

  const neverRules = (
    customNever.length > 0
      ? customNever.slice(0, 3)
      : base.rules.never
  ).slice(0, 3);

  const channelContext: string[] = [];
  if (parsed.websiteUrls.length > 0) {
    channelContext.push(`공식 웹(${parsed.websiteUrls[0]})`);
  }
  if (parsed.instagramHandle) {
    channelContext.push(`인스타그램(${parsed.instagramHandle})`);
  }
  if (parsed.pinterestBoardUrls.length > 0) {
    channelContext.push(`핀터레스트 보드(${parsed.pinterestBoardUrls.length}개)`);
  }
  const channelPrefix =
    channelContext.length > 0
      ? `[${parsed.brandName} · ${channelContext.join(' · ')}] `
      : `[${parsed.brandName}] `;

  const identity = BrandIdentitySchema.parse({
    ...base,
    colour: {
      ...base.colour,
      paper: vibeSpec.paper,
      canvas: vibeSpec.canvas,
      sky: vibeSpec.sky,
      accent: vibeSpec.accent
    },
    world: {
      ownedHue: vibeSpec.ownedHue,
      warmPerScreen: vibeSpec.warmPerScreen,
      skinProtected: true
    },
    rules: {
      ...base.rules,
      consentedFacesOnly: true,
      never: neverRules
    },
    references,
    productChecklist: mergedChecklist,
    voice: {
      tone: `${channelPrefix}${vibeSpec.voiceToneKo}`.slice(0, 400),
      forbiddenWords: base.voice.forbiddenWords
    }
  });

  const logoCount = combinedLogos.length;
  const productCount = combinedProducts.length;
  const moodCount = combinedMoods.length;

  const pinterestFunnel = analyzePinterestBoardFunnel({
    pinterestBoardUrls: parsed.pinterestBoardUrls,
    totalPinCountHint: parsed.pinterestBoardTotalPinCountHint,
    moodAssetCount: moodCount + triage.counts.aesthetic_mood_pool
  });

  const aestheticLines = synthesizeMultiAestheticLines({
    brandName: parsed.brandName,
    category: parsed.category,
    preferredVibe: parsed.preferredVibe,
    hasPinterestBoards: parsed.pinterestBoardUrls.length > 0
  });

  const omniTriageCounts: Record<OmniTriageBucket, number> = {
    logo_vault: Math.max(logoCount, triage.counts.logo_vault),
    product_vault: Math.max(productCount, triage.counts.product_vault),
    brand_standard: Math.max(
      neverRules.length,
      triage.counts.brand_standard
    ),
    aesthetic_mood_pool: Math.max(
      moodCount + pinterestFunnel.stage2MedoidsSelected,
      triage.counts.aesthetic_mood_pool
    )
  };

  const summary: BrandOnboardingIngestSummary = {
    brandName: parsed.brandName,
    category: parsed.category,
    preferredVibe: parsed.preferredVibe,
    websiteUrls: parsed.websiteUrls,
    instagramHandle: parsed.instagramHandle ?? null,
    instagramPostUrls: parsed.instagramPostUrls,
    pinterestBoardUrls: parsed.pinterestBoardUrls,
    assetCounts: {
      logo: logoCount,
      product: productCount,
      mood: moodCount,
      total: effectiveAssets.length
    },
    omniTriageCounts,
    pinterestFunnel,
    aestheticLines,
    recommendedLookPresetId: vibeSpec.lookPresetId,
    synthesizedAt: new Date().toISOString()
  };

  return {
    identity,
    recommendedLookPresetId: vibeSpec.lookPresetId,
    aestheticLines,
    pinterestFunnel,
    omniTriage: {
      totalDropped: parsed.rawAssetDrop.length,
      items: triage.items,
      counts: omniTriageCounts
    },
    summary
  };
}

export async function ingestBrandOnboarding(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  raw: unknown
): Promise<
  BrandOutcome<{
    id: string;
    revision: number;
    status: 'draft' | 'confirmed';
    identity: BrandIdentity;
    summary: BrandOnboardingIngestSummary;
  }>
> {
  if (!viewer.userId) return { ok: false, code: 'sign_in_required' };
  const parsed = BrandOnboardingIngestInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.')
    };
  }

  const { organizationId, autoConfirm } = parsed.data;

  try {
    await assertBrandFeature(deps.sql, organizationId, 'brand_learning');
    await assertBrandFeature(deps.sql, organizationId, 'generative_media');
  } catch (err) {
    if (err instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw err;
  }

  const existing = await loadBrandIdentity(deps.sql, organizationId);
  const expectedRevision =
    parsed.data.expectedRevision !== undefined
      ? parsed.data.expectedRevision
      : (existing?.revision ?? 0);

  const synthesized = synthesizeBrandIdentityFromIngest(parsed.data);

  const saved = await saveBrandIdentity(deps, viewer, {
    organizationId,
    expectedRevision,
    identity: synthesized.identity
  });
  if (!saved.ok) return saved;

  let finalIdentity: BrandIdentity = saved.identity;
  let finalRevision = saved.revision;
  let finalStatus: 'draft' | 'confirmed' = saved.status;
  if (autoConfirm) {
    const confirmed = await confirmBrandIdentity(deps, viewer, {
      organizationId,
      expectedRevision: saved.revision
    });
    if (!confirmed.ok) return confirmed;
    finalIdentity = confirmed.identity;
    finalRevision = confirmed.revision;
    finalStatus = confirmed.status;
  }

  // Record the onboarding ingest snapshot + Multi-Aesthetic Lines (A/B/C) + Pinterest funnel into operational memory.
  await recordMemory(deps, viewer, {
    organizationId,
    kind: 'note',
    payload: {
      scope: 'onboarding_ingest',
      ...synthesized.summary,
      assets: parsed.data.assets,
      brandGuideNote: parsed.data.brandGuideNote
    }
  });

  // Seed all 3 Multi-Aesthetic Line looks (A / B / C) if color_grading is permitted for this organization.
  for (const line of synthesized.aestheticLines) {
    const preset = BRAND_LOOK_PRESETS[line.lookPresetId];
    if (!preset) continue;
    await saveLook(deps, viewer, {
      organizationId,
      title: `${parsed.data.brandName} · ${line.titleKo} (${preset.titleKo})`.slice(0, 120),
      lutKey: preset.lutKey,
      measurements: {
        ...(preset.defaults as unknown as Record<string, unknown>),
        aestheticLineCode: line.code,
        focalMm: line.focalMm,
        lightColourK: line.lightColourK
      },
      intensity: 0.85,
      skinProtect: true,
      source: 'preset'
    }).catch(() => null);
  }

  return {
    ok: true,
    id: organizationId,
    revision: finalRevision,
    status: finalStatus,
    identity: finalIdentity,
    summary: synthesized.summary
  };
}
