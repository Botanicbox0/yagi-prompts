/**
 * Plan credits and the margin rule they were set by (docs/BRAND-RECURRING-BILLING.md §6.3, §6.5; founder decisions
 * 2026-11-23). The per-model deduction table is not here and does not change: what a run takes stays
 * `usageKrw` (lib/brand-studio/usage-rate.ts). Margin is set by how many credits a plan gives each month.
 *
 * Basis: card payment, every credit used, all of it on the costliest model, must leave 10–12% of the monthly price.
 * Customer discounts are not part of the calculation (a sales cost, §6.3).
 *
 * tests/brands/plan-credits.test.ts pins every number here; change one only after recomputing §6.3.
 * Client-safe: no env, no db.
 */
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { STUDIO_USAGE_FACTORS } from '@/lib/brand-studio/usage-rate';
import { BRAND_INVOICE_VAT_PERCENT, type PaidBrandPlanId } from './math';

/** Credits each paid plan gives per month (decided 2026-11-23). Stored in production as credits x 10 KRW. */
export const BRAND_PLAN_CREDITS: Readonly<Record<PaidBrandPlanId, number>> = {
  b2b_29: 27_000,
  b2b_49: 46_000,
  b2b_69: 65_000,
};

/**
 * Monthly list price (KRW, VAT excluded) of each paid plan, restated from `BRAND_PLANS` in lib/brands/plans.ts, which
 * is server-only. tests/brands/plan-credits.test.ts fails the moment the two drift apart. No new price lives here.
 */
export const BRAND_PLAN_LIST_KRW: Readonly<Record<PaidBrandPlanId, number>> = {
  b2b_29: 290_000,
  b2b_49: 490_000,
  b2b_69: 690_000,
};

/** Trial credits an organization gets once, when an admin approves its workspace (§6.5, decided 2026-11-23). */
export const BRAND_TRIAL_CREDITS = 400;

/** The lowest card margin a plan may leave under full use of the costliest model (§6.3: 10–12%). */
export const BRAND_MARGIN_FLOOR = 0.1;

/**
 * Card fee rate: the contract value in docs/TOSS-CONTRACT.md (domestic credit card 3.74%). It is a VAT-inclusive rate
 * applied to the VAT-inclusive charge (price x 1.1).
 */
export const BRAND_CARD_FEE_RATE = 0.0374;

/** Bank transfer fee per invoice: the virtual account public price (§6.3). A manual transfer costs nothing. */
export const BRAND_TRANSFER_FEE_KRW = 440;

export type BrandPaymentMethod = 'card' | 'transfer';

/**
 * The most a credit can cost us: a credit is `STUDIO_CREDIT_KRW` of usage, and usage is at least the billed cost x the
 * smallest factor (video, 1 + 0.11), so cost per credit <= 10 / 1.11 ≈ 9.009 KRW (§6.1).
 */
export function worstCostKrwPerCredit(): number {
  return STUDIO_CREDIT_KRW / (1 + STUDIO_USAGE_FACTORS.videoMargin);
}

/** A plan's monthly cap in KRW (`brand_plan_allowance_defaults.monthly_cap_krw`): credits x 10. */
export function planCapKrwFromCredits(plan: PaidBrandPlanId): number {
  return BRAND_PLAN_CREDITS[plan] * STUDIO_CREDIT_KRW;
}

/**
 * R3 item 6: the monthly plan cap that applies (KRW). A stored `brand_plan_allowance_defaults` row wins; with no row, or
 * a cleared one (null), a paid plan opens its confirmed credits (`planCapKrwFromCredits`) instead of falling back to the
 * env default. Null only for a plan id with no confirmed credits (`project_only`, an unknown id): the caller's defensive
 * path (the env default for the allowance, `plan_cap_not_set` for an upgrade). Every reader of the plan default goes
 * through here (lib/brand-studio/usage.ts, snapshot.ts, allowance.ts, plan-upgrade-apply.ts, the admin summaries).
 */
export function resolvePlanCapKrw(planId: string, storedCapKrw: number | null | undefined): number | null {
  if (storedCapKrw !== null && storedCapKrw !== undefined && Number.isFinite(Number(storedCapKrw))) return Number(storedCapKrw);
  if (!Object.prototype.hasOwnProperty.call(BRAND_PLAN_CREDITS, planId)) return null;
  return planCapKrwFromCredits(planId as PaidBrandPlanId);
}

/** SQL for the same fallback: a `case` over a plan-id expression giving each paid plan's confirmed cap, else null. */
export function confirmedPlanCapSql(planIdExpr: string): string {
  const whens = (Object.keys(BRAND_PLAN_CREDITS) as PaidBrandPlanId[])
    .map((plan) => `when '${plan}' then ${planCapKrwFromCredits(plan)}`)
    .join(' ');
  return `(case ${planIdExpr} ${whens} else null end)::bigint`;
}

/** Card fee on one monthly charge: ceil(price x 1.1 x 0.0374), the price being VAT-exclusive. */
export function cardFeeKrw(priceKrw: number): number {
  if (!Number.isFinite(priceKrw) || priceKrw <= 0) return 0;
  return Math.ceil(priceKrw * (1 + BRAND_INVOICE_VAT_PERCENT / 100) * BRAND_CARD_FEE_RATE - 1e-6);
}

/**
 * What a plan leaves (KRW, VAT excluded) when every credit is used on the costliest model:
 * price − payment fee − credits x worst cost per credit. Not rounded.
 */
export function worstCaseMarginKrw(plan: PaidBrandPlanId, method: BrandPaymentMethod): number {
  const price = BRAND_PLAN_LIST_KRW[plan];
  const fee = method === 'card' ? cardFeeKrw(price) : BRAND_TRANSFER_FEE_KRW;
  return price - fee - BRAND_PLAN_CREDITS[plan] * worstCostKrwPerCredit();
}
