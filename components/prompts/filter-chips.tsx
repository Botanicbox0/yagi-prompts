'use client';

import { useEffect, useState } from 'react';

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
 * and the whole feature costs one boolean of state. With JavaScript off the chips simply do not
 * appear and every card is visible — the correct default, not a broken one.
 */
export function UseCaseFilter({
  options,
  labels,
}: {
  /** `[value, label]` pairs, already localised and already restricted to what is present. */
  options: Array<[string, string]>;
  labels: { heading: string; all: string };
}) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>('[data-prompt-item]');
    for (const item of items) {
      const values = (item.dataset.useCase ?? '').split(/\s+/).filter(Boolean);
      item.hidden = active !== null && !values.includes(active);
    }

    // Each rail owns its own "nothing here" line, so a filter that empties one rail says so
    // instead of leaving a headline over a void.
    for (const rail of document.querySelectorAll<HTMLElement>('[data-rail]')) {
      const visible = rail.querySelectorAll<HTMLElement>('[data-prompt-item]:not([hidden])').length;
      const empty = rail.querySelector<HTMLElement>('[data-rail-filtered-empty]');
      if (empty) empty.hidden = visible > 0;
    }
  }, [active]);

  if (options.length === 0) return null;

  const chip = (value: string | null, label: string) => {
    const on = active === value;
    return (
      <button
        key={value ?? '__all'}
        type="button"
        aria-pressed={on}
        data-active={on ? 'true' : 'false'}
        onClick={() => setActive(value)}
        className={[
          'inline-flex min-h-11 shrink-0 items-center border px-3 py-1.5 font-label text-[0.65rem] tracking-[0.12em] whitespace-nowrap uppercase transition-colors duration-200',
          on ? 'border-accent text-accent' : 'border-hairline opacity-70 hover:opacity-100',
        ].join(' ')}
      >
        {label}
      </button>
    );
  };

  // F3: below lg the chips are ONE horizontally-scrollable row — three wrapped rows of chips
  // were most of what pushed the landing's first card under a 375×667 fold. ≥lg wraps as before.
  return (
    <div
      data-use-case-filter
      className="flex items-center gap-2 overflow-x-auto lg:flex-wrap lg:overflow-x-visible"
    >
      <span className="mr-1 shrink-0 font-label text-[0.65rem] tracking-[0.12em] uppercase opacity-45">
        {labels.heading}
      </span>
      {chip(null, labels.all)}
      {options.map(([value, label]) => chip(value, label))}
    </div>
  );
}
