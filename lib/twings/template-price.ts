import { marginSplit } from '@/lib/creator-platform/economics';
import { quoteArkVideo } from '@/lib/ark/pricing';
import { COST_ASSUMPTIONS, IMAGE_MIN_PRICE_KRW, roundUpToHundred } from './cost-model';

/**
 * docs/PLATFORM-2.0.md §19.2 (founder decision, 2026-11-02) — what a template costs and what one
 * make of it earns its AI creative. One rule for the studio's own templates and the creatives' alike.
 *
 *   · The margin lives in the TEMPLATE, not in the plan. One credit is 10원 of revenue after VAT and
 *     the app-store fee, so a plan's monthly credits are its net revenue ÷ 10 and carry no margin.
 *   · Base credits: an image is its provider cost × 1.12 (the founder's 10~15% markup band), a film
 *     its provider cost at a 6% margin (the 5~7% band). Nano Banana 2.1 × 5 = 41, 10 s 720p = 345.
 *   · A creative may raise the price above the base, never lower it. The user spends more credits,
 *     the margin grows, and 80% of the WHOLE margin — base and raise — is the creative's
 *     (`marginSplit`, unchanged). A company account (`platform_creators.payout = 'company'`) keeps 100%.
 *
 * Until web subscriptions open (Toss autopay), the same base sells in won: credits × 10원 ÷ the share
 * of a card payment left after VAT and the contract PG fee, rounded up to 100원. That reproduces the
 * live 3,900원 / 5,900원 films at the band's lower edge, so no reviewed price moves.
 */

export const CREDIT_NET_KRW = 10;
export const IMAGE_MARKUP = { min: 1.10, target: 1.12, max: 1.15 } as const;
export const VIDEO_MARGIN = { min: 0.05, target: 0.06, max: 0.07 } as const;
/**
 * Contract card fee 3.74% incl. VAT → 3.4% after the input-tax credit (docs/TOSS-CONTRACT.md).
 * `COST_ASSUMPTIONS.pgFeeRate` keeps its provisional 3.3%: the approved 604-unit creator subscription
 * was priced on it, and moving it would change that contract.
 */
export const PG_FEE_RATE = 0.034;
/** What 1원 of a card payment leaves after VAT and the PG fee. */
export const NET_SHARE = 1 / (1 + COST_ASSUMPTIONS.vatRate) - PG_FEE_RATE;
/** How much a creative may raise a template above its base, in won (the 0059 CHECK). */
export const RAISE_MAX_KRW = 5000;
export const RAISE_STEP_KRW = 100;

export type PriceMedium = 'image' | 'video';
export type PriceLevel = keyof typeof IMAGE_MARKUP;
export interface CostInput { medium: PriceMedium; providerUsd: number }

export function providerKrw(providerUsd: number): number {
  return providerUsd * COST_ASSUMPTIONS.krwPerUsd;
}

/** Credits for one make at the base price; `min` is the band's lower edge (the admin's warning line). */
export function baseCredits(input: CostInput, level: PriceLevel = 'target'): number {
  const cost = providerKrw(input.providerUsd);
  const gross = input.medium === 'image' ? cost * IMAGE_MARKUP[level] : cost / (1 - VIDEO_MARGIN[level]);
  // Only float noise is shaved before rounding up.
  return Math.max(1, Math.ceil(gross / CREDIT_NET_KRW - 1e-9));
}

/** The won price a number of credits sells at by card, 100원 steps; an image never below 200원. */
export function creditsToKrw(credits: number, medium: PriceMedium): number {
  const krw = roundUpToHundred(credits * CREDIT_NET_KRW / NET_SHARE - 1e-9);
  return medium === 'image' ? Math.max(IMAGE_MIN_PRICE_KRW, krw) : krw;
}

/** The base won price of a template: the lowest a creative may sell it at. */
export function baseKrw(input: CostInput, level: PriceLevel = 'target'): number {
  return creditsToKrw(baseCredits(input, level), input.medium);
}

export interface MakeEarning {
  /** Revenue left after VAT, the PG fee and the provider cost (never below 0). */
  margin: number;
  /** The AI creative's 80%, or 0 for a company account. */
  creator: number;
  platform: number;
}

/**
 * One card sale at `priceKrw`, split the way `settle` will split it. An ESTIMATE: settlement uses the
 * render's metered provider cost and that day's exchange rate, not this list price.
 */
export function makeEarning(input: CostInput & { priceKrw: number; company?: boolean }): MakeEarning {
  const revenue = Math.max(0, Math.round(input.priceKrw));
  const tax = revenue - Math.round(revenue / (1 + COST_ASSUMPTIONS.vatRate));
  const fees = Math.round(revenue * PG_FEE_RATE);
  const cost = Math.ceil(providerKrw(input.providerUsd));
  return marginSplit({ revenue, tax, fees, providerCost: cost, creator: !input.company });
}

/** A creative's raise: whole hundreds of won, from 0 to `RAISE_MAX_KRW`. */
export function isRaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= RAISE_MAX_KRW && value % RAISE_STEP_KRW === 0;
}

/**
 * docs/PLATFORM-2.0.md §19.2 (founder decision, 2026-11-02) — 3-tier credit plan table.
 * 1 credit = 10원 of net revenue after 10% VAT and 15% store fee. Margin sits in the template.
 */
export interface FounderCreditPlanSpec {
  id: 'image_only' | 'creator' | 'premium';
  nameKo: string;
  nameEn: string;
  /** Korean storefront price in KRW (VAT 10% included) */
  priceKrw: number;
  /** Global storefront base price in USD (tax-exclusive; local VAT/GST auto-added by App Store / Google Play / Stripe Tax) */
  priceUsd: number;
  /** Net USD received after 15% App Store / Play Store Small Business fee */
  netStoreRevenueUsd: number;
  monthlyCredits: number;
  allowsVideo: boolean;
  upscaleIncluded: boolean;
  /** Max 5-shot sets on Nano Banana 2.1 (41 cr/set) vs Seedream 5.0 Pro (71 cr/set) */
  maxImageSetsNanoBanana: number;
  maxImageSetsSeedream: number;
  /** Max individual images (1 shot) on Nano Banana 2.1 (9 cr) vs Seedream 5.0 Pro (15 cr) */
  maxSingleImagesNanoBanana: number;
  maxSingleImagesSeedream: number;
  /** Max 10s 480p Draft preview films (154 cr/film) */
  maxDrafts10s480p: number;
  /** Max 10s 720p Standard high-quality films (345 cr/film) */
  maxFilms10s720p: number;
  /** Max 10s 1080p Masterpiece flagship films (847 cr/film) */
  maxFilms10s1080p: number;
}

export const FOUNDER_CREDIT_PLANS: Record<FounderCreditPlanSpec['id'], FounderCreditPlanSpec> = {
  image_only: {
    id: 'image_only',
    nameKo: 'Image-Only (스타터)',
    nameEn: 'Image-Only (Starter)',
    priceKrw: 4900,
    priceUsd: 4.99,
    netStoreRevenueUsd: 4.24,
    monthlyCredits: 370,
    allowsVideo: false,
    upscaleIncluded: false,
    maxImageSetsNanoBanana: Math.floor(370 / 41), // 9 sets (45 shots)
    maxImageSetsSeedream: Math.floor(370 / 71), // 5 sets (25 shots)
    maxSingleImagesNanoBanana: Math.floor(370 / 9), // 41 single shots
    maxSingleImagesSeedream: Math.floor(370 / 15), // 24 single shots
    maxDrafts10s480p: 0,
    maxFilms10s720p: 0,
    maxFilms10s1080p: 0,
  },
  creator: {
    id: 'creator',
    nameKo: 'Creator (크리에이터)',
    nameEn: 'Creator',
    priceKrw: 24900,
    priceUsd: 19.99,
    netStoreRevenueUsd: 16.99,
    monthlyCredits: 1890,
    allowsVideo: true,
    upscaleIncluded: false,
    maxImageSetsNanoBanana: Math.floor(1890 / 41), // 46 sets (230 shots)
    maxImageSetsSeedream: Math.floor(1890 / 71), // 26 sets (130 shots)
    maxSingleImagesNanoBanana: Math.floor(1890 / 9), // 210 single shots
    maxSingleImagesSeedream: Math.floor(1890 / 15), // 126 single shots
    maxDrafts10s480p: Math.floor(1890 / 154), // 12 draft previews (10s 480p)
    maxFilms10s720p: Math.floor(1890 / 345), // 5 standard high-quality films (10s 720p)
    maxFilms10s1080p: Math.floor(1890 / 847), // 2 masterpiece films (10s 1080p)
  },
  premium: {
    id: 'premium',
    nameKo: 'Premium (프리미엄)',
    nameEn: 'Premium',
    priceKrw: 49000,
    priceUsd: 39.99,
    netStoreRevenueUsd: 33.99,
    monthlyCredits: 3720,
    allowsVideo: true,
    upscaleIncluded: true,
    maxImageSetsNanoBanana: Math.floor(3720 / 41), // 90 sets (450 shots)
    maxImageSetsSeedream: Math.floor(3720 / 71), // 52 sets (260 shots)
    maxSingleImagesNanoBanana: Math.floor(3720 / 9), // 413 single shots
    maxSingleImagesSeedream: Math.floor(3720 / 15), // 248 single shots
    maxDrafts10s480p: Math.floor(3720 / 154), // 24 draft previews (10s 480p)
    maxFilms10s720p: Math.floor(3720 / 345), // 10 standard high-quality films (10s 720p)
    maxFilms10s1080p: Math.floor(3720 / 847), // 4 masterpiece films (10s 1080p)
  },
} as const;

export interface SelectiveImageSetQuoteInput {
  /** Per-frame provider USD (e.g., 0.09 for seedream-5.0-pro, 0.052 for nano-banana-2.1, 0.136 for nano-banana-pro) */
  perFrameProviderUsd: number;
  /** Total frames in the template set (typically 5, range 1..10) */
  totalFrames: number;
  /** 0-based indices of the frames the user chose to generate (at least 1) */
  selectedFrameIndices: readonly number[];
  /** Optional maker raise (`royalty_krw` on the full set, 0..5000 in 100원 steps) */
  royaltyKrw?: number;
}

export interface SelectiveImageSetQuote {
  totalFrames: number;
  selectedCount: number;
  selectedFrameIndices: number[];
  isPartialSelection: boolean;
  providerUsd: number;
  /** Base credits for the selected frames (providerCost × 1.12 ÷ 10원) */
  baseCredits: number;
  /** Additional credits when a maker raised the template price */
  raiseCredits: number;
  /** Total credits charged for the selected frames */
  totalCredits: number;
  /** Full-set credits if all frames were selected */
  fullSetCredits: number;
  /** Credits saved by picking only the desired frames */
  savedCredits: number;
  /** Card single-purchase floor price in won for the selected frames (never below 200원) */
  floorKrw: number;
  /** Prorated maker raise in won (100원 steps) */
  proratedRoyaltyKrw: number;
  /** Total card single-purchase price in won for the selected frames */
  totalKrw: number;
  /** Full-set card price in won if all frames were selected */
  fullSetKrw: number;
  /** Won saved by picking only the desired frames */
  savedKrw: number;
}

/**
 * Computes exact credits and single-purchase KRW price when a user selects a subset of frames
 * (e.g. picking 2 or 3 shots out of a 5-shot editorial photo series).
 */
export function quoteSelectiveImageSet(
  input: SelectiveImageSetQuoteInput
): SelectiveImageSetQuote {
  const totalFrames = Math.max(1, Math.min(10, Math.floor(input.totalFrames)));
  const uniqueValid = Array.from(
    new Set(
      input.selectedFrameIndices
        .map((i) => Math.floor(i))
        .filter((i) => i >= 0 && i < totalFrames)
    )
  ).sort((a, b) => a - b);

  // At least 1 frame must be selected; fallback to frame 0 if empty.
  const selectedFrameIndices = uniqueValid.length > 0 ? uniqueValid : [0];
  const selectedCount = selectedFrameIndices.length;
  const royaltyKrw = isRaise(input.royaltyKrw) ? input.royaltyKrw : 0;

  const selectedProviderUsd =
    Math.round(input.perFrameProviderUsd * selectedCount * 10000) / 10000;
  const fullProviderUsd =
    Math.round(input.perFrameProviderUsd * totalFrames * 10000) / 10000;

  const selectedBaseCredits = baseCredits({
    medium: 'image',
    providerUsd: selectedProviderUsd,
  });
  const fullBaseCredits = baseCredits({
    medium: 'image',
    providerUsd: fullProviderUsd,
  });

  const proratedRoyaltyKrw =
    selectedCount === totalFrames
      ? royaltyKrw
      : Math.round(((royaltyKrw * selectedCount) / totalFrames) / RAISE_STEP_KRW) *
        RAISE_STEP_KRW;

  const raiseCredits =
    proratedRoyaltyKrw > 0
      ? Math.ceil((proratedRoyaltyKrw * NET_SHARE) / CREDIT_NET_KRW - 1e-9)
      : 0;
  const fullRaiseCredits =
    royaltyKrw > 0
      ? Math.ceil((royaltyKrw * NET_SHARE) / CREDIT_NET_KRW - 1e-9)
      : 0;

  const totalCredits = selectedBaseCredits + raiseCredits;
  const fullSetCredits = fullBaseCredits + fullRaiseCredits;

  const floorKrw = baseKrw({ medium: 'image', providerUsd: selectedProviderUsd });
  const fullFloorKrw = baseKrw({ medium: 'image', providerUsd: fullProviderUsd });

  const totalKrw = floorKrw + proratedRoyaltyKrw;
  const fullSetKrw = fullFloorKrw + royaltyKrw;

  return {
    totalFrames,
    selectedCount,
    selectedFrameIndices,
    isPartialSelection: selectedCount < totalFrames,
    providerUsd: selectedProviderUsd,
    baseCredits: selectedBaseCredits,
    raiseCredits,
    totalCredits,
    fullSetCredits,
    savedCredits: Math.max(0, fullSetCredits - totalCredits),
    floorKrw,
    proratedRoyaltyKrw,
    totalKrw,
    fullSetKrw,
    savedKrw: Math.max(0, fullSetKrw - totalKrw),
  };
}

export interface MakerRevenueSimulation {
  medium: PriceMedium;
  providerUsd: number;
  floorKrw: number;
  royaltyKrw: number;
  salePriceKrw: number;
  baseCredits: number;
  totalCredits: number;
  perMake: MakeEarning;
  milestones: ReadonlyArray<{
    makes: number;
    creatorTotalKrw: number;
    platformTotalKrw: number;
  }>;
}

/**
 * Simulates how much an AI creative (Maker) earns when other users make videos/images with their template.
 * Uses the exact `makeEarning` / `marginSplit` 80:20 net margin formula stored in `platform_settlements`.
 */
export function simulateMakerTemplateRevenue(input: {
  medium: PriceMedium;
  providerUsd: number;
  royaltyKrw?: number;
}): MakerRevenueSimulation {
  const royaltyKrw = isRaise(input.royaltyKrw) ? input.royaltyKrw : 0;
  const floorKrw = baseKrw({ medium: input.medium, providerUsd: input.providerUsd });
  const salePriceKrw = floorKrw + royaltyKrw;
  const bCredits = baseCredits({ medium: input.medium, providerUsd: input.providerUsd });
  const raiseCredits =
    royaltyKrw > 0
      ? Math.ceil((royaltyKrw * NET_SHARE) / CREDIT_NET_KRW - 1e-9)
      : 0;
  const perMake = makeEarning({
    medium: input.medium,
    providerUsd: input.providerUsd,
    priceKrw: salePriceKrw,
  });

  const counts = [10, 50, 100, 500] as const;
  return {
    medium: input.medium,
    providerUsd: input.providerUsd,
    floorKrw,
    royaltyKrw,
    salePriceKrw,
    baseCredits: bCredits,
    totalCredits: bCredits + raiseCredits,
    perMake,
    milestones: counts.map((makes) => ({
      makes,
      creatorTotalKrw: perMake.creator * makes,
      platformTotalKrw: perMake.platform * makes,
    })),
  };
}

/**
 * 3-Tier Personal Video Resolution System (Founder Decision, 2026-11-05):
 * - `480p` (Draft 프리뷰 모드): Fast, low-credit test mode to verify facial likeness, outfit swap, and camera motion before committing to 720p or 1080p.
 * - `720p` (스탠다드 고화질): Sufficiently crisp, high-quality standard for Instagram Reels / TikTok / everyday social sharing.
 * - `1080p` (마스터피스 최고 화질): Expensive flagship master quality with maximum skin, fabric, and lighting detail.
 */
export const PERSONAL_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type PersonalVideoResolution = (typeof PERSONAL_VIDEO_RESOLUTIONS)[number];

export interface VideoResolutionTierPositioning {
  resolution: PersonalVideoResolution;
  tierRole: 'draft_preview' | 'standard_high' | 'masterpiece_max';
  recommendedDefault: boolean;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  subtitleKo: string;
  subtitleEn: string;
}

export const VIDEO_RESOLUTION_TIER_SPECS: Readonly<
  Record<PersonalVideoResolution, VideoResolutionTierPositioning>
> = {
  '480p': {
    resolution: '480p',
    tierRole: 'draft_preview',
    recommendedDefault: false,
    badgeKo: 'Draft 모드 · 720p/1080p 전 가벼운 테스트',
    badgeEn: 'Draft Mode · Low-Credit Test Before 720p/1080p',
    titleKo: '480p Draft (사전 테스트)',
    titleEn: '480p Draft (Preview)',
    summaryKo:
      '본 720p나 1080p 제작에 앞서 내 얼굴 닮음새와 의상·연출 변경이 마음에 들게 나오는지 적은 크레딧(55% 절약)으로 먼저 확인하는 Draft 모드입니다.',
    summaryEn:
      'Test your facial likeness, outfit swap, and motion at 55% fewer credits before committing to 720p or 1080p.',
    subtitleKo: '본 영상 전 얼굴 닮음새·의상 변경 가볍게 확인 (55% 절약)',
    subtitleEn: 'Fast, low-credit likeness & edit preview (55% savings)'
  },
  '720p': {
    resolution: '720p',
    tierRole: 'standard_high',
    recommendedDefault: true,
    badgeKo: '기본 추천 · 충분히 좋은 영상 퀄리티',
    badgeEn: 'Recommended · Great High Quality',
    titleKo: '720p 고화질 (스탠다드 본편)',
    titleEn: '720p High Quality (Standard)',
    summaryKo:
      '인스타그램 릴스·틱톡 업로드와 소장용으로 충분히 선명하고 자연스러운 표준 고화질입니다.',
    summaryEn:
      'Crisp, natural high-definition quality ideal for Instagram Reels, TikTok, and personal sharing.',
    subtitleKo: '릴스·틱톡 업로드에 충분히 선명한 표준 고화질',
    subtitleEn: 'Crisp high quality for Reels, TikTok & everyday sharing'
  },
  '1080p': {
    resolution: '1080p',
    tierRole: 'masterpiece_max',
    recommendedDefault: false,
    badgeKo: '최고 퀄리티 마스터 · 하이엔드',
    badgeEn: 'Masterpiece · Highest Flagship Quality',
    titleKo: '1080p 마스터 (최고 화질)',
    titleEn: '1080p Masterpiece (Max Quality)',
    summaryKo:
      '크레딧 소모는 크지만 피부결·의상 직물·조명 디테일까지 가장 또렷하게 뽑아내는 최고 퀄리티 마스터 모드입니다.',
    summaryEn:
      'Premium credit tier delivering maximum sharpness across skin texture, fabric weave, and lighting.',
    subtitleKo: '피부결·패브릭 디테일까지 극대화한 플래그십 최고 화질',
    subtitleEn: 'Maximum skin & fabric detail flagship master quality'
  }
} as const;

export interface VideoResolutionTierQuote extends VideoResolutionTierPositioning {
  seconds: number;
  aspect: string;
  providerTokens: number;
  providerUsd: number;
  baseCredits: number;
  raiseCredits: number;
  totalCredits: number;
  floorKrw: number;
  totalKrw: number;
  /** Credits saved by choosing this tier instead of 720p (positive for 480p Draft). */
  savedCreditsVs720p: number;
  /** Credits saved by choosing this tier instead of 1080p. */
  savedCreditsVs1080p: number;
}

export interface VideoResolutionTiersSummary {
  model: 'seedance-2.5' | 'seedance-2.0';
  seconds: number;
  aspect: string;
  royaltyKrw: number;
  tiers: Record<PersonalVideoResolution, VideoResolutionTierQuote>;
  draftWorkflow: {
    /** Credits saved by running 480p Draft instead of 720p Standard */
    draftSavedCreditsVs720p: number;
    /** Percentage of credits saved by 480p Draft vs 720p Standard */
    draftSavedPercentVs720p: number;
    /** Credits saved by running 480p Draft instead of 1080p Masterpiece */
    draftSavedCreditsVs1080p: number;
    /** Credits for 1x 480p Draft test + 1x 720p Standard final */
    draft480pPlus720pCredits: number;
    /** Alias for draft480pPlus720pCredits */
    draftThen720pTotalCredits: number;
    /** Credits for 1x 480p Draft test + 1x 1080p Masterpiece final */
    draft480pPlus1080pCredits: number;
    /** Credits saved by catching an edit issue in 480p Draft instead of wasting one 1080p render */
    savedByDraftVsBlind1080pRetryCredits: number;
  };
}

export type VideoResolutionMultiTierQuote = VideoResolutionTiersSummary;

/**
 * Quotes all 3 personal video resolutions (`480p Draft`, `720p Standard`, `1080p Masterpiece`)
 * in credits and KRW for a given duration and aspect ratio.
 */
export function quoteVideoResolutionTiers(input: {
  model?: 'seedance-2.5' | 'seedance-2.0';
  seconds: number;
  aspect?: string;
  royaltyKrw?: number;
}): VideoResolutionTiersSummary {
  const model = input.model ?? 'seedance-2.5';
  const maxSec = model === 'seedance-2.0' ? 15 : 30;
  const seconds = Math.max(4, Math.min(maxSec, Math.round(input.seconds)));
  const aspect = input.aspect ?? '9:16';
  const royaltyKrw = isRaise(input.royaltyKrw) ? input.royaltyKrw : 0;
  const raiseCredits =
    royaltyKrw > 0
      ? Math.ceil((royaltyKrw * NET_SHARE) / CREDIT_NET_KRW - 1e-9)
      : 0;

  const rawQuotes = Object.fromEntries(
    PERSONAL_VIDEO_RESOLUTIONS.map((res) => {
      const arkQuote =
        quoteArkVideo({ model, resolution: res, seconds, aspect }) ??
        quoteArkVideo({ model, resolution: res, seconds, aspect: '9:16' })!;
      const bCredits = baseCredits({ medium: 'video', providerUsd: arkQuote.providerUsd });
      const fKrw = baseKrw({ medium: 'video', providerUsd: arkQuote.providerUsd });
      return [
        res,
        {
          providerTokens: arkQuote.providerTokens,
          providerUsd: arkQuote.providerUsd,
          baseCredits: bCredits,
          raiseCredits,
          totalCredits: bCredits + raiseCredits,
          floorKrw: fKrw,
          totalKrw: fKrw + royaltyKrw
        }
      ];
    })
  ) as Record<
    PersonalVideoResolution,
    {
      providerTokens: number;
      providerUsd: number;
      baseCredits: number;
      raiseCredits: number;
      totalCredits: number;
      floorKrw: number;
      totalKrw: number;
    }
  >;

  const credits720 = rawQuotes['720p'].totalCredits;
  const credits1080 = rawQuotes['1080p'].totalCredits;

  const tiers = Object.fromEntries(
    PERSONAL_VIDEO_RESOLUTIONS.map((res) => {
      const q = rawQuotes[res];
      const spec = VIDEO_RESOLUTION_TIER_SPECS[res];
      const tierQuote: VideoResolutionTierQuote = {
        ...spec,
        seconds,
        aspect,
        ...q,
        savedCreditsVs720p: Math.max(0, credits720 - q.totalCredits),
        savedCreditsVs1080p: Math.max(0, credits1080 - q.totalCredits)
      };
      return [res, tierQuote];
    })
  ) as Record<PersonalVideoResolution, VideoResolutionTierQuote>;

  const draftSavedCreditsVs720p = Math.max(0, credits720 - tiers['480p'].totalCredits);
  const draftSavedPercentVs720p =
    credits720 > 0 ? Math.round((draftSavedCreditsVs720p / credits720) * 100) : 0;
  const draftSavedCreditsVs1080p = Math.max(0, credits1080 - tiers['480p'].totalCredits);
  const draft480pPlus720pCredits = tiers['480p'].totalCredits + tiers['720p'].totalCredits;

  return {
    model,
    seconds,
    aspect,
    royaltyKrw,
    tiers,
    draftWorkflow: {
      draftSavedCreditsVs720p,
      draftSavedPercentVs720p,
      draftSavedCreditsVs1080p,
      draft480pPlus720pCredits,
      draftThen720pTotalCredits: draft480pPlus720pCredits,
      draft480pPlus1080pCredits: tiers['480p'].totalCredits + tiers['1080p'].totalCredits,
      savedByDraftVsBlind1080pRetryCredits: draftSavedCreditsVs1080p
    }
  };
}

/**
 * Global Subscription & Anti-Abuse Architecture (Founder Decision, 2026-11-05):
 * Pre-baked into the pricing & credit engine so expanding to global App Store / Play Store / Stripe
 * requires zero database schema migrations and zero negative-margin surprises.
 */
export const GLOBAL_SUBSCRIPTION_GUARDRAILS = {
  /** Single worldwide credit ledger: 370 / 1,890 / 3,720 credits & template credit costs are identical across all countries. */
  unifiedGlobalCreditLedger: true,
  /** Global base pricing is Tax-Exclusive USD ($4.99 / $19.99 / $39.99) so EU/UK 20-25% VAT is added on top by the store rather than eating our margin. */
  globalPricingTaxMode: 'tax_exclusive_usd_base',
  /** Require 3D Secure 2 (3DS2) on all global web Stripe card checkouts to shift fraud liability and block stolen-card bots. */
  require3DSecureOnStripe: true,
  /** Maximum 1080p Masterpiece renders allowed within the first 24 hours of a new web card subscription (480p Draft & 720p Standard remain unrestricted). */
  max1080pRendersFirst24h: 2,
  /** First-payment cooling window in hours for high-cost 1080p velocity limiting. */
  firstPaymentVelocityWindowHours: 24,
  /** Minimum cash payout threshold in USD for overseas Makers (via Stripe Connect with W-8BEN). */
  globalMakerMinWithdrawalUsd: 50,
  /** Bonus multiplier when a Maker converts settlement earnings directly into TWINGS generation credits (zero wire fee / zero withholding friction). */
  makerCreditConversionBonusMultiplier: 1.1
} as const;

export interface GlobalRenderVelocityCheckInput {
  resolution: PersonalVideoResolution;
  channel: 'app_store' | 'play_store' | 'toss_kr' | 'stripe_global';
  hoursSinceFirstPayment: number;
  completed1080pCountInWindow: number;
}

export interface GlobalRenderVelocityCheckResult {
  allowed: boolean;
  reasonCode: 'ok' | 'first_24h_1080p_velocity_cap';
  recommendedFallbackResolution: '720p' | null;
}

/**
 * Protects against stolen-card chargeback bots on global web (`stripe_global`) that attempt to drain
 * an entire 3,720-credit plan on expensive 1080p renders within minutes of signup.
 * Native App Store / Play Store and Korean Toss payments are exempt, and 480p/720p are always allowed.
 */
export function evaluateGlobalRenderVelocityGuard(
  input: GlobalRenderVelocityCheckInput
): GlobalRenderVelocityCheckResult {
  if (
    input.channel === 'stripe_global' &&
    input.resolution === '1080p' &&
    input.hoursSinceFirstPayment < GLOBAL_SUBSCRIPTION_GUARDRAILS.firstPaymentVelocityWindowHours &&
    input.completed1080pCountInWindow >= GLOBAL_SUBSCRIPTION_GUARDRAILS.max1080pRendersFirst24h
  ) {
    return {
      allowed: false,
      reasonCode: 'first_24h_1080p_velocity_cap',
      recommendedFallbackResolution: '720p'
    };
  }
  return {
    allowed: true,
    reasonCode: 'ok',
    recommendedFallbackResolution: null
  };
}

/**
 * Prevents disposable VoIP/SMS bot farming of the 1 free onboarding image on global web.
 * Granted ONLY when Korean carrier identity verification (CI/DI) OR native mobile hardware attestation
 * (Apple App Attest / Google Play Integrity) is verified.
 */
export function canClaimFreeOnboardingImage(input: {
  krCarrierIdentityVerified: boolean;
  mobileHardwareAttested: boolean;
  alreadyClaimedCount: number;
}): boolean {
  if (input.alreadyClaimedCount > 0) return false;
  return input.krCarrierIdentityVerified || input.mobileHardwareAttested;
}

