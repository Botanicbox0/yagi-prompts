import type { Dictionary } from '@/messages/en';
import type { PublicRecipe } from '@/lib/recipes/public';
import { CopyPrompt } from './copy-prompt';

/**
 * The template page's first-screen fork for a template whose recipe is public (2026-10-29, founder):
 * someone who came from the creative's post either copies the prompt or makes it with a selfie, and
 * both are one tap from the title. One step copies right here; a longer recipe jumps to "만드는 법"
 * (`#recipe`). The make button goes to the make card (`#make`), which says itself whether making is
 * open or takes an opening alert. Renders nothing when the recipe shows no prompt.
 */
export function RecipeActions({ recipe, copy, makeHref, shopOpen }: {
  recipe: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  /** `#make` when the template is for sale; null hides the make button. */
  makeHref: string | null;
  shopOpen: boolean;
}) {
  if (!recipe.steps?.length) return null;
  const a = copy.actions;
  const only = recipe.steps.length === 1 ? recipe.steps[0]! : null;
  const primary = 'inline-flex min-h-11 items-center justify-center rounded-full bg-black px-4 text-sm font-semibold text-white';
  const secondary = 'inline-flex min-h-11 items-center justify-center rounded-full border border-black/80 px-4 text-sm font-semibold';
  return <section data-template-recipe-actions aria-label={a.label} className="mt-5 rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
    <p className="font-label text-eyebrow uppercase"><span className="text-accent">{a.label}</span></p>
    <p className="mt-2 text-sm leading-relaxed text-black/80">{makeHref && shopOpen ? a.body : a.bodyClosed}</p>
    <div className="mt-3.5 flex flex-wrap gap-2">
      {only
        ? <CopyPrompt text={only.prompt} label={a.copy} done={copy.how.copied} className={primary} />
        : <a href="#recipe" data-recipe-jump className={primary}>{a.full}</a>}
      {makeHref && <a href={makeHref} data-recipe-make className={secondary}>{shopOpen ? a.make : a.makeClosed}</a>}
    </div>
    {only && <a href="#recipe" data-recipe-jump className="mt-3 inline-flex min-h-9 items-center text-xs font-medium text-black/70 underline underline-offset-4">{a.full} ↓</a>}
  </section>;
}
