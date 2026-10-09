'use client';

import { useState } from 'react';
import { interpolate } from '@/lib/i18n/format';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { CreatorPlanId } from '@/lib/twings/subscription-plan';

export const COMPARISON_LENGTHS = [10, 15, 30] as const;
type FilmLength = (typeof COMPARISON_LENGTHS)[number];
export interface PublicCreatorPlan {
  id: CreatorPlanId;
  price: string;
  filmCounts: Record<FilmLength, number>;
}
export type SubscriptionComparisonCopy = Pick<Dictionary['pricing'],
  'subscriptionDurationLabel' | 'subscriptionDuration' | 'subscriptionPlans' |
  'subscriptionPeriod' | 'subscriptionTax' | 'subscriptionFilmCount' | 'subscriptionFilmLength' |
  'subscriptionEditingTitle' | 'subscriptionEditingStatus' | 'subscriptionMore' |
  'subscriptionBrowse' | 'subscriptionCountBasis'>;

/** Only display values cross this boundary. This comparison cannot enroll or authorize a render. */
export function SubscriptionPlanComparison({ plans, copy, browseHref }: {
  plans: PublicCreatorPlan[];
  copy: SubscriptionComparisonCopy;
  browseHref: string;
}) {
  const [seconds, setSeconds] = useState<FilmLength>(15);
  return <div data-subscription-preview>
    <fieldset className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-4">
      <legend className="sr-only">{copy.subscriptionDurationLabel}</legend>
      <p aria-hidden="true" className="text-sm font-medium">{copy.subscriptionDurationLabel}</p>
      <div className="inline-flex max-w-full rounded-full border border-hairline p-1">
        {COMPARISON_LENGTHS.map(length => <label key={length} className="relative cursor-pointer">
          <input type="radio" name="subscription-length" value={length} checked={seconds === length} onChange={() => setSeconds(length)} className="peer sr-only" />
          <span className="flex min-h-11 min-w-19 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors peer-checked:bg-black peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none">
            {interpolate(copy.subscriptionDuration, { seconds: String(length) })}
          </span>
        </label>)}
      </div>
    </fieldset>

    <div className="grid gap-5 md:grid-cols-2">
      {plans.map(plan => {
        const premium = plan.id === 'premium';
        const t = copy.subscriptionPlans[plan.id];
        return <article key={plan.id} data-subscription-plan={plan.id} className={`flex min-w-0 flex-col rounded-2xl border p-6 sm:p-8 ${premium ? 'border-accent' : 'border-hairline'}`}>
          <h3 className={`text-lg font-semibold ${premium ? 'text-accent' : ''}`}>{t.name}</h3>
          <p className="mt-2 min-h-10 text-sm leading-relaxed text-black/65">{t.headline}</p>
          <p data-subscription-price className="mt-5 font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-tight font-bold tracking-tight">{plan.price}<span className="ml-2 text-sm font-normal tracking-normal text-black/60">{copy.subscriptionPeriod}</span></p>
          <p className="mt-1 text-xs text-black/60">{copy.subscriptionTax}</p>

          <div className="mt-7 border-t border-hairline pt-6" aria-live="polite" aria-atomic="true">
            <p data-plan-film-count={plan.id} className="text-[clamp(1.75rem,3vw,2.5rem)] leading-tight font-semibold tracking-tight">{interpolate(copy.subscriptionFilmCount, { count: String(plan.filmCounts[seconds]) })}</p>
            <p className="mt-2 text-sm text-black/65">{interpolate(copy.subscriptionFilmLength, { seconds: String(seconds) })}</p>
          </div>
          <p className="mt-6 text-sm leading-relaxed">{premium ? copy.subscriptionEditingTitle : t.description}</p>
          {premium && <p className="mt-2 text-xs text-black/60">{copy.subscriptionEditingStatus}</p>}
          {premium && <a href="#customization" className="mt-1 inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4">{copy.subscriptionMore}</a>}
          <div className="mt-auto pt-7">
            <a href={browseHref} className={`flex min-h-12 w-full items-center justify-center gap-3 rounded-full px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${premium ? 'bg-accent text-white' : 'bg-black text-white'}`}>{copy.subscriptionBrowse}<span aria-hidden="true">↗</span></a>
          </div>
        </article>;
      })}
    </div>
    <p className="mt-5 max-w-3xl text-xs leading-relaxed text-black/60">{copy.subscriptionCountBasis}</p>
  </div>;
}
