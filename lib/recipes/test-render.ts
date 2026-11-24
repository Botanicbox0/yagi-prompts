import { parseRecipe, type Recipe } from './schema';

/**
 * Founder decision 2026-11-24 (docs/PERSONAL-STUDIO.md §0.2): video has no free test and no free
 * re-make. Whatever is generated is charged to whoever asked, and the company never pays for a
 * generation nobody paid for.
 *
 * A creative's test render and the studio's review render are not orders: no buyer pays for them
 * (the image cost is the company's, an open founder decision — docs/PERSONAL-STUDIO.md §12). So they
 * run the recipe's IMAGE steps only. Video is made when a buyer pays for the template.
 *
 *   image            unchanged
 *   carousel         unchanged (images only)
 *   image → video    the image step alone; the film is skipped
 *   video            not testable: no image step to run
 *
 * The trimmed recipe must pass the same rules the render pass re-checks on the stored snapshot
 * (lib/recipes/repo.ts `loadJobRecipe`, studio mode). When it does not — an image step that never
 * reads the buyer's photo, say — there is nothing face-bearing to test without the film, and the
 * recipe is treated like a video-only one.
 *
 * Every caller that writes an unpaid recipe job goes through this (tests/recipes/money-rule.test.ts).
 */

export type ImageTestPlan =
  | { ok: true; recipe: Recipe; skipped: string[] }
  | { ok: false; code: 'video_test_unavailable'; skipped: string[] };

export function imageTestRecipe(recipe: Recipe): ImageTestPlan {
  const skipped = recipe.steps.filter((step) => step.kind === 'video').map((step) => step.id);
  const steps = recipe.steps.filter((step) => step.kind === 'image');
  if (!steps.length) return { ok: false, code: 'video_test_unavailable', skipped };
  if (!skipped.length) return { ok: true, recipe, skipped };
  // A single-output recipe is "image" or "image → video" (parseRecipe's layout rule), so the last
  // image step is the result. Slots only the film read go with it.
  const read = new Set(steps.flatMap((step) => step.inputs));
  const trimmed = {
    ...recipe,
    slots: Object.fromEntries(Object.entries(recipe.slots).filter(([name]) => read.has(name))),
    steps,
    output: { from: steps[steps.length - 1]!.id },
  };
  const checked = parseRecipe(trimmed, { studio: true });
  if (!checked.ok || checked.recipe.steps.some((step) => step.kind !== 'image')) return { ok: false, code: 'video_test_unavailable', skipped };
  return { ok: true, recipe: checked.recipe, skipped };
}
