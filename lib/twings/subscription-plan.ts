import type { PromptCard } from '@/lib/prompts/catalog';
import { CREATOR_COST_V1, DEFAULT_CREATOR_PLAN, getCreatorPlanVersion } from './subscription-versions';

/** Pricing design, not a payment entitlement. No route may authorize a render from this quote.
 * BytePlus list prices, no contract/promotion discount. Billing uses actual completion_tokens.
 * Sources and launch requirements: docs/CREATOR-SUBSCRIPTION.md.
 */

/** The provider's published dimensions; 4:3 is slightly MORE expensive than 16:9. */
const DIMENSIONS: Record<'720p' | '1080p', Record<string, readonly [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [1112, 834], '3:4': [834, 1112], '1:1': [960, 960], '21:9': [1470, 630] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '4:3': [1664, 1248], '3:4': [1248, 1664], '1:1': [1440, 1440], '21:9': [2206, 946] },
};
const USD_PER_MILLION = { '720p': 10.70, '1080p': 11.70 } as const;
const BASE_USD = 10 * 1280 * 720 * 24 / 1024 * USD_PER_MILLION['720p'] / 1_000_000;
const KRW_PER_UNIT = BASE_USD * CREATOR_COST_V1.krwPerUsd * (1 + CREATOR_COST_V1.remakeAllowance) / 100;

export function subscriptionEconomics(input: { planVersionId?: string; pgFeeRate?: number } = {}) {
  const plan = getCreatorPlanVersion(input.planVersionId ?? DEFAULT_CREATOR_PLAN.id);
  const fee = input.pgFeeRate ?? CREATOR_COST_V1.pgFeeRate;
  if (!plan || !Number.isFinite(fee) || fee < 0 || fee > 1) throw new Error('Invalid subscription economics');
  const revenueExVatKrw = plan.priceKrw / (1 + CREATOR_COST_V1.vatRate);
  const generationBudgetKrw = plan.monthlyCredits * KRW_PER_UNIT;
  const pgFeeKrw = plan.priceKrw * fee;
  const marginKrw = revenueExVatKrw - generationBudgetKrw - pgFeeKrw - CREATOR_COST_V1.otherDirectCostsKrw;
  return { revenueExVatKrw, generationBudgetKrw, pgFeeKrw, marginKrw, marginRate: marginKrw / revenueExVatKrw };
}

export function quoteSubscriptionVideo(input: { seconds: number; resolution: '720p' | '1080p'; aspect: string }, planVersionId = DEFAULT_CREATOR_PLAN.id) {
  const plan = getCreatorPlanVersion(planVersionId);
  if (!plan || plan.deductionVersion !== 'seedance25-2026-10-07-v1') return null;
  if (!Number.isInteger(input.seconds) || input.seconds < 4 || input.seconds > 30) return null;
  const table = DIMENSIONS[input.resolution];
  const dimensions = table && Object.hasOwn(table, input.aspect) ? table[input.aspect] : null;
  if (!dimensions) return null;
  const providerTokens = input.seconds * dimensions[0] * dimensions[1] * 24 / 1024;
  const providerUsd = providerTokens * USD_PER_MILLION[input.resolution] / 1_000_000;
  // Ceil to the next internal unit. Subtract only floating-point noise at exact boundaries.
  const units = Math.ceil(providerUsd / BASE_USD * 100 - 1e-9);
  return { providerTokens, providerUsd, units, maxPerMonth: Math.floor(plan.monthlyCredits / units), monthlyPercent: units / plan.monthlyCredits * 100 };
}

/** Unknown image/provider costs stay outside the published video estimate. A sample video is
 * output media, not a billed input reference. Revisit the quote if video input is introduced.
 */
export function templateSubscriptionQuote(template: Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'aspectDefault'>) {
  if (template.medium !== 'video' || !template.runtimeSeconds) return null;
  const uses25 = template.engine === 'seedance-2.5' || ((template.engine === null || template.engine === 'seedance-2.0') && template.runtimeSeconds > 15);
  if (!uses25) return null;
  return quoteSubscriptionVideo({ seconds: template.runtimeSeconds, resolution: '720p', aspect: template.aspectDefault ?? '9:16' });
}
