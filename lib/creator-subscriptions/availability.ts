import type { SqlRunner } from '@/lib/db/sql-runner';
import { billingConfigFromEnv } from './gateway';
import { isSubscriptionSchemaError, subscriptionSchemaReady } from './repo';
import { SUBSCRIPTION_PLAN_VERSION } from './plans';
import { SUBSCRIPTION_TERMS_VERSION } from './legal';
import { subscriptionRenderSchemaReady } from '@/lib/premium-editing/repo';
import { configuredPremiumEditLimit } from '@/lib/premium-editing/budget';
import { premiumEditConfigFromEnv } from '@/lib/premium-editing/provider';
import { createBillingKeyCipher } from './crypto';
import { launchConfigurationDigest, premiumConfigurationDigest, subscriptionTermsDigest, currentImplementationSha } from './evidence';

export const SUBSCRIPTION_RELEASE_VERSION = 'creator-monthly-2026-10-09-v1';
export const SUBSCRIPTION_REQUIRED_STEPS = ['contract', 'costs', 'terms', 'registration', 'approval', 'renewal', 'cancellation', 'refund', 'render', 'worker'] as const;
// premium_editing is a separately verified, optional feature: Creator can open before Premium.
export type SubscriptionStatus = 'preparing' | 'open' | 'paused';
export interface SubscriptionEvidence {
  step: string; planVersion: string; releaseVersion: string; termsVersion: string; passed: boolean; verifiedAt?: string | Date;
  implementationSha?: string; configurationDigest?: string; evidenceDigest?: string;
}
export interface SubscriptionReadinessInput {
  requested: string | undefined; environment: string | undefined; billingEnvironment: 'test' | 'live' | null;
  cipherReady: boolean; schemaReady: boolean; renderReady: boolean; workerReady: boolean; premiumReady: boolean;
  evidence: SubscriptionEvidence[];
  implementationSha?: string | null; configurationDigest?: string;
}
export interface PublicSubscriptionAvailability {
  status: SubscriptionStatus; version: string;
  plans: { creator: { status: SubscriptionStatus }; premium: { status: SubscriptionStatus } };
  editing: 'preparing' | 'open';
  premiumEditRequestsPerPeriod?: number | null;
}
export const PREPARING_SUBSCRIPTION_AVAILABILITY: PublicSubscriptionAvailability = {
  status: 'preparing', version: SUBSCRIPTION_RELEASE_VERSION,
  plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing',
};

export function workerHeartbeatFresh(verifiedAt: string | Date | undefined, now=Date.now()): boolean {
  const age=verifiedAt ? now-new Date(verifiedAt).getTime() : Infinity;
  return age>=0 && age<3600_000;
}

/** Missing proof, mismatched versions, or test credentials can never authorize a live enrollment. */
export function evaluateSubscriptionAvailability(input: SubscriptionReadinessInput): PublicSubscriptionAvailability {
  const validProof = (step: string) => input.evidence.some(proof => proof.step === step && proof.passed &&
    proof.planVersion === SUBSCRIPTION_PLAN_VERSION && proof.releaseVersion === SUBSCRIPTION_RELEASE_VERSION && proof.termsVersion === SUBSCRIPTION_TERMS_VERSION &&
    Boolean(input.implementationSha) && proof.implementationSha === input.implementationSha && proof.configurationDigest === input.configurationDigest &&
    (step !== 'terms' || proof.evidenceDigest === subscriptionTermsDigest()));
  const ready = input.requested === 'on' && input.environment === 'production' && input.billingEnvironment === 'live' &&
    Boolean(input.configurationDigest && /^[0-9a-f]{64}$/.test(input.configurationDigest)) &&
    input.cipherReady && input.schemaReady && input.renderReady && input.workerReady && SUBSCRIPTION_REQUIRED_STEPS.every(validProof);
  const status: SubscriptionStatus = input.requested === 'paused' ? 'paused' : ready ? 'open' : 'preparing';
  const premiumStatus = status === 'open' && !input.premiumReady ? 'preparing' : status;
  return { status, version: SUBSCRIPTION_RELEASE_VERSION, plans: { creator: { status }, premium: { status: premiumStatus } }, editing: premiumStatus === 'open' ? 'open' : 'preparing' };
}

/** Public output contains only status/version. Deployment credentials and evidence stay on the server. */
export async function getCreatorSubscriptionAvailability(sql: SqlRunner | null, env: NodeJS.ProcessEnv = process.env): Promise<PublicSubscriptionAvailability> {
  if (!sql) return env.CREATOR_SUBSCRIPTION_PUBLIC === 'paused' ? evaluateSubscriptionAvailability({ requested: 'paused', environment: env.VERCEL_ENV, billingEnvironment: null, cipherReady: false, schemaReady: false, renderReady: false, workerReady: false, premiumReady: false, evidence: [] }) : PREPARING_SUBSCRIPTION_AVAILABILITY;
  try {
    const config = billingConfigFromEnv(env);
    const schemaReady = await subscriptionSchemaReady(sql) && await subscriptionRenderSchemaReady(sql);
    const evidenceExists = (await sql.query<{ ready: boolean }>(`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='creator_subscription_launch_evidence' and c.relrowsecurity and c.relforcerowsecurity
      and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
      and not has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE') and not has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE')
      and not exists(select 1 from pg_policy policy where policy.polrelid=c.oid)
      and has_table_privilege('service_role',c.oid,'SELECT') and has_table_privilege('service_role',c.oid,'INSERT') and has_table_privilege('service_role',c.oid,'UPDATE')) as ready`)).rows[0]?.ready === true;
    const evidence = evidenceExists ? (await sql.query<SubscriptionEvidence>(`select step, plan_version as "planVersion", release_version as "releaseVersion", terms_version as "termsVersion", passed, verified_at as "verifiedAt",
      implementation_sha as "implementationSha", configuration_digest as "configurationDigest", evidence_digest as "evidenceDigest" from creator_subscription_launch_evidence where environment='live'`)).rows : [];
    const key = env.TOSS_BILLING_ENCRYPTION_KEY?.trim();
    const cipherReady = Boolean(key && createBillingKeyCipher(key));
    const catalogReady = (await sql.query<{ ready: boolean }>(`select exists(select 1 from prompt_items where status='published' and medium='video' and audience='public' and (price_cents>0 or price_krw>0)
      and runtime_seconds between 4 and 30 and (engine='seedance-2.5' or ((engine is null or engine='seedance-2.0') and runtime_seconds>15))) as ready`)).rows[0]?.ready === true;
    const renderReady = catalogReady && Boolean(env.ARK_API_KEY?.trim() && env.ARK_ACCESS_KEY?.trim() && env.ARK_SECRET_KEY?.trim());
    const implementationSha = currentImplementationSha(env);
    const configurationDigest = launchConfigurationDigest(env);
    const premiumEditLimit = configuredPremiumEditLimit(env);
    const premiumReady = Boolean(premiumEditConfigFromEnv(env) && env.PREMIUM_EDITING_ENABLED === 'on' && premiumEditLimit && premiumEditLimit >= 30 && evidence.some(e => e.step === 'premium_editing' && e.passed && e.planVersion === SUBSCRIPTION_PLAN_VERSION && e.releaseVersion === SUBSCRIPTION_RELEASE_VERSION && e.termsVersion === SUBSCRIPTION_TERMS_VERSION && e.implementationSha === implementationSha && e.configurationDigest === premiumConfigurationDigest(env)));
    const heartbeat = evidence.find(e => e.step === 'worker' && e.passed && e.planVersion === SUBSCRIPTION_PLAN_VERSION && e.releaseVersion === SUBSCRIPTION_RELEASE_VERSION && e.termsVersion === SUBSCRIPTION_TERMS_VERSION);
    const workerReady = Boolean(env.CRON_SECRET?.trim()) && workerHeartbeatFresh(heartbeat?.verifiedAt);
    return { ...evaluateSubscriptionAvailability({ requested: env.CREATOR_SUBSCRIPTION_PUBLIC, environment: env.VERCEL_ENV, billingEnvironment: config?.kind ?? null, cipherReady, schemaReady, renderReady, workerReady, premiumReady, evidence, implementationSha, configurationDigest }), premiumEditRequestsPerPeriod: premiumEditLimit };
  } catch {
    // Older installations retain their one-time flow until every new migration has landed.
    return PREPARING_SUBSCRIPTION_AVAILABILITY;
  }
}

function recordingOutages(sql: SqlRunner, outages: unknown[]): SqlRunner {
  return {
    async query<T>(text: string, params?: unknown[]) {
      try {
        return await sql.query<T>(text, params);
      } catch (err) {
        if (!isSubscriptionSchemaError(err)) outages.push(err);
        throw err;
      }
    },
    transaction: fn => sql.transaction(tx => fn(recordingOutages(tx, outages))),
  };
}

/**
 * The fresh read above, for a result that will be cached. A database that failed to answer gave no
 * answer, so this rejects and `unstable_cache` stores nothing (lib/db/read-policy.ts): the last good
 * answer stays up, instead of an hour of "preparing" over an open launch.
 *
 * A pool timeout and a bad billing key are both plain Errors, and the bad key must stay `preparing`.
 * So the runner records what the database did, rather than this reading messages after the catch.
 */
export async function cacheableSubscriptionAvailability(sql: SqlRunner | null, env: NodeJS.ProcessEnv = process.env): Promise<PublicSubscriptionAvailability> {
  const outages: unknown[] = [];
  const availability = await getCreatorSubscriptionAvailability(sql && recordingOutages(sql, outages), env);
  if (outages.length > 0) throw outages[0];
  return availability;
}
