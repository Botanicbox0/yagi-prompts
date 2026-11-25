'use client';

import type { ReactNode } from 'react';
import { ClipIndex, CLIP_INDEX_MIN, useActiveClip, type ClipIndexItem } from '@/components/recipes/clip-index';

/**
 * Article reading layout matching Batch 1 `RecipeClipsSection`:
 *   - < 3 headings: single clean reading column without a TOC.
 *   - >= 3 headings: sticky horizontal chip strip on <lg + sticky right rail on >=lg.
 */
export function PostArticleShell({
  headings,
  tocLabel,
  children,
}: {
  headings: readonly ClipIndexItem[];
  tocLabel: string;
  children: ReactNode;
}) {
  const hasToc = headings.length >= CLIP_INDEX_MIN;
  const { activeId, jumpTo } = useActiveClip(headings.map((item) => item.id));

  if (!hasToc) {
    return <div className="mt-8">{children}</div>;
  }

  return (
    <div className="mt-6">
      <ClipIndex
        items={headings}
        activeId={activeId}
        onSelect={jumpTo}
        label={tocLabel}
        variant="chips"
      />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
        <div className="min-w-0">{children}</div>
        <ClipIndex
          items={headings}
          activeId={activeId}
          onSelect={jumpTo}
          label={tocLabel}
          variant="rail"
        />
      </div>
    </div>
  );
}
