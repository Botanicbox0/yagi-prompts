import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatDate, formatKrw, interpolate } from "@/lib/i18n/format";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { loadAdminRenderBoard } from "@/lib/admin/renders-users";
import {
  AdminBadge,
  AdminFilterBar,
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  ConfirmCheck,
  INPUT,
  OpForm,
  OutcomeBanner,
  Panel,
} from "@/components/admin/chrome";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
};

export default async function AdminRendersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [, locale, params, sql] = await Promise.all([
    requireAdmin(),
    getLocaleFromHeaders(),
    searchParams,
    getSqlRunner(),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const rb = dict.adminWorkflow.renderBoard;

  const statusFilter = one(params, "status");
  const tab = one(params, "tab");
  const userId = one(params, "userId");

  const board =
    sql === null
      ? null
      : await loadAdminRenderBoard(sql, {
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(tab ? { tab } : {}),
          ...(userId ? { userId } : {}),
        });

  const showPaymentsFirst =
    tab === "payments" || (board !== null && board.summary.paymentsManual > 0);

  const paymentsPanel = board && (
    <Panel
      title={`${rb.paymentsTitle} (${board.payments.length})`}
      action={
        <OpForm op="payment.reconcile" back="/admin/renders?tab=payments">
          <button type="submit" className={BUTTON}>
            {rb.reconcileAll}
          </button>
        </OpForm>
      }
    >
      {board.payments.length === 0 ? (
        <p className="font-mono text-code opacity-60">{rb.paymentsEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            data-admin-payments-table
            className="w-full border-collapse text-left font-mono text-[0.76rem]"
          >
            <thead>
              <tr className="border-b border-hairline opacity-60">
                <th className="py-2 pr-3">{rb.colOrder}</th>
                <th className="py-2 pr-3">{rb.colTemplate}</th>
                <th className="py-2 pr-3">{rb.colAmount}</th>
                <th className="py-2 pr-3">{rb.colStatus}</th>
                <th className="py-2 pr-3">{rb.colRender}</th>
                <th className="py-2 pr-3">{rb.colCreated}</th>
                <th className="py-2">{rb.colAction}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {board.payments.map((p) => (
                <tr
                  key={p.id}
                  data-admin-payment-row={p.id}
                  data-manual={p.needsManualAction ? "true" : undefined}
                >
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold">{p.id.slice(0, 8)}</div>
                    <div className="opacity-65">
                      {p.userEmailMasked ?? p.userId?.slice(0, 8) ?? "—"}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <a
                      href={`/admin/prompts?q=${encodeURIComponent(p.templateSlug)}`}
                      className="text-accent hover:underline"
                    >
                      {p.templateSlug}
                    </a>
                    <div className="opacity-65">{p.orderName}</div>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {formatKrw(p.amountKrw, locale)}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AdminBadge
                        tone={
                          p.needsManualAction
                            ? "danger"
                            : p.status === "paid" || p.status === "refunded"
                              ? "success"
                              : p.status === "failed"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {p.status}
                      </AdminBadge>
                      {p.needsManualAction && (
                        <AdminBadge tone="danger">{rb.manualBadge}</AdminBadge>
                      )}
                    </div>
                    {p.failureCode && (
                      <div className="mt-1 opacity-70">{p.failureCode}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {p.renderId ? (
                      <a
                        href={`/admin/renders#${p.renderId}`}
                        className="text-accent hover:underline"
                      >
                        {p.renderId.slice(0, 8)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums opacity-70">
                    {formatDate(p.createdAt, locale)}
                  </td>
                  <td className="py-2.5">
                    <OpForm
                      op="payment.reconcile"
                      back="/admin/renders?tab=payments"
                    >
                      <input type="hidden" name="orderId" value={p.id} />
                      <button type="submit" className={BUTTON}>
                        {rb.reconcileOne}
                      </button>
                    </OpForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  const jobsPanel = board && (
    <Panel title={`${rb.jobsTitle} (${board.jobs.length})`}>
      {board.jobs.length === 0 ? (
        <p className="font-mono text-code opacity-60">{rb.jobsEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            data-admin-renders-table
            className="w-full border-collapse text-left font-mono text-[0.76rem]"
          >
            <thead>
              <tr className="border-b border-hairline opacity-60">
                <th className="py-2 pr-3">{rb.colJob}</th>
                <th className="py-2 pr-3">{rb.colTemplate}</th>
                <th className="py-2 pr-3">{rb.colEngine}</th>
                <th className="py-2 pr-3">{rb.colStatus}</th>
                <th className="py-2 pr-3">{rb.colError}</th>
                <th className="py-2 pr-3">{rb.colDelivery}</th>
                <th className="py-2">{rb.colAction}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {board.jobs.map((j) => (
                <tr
                  key={j.id}
                  id={j.id}
                  data-admin-render-row={j.id}
                  data-render-status={j.status}
                >
                  <td className="py-2.5 pr-3 align-top">
                    <div className="font-semibold">{j.id.slice(0, 8)}</div>
                    <a
                      href={`/admin/users?q=${encodeURIComponent(j.userId.slice(0, 8))}`}
                      className="text-accent hover:underline"
                    >
                      {j.userEmailMasked ?? j.userId.slice(0, 8)}
                    </a>
                    <div className="tabular-nums opacity-60">
                      {formatDate(j.createdAt, locale)}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <a
                      href={`/admin/prompts/${j.templateId}`}
                      className="text-accent hover:underline"
                    >
                      {j.templateSlug}
                    </a>
                    <div className="opacity-65">
                      {j.medium} · {j.aspect}
                      {j.resolution ? ` · ${j.resolution}` : ""}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 align-top tabular-nums">
                    <div>{j.engine}</div>
                    <div className="opacity-65">
                      {j.provider ?? "—"}
                      {j.costUsd !== null
                        ? ` · $${j.costUsd.toFixed(3)}`
                        : ""}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <AdminBadge
                      tone={
                        j.status === "failed"
                          ? "danger"
                          : j.status === "held"
                            ? "warning"
                            : j.status === "succeeded"
                              ? "success"
                              : "accent"
                      }
                    >
                      {j.status}
                    </AdminBadge>
                    <div className="mt-1 tabular-nums opacity-65">
                      #{j.attempts}
                    </div>
                  </td>
                  <td className="max-w-xs py-2.5 pr-3 align-top">
                    {j.errorCode ? (
                      <>
                        <div className="font-semibold">{j.errorCode}</div>
                        {j.errorMessage && (
                          <div className="mt-0.5 break-words opacity-70">
                            {j.errorMessage}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="opacity-45">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <div>
                      {j.paymentStatus ? (
                        <span>
                          {j.paymentStatus}
                          {j.amountKrw !== null
                            ? ` (${formatKrw(j.amountKrw, locale)})`
                            : ""}
                        </span>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </div>
                    <div className="mt-0.5 opacity-70">
                      notify: {j.notifyStatus} ({j.notifyAttempts})
                    </div>
                    {j.feedbackStatus && (
                      <div className="mt-0.5">
                        <a
                          href="/admin/inquiries?kind=feedback"
                          className="text-accent hover:underline"
                        >
                          feedback: {j.feedbackStatus}
                        </a>
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 align-top">
                    <div className="flex flex-col gap-2">
                      {j.status === "failed" && j.retryable && (
                        <OpForm
                          op="render.retry"
                          back="/admin/renders?status=failed"
                          className="flex flex-wrap items-center gap-1.5"
                        >
                          <input type="hidden" name="id" value={j.id} />
                          <input
                            type="text"
                            name="reason"
                            required
                            placeholder={rb.retryReasonPlaceholder}
                            className={`${INPUT} w-36`}
                          />
                          <ConfirmCheck label={rb.confirmRetry} />
                          <button type="submit" className={BUTTON_PRIMARY}>
                            {rb.retryAction}
                          </button>
                        </OpForm>
                      )}
                      {j.status === "failed" && !j.retryable && (
                        <span className="text-[0.7rem] opacity-60">
                          {rb.safetyBlocked}
                        </span>
                      )}
                      {(j.status === "succeeded" || j.status === "failed") &&
                        j.notifyStatus !== "sent" && (
                          <OpForm
                            op="render.resendNotification"
                            back="/admin/renders"
                          >
                            <input type="hidden" name="id" value={j.id} />
                            <button type="submit" className={BUTTON}>
                              {rb.resendNotify}
                            </button>
                          </OpForm>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  return (
    <AdminShell dict={a} locale={locale} active="renders">
      <div data-admin-renders-board>
        <h1 className="text-3xl font-semibold leading-tight">{rb.heading}</h1>
        <p className="mt-3 max-w-detail text-body opacity-65">{rb.lede}</p>

        <OutcomeBanner
          dict={a}
          {...(one(params, "ok") ? { ok: one(params, "ok")! } : {})}
          {...(one(params, "err") ? { err: one(params, "err")! } : {})}
          {...(one(params, "detail") ? { detail: one(params, "detail")! } : {})}
        />

        {board === null ? (
          <p role="status" className="admin-empty-state mt-6">
            {dict.adminWorkflow.unavailable}
          </p>
        ) : (
          <>
            <div
              data-admin-renders-kpis
              className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono text-[0.76rem] tabular-nums"
            >
              <div className="border border-hairline px-3 py-2.5">
                {interpolate(rb.kpiWeek, {
                  count: board.summary.recent.toLocaleString(locale),
                })}
              </div>
              <div className="border border-hairline px-3 py-2.5">
                {interpolate(rb.kpiRunning, {
                  count: board.summary.running.toLocaleString(locale),
                })}
              </div>
              <div className="border border-hairline px-3 py-2.5">
                {interpolate(rb.kpiFailed, {
                  count: board.summary.failed.toLocaleString(locale),
                })}
              </div>
              <div className="border border-hairline px-3 py-2.5">
                {interpolate(rb.kpiHeld, {
                  count: board.summary.held.toLocaleString(locale),
                })}
              </div>
              <div className="border border-hairline px-3 py-2.5">
                {interpolate(rb.kpiCost, {
                  cost: board.summary.costUsd7d.toFixed(2),
                })}
              </div>
              <div className="border border-hairline px-3 py-2.5">
                {interpolate(rb.kpiManualPayments, {
                  count: board.summary.paymentsManual.toLocaleString(locale),
                })}
              </div>
            </div>

            <AdminFilterBar
              ariaLabel={rb.heading}
              items={[
                {
                  href: "/admin/renders",
                  label: rb.filterAll,
                  count: board.summary.recent,
                  active: !statusFilter && tab !== "payments",
                },
                {
                  href: "/admin/renders?status=failed",
                  label: rb.filterFailed,
                  count: board.summary.failed,
                  active: statusFilter === "failed",
                },
                {
                  href: "/admin/renders?status=running",
                  label: rb.filterRunning,
                  count: board.summary.running,
                  active: statusFilter === "running",
                },
                {
                  href: "/admin/renders?status=held",
                  label: rb.filterHeld,
                  count: board.summary.held,
                  active: statusFilter === "held",
                },
                {
                  href: "/admin/renders?status=succeeded",
                  label: rb.filterSucceeded,
                  active: statusFilter === "succeeded",
                },
                {
                  href: "/admin/renders?tab=payments",
                  label: rb.filterPayments,
                  count: board.summary.paymentsManual,
                  active: tab === "payments",
                },
              ]}
              trailing={
                userId ? (
                  <a href="/admin/renders" className={BUTTON}>
                    {rb.clearUserFilter} ({userId.slice(0, 8)})
                  </a>
                ) : undefined
              }
            />

            {showPaymentsFirst ? (
              <>
                {paymentsPanel}
                {jobsPanel}
              </>
            ) : (
              <>
                {jobsPanel}
                {paymentsPanel}
              </>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
