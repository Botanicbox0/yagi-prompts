/** Append new versions; never edit a historical version, including its deduction rules. */
export interface CreatorPlanVersion {
  readonly id: string;
  readonly tier: 'creator' | 'advanced';
  readonly priceKrw: number;
  readonly monthlyCredits: number;
  readonly currency: 'KRW';
  readonly interval: 'month';
  readonly vatIncluded: true;
  readonly deductionVersion: 'seedance25-2026-10-07-v1';
  readonly costVersion: 'byteplus-2026-10-07-v1';
  readonly rollover: false;
}

const version = (id: string, tier: CreatorPlanVersion['tier'], priceKrw: number, monthlyCredits: number): CreatorPlanVersion => Object.freeze({
  id, tier, priceKrw, monthlyCredits, currency: 'KRW', interval: 'month', vatIncluded: true,
  deductionVersion: 'seedance25-2026-10-07-v1', costVersion: 'byteplus-2026-10-07-v1', rollover: false,
});

export const CREATOR_PLAN_VERSIONS = Object.freeze([
  version('creator-2026-10-07-v1', 'creator', 19000, 400), // Superseded design; never sold.
  version('creator-2026-10-08-v2', 'creator', 29000, 620),
  version('advanced-2026-10-08-v1', 'advanced', 49000, 1060),
] as const);

/** Marketing selection only. Renewals must use their stored agreement's exact version. */
export const CURRENT_CREATOR_PLANS = Object.freeze([CREATOR_PLAN_VERSIONS[1], CREATOR_PLAN_VERSIONS[2]] as const);
export const DEFAULT_CREATOR_PLAN = CURRENT_CREATOR_PLANS[0];
export function getCreatorPlanVersion(id: string): CreatorPlanVersion | null {
  return CREATOR_PLAN_VERSIONS.find(plan => plan.id === id) ?? null;
}

/** Deliberately fail closed: a price catalog is not a billing/credit ledger implementation. */
export function getCreatorSubscriptionAvailability() {
  return { status: 'preparing', canSubscribe: false } as const;
}

export const CREATOR_COST_V1 = Object.freeze({
  krwPerUsd: 1400, vatRate: .1, pgFeeRate: .033, remakeAllowance: .1, otherDirectCostsKrw: 1000,
});
