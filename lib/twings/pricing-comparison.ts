import { CURRENT_CREATOR_PLANS } from './subscription-versions';

/** Founder-authorized 2026-10-08 single-purchase schedule. Append a new version when changed.
 * This is a pricing policy, not an override of a stored order or a template's sale status.
 * Only Seedance 2.5, 720p, without input video; HD and other engines need separate pricing.
 */
export const SINGLE_VIDEO_PRICE_V1 = Object.freeze([
  Object.freeze({ minSeconds: 4, maxSeconds: 10, priceKrw: 5900 }),
  Object.freeze({ minSeconds: 11, maxSeconds: 15, priceKrw: 8900 }),
  Object.freeze({ minSeconds: 16, maxSeconds: 20, priceKrw: 11900 }),
  Object.freeze({ minSeconds: 21, maxSeconds: 25, priceKrw: 14900 }),
  Object.freeze({ minSeconds: 26, maxSeconds: 30, priceKrw: 18900 }),
]);

export function singleVideoPrice720(seconds: number): number | null {
  if (!Number.isInteger(seconds)) return null;
  return SINGLE_VIDEO_PRICE_V1.find(band => seconds >= band.minSeconds && seconds <= band.maxSeconds)?.priceKrw ?? null;
}

export interface PurchaseEstimate { id: string; totalKrw: number; extraFilms: number }
export interface UsageLine { count: number; credits: number; priceKrw: number | null }

/** Compare singles, Creator + singles, Advanced + singles. Whole films only; unused allowance
 * has no cash value. A small 0/1 knapsack maximizes the actual single-purchase cost covered by
 * each plan. A tie favors singles, then the cheaper base plan. No future renewal is authorized.
 */
export function comparePurchaseOptions(lines: UsageLine[]) {
  for (const line of lines) {
    if (!Number.isInteger(line.count) || line.count < 0 || line.count > 20 ||
      !Number.isSafeInteger(line.credits) || line.credits <= 0) throw new Error('Invalid usage');
  }
  if (lines.some(line => line.count > 0 && (line.priceKrw === null || !Number.isSafeInteger(line.priceKrw) || line.priceKrw <= 0))) return null;
  const films = lines.flatMap(line => Array.from({ length: line.count }, () => ({ credits: line.credits, priceKrw: line.priceKrw! })));
  const singleKrw = films.reduce((sum, film) => sum + film.priceKrw, 0);
  const choices: PurchaseEstimate[] = [{ id: 'single', totalKrw: singleKrw, extraFilms: films.length }];
  for (const plan of CURRENT_CREATOR_PLANS) {
    const covered = Array.from({ length: plan.monthlyCredits + 1 }, () => ({ value: 0, count: 0 }));
    for (const film of films) {
      for (let cap = plan.monthlyCredits; cap >= film.credits; cap--) {
        const prior = covered[cap - film.credits]!;
        if (prior.value + film.priceKrw > covered[cap]!.value) covered[cap] = { value: prior.value + film.priceKrw, count: prior.count + 1 };
      }
    }
    const allocation = covered[plan.monthlyCredits]!;
    choices.push({ id: plan.id, totalKrw: plan.priceKrw + singleKrw - allocation.value, extraFilms: films.length - allocation.count });
  }
  const best = choices.reduce((best, choice) => choice.totalKrw < best.totalKrw ? choice : best);
  return { singleKrw, choices, best, savingsKrw: singleKrw - best.totalKrw };
}
