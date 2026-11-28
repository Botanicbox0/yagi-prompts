import { estimateImageUsd, isImageEngine, isVideoEngine } from '@/lib/images/engines';
import { quoteVideo, videoModelForEngine } from '@/lib/video/models';
import { COST_ASSUMPTIONS } from '@/lib/twings/cost-model';
import { baseCredits, baseKrw, isRaise, RAISE_MAX_KRW, RAISE_STEP_KRW, type PriceMedium } from '@/lib/twings/template-price';
import { recipeAtResolution, recipeResolutions, type FilmResolution } from './resolution';
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

export class RecipePricingError extends Error {
  constructor(
    readonly code: 'unknown_engine' | 'unquotable_step',
    readonly stepId: string,
    readonly engine: string,
  ) {
    super(`recipe pricing ${code} at step ${stepId} (${engine})`);
    this.name = 'RecipePricingError';
  }
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
    if (step.kind === 'image') {
      if (!isImageEngine(step.engine)) throw new RecipePricingError('unknown_engine', step.id, step.engine);
      return { step: step.id, providerUsd: estimateImageUsd(step.engine, step.inputs.length) };
    }
    if (step.kind === 'video') {
      if (!isVideoEngine(step.engine)) throw new RecipePricingError('unknown_engine', step.id, step.engine);
      const { model, seconds } = videoModelForEngine(step.engine, step.params.duration);
      const quote = quoteVideo({ model, resolution: step.params.resolution, seconds, aspect: step.params.aspect });
      if (quote === null) throw new RecipePricingError('unquotable_step', step.id, step.engine);
      return { step: step.id, providerUsd: quote.providerUsd };
    }
    throw new RecipePricingError('unknown_engine', (step as { id: string }).id, String((step as { engine?: unknown }).engine ?? 'unknown'));
  });
}

/**
 * `resolution` is the one the buyer orders (lib/recipes/resolution.ts): the film is rendered at it,
 * so it is priced at it. Left out, the recipe is priced as written — what a test render costs.
 */
export function quoteRecipe(recipe: Recipe, royaltyKrw: number, resolution?: FilmResolution | null): RecipeQuote {
  const steps = stepCosts(recipeAtResolution(recipe, resolution));
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

/**
 * The price of each resolution the recipe's film can be made at, 720p first, with the same raise on
 * top of each base. Empty for a recipe that makes no film (an image, a carousel): those have one
 * price, `quoteRecipe(recipe, royaltyKrw)`.
 */
export function quoteRecipeByResolution(recipe: Recipe, royaltyKrw: number): Partial<Record<FilmResolution, RecipeQuote>> {
  const quotes: Partial<Record<FilmResolution, RecipeQuote>> = {};
  for (const resolution of recipeResolutions(recipe)) quotes[resolution] = quoteRecipe(recipe, royaltyKrw, resolution);
  return quotes;
}

/**
 * The quote a template is SOLD on: a film's 720p make (the default every order starts from), an
 * image or a carousel as it is. This — not the recipe as written — is the base a creative's price
 * sits on and the floor a row's `price_krw` is checked against.
 */
export function quoteRecipeBase(recipe: Recipe, royaltyKrw: number): RecipeQuote {
  return quoteRecipe(recipe, royaltyKrw, recipeResolutions(recipe)[0] ?? null);
}

/**
 * The 1080p row price that goes with a 720p row price: the 1080p base plus the same won the 720p
 * price carries above ITS base (the creative's raise, or the studio's premium). 0 = not sold at
 * 1080p (no film, or an engine without it).
 */
export function price1080KrwFor(recipe: Recipe, priceKrw: number): number {
  const quotes = quoteRecipeByResolution(recipe, 0);
  const sd = quotes['720p'], hd = quotes['1080p'];
  if (!sd || !hd) return 0;
  return hd.floorKrw + Math.max(0, priceKrw - sd.floorKrw);
}

/** USD cents for a won price, the same conversion the proposal uses (Toss still charges won). */
export function centsForKrw(krw: number): number {
  return Math.ceil(krw / COST_ASSUMPTIONS.krwPerUsd * 100);
}

/**
 * Slices a multi-frame carousel Recipe v2 (`output: { frames: [...] }`) down to the subset of
 * 0-based frame indices chosen by the user (e.g., picking 2 or 3 shots out of a 5-shot series).
 * Preserves any prerequisite intermediate steps referenced by the selected frames and keeps the
 * resulting recipe valid under `parseRecipe(sliced, { studio: true })`.
 */
export function sliceImageSetRecipe(
  recipe: Recipe,
  selectedFrameIndices: readonly number[]
): Recipe {
  if (!('frames' in recipe.output)) {
    return recipe;
  }

  const allFrames = recipe.output.frames;
  const totalFrames = allFrames.length;
  const normalizedIndices = Array.from(
    new Set(
      selectedFrameIndices
        .map((i) => Math.floor(i))
        .filter((i) => i >= 0 && i < totalFrames)
    )
  ).sort((a, b) => a - b);

  const activeIndices = normalizedIndices.length > 0 ? normalizedIndices : [0];
  if (activeIndices.length === totalFrames) {
    return recipe;
  }

  const chosenFrameStepIds = activeIndices.map((idx) => allFrames[idx]!);
  const neededStepIds = new Set<string>(chosenFrameStepIds);

  // Walk backwards through steps so any prerequisite image step read by a chosen frame is retained.
  for (let i = recipe.steps.length - 1; i >= 0; i -= 1) {
    const step = recipe.steps[i]!;
    if (neededStepIds.has(step.id)) {
      for (const inputName of step.inputs) {
        if (!recipe.slots[inputName]) {
          neededStepIds.add(inputName);
        }
      }
    }
  }

  const slicedSteps = recipe.steps.filter((step) => neededStepIds.has(step.id));
  const usedSlots = new Set<string>();
  for (const step of slicedSteps) {
    for (const inputName of step.inputs) {
      if (recipe.slots[inputName]) {
        usedSlots.add(inputName);
      }
    }
  }

  const slicedSlots = Object.fromEntries(
    Object.entries(recipe.slots).filter(([slotName]) => usedSlots.has(slotName))
  );

  return {
    ...recipe,
    slots: slicedSlots,
    steps: slicedSteps,
    output: { frames: chosenFrameStepIds },
  };
}

/**
 * Quotes a multi-shot image recipe when the user selects only a subset of frames (`selectedFrameIndices`).
 * Prorates any maker raise (`royaltyKrw`) proportionally to the number of selected frames.
 */
export function quoteSelectiveRecipe(
  recipe: Recipe,
  selectedFrameIndices: readonly number[],
  royaltyKrw = 0
): RecipeQuote & {
  totalFrames: number;
  selectedCount: number;
  selectedFrameIndices: number[];
  fullSetCredits: number;
  savedCredits: number;
  fullSetKrw: number;
  savedKrw: number;
} {
  const totalFrames = 'frames' in recipe.output ? recipe.output.frames.length : 1;
  const normalizedIndices = Array.from(
    new Set(
      selectedFrameIndices
        .map((i) => Math.floor(i))
        .filter((i) => i >= 0 && i < totalFrames)
    )
  ).sort((a, b) => a - b);
  const activeIndices = normalizedIndices.length > 0 ? normalizedIndices : [0];
  const selectedCount = activeIndices.length;

  const fullQuote = quoteRecipe(recipe, royaltyKrw);
  if (selectedCount === totalFrames) {
    return {
      ...fullQuote,
      totalFrames,
      selectedCount,
      selectedFrameIndices: activeIndices,
      fullSetCredits: fullQuote.baseCredits,
      savedCredits: 0,
      fullSetKrw: fullQuote.proposedKrw,
      savedKrw: 0,
    };
  }

  const sliced = sliceImageSetRecipe(recipe, activeIndices);
  const proratedRoyalty =
    Math.round(((royaltyKrw * selectedCount) / totalFrames) / ROYALTY_STEP_KRW) *
    ROYALTY_STEP_KRW;
  const slicedQuote = quoteRecipe(sliced, proratedRoyalty);

  return {
    ...slicedQuote,
    totalFrames,
    selectedCount,
    selectedFrameIndices: activeIndices,
    fullSetCredits: fullQuote.baseCredits,
    savedCredits: Math.max(0, fullQuote.baseCredits - slicedQuote.baseCredits),
    fullSetKrw: fullQuote.proposedKrw,
    savedKrw: Math.max(0, fullQuote.proposedKrw - slicedQuote.proposedKrw),
  };
}
