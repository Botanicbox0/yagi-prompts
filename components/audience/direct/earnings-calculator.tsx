'use client';

import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { simulateMakerTemplateRevenue } from '@/lib/twings/template-price';
import { DEFAULT_DIRECT_ROYALTY_KRW } from './defaults';

const RAISE_OPTIONS_KRW = [0, 500, 1000, 2000, 3000] as const;

export interface DirectEarningsCopy {
  simBadge: string;
  simHeading: string;
  simRaiseGroupLabel: string;
  simBaseChip: string;
  simRaiseChipPattern: string;
  simDisclosure: string;
  simSalePriceLabel: string;
  simSalePricePattern: string;
  simPerMakeLabel: string;
  simPerMakePattern: string;
  simHundredMakesPattern: string;
  simSettlementNote: string;
}

export interface DirectEarningsCalculatorProps {
  locale: Locale;
  providerUsd: number;
  copy: DirectEarningsCopy;
}

/**
 * Compact interactive earnings estimator — the only client island on `/[locale]/direct`.
 */
export function DirectEarningsCalculator({
  locale,
  providerUsd,
  copy,
}: DirectEarningsCalculatorProps) {
  const [royaltyKrw, setRoyaltyKrw] = useState<number>(DEFAULT_DIRECT_ROYALTY_KRW);

  const revenueSim = useMemo(
    () =>
      simulateMakerTemplateRevenue({
        medium: 'video',
        providerUsd,
        royaltyKrw,
      }),
    [providerUsd, royaltyKrw],
  );

  const hundredMakesKrw =
    revenueSim.milestones.find((m) => m.makes === 100)?.creatorTotalKrw ??
    revenueSim.perMake.creator * 100;

  const numLocale = locale === 'en' ? 'en-US' : 'ko-KR';
  const fmt = (value: number) => value.toLocaleString(numLocale);

  return (
    <section
      data-maker-revenue-calculator
      aria-labelledby="maker-revenue-heading"
      className="border-t border-[#09090B]/[0.08] pt-12"
    >
      <span className="inline-flex items-center rounded-full bg-[#F4F4F5] px-3 py-1 text-xs font-medium text-[#52525B]">
        {copy.simBadge}
      </span>
      <h2 id="maker-revenue-heading" className="audience-heading mt-3 max-w-2xl text-[#09090B]">
        {copy.simHeading}
      </h2>

      <div className="mt-6 rounded-[16px] bg-[#F4F4F5] p-6 sm:p-8">
        <p className="text-xs font-semibold text-[#52525B]">{copy.simRaiseGroupLabel}</p>

        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label={copy.simRaiseGroupLabel}
        >
          {RAISE_OPTIONS_KRW.map((raise) => {
            const active = royaltyKrw === raise;
            return (
              <button
                key={raise}
                type="button"
                data-maker-raise-option={raise}
                aria-pressed={active}
                onClick={() => setRoyaltyKrw(raise)}
                className={[
                  'inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-xs font-semibold tabular-nums transition-colors duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                  active
                    ? 'border-[#09090B] bg-[#09090B] text-white'
                    : 'border-[#09090B]/[0.08] bg-white text-[#09090B] hover:border-[#09090B]/[0.2]',
                ].join(' ')}
              >
                {raise === 0
                  ? copy.simBaseChip
                  : copy.simRaiseChipPattern.replace('{amount}', fmt(raise))}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-[#52525B]">{copy.simDisclosure}</p>

        <div className="mt-5 rounded-[12px] bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-[#52525B]">{copy.simSalePriceLabel}</span>
            <span className="text-sm font-semibold text-[#09090B] tabular-nums">
              {copy.simSalePricePattern.replace('{price}', fmt(revenueSim.salePriceKrw))}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-[#09090B]/[0.08] pt-3">
            <span className="text-xs font-semibold text-[#52525B]">{copy.simPerMakeLabel}</span>
            <span
              data-maker-earning-per-make
              className="text-lg font-bold text-[#09090B] tabular-nums"
            >
              {copy.simPerMakePattern.replace('{amount}', fmt(revenueSim.perMake.creator))}
            </span>
          </div>

          <p className="mt-3 border-t border-[#09090B]/[0.08] pt-3 text-sm text-[#52525B] tabular-nums">
            {copy.simHundredMakesPattern.replace('{amount}', fmt(hundredMakesKrw))}
          </p>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-[#71717A]">{copy.simSettlementNote}</p>
      </div>
    </section>
  );
}
