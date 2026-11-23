import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/format";
import { getTossGateway } from "@/lib/billing/toss-gateway";
import { AdminShell, BUTTON, BUTTON_PRIMARY, Field, INPUT, OpForm, OutcomeBanner, Panel } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, FilterPills, StatusPill } from "@/components/admin/patterns";
import {
  countManualPaymentsByEnvironment,
  loadManualPayments,
  paymentChecksFilter,
  type PaymentEnvironment,
} from "@/lib/admin/render-board";
import { formatAdminTime, formatCount, formatKrw, shortId } from "@/lib/admin/format";

/**
 * `/admin/payments` — the payment check (docs/ADMIN.md §7.2, docs/PLATFORM-2.0.md §2.3).
 *
 * Scoped to the deployment's own Toss environment by default (`live` vs `test`), with a filter
 * toggle to inspect the other environment. Supports `billing.payment.recheck` so an operator can
 * refresh a single consumer payment from Toss via the existing reconcile/webhook seam without
 * altering settlement rules, and records an audit row in `platform_audit`.
 */
export const dynamic = "force-dynamic";

function one(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function activeGatewayKind(): PaymentEnvironment | null {
  try {
    return getTossGateway()?.kind ?? null;
  } catch {
    return null;
  }
}

export default async function PaymentChecksPage(props?: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout's check is not enough on its own: a client navigation request can ask for this page
  // segment alone, and then the layout does not run. Every admin page verifies the admin itself.
  await requireAdmin();
  const [locale, sql, query] = await Promise.all([
    getLocaleFromHeaders(),
    getSqlRunner(),
    props?.searchParams ? props.searchParams : Promise.resolve({}),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const c = dict.adminConsole;
  const p = c.payments;

  const filter = paymentChecksFilter(query);
  const otherEnv = filter.defaultEnvironment === "live" ? "test" : "live";
  const currentHref =
    filter.environment === filter.defaultEnvironment
      ? "/admin/payments"
      : `/admin/payments?env=${filter.environment}`;
  const gatewayKind = activeGatewayKind();

  const [rows, envCounts] =
    sql === null
      ? [null, null]
      : await Promise.all([
          loadManualPayments(sql, filter.environment),
          countManualPaymentsByEnvironment(sql),
        ]);

  const pillOrder = [filter.defaultEnvironment, otherEnv] as const;

  return (
    <AdminShell dict={a} locale={locale} active="payments">
      <AdminPageHeader
        title={p.title}
        {...(rows && rows.length > 0
          ? {
              count: formatCount(rows.length, locale),
              countLabel: interpolate(c.home.waiting, { count: formatCount(rows.length, locale) }),
            }
          : {})}
        lede={p.lede}
        actions={
          <StatusPill tone={filter.defaultEnvironment === "live" ? "action" : "hold"}>
            {interpolate(p.currentEnvBadge, { env: p.environments[filter.defaultEnvironment] })}
          </StatusPill>
        }
      />

      <OutcomeBanner
        dict={a}
        ok={one(query, "ok")}
        err={one(query, "err")}
        detail={one(query, "detail")}
      />

      <FilterPills
        label={p.envFilterLabel}
        pills={pillOrder.map((env) => ({
          key: env,
          label: p.environments[env],
          href: env === filter.defaultEnvironment ? "/admin/payments" : `/admin/payments?env=${env}`,
          ...(envCounts ? { count: formatCount(envCounts[env], locale) } : {}),
          current: filter.environment === env,
        }))}
      />

      {filter.environment !== filter.defaultEnvironment ? (
        <p role="status" className="admin-notice" data-admin-payments-other-env>
          {p.otherEnvNotice}
        </p>
      ) : null}

      {rows === null ? (
        <p role="status" className="admin-notice">
          {dict.adminWorkflow.unavailable}
        </p>
      ) : (
        <section className="admin-section" data-admin-payments={rows.length} aria-label={p.title}>
          <AdminTable
            caption={p.title}
            empty={p.empty}
            columns={[
              { key: "created", label: p.columns.created },
              { key: "order", label: p.columns.order },
              { key: "environment", label: p.columns.environment },
              { key: "amount", label: p.columns.amount, numeric: true },
              { key: "reason", label: p.columns.reason },
              { key: "attempts", label: p.columns.attempts },
              { key: "render", label: p.columns.render },
              { key: "account", label: p.columns.account },
              { key: "action", label: p.columns.action },
            ]}
            rows={rows.map((row) => {
              const reason = p.reasons[row.failureCode];
              const canRecheckRow = gatewayKind !== null && row.environment === gatewayKind;
              return {
                key: row.id,
                data: {
                  "data-payment-row": row.id,
                  "data-reason": row.failureCode,
                  "data-environment": row.environment,
                },
                cells: {
                  created: <span className="admin-nowrap">{formatAdminTime(row.createdAt, locale)}</span>,
                  order: (
                    <span title={row.id}>
                      {row.orderName}
                      <span className="admin-cell-sub">
                        {[row.templateSlug, shortId(row.id)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  ),
                  environment: (
                    <StatusPill tone={row.environment === "live" ? "action" : "hold"}>
                      {p.environments[row.environment]}
                    </StatusPill>
                  ),
                  amount: formatKrw(row.amountKrw, locale),
                  reason: (
                    <span>
                      <StatusPill tone="action">{reason.label}</StatusPill>
                      <span className="admin-cell-sub admin-cell-wrap">{reason.hint}</span>
                    </span>
                  ),
                  attempts: interpolate(p.attempts, {
                    refund: String(row.refundAttempts ?? "—"),
                    fulfil: String(row.fulfilAttempts ?? "—"),
                  }),
                  render: row.renderId ? (
                    <a href={`/admin/renders/${row.renderId}`} className="admin-row-link" title={row.renderId}>
                      <span>{shortId(row.renderId)}</span>
                      {row.renderStatus ? (
                        <span className="admin-cell-sub">
                          {a.renderStatuses[row.renderStatus as keyof typeof a.renderStatuses] ?? row.renderStatus}
                        </span>
                      ) : null}
                    </a>
                  ) : (
                    p.noRender
                  ),
                  account: row.userId ? (
                    <a
                      href={`/admin/users?q=${shortId(row.userId)}`}
                      className="admin-row-link"
                      title={row.userId}
                    >
                      <span>{shortId(row.userId)}</span>
                    </a>
                  ) : (
                    <span title={row.userId ?? undefined}>{shortId(row.userId)}</span>
                  ),
                  action: canRecheckRow ? (
                    <OpForm op="billing.payment.recheck" back={currentHref}>
                      <input type="hidden" name="paymentId" value={row.id} />
                      <button type="submit" className={BUTTON} data-payment-recheck={row.id}>
                        {p.recheckButton}
                      </button>
                    </OpForm>
                  ) : (
                    <span className="admin-cell-sub">
                      {gatewayKind === null ? p.recheckUnavailable : p.recheckOtherEnv}
                    </span>
                  ),
                },
              };
            })}
          />
        </section>
      )}

      {sql !== null && gatewayKind !== null ? (
        <Panel title={p.recheckByIdHeading} id="payment-recheck">
          <p className="admin-lede">{p.recheckByIdHint}</p>
          <OpForm op="billing.payment.recheck" back={currentHref} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <Field label={p.recheckByIdLabel}>
                <input
                  type="text"
                  name="paymentId"
                  required
                  pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                  placeholder={p.recheckByIdPlaceholder}
                  className={INPUT}
                />
              </Field>
            </div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {p.recheckByIdSubmit}
            </button>
          </OpForm>
        </Panel>
      ) : null}
    </AdminShell>
  );
}
