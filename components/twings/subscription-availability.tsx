'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type AvailabilityStatus = 'preparing' | 'open' | 'paused';
export interface PublicSubscriptionAvailability {
  status: AvailabilityStatus;
  version: string;
  plans: { creator: { status: AvailabilityStatus }; premium: { status: AvailabilityStatus } };
  editing: 'preparing' | 'open';
  premiumEditRequestsPerPeriod?: number | null;
}
export const SUBSCRIPTION_PREPARING: PublicSubscriptionAvailability = {
  status: 'preparing', version: 'creator-monthly-2026-10-09-v1',
  plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing',
};

function isStatus(value: unknown): value is AvailabilityStatus {
  return value === 'preparing' || value === 'open' || value === 'paused';
}
/** Public display state only. An incomplete response never opens an enrollment button. */
export function parseSubscriptionAvailability(value: unknown): PublicSubscriptionAvailability {
  if (!value || typeof value !== 'object') return SUBSCRIPTION_PREPARING;
  const input = value as Record<string, unknown>;
  const plans = input.plans as PublicSubscriptionAvailability['plans'] | undefined;
  if (!isStatus(input.status) || typeof input.version !== 'string' || !input.version ||
    !isStatus(plans?.creator?.status) || !isStatus(plans?.premium?.status) ||
    (input.editing !== 'open' && input.editing !== 'preparing')) return SUBSCRIPTION_PREPARING;
  const hasEditLimit = 'premiumEditRequestsPerPeriod' in input;
  const editLimit = typeof input.premiumEditRequestsPerPeriod === 'number' && Number.isSafeInteger(input.premiumEditRequestsPerPeriod) && input.premiumEditRequestsPerPeriod > 0 && input.premiumEditRequestsPerPeriod <= 1000
    ? input.premiumEditRequestsPerPeriod : null;
  const premiumClosed = hasEditLimit && editLimit === null;
  return {
    status: input.status, version: input.version,
    plans: { creator: { status: plans.creator.status }, premium: { status: premiumClosed ? 'preparing' : plans.premium.status } },
    editing: premiumClosed ? 'preparing' : input.editing,
    ...(hasEditLimit ? { premiumEditRequestsPerPeriod: editLimit } : {}),
  };
}

const AvailabilityContext = createContext<PublicSubscriptionAvailability | null>(null);

/** One visible page keeps its public state fresh without overlapping reads or late updates after cleanup. */
export function startSubscriptionAvailabilityRefresh(onAvailability: (value: PublicSubscriptionAvailability) => void): () => void {
  let active = true;
  let controller: AbortController | null = null;
  const visible = () => document.visibilityState === 'visible';
  const refresh = async () => {
    if (!active || !visible() || controller) return;
    const current = new AbortController();
    controller = current;
    try {
      const response = await fetch('/api/creator-subscriptions/availability', {
        cache: 'no-store', credentials: 'same-origin', signal: current.signal,
      });
      const result = response.ok ? parseSubscriptionAvailability(await response.json()) : SUBSCRIPTION_PREPARING;
      if (active && !current.signal.aborted && controller === current && visible()) onAvailability(result);
    } catch {
      if (active && !current.signal.aborted && controller === current && visible()) onAvailability(SUBSCRIPTION_PREPARING);
    } finally {
      if (controller === current) controller = null;
    }
  };
  const onVisible = () => {
    if (visible()) { void refresh(); return; }
    controller?.abort();
    controller = null;
  };
  const onFocus = () => { void refresh(); };
  const interval = setInterval(onFocus, 60_000);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  void refresh();
  return () => {
    active = false;
    clearInterval(interval);
    controller?.abort();
    controller = null;
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pageshow', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function useFreshAvailability(initial: PublicSubscriptionAvailability, skip: boolean) {
  const [availability, setAvailability] = useState(initial);
  useEffect(() => {
    if (skip) return;
    return startSubscriptionAvailabilityRefresh(setAvailability);
  }, [skip]);
  return availability;
}

export function SubscriptionAvailabilityProvider({ initialAvailability = SUBSCRIPTION_PREPARING, children }: {
  initialAvailability?: PublicSubscriptionAvailability; children: ReactNode;
}) {
  const value = useFreshAvailability(parseSubscriptionAvailability(initialAvailability), false);
  return <AvailabilityContext.Provider value={value}>{children}</AvailabilityContext.Provider>;
}

export function useSubscriptionAvailability(initialAvailability = SUBSCRIPTION_PREPARING) {
  const shared = useContext(AvailabilityContext);
  const own = useFreshAvailability(parseSubscriptionAvailability(initialAvailability), shared !== null);
  return shared ?? own;
}
