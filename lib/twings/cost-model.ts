import { ARK_MODELS } from '@/lib/ark/models';
import { estimateImageUsd, IMAGE_ENGINE_IDS, type ImageEngineId } from '@/lib/images/engines';
import { quoteVideo, type VideoModelKey } from '@/lib/video/models';
import type { CreatorResolution } from './resolution';

/**
 * The cost floor under a creator price (docs/CREATOR-RESOLUTION.md §3). A PROPOSAL, not a price:
 * exact customer prices are the founder's decision (AGENTS.md §5). The admin editor shows the
 * floor next to each price field and flags a price below it; nothing here writes a price.
 *
 * Founder decision, 2026-10-09: one successful generation, no remake/overhead allocation.
 * Exact ModelArk output tokens × list tariff × 1,400원; VAT 10%; provisional PG fee 3.3%.
 * Target is a share of revenue EXCLUDING VAT, after API and PG costs (NOT a cost markup).
 * price = API cost / ((1 − margin)/(1 + VAT) − PG rate), rounded up only to 100 won.
 * No fixed costs, FX buffer, promotion or contract discount is added.
 *
 * Founder decision, 2026-10-21: the target drops 10% → **5%** for TEMPLATE prices. The live prices
 * had been set 40~75% above the 10% floor (가상 뷰티 광고 8,900원 against a 6,200원 floor), so the
 * floor was never what made a film expensive — but the founder wants the floor itself lower.
 *
 * What 5% costs, stated once so nobody re-derives it: the free-remake promise published in the FAQ
 * ("얼굴이 제대로 반영되지 않으면 7일 안에 무상으로 다시 만들거나 환불") is paid out of this margin,
 * and the break-even remake rate halves from ~12% to ~6%. One remake in sixteen sales erases the
 * profit on that template.
 *
 * 2026-10-27: the PG rate is the CONTRACT rate, 3.4% — card 3.74% VAT-inclusive, whose VAT a
 * for-profit corporation deducts (docs/TOSS-CONTRACT.md, the source for every money number). The
 * provisional 3.3% understated it, so a floor that cleared 5% on paper could land under it.
 *
 * This figure drives TEMPLATE prices only. The subscription allowance keeps its own 10% target and
 * its own pinned assumptions in `subscription-plan.ts` — the approved 604-unit contract must not
 * move when a template constant does.
 */

export const COST_ASSUMPTIONS = {
  krwPerUsd: 1400,
  vatRate: 0.1,
  pgFeeRate: 0.034,
  targetMargin: 0.05,
} as const;

/**
 * Founder decision, 2026-10-27: Seedance 2.5 video templates sell at a **5~7%** revenue margin — the
 * 5% floor above and a 7% ceiling, so a price never drifts back to the 40~75% markups of early
 * October. Same arithmetic as the floor: after VAT and the contract PG rate, one successful render,
 * no remake reserve.
 *
 * The 100-won grid forces one exception. A short film's band can hold no whole-100 price — a
 * 10-second 9:16 film's is 3,900.1~3,987.5원 — and there the floor's own price (4,000원, 7.3%) is the
 * band: the cheapest price that clears 5%, never a higher one.
 *
 * Only TWINGS's price is banded. A maker template's royalty R sits on top of the floor
 * (lib/recipes/pricing.ts) and is the maker's money, not margin.
 */
export const SEEDANCE_25_MARGIN_CEILING = 0.07;

/** Revenue margin after VAT, PG and the provider cost, as a share of revenue excluding VAT. */
export function marginRate(priceKrw: number, providerKrw: number, assumptions = COST_ASSUMPTIONS): number {
  const revenue = priceKrw / (1 + assumptions.vatRate);
  return (revenue - priceKrw * assumptions.pgFeeRate - providerKrw) / revenue;
}

export interface MarginBand {
  /** The floor's price: the lowest whole-100 price at or above 5%. */
  lowKrw: number;
  /** The highest whole-100 price at or under 7% — never below `lowKrw` (see above). */
  highKrw: number;
}

/** The 5~7% band for a Seedance 2.5 film, or null for every other model (they keep the floor only). */
export function marginBand(input: { model: VideoModelKey; resolution: CreatorResolution; seconds: number; aspect?: string }, assumptions = COST_ASSUMPTIONS): MarginBand | null {
  if (input.model !== 'seedance-2.5') return null;
  const floor = costFloor(input, assumptions);
  if (!floor) return null;
  const { krwPerUsd, vatRate, pgFeeRate } = assumptions;
  const ceilingKrw = floor.providerUsd * krwPerUsd / ((1 - SEEDANCE_25_MARGIN_CEILING) / (1 + vatRate) - pgFeeRate);
  return { lowKrw: floor.proposedKrw, highKrw: Math.max(floor.proposedKrw, Math.floor(ceilingKrw / 100) * 100) };
}

/** Where a price sits against its band. */
export function bandPosition(priceKrw: number, band: MarginBand): 'below' | 'inside' | 'above' {
  return priceKrw < band.lowKrw ? 'below' : priceKrw > band.highKrw ? 'above' : 'inside';
}

export interface CostFloor {
  model: VideoModelKey;
  resolution: CreatorResolution;
  seconds: number;
  providerUsd: number;
  /** Provider cost in won, rounded only for display; no remake reserve. */
  providerKrw: number;
  /** The lowest VAT-inclusive won price that meets the target margin, before rounding. */
  floorKrw: number;
  /** `floorKrw` rounded up to the next 100 won. */
  proposedKrw: number;
  /** The same price in USD cents (display only; Toss still charges won). */
  proposedCents: number;
}

/** Smallest whole 100-won amount at or above the floor. */
export function roundUpToHundred(krw: number): number {
  return Math.max(100, Math.ceil(krw / 100) * 100);
}

export function costFloor(input: { model: VideoModelKey; resolution: CreatorResolution; seconds: number; aspect?: string }, assumptions = COST_ASSUMPTIONS): CostFloor | null {
  const estimate = quoteVideo({ ...input, aspect: input.aspect ?? '16:9' });
  if (!estimate) return null;
  const { krwPerUsd, vatRate, pgFeeRate, targetMargin } = assumptions;
  const providerKrw = estimate.providerUsd * krwPerUsd;
  const floorKrw = providerKrw / ((1 - targetMargin) / (1 + vatRate) - pgFeeRate);
  const proposedKrw = roundUpToHundred(floorKrw);
  return {
    model: input.model,
    resolution: input.resolution,
    seconds: input.seconds,
    providerUsd: estimate.providerUsd,
    providerKrw: Math.round(providerKrw),
    floorKrw: Math.ceil(floorKrw),
    proposedKrw,
    proposedCents: Math.ceil(proposedKrw / krwPerUsd * 100),
  };
}

/** Every model × resolution a creator template can sell, for a runtime. */
export function costTable(seconds: readonly number[]): CostFloor[] {
  const rows: CostFloor[] = [];
  for (const model of ['seedance-2.0', 'seedance-2.5'] as const) {
    for (const resolution of ['720p', '1080p'] as const) {
      for (const s of seconds) {
        if (s > ARK_MODELS[model].maxDurationSeconds) continue;
        const floor = costFloor({ model, resolution, seconds: s });
        if (floor) rows.push(floor);
      }
    }
  }
  return rows;
}

/**
 * The same floor for an IMAGE template (founder decision, 2026-10-21: "이미지 모델에서도 마진율을
 * 5% 정도로"). Images are one render, not a duration, so the cost comes from `estimateImageUsd` —
 * the engine's measured per-render price plus the reference photo — and the margin arithmetic is
 * identical to the video floor.
 *
 * The numbers are a different order of magnitude: a Seedream 5.0 Lite render is ~53원 against a
 * 4,854원 fifteen-second film. That is why an image template is the only thing in this catalogue
 * that can carry an impulse price. Nothing here writes a price; §5 of AGENTS.md still applies.
 */
/**
 * The lowest price ANY image template is offered at, whatever its engine costs (founder decision,
 * 2026-10-21: "이미지는 장당 최소로 200원 정도로"). Only Seedream 5.0 Lite falls under it (its 5%
 * floor is 100원); every other engine's floor is already 200원 or more.
 *
 * It does not cover the bank-transfer minimum: 계좌이체 charges at least 220원 a payment, so a 200원
 * image paid by transfer would lose money. That is handled outside the code — bank transfer and
 * virtual account were removed from the Toss payment UI on 2026-10-21 (docs/TOSS-CONTRACT.md,
 * "실제로 노출하는 결제수단"). Re-enabling either there brings the loss back.
 */
export const IMAGE_MIN_PRICE_KRW = 200;

export interface ImageCostFloor {
  engine: ImageEngineId;
  referenceImages: number;
  providerUsd: number;
  providerKrw: number;
  floorKrw: number;
  proposedKrw: number;
}

export function imageCostFloor(
  input: { engine: ImageEngineId; referenceImages?: number },
  assumptions = COST_ASSUMPTIONS,
): ImageCostFloor {
  const references = input.referenceImages ?? 1;
  const providerUsd = estimateImageUsd(input.engine, references);
  const { krwPerUsd, vatRate, pgFeeRate, targetMargin } = assumptions;
  const providerKrw = providerUsd * krwPerUsd;
  const floorKrw = providerKrw / ((1 - targetMargin) / (1 + vatRate) - pgFeeRate);
  return {
    engine: input.engine,
    referenceImages: references,
    providerUsd,
    providerKrw: Math.round(providerKrw),
    floorKrw: Math.ceil(floorKrw),
    proposedKrw: Math.max(IMAGE_MIN_PRICE_KRW, roundUpToHundred(floorKrw)),
  };
}

/** Every image engine a template can sell on, at one reference photo. */
export function imageCostTable(referenceImages = 1): ImageCostFloor[] {
  return IMAGE_ENGINE_IDS.map((engine) => imageCostFloor({ engine, referenceImages }));
}
