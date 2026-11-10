import type { Viewer } from '@/lib/auth/identity';
import type { PublicSubscriptionAvailability } from './availability';
import type { BillingEnvironment, SubscriptionPlanId } from './types';

export function subscriptionQaAllowed(viewer: Viewer, env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(viewer.userId && (viewer.isAdmin || viewer.review === true) && env.CREATOR_SUBSCRIPTION_QA === 'on');
}

export function mayEnrollSubscription(viewer: Viewer, planId: SubscriptionPlanId, availability: PublicSubscriptionAvailability,
  environment: BillingEnvironment, env: Record<string, string | undefined> = process.env, liveQaReady = false): boolean {
  if (!viewer.userId || availability.status === 'paused') return false;
  if (environment === 'live' && availability.plans[planId].status === 'open') return true;
  if (environment === 'live') return liveQaReady && subscriptionQaAllowed(viewer, env) && env.CREATOR_SUBSCRIPTION_LIVE_QA === 'on';
  return environment === 'test' && subscriptionQaAllowed(viewer, env);
}
