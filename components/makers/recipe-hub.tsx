import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';

/**
 * A maker page's line for followers who arrive from the maker's post (2026-10-29, founder): this is
 * their own page, and it gives away the prompts behind their posts. Shown only while at least one of
 * their published templates actually shows its prompt — the claim follows the data.
 */
export function MakerRecipeHub({ handle, openRecipes, copy }: { handle: string; openRecipes: number; copy: Dictionary['makers'] }) {
  if (openRecipes < 1) return null;
  return <div data-maker-recipe-hub className="mt-6 max-w-2xl rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
    <p className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-black px-2.5 py-1 font-semibold text-white">{copy.recipeBadge}</span>
      <span data-maker-recipe-count className="font-medium text-black/70">{interpolate(copy.recipeCount, { count: String(openRecipes) })}</span>
    </p>
    <p className="mt-2.5 text-sm leading-relaxed text-black/80">{interpolate(copy.recipeLine, { handle })}</p>
  </div>;
}
