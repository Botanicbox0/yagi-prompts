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
 * profit on that template. The PG rate is also still a provisional 3.3%, not a signed one.
 *
 * This figure drives TEMPLATE prices only. The subscription allowance keeps its own 10% target in
 * `subscription-plan.ts` — moving it here would silently hand every Creator subscriber 35 more
 * units a month against an already-approved 604-unit contract.
 */

export const COST_ASSUMPTIONS = {
  krwPerUsd: 1400,
  vatRate: 0.1,
  pgFeeRate: 0.033,
  targetMargin: 0.05,
} as const;

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
