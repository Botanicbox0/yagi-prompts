'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import type { PublicRecipe } from '@/lib/recipes/public';
import { CopyPrompt } from './copy-prompt';
import { useRecipeAccess } from './recipe-access-context';

export type RecipeActionLabels = Dictionary['makerRecipe']['actions'] & { copied: string };

export interface RecipeActionsProps {
  /** How many steps the page discloses — a count only: the prompt itself never rides in the HTML. */
  steps: number;
  labels: RecipeActionLabels;
  /** `#make` when the template is for sale; null hides the make button. */
  makeHref: string | null;
  shopOpen: boolean;
  /** The same per-viewer call "만드는 법" makes: a signed-in viewer gets the full recipe there. */
  accessEndpoint: string;
  signinHref: string;
  /** Present when the template's studio prompt is explicitly public (`text_visibility = 'public'`), so visitors copy without signing in. */
  initialUnlocked?: PublicRecipe | null;
}

// Both quiet: the page's one blue button is the make card's (docs/design/IDENTITY.md §4, TASTE rule 1).
const PRIMARY = 'audience-button-quiet min-h-11 px-4 text-sm';
const SECONDARY = PRIMARY;

/**
 * The template page's first-screen fork for a template whose recipe is public (2026-10-29, founder):
 * someone who came from the creative's post either copies the prompt or makes it with a selfie, both
 * one tap from the title. The full prompt is for signed-in members ("만드는 법" gate), so a member
 * copies it right here, and a visitor's one tap is the free sign-up that comes back to it. The make
 * button goes to the make card (`#make`), which says itself whether making is open.
 */
export function RecipeActionsView({ steps, labels: a, makeHref, shopOpen, signinHref, unlocked }: Omit<RecipeActionsProps, 'accessEndpoint'> & { unlocked: PublicRecipe | null }) {
  if (steps < 1) return null;
  const only = unlocked?.steps?.length === 1 ? unlocked.steps[0]! : null;
  return <section data-template-recipe-actions data-recipe-unlocked={unlocked ? 'true' : undefined} aria-label={a.label} className="mt-5 rounded-3xl border border-hairline bg-white p-4 sm:p-5">
    <p className="font-label text-eyebrow uppercase"><span className="text-accent">{a.label}</span></p>
    <p className="mt-2 text-sm leading-relaxed text-black/80">{makeHref && shopOpen ? a.body : a.bodyClosed}</p>
    <div className="mt-3.5 flex flex-wrap gap-2">
      {only
        ? <CopyPrompt text={only.prompt} label={a.copy} done={a.copied} className={PRIMARY} />
        : unlocked
          ? <a href="#recipe" data-recipe-jump className={PRIMARY}>{a.full}</a>
          : <a href={signinHref} data-recipe-signin className={PRIMARY}>{a.copySignedOut}</a>}
      {makeHref && <a href={makeHref} data-recipe-make className={SECONDARY}>{shopOpen ? a.make : a.makeClosed}</a>}
    </div>
    <a href="#recipe" data-recipe-jump className="mt-3 inline-flex min-h-9 items-center text-xs font-medium text-black/70 underline underline-offset-4">{unlocked ? a.full : a.preview} ↓</a>
  </section>;
}

export function RecipeActions({ accessEndpoint, initialUnlocked = null, ...props }: RecipeActionsProps) {
  const shared = useRecipeAccess();
  const [standaloneUnlocked, setStandaloneUnlocked] = useState<PublicRecipe | null>(initialUnlocked);
  useEffect(() => {
    if (initialUnlocked || shared !== null) return;
    let cancelled = false;
    fetch(accessEndpoint, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { signedIn?: boolean; recipe?: PublicRecipe | null } | null) => {
        if (!cancelled && data?.signedIn && data.recipe?.steps?.length) setStandaloneUnlocked(data.recipe);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessEndpoint, initialUnlocked, shared]);
  const unlocked = initialUnlocked ?? (shared !== null ? (shared.unlockedRecipe?.steps?.length ? shared.unlockedRecipe : null) : standaloneUnlocked);
  return <RecipeActionsView {...props} unlocked={unlocked} />;
}
