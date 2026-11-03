import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { AdminShell, Panel } from '@/components/admin/chrome';
import { AdminPageHeader, StatusPill } from '@/components/admin/patterns';
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
    <AdminPageHeader
      eyebrow={dict.adminConsole.nav.subscriptions}
      title={copy.title}
      lede={copy.description}
      actions={
        <span data-subscription-launch={availability.status}>
          <StatusPill
            tone={availability.status === 'open' ? 'action' : availability.status === 'paused' ? 'hold' : 'done'}
          >
            {availability.status === 'open' ? copy.open : availability.status === 'paused' ? copy.paused : copy.closed}
          </StatusPill>
        </span>
      }
    />
    <nav className="admin-filter-links mt-6 flex gap-2 text-sm">{(['test', 'live'] as const).map(stage => <a key={stage} href={`/admin/subscriptions?environment=${stage}`} aria-current={environment === stage ? 'page' : undefined} className="admin-filter-link">{copy[stage]}</a>)}</nav>
    <Panel title={copy.version}>
      <dl className="grid gap-3 font-mono text-xs sm:grid-cols-3">
        <div><dt className="opacity-60">{copy.version}</dt><dd className="mt-1 break-all">{SUBSCRIPTION_PLAN_VERSION} · {SUBSCRIPTION_RELEASE_VERSION} · {SUBSCRIPTION_TERMS_VERSION}</dd></div>
        <div><dt className="opacity-60">{copy.commit}</dt><dd className="mt-1 break-all">{sha ?? copy.implementationMissing}</dd></div>
        <div><dt className="opacity-60">{copy.digest}</dt><dd className="mt-1 break-all">{terms}</dd></div>
      </dl>
      <a href="/billing/subscription/terms" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-9 items-center text-sm text-accent underline underline-offset-4">{copy.terms} ↗</a>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed opacity-65">{copy.workerNote}</p><p className="mt-2 max-w-3xl text-sm leading-relaxed opacity-65">{copy.approvalsNote}</p><p className="mt-2 text-sm opacity-65">{copy.keysNote}</p>
    </Panel>
    {reviewCount !== null && <section data-subscription-payment-reviews className="admin-panel mt-6"><h2 className="text-lg font-semibold">{copy.reviewTitle}</h2><p className="mt-2 text-sm font-medium">{interpolate(copy.reviewCount, { count: formatCount(reviewCount, locale) })}</p><p className="mt-2 max-w-3xl text-sm leading-relaxed opacity-65">{copy.reviewHint}</p></section>}
    {!ready ? <p role="status" className="admin-panel mt-6 text-sm">{copy.databaseMissing}</p> : <ul className="admin-panel mt-6 divide-y divide-black/10">{([...SUBSCRIPTION_REQUIRED_STEPS, 'premium_editing'] as const).map(step => {
      const config = step === 'premium_editing' ? premiumConfigurationDigest() : launchConfigurationDigest();
      const proof = proofs.find(row => row.step === step);
      const passed = proof?.passed && proof.implementation_sha === sha && proof.configuration_digest === config && (step !== 'terms' || proof.evidence_digest === terms)
        && (step !== 'worker' || workerHeartbeatFresh(proof.verified_at));
      return <li key={step} data-subscription-evidence={step} className="flex items-start justify-between gap-5 py-4 first:pt-0 last:pb-0"><span className="text-sm font-medium">{copy.steps[step]}</span><StatusPill tone={passed ? 'action' : 'hold'}>{passed ? copy.passed : copy.waiting}</StatusPill></li>;
    })}</ul>}
  </AdminShell>;
}
