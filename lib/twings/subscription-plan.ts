import type { PromptCard } from '@/lib/prompts/catalog';

/** Pricing design, not a payment entitlement. No route may authorize a render from this quote.
 * BytePlus list prices, no contract/promotion discount. Billing uses actual completion_tokens.
 * Sources and launch requirements: docs/CREATOR-SUBSCRIPTION.md.
 */
export const CREATOR_PLAN = {
  priceKrw: 19000,
  monthlyUnits: 400,
  status: 'preparing',
  krwPerUsd: 1400,
  vatRate: 0.1,
  pgFeeRate: 0.033,
  remakeAllowance: 0.1,
  otherDirectCostsKrw: 1000,
} as const;

/** The provider's published dimensions; 4:3 is slightly MORE expensive than 16:9. */
const DIMENSIONS: Record<'720p' | '1080p', Record<string, readonly [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [1112, 834], '3:4': [834, 1112], '1:1': [960, 960], '21:9': [1470, 630] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '4:3': [1664, 1248], '3:4': [1248, 1664], '1:1': [1440, 1440], '21:9': [2206, 946] },
};
const USD_PER_MILLION = { '720p': 10.70, '1080p': 11.70 } as const;
const BASE_USD = 10 * 1280 * 720 * 24 / 1024 * USD_PER_MILLION['720p'] / 1_000_000;
const KRW_PER_UNIT = BASE_USD * CREATOR_PLAN.krwPerUsd * (1 + CREATOR_PLAN.remakeAllowance) / 100;

export function subscriptionEconomics(input: { pgFeeRate?: number } = {}) {
  const revenueExVatKrw = CREATOR_PLAN.priceKrw / (1 + CREATOR_PLAN.vatRate);
  const generationBudgetKrw = CREATOR_PLAN.monthlyUnits * KRW_PER_UNIT;
  const pgFeeKrw = CREATOR_PLAN.priceKrw * (input.pgFeeRate ?? CREATOR_PLAN.pgFeeRate);
  const marginKrw = revenueExVatKrw - generationBudgetKrw - pgFeeKrw - CREATOR_PLAN.otherDirectCostsKrw;
  return { revenueExVatKrw, generationBudgetKrw, pgFeeKrw, marginKrw, marginRate: marginKrw / revenueExVatKrw };
}

export function quoteSubscriptionVideo(input: { seconds: number; resolution: '720p' | '1080p'; aspect: string }) {
  if (!Number.isInteger(input.seconds) || input.seconds < 4 || input.seconds > 30) return null;
  const table = DIMENSIONS[input.resolution];
  const dimensions = table && Object.hasOwn(table, input.aspect) ? table[input.aspect] : null;
  if (!dimensions) return null;
  const providerTokens = input.seconds * dimensions[0] * dimensions[1] * 24 / 1024;
  const providerUsd = providerTokens * USD_PER_MILLION[input.resolution] / 1_000_000;
  // Ceil to the next internal unit. Subtract only floating-point noise at exact boundaries.
  const units = Math.ceil(providerUsd / BASE_USD * 100 - 1e-9);
  return { providerTokens, providerUsd, units, maxPerMonth: Math.floor(CREATOR_PLAN.monthlyUnits / units), monthlyPercent: units / CREATOR_PLAN.monthlyUnits * 100 };
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
