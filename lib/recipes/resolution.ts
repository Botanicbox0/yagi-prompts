import { isVideoEngine } from '@/lib/images/engines';
import { videoModelForEngine, videoResolutions } from '@/lib/video/models';
import { outputSteps, type Recipe, type RecipeStep } from './schema';

/**
 * The resolution a recipe film is MADE at (founder, 2026-11-15: "720p와 1080p 화질 선택이 가능하게,
 * 그에 따라 차등 가격 — 구독 오픈 이후에는 크레딧").
 *
 * A recipe names one resolution on its film step. That is the resolution the creative wrote and
 * tested it at — it is not what a buyer pays for. The buyer's order names 720p or 1080p
 * (lib/twings/resolution.ts), the price and the credits follow that choice, and the film must be
 * rendered at exactly that. Before this file the render pass sent the recipe's own value to the
 * provider whatever the order said, so a 1080p recipe sold at the 720p price rendered at 1080p
 * (10 s 4:3: 7,972원 of provider cost against a 6,800원 sale).
 *
 * One function decides it for the render AND the quote, so the two cannot drift again: the price of
 * a resolution is the cost of `recipeAtResolution(recipe, thatResolution)`.
 *
 * Only the film a buyer receives moves. An intermediate film (a clip another step reads) keeps the
 * resolution its creative chose — it is an ingredient, not the product.
 */

export const FILM_RESOLUTIONS = ['720p', '1080p'] as const;
export type FilmResolution = (typeof FILM_RESOLUTIONS)[number];

export function isFilmResolution(value: unknown): value is FilmResolution {
  return typeof value === 'string' && (FILM_RESOLUTIONS as readonly string[]).includes(value);
}

type FilmStep = Extract<RecipeStep, { kind: 'video' }>;

/** The film step(s) the buyer receives. Empty for an image template or a carousel. */
function outputFilms(recipe: Recipe): FilmStep[] {
  const shown = new Set(outputSteps(recipe));
  return recipe.steps.filter((step): step is FilmStep => step.kind === 'video' && shown.has(step.id));
}

function engineResolutions(step: FilmStep): FilmResolution[] {
  if (!isVideoEngine(step.engine)) return [];
  const { model } = videoModelForEngine(step.engine, step.params.duration);
  const supported = videoResolutions(model) as readonly string[];
  return FILM_RESOLUTIONS.filter((resolution) => supported.includes(resolution));
}

/** The resolutions this recipe's film can be made at, 720p first. Empty when it makes no film. */
export function recipeResolutions(recipe: Recipe): FilmResolution[] {
  const films = outputFilms(recipe);
  if (films.length === 0) return [];
  return FILM_RESOLUTIONS.filter((resolution) => films.every((film) => engineResolutions(film).includes(resolution)));
}

/** The resolution the creative wrote the film at (test and review renders use it). */
export function authoredResolution(recipe: Recipe): FilmResolution | null {
  return outputFilms(recipe)[0]?.params.resolution ?? null;
}

/**
 * The recipe as it runs for an order at `resolution`. No resolution (an image, a legacy row, a test
 * render carrying the recipe's own value) or one the engine cannot make leaves the recipe as it is:
 * a value the engine refuses is the order step's job to reject, never this function's to guess.
 */
export function recipeAtResolution(recipe: Recipe, resolution: string | null | undefined): Recipe {
  if (!isFilmResolution(resolution)) return recipe;
  if (!recipeResolutions(recipe).includes(resolution)) return recipe;
  const films = new Set(outputFilms(recipe).map((film) => film.id));
  if (recipe.steps.every((step) => !films.has(step.id) || (step.kind === 'video' && step.params.resolution === resolution))) return recipe;
  return {
    ...recipe,
    steps: recipe.steps.map((step) =>
      step.kind === 'video' && films.has(step.id) ? { ...step, params: { ...step.params, resolution } } : step),
  };
}
