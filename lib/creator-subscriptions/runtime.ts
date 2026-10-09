import 'server-only';
import { getSqlRunner } from '@/lib/db/connect';
import { billingConfigFromEnv, createSubscriptionGateway } from './gateway';
import { createBillingKeyCipher } from './crypto';
import { subscriptionSchemaReady } from './repo';
import { SUBSCRIPTION_TERMS_VERSION } from './legal';
import { getCreatorSubscriptionAvailability } from './availability';
import type { SubscriptionDeps } from './types';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { subscriptionRenderSchemaReady } from '@/lib/premium-editing/repo';
import { SUBSCRIPTION_PLAN_VERSION } from './plans';
import { SUBSCRIPTION_RELEASE_VERSION } from './availability';
import { configuredPremiumEditLimit } from '@/lib/premium-editing/budget';
import { premiumEditConfigFromEnv } from '@/lib/premium-editing/provider';
import { currentImplementationSha, launchConfigurationDigest, subscriptionTermsDigest } from './evidence';

export async function getSubscriptionContext() {
  try {
    const config = billingConfigFromEnv();
    const key = process.env.TOSS_BILLING_ENCRYPTION_KEY?.trim();
    if (!config || !key) return null;
    const cipher = createBillingKeyCipher(key);
    const sql = await getSqlRunner();
    if (!sql || !await subscriptionSchemaReady(sql)) return null;
    const deps: SubscriptionDeps = { sql, gateway: createSubscriptionGateway(config), cipher, environment: config.kind, consentVersion: SUBSCRIPTION_TERMS_VERSION, premiumEditLimit: configuredPremiumEditLimit() };
    return { ...deps, clientKey: config.clientKey };
  } catch { return null; }
}

export async function liveSubscriptionAvailability() {
  return getCreatorSubscriptionAvailability(await getSqlRunner());
}

/** A pause closes new enrollment, while already-paid members retain the verified editing feature. */
export async function premiumEditingOperational(sql: SqlRunner, environment: 'test' | 'live'): Promise<boolean> {
  if (!premiumEditConfigFromEnv() || process.env.PREMIUM_EDITING_ENABLED !== 'on') return false;
  try {
    if (!await subscriptionRenderSchemaReady(sql)) return false;
    if (environment === 'test') return process.env.CREATOR_SUBSCRIPTION_QA === 'on';
    const { rows } = await sql.query<{ ready: boolean }>(`select exists(select 1 from creator_subscription_launch_evidence
      where environment='live' and step='premium_editing' and passed=true and plan_version=$1 and release_version=$2 and terms_version=$3) as ready`,
      [SUBSCRIPTION_PLAN_VERSION, SUBSCRIPTION_RELEASE_VERSION, SUBSCRIPTION_TERMS_VERSION]);
    return rows[0]?.ready === true;
  } catch { return false; }
}

/** Live QA is an explicit founder action after the recurring contract and exact terms are approved. */
export async function subscriptionLiveQaReady(sql: SqlRunner,env:Record<string,string|undefined>=process.env): Promise<boolean> {
  const sha=currentImplementationSha(env);
  if (env.VERCEL_ENV !== 'production' || !sha) return false;
  try {
    const { rows } = await sql.query<{ ready: boolean }>(`select count(distinct step)=3 as ready from creator_subscription_launch_evidence
      where environment='live' and step in ('contract','costs','terms') and passed=true and plan_version=$1 and release_version=$2 and terms_version=$3
      and implementation_sha=$4 and configuration_digest=$5 and (step<>'terms' or evidence_digest=$6)`,
      [SUBSCRIPTION_PLAN_VERSION, SUBSCRIPTION_RELEASE_VERSION, SUBSCRIPTION_TERMS_VERSION,sha,launchConfigurationDigest(env),subscriptionTermsDigest()]);
    return rows[0]?.ready === true;
  } catch { return false; }
}

export const SUBSCRIPTION_HEADERS = {
  'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
};
