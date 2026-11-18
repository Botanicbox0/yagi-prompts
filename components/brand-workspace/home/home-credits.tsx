'use client';
/**
 * The home's credits line: the rail meter's own figures and sentence (`meterFigures`, `credits.summary`),
 * so the two never disagree. Credits only; the allowance in won never reaches the screen.
 */
import { interpolate } from '@/lib/i18n/format';
import type { StudioShellCopy } from '@/messages/studio-shell';
import { meterFigures, type RailSummary } from '../rail-activity';

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
      {interpolate(copy.credits.summary, { left: figures.leftText, total: figures.totalText, date: figures.date })}
    </p>
  );
}
