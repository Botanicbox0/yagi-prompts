import { createHash } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SUBSCRIPTION_PLANS, SUBSCRIPTION_PLAN_VERSION } from './plans';
import { SUBSCRIPTION_TERMS_VERSION } from './legal';
import { subscriptionLegalDocument } from './legal-projection';
import { LEGAL_DOCS } from '@/lib/legal/documents';
import { configuredPremiumEditLimit } from '@/lib/premium-editing/budget';
import { isSubscriptionSchemaError, subscriptionTablesExist } from './repo';

export function currentImplementationSha(env: Record<string, string | undefined> = process.env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}
export function subscriptionTermsDigest(): string {
  return createHash('sha256').update(JSON.stringify(LEGAL_DOCS.flatMap(doc =>
    (['ko', 'en'] as const).map(locale => ({ doc, locale, ...subscriptionLegalDocument(doc, locale, true) }))))).digest('hex');
}
/** Public configuration only. Never hash or record an API credential or billing key. */
export function launchConfigurationDigest(env: Record<string, string | undefined> = process.env): string {
  void env;
  return createHash('sha256').update(JSON.stringify({ planVersion: SUBSCRIPTION_PLAN_VERSION, plans: SUBSCRIPTION_PLANS,
    termsVersion: SUBSCRIPTION_TERMS_VERSION, termsDigest: subscriptionTermsDigest() })).digest('hex');
}
export function premiumConfigurationDigest(env: Record<string, string | undefined> = process.env): string {
  return createHash('sha256').update(JSON.stringify({ base: launchConfigurationDigest(env),
    editModel: env.PREMIUM_EDIT_MODEL?.trim() || 'gpt-5.6-sol', editLimit: configuredPremiumEditLimit(env),
    editEnabled: env.PREMIUM_EDITING_ENABLED === 'on' })).digest('hex');
}
/** Draft wording becomes applicable only after the founder/Director records this exact content. */
export async function subscriptionTermsApproved(sql: SqlRunner | null): Promise<boolean> {
  if (!sql) return false;
  try {
    if (!await subscriptionTablesExist(sql, 'creator_subscription_launch_evidence')) return false;
    return (await sql.query<{ approved: boolean }>(`select exists(select 1 from creator_subscription_launch_evidence
      where environment='live' and step='terms' and passed=true and plan_version=$1 and terms_version=$2 and evidence_digest=$3) as approved`,
      [SUBSCRIPTION_PLAN_VERSION, SUBSCRIPTION_TERMS_VERSION, subscriptionTermsDigest()])).rows[0]?.approved === true;
  } catch (err) {
    // An outage is not an answer. Rejecting keeps it out of unstable_cache (lib/db/read-policy.ts).
    if (isSubscriptionSchemaError(err)) return false;
    throw err;
  }
}
