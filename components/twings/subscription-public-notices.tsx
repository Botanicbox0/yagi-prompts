'use client';

import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { formatCount, interpolate } from '@/lib/i18n/format';
import { useSubscriptionAvailability } from './subscription-availability';

export function CreatorAvailabilityNotice({ copy, oneTimeAvailable }: {
  copy: Pick<Dictionary['creatorJourney'], 'ready' | 'preparing' | 'subscriptionReady' | 'subscriptionPaused'>;
  oneTimeAvailable: boolean;
}) {
  const availability = useSubscriptionAvailability();
  const monthlyOpen = availability.status === 'open' && availability.plans.creator.status === 'open';
  return <>{availability.status === 'paused' ? copy.subscriptionPaused : monthlyOpen ? copy.subscriptionReady : oneTimeAvailable ? copy.ready : copy.preparing}</>;
}

export function TemplateSubscriptionNote({ copy, count, premiumCount, locale }: {
  copy: Pick<Dictionary['pricing'], 'subscriptionTemplateNote' | 'subscriptionTemplateOpenNote' | 'subscriptionTemplateCreatorNote' | 'subscriptionTemplatePausedNote' | 'subscriptionDetailLink'>;
  count: number; premiumCount: number; locale: Locale;
}) {
  const availability = useSubscriptionAvailability();
  const creatorOpen = availability.status === 'open' && availability.plans.creator.status === 'open';
  const premiumOpen = creatorOpen && availability.plans.premium.status === 'open' && availability.editing === 'open';
  const paused = availability.status === 'paused';
  const note = paused ? copy.subscriptionTemplatePausedNote : premiumOpen ? copy.subscriptionTemplateOpenNote : creatorOpen ? copy.subscriptionTemplateCreatorNote : copy.subscriptionTemplateNote;
  return <div data-template-subscription={paused ? 'paused' : premiumOpen ? 'premium' : creatorOpen ? 'creator' : 'preparing'} className="mt-4 text-sm leading-relaxed opacity-70">
    <p>{interpolate(note, { count: formatCount(count, locale), premiumCount: formatCount(premiumCount, locale) })}</p>
    <a href={`/${locale}/pricing#monthly`} className="mt-1 inline-block underline underline-offset-4">{copy.subscriptionDetailLink} →</a>
  </div>;
}

export function TemplateMakeAvailability({ copy, oneTimeAvailable, subscriptionEligible, field }: {
  copy: Pick<Dictionary['templates'], 'makeCta' | 'makeCtaClosed' | 'makeBody' | 'makeBodyClosed' | 'makeBodySubscription' | 'makeBodySubscriptionPaused'>;
  oneTimeAvailable: boolean; subscriptionEligible: boolean; field: 'cta' | 'body';
}) {
  const availability = useSubscriptionAvailability();
  const monthlyOpen = subscriptionEligible && availability.status === 'open' && availability.plans.creator.status === 'open';
  const monthlyPaused = subscriptionEligible && availability.status === 'paused';
  if (field === 'cta') return <>{oneTimeAvailable || monthlyOpen || monthlyPaused ? copy.makeCta : copy.makeCtaClosed}</>;
  return <>{monthlyPaused ? copy.makeBodySubscriptionPaused : monthlyOpen ? copy.makeBodySubscription : oneTimeAvailable ? copy.makeBody : copy.makeBodyClosed}</>;
}
