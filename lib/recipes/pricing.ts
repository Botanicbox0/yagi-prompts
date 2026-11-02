import { estimateImageUsd, isImageEngine, isVideoEngine } from '@/lib/images/engines';
import { quoteVideo, videoModelForEngine } from '@/lib/video/models';
import { COST_ASSUMPTIONS } from '@/lib/twings/cost-model';
import { baseCredits, baseKrw, isRaise, RAISE_MAX_KRW, RAISE_STEP_KRW, type PriceMedium } from '@/lib/twings/template-price';
import type { Recipe } from './schema';

/**
 * The price of a maker template (docs/PLATFORM-2.0.md §19.2, founder decision 2026-11-02): the base
 * price of everything the recipe renders (lib/twings/template-price.ts — images at cost × 1.12, films
 * at a 6% margin) plus the creative's raise R. The base is the floor: a creative may only go up.
 * Settlement is untouched — marginSplit gives 80% of the whole margin to the creative.
 *
 * A carousel is priced on all its frames together (one order), not frame by frame, so a five-frame set
 * lands in the founder's 10~15% band instead of five 200원 minimums; an intermediate step (a character
 * sheet) adds its provider cost like any other step.
 */

/** The raise R, in won. Kept under its old name: `royalty_krw` stores it (0059, widened to 0 by 0073). */
export const ROYALTY_MIN_KRW = 0;
export const ROYALTY_MAX_KRW = RAISE_MAX_KRW;
export const ROYALTY_DEFAULT_KRW = 0;
export const ROYALTY_STEP_KRW = RAISE_STEP_KRW;

export function isRoyalty(value: unknown): value is number {
  return isRaise(value);
}

export interface StepCost { step: string; providerUsd: number }
export interface RecipeQuote {
  steps: StepCost[];
  medium: PriceMedium;
  providerUsd: number;
  providerKrw: number;
  /** Credits for one make at the base (shown once subscriptions open). */
  baseCredits: number;
  /** The base won price, rounded up to 100원 — the lowest the template sells at. */
  floorKrw: number;
  royaltyKrw: number;
  proposedKrw: number;
  proposedCents: number;
}

export function stepCosts(recipe: Recipe): StepCost[] {
  return recipe.steps.map((step) => {
    if (step.kind === 'image' && isImageEngine(step.engine)) return { step: step.id, providerUsd: estimateImageUsd(step.engine, step.inputs.length) };
    if (step.kind === 'video' && isVideoEngine(step.engine)) {
      const { model, seconds } = videoModelForEngine(step.engine, step.params.duration);
      const quote = quoteVideo({ model, resolution: step.params.resolution, seconds, aspect: step.params.aspect });
      return { step: step.id, providerUsd: quote?.providerUsd ?? 0 };
    }
    return { step: step.id, providerUsd: 0 };
  });
}

export function quoteRecipe(recipe: Recipe, royaltyKrw: number): RecipeQuote {
  const steps = stepCosts(recipe);
  const providerUsd = Math.round(steps.reduce((sum, step) => sum + step.providerUsd, 0) * 10000) / 10000;
  const medium: PriceMedium = recipe.steps.some((step) => step.kind === 'video') ? 'video' : 'image';
  const floorKrw = baseKrw({ medium, providerUsd });
  const proposedKrw = floorKrw + royaltyKrw;
  return {
    steps,
    medium,
    providerUsd,
    providerKrw: Math.round(providerUsd * COST_ASSUMPTIONS.krwPerUsd),
    baseCredits: baseCredits({ medium, providerUsd }),
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
