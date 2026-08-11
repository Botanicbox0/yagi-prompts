import type { ReactNode } from 'react';

/**
 * PLAN §5.3-3 — "labels rendered twice, stack slides on hover. All primary CTAs + nav links."
 *
 * Pure CSS (`.text-swap` in globals.css), driven from the enclosing `<a>`/`<button>` so it fires on
 * keyboard focus too. The duplicate is `aria-hidden` — screen readers hear the label once.
 */
export function TextSwap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={['text-swap', className].filter(Boolean).join(' ')}>
      <span className="text-swap__a">{children}</span>
      <span aria-hidden className="text-swap__b">
        {children}
      </span>
    </span>
  );
}
