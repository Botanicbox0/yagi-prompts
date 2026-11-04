import { marginSplit } from '@/lib/creator-platform/economics';
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
  priceKrw: number;
  monthlyCredits: number;
  allowsVideo: boolean;
  upscaleIncluded: boolean;
  /** Max 5-shot sets on Nano Banana 2.1 (41 cr/set) vs Seedream 5.0 Pro (71 cr/set) */
  maxImageSetsNanoBanana: number;
  maxImageSetsSeedream: number;
  /** Max individual images (1 shot) on Nano Banana 2.1 (9 cr) vs Seedream 5.0 Pro (15 cr) */
  maxSingleImagesNanoBanana: number;
  maxSingleImagesSeedream: number;
  /** Max 10s 720p films (345 cr/film) */
  maxFilms10s720p: number;
}

export const FOUNDER_CREDIT_PLANS: Record<FounderCreditPlanSpec['id'], FounderCreditPlanSpec> = {
  image_only: {
    id: 'image_only',
    nameKo: 'Image-Only (스타터)',
    nameEn: 'Image-Only (Starter)',
    priceKrw: 4900,
    monthlyCredits: 370,
    allowsVideo: false,
    upscaleIncluded: false,
    maxImageSetsNanoBanana: Math.floor(370 / 41), // 9 sets (45 shots)
    maxImageSetsSeedream: Math.floor(370 / 71), // 5 sets (25 shots)
    maxSingleImagesNanoBanana: Math.floor(370 / 9), // 41 single shots
    maxSingleImagesSeedream: Math.floor(370 / 15), // 24 single shots
    maxFilms10s720p: 0,
  },
  creator: {
    id: 'creator',
    nameKo: 'Creator (크리에이터)',
    nameEn: 'Creator',
    priceKrw: 24900,
    monthlyCredits: 1890,
    allowsVideo: true,
    upscaleIncluded: false,
    maxImageSetsNanoBanana: Math.floor(1890 / 41), // 46 sets (230 shots)
    maxImageSetsSeedream: Math.floor(1890 / 71), // 26 sets (130 shots)
    maxSingleImagesNanoBanana: Math.floor(1890 / 9), // 210 single shots
    maxSingleImagesSeedream: Math.floor(1890 / 15), // 126 single shots
    maxFilms10s720p: Math.floor(1890 / 345), // 5 films
  },
  premium: {
    id: 'premium',
    nameKo: 'Premium (프리미엄)',
    nameEn: 'Premium',
    priceKrw: 49000,
    monthlyCredits: 3720,
    allowsVideo: true,
    upscaleIncluded: true,
    maxImageSetsNanoBanana: Math.floor(3720 / 41), // 90 sets (450 shots)
    maxImageSetsSeedream: Math.floor(3720 / 71), // 52 sets (260 shots)
    maxSingleImagesNanoBanana: Math.floor(3720 / 9), // 413 single shots
    maxSingleImagesSeedream: Math.floor(3720 / 15), // 248 single shots
    maxFilms10s720p: Math.floor(3720 / 345), // 10 films
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
