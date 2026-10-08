import { ARK_MODELS, type ArkModelKey } from '@/lib/ark/models';
import { quoteArkVideo } from '@/lib/ark/pricing';
import type { CreatorResolution } from './resolution';

/**
 * The cost floor under a creator price (docs/CREATOR-RESOLUTION.md §3). A PROPOSAL, not a price:
 * exact customer prices are the founder's decision (AGENTS.md §5). The admin editor shows the
 * floor next to each price field and flags a price below it; nothing here writes a price.
 *
 * Founder decision, 2026-10-09: one successful generation, no remake/overhead allocation.
 * Exact ModelArk output tokens × list tariff × 1,400원; VAT 10%; provisional PG fee 3.3%.
 * Target is 10% of revenue EXCLUDING VAT, after API and PG costs (not a 10% cost markup).
 * price = API cost / ((1 − margin)/(1 + VAT) − PG rate), rounded up only to 100 won.
 * No fixed costs, FX buffer, promotion or contract discount is added.
 */

export const COST_ASSUMPTIONS = {
  krwPerUsd: 1400,
  vatRate: 0.1,
  pgFeeRate: 0.033,
  targetMargin: 0.1,
} as const;

export interface CostFloor {
  model: ArkModelKey;
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

export function costFloor(input: { model: ArkModelKey; resolution: CreatorResolution; seconds: number; aspect?: string }, assumptions = COST_ASSUMPTIONS): CostFloor | null {
  const estimate = quoteArkVideo({ ...input, aspect: input.aspect ?? '16:9' });
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
