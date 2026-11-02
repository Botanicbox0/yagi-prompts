import { marginSplit } from '@/lib/creator-platform/economics';
import { COST_ASSUMPTIONS, IMAGE_MIN_PRICE_KRW, roundUpToHundred } from './cost-model';

/**
 * docs/PLATFORM-2.0.md §19.2 (founder decision, 2026-11-02) — what a template costs and what one
 * make of it earns its AI creative. One rule for the studio's own templates and the creatives' alike.
 *
 *   · The margin lives in the TEMPLATE, not in the plan. One credit is 10원 of revenue after VAT and
 *     the app-store fee, so a plan's monthly credits are its net revenue ÷ 10 and carry no margin.
 *   · Base credits: an image is its provider cost × 1.12 (the founder's 10~15% markup band), a film
 *     its provider cost at a 6% margin (the 5~7% band). Nano Banana 2.1 × 5 = 41, 10 s 720p = 345.
 *   · A creative may raise the price above the base, never lower it. The user spends more credits,
 *     the margin grows, and 80% of the WHOLE margin — base and raise — is the creative's
 *     (`marginSplit`, unchanged). A company account (`platform_creators.payout = 'company'`) keeps 100%.
 *
 * Until web subscriptions open (Toss autopay), the same base sells in won: credits × 10원 ÷ the share
 * of a card payment left after VAT and the contract PG fee, rounded up to 100원. That reproduces the
 * live 3,900원 / 5,900원 films at the band's lower edge, so no reviewed price moves.
 */

export const CREDIT_NET_KRW = 10;
export const IMAGE_MARKUP = { min: 1.10, target: 1.12, max: 1.15 } as const;
export const VIDEO_MARGIN = { min: 0.05, target: 0.06, max: 0.07 } as const;
/**
 * Contract card fee 3.74% incl. VAT → 3.4% after the input-tax credit (docs/TOSS-CONTRACT.md).
 * `COST_ASSUMPTIONS.pgFeeRate` keeps its provisional 3.3%: the approved 604-unit creator subscription
 * was priced on it, and moving it would change that contract.
 */
export const PG_FEE_RATE = 0.034;
/** What 1원 of a card payment leaves after VAT and the PG fee. */
export const NET_SHARE = 1 / (1 + COST_ASSUMPTIONS.vatRate) - PG_FEE_RATE;
/** How much a creative may raise a template above its base, in won (the 0059 CHECK). */
export const RAISE_MAX_KRW = 5000;
export const RAISE_STEP_KRW = 100;

export type PriceMedium = 'image' | 'video';
export type PriceLevel = keyof typeof IMAGE_MARKUP;
export interface CostInput { medium: PriceMedium; providerUsd: number }

export function providerKrw(providerUsd: number): number {
  return providerUsd * COST_ASSUMPTIONS.krwPerUsd;
}

/** Credits for one make at the base price; `min` is the band's lower edge (the admin's warning line). */
export function baseCredits(input: CostInput, level: PriceLevel = 'target'): number {
  const cost = providerKrw(input.providerUsd);
  const gross = input.medium === 'image' ? cost * IMAGE_MARKUP[level] : cost / (1 - VIDEO_MARGIN[level]);
  // Only float noise is shaved before rounding up.
  return Math.max(1, Math.ceil(gross / CREDIT_NET_KRW - 1e-9));
}

/** The won price a number of credits sells at by card, 100원 steps; an image never below 200원. */
export function creditsToKrw(credits: number, medium: PriceMedium): number {
  const krw = roundUpToHundred(credits * CREDIT_NET_KRW / NET_SHARE - 1e-9);
  return medium === 'image' ? Math.max(IMAGE_MIN_PRICE_KRW, krw) : krw;
}

/** The base won price of a template: the lowest a creative may sell it at. */
export function baseKrw(input: CostInput, level: PriceLevel = 'target'): number {
  return creditsToKrw(baseCredits(input, level), input.medium);
}

export interface MakeEarning {
  /** Revenue left after VAT, the PG fee and the provider cost (never below 0). */
  margin: number;
  /** The AI creative's 80%, or 0 for a company account. */
  creator: number;
  platform: number;
}

/**
 * One card sale at `priceKrw`, split the way `settle` will split it. An ESTIMATE: settlement uses the
 * render's metered provider cost and that day's exchange rate, not this list price.
 */
export function makeEarning(input: CostInput & { priceKrw: number; company?: boolean }): MakeEarning {
  const revenue = Math.max(0, Math.round(input.priceKrw));
  const tax = revenue - Math.round(revenue / (1 + COST_ASSUMPTIONS.vatRate));
  const fees = Math.round(revenue * PG_FEE_RATE);
  const cost = Math.ceil(providerKrw(input.providerUsd));
  return marginSplit({ revenue, tax, fees, providerCost: cost, creator: !input.company });
}

/** A creative's raise: whole hundreds of won, from 0 to `RAISE_MAX_KRW`. */
export function isRaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= RAISE_MAX_KRW && value % RAISE_STEP_KRW === 0;
}
