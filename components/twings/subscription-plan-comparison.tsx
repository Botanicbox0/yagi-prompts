'use client';

import { useState } from 'react';
import { formatCount, interpolate } from '@/lib/i18n/format';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { CreatorPlanId } from '@/lib/twings/subscription-plan';
import { useSubscriptionAvailability, type PublicSubscriptionAvailability } from './subscription-availability';

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
  'subscriptionBrowse' | 'subscriptionCountBasis' | 'subscriptionTitle' | 'subscriptionStatus' |
  'subscriptionUnavailable' | 'subscriptionOpenTitle' | 'subscriptionOpenStatus' |
  'subscriptionOpenBody' | 'subscriptionPausedStatus' | 'subscriptionPausedBody' |
  'subscriptionStart' | 'subscriptionEditingOpenStatus' | 'subscriptionEditRequestLimit' | 'subscriptionEditCountNotice'>;

/** Only display values cross this boundary. This comparison cannot enroll or authorize a render. */
export function SubscriptionPlanComparison({ plans, copy, browseHref, initialAvailability }: {
  plans: PublicCreatorPlan[];
  copy: SubscriptionComparisonCopy;
  browseHref: string;
  initialAvailability?: PublicSubscriptionAvailability;
}) {
  const [seconds, setSeconds] = useState<FilmLength>(15);
  const availability = useSubscriptionAvailability(initialAvailability);
  const open = availability.status === 'open';
  const paused = availability.status === 'paused';
  return <div data-subscription-preview data-pricing-subscription={availability.status} data-subscription-version={availability.version}>
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-hairline py-3">
      <h2 className="text-sm font-semibold">{open ? copy.subscriptionOpenTitle : copy.subscriptionTitle}</h2>
      <span className="rounded-full border border-hairline px-3 py-1 text-xs">{open ? copy.subscriptionOpenStatus : paused ? copy.subscriptionPausedStatus : copy.subscriptionStatus}</span>
      <p data-subscription-unavailable={open ? undefined : ''} data-generation-availability className="w-full text-xs leading-relaxed text-black/65 lg:w-auto">{open ? copy.subscriptionOpenBody : paused ? copy.subscriptionPausedBody : copy.subscriptionUnavailable}</p>
    </div>
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
        const planOpen = open && availability.plans[plan.id].status === 'open' && (!premium || availability.editing === 'open');
        return <article key={plan.id} data-subscription-plan={plan.id} data-subscription-plan-status={planOpen ? 'open' : availability.plans[plan.id].status === 'paused' ? 'paused' : 'preparing'} className={`flex min-w-0 flex-col rounded-2xl border p-6 sm:p-8 ${premium ? 'border-accent' : 'border-hairline'}`}>
          <h3 className={`text-lg font-semibold ${premium ? 'text-accent' : ''}`}>{t.name}</h3>
          <p className="mt-2 min-h-10 text-sm leading-relaxed text-black/65">{t.headline}</p>
          <p data-subscription-price className="mt-5 font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-tight font-bold tracking-tight">{plan.price}<span className="ml-2 text-sm font-normal tracking-normal text-black/60">{copy.subscriptionPeriod}</span></p>
          <p className="mt-1 text-xs text-black/60">{copy.subscriptionTax}</p>

          <div className="mt-7 border-t border-hairline pt-6" aria-live="polite" aria-atomic="true">
            <p data-plan-film-count={plan.id} className="text-[clamp(1.75rem,3vw,2.5rem)] leading-tight font-semibold tracking-tight">{interpolate(copy.subscriptionFilmCount, { count: String(plan.filmCounts[seconds]) })}</p>
            <p className="mt-2 text-sm text-black/65">{interpolate(copy.subscriptionFilmLength, { seconds: String(seconds) })}</p>
          </div>
          <p className="mt-6 text-sm leading-relaxed">{premium ? copy.subscriptionEditingTitle : t.description}</p>
          {premium && <p className="mt-2 text-xs text-black/60">{availability.editing === 'open' ? copy.subscriptionEditingOpenStatus : copy.subscriptionEditingStatus}</p>}
          {premium && planOpen && availability.premiumEditRequestsPerPeriod != null && <div data-premium-edit-request-limit className="mt-3 space-y-2">
            <p className="text-sm font-medium">{interpolate(copy.subscriptionEditRequestLimit, { limit: formatCount(availability.premiumEditRequestsPerPeriod, 'en') })}</p>
            <p className="text-xs leading-relaxed text-black/60">{copy.subscriptionEditCountNotice}</p>
          </div>}
          {premium && <a href="#customization" className="mt-1 inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4">{copy.subscriptionMore}</a>}
          <div className="mt-auto pt-7">
            <a href={planOpen ? `/billing/subscription?plan=${plan.id}` : browseHref} className={`flex min-h-12 w-full items-center justify-center gap-3 rounded-full px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${premium ? 'bg-accent text-white' : 'bg-black text-white'}`}>{planOpen ? interpolate(copy.subscriptionStart, { plan: t.name }) : copy.subscriptionBrowse}<span aria-hidden="true">↗</span></a>
          </div>
        </article>;
      })}
    </div>
    <p className="mt-5 max-w-3xl text-xs leading-relaxed text-black/60">{copy.subscriptionCountBasis}</p>
  </div>;
}

export function SubscriptionPricingText({ copy, field }: { copy: Pick<Dictionary['pricing'], 'lede' | 'subscriptionOpenLede' | 'filmsOpenBody' | 'filmsBody'>; field: 'lede' | 'single' }) {
  const availability = useSubscriptionAvailability();
  return <>{field === 'lede' ? availability.status === 'open' ? copy.subscriptionOpenLede : copy.lede : availability.status === 'open' ? copy.filmsOpenBody : copy.filmsBody}</>;
}

export function SubscriptionEditingPreview({ copy }: { copy: Pick<Dictionary['pricing'], 'subscriptionEditingStatus' | 'subscriptionEditingOpenStatus' | 'subscriptionEditingTitle' | 'subscriptionPromptEditingSoon' | 'subscriptionEditingOpenBody' | 'subscriptionEditingExample' | 'subscriptionEditingBoundary'> }) {
  const availability = useSubscriptionAvailability();
  const open = availability.editing === 'open';
  return <section id="customization" data-section data-theme="light" data-prompt-editing={open ? 'open' : 'planned'} className="section scroll-mt-24 border-y border-hairline">
    <div className="audience-shell grid gap-8 py-12 md:grid-cols-2 md:items-center lg:py-16">
      <div><p className="text-xs font-medium text-accent">{open ? copy.subscriptionEditingOpenStatus : copy.subscriptionEditingStatus}</p><h2 className="mt-4 max-w-lg text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">{copy.subscriptionEditingTitle}</h2><p className="mt-4 max-w-lg text-sm leading-relaxed text-black/65">{open ? copy.subscriptionEditingOpenBody : copy.subscriptionPromptEditingSoon}</p></div>
      <div><blockquote className="border-l-2 border-accent pl-5 text-xl leading-relaxed font-medium sm:text-2xl">“{copy.subscriptionEditingExample}”</blockquote><p className="mt-5 max-w-lg text-xs leading-relaxed text-black/65">{copy.subscriptionEditingBoundary}</p></div>
    </div>
  </section>;
}
