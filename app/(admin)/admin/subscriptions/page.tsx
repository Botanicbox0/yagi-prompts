import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { AdminShell } from '@/components/admin/chrome';
import { getCreatorSubscriptionAvailability, workerHeartbeatFresh, SUBSCRIPTION_REQUIRED_STEPS, SUBSCRIPTION_RELEASE_VERSION } from '@/lib/creator-subscriptions/availability';
import { SUBSCRIPTION_PLAN_VERSION } from '@/lib/creator-subscriptions/plans';
import { SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { currentImplementationSha, launchConfigurationDigest, premiumConfigurationDigest, subscriptionTermsDigest } from '@/lib/creator-subscriptions/evidence';
import { formatCount, interpolate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';
type Proof = { step: string; passed: boolean; implementation_sha: string; configuration_digest: string; evidence_digest: string; verified_at:string|Date };
/** Read-only audit. Recording contract/terms approvals remains with the founder/Director. */
export default async function SubscriptionReadinessPage({ searchParams }: { searchParams: Promise<{ environment?: string }> }) {
  await requireAdmin();
  const [locale, sql, params] = await Promise.all([getLocaleFromHeaders(), getSqlRunner(), searchParams]);
  const dict = getDictionary(locale); const copy = dict.creatorLaunch;
  const environment = params.environment === 'live' ? 'live' : 'test';
  const sha = currentImplementationSha(); const terms = subscriptionTermsDigest();
  const availability = await getCreatorSubscriptionAvailability(sql);
  let proofs: Proof[] = []; let ready = false;
  let reviewCount: number | null = null;
  try {
    if (sql) { proofs = (await sql.query<Proof>(`select step,passed,implementation_sha,configuration_digest,evidence_digest,verified_at from creator_subscription_launch_evidence
      where environment=$1 and plan_version=$2 and release_version=$3 and terms_version=$4`, [environment, SUBSCRIPTION_PLAN_VERSION, SUBSCRIPTION_RELEASE_VERSION, SUBSCRIPTION_TERMS_VERSION])).rows; ready = true; }
  } catch { /* Missing optional migrations are a visible preparing state. */ }
  try {
    if (sql) reviewCount = (await sql.query<{ count: number }>(`select count(*)::int as count from creator_subscription_periods
      where environment=$1 and status='failed' and failure_code in ('charge_exhausted_review','provider_review_required')`, [environment])).rows[0]?.count ?? null;
  } catch { /* Never show a missing table or failed read as zero incidents. */ }
  return <AdminShell dict={dict.admin} locale={locale} active="subscriptions">
    <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed opacity-70">{copy.description}</p>
    <p data-subscription-launch={availability.status} className="mt-5 font-semibold text-accent">{availability.status === 'open' ? copy.open : availability.status === 'paused' ? copy.paused : copy.closed}</p>
    <nav className="mt-6 flex gap-5 text-sm">{(['test', 'live'] as const).map(stage => <a key={stage} href={`/admin/subscriptions?environment=${stage}`} aria-current={environment === stage ? 'page' : undefined} className="min-h-11 underline underline-offset-4">{copy[stage]}</a>)}</nav>
    <dl className="mt-6 space-y-3 border-y border-hairline py-5 text-xs">
      <div><dt className="opacity-60">{copy.version}</dt><dd className="mt-1 break-all">{SUBSCRIPTION_PLAN_VERSION} · {SUBSCRIPTION_RELEASE_VERSION} · {SUBSCRIPTION_TERMS_VERSION}</dd></div>
      <div><dt className="opacity-60">{copy.commit}</dt><dd className="mt-1 break-all">{sha ?? copy.implementationMissing}</dd></div>
      <div><dt className="opacity-60">{copy.digest}</dt><dd className="mt-1 break-all">{terms}</dd></div>
    </dl>
    <a href="/billing/subscription/terms" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.terms} ↗</a>
    <p className="mt-3 max-w-3xl text-sm leading-relaxed opacity-65">{copy.workerNote}</p><p className="mt-2 max-w-3xl text-sm leading-relaxed opacity-65">{copy.approvalsNote}</p><p className="mt-2 text-sm opacity-65">{copy.keysNote}</p>
    {reviewCount !== null && <section data-subscription-payment-reviews className="mt-7 rounded-xl border border-hairline p-5"><h2 className="text-lg font-semibold">{copy.reviewTitle}</h2><p className="mt-2 text-sm font-medium">{interpolate(copy.reviewCount, { count: formatCount(reviewCount, locale) })}</p><p className="mt-2 max-w-3xl text-sm leading-relaxed opacity-65">{copy.reviewHint}</p></section>}
    {!ready ? <p role="status" className="mt-7 border border-hairline p-5 text-sm">{copy.databaseMissing}</p> : <ul className="mt-7 divide-y divide-black/10 border-y border-hairline">{([...SUBSCRIPTION_REQUIRED_STEPS, 'premium_editing'] as const).map(step => {
      const config = step === 'premium_editing' ? premiumConfigurationDigest() : launchConfigurationDigest();
      const proof = proofs.find(row => row.step === step);
      const passed = proof?.passed && proof.implementation_sha === sha && proof.configuration_digest === config && (step !== 'terms' || proof.evidence_digest === terms)
        && (step !== 'worker' || workerHeartbeatFresh(proof.verified_at));
      return <li key={step} data-subscription-evidence={step} className="flex items-start justify-between gap-5 py-5"><span className="text-sm font-medium">{copy.steps[step]}</span><span className="shrink-0 text-xs opacity-65">{passed ? copy.passed : copy.waiting}</span></li>;
    })}</ul>}
  </AdminShell>;
}
