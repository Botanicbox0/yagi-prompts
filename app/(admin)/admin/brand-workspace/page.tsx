import { ManagedForm } from '@/components/brand-workspace/managed-form';
import "@/app/(brand)/workspace.css";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { loadStudioWorkspace } from "@/lib/brands/workspace/service";
import { AdminShell } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, StatusPill } from "@/components/admin/patterns";
import { formatCount } from "@/lib/admin/format";
import { CampaignList } from "@/components/brand-workspace/campaign-list";
import { loadStudioInbox } from "@/lib/brands/workspace/inbox";
import { StudioInboxPanel } from "@/components/admin/studio-inbox";
import { loadFeaturePolicies, type BrandFeature } from "@/lib/brands/entitlements";
import { BRAND_PLANS, loadPlanAssignment } from "@/lib/brands/plans";
import { loadBrandIdentity } from "@/lib/brands/identity/service";
import { interpolate } from "@/lib/i18n/format";
import { brandRoomsOpen } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default async function StudioBrands() {
  const [viewer, sql, locale] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
  ]);
  const dict = getDictionary(locale),
    b = dict.brandWorkspace,
    be = dict.adminConsole.brandEngine;
  const [workspace, inbox] = sql ? await Promise.all([loadStudioWorkspace({ sql }, viewer), loadStudioInbox({ sql }, viewer)]) : [null, null];
  const orgIds = workspace ? workspace.organizations.map((o) => o.id) : [];
  const [policiesByOrg, plansByOrg, identitiesByOrg] =
    sql && workspace
      ? await Promise.all([
          loadFeaturePolicies(sql, orgIds),
          Promise.all(orgIds.map((orgId) => loadPlanAssignment(sql, orgId))),
          Promise.all(orgIds.map((orgId) => loadBrandIdentity(sql, orgId))),
        ])
      : [{} as Record<string, BrandFeature[]>, [], []];
  const krw = new Intl.NumberFormat("ko-KR");
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <div data-studio-brand-queue>
        <AdminPageHeader
          title={b.dashboard.studioTitle}
          {...(workspace ? { count: formatCount(workspace.projects.length, locale) } : {})}
          lede={b.dashboard.studioSubtitle}
          actions={
            <>
              <a className="admin-btn" href="/admin/brand-workspace/usage" data-usage-queue-link>
                {b.secondaryUsage.admin.openQueue} →
              </a>
              <a className="admin-btn" href="/admin/brand-studio/reviews" data-studio-reviews-link>
                {dict.studioReview.admin.navLink} →
              </a>
              {brandRoomsOpen() && (
                <a className="admin-btn" href="/admin/brand-rooms" data-brand-rooms-link>
                  {dict.roomsChat.admin.navLink} →
                </a>
              )}
            </>
          }
        />
        {/* The language switcher lives once, in the shell's top bar (AdminShell). */}
        {inbox && <StudioInboxPanel entries={inbox} admin={dict.admin} locale={locale} />}
        {workspace && (
          <section className="bw-panel" data-managed-brands>
            <div className="bw-section-heading">
              <h2>{b.managed.manageTitle}</h2>
            </div>
            <p className="bw-muted">{b.managed.manageHint}</p>
            <div className="bw-grid">
              <details className="bw-contract-add">
                <summary>{b.managed.createBrand}</summary>
                <ManagedForm op="brandWorkspace.organization" b={b} submit={b.managed.createBrand}>
                  <label>
                    {b.organization}
                    <input name="name" minLength={2} maxLength={100} required />
                  </label>
                </ManagedForm>
              </details>
              {workspace.organizations.length > 0 && (
                <details className="bw-contract-add">
                  <summary>{b.managed.createCampaign}</summary>
                  <ManagedForm op="brandWorkspace.createProject" b={b} submit={b.managed.createCampaign}>
                    <label>
                      {b.organization}
                      <select name="organizationId">
                        {workspace.organizations.map((o) => (
                          <option value={o.id} key={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {b.projectTitle}
                      <input name="title" minLength={3} maxLength={120} required />
                    </label>
                    <label>
                      {b.objective}
                      <textarea name="objective" minLength={3} maxLength={2000} required />
                    </label>
                    <label>
                      {b.budget}
                      <input type="number" name="budgetKrw" min={0} />
                    </label>
                    <input type="hidden" name="productionMode" value="creator" />
                  </ManagedForm>
                </details>
              )}
            </div>
            {workspace.organizations.length > 0 && (
              <div className="mt-4" data-brand-org-matrix>
                <AdminTable
                  caption={be.matrixHeading}
                  columns={[
                    { key: "org", label: be.columns.org },
                    { key: "plan", label: be.columns.plan },
                    { key: "identity", label: be.columns.identity },
                    { key: "blocked", label: be.columns.blocked },
                    { key: "projects", label: be.columns.projects, numeric: true },
                    { key: "actions", label: be.columns.actions },
                  ]}
                  rows={workspace.organizations.map((o, idx) => {
                    const denied = policiesByOrg[o.id] ?? [];
                    const plan = plansByOrg[idx] ?? null;
                    const dna = identitiesByOrg[idx] ?? null;
                    const projectCount = workspace.projects.filter(
                      (p) => p.organizationId === o.id
                    ).length;
                    return {
                      key: o.id,
                      data: { "data-brand-org-row": o.id },
                      cells: {
                        org: (
                          <a
                            href={`/admin/brand-workspace/organizations/${o.id}`}
                            className="admin-row-link"
                          >
                            <span>{o.name}</span>
                            <span className="admin-cell-sub">{b.managed.access}</span>
                          </a>
                        ),
                        plan: plan ? (
                          <span className="admin-nowrap">
                            {b.planNames[plan.planId]} · ₩
                            {krw.format(BRAND_PLANS[plan.planId].monthlyKrw)}
                          </span>
                        ) : (
                          <StatusPill tone="hold">{be.planUnassigned}</StatusPill>
                        ),
                        identity: dna ? (
                          <StatusPill
                            tone={dna.status === "confirmed" ? "action" : "progress"}
                          >
                            {be.dnaStatus[dna.status]} · r{dna.revision}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="done">{be.dnaStatus.none}</StatusPill>
                        ),
                        blocked:
                          denied.length === 0 ? (
                            <StatusPill tone="done">{be.allOpen}</StatusPill>
                          ) : (
                            <span className="admin-cell-wrap">
                              <StatusPill tone="hold">
                                {interpolate(be.blockedCount, {
                                  count: String(denied.length),
                                })}
                              </StatusPill>
                              <span className="admin-cell-sub">
                                {denied.map((f) => b.features[f]).join(", ")}
                              </span>
                            </span>
                          ),
                        projects: formatCount(projectCount, locale),
                        actions: (
                          <a
                            href={`/admin/brand-workspace/organizations/${o.id}`}
                            className="admin-btn"
                          >
                            {be.openOrg} →
                          </a>
                        ),
                      },
                    };
                  })}
                  empty={b.studioEmpty}
                />
              </div>
            )}
          </section>
        )}
        {!workspace ? (
          <p role="alert">{b.unavailable}</p>
        ) : !workspace.projects.length ? (
          <div className="bw-empty">{b.studioEmpty}</div>
        ) : (
          <CampaignList projects={workspace.projects} b={b} locale={locale} studio />
        )}
      </div>
    </AdminShell>
  );
}
