import type { ArkModelKey } from "@/lib/ark/models";
import { quoteArkVideo } from "@/lib/ark/pricing";
import {
  COST_ASSUMPTIONS,
  IMAGE_MIN_PRICE_KRW,
  roundUpToHundred,
} from "@/lib/twings/cost-model";
import {
  CREDIT_NET_KRW,
  NET_SHARE,
  PG_FEE_RATE,
  providerKrw,
  type PriceLevel,
} from "@/lib/twings/template-price";

/**
 * B2B Brand Self-Studio Per-Render Pricing Engine (`brand.twings.app`).
 *
 * Consumer templates (`twings.app`) target a 5~7% video margin (`VIDEO_MARGIN = { min: 0.05, target: 0.06, max: 0.07 }`).
 * On the B2B Brand Self-Studio side (`brand.twings.app`), per-render video generation on Seedance
 * (`seedance-2.5` & `seedance-2.0`) is priced for a **10~12% net margin band (target 11.0%)**
 * after 10% VAT and the 3.4% Toss card PG fee (after input-tax credit).
 */
export const BRAND_VIDEO_MARGIN = {
  min: 0.1,
  target: 0.11,
  max: 0.12,
} as const;

export const BRAND_IMAGE_MARKUP = {
  min: 1.1,
  target: 1.12,
  max: 1.15,
} as const;

export type BrandVideoResolution = "480p" | "720p" | "1080p";
export type BrandStandardDurationSeconds = 5 | 10 | 15;
export type BrandVideoEngineModel = Extract<
  ArkModelKey,
  "seedance-2.5" | "seedance-2.0"
>;

export interface BrandVideoQuoteInput {
  model?: BrandVideoEngineModel;
  resolution: BrandVideoResolution;
  seconds: number;
  aspect?: string;
  level?: PriceLevel;
}

export interface BrandVideoQuoteResult {
  model: BrandVideoEngineModel;
  resolution: BrandVideoResolution;
  seconds: number;
  aspect: string;
  level: PriceLevel;
  /** Raw ModelArk completion tokens (`seconds * W * H * 24 / 1024`) */
  providerTokens: number;
  /** Raw ModelArk USD cost (audio included) */
  providerUsd: number;
  /** Provider cost in KRW at `COST_ASSUMPTIONS.krwPerUsd` (1,400 KRW/USD) */
  providerCostKrw: number;
  /** B2B studio credits required for 1 render (1 credit = 10 KRW net revenue) */
  credits: number;
  /** Card checkout price in KRW (VAT 10% & 3.4% PG fee included, rounded up to 100 KRW) */
  priceKrw: number;
  /** Supply value excluding 10% VAT (`Math.round(priceKrw / 1.1)`) */
  supplyValueKrw: number;
  /** VAT 10% portion in KRW */
  vatKrw: number;
  /** Toss card PG fee (3.4% after input-tax credit) in KRW */
  pgFeeKrw: number;
  /** Net revenue from studio credits (`credits * 10 KRW`, after VAT and PG) */
  creditNetRevenueKrw: number;
  /** Net revenue left from standalone 100-KRW-rounded card checkout (`supplyValueKrw - pgFeeKrw`) */
  netRevenueKrw: number;
  /** Net profit on credit deduction (`creditNetRevenueKrw - providerCostKrw`) */
  netProfitKrw: number;
  /** Realized net margin ratio (`netProfitKrw / creditNetRevenueKrw`, target ~0.11 = 11%) */
  realizedMargin: number;
  /** Realized net margin percentage rounded to 1 decimal place (strictly 10.0% ~ 12.0%) */
  realizedMarginPct: number;
  /** Standalone 100-KRW card checkout margin percentage after 100-KRW rounding */
  cardRealizedMarginPct: number;
  /** B2B tax-invoice (bank transfer, 0% PG fee) net margin percentage at `priceKrw` */
  invoiceMarginPct: number;
}

export interface BrandTwoStageGateQuote {
  model: BrandVideoEngineModel;
  seconds: number;
  aspect: string;
  stage1Preview480p: BrandVideoQuoteResult;
  stage2Master1080p: BrandVideoQuoteResult;
  /** Combined credits for 1× 480p preview + 1× 1080p master */
  combinedCredits: number;
  /** Combined KRW price for 1× 480p preview + 1× 1080p master */
  combinedPriceKrw: number;
  /** Combined provider cost in KRW */
  combinedProviderCostKrw: number;
  /** Combined net profit in KRW after VAT & PG */
  combinedNetProfitKrw: number;
  /** Combined realized net margin percentage (10~12% band) */
  combinedMarginPct: number;
  /** Cost of running two 1080p master renders without a 480p preview gate */
  twoBlind1080pPriceKrw: number;
  /** Customer savings in KRW compared to two blind 1080p renders */
  savedKrwVsTwoMasters: number;
  /** Customer savings percentage compared to two blind 1080p renders */
  savedPctVsTwoMasters: number;
}

export interface BrandImagePackQuoteResult {
  shotCount: number;
  providerUsd: number;
  providerCostKrw: number;
  credits: number;
  priceKrw: number;
  netRevenueKrw: number;
  netProfitKrw: number;
  realizedMarginPct: number;
}

/**
 * Normalize studio shot aspects (`4:5` -> `3:4` for ModelArk token billing table, which shares pixel budget).
 */
export function normalizeArkAspect(
  aspect: string | undefined,
): "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9" {
  if (
    aspect === "16:9" ||
    aspect === "9:16" ||
    aspect === "4:3" ||
    aspect === "3:4" ||
    aspect === "1:1" ||
    aspect === "21:9"
  ) {
    return aspect;
  }
  if (aspect === "4:5") {
    return "3:4";
  }
  return "9:16";
}

/**
 * Compute B2B base credits for a single video render at the 10~12% margin band (`target` = 11%).
 */
export function brandVideoCredits(
  providerUsd: number,
  level: PriceLevel = "target",
): number {
  const cost = providerKrw(providerUsd);
  const gross = cost / (1 - BRAND_VIDEO_MARGIN[level]);
  return Math.max(1, Math.ceil(gross / CREDIT_NET_KRW - 1e-9));
}

/**
 * Convert B2B credits to card checkout KRW (100 KRW steps, VAT 10% + 3.4% PG fee accounted for).
 */
export function brandCreditsToKrw(
  credits: number,
  medium: "image" | "video" = "video",
): number {
  const krw = roundUpToHundred((credits * CREDIT_NET_KRW) / NET_SHARE - 1e-9);
  return medium === "image" ? Math.max(IMAGE_MIN_PRICE_KRW, krw) : krw;
}

/**
 * Quote a single B2B Seedance video render (`seedance-2.5` or `seedance-2.0`) with full
 * unit-economics breakdown (provider cost, credits, VAT-inclusive KRW price, PG fee, and realized net margin).
 */
export function quoteBrandVideoRender(
  input: BrandVideoQuoteInput,
): BrandVideoQuoteResult | null {
  const model: BrandVideoEngineModel = input.model ?? "seedance-2.5";
  const level: PriceLevel = input.level ?? "target";
  const aspect = normalizeArkAspect(input.aspect);

  const ark = quoteArkVideo({
    model,
    resolution: input.resolution,
    seconds: input.seconds,
    aspect,
  });
  if (!ark) return null;

  const costRawKrw = providerKrw(ark.providerUsd);
  const providerCostKrw = Math.ceil(costRawKrw);
  const credits = brandVideoCredits(ark.providerUsd, level);
  const creditNetRevenueKrw = credits * CREDIT_NET_KRW;
  const priceKrw = brandCreditsToKrw(credits, "video");

  const supplyValueKrw = Math.round(priceKrw / (1 + COST_ASSUMPTIONS.vatRate));
  const vatKrw = priceKrw - supplyValueKrw;
  const pgFeeKrw = Math.round(priceKrw * PG_FEE_RATE);
  const netRevenueKrw = supplyValueKrw - pgFeeKrw;
  const netProfitKrw = Math.max(0, creditNetRevenueKrw - providerCostKrw);
  const realizedMargin =
    creditNetRevenueKrw > 0 ? netProfitKrw / creditNetRevenueKrw : 0;
  const realizedMarginPct = Math.round(realizedMargin * 1000) / 10;

  const cardProfitKrw = Math.max(0, netRevenueKrw - providerCostKrw);
  const cardRealizedMarginPct =
    netRevenueKrw > 0
      ? Math.round((cardProfitKrw / netRevenueKrw) * 1000) / 10
      : 0;

  const invoiceProfitKrw = Math.max(0, supplyValueKrw - providerCostKrw);
  const invoiceMarginPct =
    supplyValueKrw > 0
      ? Math.round((invoiceProfitKrw / supplyValueKrw) * 1000) / 10
      : 0;

  return {
    model,
    resolution: input.resolution,
    seconds: input.seconds,
    aspect,
    level,
    providerTokens: ark.providerTokens,
    providerUsd: ark.providerUsd,
    providerCostKrw,
    credits,
    priceKrw,
    supplyValueKrw,
    vatKrw,
    pgFeeKrw,
    creditNetRevenueKrw,
    netRevenueKrw,
    netProfitKrw,
    realizedMargin,
    realizedMarginPct,
    cardRealizedMarginPct,
    invoiceMarginPct,
  };
}

/**
 * Quote the 2-Stage Approval Gate workflow (`480p` framing preview + `1080p` final master)
 * and compare against running two blind `1080p` master renders.
 */
export function quoteBrandTwoStageGate(input: {
  model?: BrandVideoEngineModel;
  seconds: number;
  aspect?: string;
  level?: PriceLevel;
}): BrandTwoStageGateQuote | null {
  const model: BrandVideoEngineModel = input.model ?? "seedance-2.5";
  const level: PriceLevel = input.level ?? "target";
  const aspect = normalizeArkAspect(input.aspect);

  const stage1 = quoteBrandVideoRender({
    model,
    resolution: "480p",
    seconds: input.seconds,
    aspect,
    level,
  });
  const stage2 = quoteBrandVideoRender({
    model,
    resolution: "1080p",
    seconds: input.seconds,
    aspect,
    level,
  });
  if (!stage1 || !stage2) return null;

  const combinedCredits = stage1.credits + stage2.credits;
  const combinedPriceKrw = stage1.priceKrw + stage2.priceKrw;
  const combinedProviderCostKrw =
    stage1.providerCostKrw + stage2.providerCostKrw;
  const combinedNetRevenueKrw =
    stage1.creditNetRevenueKrw + stage2.creditNetRevenueKrw;
  const combinedNetProfitKrw = stage1.netProfitKrw + stage2.netProfitKrw;
  const combinedMarginPct =
    combinedNetRevenueKrw > 0
      ? Math.round((combinedNetProfitKrw / combinedNetRevenueKrw) * 1000) / 10
      : 0;

  const twoBlind1080pPriceKrw = stage2.priceKrw * 2;
  const savedKrwVsTwoMasters = Math.max(
    0,
    twoBlind1080pPriceKrw - combinedPriceKrw,
  );
  const savedPctVsTwoMasters =
    twoBlind1080pPriceKrw > 0
      ? Math.round((savedKrwVsTwoMasters / twoBlind1080pPriceKrw) * 1000) / 10
      : 0;

  return {
    model,
    seconds: input.seconds,
    aspect,
    stage1Preview480p: stage1,
    stage2Master1080p: stage2,
    combinedCredits,
    combinedPriceKrw,
    combinedProviderCostKrw,
    combinedNetProfitKrw,
    combinedMarginPct,
    twoBlind1080pPriceKrw,
    savedKrwVsTwoMasters,
    savedPctVsTwoMasters,
  };
}

/**
 * Quote a full matrix of standard B2B Seedance video tiers (`480p`, `720p`, `1080p` × `5s`, `10s`, `15s`).
 */
export function quoteBrandVideoMatrix(options?: {
  model?: BrandVideoEngineModel;
  secondsList?: readonly number[];
  aspect?: string;
  level?: PriceLevel;
}): ReadonlyArray<BrandVideoQuoteResult> {
  const model: BrandVideoEngineModel = options?.model ?? "seedance-2.5";
  const secondsList = options?.secondsList ?? [5, 10, 15];
  const aspect = normalizeArkAspect(options?.aspect);
  const level: PriceLevel = options?.level ?? "target";
  const resolutions: readonly BrandVideoResolution[] = [
    "480p",
    "720p",
    "1080p",
  ];

  const results: BrandVideoQuoteResult[] = [];
  for (const resolution of resolutions) {
    for (const seconds of secondsList) {
      const q = quoteBrandVideoRender({
        model,
        resolution,
        seconds,
        aspect,
        level,
      });
      if (q) results.push(q);
    }
  }
  return results;
}

/**
 * Quote a B2B 5-shot editorial image set (2K studio stills) at the 10~15% markup band (`target` = 1.12).
 */
export function quoteBrandImageSet(options?: {
  shotCount?: number;
  perImageUsd?: number;
  level?: PriceLevel;
}): BrandImagePackQuoteResult {
  const shotCount = options?.shotCount ?? 5;
  const perImageUsd = options?.perImageUsd ?? 0.052;
  const level: PriceLevel = options?.level ?? "target";

  const providerUsd = shotCount * perImageUsd;
  const costRawKrw = providerKrw(providerUsd);
  const providerCostKrw = Math.ceil(costRawKrw);
  const credits = Math.max(
    1,
    Math.ceil((costRawKrw * BRAND_IMAGE_MARKUP[level]) / CREDIT_NET_KRW - 1e-9),
  );
  const priceKrw = brandCreditsToKrw(credits, "image");
  const supplyValueKrw = Math.round(priceKrw / (1 + COST_ASSUMPTIONS.vatRate));
  const pgFeeKrw = Math.round(priceKrw * PG_FEE_RATE);
  const netRevenueKrw = supplyValueKrw - pgFeeKrw;
  const netProfitKrw = Math.max(0, netRevenueKrw - providerCostKrw);
  const realizedMarginPct =
    netRevenueKrw > 0
      ? Math.round((netProfitKrw / netRevenueKrw) * 1000) / 10
      : 0;

  return {
    shotCount,
    providerUsd,
    providerCostKrw,
    credits,
    priceKrw,
    netRevenueKrw,
    netProfitKrw,
    realizedMarginPct,
  };
}
