import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { getCreatorSubscriptionAvailability, SUBSCRIPTION_RELEASE_VERSION } from './availability';
import { currentImplementationSha, launchConfigurationDigest, premiumConfigurationDigest } from './evidence';
import { subscriptionTermsApproved } from './evidence';

export const SUBSCRIPTION_AVAILABILITY_TAG = 'creator-subscription-status';
// Deployment/config identity prevents a previous deployment's open state surviving a rollback.
const identity = [currentImplementationSha() ?? 'unidentified', launchConfigurationDigest(), premiumConfigurationDigest(),
  process.env.VERCEL_ENV ?? '', process.env.CREATOR_SUBSCRIPTION_PUBLIC ?? 'off'];
/** Static marketing HTML and its structured answers share one versioned public projection. */
export const cachedSubscriptionAvailability = unstable_cache(
  async () => getCreatorSubscriptionAvailability(await getSqlRunner()),
  ['creator-subscription-availability', SUBSCRIPTION_RELEASE_VERSION, ...identity],
  { tags: [SUBSCRIPTION_AVAILABILITY_TAG], revalidate: 3600 },
);

/** Browser reads share a short server cache; checkout always runs a fresh readiness check. */
export const publicSubscriptionAvailability = unstable_cache(
  async () => getCreatorSubscriptionAvailability(await getSqlRunner()),
  ['creator-subscription-public-status', SUBSCRIPTION_RELEASE_VERSION, ...identity],
  { tags: [SUBSCRIPTION_AVAILABILITY_TAG], revalidate: 15 },
);

/** Legal pages remain static/indexable and change only after approval of the exact published text. */
export const cachedSubscriptionTermsApproved = unstable_cache(
  async () => subscriptionTermsApproved(await getSqlRunner()),
  ['creator-subscription-terms-approved', ...identity],
  { tags: [SUBSCRIPTION_AVAILABILITY_TAG], revalidate: 3600 },
);
