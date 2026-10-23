import { quoteArkVideo } from '@/lib/ark/pricing';
import { estimateImageUsd, isImageEngine, isVideoEngine } from '@/lib/images/engines';
import { arkModelForVideo } from '@/lib/twings/resolution';
import { COST_ASSUMPTIONS, IMAGE_MIN_PRICE_KRW, roundUpToHundred } from '@/lib/twings/cost-model';
import { outputSteps, type Recipe } from './schema';

/**
 * The price proposal for a maker template (docs/PLATFORM-2.0.md §8.3, §18): the cost floor of every
 * step at the template target margin (lib/twings/cost-model.ts, 5%) plus the maker's royalty R.
 * Settlement is untouched — marginSplit still gives 80% of the margin to the maker, so R's 80% is
 * theirs. A PROPOSAL only: the studio confirms the price at review (AGENTS.md §5).
 *
 * A carousel frame is priced like an image template (at least 200원 a frame); an intermediate step
 * (a character sheet) adds its provider cost to the step that uses it rather than its own minimum.
 */

export const ROYALTY_MIN_KRW = 500;
export const ROYALTY_MAX_KRW = 5000;
export const ROYALTY_DEFAULT_KRW = 1500;
export const ROYALTY_STEP_KRW = 100;

export function isRoyalty(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= ROYALTY_MIN_KRW && value <= ROYALTY_MAX_KRW && value % ROYALTY_STEP_KRW === 0;
}

export interface StepCost { step: string; providerUsd: number }
export interface RecipeQuote {
  steps: StepCost[];
  providerUsd: number;
  providerKrw: number;
  /** Lowest VAT-inclusive price meeting the target margin, rounded up to 100원 (per frame minimum applied). */
  floorKrw: number;
  royaltyKrw: number;
  proposedKrw: number;
  proposedCents: number;
}

function floorFor(usd: number): number {
  const { krwPerUsd, vatRate, pgFeeRate, targetMargin } = COST_ASSUMPTIONS;
  return usd * krwPerUsd / ((1 - targetMargin) / (1 + vatRate) - pgFeeRate);
}

export function stepCosts(recipe: Recipe): StepCost[] {
  return recipe.steps.map((step) => {
    if (step.kind === 'image' && isImageEngine(step.engine)) return { step: step.id, providerUsd: estimateImageUsd(step.engine, step.inputs.length) };
    if (step.kind === 'video' && isVideoEngine(step.engine)) {
      const { model, seconds } = arkModelForVideo(step.engine, step.params.duration);
      const quote = quoteArkVideo({ model, resolution: step.params.resolution, seconds, aspect: step.params.aspect });
      return { step: step.id, providerUsd: quote?.providerUsd ?? 0 };
    }
    return { step: step.id, providerUsd: 0 };
  });
}

export function quoteRecipe(recipe: Recipe, royaltyKrw: number): RecipeQuote {
  const steps = stepCosts(recipe);
  const providerUsd = Math.round(steps.reduce((sum, step) => sum + step.providerUsd, 0) * 10000) / 10000;
  const shown = new Set(outputSteps(recipe));
  const carousel = 'frames' in recipe.output;
  // A carousel: each frame at least the image minimum; hidden steps ride on the first frame.
  const floorKrw = carousel
    ? steps.filter((step) => shown.has(step.step)).reduce((sum, step, index) => {
        const extra = index === 0 ? steps.filter((s) => !shown.has(s.step)).reduce((acc, s) => acc + s.providerUsd, 0) : 0;
        return sum + Math.max(IMAGE_MIN_PRICE_KRW, roundUpToHundred(floorFor(step.providerUsd + extra)));
      }, 0)
    : recipe.steps.some((step) => step.kind === 'video')
      ? roundUpToHundred(floorFor(providerUsd))
      : Math.max(IMAGE_MIN_PRICE_KRW, roundUpToHundred(floorFor(providerUsd)));
  const proposedKrw = floorKrw + royaltyKrw;
  return {
    steps,
    providerUsd,
    providerKrw: Math.round(providerUsd * COST_ASSUMPTIONS.krwPerUsd),
    floorKrw,
    royaltyKrw,
    proposedKrw,
    proposedCents: Math.ceil(proposedKrw / COST_ASSUMPTIONS.krwPerUsd * 100),
  };
}

/** USD cents for a won price, the same conversion the proposal uses (Toss still charges won). */
export function centsForKrw(krw: number): number {
  return Math.ceil(krw / COST_ASSUMPTIONS.krwPerUsd * 100);
}
