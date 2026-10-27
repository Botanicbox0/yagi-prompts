import type { PromptCard } from '@/lib/prompts/catalog';
import { quoteArkVideo } from '@/lib/ark/pricing';
import { COST_ASSUMPTIONS } from './cost-model';

/** Pricing design, not a payment entitlement. No route may authorize a render from this quote.
 * BytePlus list prices, no contract/promotion discount. Billing uses actual completion_tokens.
 * Sources and launch requirements: docs/CREATOR-SUBSCRIPTION.md.
 */
const BASE_USD = quoteArkVideo({ model: 'seedance-2.5', seconds: 10, resolution: '720p', aspect: '9:16' })!.providerUsd;
const KRW_PER_UNIT = BASE_USD * COST_ASSUMPTIONS.krwPerUsd / 100;

/**
 * The subscription keeps the ORIGINAL 10% target, deliberately apart from the template floor
 * (`COST_ASSUMPTIONS.targetMargin`, dropped to 5% on 2026-10-21). The allowance is a contract term,
 * not a display price: lowering the margin here does not make a subscription cheaper, it hands the
 * same 24,900원 subscriber 35 more units a month — the approved contract is 604 units
 * (`lib/creator-subscriptions/plans.ts`, "Cost-model changes must never change an existing charge").
 * Changing a live subscriber's allowance is a founder decision with its own plan version.
 */
export const SUBSCRIPTION_TARGET_MARGIN = 0.1;

/**
 * Pinned to the plan version these allowances were approved under (creator-2026-10-09-v1), which
 * assumed a provisional 3.3% PG fee. Templates moved to the contract 3.4% on 2026-10-27; following
 * them here would quietly re-derive 603 units against the approved 604. The next plan version (the
 * 19,000 / 39,000원 proposal, docs/CREATOR-SUBSCRIPTION.md "2026-10-27 재계산") is computed at 3.4%.
 */
const PLAN_ASSUMPTIONS = { ...COST_ASSUMPTIONS, pgFeeRate: 0.033 } as const;

function allowanceAtTarget(priceKrw: number) {
  const apiBudget = priceKrw / (1 + PLAN_ASSUMPTIONS.vatRate) * (1 - SUBSCRIPTION_TARGET_MARGIN) - priceKrw * PLAN_ASSUMPTIONS.pgFeeRate;
  return Math.floor(apiBudget / KRW_PER_UNIT);
}

/** No remake/overhead reserves. Future prompt editing is not currently an entitlement. */
export const CREATOR_PLANS = {
  creator: { ...PLAN_ASSUMPTIONS, targetMargin: SUBSCRIPTION_TARGET_MARGIN, priceKrw: 24900, monthlyUnits: allowanceAtTarget(24900), status: 'preparing', promptEditing: 'not-included' },
  // Four 30-second / twelve 10-second films: 9.20% margin at full use.
  premium: { ...PLAN_ASSUMPTIONS, targetMargin: SUBSCRIPTION_TARGET_MARGIN, priceKrw: 49000, monthlyUnits: 1200, status: 'preparing', promptEditing: 'planned' },
} as const;
export type CreatorPlanId = keyof typeof CREATOR_PLANS;

export function subscriptionEconomics(input: { planId?: CreatorPlanId; pgFeeRate?: number } = {}) {
  const plan = CREATOR_PLANS[input.planId ?? 'creator'];
  const revenueExVatKrw = plan.priceKrw / (1 + plan.vatRate);
  const generationBudgetKrw = plan.monthlyUnits * KRW_PER_UNIT;
  const pgFeeKrw = plan.priceKrw * (input.pgFeeRate ?? plan.pgFeeRate);
  const marginKrw = revenueExVatKrw - generationBudgetKrw - pgFeeKrw;
  return { revenueExVatKrw, generationBudgetKrw, pgFeeKrw, marginKrw, marginRate: marginKrw / revenueExVatKrw };
}

export function quoteSubscriptionVideo(input: { seconds: number; resolution: '720p' | '1080p'; aspect: string }, planId: CreatorPlanId = 'creator') {
  const quote = quoteArkVideo({ ...input, model: 'seedance-2.5' });
  if (!quote) return null;
  const plan = CREATOR_PLANS[planId];
  // Ceil to the next internal unit. Subtract only floating-point noise at exact boundaries.
  const units = Math.ceil(quote.providerUsd / BASE_USD * 100 - 1e-9);
  return { ...quote, units, maxPerMonth: Math.floor(plan.monthlyUnits / units), monthlyPercent: units / plan.monthlyUnits * 100 };
}

/** Unknown image/provider costs stay outside the published video estimate. A sample video is
 * output media, not a billed input reference. Revisit the quote if video input is introduced.
 */
export function templateSubscriptionQuote(template: Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'aspectDefault'>, planId: CreatorPlanId = 'creator') {
  if (template.medium !== 'video' || !template.runtimeSeconds) return null;
  const uses25 = template.engine === 'seedance-2.5' || ((template.engine === null || template.engine === 'seedance-2.0') && template.runtimeSeconds > 15);
  if (!uses25) return null;
  return quoteSubscriptionVideo({ seconds: template.runtimeSeconds, resolution: '720p', aspect: template.aspectDefault ?? '9:16' }, planId);
}
