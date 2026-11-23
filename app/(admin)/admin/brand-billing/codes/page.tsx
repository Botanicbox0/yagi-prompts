import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  formatBillingOutcomeDetail,
  loadBrandDiscountCodesConsole,
} from '@/lib/admin/brand-billing-console';
import { formatAdminTime, formatCount } from '@/lib/admin/format';
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
  StatusPill,
} from '@/components/admin/patterns';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function BrandDiscountCodesPage(props?: { searchParams?: Promise<SearchParams> }) {
  const [viewer, sql, locale, params] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    props?.searchParams ?? Promise.resolve({} as SearchParams),
  ]);

  const dict = getDictionary(locale);
  const c = dict.adminConsole;
  const bb = c.brandBilling;
  const bc = bb.codes;
  const backUrl = '/admin/brand-billing/codes';

  const data = sql ? await loadBrandDiscountCodesConsole(sql, viewer) : null;

  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandBilling">
      <div data-brand-discount-codes>
        <OutcomeBanner
          dict={dict.admin}
          ok={one(params, 'ok')}
          err={one(params, 'err')}
          detail={formatBillingOutcomeDetail(one(params, 'detail'), locale)}
          showDetailForOk
        />

        <AdminPageHeader
          title={bc.title}
          {...(data?.available ? { count: formatCount(data.codes.length, locale) } : {})}
          lede={bc.lede}
          actions={
            <a className="admin-btn" href="/admin/brand-billing" data-back-billing-link>
              ← {bc.backToBilling}
            </a>
          }
        />

        {!data?.available ? (
          <p className="admin-notice">{bb.unavailable}</p>
        ) : (
          <>
            <Panel title={bc.createHeading} id="create-code">
              <OpForm
                op="brandBilling.discountCode.create"
                back={backUrl}
                className="grid gap-3 sm:grid-cols-3"
              >
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{bc.codeLabel}</span>
                  <input
                    name="code"
                    maxLength={24}
                    placeholder={bc.codePlaceholder}
                    className={INPUT}
                  />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{bc.percentLabel}</span>
                  <input
                    name="percent"
                    type="number"
                    min={1}
                    max={100}
                    required
                    className={INPUT}
                  />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{bc.invoicesLabel}</span>
                  <input
                    name="invoicesTotal"
                    type="number"
                    min={1}
                    max={36}
                    className={INPUT}
                  />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{bc.maxRedemptionsLabel}</span>
                  <input
                    name="maxRedemptions"
                    type="number"
                    min={1}
                    max={10_000}
                    className={INPUT}
                  />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{bc.validUntilLabel}</span>
                  <input name="validUntil" type="date" className={INPUT} />
                </label>
                <label className="text-xs">
                  <span className="font-semibold block mb-1">{bc.orgBindLabel}</span>
                  <select name="organizationId" defaultValue="" className={INPUT}>
                    <option value="">{bc.anyOrgOption}</option>
                    {data.organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs sm:col-span-3">
                  <span className="font-semibold block mb-1">{bc.memoLabel}</span>
                  <input name="memo" maxLength={500} className={INPUT} />
                </label>
                <div className="sm:col-span-3">
                  <button type="submit" className={BUTTON_PRIMARY}>
                    {bc.createSubmit}
                  </button>
                </div>
              </OpForm>
            </Panel>

            <Panel
              title={bc.listHeading}
              id="issued-codes"
              action={<span className="text-xs font-mono opacity-75">{formatCount(data.codes.length, locale)}</span>}
            >
              <AdminTable
                caption={bc.listHeading}
                columns={[
                  { key: 'code', label: bc.columns.code },
                  { key: 'terms', label: bc.columns.terms },
                  { key: 'binding', label: bc.columns.binding },
                  { key: 'redemptions', label: bc.columns.redemptions },
                  { key: 'validUntil', label: bc.columns.validUntil },
                  { key: 'status', label: bc.columns.status },
                  { key: 'memo', label: bc.columns.memo },
                  { key: 'action', label: bc.columns.action },
                ]}
                rows={data.codes.map((item) => {
                  const isDisabled = Boolean(item.disabledAt);
                  const limitLabel =
                    item.maxRedemptions != null ? formatCount(item.maxRedemptions, locale) : bc.unlimitedUses;
                  return {
                    key: item.id,
                    data: {
                      'data-discount-code-row': item.id,
                      'data-discount-code': item.code,
                    },
                    cells: {
                      code: <code className="font-semibold">{item.code}</code>,
                      terms: (
                        <span className="admin-nowrap">
                          {item.percent}%
                          {item.invoicesTotal != null && (
                            <span className="admin-cell-sub">{`${item.invoicesTotal}x`}</span>
                          )}
                        </span>
                      ),
                      binding: item.organizationId ? (
                        <a
                          className="text-accent hover:underline"
                          href={`/admin/brand-workspace/organizations/${item.organizationId}#billing`}
                        >
                          {item.boundOrganizationName ?? item.organizationId}
                        </a>
                      ) : (
                        <span className="opacity-75">{bc.anyOrgOption}</span>
                      ),
                      redemptions: (
                        <div className="text-xs">
                          <div>
                            <strong>{formatCount(item.redemptions.length, locale)}</strong> / {limitLabel}
                          </div>
                          {item.redemptions.length > 0 && (
                            <ul className="mt-1 space-y-0.5 opacity-80">
                              {item.redemptions.map((r) => (
                                <li key={r.id}>
                                  <a
                                    className="text-accent hover:underline"
                                    href={`/admin/brand-workspace/organizations/${r.organizationId}#billing`}
                                  >
                                    {r.organizationName}
                                  </a>
                                  {r.redeemerName && ` (${r.redeemerName})`}
                                  {r.redeemedAt && ` · ${formatAdminTime(r.redeemedAt, locale)}`}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ),
                      validUntil: item.validUntil ? formatAdminTime(item.validUntil, locale) : bc.noExpiry,
                      status: (
                        <StatusPill tone={isDisabled ? 'hold' : 'done'}>
                          {isDisabled ? bc.statusDisabled : bc.statusActive}
                        </StatusPill>
                      ),
                      memo: item.memo || '—',
                      action: isDisabled ? (
                        <span className="admin-cell-sub">
                          {item.disabledAt ? formatAdminTime(item.disabledAt, locale) : bc.statusDisabled}
                        </span>
                      ) : (
                        <OpForm
                          op="brandBilling.discountCode.disable"
                          back={backUrl}
                          className="flex flex-col gap-1.5"
                        >
                          <input type="hidden" name="codeId" value={item.id} />
                          <ConfirmCheck label={bc.confirmDisable} />
                          <div>
                            <button type="submit" className={BUTTON}>
                              {bc.disableButton}
                            </button>
                          </div>
                        </OpForm>
                      ),
                    },
                  };
                })}
                empty={bc.empty}
              />
            </Panel>
          </>
        )}
      </div>
    </AdminShell>
  );
}
