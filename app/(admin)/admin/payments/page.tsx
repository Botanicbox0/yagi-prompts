import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, StatusPill } from "@/components/admin/patterns";
import { loadManualPayments } from "@/lib/admin/render-board";
import { formatAdminTime, formatCount, formatKrw, shortId } from "@/lib/admin/format";

/**
 * `/admin/payments` — the payment check (docs/ADMIN.md §7.2). The Toss single payments the
 * automatic passes handed to a person: a refund or fulfilment that stopped at its ten-try cap, or a
 * partially cancelled balance (docs/PLATFORM-2.0.md §2.2-4). Before this page the home showed only
 * their number, and that number opened the feedback inbox.
 *
 * Read-only: settling a payment changes billing state, which this admin does not do (docs/ADMIN.md
 * §10-5). The operator handles it in the Toss console; each row says what to look at.
 */
export const dynamic = "force-dynamic";

export default async function PaymentChecksPage() {
  const [locale, sql] = await Promise.all([getLocaleFromHeaders(), getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const c = dict.adminConsole;
  const p = c.payments;
  const rows = sql === null ? null : await loadManualPayments(sql);

  return (
    <AdminShell dict={a} locale={locale} active="payments">
      <AdminPageHeader
        title={p.title}
        {...(rows && rows.length > 0
          ? { count: formatCount(rows.length, locale), countLabel: interpolate(c.home.waiting, { count: formatCount(rows.length, locale) }) }
          : {})}
        lede={p.lede}
      />

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
              { key: "amount", label: p.columns.amount, numeric: true },
              { key: "reason", label: p.columns.reason },
              { key: "attempts", label: p.columns.attempts },
              { key: "render", label: p.columns.render },
              { key: "account", label: p.columns.account },
            ]}
            rows={rows.map((row) => {
              const reason = p.reasons[row.failureCode];
              return {
                key: row.id,
                data: { "data-payment-row": row.id, "data-reason": row.failureCode },
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
                },
              };
            })}
          />
        </section>
      )}
    </AdminShell>
  );
}
