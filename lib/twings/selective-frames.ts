import { estimateImageUsd, isImageEngine, resolveEngine } from '@/lib/images/engines';
import type { PromptRow } from '@/lib/prompts/repo';
import { outputSteps, type Recipe } from '@/lib/recipes/schema';
import { chargeKrwFor, type CreatorResolution } from './resolution';
import {
  RAISE_MAX_KRW,
  RAISE_STEP_KRW,
  baseKrw,
  quoteSelectiveImageSet,
} from './template-price';

export interface TemplateImageSetPricingMeta {
  totalFrames: number;
  perFrameProviderUsd: number;
  royaltyKrw: number;
}

/**
 * Parses CSV ("0,2,4") or JSON array ("[0, 2, 4]") of 0-based selected frame indices.
 * Returns null when absent, invalid, or when every frame 0..totalFrames-1 is selected.
 */
export function parseSelectedFrames(raw: unknown, totalFrames?: number): number[] | null {
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        return null;
      }
    } else {
      items = trimmed.split(',');
    }
  } else {
    return null;
  }

  const maxBound = typeof totalFrames === 'number' && totalFrames > 0 ? totalFrames : 10;
  const normalized = Array.from(
    new Set(
      items
        .map((v) => (typeof v === 'number' ? v : Number(String(v).trim())))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < maxBound),
    ),
  ).sort((a, b) => a - b);

  if (normalized.length === 0) return null;
  if (typeof totalFrames === 'number' && totalFrames > 0 && normalized.length >= totalFrames) {
    return null;
  }
  return normalized;
}

function galleryFrameCount(media: unknown): number {
  if (!media || typeof media !== 'object') return 0;
  const gallery = (media as { gallery?: unknown }).gallery;
  return Array.isArray(gallery) ? gallery.length : 0;
}

export function templateImageSetInfo(
  template: Pick<PromptRow, 'medium' | 'engine' | 'priceKrw'> & {
    media?: unknown;
    gallery?: ReadonlyArray<unknown> | null;
  },
  recipe: Recipe | null,
): TemplateImageSetPricingMeta {
  if (template.medium !== 'image') {
    return { totalFrames: 1, perFrameProviderUsd: 0.09, royaltyKrw: 0 };
  }

  const recipeFrames = recipe && 'frames' in recipe.output ? recipe.output.frames.length : 0;
  const mediaFrames =
    template.media !== undefined
      ? galleryFrameCount(template.media)
      : Array.isArray(template.gallery)
        ? template.gallery.length
        : 0;
  const totalFrames = Math.max(1, Math.min(10, recipeFrames > 1 ? recipeFrames : mediaFrames > 1 ? mediaFrames : 1));

  const outputFrames = recipe && 'frames' in recipe.output ? recipe.output.frames : null;
  const firstFrameStep =
    recipe && outputFrames && outputFrames.length > 0
      ? recipe.steps.find((s) => s.id === outputFrames[0])
      : recipe?.steps[0];
  const engine = firstFrameStep?.engine ?? resolveEngine(template.engine, template.medium);
  const perFrameProviderUsd = isImageEngine(engine) ? estimateImageUsd(engine, 1) : 0.09;

  const fullProviderUsd = Math.round(perFrameProviderUsd * totalFrames * 10000) / 10000;
  const fullFloorKrw = baseKrw({ medium: 'image', providerUsd: fullProviderUsd });
  const rawRaise =
    template.priceKrw > fullFloorKrw
      ? Math.round((template.priceKrw - fullFloorKrw) / RAISE_STEP_KRW) * RAISE_STEP_KRW
      : 0;
  const royaltyKrw = Math.max(0, Math.min(RAISE_MAX_KRW, rawRaise));

  return { totalFrames, perFrameProviderUsd, royaltyKrw };
}

/**
 * Authoritative server-side KRW price computation used identically by createTossOrder and confirmTossOrder.
 * Ensures partial frame selection (`selected_frames` != null) uses consistent KRW math and matches UI quotes.
 */
export function selectiveOrderKrw(
  template: Pick<
    PromptRow,
    'medium' | 'engine' | 'media' | 'runtimeSeconds' | 'priceCents' | 'priceKrw' | 'price1080Cents' | 'price1080Krw'
  >,
  recipe: Recipe | null,
  selectedFrames: readonly number[] | null | undefined,
  resolution: CreatorResolution | null,
): { amountKrw: number | null; normalizedFrames: number[] | null } {
  const fullKrw = chargeKrwFor(template, resolution);
  if (fullKrw === null || template.medium !== 'image') {
    return { amountKrw: fullKrw, normalizedFrames: null };
  }

  const meta = templateImageSetInfo(template, recipe);
  if (meta.totalFrames <= 1) {
    return { amountKrw: fullKrw, normalizedFrames: null };
  }

  const normalized = parseSelectedFrames(selectedFrames ?? [], meta.totalFrames);
  if (!normalized || normalized.length === 0 || normalized.length >= meta.totalFrames) {
    return { amountKrw: fullKrw, normalizedFrames: null };
  }

  const quote = quoteSelectiveImageSet({
    perFrameProviderUsd: meta.perFrameProviderUsd,
    totalFrames: meta.totalFrames,
    selectedFrameIndices: normalized,
    royaltyKrw: meta.royaltyKrw,
  });

  // Never let a partial subset exceed the template's published full-set list price.
  const amountKrw = Math.max(200, Math.min(fullKrw, quote.totalKrw));
  return { amountKrw, normalizedFrames: normalized };
}

/**
 * Slices a multi-frame carousel recipe so only the user-selected frame indices (and their transitive inputs) run.
 * If all frames or invalid selection is provided, returns the original recipe untouched.
 */
export function sliceCarouselRecipe(
  recipe: Recipe,
  selectedFrames: readonly number[] | null | undefined,
): Recipe {
  if (!('frames' in recipe.output) || !selectedFrames?.length) return recipe;
  const frames = outputSteps(recipe);
  const pickedIndices = Array.from(
    new Set(selectedFrames.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < frames.length)),
  ).sort((a, b) => a - b);

  if (pickedIndices.length === 0 || pickedIndices.length >= frames.length) {
    return recipe;
  }

  const chosenOutputs = pickedIndices.map((idx) => frames[idx]!);
  const requiredIds = new Set<string>(chosenOutputs);
  for (let i = recipe.steps.length - 1; i >= 0; i -= 1) {
    const step = recipe.steps[i]!;
    if (requiredIds.has(step.id)) {
      for (const inp of step.inputs) {
        if (recipe.steps.some((s) => s.id === inp)) {
          requiredIds.add(inp);
        }
      }
    }
  }

  const filteredSteps = recipe.steps.filter((s) => requiredIds.has(s.id));
  if (filteredSteps.length === 0) return recipe;

  return {
    ...recipe,
    steps: filteredSteps,
    output: chosenOutputs.length === 1 ? { from: chosenOutputs[0]! } : { frames: chosenOutputs },
  };
}
