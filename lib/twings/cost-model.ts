import { ARK_MODELS, estimateRenderUsd, type ArkModelKey } from '@/lib/ark/models';
import type { CreatorResolution } from './resolution';

/**
 * The cost floor under a creator price (docs/CREATOR-RESOLUTION.md §3). A PROPOSAL, not a price:
 * exact customer prices are the founder's decision (AGENTS.md §5). The admin editor shows the
 * floor next to each price field and flags a price below it; nothing here writes a price.
 *
 * Assumptions, all from docs/TEMPLATES-IA.md §12 (과금 결정 갱신, 2026-09-17) unless noted:
 *   · provider cost = ModelArk USD per output second (lib/ark/models.ts, 16:9, audio on, no video
 *     input — audio is included in the per-second rate, not billed on top) × seconds × 1,400원;
 *   · +10% for failed renders re-made at our cost (a failed ModelArk task itself is not billed);
 *   · prices include VAT 10%; the PG fee is 3.3% of the charged amount;
 *   · target margin: revenue after VAT ≥ 1.2 × variable cost (provider + failures + PG fee).
 * Solving price/1.1 ≥ 1.2 × (1.1·C + 0.033·price) gives price ≥ ≈1.518 × C. Rounded UP to the
 * catalogue's x,900 shape so the floor is a price someone could actually set.
 *
 * Not modelled: FX moves (re-run at the day's rate), the 4:3 / 9:16 token difference (±5% against
 * the 16:9 page rate), and fixed costs (asset library plan, storage, mail).
 */

export const COST_ASSUMPTIONS = {
  krwPerUsd: 1400,
  vatRate: 0.1,
  pgFeeRate: 0.033,
  failureAllowance: 0.1,
  targetMargin: 0.2,
} as const;

export interface CostFloor {
  model: ArkModelKey;
  resolution: CreatorResolution;
  seconds: number;
  providerUsd: number;
  /** Provider cost in won, failures included. */
  providerKrw: number;
  /** The lowest VAT-inclusive won price that meets the target margin, before rounding. */
  floorKrw: number;
  /** `floorKrw` rounded up to the next x,900. */
  proposedKrw: number;
  /** The same floor in whole US dollars (display on English pages; Toss still charges won). */
  proposedCents: number;
}

/** Smallest n×1,000 − 100 at or above the amount; never below 900. */
export function roundUpToX900(krw: number): number {
  return Math.max(900, Math.ceil((krw + 100) / 1000) * 1000 - 100);
}

export function costFloor(input: { model: ArkModelKey; resolution: CreatorResolution; seconds: number }, assumptions = COST_ASSUMPTIONS): CostFloor | null {
  const estimate = estimateRenderUsd(input);
  if (!estimate.ok) return null;
  const { krwPerUsd, vatRate, pgFeeRate, failureAllowance, targetMargin } = assumptions;
  const providerKrw = estimate.usd * krwPerUsd * (1 + failureAllowance);
  const multiplier = 1 + targetMargin;
  // price/(1+vat) ≥ m·(providerKrw + pg·price)  ⇒  price ≥ m·providerKrw / (1/(1+vat) − m·pg)
  const floorKrw = (multiplier * providerKrw) / (1 / (1 + vatRate) - multiplier * pgFeeRate);
  const proposedKrw = roundUpToX900(floorKrw);
  return {
    model: input.model,
    resolution: input.resolution,
    seconds: input.seconds,
    providerUsd: estimate.usd,
    providerKrw: Math.round(providerKrw),
    floorKrw: Math.ceil(floorKrw),
    proposedKrw,
    proposedCents: Math.ceil(proposedKrw / krwPerUsd) * 100,
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
