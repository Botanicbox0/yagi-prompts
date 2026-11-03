import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '../entitlements';
import { BRAND_LOOK_PRESETS, type BrandLookPresetId } from '../finish/color-grading';
import type { BrandFailureCode, BrandOutcome } from '../workspace/types';
import {
  BrandIdentitySchema,
  twingsDefaultIdentity,
  type BrandIdentity,
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

export const ONBOARDING_VIBES = [
  'minimal_editorial',
  'warm_film',
  'crisp_commercial',
  'high_contrast_street',
  'natural_daylight'
] as const;

export type OnboardingVibe = (typeof ONBOARDING_VIBES)[number];

export const ONBOARDING_ASSET_SLOTS = ['logo', 'product', 'mood'] as const;
export type OnboardingAssetSlot = (typeof ONBOARDING_ASSET_SLOTS)[number];

export const ONBOARDING_LIMITS = {
  maxWebsiteUrls: 2,
  maxInstagramPostUrls: 6,
  maxTotalAssets: 14,
  maxLogoAssets: 2,
  maxProductAssets: 6,
  maxMoodAssets: 6
} as const;

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
  assetCounts: {
    logo: number;
    product: number;
    mood: number;
    total: number;
  };
  recommendedLookPresetId: BrandLookPresetId;
  synthesizedAt: string;
}

export interface SynthesizedBrandOnboarding {
  identity: BrandIdentity;
  recommendedLookPresetId: BrandLookPresetId;
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
 * Deterministically synthesizes a complete `BrandIdentity` + recommended Look preset from
 * the bounded multi-channel onboarding ingest input.
 */
export function synthesizeBrandIdentityFromIngest(
  raw: BrandOnboardingIngestInput
): SynthesizedBrandOnboarding {
  const parsed = BrandOnboardingIngestInputSchema.parse(raw);
  const base = twingsDefaultIdentity();
  const vibeSpec = VIBE_PALETTE_AND_LOOK[parsed.preferredVibe];

  const mappedRefs = parsed.assets.map(mapAssetToReferenceRule);
  const references =
    mappedRefs.length > 0 ? mappedRefs.slice(0, 14) : base.references;

  const productAssetsChecklist = parsed.assets
    .filter((a) => a.slot === 'product' || a.slot === 'logo')
    .map((a) => `${a.label}: ${a.preserveNote}`);

  const mergedChecklist = Array.from(
    new Set([
      ...productAssetsChecklist,
      ...CATEGORY_DEFAULT_CHECKLIST[parsed.category],
      ...base.productChecklist
    ])
  ).slice(0, 20);

  const customNever = parsed.brandGuideNote
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

  const logoCount = parsed.assets.filter((a) => a.slot === 'logo').length;
  const productCount = parsed.assets.filter((a) => a.slot === 'product').length;
  const moodCount = parsed.assets.filter((a) => a.slot === 'mood').length;

  return {
    identity,
    recommendedLookPresetId: vibeSpec.lookPresetId,
    summary: {
      brandName: parsed.brandName,
      category: parsed.category,
      preferredVibe: parsed.preferredVibe,
      websiteUrls: parsed.websiteUrls,
      instagramHandle: parsed.instagramHandle ?? null,
      instagramPostUrls: parsed.instagramPostUrls,
      assetCounts: {
        logo: logoCount,
        product: productCount,
        mood: moodCount,
        total: parsed.assets.length
      },
      recommendedLookPresetId: vibeSpec.lookPresetId,
      synthesizedAt: new Date().toISOString()
    }
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

  // Record the onboarding ingest snapshot into operational memory (`brand_memory_events`).
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

  // Seed the recommended look preset if color_grading is permitted for this organization.
  const lookPreset = BRAND_LOOK_PRESETS[synthesized.recommendedLookPresetId];
  if (lookPreset) {
    await saveLook(deps, viewer, {
      organizationId,
      title: `${parsed.data.brandName} · ${lookPreset.titleKo}`,
      lutKey: lookPreset.lutKey,
      measurements: lookPreset.defaults as unknown as Record<string, unknown>,
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
