import type { ShapedStep } from '@/lib/content/shape';
import { interpolate, localize } from '@/lib/i18n/format';
import { stepAnchor, type PlaybookLabels } from './labels';

/**
 * PLAN §3.3 / §4 — "sticky step index on the left at ≥1024px; horizontal chip bar below",
 * and §5.5 — "lock counts surface in the step index ('Step 3 · 2 locked')".
 *
 * Both variants are rendered server-side and hidden by CSS, never by JavaScript: the index is
 * navigation, and navigation that depends on a hydrated client is navigation that can fail. Anchor
 * links only — no scroll-spy, which would be a client component for a decorative highlight and
 * would put a pinned/transformed ancestor question back on the sticky column (§5.4 containment).
 */

function LockCount({ count, labels }: { count: number; labels: PlaybookLabels }) {
  if (count === 0) return null;
  return (
    <>
      <span aria-hidden className="opacity-40">
        {' · '}
      </span>
      <span className="text-accent">{interpolate(labels.lockedInStep, { count })}</span>
    </>
  );
}

export function StepIndex({
  steps,
  locale,
  labels,
}: {
  steps: ShapedStep[];
  locale: string;
  labels: PlaybookLabels;
}) {
  return (
    <nav aria-label={labels.stepsHeading} className="step-index hidden lg:block">
      <p className="font-label text-eyebrow uppercase opacity-60">{labels.stepsHeading}</p>
      <ol className="mt-5 space-y-4 border-l border-hairline">
        {steps.map((step) => (
          <li key={step.id} className="-ml-px border-l border-transparent pl-4">
            <a href={`#${stepAnchor(step.order)}`} className="block hover:opacity-70">
              <span className="block font-mono text-code">
                {interpolate(labels.stepLabel, { n: step.order })}
                <LockCount count={step.lockedCount} labels={labels} />
              </span>
              <span className="mt-1 block text-[0.9375rem] leading-snug opacity-70">
                {localize(step.title, locale)}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function StepChips({
  steps,
  locale,
  labels,
}: {
  steps: ShapedStep[];
  locale: string;
  labels: PlaybookLabels;
}) {
  return (
    <nav
      aria-label={labels.stepsHeading}
      className="sticky top-16 z-20 -mx-gutter border-y border-hairline bg-surface lg:hidden"
    >
      <ul className="flex snap-x gap-2 overflow-x-auto px-gutter py-3">
        {steps.map((step) => (
          <li key={step.id} className="snap-start">
            <a
              href={`#${stepAnchor(step.order)}`}
              title={localize(step.title, locale)}
              className="inline-block border border-hairline px-3 py-1.5 font-mono text-code whitespace-nowrap"
            >
              {interpolate(labels.stepLabel, { n: step.order })}
              <LockCount count={step.lockedCount} labels={labels} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
