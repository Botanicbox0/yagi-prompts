import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioEnv } from '@/lib/brand-studio/env';
import { STUDIO_LANES } from '@/lib/brand-studio/models';
import { loadStudioBrandAccess, loadBrandSupport, loadStudioWorkspace } from '@/lib/brands/workspace/service';
import { loadProductionWorkspace } from '@/lib/brands/production/service';
import { ProductionAdmin } from '@/components/brand-workspace/production-admin';
import { ManagedForm } from '@/components/brand-workspace/managed-form';
import { formatBrandTimestamp } from '@/components/brand-workspace/format';
import { BrandAvatar } from '@/components/brand-workspace/brand-avatar';
import { BRAND_FEATURES } from '@/lib/brands/features';
import { loadFeaturePolicy } from '@/lib/brands/entitlements';
import { listLooks, listMemory, loadBrandIdentity, twingsDefaultIdentity } from '@/lib/brands/identity/service';
import { BRAND_BILLING_MODES, BRAND_PLAN_IDS, BRAND_PLANS, loadPlanAssignment } from '@/lib/brands/plans';
import {
  kstDayOf,
  kstMonthOf,
  nextKstMonthOf,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
} from '@/lib/brands/billing/math';
import { isSandboxedClientOrganization } from '@/lib/brands/features';
import { MICRO_ROI_MODES } from '@/lib/brands/finish/micro-roi';
import { BRAND_LOOK_PRESET_IDS } from '@/lib/brands/finish/color-grading';
import { resolveCategoryExperienceProfile } from '@/lib/brands/category-experience';
import { BrandStorageQuotaPanel } from '@/lib/admin/brand-storage-quota-panel';
import { loadOrganizationSupportSyncMode } from '@/lib/brands/team-notice-inbox';
import { loadOrganizationStorageSummary } from '@/lib/brands/storage-quota';
import { formatStorageBytes } from '@/lib/brands/storage-quota-format';
import { loadBrandOrgDetailOps, ORG_JOB_STATUSES, orgJobStatusFilter } from '@/lib/admin/brand-org-detail';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import { formatAdminTime, formatCount, formatKrw, shortId } from '@/lib/admin/format';
import { interpolate } from '@/lib/i18n/format';
import {
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  ConfirmCheck,
  INPUT,
  OpForm,
  OutcomeBanner,
  Panel,
} from '@/components/admin/chrome';
import {
  AdminPageHeader,
  AdminTable,
  FilterPills,
  MetricStrip,
  SectionJumpBar,
  StatusPill,
} from '@/components/admin/patterns';
import '@/app/(brand)/workspace.css';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function StudioOrganization({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const [{ id }, queryParams, viewer, sql, locale] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as SearchParams),
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
  ]);
  const dict = getDictionary(locale);
  const b = dict.brandWorkspace;
  const c = b.managed;
  const be = dict.adminConsole.brandEngine;
  const od = dict.adminConsole.brandOrgDetail;
  const sCopy = dict.adminConsole.supportInbox;
  if (!sql) return <p role="alert">{b.unavailable}</p>;

  const org = await loadStudioBrandAccess({ sql }, viewer, id);
  if (!org) notFound();

  const jobStatus = orgJobStatusFilter(queryParams.jobStatus);
  const env = studioEnv();
  const now = new Date();
  const todayKst = kstDayOf(now);
  const currentMonth = kstMonthOf(now);
  const nextMonth = nextKstMonthOf(now);
  const backUrl = `/admin/brand-workspace/organizations/${encodeURIComponent(id)}`;

  const [
    messages,
    previewsRes,
    production,
    allWorkspace,
    policy,
    plan,
    brandIdentity,
    looks,
    memoryEvents,
    supportSync,
    storageSummary,
    detailOps,
  ] = await Promise.all([
    loadBrandSupport({ sql }, viewer, id, true).then((r) => r ?? []),
    sql.query<{ id: string; project_id: string; name: string }>(
      "select id,project_id,name from brand_attachments where organization_id=$1 and status='ready' and access_scope='workspace' and (mime like 'image/%' or mime like 'video/%')",
      [id],
    ),
    loadProductionWorkspace({ sql }, viewer, id, true),
    loadStudioWorkspace({ sql }, viewer),
    loadFeaturePolicy(sql, id),
    loadPlanAssignment(sql, id),
    loadBrandIdentity(sql, id),
    listLooks(sql, id),
    listMemory(sql, id, 12),
    loadOrganizationSupportSyncMode(sql, id),
    loadOrganizationStorageSummary(sql, id).catch(() => null),
    loadBrandOrgDetailOps(sql, viewer, id, { jobStatus, env, now }),
  ]);

  const previews = previewsRes.rows;
  const projects = allWorkspace.projects.filter((p) => p.organizationId === id);
  const activeIdentity = brandIdentity?.identity ?? twingsDefaultIdentity();
  const categoryProfile = resolveCategoryExperienceProfile({ organizationName: org.name });
  const graceDays = env.planGraceDays ?? 7;
  const planStatus = planActiveWithGrace(plan, todayKst, graceDays);

  const rawOk = one(queryParams, 'ok');
  const rawDetail = one(queryParams, 'detail');
  const startPreviewMatch =
    rawOk === 'prepared' && rawDetail
      ? /^(b2b_(?:29|49|69))\|(\d{4}-\d{2}-\d{2})\|early=(0|1)\b/.exec(rawDetail)
      : null;
  const startPreviewPlan = startPreviewMatch?.[1];
  const startPreviewDate = startPreviewMatch?.[2];
  const startPreviewEarly = startPreviewMatch?.[3] === '1';
  const isReissuePreview = rawOk === 'prepared' && Boolean(rawDetail?.startsWith('reissue='));
  // Review round 2, item 9: step 2 sends back the digest the preview returned.
  const previewDigestToken = rawOk === 'prepared' ? /digest=([0-9a-f]{16})\b/.exec(rawDetail ?? '')?.[1] : undefined;
  const startPreviewDigest = startPreviewMatch ? previewDigestToken : undefined;
  // Round 3, item 1: the start preview warns about a first-invoice payment window under 3 days.
  const startShortWindow = Boolean(startPreviewMatch && rawDetail?.includes('short_window=1'));
  const reissuePreviewDigest = isReissuePreview ? previewDigestToken : undefined;
  // Round 4, B9: the reissue preview carries the same short-payment-window warning as the start preview.
  const reissueShortWindow = Boolean(isReissuePreview && rawDetail?.includes('short_window=1'));

  const formattedDetail = formatBillingOutcomeDetail(rawDetail, locale === 'en' ? 'en' : 'ko');
  const defaultAllowanceMode = detailOps?.allowanceRow
    ? detailOps.allowanceRow.isOverride === false
      ? 'plan_default'
      : 'override'
    : plan
      ? 'plan_default'
      : 'override';
  const defaultCapInput =
    detailOps?.allowanceRow?.isOverride === true ? detailOps.allowanceRow.monthlyCapKrw : '';

  const jobStatusTone = (st: string) =>
    st === 'succeeded' ? 'done' : st === 'failed' ? 'fail' : st === 'canceled' || st === 'held' ? 'hold' : 'progress';
  const invoiceStatusTone = (st: string, overdue: boolean) =>
    st === 'paid' ? 'done' : overdue ? 'fail' : st === 'issued' ? 'action' : st === 'void' ? 'hold' : 'progress';
  const subPanel = detailOps?.subscriptionPanel ?? null;
  const sub = subPanel?.subscription ?? null;
  const isSandboxedOrg = isSandboxedClientOrganization(org);
  const subStatusTone = (st: string) =>
    st === 'active' ? 'done' : st === 'past_due' ? 'action' : st === 'suspended' ? 'fail' : 'hold';

  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <AdminPageHeader
        back={{ href: '/admin/brand-workspace', label: b.back }}
        title={org.name}
        status={
          <StatusPill
            tone={
              brandIdentity?.status === 'confirmed'
                ? 'action'
                : brandIdentity
                  ? 'progress'
                  : 'hold'
            }
          >
            {brandIdentity ? `${be.dnaStatus[brandIdentity.status]} · r${brandIdentity.revision}` : be.dnaStatus.none}
          </StatusPill>
        }
        lede={c.access}
      />

      <OutcomeBanner
        dict={{
          ...dict.admin,
          okPrepared: isReissuePreview
            ? od.billing.subscriptionReissuePreviewedBanner
            : od.billing.subscriptionPreviewedBanner,
        }}
        ok={rawOk}
        err={one(queryParams, 'err')}
        detail={formattedDetail}
        showDetailForOk
      />

      <SectionJumpBar
        label={dict.adminConsole.location}
        items={[
          { id: 'overview', label: od.sections.overview },
          {
            id: 'billing',
            label: od.sections.billing,
            count: detailOps?.invoices.length ?? 0,
            tone: detailOps?.invoices.some((inv) => inv.overdue) ? 'fail' : undefined,
          },
          {
            id: 'brand-members',
            label: od.sections.members,
            count: org.members.length + org.invitations.length,
          },
          {
            id: 'studio-jobs',
            label: od.sections.jobs,
            count: detailOps?.studioJobs.length ?? 0,
            tone: detailOps?.studioJobs.some((j) => j.status === 'failed') ? 'fail' : undefined,
          },
          {
            id: 'support',
            label: od.sections.messages,
            count: messages.length,
          },
          {
            id: 'history',
            label: od.sections.history,
            count: detailOps?.history.length ?? 0,
          },
        ]}
      />

      <section id="overview" className="admin-section" data-org-overview>
        <MetricStrip
          label={od.sections.overview}
          items={[
            {
              key: 'plan',
              label: od.overview.planCard,
              value: plan ? b.planNames[plan.planId] : be.planUnassigned,
              sub: plan
                ? [
                    `${formatKrw(BRAND_PLANS[plan.planId].monthlyKrw, locale)} · ${b.billingModes[plan.billingMode]}`,
                    planStatus.inGrace
                      ? interpolate(od.overview.graceSuffix, { date: plan.endsOn ?? '' })
                      : plan.endsOn
                        ? interpolate(od.overview.endsSuffix, { date: plan.endsOn })
                        : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : c.planNone,
              tone: !plan ? 'hold' : planStatus.inGrace ? 'action' : planStatus.active ? 'done' : 'fail',
            },
            {
              key: 'allowance',
              label: od.overview.allowanceCard,
              value: detailOps?.allowance
                ? `${formatKrw(detailOps.allowance.usedKrw, locale)} / ${formatKrw(detailOps.allowance.capKrw, locale)}`
                : '—',
              sub: detailOps?.allowance
                ? `${dict.adminConsole.brandOrgList.sources[detailOps.allowance.source]} · ${interpolate(od.overview.extraSuffix, {
                    base: formatKrw(detailOps.allowance.baseCapKrw, locale),
                    extra: formatKrw(detailOps.allowance.extraKrw, locale),
                  })}`
                : od.billing.unavailable,
              tone:
                detailOps?.allowance && detailOps.allowance.capKrw > 0 && detailOps.allowance.usedKrw * 100 >= detailOps.allowance.capKrw * 80
                  ? 'action'
                  : undefined,
            },
            {
              key: 'discount',
              label: od.overview.discountCard,
              value: detailOps?.activeDiscount
                ? detailOps.activeDiscount.invoicesRemaining === null
                  ? `${detailOps.activeDiscount.percent}%`
                  : `${detailOps.activeDiscount.percent}% (${detailOps.activeDiscount.invoicesRemaining})`
                : od.overview.discountNone,
              sub: detailOps?.activeDiscount?.memo || undefined,
              tone: detailOps?.activeDiscount ? 'action' : undefined,
            },
            {
              key: 'storage',
              label: od.overview.storageCard,
              value: storageSummary
                ? `${formatStorageBytes(storageSummary.usedBytes, locale)} / ${formatStorageBytes(storageSummary.effectiveQuotaBytes, locale)}`
                : od.overview.storageUnavailable,
              sub: storageSummary
                ? `${storageSummary.usagePercent}% · ${policy.denied.length === 0 ? be.allOpen : interpolate(be.blockedCount, { count: String(policy.denied.length) })}`
                : undefined,
              tone: storageSummary?.state === 'exceeded' ? 'fail' : storageSummary?.state === 'near_limit' ? 'action' : undefined,
            },
          ]}
        />

        <div id="brand-entitlements" className="bw-grid-wide mt-4">
          <BrandStorageQuotaPanel sql={sql} organizationId={id} b={b} locale={locale} />
          <section className="bw-panel" data-brand-feature-policy>
            <h2>{c.featurePolicy}</h2>
            <p className="bw-muted">{c.featurePolicyHint}</p>
            <p data-brand-feature-policy-state={policy.denied.length}>
              {policy.denied.length === 0
                ? c.featurePolicyOpen
                : interpolate(c.featurePolicyClosed, { count: String(policy.denied.length) })}
            </p>
            <ManagedForm op="brandEngine.featurePolicy" b={b} submit={c.featurePolicySave}>
              <input type="hidden" name="organizationId" value={id} />
              <input type="hidden" name="expectedRevision" value={policy.revision} />
              <fieldset className="bw-fields">
                {BRAND_FEATURES.map((feature) => (
                  <label key={feature} className="bw-check">
                    <input type="checkbox" name="denied" value={feature} defaultChecked={policy.denied.includes(feature)} />
                    {b.features[feature]}
                  </label>
                ))}
              </fieldset>
              <label>
                {c.featurePolicyNote}
                <input name="note" defaultValue={policy.note} maxLength={500} />
              </label>
            </ManagedForm>
          </section>
        </div>

        {/* S1–S5 Structured Brand Engine & Identity DNA Inspector */}
        <section id="brand-dna-inspector" className="admin-spec-card mt-4" data-brand-identity-inspector>
          <div className="admin-spec-head">
            <div>
              <h2>{be.inspectorHeading}</h2>
              <p className="admin-field-hint mt-1">{be.inspectorLede}</p>
            </div>
            <StatusPill tone={brandIdentity?.status === 'confirmed' ? 'action' : 'progress'}>
              {brandIdentity ? `${be.dnaStatus[brandIdentity.status]} (r${brandIdentity.revision})` : `${be.dnaStatus.none} (TWINGS Default)`}
            </StatusPill>
          </div>
          <div className="admin-card-grid">
            <div className="admin-subcard" data-dna-colour-world>
              <h3>{be.colourWorld}</h3>
              <div className="admin-swatch-row">
                {(
                  [
                    ['Paper', activeIdentity.colour.paper],
                    ['Canvas', activeIdentity.colour.canvas],
                    ['Ink', activeIdentity.colour.ink],
                    ['Accent', activeIdentity.colour.accent],
                  ] as const
                ).map(([name, hex]) => (
                  <span key={name} className="admin-swatch">
                    <span className="admin-swatch-chip" style={{ backgroundColor: hex }} aria-hidden="true" />
                    <span>
                      {name} <code>{hex}</code>
                    </span>
                  </span>
                ))}
              </div>
              <p className="mt-2.5">
                Hue {activeIdentity.world.ownedHue[0]}°–{activeIdentity.world.ownedHue[1]}° · Warm max{' '}
                {activeIdentity.world.warmPerScreen} · Skin lock {String(activeIdentity.world.skinProtected)}
              </p>
            </div>
            <div className="admin-subcard" data-dna-hardlines>
              <h3>{be.hardlines}</h3>
              <p>
                <strong>{be.forbiddenWords}:</strong>{' '}
                {activeIdentity.rules.forbiddenTerms.length > 0 ? activeIdentity.rules.forbiddenTerms.join(', ') : '—'}
              </p>
              <p>
                <strong>Never:</strong> {activeIdentity.rules.never.length > 0 ? activeIdentity.rules.never.join(' · ') : '—'}
              </p>
              <p>
                <strong>Logo:</strong> min {activeIdentity.rules.logo.minSizePx}px · clear {activeIdentity.rules.logo.clearSpace} · faces consented only
              </p>
            </div>
            <div className="admin-subcard" data-dna-model-roles>
              <h3>{be.modelRouting}</h3>
              <p>
                <strong>Category Profile:</strong> {categoryProfile.labelKo} ({categoryProfile.category}) ·{' '}
                {categoryProfile.compiler.defaultOledLookId} ({categoryProfile.compiler.defaultLightColourK}K)
              </p>
              <p>
                <strong>Editorial:</strong> {activeIdentity.modelRoles.editorial}
              </p>
              <p>
                <strong>Reference & Face:</strong> {activeIdentity.modelRoles.referenceExact} / {activeIdentity.modelRoles.faceAndEdit}
              </p>
              <p>
                <strong>Film / Swap:</strong> {activeIdentity.modelRoles.film} / {activeIdentity.modelRoles.swap}
              </p>
            </div>
            <div className="admin-subcard" data-dna-pipeline-readiness>
              <h3>{be.pipelineReadiness}</h3>
              <p>
                <strong>{be.microRoiModes}:</strong> {MICRO_ROI_MODES.length} modes
              </p>
              <p>
                <strong>{be.savedLooks}:</strong> {looks.length} custom + {BRAND_LOOK_PRESET_IDS.length} presets
              </p>
              <p>
                <strong>{be.memoryEvents}:</strong> {memoryEvents.length} recorded
              </p>
            </div>
          </div>
        </section>

        <div className="bw-grid-wide mt-4">
          <section className="bw-panel bw-logo-section" data-brand-logo>
            <h2>{b.identity.logo}</h2>
            <div className="bw-logo-current">
              <BrandAvatar name={org.name} logoUrl={org.logoUrl} />
              {!org.logoUrl && <p className="bw-muted">{b.identity.logoNone}</p>}
            </div>
            <ManagedForm op="brandWorkspace.logo" b={b} submit={b.identity.logoUpload}>
              <input type="hidden" name="organizationId" value={id} />
              <input type="hidden" name="expectedRevision" value={org.logoRevision} />
              <label>
                {b.identity.logoFile}
                <input name="file" type="file" accept="image/png,image/jpeg,image/webp" required />
              </label>
              <p className="bw-muted">{b.identity.logoHint}</p>
            </ManagedForm>
            {org.logoUrl && (
              <ManagedForm
                op="brandWorkspace.logoRemove"
                b={b}
                submit={b.identity.logoRemove}
                tone="danger"
                confirm={{ prompt: b.identity.logoRemoveConfirm, action: b.identity.logoRemove }}
              >
                <input type="hidden" name="organizationId" value={id} />
                <input type="hidden" name="expectedRevision" value={org.logoRevision} />
              </ManagedForm>
            )}
          </section>

          <section id="brand-identity-editor" className="bw-panel" data-brand-identity-admin>
            <h2>{c.identityTitle}</h2>
            <p className="bw-muted">{c.identityHint}</p>
            <p data-brand-identity-state={brandIdentity?.status ?? 'none'}>
              {brandIdentity
                ? interpolate(c.identityCurrent, {
                    status:
                      brandIdentity.status === 'confirmed' ? b.identityLayer.statusConfirmed : b.identityLayer.statusDraft,
                    version: brandIdentity.version,
                    revision: String(brandIdentity.revision),
                  })
                : c.identityNone}
            </p>
            {brandIdentity && (
              <details className="bw-details">
                <summary>{c.identityJsonSummary}</summary>
                <pre className="bw-code">{JSON.stringify(brandIdentity.identity, null, 2)}</pre>
              </details>
            )}
            <div className="bw-form-actions">
              <ManagedForm op="brandEngine.identityDraft" b={b} submit={c.identityDraftCta}>
                <input type="hidden" name="organizationId" value={id} />
                <input type="hidden" name="expectedRevision" value={brandIdentity?.revision ?? 0} />
              </ManagedForm>
              {brandIdentity && brandIdentity.status !== 'confirmed' && (
                <ManagedForm op="brandEngine.identityConfirm" b={b} submit={c.identityConfirmCta}>
                  <input type="hidden" name="organizationId" value={id} />
                  <input type="hidden" name="expectedRevision" value={brandIdentity.revision} />
                </ManagedForm>
              )}
            </div>
          </section>
        </div>
      </section>

      {/* BILLING SECTION */}
      <section id="billing" className="admin-section" data-org-billing>
        <h2>{od.sections.billing}</h2>
        <div className="grid gap-4 lg:grid-cols-2 mt-3">
          <Panel title={od.billing.planAllowanceHeading} id="billing-plan-allowance">
            <p className="admin-field-hint mb-3">{od.billing.planAllowanceHint}</p>
            <div className="mb-3 space-y-1 text-xs font-medium opacity-80">
              <p>
                {detailOps?.planDefaultCapKrw != null
                  ? interpolate(od.billing.planDefaultCurrent, { amount: formatKrw(detailOps.planDefaultCapKrw, locale) })
                  : od.billing.planDefaultUnset}
              </p>
              <p>
                {interpolate(od.billing.effectiveCapNow, {
                  amount: formatKrw(
                    detailOps?.allowance?.baseCapKrw ?? detailOps?.planDefaultCapKrw ?? env.defaultMonthlyKrw,
                    locale,
                  ),
                })}
              </p>
            </div>
            <OpForm op="brandBilling.planAndAllowance.set" back={`${backUrl}#billing`} className="grid gap-3">
              <input type="hidden" name="organizationId" value={id} />
              <input type="hidden" name="expectedRevision" value={plan?.revision ?? 0} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.planId}</span>
                  <select name="planId" defaultValue={plan?.planId ?? ''} className={INPUT}>
                    {!plan && <option value="">{od.billing.noPlanKeepUnassigned}</option>}
                    {BRAND_PLAN_IDS.map((pid) => (
                      <option key={pid} value={pid}>
                        {b.planNames[pid]} · {formatKrw(BRAND_PLANS[pid].monthlyKrw, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.billingMode}</span>
                  <select name="billingMode" defaultValue={plan?.billingMode ?? 'invoice'} className={INPUT}>
                    {BRAND_BILLING_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {b.billingModes[mode]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.startedOn}</span>
                  <input
                    name="startedOn"
                    type="date"
                    defaultValue={plan?.startedOn ?? todayKst}
                    required={Boolean(plan)}
                    className={INPUT}
                  />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.endsOn}</span>
                  <input name="endsOn" type="date" defaultValue={plan?.endsOn ?? ''} className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.seats}</span>
                  <input name="seats" type="number" min={1} max={1000} defaultValue={plan?.seats ?? ''} className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.planNote}</span>
                  <input name="planNote" defaultValue={plan?.note ?? ''} maxLength={500} className={INPUT} />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 border-t border-hairline pt-3">
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.allowanceMode}</span>
                  <select name="allowanceMode" defaultValue={defaultAllowanceMode} className={INPUT}>
                    <option value="plan_default">{od.billing.modePlanDefault}</option>
                    <option value="override">{od.billing.modeOverride}</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.monthlyCapKrw}</span>
                  <input
                    name="monthlyCapKrw"
                    type="number"
                    min={0}
                    max={100_000_000}
                    step={1000}
                    defaultValue={defaultCapInput}
                    className={INPUT}
                  />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.preferredLane}</span>
                  <select name="preferredLane" defaultValue={detailOps?.allowanceRow?.preferredLane ?? ''} className={INPUT}>
                    <option value="">{od.billing.laneDefault}</option>
                    {STUDIO_LANES.map((lane) => (
                      <option key={lane} value={lane}>
                        {lane === 'sunra_api' ? od.billing.laneApi : od.billing.laneMcp}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.allowanceNote}</span>
                  <input name="allowanceNote" defaultValue={detailOps?.allowanceRow?.note ?? ''} maxLength={500} className={INPUT} />
                </label>
              </div>
              <div>
                <button type="submit" className={BUTTON_PRIMARY}>
                  {od.billing.savePlanAllowance}
                </button>
              </div>
            </OpForm>
          </Panel>

          <Panel title={od.billing.profileHeading} id="billing-profile">
            <OpForm op="brandBilling.profile.set" back={`${backUrl}#billing`} className="grid gap-3">
              <input type="hidden" name="organizationId" value={id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.companyLegalName}</span>
                  <input name="companyLegalName" defaultValue={detailOps?.billingProfile?.companyLegalName ?? ''} maxLength={120} className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.businessRegNo}</span>
                  <input name="businessRegNo" defaultValue={detailOps?.billingProfile?.businessRegNo ?? ''} maxLength={20} placeholder="123-45-67890" className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.representativeName}</span>
                  <input name="representativeName" defaultValue={detailOps?.billingProfile?.representativeName ?? ''} maxLength={80} className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.taxInvoiceEmail}</span>
                  <input name="taxInvoiceEmail" type="email" defaultValue={detailOps?.billingProfile?.taxInvoiceEmail ?? ''} maxLength={254} className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.contactName}</span>
                  <input name="contactName" defaultValue={detailOps?.billingProfile?.contactName ?? ''} maxLength={80} className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.contactPhone}</span>
                  <input name="contactPhone" defaultValue={detailOps?.billingProfile?.contactPhone ?? ''} maxLength={40} className={INPUT} />
                </label>
              </div>
              <label className="text-xs">
                <span className="font-semibold block mb-1">{od.billing.businessAddress}</span>
                <input name="businessAddress" defaultValue={detailOps?.billingProfile?.businessAddress ?? ''} maxLength={300} className={INPUT} />
              </label>
              <label className="text-xs">
                <span className="font-semibold block mb-1">{od.billing.profileMemo}</span>
                <input name="memo" defaultValue={detailOps?.billingProfile?.memo ?? ''} maxLength={500} className={INPUT} />
              </label>
              <div>
                <button type="submit" className={BUTTON_PRIMARY}>
                  {od.billing.saveProfile}
                </button>
              </div>
            </OpForm>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          <Panel title={od.billing.discountHeading} id="billing-discount">
            {detailOps?.activeDiscount ? (
              <div className="mb-4 rounded-xl border border-hairline p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusPill tone="action">
                    {detailOps.activeDiscount.percent}% ·{' '}
                    {detailOps.activeDiscount.invoicesRemaining === null
                      ? '∞'
                      : `${detailOps.activeDiscount.invoicesUsed}/${detailOps.activeDiscount.invoicesTotal}`}
                  </StatusPill>
                  <span className="opacity-70">{detailOps.activeDiscount.source}</span>
                </div>
                {detailOps.activeDiscount.memo && <p className="mt-1.5 opacity-80">{detailOps.activeDiscount.memo}</p>}
                <OpForm op="brandBilling.discount.end" back={`${backUrl}#billing`} className="mt-3 grid gap-2">
                  <input type="hidden" name="organizationId" value={id} />
                  <input type="hidden" name="discountId" value={detailOps.activeDiscount.id} />
                  <input name="reason" placeholder={od.billing.endDiscountReason} maxLength={500} className={INPUT} />
                  <ConfirmCheck label={od.billing.confirmEndDiscount} />
                  <div>
                    <button type="submit" className={BUTTON}>
                      {od.billing.endDiscount}
                    </button>
                  </div>
                </OpForm>
              </div>
            ) : (
              <p className="admin-field-hint mb-3">{od.overview.discountNone}</p>
            )}

            <OpForm op="brandBilling.discount.grant" back={`${backUrl}#billing`} className="grid gap-3">
              <input type="hidden" name="organizationId" value={id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.discountPercent}</span>
                  <input name="percent" type="number" min={1} max={100} required className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.discountInvoicesTotal}</span>
                  <input name="invoicesTotal" type="number" min={1} max={36} className={INPUT} />
                </label>
              </div>
              <label className="text-xs">
                <span className="font-semibold block mb-1">{od.billing.discountMemo}</span>
                <input name="memo" maxLength={500} className={INPUT} />
              </label>
              {detailOps?.activeDiscount && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" name="confirmReplace" value="1" required />
                  <span>
                    {interpolate(od.billing.confirmReplaceDiscount, {
                      percent: String(detailOps.activeDiscount.percent),
                    })}
                  </span>
                </label>
              )}
              <div>
                <button type="submit" className={BUTTON_PRIMARY}>
                  {od.billing.grantDiscount}
                </button>
              </div>
            </OpForm>
          </Panel>

          <Panel title={od.billing.extraCreditsHeading} id="billing-grants">
            <OpForm op="brandBilling.grant.create" back={`${backUrl}#billing`} className="grid gap-3 mb-4">
              <input type="hidden" name="organizationId" value={id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.extraAmount}</span>
                  <input name="amountKrw" type="number" min={1000} max={100_000_000} step={1000} required className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.extraMonth}</span>
                  <select name="validMonth" defaultValue={currentMonth} className={INPUT}>
                    <option value={currentMonth}>{currentMonth}</option>
                    <option value={nextMonth}>{nextMonth}</option>
                  </select>
                </label>
              </div>
              <label className="text-xs">
                <span className="font-semibold block mb-1">{od.billing.extraReason}</span>
                <input name="reason" maxLength={500} className={INPUT} />
              </label>
              <div>
                <button type="submit" className={BUTTON_PRIMARY}>
                  {od.billing.grantExtra}
                </button>
              </div>
            </OpForm>

            {detailOps && detailOps.grants.length > 0 ? (
              <AdminTable
                caption={od.billing.extraCreditsHeading}
                columns={[
                  { key: 'month', label: od.billing.extraMonth },
                  { key: 'amount', label: od.billing.extraAmount, numeric: true },
                  { key: 'state', label: od.billing.invoiceCols.status },
                  { key: 'reason', label: od.billing.extraReason },
                  { key: 'action', label: od.billing.invoiceCols.actions },
                ]}
                rows={detailOps.grants.map((g) => ({
                  key: g.id,
                  data: { 'data-grant-row': g.id },
                  cells: {
                    month: g.validMonth,
                    amount: formatKrw(g.amountKrw, locale),
                    state: (
                      <StatusPill tone={g.revokedAt ? 'hold' : g.activeNow ? 'done' : 'progress'}>
                        {g.revokedAt ? od.billing.extraRevoked : g.activeNow ? od.billing.extraActive : od.billing.extraOtherMonth}
                      </StatusPill>
                    ),
                    reason: g.reason || '—',
                    action: g.revokedAt ? (
                      <span className="admin-cell-sub">{formatAdminTime(g.revokedAt, locale)}</span>
                    ) : (
                      <OpForm op="brandBilling.grant.revoke" back={`${backUrl}#billing`} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="organizationId" value={id} />
                        <input type="hidden" name="grantId" value={g.id} />
                        <ConfirmCheck label={od.billing.revokeExtra} />
                        <button type="submit" className={BUTTON}>
                          {od.billing.revokeExtra}
                        </button>
                      </OpForm>
                    ),
                  },
                }))}
                empty={od.billing.noGrants}
              />
            ) : (
              <p className="admin-empty">{od.billing.noGrants}</p>
            )}
          </Panel>
        </div>

        <Panel title={od.billing.invoicesHeading} id="billing-invoices">
          {!detailOps?.billingAvailable ? (
            <p className="admin-notice">{od.billing.unavailable}</p>
          ) : (
            <>
              <OpForm op="brandBilling.invoice.draft" back={`${backUrl}#billing-invoices`} className="flex flex-wrap items-end gap-3 mb-4">
                <input type="hidden" name="organizationId" value={id} />
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.draftPeriod}</span>
                  <input name="period" defaultValue={currentMonth} pattern="\d{4}-(0[1-9]|1[0-2])" required className={INPUT} style={{ width: 130 }} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.draftPlan}</span>
                  <select name="planId" defaultValue={plan?.planId ?? 'b2b_29'} className={INPUT} style={{ width: 200 }}>
                    {BRAND_PLAN_IDS.map((pid) => (
                      <option key={pid} value={pid}>
                        {b.planNames[pid]} · {formatKrw(BRAND_PLANS[pid].monthlyKrw, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs flex items-center gap-1.5 pb-2">
                  <input type="hidden" name="applyActiveDiscount" value="0" />
                  <input type="checkbox" name="applyActiveDiscount" value="1" defaultChecked />
                  <span>{od.billing.draftApplyDiscount}</span>
                </label>
                <label className="text-xs flex items-center gap-1.5 pb-2">
                  <input type="hidden" name="prorate" value="0" />
                  <input type="checkbox" name="prorate" value="1" defaultChecked />
                  <span>{od.billing.draftProrate}</span>
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{od.billing.draftMemo}</span>
                  <input name="memo" maxLength={500} className={INPUT} style={{ width: 220 }} />
                </label>
                <button type="submit" className={BUTTON_PRIMARY}>
                  {od.billing.createDraft}
                </button>
              </OpForm>

              <AdminTable
                caption={od.billing.invoicesHeading}
                columns={[
                  { key: 'period', label: od.billing.invoiceCols.period },
                  { key: 'plan', label: od.billing.invoiceCols.plan },
                  { key: 'list', label: od.billing.invoiceCols.list, numeric: true },
                  { key: 'proration', label: od.billing.invoiceCols.proration },
                  { key: 'discount', label: od.billing.invoiceCols.discount, numeric: true },
                  { key: 'supply', label: od.billing.invoiceCols.supply, numeric: true },
                  { key: 'vat', label: od.billing.invoiceCols.vat, numeric: true },
                  { key: 'total', label: od.billing.invoiceCols.total, numeric: true },
                  { key: 'status', label: od.billing.invoiceCols.status },
                  ...(subPanel?.enabled && subPanel.schemaReady
                    ? [{ key: 'tax', label: od.billing.taxInvoiceLabel }]
                    : []),
                  { key: 'actions', label: od.billing.invoiceCols.actions },
                ]}
                rows={detailOps.invoices.map((inv) => {
                  const meta = subPanel?.invoiceMeta[inv.id];
                  const canRecordTax =
                    subPanel?.enabled &&
                    subPanel.schemaReady &&
                    (inv.status === 'issued' || inv.status === 'paid') &&
                    (meta?.collectionMethod == null || meta.collectionMethod === 'transfer');
                  return {
                    key: inv.id,
                    data: { 'data-invoice-row': inv.id, 'data-invoice-status': inv.status },
                    cells: {
                      period: (
                        <span className="admin-nowrap">
                          {inv.period}
                          {subPanel?.enabled && subPanel.schemaReady && meta?.kind && (
                            <span className="admin-cell-sub">
                              {od.billing.invoiceKinds[meta.kind] ?? meta.kind}
                            </span>
                          )}
                          {inv.manualAmounts && <span className="admin-cell-sub">{od.billing.manualFlag}</span>}
                        </span>
                      ),
                      plan: b.planNames[inv.planId],
                      list: (
                        <span className="admin-nowrap">
                          {formatKrw(inv.listKrw, locale)}
                          {inv.baseListKrw !== inv.listKrw && (
                            <span className="admin-cell-sub">{formatKrw(inv.baseListKrw, locale)}</span>
                          )}
                        </span>
                      ),
                      proration:
                        inv.proratedDays != null && inv.periodDays != null
                          ? `${inv.proratedDays}/${inv.periodDays}d`
                          : '—',
                      discount: (
                        <span className="admin-nowrap">
                          {inv.discountKrw > 0 ? `-${formatKrw(inv.discountKrw, locale)}` : '0'}
                          {inv.discountPercent > 0 && <span className="admin-cell-sub">{inv.discountPercent}%</span>}
                        </span>
                      ),
                      supply: formatKrw(inv.supplyKrw, locale),
                      vat: formatKrw(inv.vatKrw, locale),
                      total: <strong>{formatKrw(inv.totalKrw, locale)}</strong>,
                      status: (
                        <span className="inline-flex flex-col gap-1">
                          <StatusPill tone={invoiceStatusTone(inv.status, inv.overdue)}>
                            {od.billing.invoiceStatuses[inv.status]}
                            {inv.overdue ? ` · ${od.billing.overdueBadge}` : ''}
                          </StatusPill>
                          {subPanel?.enabled && subPanel.schemaReady && meta?.dueOn && (
                            <span className="admin-cell-sub">
                              {od.billing.invoiceDueOn}: {meta.dueOn}
                            </span>
                          )}
                          {inv.memo && <span className="admin-cell-sub">{inv.memo}</span>}
                        </span>
                      ),
                      ...(subPanel?.enabled && subPanel.schemaReady
                        ? {
                            tax: meta?.taxInvoiceIssuedOn ? (
                              <span className="text-xs">
                                <div>{meta.taxInvoiceIssuedOn}</div>
                                {meta.taxInvoiceRef && <span className="admin-cell-sub">{meta.taxInvoiceRef}</span>}
                              </span>
                            ) : (
                              <span className="text-xs opacity-70">{od.billing.taxInvoiceUnissued}</span>
                            ),
                          }
                        : {}),
                      actions: (
                        <div className="flex flex-col gap-1.5 text-xs" style={{ minWidth: 220 }}>
                          {inv.status === 'draft' && (
                            <details>
                              <summary className="cursor-pointer font-medium text-accent">{od.billing.editDraftToggle}</summary>
                              <OpForm op="brandBilling.invoice.updateDraft" back={`${backUrl}#billing-invoices`} className="mt-2 grid gap-1.5">
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <select name="planId" defaultValue={inv.planId} className={INPUT}>
                                  {BRAND_PLAN_IDS.map((pid) => (
                                    <option key={pid} value={pid}>
                                      {b.planNames[pid]}
                                    </option>
                                  ))}
                                </select>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <input name="baseListKrw" type="number" min={0} defaultValue={inv.baseListKrw} title={od.billing.baseListKrw} className={INPUT} />
                                  <input name="discountPercent" type="number" min={0} max={100} defaultValue={inv.discountPercent} title={od.billing.discountPercentEdit} className={INPUT} />
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <input name="proratedDays" type="number" min={1} max={31} defaultValue={inv.proratedDays ?? ''} placeholder={od.billing.proratedDays} className={INPUT} />
                                  <input name="periodDays" type="number" min={28} max={31} defaultValue={inv.periodDays ?? ''} placeholder={od.billing.periodDays} className={INPUT} />
                                </div>
                                <label className="flex items-center gap-1.5">
                                  <input type="hidden" name="manualAmounts" value="0" />
                                  <input type="checkbox" name="manualAmounts" value="1" defaultChecked={inv.manualAmounts} />
                                  <span>{od.billing.manualAmountsCheck}</span>
                                </label>
                                <input name="manualReason" defaultValue={inv.manualReason} placeholder={od.billing.manualReasonLabel} className={INPUT} />
                                <div className="grid grid-cols-3 gap-1">
                                  <input name="supplyKrw" type="number" min={0} placeholder={od.billing.supplyKrw} className={INPUT} />
                                  <input name="vatKrw" type="number" min={0} placeholder={od.billing.vatKrw} className={INPUT} />
                                  <input name="totalKrw" type="number" min={0} placeholder={od.billing.invoiceCols.total} className={INPUT} />
                                </div>
                                <input name="memo" defaultValue={inv.memo} placeholder={od.billing.draftMemo} className={INPUT} />
                                <button type="submit" className={BUTTON}>
                                  {od.billing.saveDraft}
                                </button>
                              </OpForm>
                            </details>
                          )}
                          {inv.status === 'draft' && (
                            <details>
                              <summary className="cursor-pointer font-medium text-accent">{od.billing.issueToggle}</summary>
                              <OpForm op="brandBilling.invoice.issue" back={`${backUrl}#billing-invoices`} className="mt-2 grid gap-1.5">
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input name="memo" defaultValue={inv.memo} placeholder={od.billing.draftMemo} className={INPUT} />
                                <ConfirmCheck label={od.billing.confirmIssue} />
                                <button type="submit" className={BUTTON_PRIMARY}>
                                  {od.billing.issueSubmit}
                                </button>
                              </OpForm>
                            </details>
                          )}
                          {inv.status === 'issued' && (
                            <details>
                              <summary className="cursor-pointer font-medium text-accent">{od.billing.markPaidToggle}</summary>
                              <OpForm op="brandBilling.invoice.markPaid" back={`${backUrl}#billing-invoices`} className="mt-2 grid gap-1.5">
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input name="paidMethod" placeholder={od.billing.paidMethodLabel} required className={INPUT} />
                                <input name="paidAt" type="date" title={od.billing.paidAtLabel} className={INPUT} />
                                <input name="memo" defaultValue={inv.memo} placeholder={od.billing.draftMemo} className={INPUT} />
                                <button type="submit" className={BUTTON_PRIMARY}>
                                  {od.billing.markPaidSubmit}
                                </button>
                              </OpForm>
                            </details>
                          )}
                          {(inv.status === 'draft' || inv.status === 'issued') && (
                            <details>
                              <summary className="cursor-pointer opacity-75">{od.billing.voidToggle}</summary>
                              <OpForm op="brandBilling.invoice.void" back={`${backUrl}#billing-invoices`} className="mt-2 grid gap-1.5">
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input name="reason" placeholder={od.billing.voidReasonLabel} required className={INPUT} />
                                <ConfirmCheck label={od.billing.confirmVoid} />
                                <button type="submit" className={BUTTON}>
                                  {od.billing.voidSubmit}
                                </button>
                              </OpForm>
                            </details>
                          )}
                          {canRecordTax && (
                            <details>
                              <summary className="cursor-pointer font-medium text-accent">{od.billing.taxInvoiceToggle}</summary>
                              <OpForm op="brandBilling.invoice.recordTaxInvoice" back={`${backUrl}#billing-invoices`} className="mt-2 grid gap-1.5">
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input
                                  name="issuedOn"
                                  type="date"
                                  defaultValue={meta?.taxInvoiceIssuedOn ?? todayKst}
                                  required
                                  title={od.billing.taxInvoiceIssuedOnLabel}
                                  className={INPUT}
                                />
                                <input
                                  name="ref"
                                  defaultValue={meta?.taxInvoiceRef ?? ''}
                                  placeholder={od.billing.taxInvoiceRefLabel}
                                  required
                                  maxLength={120}
                                  className={INPUT}
                                />
                                <button type="submit" className={BUTTON}>
                                  {od.billing.taxInvoiceSubmit}
                                </button>
                              </OpForm>
                            </details>
                          )}
                          {inv.status === 'paid' && inv.paidAt && (
                            <span className="admin-cell-sub">
                              {formatAdminTime(inv.paidAt, locale)}
                              {inv.paidMethod ? ` · ${inv.paidMethod}` : ''}
                            </span>
                          )}
                          {inv.status === 'void' && inv.voidReason && (
                            <span className="admin-cell-sub">{inv.voidReason}</span>
                          )}
                          {inv.status === 'void' && meta?.taxInvoiceIssuedOn && (
                            <span className="admin-cell-sub" data-void-needs-corrective-tax-invoice>
                              {od.billing.invoiceVoidNeedsCorrection}
                            </span>
                          )}
                          {inv.status === 'void' &&
                            subPanel?.facts?.waivedPeriods.includes(inv.period) &&
                            inv.period < subPanel.facts.currentPeriod && (
                              <span className="admin-cell-sub" data-waived-period>
                                {od.billing.subscriptionWaivedPastLabel}
                              </span>
                            )}
                        </div>
                      ),
                    },
                  };
                })}
                empty={od.billing.noInvoices}
              />
            </>
          )}
        </Panel>

        {subPanel?.enabled && (
          <Panel title={od.billing.subscriptionHeading} id="billing-subscription">
            {!subPanel.schemaReady ? (
              <p className="admin-notice" data-org-subscription-unmigrated>
                {od.billing.subscriptionUnconfigured}
              </p>
            ) : (
              <div className="grid gap-4" data-org-subscription>
                {sub ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-3 text-xs rounded border border-hairline p-3">
                      <div>
                        <span className="opacity-70 block">{od.billing.subscriptionPlan}</span>
                        <strong>{b.planNames[sub.planId]}</strong>{' '}
                        <StatusPill tone={subStatusTone(sub.status)}>
                          {od.billing.subscriptionStatuses[sub.status]}
                        </StatusPill>
                        {sub.pendingPlanId && (
                          <div className="mt-1 text-xs opacity-85">
                            {od.billing.subscriptionPendingDowngrade}: <strong>{b.planNames[sub.pendingPlanId]}</strong>
                          </div>
                        )}
                      </div>
                      <div>
                        <span className="opacity-70 block">{od.billing.subscriptionStartedOn}</span>
                        <div>
                          {sub.startedOn} · {od.billing.subscriptionCollectionTransfer}
                        </div>
                        <div className="opacity-80">
                          {od.billing.subscriptionEndsOn}: {subPanel.endsOn ?? '—'}
                        </div>
                        {sub.activatedBeforePayment && (
                          <div className="opacity-80">{od.billing.subscriptionActivatedEarly}</div>
                        )}
                      </div>
                      <div>
                        <span className="opacity-70 block">
                          {od.billing.subscriptionNextDraft} / {od.billing.subscriptionNextIssue}
                        </span>
                        <div>
                          {subPanel.calendar.nextDraftOpenDay} / {subPanel.calendar.nextIssueDay}
                        </div>
                        {subPanel.oldestUnpaid && (
                          <div className="opacity-85">
                            {od.billing.subscriptionOldestUnpaid}: {subPanel.oldestUnpaid.period} (
                            {subPanel.oldestUnpaid.dueOn ?? '—'}, {formatKrw(subPanel.oldestUnpaid.totalKrw, locale)})
                          </div>
                        )}
                        {sub.cancelAtPeriodEnd && (
                          <div className="mt-1">
                            <StatusPill tone="action">{od.billing.subscriptionCancelScheduled}</StatusPill>
                          </div>
                        )}
                      </div>
                    </div>

                    {sub.reconcileFailures > 0 && (
                      <p className="admin-notice" data-subscription-reconcile-failures>
                        {interpolate(od.billing.subscriptionReconcileFailures, {
                          count: String(sub.reconcileFailures),
                          code: sub.lastReconcileError ?? '—',
                        })}
                      </p>
                    )}
                    {subPanel.facts && subPanel.facts.blockedByOlderEpoch.length > 0 && (
                      <p className="admin-notice" data-subscription-older-epoch>
                        {interpolate(od.billing.subscriptionBlockedByOlderEpoch, {
                          list: subPanel.facts.blockedByOlderEpoch.join(', '),
                        })}
                      </p>
                    )}
                    {subPanel.facts && sub.status !== 'ended' && subPanel.facts.graceDays < 1 && (
                      <p className="admin-notice" data-subscription-grace-warning>
                        {od.billing.subscriptionGraceZeroWarning}
                      </p>
                    )}
                    {subPanel.facts &&
                      sub.status !== 'ended' &&
                      (subPanel.facts.needsReissue || subPanel.facts.currentPeriodWaived) && (
                        <div
                          className="rounded border border-hairline p-3 text-xs grid gap-2.5"
                          data-voided-period-alert
                          {...(subPanel.facts.needsReissue ? { 'data-needs-reissue': '' } : {})}
                        >
                          <p className="font-semibold">
                            {subPanel.facts.needsReissue
                              ? od.billing.subscriptionNeedsReissueAlert
                              : od.billing.subscriptionWaivedCurrentAlert}
                          </p>
                          {!sub.cancelAtPeriodEnd && (
                            <OpForm
                              op="brandSubscription.reissuePeriod"
                              back={`${backUrl}#billing-subscription`}
                              className="flex flex-wrap items-center gap-3"
                            >
                              <input type="hidden" name="organizationId" value={id} />
                              <input type="hidden" name="period" value={subPanel.facts.currentPeriod} />
                              {reissuePreviewDigest && (
                                <input type="hidden" name="previewDigest" value={reissuePreviewDigest} />
                              )}
                              {reissueShortWindow && (
                                <p className="admin-notice w-full" data-reissue-short-window>
                                  {od.billing.subscriptionShortWindowWarning}
                                </p>
                              )}
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" name="confirm" value="1" />
                                <span>
                                  {interpolate(od.billing.subscriptionReissueConfirm, {
                                    period: subPanel.facts.currentPeriod,
                                  })}
                                </span>
                              </label>
                              <button type="submit" className={BUTTON_PRIMARY}>
                                {od.billing.subscriptionReissueSubmit}
                              </button>
                            </OpForm>
                          )}
                        </div>
                      )}

                    {sub.status !== 'ended' && (
                      <div className="flex flex-wrap items-end gap-4">
                        {!sub.cancelAtPeriodEnd && (
                          <OpForm op="brandSubscription.scheduleDowngrade" back={`${backUrl}#billing-subscription`} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="organizationId" value={id} />
                            <label className="text-xs">
                              <span className="font-semibold block mb-1">{od.billing.subscriptionScheduleDowngrade}</span>
                              <select name="planId" defaultValue={sub.pendingPlanId ?? 'b2b_29'} className={INPUT}>
                                {PAID_BRAND_PLAN_IDS.filter((pid) => pid !== sub.planId).map((pid) => (
                                  <option key={pid} value={pid}>
                                    {b.planNames[pid]} · {formatKrw(BRAND_PLANS[pid].monthlyKrw, locale)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button type="submit" className={BUTTON}>
                              {od.billing.subscriptionScheduleDowngradeSubmit}
                            </button>
                          </OpForm>
                        )}

                        {sub.pendingPlanId && (
                          <OpForm op="brandSubscription.clearPendingPlan" back={`${backUrl}#billing-subscription`}>
                            <input type="hidden" name="organizationId" value={id} />
                            <button type="submit" className={BUTTON}>
                              {od.billing.subscriptionClearPendingPlan}
                            </button>
                          </OpForm>
                        )}

                        {!sub.cancelAtPeriodEnd ? (
                          <OpForm op="brandSubscription.cancel" back={`${backUrl}#billing-subscription`} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="organizationId" value={id} />
                            <ConfirmCheck
                              label={
                                subPanel.facts?.nothingPaid
                                  ? od.billing.subscriptionCancelConfirmUnpaid
                                  : od.billing.subscriptionCancelConfirm
                              }
                            />
                            <button type="submit" className={BUTTON}>
                              {od.billing.subscriptionCancelSubmit}
                            </button>
                          </OpForm>
                        ) : (
                          <OpForm op="brandSubscription.undoCancel" back={`${backUrl}#billing-subscription`}>
                            <input type="hidden" name="organizationId" value={id} />
                            <button type="submit" className={BUTTON}>
                              {od.billing.subscriptionUndoCancelSubmit}
                            </button>
                          </OpForm>
                        )}

                        <OpForm op="brandSubscription.reconcile" back={`${backUrl}#billing-subscription`}>
                          <input type="hidden" name="organizationId" value={id} />
                          <button type="submit" className={BUTTON_PRIMARY}>
                            {od.billing.subscriptionReconcileSubmit}
                          </button>
                        </OpForm>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="admin-field-hint">{od.billing.subscriptionNone}</p>
                )}

                {(!sub || sub.status === 'ended') && !isSandboxedOrg && (
                  <OpForm op="brandSubscription.start" back={`${backUrl}#billing-subscription`} className="grid gap-3 border-t border-hairline pt-3">
                    <h3 className="text-xs font-semibold">{od.billing.subscriptionStartHeading}</h3>
                    <p className="admin-field-hint" data-subscription-start-note>
                      {od.billing.subscriptionStartNote}
                    </p>
                    {startShortWindow && (
                      <p className="admin-notice" data-subscription-short-window>
                        {od.billing.subscriptionShortWindowWarning}
                      </p>
                    )}
                    <input type="hidden" name="organizationId" value={id} />
                    <input type="hidden" name="collectionMethod" value="transfer" />
                    {startPreviewMatch && (
                      <>
                        <input type="hidden" name="previewPlanId" value={startPreviewPlan} />
                        <input type="hidden" name="previewStartedOn" value={startPreviewDate} />
                        <input
                          type="hidden"
                          name="previewActivateBeforePayment"
                          value={startPreviewEarly ? '1' : '0'}
                        />
                        {startPreviewDigest && <input type="hidden" name="previewDigest" value={startPreviewDigest} />}
                      </>
                    )}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs">
                        <span className="font-semibold block mb-1">{od.billing.subscriptionStartPlan}</span>
                        <select name="planId" defaultValue={startPreviewPlan ?? 'b2b_29'} className={INPUT}>
                          {PAID_BRAND_PLAN_IDS.map((pid) => (
                            <option key={pid} value={pid}>
                              {b.planNames[pid]} · {formatKrw(BRAND_PLANS[pid].monthlyKrw, locale)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="font-semibold block mb-1">{od.billing.subscriptionStartDate}</span>
                        <input
                          name="startedOn"
                          type="date"
                          defaultValue={startPreviewDate ?? todayKst}
                          required
                          className={INPUT}
                        />
                      </label>
                      <div className="text-xs flex flex-col gap-1.5 justify-end">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            name="activateBeforePayment"
                            value="1"
                            defaultChecked={startPreviewEarly}
                          />
                          <span>{od.billing.subscriptionActivateEarly}</span>
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" name="confirm" value="1" />
                          <span>{od.billing.subscriptionConfirmEarly}</span>
                        </label>
                      </div>
                    </div>
                    <ConfirmCheck label={od.billing.confirmIssue} />
                    <div>
                      <button type="submit" className={BUTTON_PRIMARY}>
                        {od.billing.subscriptionStartSubmit}
                      </button>
                    </div>
                  </OpForm>
                )}
              </div>
            )}
          </Panel>
        )}
      </section>

      <div id="brand-members" className="bw-grid-wide mt-6">
        <section className="bw-panel">
          <h2>{b.members}</h2>
          <ul className="bw-list">
            {org.members.map((m) => (
              <li className="bw-row" key={`${m.userId}:${m.projectId}`}>
                <div>
                  <strong>{m.email}</strong>
                  <p className="bw-muted">
                    {m.projectTitle ?? c.scopeBrand} · {b.roles[m.role as keyof typeof b.roles]} ·{' '}
                    {m.status === 'active' ? c.active : c.cancelled}
                    {m.projectId && <> · {m.canComment ? c.canComment : c.readOnly}</>}
                  </p>
                </div>
                {m.status === 'active' && (
                  <ManagedForm
                    op="brandWorkspace.revokeAccess"
                    b={b}
                    submit={c.revoke}
                    tone="danger"
                    confirm={{ prompt: b.confirm.revokeMember, action: b.confirm.revokeMemberAction }}
                  >
                    <input type="hidden" name="organizationId" value={id} />
                    <input type="hidden" name="projectId" value={m.projectId ?? ''} />
                    <input type="hidden" name="userId" value={m.userId} />
                  </ManagedForm>
                )}
              </li>
            ))}
          </ul>
          <h2>{b.invitations}</h2>
          <ul className="bw-list">
            {org.invitations.map((i) => (
              <li className="bw-row" key={i.id}>
                <div>
                  <strong>{i.email}</strong>
                  <p className="bw-muted">
                    {i.projectTitle ?? c.scopeBrand} · {b.invitationStates[i.state]} · {formatBrandTimestamp(i.expiresAt, locale)}
                    {i.projectId && <> · {i.canComment ? c.canComment : c.readOnly}</>}
                  </p>
                </div>
                {i.state === 'pending' && (
                  <ManagedForm
                    op="brandWorkspace.revokeInvite"
                    b={b}
                    submit={c.revokeInvite}
                    tone="danger"
                    confirm={{ prompt: b.confirm.revokeInvite, action: b.confirm.revokeInviteAction }}
                  >
                    <input type="hidden" name="organizationId" value={id} />
                    <input type="hidden" name="invitationId" value={i.id} />
                  </ManagedForm>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="bw-panel">
          <h2>{c.invite}</h2>
          <p className="bw-muted">{c.inviteHint}</p>
          <ManagedForm op="brandWorkspace.invite" b={b} submit={c.invite}>
            <input type="hidden" name="organizationId" value={id} />
            <label>
              {c.email}
              <input name="email" type="email" required />
            </label>
            <label>
              {c.scope}
              <select name="role">
                <option value="owner">{b.roles.owner}</option>
                <option value="editor">{b.roles.editor}</option>
                <option value="viewer">{b.roles.viewer}</option>
              </select>
              <span className="bw-muted">{c.scopeBrand}</span>
            </label>
          </ManagedForm>
        </section>
      </div>

      {/* STUDIO JOBS (latest 50) */}
      <section id="studio-jobs" className="admin-section" data-org-studio-jobs>
        <h2>{od.jobs.heading}</h2>
        {!detailOps?.studioJobsAvailable ? (
          <p className="admin-notice">{od.jobs.unavailable}</p>
        ) : (
          <>
            <div className="admin-toolbar">
              <FilterPills
                label={od.jobs.filterLabel}
                pills={ORG_JOB_STATUSES.map((st) => ({
                  key: st,
                  label: st === 'all' ? od.jobs.allStatuses : od.jobs.statuses[st],
                  href: st === 'all' ? `${backUrl}#studio-jobs` : `${backUrl}?jobStatus=${st}#studio-jobs`,
                  current: jobStatus === st,
                }))}
              />
            </div>
            <AdminTable
              caption={od.jobs.heading}
              columns={[
                { key: 'time', label: od.jobs.columns.time },
                { key: 'kind', label: od.jobs.columns.kind },
                { key: 'model', label: od.jobs.columns.model },
                { key: 'status', label: od.jobs.columns.status },
                { key: 'amount', label: od.jobs.columns.amount, numeric: true },
                { key: 'error', label: od.jobs.columns.error },
              ]}
              rows={detailOps.studioJobs.map((j) => ({
                key: j.id,
                data: { 'data-org-job-row': j.id, 'data-status': j.status },
                cells: {
                  time: (
                    <span className="admin-nowrap" title={j.id}>
                      {formatAdminTime(j.createdAt, locale)}
                      <span className="admin-cell-sub">{shortId(j.id)}</span>
                    </span>
                  ),
                  kind: <span className="admin-nowrap">{j.kind}</span>,
                  model: (
                    <span>
                      {j.model}
                      {j.lane && <span className="admin-cell-sub">{j.lane}</span>}
                    </span>
                  ),
                  status: (
                    <StatusPill tone={jobStatusTone(j.status)}>
                      {od.jobs.statuses[j.status as keyof typeof od.jobs.statuses] ?? j.status}
                    </StatusPill>
                  ),
                  amount: (
                    <span className="admin-nowrap">
                      {formatKrw(j.usageKrw ?? j.estimateKrw, locale)}
                      {j.returnedKrw > 0 && (
                        <span className="admin-cell-sub">
                          {interpolate(od.jobs.returnedSub, { amount: formatKrw(j.returnedKrw, locale) })}
                        </span>
                      )}
                    </span>
                  ),
                  error: j.errorCode ? (
                    <span title={j.errorDetail ?? undefined}>
                      <code>{j.errorCode}</code>
                      {j.errorDetail && <span className="admin-cell-sub">{j.errorDetail.slice(0, 80)}</span>}
                    </span>
                  ) : (
                    '—'
                  ),
                },
              }))}
              empty={od.jobs.empty}
            />
          </>
        )}
      </section>

      <ProductionAdmin organizationId={id} projects={projects} previews={previews} workspace={production} b={b} />

      <section className="bw-panel mt-6" id="support">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2>{c.supportTitle}</h2>
          <a href={`/admin/inquiries?kind=team&organizationId=${id}`} className="admin-btn" data-org-inbox-link>
            {od.messages.openFilteredInbox} →
          </a>
        </div>
        <p className="bw-muted" data-support-sync-mode={supportSync.mode}>
          {supportSync.mode === 'bot_sync' ? sCopy.syncBot : sCopy.syncAdminOnly}
        </p>
        <div className="bw-support-history">
          {messages.map((m) => (
            <article className="bw-support-bubble" data-author={m.authorRole} key={m.id}>
              <strong>{m.authorRole === 'studio' ? b.dashboard.studio : org.name}</strong>
              <p>{m.body}</p>
              <time>{formatBrandTimestamp(m.createdAt, locale)}</time>
            </article>
          ))}
        </div>
        <ManagedForm op="brandWorkspace.support" b={b} submit={c.reply}>
          <input type="hidden" name="organizationId" value={id} />
          <label>
            {c.message}
            <textarea name="body" required maxLength={4000} />
          </label>
        </ManagedForm>
      </section>

      {/* MERGED HISTORY TIMELINE */}
      <section id="history" className="admin-section" data-org-history>
        <h2>{od.history.heading}</h2>
        <AdminTable
          caption={od.history.heading}
          columns={[
            { key: 'time', label: od.history.columns.time },
            { key: 'category', label: od.history.columns.category },
            { key: 'summary', label: od.history.columns.summary },
            { key: 'detail', label: od.history.columns.detail },
            { key: 'actor', label: od.history.columns.actor },
          ]}
          rows={(detailOps?.history ?? []).map((item) => ({
            key: item.id,
            data: { 'data-history-row': item.id, 'data-category': item.category },
            cells: {
              time: <span className="admin-nowrap">{formatAdminTime(item.at, locale)}</span>,
              category: <StatusPill tone="hold">{od.history.categories[item.category]}</StatusPill>,
              summary: item.title,
              detail: <span className="admin-cell-wrap">{item.detail || '—'}</span>,
              actor: item.actorName ?? '—',
            },
          }))}
          empty={od.history.empty}
        />
      </section>
    </AdminShell>
  );
}
