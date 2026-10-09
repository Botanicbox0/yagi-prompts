'use client';

import { useEffect, useState } from 'react';
import { readUseCase, useCaseHref } from '@/lib/navigation/public-state';

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
 * and URL state is restored after hydration. With JavaScript off the controls are hidden and
 * every card remains visible.
 */
export function UseCaseFilter({
  options,
  labels,
}: {
  /** `[value, label]` pairs, already localised and already restricted to what is present. */
  options: Array<[string, string]>;
  labels: { heading: string; all: string; count: string; reset: string };
}) {
  const [active, setActive] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
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
        className={[
          'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-200',
          on ? 'border-accent bg-accent text-white' : 'border-hairline hover:border-black/40',
        ].join(' ')}
      >
        {label}
      </button>
    );
  };

  // F3: below lg the chips are ONE horizontally-scrollable row — three wrapped rows of chips
  // were most of what pushed the landing's first card under a 375×667 fold. ≥lg wraps as before.
  return <>
    <noscript><style>{'[data-use-case-filter]{display:none}'}</style></noscript>
    <div data-use-case-filter className="min-w-0 space-y-3">
      <div role="group" aria-label={labels.heading} className="flex items-center gap-2 overflow-x-auto lg:flex-wrap lg:overflow-x-visible">
        {chip(null, labels.all)}
        {options.map(([value, label]) => chip(value, label))}
      </div>
      <div className="flex min-h-6 items-center gap-4 text-xs text-black/55">
        <span data-filter-count role="status" aria-live="polite">{count === null ? '' : labels.count.replace('{count}', String(count))}</span>
        {active !== null && <button type="button" onClick={() => select(null)} className="min-h-8 text-black underline underline-offset-4">{labels.reset}</button>}
      </div>
    </div>
  </>;
}
