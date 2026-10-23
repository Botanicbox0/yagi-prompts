import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import type { PublicRecipe } from '@/lib/recipes/public';
import { CopyPrompt } from './copy-prompt';

/**
 * "만드는 법" on a maker template's page (docs/PLATFORM-2.0.md §7.3) — the steps' prompts with
 * `[내 사진]` in place of the customer's photo, and the maker's reference files, each only when the
 * maker chose to show it. Renders nothing when neither was chosen: no heading, no empty section.
 */
export function HowItWasMade({ recipe, copy }: { recipe: PublicRecipe; copy: Dictionary['makerRecipe'] }) {
  if (!recipe.steps && !recipe.files?.length) return null;
  const h = copy.how;
  return <section data-recipe-how data-presentation={recipe.presentation} className="mt-16 border-t border-hairline pt-10">
    <h2 className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{h.heading}</h2>
    <p className="mt-3 max-w-detail text-sm leading-relaxed text-black/70">{h.lede}</p>
    {recipe.steps ? <ol className="mt-6 space-y-5">{recipe.steps.map((step) => <li key={step.n} data-recipe-how-step={step.n} className="rounded-2xl border border-hairline p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{interpolate(h.step, { n: String(step.n), kind: step.kind === 'image' ? copy.stepImage : copy.stepVideo })}</p>
        <CopyPrompt text={step.prompt} label={h.copy} done={h.copied} />
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-black/80">{step.prompt}</p>
    </li>)}</ol> : null}
    {recipe.files?.length ? <div className="mt-6">
      <p className="text-sm font-semibold">{h.assets}</p>
      <ul data-recipe-how-files className="mt-3 flex flex-wrap gap-3">{recipe.files.map((file, i) => <li key={file.href}>
        {file.kind === 'image'
          ? <img src={file.href} alt={interpolate(copy.referenceLabel, { n: String(i + 1) })} loading="lazy" className="h-28 w-28 rounded-xl border border-hairline object-cover" />
          : <video src={file.href} aria-label={interpolate(copy.referenceLabel, { n: String(i + 1) })} muted playsInline preload="none" controls className="h-28 w-28 rounded-xl border border-hairline object-cover" />}
      </li>)}</ul>
    </div> : null}
  </section>;
}
