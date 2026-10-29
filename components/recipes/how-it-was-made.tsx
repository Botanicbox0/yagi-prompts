'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import type { PublicRecipe } from '@/lib/recipes/public';
import { CopyPrompt } from './copy-prompt';
import { ReferenceFiles } from './reference-files';

export interface RecipeGateProps {
  accessEndpoint: string;
  signinHref: string;
}

function UnlockedRecipeBody({ recipe, copy }: { recipe: PublicRecipe; copy: Dictionary['makerRecipe'] }) {
  const h = copy.how;
  return (
    <>
      {recipe.steps ? (
        <ol className="mt-6 space-y-5">
          {recipe.steps.map((step) => (
            <li key={step.n} data-recipe-how-step={step.n} className="rounded-2xl border border-hairline p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold">
                  {interpolate(h.step, {
                    n: String(step.n),
                    kind: step.kind === 'image' ? copy.stepImage : copy.stepVideo,
                  })}
                </p>
                <CopyPrompt text={step.prompt} label={h.copy} done={h.copied} />
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-black/80">{step.prompt}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {recipe.files?.length ? (
        <div className="mt-6">
          <p className="text-sm font-semibold">{h.assets}</p>
          <ReferenceFiles files={recipe.files} copy={copy} />
        </div>
      ) : null}
    </>
  );
}

function GatedHowItWasMade({
  teaser,
  copy,
  gate,
}: {
  teaser: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  gate: RecipeGateProps;
}) {
  const [unlockedRecipe, setUnlockedRecipe] = useState<PublicRecipe | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(gate.accessEndpoint, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { signedIn?: boolean; recipe?: PublicRecipe | null } | null) => {
        if (cancelled || !data?.signedIn || !data.recipe) return;
        setUnlockedRecipe(data.recipe);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gate.accessEndpoint]);

  const active = unlockedRecipe ?? teaser;
  const h = copy.how;
  const isLocked = !unlockedRecipe;

  return (
    <section
      id="how"
      data-recipe-how
      data-recipe-locked={isLocked ? 'true' : undefined}
      data-presentation={active.presentation}
      className="mt-16 border-t border-hairline pt-10"
    >
      <h2 className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{h.heading}</h2>
      <p className="mt-3 max-w-detail text-sm leading-relaxed text-black/70">{h.lede}</p>
      {isLocked ? (
        <div data-recipe-gate className="mt-6 rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
          {teaser.steps?.[0] ? (
            <div className="mb-5 rounded-xl border border-hairline bg-white/70 p-4">
              <p className="text-xs font-semibold text-black/65">
                {interpolate(h.step, {
                  n: String(teaser.steps[0].n),
                  kind: teaser.steps[0].kind === 'image' ? copy.stepImage : copy.stepVideo,
                })}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-black/75">
                {teaser.steps[0].prompt}
              </p>
              <div
                aria-hidden="true"
                className="mt-2 select-none rounded-lg bg-black/[0.04] px-3 py-2.5 font-mono text-xs text-black/35 blur-[4px]"
              >
                [Shot Breakdown · Camera & Lens · Lighting · Live Ambience · Reference Assets Locked]
              </div>
            </div>
          ) : null}
          <p className="text-base font-semibold text-black/90">{h.gateTitle}</p>
          <p className="mt-1.5 max-w-detail text-sm leading-relaxed text-black/70">{h.gateBody}</p>
          <a
            data-recipe-gate-cta
            href={gate.signinHref}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-black px-5 py-2.5 text-xs font-semibold tracking-wide text-white transition-opacity hover:opacity-85"
          >
            {h.gateCta}
          </a>
        </div>
      ) : (
        <UnlockedRecipeBody recipe={active} copy={copy} />
      )}
    </section>
  );
}

/**
 * "만드는 법" on a maker template's page (docs/PLATFORM-2.0.md §7.3) — the steps' prompts with
 * `[내 사진]` in place of the customer's photo, and the maker's reference files, each only when the
 * maker chose to show it. Renders nothing when neither was chosen: no heading, no empty section.
 */
export function HowItWasMade({
  recipe,
  copy,
  gate,
}: {
  recipe: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  gate?: RecipeGateProps;
}) {
  if (!recipe.steps && !recipe.files?.length) return null;
  if (gate) return <GatedHowItWasMade teaser={recipe} copy={copy} gate={gate} />;
  const h = copy.how;
  return (
    <section data-recipe-how data-presentation={recipe.presentation} className="mt-16 border-t border-hairline pt-10">
      <h2 className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{h.heading}</h2>
      <p className="mt-3 max-w-detail text-sm leading-relaxed text-black/70">{h.lede}</p>
      <UnlockedRecipeBody recipe={recipe} copy={copy} />
    </section>
  );
}
