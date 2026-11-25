'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import type { PublicRecipe } from '@/lib/recipes/public';
import { ClipCard, isFoldablePrompt } from './clip-card';
import { ClipIndex, CLIP_INDEX_MIN, useActiveClip } from './clip-index';
import { useRecipeAccess } from './recipe-access-context';
import { ReferenceFiles } from './reference-files';

export interface RecipeGateProps {
  accessEndpoint: string;
  signinHref: string;
}

/** The two layouts: its own section under the stage, or the column beside it (story-first, 2026-10-29). */
function layout(compact: boolean) {
  return compact
    ? { section: 'mt-7 border-t border-hairline pt-6', heading: 'font-display text-[1.35rem] leading-none font-black uppercase', list: 'mt-4 space-y-4', gate: 'mt-4 rounded-[16px] border border-hairline bg-white p-4', intro: 'text-sm', outro: 'mt-4' }
    : { section: 'mt-16 border-t border-hairline pt-10', heading: 'font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase', list: 'mt-6 space-y-5', gate: 'mt-6 rounded-[16px] border border-hairline bg-white p-5 sm:p-6', intro: 'text-[0.95rem]', outro: 'mt-6' };
}

/** The creative's intro (§20.3, public) in place of the generic lede, when they wrote one. */
function Lede({ intro, copy, compact }: { intro: string | null; copy: Dictionary['makerRecipe']; compact: boolean }) {
  return intro
    ? <p data-recipe-intro className={`mt-3 max-w-detail leading-relaxed whitespace-pre-line text-black/80 ${layout(compact).intro}`}>{intro}</p>
    : <p className="mt-3 max-w-detail text-sm leading-relaxed text-black/70">{copy.how.lede}</p>;
}

function ClipsJumpLink({ href, count, template }: { href: string; count: number; template: string }) {
  return (
    <p className="mt-4">
      <a
        href={href}
        data-recipe-clips-link
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[#09090B] underline decoration-[#09090B]/30 underline-offset-4 transition-colors hover:decoration-[#09090B]"
      >
        {interpolate(template, { n: String(count) })} ↓
      </a>
    </p>
  );
}

function UnlockedRecipeBody({
  recipe,
  copy,
  compact = false,
  clipsHref,
}: {
  recipe: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  compact?: boolean;
  clipsHref?: string;
}) {
  const h = copy.how;
  const css = layout(compact);
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  const stepList = recipe.steps ?? [];
  const inlineGuide = !clipsHref && recipe.guide?.length ? recipe.guide : [];
  const foldableKeys = [
    ...stepList.filter((step) => isFoldablePrompt(step.prompt)).map((step) => `step-${step.n}`),
    ...inlineGuide.filter((item) => isFoldablePrompt(item.prompt)).map((item) => `guide-${item.n}`),
  ];
  const allExpanded = foldableKeys.length > 0 && foldableKeys.every((key) => openKeys.has(key));
  const totalCards = stepList.length + inlineGuide.length;

  const toggleKey = (key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setOpenKeys(allExpanded ? new Set() : new Set(foldableKeys));
  };

  const cardLabels = {
    tipHeading: h.tipHeading,
    expand: h.expand,
    collapse: h.collapse,
    copy: h.copy,
    copied: h.copied,
  };

  const inlineGuideItems = inlineGuide.map((item) => ({ id: `guide-clip-${item.n}`, n: item.n, title: item.title }));
  const { activeId, jumpTo } = useActiveClip(inlineGuideItems.map((item) => item.id));

  return (
    <>
      {totalCards > 1 && foldableKeys.length > 0 ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-recipe-toggle-all
            aria-pressed={allExpanded}
            onClick={toggleAll}
            className="audience-button-quiet min-h-9 px-3.5 text-xs"
          >
            {allExpanded ? h.collapseAll : h.expandAll}
          </button>
        </div>
      ) : null}

      {stepList.length > 0 ? (
        <ol className={css.list}>
          {stepList.map((step) => {
            const key = `step-${step.n}`;
            return (
              <ClipCard
                key={step.n}
                number={step.n}
                showNumber={false}
                title={interpolate(h.step, {
                  n: String(step.n),
                  kind: step.kind === 'image' ? copy.stepImage : copy.stepVideo,
                })}
                note={step.note}
                noteMarker="step"
                prompt={step.prompt}
                labels={cardLabels}
                compact={compact}
                expanded={openKeys.has(key)}
                onToggle={() => toggleKey(key)}
                itemAttr={{ 'data-recipe-how-step': step.n }}
              />
            );
          })}
        </ol>
      ) : null}

      {recipe.guide?.length ? (
        clipsHref ? (
          <ClipsJumpLink href={clipsHref} count={recipe.guide.length} template={h.clipsJump} />
        ) : (
          <div data-recipe-guide className="mt-7 border-t border-hairline pt-6">
            <h3 className="text-sm font-semibold text-black/90">{h.guideHeading}</h3>
            <p className="mt-1 text-xs leading-relaxed text-black/65">{h.guideLede}</p>
            {inlineGuideItems.length >= CLIP_INDEX_MIN ? (
              <ClipIndex
                items={inlineGuideItems}
                activeId={activeId}
                onSelect={jumpTo}
                label={h.clipIndexLabel}
                variant="chips"
              />
            ) : null}
            <ol className={`${css.list} mt-4`}>
              {inlineGuide.map((item) => {
                const key = `guide-${item.n}`;
                return (
                  <ClipCard
                    key={item.n}
                    id={`guide-clip-${item.n}`}
                    number={item.n}
                    title={item.title}
                    meta={item.meta}
                    note={item.note}
                    noteMarker="guide"
                    prompt={item.prompt}
                    labels={cardLabels}
                    compact={compact}
                    expanded={openKeys.has(key)}
                    onToggle={() => toggleKey(key)}
                    itemAttr={{ 'data-recipe-guide-step': item.n }}
                  />
                );
              })}
            </ol>
          </div>
        )
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
  clipsHref,
}: {
  teaser: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  gate: RecipeGateProps;
  compact: boolean;
  clipsHref?: string;
}) {
  const shared = useRecipeAccess();
  const [standaloneUnlocked, setStandaloneUnlocked] = useState<PublicRecipe | null>(null);

  useEffect(() => {
    if (shared !== null) return;
    let cancelled = false;
    fetch(gate.accessEndpoint, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { signedIn?: boolean; recipe?: PublicRecipe | null } | null) => {
        if (cancelled || !data?.signedIn || !data.recipe) return;
        setStandaloneUnlocked(data.recipe);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shared, gate.accessEndpoint]);

  const unlockedRecipe = shared !== null ? shared.unlockedRecipe : standaloneUnlocked;
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
        <>
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
              className="audience-button-quiet mt-4 min-h-11 text-sm"
            >
              {h.gateCta}
            </a>
          </div>
          {clipsHref && teaser.guideOutline?.length ? (
            <ClipsJumpLink href={clipsHref} count={teaser.guideOutline.length} template={h.clipsJump} />
          ) : null}
        </>
      ) : (
        <UnlockedRecipeBody recipe={active} copy={copy} compact={compact} clipsHref={clipsHref} />
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
 * When `clipsHref` is given, `guide` cards render in the separate full-width `#clips` section and
 * this block leaves a single-line jump link in their place.
 */
export function HowItWasMade({
  recipe,
  copy,
  gate,
  compact = false,
  clipsHref,
}: {
  recipe: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  gate?: RecipeGateProps;
  compact?: boolean;
  clipsHref?: string;
}) {
  if (!recipe.steps && !recipe.files?.length) return null;
  if (gate) return <GatedHowItWasMade teaser={recipe} copy={copy} gate={gate} compact={compact} clipsHref={clipsHref} />;
  const h = copy.how;
  const css = layout(compact);
  return (
    <section data-recipe-how data-presentation={recipe.presentation} className={css.section}>
      <h2 className={css.heading}>{h.heading}</h2>
      <Lede intro={recipe.intro} copy={copy} compact={compact} />
      <UnlockedRecipeBody recipe={recipe} copy={copy} compact={compact} clipsHref={clipsHref} />
    </section>
  );
}
