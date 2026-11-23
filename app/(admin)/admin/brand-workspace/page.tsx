import { ManagedForm } from '@/components/brand-workspace/managed-form';
import '@/app/(brand)/workspace.css';
import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadStudioWorkspace } from '@/lib/brands/workspace/service';
import { AdminShell, OutcomeBanner } from '@/components/admin/chrome';
import {
  AdminPageHeader,
  AdminTable,
  FilterPills,
  Pager,
  StatusPill,
} from '@/components/admin/patterns';
import { formatAdminTime, formatCount, formatKrw } from '@/lib/admin/format';
import { CampaignList } from '@/components/brand-workspace/campaign-list';
import { loadStudioInbox } from '@/lib/brands/workspace/inbox';
import { StudioInboxPanel } from '@/components/admin/studio-inbox';
import { studioEnv } from '@/lib/brand-studio/env';
import {
  BRAND_ORG_FILTERS,
  BRAND_ORG_PAGE_SIZE,
  BRAND_ORG_SORTS,
  brandOrgListFilter,
  brandOrgListHref,
  loadBrandOrgList,
} from '@/lib/admin/brand-org-list';
import { interpolate } from '@/lib/i18n/format';
import { brandRoomsOpen } from '@/lib/flags';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function StudioBrands(props?: { searchParams?: Promise<SearchParams> }) {
  const [viewer, sql, locale, params] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    props?.searchParams ?? Promise.resolve({} as SearchParams),
  ]);
  const dict = getDictionary(locale);
  const b = dict.brandWorkspace;
  const c = dict.adminConsole;
  const ol = c.brandOrgList;
  const filter = brandOrgListFilter(params);
  const env = studioEnv();

  const [workspace, inbox, orgList] = sql
    ? await Promise.all([
        loadStudioWorkspace({ sql }, viewer),
        loadStudioInbox({ sql }, viewer),
        loadBrandOrgList(sql, viewer, filter, { env }),
      ])
    : [null, null, null];

  const first = orgList && orgList.total > 0 ? (orgList.page - 1) * BRAND_ORG_PAGE_SIZE + 1 : 0;
  const last = orgList ? Math.min(orgList.page * BRAND_ORG_PAGE_SIZE, orgList.total) : 0;

  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <div data-studio-brand-queue>
        <OutcomeBanner
          dict={dict.admin}
          ok={one(params, 'ok')}
          err={one(params, 'err')}
          detail={one(params, 'detail')}
          showDetailForOk
        />
        <AdminPageHeader
          title={b.dashboard.studioTitle}
          {...(orgList ? { count: formatCount(orgList.total, locale) } : {})}
          lede={b.dashboard.studioSubtitle}
          actions={
            <>
              <a className="admin-btn" href="/admin/brand-billing" data-brand-billing-link>
                {ol.billingLink} →
              </a>
              <a className="admin-btn" href="/admin/brand-billing/codes" data-brand-billing-codes-link>
                {ol.discountCodesLink} →
              </a>
              <a className="admin-btn" href="/admin/brand-studio" data-brand-studio-ops-link>
                {ol.studioOpsLink} →
              </a>
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

            {orgList && (
              <div className="mt-4" data-brand-org-matrix>
                <div className="admin-toolbar" style={{ marginBottom: 12 }}>
                  <FilterPills
                    label={ol.filters.all}
                    pills={BRAND_ORG_FILTERS.map((key) => ({
                      key,
                      label: ol.filters[key],
                      href: brandOrgListHref(filter, { filter: key }),
                      current: filter.filter === key,
                    }))}
                  />
                  <form method="get" action="/admin/brand-workspace" className="admin-search" role="search">
                    {filter.filter !== 'all' && <input type="hidden" name="filter" value={filter.filter} />}
                    <label className="flex items-center gap-1.5 text-xs">
                      <span>{ol.sortLabel}</span>
                      <select
                        name="sort"
                        defaultValue={filter.sort}
                        className="admin-input"
                        style={{ minHeight: 36, width: 'auto', padding: '0 10px' }}
                      >
                        {BRAND_ORG_SORTS.map((s) => (
                          <option key={s} value={s}>
                            {ol.sorts[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <input
                      type="search"
                      name="q"
                      defaultValue={filter.query}
                      placeholder={ol.searchPlaceholder}
                      aria-label={c.list.search}
                    />
                    <button type="submit" className="admin-btn">
                      {c.list.find}
                    </button>
                    {(filter.query || filter.filter !== 'all' || filter.sort !== 'last_activity') && (
                      <a href="/admin/brand-workspace" className="admin-btn">
                        {c.list.clear}
                      </a>
                    )}
                  </form>
                </div>

                <AdminTable
                  caption={c.brandEngine.matrixHeading}
                  columns={[
                    { key: 'org', label: ol.columns.org },
                    { key: 'plan', label: ol.columns.plan },
                    { key: 'allowance', label: ol.columns.allowance, numeric: true },
                    { key: 'discount', label: ol.columns.discount },
                    { key: 'invoice', label: ol.columns.invoice },
                    { key: 'members', label: ol.columns.members, numeric: true },
                    { key: 'lastActivity', label: ol.columns.lastActivity },
                    { key: 'failures7d', label: ol.columns.failures7d, numeric: true },
                    { key: 'created', label: ol.columns.created },
                  ]}
                  rows={orgList.rows.map((row) => {
                    const planTone = !row.planId
                      ? 'hold'
                      : row.planInGrace
                        ? 'action'
                        : row.planExpired
                          ? 'fail'
                          : 'done';
                    const planStateLabel = !row.planId
                      ? ol.planStates.unassigned
                      : row.planInGrace
                        ? ol.planStates.grace
                        : row.planExpired
                          ? ol.planStates.expired
                          : ol.planStates.active;

                    return {
                      key: row.id,
                      data: { 'data-brand-org-row': row.id },
                      cells: {
                        org: (
                          <a href={`/admin/brand-workspace/organizations/${row.id}`} className="admin-row-link">
                            <span>{row.name}</span>
                            <span className="admin-cell-sub">
                              {row.projectCount > 0 ? `${formatCount(row.projectCount, locale)} · ` : ''}
                              {row.hasUsageRequest && !row.planId ? ol.waitingPlanTag : b.managed.access}
                            </span>
                          </a>
                        ),
                        plan: row.planId ? (
                          <span>
                            <StatusPill tone={planTone}>
                              {b.planNames[row.planId]} · {planStateLabel}
                            </StatusPill>
                            <span className="admin-cell-sub">
                              {row.planEndsOn ? `~ ${row.planEndsOn}` : row.planStartedOn ?? ''}
                            </span>
                          </span>
                        ) : (
                          <StatusPill tone="hold">{ol.planStates.unassigned}</StatusPill>
                        ),
                        allowance: (
                          <span className="admin-nowrap">
                            {formatKrw(row.usedKrw, locale)} / {formatKrw(row.capKrw, locale)}
                            {row.usagePercent !== null ? ` (${row.usagePercent}%)` : ''}
                            <span className="admin-cell-sub">
                              {ol.sources[row.allowanceSource]}
                              {row.extraKrw > 0
                                ? ` · ${interpolate(ol.extraBadge, { amount: formatKrw(row.extraKrw, locale) })}`
                                : ''}
                            </span>
                          </span>
                        ),
                        discount: row.activeDiscount ? (
                          <StatusPill tone="action">
                            {row.activeDiscount.invoicesRemaining === null
                              ? interpolate(ol.discountUnlimited, { percent: row.activeDiscount.percent })
                              : interpolate(ol.discountRemaining, {
                                  percent: row.activeDiscount.percent,
                                  left: row.activeDiscount.invoicesRemaining,
                                })}
                          </StatusPill>
                        ) : (
                          <span className="admin-cell-sub">{ol.discountNone}</span>
                        ),
                        invoice:
                          row.overdueInvoiceCount > 0 ? (
                            <StatusPill tone="fail">
                              {interpolate(ol.overdueFlag, { count: row.overdueInvoiceCount })}
                            </StatusPill>
                          ) : row.unpaidInvoiceCount > 0 ? (
                            <StatusPill tone="action">
                              {interpolate(ol.unpaidFlag, { count: row.unpaidInvoiceCount })}
                            </StatusPill>
                          ) : (
                            <span className="admin-cell-sub">{ol.invoiceClear}</span>
                          ),
                        members: formatCount(row.memberCount, locale),
                        lastActivity: row.lastActivityAt ? (
                          <span className="admin-nowrap">{formatAdminTime(row.lastActivityAt, locale)}</span>
                        ) : (
                          <span className="admin-cell-sub">{ol.noActivity}</span>
                        ),
                        failures7d:
                          row.failedJobs7d > 0 ? (
                            <StatusPill tone="fail">{formatCount(row.failedJobs7d, locale)}</StatusPill>
                          ) : (
                            '0'
                          ),
                        created: <span className="admin-nowrap">{formatAdminTime(row.createdAt, locale)}</span>,
                      },
                    };
                  })}
                  empty={
                    filter.query || filter.filter !== 'all' ? ol.emptyFiltered : b.studioEmpty
                  }
                />

                {orgList.total > 0 && (
                  <Pager
                    label={c.list.pages}
                    summary={interpolate(c.list.range, {
                      from: formatCount(first, locale),
                      to: formatCount(last, locale),
                      total: formatCount(orgList.total, locale),
                    })}
                    prev={orgList.page > 1 ? brandOrgListHref(filter, { page: orgList.page - 1 }) : null}
                    next={last < orgList.total ? brandOrgListHref(filter, { page: orgList.page + 1 }) : null}
                    prevLabel={c.list.prev}
                    nextLabel={c.list.next}
                  />
                )}
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
