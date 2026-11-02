'use client';

import { useEffect, useRef, useState } from 'react';
import { readUseCase, useCaseHref } from '@/lib/navigation/public-state';
import { pillClassName } from './pill';

/**
 * PLAN §13.2 — the use-case filter, done WITHOUT taking the page dynamic.
 *
 * The gallery is `[static + revalidateTag('prompts')]`, and reading `searchParams` in a Next 15
 * page opts it straight out of static rendering — so a server-rendered filter would trade the
 * cache contract for a query string. The brief's own fallback is what ships: filter client-side
 * over cards that are ALREADY in the document.
 *
 * There is no card JSON payload either. Every card carries `data-use-case` on its wrapper, so the
 * filter is `element.hidden = !match` over the DOM: nothing is re-fetched, nothing is re-rendered,
 * and URL state is restored after hydration. With JavaScript off the chips are hidden and every
 * card remains visible.
 */
export function UseCaseFilter({
  options,
  labels,
  total,
}: {
  /** `[value, label]` pairs, already localised and already restricted to what is present. */
  options: Array<[string, string]>;
  labels: { heading: string; all: string; count: string; reset: string };
  /** The unfiltered card count, so the count line is in the static HTML before hydration. */
  total?: number;
}) {
  const navigation = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(total ?? null);
  // §15.3-5: one use case across every template is not a choice — "전체" and its only sibling
  // would select the same cards. The chips go; the count line stays.
  const choosable = options.length >= 2;
  const valuesKey = options.map(([value]) => value).join('\n');

  useEffect(() => {
    const values = valuesKey.split('\n');
    const restore = () => setActive(readUseCase(window.location.search, values));
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [valuesKey]);

  const select = (value: string | null) => {
    setActive(value);
    const href = useCaseHref(window.location.href, value, options.map(([option]) => option));
    window.history.replaceState(window.history.state, '', href);
  };

  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>('[data-prompt-item]');
    for (const item of items) {
      const values = (item.dataset.useCase ?? '').split(/\s+/).filter(Boolean);
      item.hidden = active !== null && !values.includes(active);
    }
    setCount(Array.from(items).filter(item => !item.hidden).length);

    // Each rail owns its own "nothing here" line, so a filter that empties one rail says so
    // instead of leaving a headline over a void.
    for (const rail of document.querySelectorAll<HTMLElement>('[data-rail]')) {
      const visible = rail.querySelectorAll<HTMLElement>('[data-prompt-item]:not([hidden])').length;
      const empty = rail.querySelector<HTMLElement>('[data-rail-filtered-empty]');
      if (empty) empty.hidden = visible > 0;
    }
    return () => { for (const item of items) item.hidden = false; };
  }, [active, valuesKey]);

  useEffect(() => {
    const group = navigation.current;
    if (!group) return;
    const reveal = () => {
      const selected = group.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!selected || group.scrollWidth <= group.clientWidth) return;
      const bounds = group.getBoundingClientRect(), item = selected.getBoundingClientRect();
      // Only the chip row moves; restoring a saved filter must not move the page vertically.
      if (item.left < bounds.left + 4) group.scrollLeft += item.left - bounds.left - 4;
      else if (item.right > bounds.right - 4) group.scrollLeft += item.right - bounds.right + 4;
    };
    reveal();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(group);
    return () => observer?.disconnect();
  }, [active, valuesKey]);

  if (options.length === 0) return null;

  const chip = (value: string | null, label: string) => {
    const on = active === value;
    return (
      <button
        key={value ?? '__all'}
        type="button"
        aria-pressed={on}
        data-active={on ? 'true' : 'false'}
        onClick={() => select(value)}
        className={pillClassName(on)}
      >
        {label}
      </button>
    );
  };

  // F3: below lg the chips are ONE horizontally-scrollable row — three wrapped rows of chips
  // were most of what pushed the landing's first card under a 375×667 fold. ≥lg wraps as before.
  return <>
    {/* Without JS every card stays visible, so the server-rendered count is still true; only the
        chips, which could not filter anything, are hidden. */}
    <noscript><style>{'[data-use-case-filter] [role=group]{display:none}'}</style></noscript>
    <div data-use-case-filter={choosable ? '' : 'count-only'} className="min-w-0 space-y-3">
      {choosable && (
        <div ref={navigation} role="group" aria-label={labels.heading} className="flex items-center gap-2 overflow-x-auto lg:flex-wrap lg:overflow-x-visible">
          {chip(null, labels.all)}
          {options.map(([value, label]) => chip(value, label))}
        </div>
      )}
      <div className="flex min-h-6 items-center gap-4 text-xs text-black/55">
        <span data-filter-count role="status" aria-live="polite">{count === null ? '' : labels.count.replace('{count}', String(count))}</span>
        {active !== null && <button type="button" onClick={() => select(null)} className="min-h-8 text-black underline underline-offset-4">{labels.reset}</button>}
      </div>
    </div>
  </>;
}
