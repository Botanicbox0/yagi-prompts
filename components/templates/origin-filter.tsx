'use client';

import { useEffect, useState } from 'react';
import { pillClassName } from '@/components/prompts/pill';

export type OriginChoice = 'studio' | 'maker';

/** Fired after the origin choice hides or shows a rail, so the use-case filter can recount. */
export const CATALOG_FILTER_EVENT = 'twings:catalog-filter';

/**
 * docs/PLATFORM-2.0.md §7.5 — "전체 · 오리지널 · 메이커", over rails that are ALREADY in the
 * document: the listing stays static (no `searchParams`), exactly like `UseCaseFilter`. A choice
 * hides the other origin's rail with `hidden`; nothing is fetched or re-rendered. Rendered only when
 * both origins have templates — one origin is not a choice. Without JavaScript the chips are hidden
 * and both rails stay visible.
 */
export function OriginFilter({ labels }: { labels: { heading: string; all: string; studio: string; maker: string } }) {
  const [active, setActive] = useState<OriginChoice | null>(null);

  useEffect(() => {
    const rails = document.querySelectorAll<HTMLElement>('[data-rail-origin]');
    for (const rail of rails) rail.hidden = active !== null && rail.dataset.railOrigin !== active;
    window.dispatchEvent(new Event(CATALOG_FILTER_EVENT));
    return () => { for (const rail of rails) rail.hidden = false; };
  }, [active]);

  const chip = (value: OriginChoice | null, label: string) => {
    const on = active === value;
    return (
      <button key={value ?? '__all'} type="button" aria-pressed={on} data-origin={value ?? 'all'} onClick={() => setActive(value)} className={pillClassName(on)}>
        {label}
      </button>
    );
  };

  return <>
    <noscript><style>{'[data-origin-filter]{display:none}'}</style></noscript>
    <div data-origin-filter role="group" aria-label={labels.heading} className="flex items-center gap-2 overflow-x-auto lg:flex-wrap lg:overflow-x-visible">
      {chip(null, labels.all)}
      {chip('studio', labels.studio)}
      {chip('maker', labels.maker)}
    </div>
  </>;
}
