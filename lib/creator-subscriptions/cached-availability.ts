import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { cacheableSubscriptionAvailability, type PublicSubscriptionAvailability, SUBSCRIPTION_RELEASE_VERSION } from './availability';
import { currentImplementationSha, launchConfigurationDigest, premiumConfigurationDigest } from './evidence';
import { subscriptionTermsApproved } from './evidence';

export const SUBSCRIPTION_AVAILABILITY_TAG = 'creator-subscription-status';
// Deployment/config identity prevents a previous deployment's open state surviving a rollback.
const identity = [currentImplementationSha() ?? 'unidentified', launchConfigurationDigest(), premiumConfigurationDigest(),
  process.env.VERCEL_ENV ?? '', process.env.CREATOR_SUBSCRIPTION_PUBLIC ?? 'off'];
/** Static marketing HTML and its structured answers share one versioned public projection. */
export const cachedSubscriptionAvailability = unstable_cache(
  async () => cacheableSubscriptionAvailability(await getSqlRunner()),
  ['creator-subscription-availability', SUBSCRIPTION_RELEASE_VERSION, ...identity],
  { tags: [SUBSCRIPTION_AVAILABILITY_TAG], revalidate: 3600 },
);

/** Browser reads share a short server cache; checkout always runs a fresh readiness check. */
export const publicSubscriptionAvailability = unstable_cache(
  async () => cacheableSubscriptionAvailability(await getSqlRunner()),
  ['creator-subscription-public-status', SUBSCRIPTION_RELEASE_VERSION, ...identity],
  { tags: [SUBSCRIPTION_AVAILABILITY_TAG], revalidate: 15 },
);

/** Public pages preview monthly information; this controls applicability, never publication alone.
 * The read rejects on an outage: nothing is stored, and ISR keeps the last good page (lib/db/read-policy.ts).
 */
export const cachedSubscriptionTermsApproved = unstable_cache(
  async () => subscriptionTermsApproved(await getSqlRunner()),
  ['creator-subscription-terms-approved', ...identity],
  { tags: [SUBSCRIPTION_AVAILABILITY_TAG], revalidate: 3600 },
);

/** Everything the pages under SUBSCRIPTION_AVAILABILITY_TAG say about subscriptions, as one comparable value. */
export type PublicSubscriptionAnswer = [availability: PublicSubscriptionAvailability, termsApproved: boolean];

/** The answer public pages were built from. */
export async function cachedPublicSubscriptionAnswer(): Promise<PublicSubscriptionAnswer> {
  return [await cachedSubscriptionAvailability(), await cachedSubscriptionTermsApproved()];
}

/** The answer a page built now would get, past the cache. Rejects on an outage, as the cached reads do. */
export async function freshPublicSubscriptionAnswer(sql: SqlRunner): Promise<PublicSubscriptionAnswer> {
  return [await cacheableSubscriptionAvailability(sql), await subscriptionTermsApproved(sql)];
}
