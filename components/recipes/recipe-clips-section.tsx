'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import type { PublicRecipe } from '@/lib/recipes/public';
import { ClipCard, isFoldablePrompt } from './clip-card';
import { ClipIndex, CLIP_INDEX_MIN, useActiveClip, type ClipIndexItem } from './clip-index';
import { useRecipeAccess } from './recipe-access-context';
import type { RecipeGateProps } from './how-it-was-made';

/**
 * Full-width clip breakdown section (`id="clips"`, `data-recipe-clips`) placed directly under the stage
 * (or below `#recipe` on make-first templates) so multi-clip templates do not stack inside the narrow
 * sidebar.
 *
 *   - Signed-in / open: full `ClipCard` list + bulk expand/collapse + sticky `ClipIndex` (≥ 3 clips).
 *   - Signed-out teaser: numbered clip titles only (`guideOutline`) + sign-in gate.
 */
export function RecipeClipsSection({
  recipe,
  copy,
  gate,
}: {
  recipe: PublicRecipe;
  copy: Dictionary['makerRecipe'];
  gate?: RecipeGateProps;
}) {
  const shared = useRecipeAccess();
  const [standaloneUnlocked, setStandaloneUnlocked] = useState<PublicRecipe | null>(null);
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  const accessEndpoint = gate?.accessEndpoint ?? null;
  useEffect(() => {
    if (shared !== null || !accessEndpoint) return;
    let cancelled = false;
    fetch(accessEndpoint, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { signedIn?: boolean; recipe?: PublicRecipe | null } | null) => {
        if (!cancelled && data?.signedIn && data.recipe) {
          setStandaloneUnlocked(data.recipe);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shared, accessEndpoint]);

  const unlockedRecipe = shared !== null ? shared.unlockedRecipe : standaloneUnlocked;
  const active = unlockedRecipe ?? recipe;
  const isLocked = Boolean(gate) && !unlockedRecipe;
  const h = copy.how;

  const clips = active.guide ?? [];
  const outline = recipe.guideOutline ?? [];

  const indexItems: ClipIndexItem[] = useMemo(
    () => clips.map((item) => ({ id: `clip-${item.n}`, n: item.n, title: item.title })),
    [clips],
  );
  const clipIds = useMemo(() => indexItems.map((item) => item.id), [indexItems]);
  const { activeId, jumpTo } = useActiveClip(clipIds);

  if (!isLocked && clips.length === 0) return null;
  if (isLocked && outline.length === 0) return null;

  const foldableKeys = clips.filter((item) => isFoldablePrompt(item.prompt)).map((item) => String(item.n));
  const allExpanded = foldableKeys.length > 0 && foldableKeys.every((key) => openKeys.has(key));
  const hasIndex = !isLocked && indexItems.length >= CLIP_INDEX_MIN;
  const cardLabels = {
    tipHeading: h.tipHeading,
    expand: h.expand,
    collapse: h.collapse,
    copy: h.copy,
    copied: h.copied,
  };

  const toggleAll = () => {
    setOpenKeys(allExpanded ? new Set() : new Set(foldableKeys));
  };

  const toggleOne = (key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalCount = isLocked ? outline.length : clips.length;

  return (
    <section
      id="clips"
      data-recipe-clips
      data-recipe-guide
      data-recipe-locked={isLocked ? 'true' : undefined}
      className="mt-12 scroll-mt-24 border-t border-[#09090B]/[0.08] pt-8 sm:mt-16 sm:pt-10"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="audience-heading text-[#09090B]">{h.guideHeading}</h2>
            <span className="inline-flex items-center rounded-full bg-[#F4F4F5] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#52525B]">
              {interpolate(h.clipCount, { n: String(totalCount) })}
            </span>
          </div>
          <p className="mt-2 max-w-detail break-keep text-sm leading-relaxed text-[#52525B]">{h.guideLede}</p>
        </div>

        {!isLocked && clips.length > 1 && foldableKeys.length > 0 ? (
          <button
            type="button"
            data-recipe-toggle-all
            aria-pressed={allExpanded}
            onClick={toggleAll}
            className="audience-button-quiet min-h-10 shrink-0 px-4 text-xs"
          >
            {allExpanded ? h.collapseAll : h.expandAll}
          </button>
        ) : null}
      </div>

      {isLocked && gate ? (
        <div className="mt-6 space-y-5">
          <ol className="divide-y divide-[#09090B]/[0.08] rounded-[16px] border border-[#09090B]/[0.08] bg-white">
            {outline.map((item) => (
              <li
                key={item.n}
                data-recipe-guide-outline={item.n}
                className="flex items-baseline gap-3 px-4 py-3.5 sm:px-5"
              >
                <span className="inline-flex shrink-0 items-center rounded-full bg-[#F4F4F5] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#09090B]">
                  {String(item.n).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 break-keep text-sm font-medium text-[#09090B]">{item.title}</span>
              </li>
            ))}
          </ol>

          <div data-recipe-gate data-recipe-clips-gate className="rounded-[16px] border border-[#09090B]/[0.08] bg-[#F4F4F5] p-5 sm:p-6">
            <p className="text-base font-semibold text-[#09090B]">{h.gateTitle}</p>
            <p className="mt-1.5 max-w-detail break-keep text-sm leading-relaxed text-[#52525B]">{h.clipsOutlineNote}</p>
            <a data-recipe-gate-cta href={gate.signinHref} className="audience-button-quiet mt-4 min-h-11 text-sm">
              {h.gateCta}
            </a>
          </div>
        </div>
      ) : (
        <>
          {hasIndex ? (
            <ClipIndex
              items={indexItems}
              activeId={activeId}
              onSelect={jumpTo}
              label={h.clipIndexLabel}
              variant="chips"
            />
          ) : null}

          <div className={hasIndex ? 'mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start' : 'mt-5'}>
            <ol className="min-w-0 space-y-4">
              {clips.map((item) => {
                const key = String(item.n);
                return (
                  <ClipCard
                    key={item.n}
                    id={`clip-${item.n}`}
                    number={item.n}
                    title={item.title}
                    meta={item.meta}
                    note={item.note}
                    noteMarker="guide"
                    prompt={item.prompt}
                    labels={cardLabels}
                    expanded={openKeys.has(key)}
                    onToggle={() => toggleOne(key)}
                    itemAttr={{ 'data-recipe-guide-step': item.n }}
                  />
                );
              })}
            </ol>

            {hasIndex ? (
              <ClipIndex
                items={indexItems}
                activeId={activeId}
                onSelect={jumpTo}
                label={h.clipIndexLabel}
                variant="rail"
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
