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

/** A long prompt in the template page's column starts folded: the copy button already holds all of it. */
const FOLD_CHARS = 600;

/** The two layouts: its own section under the stage, or the column beside it (story-first, 2026-10-29). */
function layout(compact: boolean) {
  return compact
    ? { section: 'mt-7 border-t border-hairline pt-6', heading: 'font-display text-[1.35rem] leading-none font-black uppercase', list: 'mt-4 space-y-4', step: 'rounded-2xl border border-hairline p-4', gate: 'mt-4 rounded-2xl border border-hairline bg-surface p-4', intro: 'text-sm', note: 'mt-3', outro: 'mt-4' }
    : { section: 'mt-16 border-t border-hairline pt-10', heading: 'font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase', list: 'mt-6 space-y-5', step: 'rounded-2xl border border-hairline p-5', gate: 'mt-6 rounded-2xl border border-hairline bg-surface p-5 sm:p-6', intro: 'text-[0.95rem]', note: 'mt-4', outro: 'mt-6' };
}

/** The creative's intro (§20.3, public) in place of the generic lede, when they wrote one. */
function Lede({ intro, copy, compact }: { intro: string | null; copy: Dictionary['makerRecipe']; compact: boolean }) {
  return intro
    ? <p data-recipe-intro className={`mt-3 max-w-detail leading-relaxed whitespace-pre-line text-black/80 ${layout(compact).intro}`}>{intro}</p>
    : <p className="mt-3 max-w-detail text-sm leading-relaxed text-black/70">{copy.how.lede}</p>;
}

function StepPrompt({ text, fold, copy }: { text: string; fold: boolean; copy: Dictionary['makerRecipe']['how'] }) {
  const [open, setOpen] = useState(false);
  const folded = fold && text.length > FOLD_CHARS && !open;
  return (
    <>
      <div className="relative mt-3">
        <p data-recipe-prompt={folded ? 'folded' : undefined} className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-black/80 ${folded ? 'max-h-56 overflow-hidden' : ''}`}>{text}</p>
        {folded && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />}
      </div>
      {fold && text.length > FOLD_CHARS && (
        <button type="button" data-recipe-expand aria-expanded={open} onClick={() => setOpen((value) => !value)} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
          {open ? copy.collapse : copy.expand}
        </button>
      )}
    </>
  );
}

function UnlockedRecipeBody({ recipe, copy, compact = false }: { recipe: PublicRecipe; copy: Dictionary['makerRecipe']; compact?: boolean }) {
  const h = copy.how;
  const css = layout(compact);
  return (
    <>
      {recipe.steps ? (
        <ol className={css.list}>
          {recipe.steps.map((step) => (
            <li key={step.n} data-recipe-how-step={step.n} className={css.step}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold">
                  {interpolate(h.step, {
                    n: String(step.n),
                    kind: step.kind === 'image' ? copy.stepImage : copy.stepVideo,
                  })}
                </p>
                <CopyPrompt text={step.prompt} label={h.copy} done={h.copied} />
              </div>
              <StepPrompt text={step.prompt} fold={compact} copy={h} />
              {step.note ? <p data-recipe-note className={`${css.note} rounded-xl bg-black/[0.035] px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-black/80`}>{step.note}</p> : null}
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
      {recipe.outro ? <p data-recipe-outro className={`${css.outro} max-w-detail text-sm leading-relaxed whitespace-pre-line text-black/75`}>{recipe.outro}</p> : null}
    </>
  );
}

function GatedHowItWasMade({
  teaser,
  copy,
  gate,
  compact,
}: {
  teaser: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  gate: RecipeGateProps;
  compact: boolean;
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
  const css = layout(compact);

  return (
    <section
      id="how"
      data-recipe-how
      data-recipe-locked={isLocked ? 'true' : undefined}
      data-presentation={active.presentation}
      className={css.section}
    >
      <h2 className={css.heading}>{h.heading}</h2>
      <Lede intro={active.intro} copy={copy} compact={compact} />
      {isLocked ? (
        <div data-recipe-gate className={css.gate}>
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
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-accent px-5 py-2.5 text-xs font-semibold tracking-wide text-white transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_82%,#000000)] active:bg-[color-mix(in_srgb,var(--accent)_66%,#000000)]"
          >
            {h.gateCta}
          </a>
        </div>
      ) : (
        <UnlockedRecipeBody recipe={active} copy={copy} compact={compact} />
      )}
    </section>
  );
}

/**
 * "만드는 법" on a maker template's page (docs/PLATFORM-2.0.md §7.3·§20.3) — the steps' prompts with
 * `[내 사진]` in place of the customer's photo, the creative's tips, and their reference files, each
 * only when the creative chose to show it. Renders nothing when neither was chosen: no heading, no
 * empty section. With `gate`, `recipe` is the teaser (lib/recipes/public.ts `recipeTeaser`) and the
 * rest arrives from the access endpoint for a signed-in member — the page's only recipe gate.
 * `compact` is the column beside the stage (a story-first template, 2026-10-29): tighter, and a long
 * prompt folds so the make box under it stays a short scroll away.
 */
export function HowItWasMade({
  recipe,
  copy,
  gate,
  compact = false,
}: {
  recipe: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  gate?: RecipeGateProps;
  compact?: boolean;
}) {
  if (!recipe.steps && !recipe.files?.length) return null;
  if (gate) return <GatedHowItWasMade teaser={recipe} copy={copy} gate={gate} compact={compact} />;
  const h = copy.how;
  const css = layout(compact);
  return (
    <section data-recipe-how data-presentation={recipe.presentation} className={css.section}>
      <h2 className={css.heading}>{h.heading}</h2>
      <Lede intro={recipe.intro} copy={copy} compact={compact} />
      <UnlockedRecipeBody recipe={recipe} copy={copy} compact={compact} />
    </section>
  );
}
