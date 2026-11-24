'use client';
/**
 * The home's credits line: the rail meter's own figures and sentence (`meterFigures`, `meterSummary`),
 * so the two never disagree. Credits only; the allowance in won never reaches the screen.
 */
import type { StudioShellCopy } from '@/messages/studio-shell';
import { meterFigures, meterSummary, type RailSummary } from '../rail-activity';

export function HomeCredits({
  allowance,
  copy,
  locale,
  className,
}: {
  allowance: RailSummary['allowance'] | null;
  copy: StudioShellCopy;
  locale: 'ko' | 'en';
  className?: string;
}) {
  const figures = meterFigures(allowance, locale);
  if (!figures) return null;
  return (
    <p className={className} data-home-credits data-low={figures.ratio < 0.1 ? 'true' : undefined}>
      {meterSummary(figures, copy)}
    </p>
  );
}
