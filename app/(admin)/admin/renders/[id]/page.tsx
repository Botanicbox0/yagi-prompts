import { notFound } from "next/navigation";
import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell } from "@/components/admin/chrome";
import { AdminPageHeader, FactList, StatusPill, Timeline } from "@/components/admin/patterns";
import { loadRenderDetail, paymentTone, renderTone } from "@/lib/admin/render-board";
import { formatAdminTime, formatKrw, formatUsd, shortId } from "@/lib/admin/format";

/**
 * `/admin/renders/[id]` — one render (docs/ADMIN.md §7.1): what it was, what it cost, the payment
 * behind it and when each step happened. The action bar only links to the lists that act on it;
 * retry and email re-send wait for the review in docs/ADMIN.md §8.
 */
export const dynamic = "force-dynamic";

export default async function RenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, locale, sql] = await Promise.all([params, getLocaleFromHeaders(), getSqlRunner()]);
  if (sql === null) notFound();
  const job = await loadRenderDetail(sql, id);
  if (job === null) notFound();

  const dict = getDictionary(locale);
  const a = dict.admin;
  const c = dict.adminConsole;
  const r = c.renders;
  const title = (locale === "ko" ? job.templateTitleKo : null) ?? job.templateTitle ?? job.templateSlug;
  const when = (value: string | null) => (value ? formatAdminTime(value, locale) : null);
  const manual = job.payment?.failureCode && ["refund_manual", "partial_balance", "fulfil_manual"].includes(job.payment.failureCode);
  const feedbackReasons = dict.renders.feedback.reasons as Record<string, string>;
  const mono = (value: string) => <code className="admin-id">{value}</code>;

  return (
    <AdminShell dict={a} locale={locale} active="renders">
      <AdminPageHeader
        back={{ href: "/admin/renders", label: r.title }}
        title={title}
        status={<StatusPill tone={renderTone(job.status)}>{a.renderStatuses[job.status]}</StatusPill>}
        lede={interpolate(r.detailLede, { id: shortId(job.id), kind: r.kinds[job.kind] })}
        actions={
          <div className="admin-action-row" data-admin-render-actions>
            <a href={`/admin/prompts/${job.templateId}`} className="admin-btn">
              {r.openTemplate}
            </a>
            {job.feedbackStatus ? (
              <a href="/admin/inquiries?kind=feedback&status=all" className="admin-btn">
                {r.openFeedback}
              </a>
            ) : null}
            {manual ? (
              <a href="/admin/payments" className="admin-btn admin-btn-primary">
                {r.openPayments}
              </a>
            ) : null}
          </div>
        }
      />

      <p className="admin-notice" data-admin-read-only>
        {r.readOnly}
      </p>

      <div className="admin-detail-grid" data-admin-render-detail={job.id}>
        <section className="admin-section" aria-labelledby="render-facts">
          <h2 id="render-facts">{r.factsHeading}</h2>
          <FactList
            items={[
              { label: r.facts.id, value: mono(job.id), wide: true },
              {
                label: r.facts.account,
                value: job.userId ? (
                  <a
                    href={`/admin/users?q=${shortId(job.userId)}`}
                    className="admin-row-link"
                    title={job.userId}
                  >
                    <span>{shortId(job.userId)}</span>
                  </a>
                ) : (
                  <span title={job.userId ?? undefined}>{shortId(job.userId)}</span>
                ),
              },
              { label: r.facts.template, value: job.templateSlug },
              {
                label: r.facts.spec,
                value: [r.media[job.medium as "video" | "image"] ?? job.medium, job.engine, job.aspect, job.resolution].filter(Boolean).join(" · "),
                wide: true,
              },
              { label: r.facts.provider, value: job.provider ?? "—" },
              { label: r.facts.task, value: job.providerTaskId ? mono(job.providerTaskId) : "—" },
              { label: r.facts.attempts, value: String(job.attempts) },
              {
                label: r.facts.cost,
                value: job.costSource
                  ? `${formatUsd(job.costUsd)} · ${r.costSource[job.costSource as keyof typeof r.costSource] ?? job.costSource}`
                  : formatUsd(job.costUsd),
              },
              {
                label: r.facts.size,
                value: job.resultBytes === null ? "—" : interpolate(r.megabytes, { size: (job.resultBytes / 1_048_576).toFixed(1) }),
              },
              {
                label: r.facts.notify,
                value: [
                  r.notify[job.notifyStatus as keyof typeof r.notify] ?? job.notifyStatus,
                  job.notifyChannel,
                  interpolate(r.notifyAttempts, { count: String(job.notifyAttempts) }),
                ].join(" · "),
              },
              { label: r.facts.errorCode, value: job.errorCode ? mono(job.errorCode) : "—" },
              { label: r.facts.errorMessage, value: job.errorMessage ?? "—", wide: true },
            ]}
          />
        </section>

        <section className="admin-section" aria-labelledby="render-timeline">
          <h2 id="render-timeline">{r.timelineHeading}</h2>
          <Timeline
            label={r.timelineHeading}
            pending={c.list.pending}
            items={[
              { key: "created", label: r.timeline.created, at: when(job.createdAt) },
              { key: "claimed", label: r.timeline.claimed, at: when(job.claimedAt) },
              { key: "started", label: r.timeline.started, at: when(job.startedAt) },
              { key: "finishing", label: r.timeline.finishing, at: when(job.finishingAt) },
              {
                key: "finished",
                label: r.timeline.finished,
                at: when(job.finishedAt),
                ...(job.finishedAt ? { detail: a.renderStatuses[job.status] } : {}),
              },
              {
                key: "notified",
                label: r.timeline.notified,
                at: when(job.notifiedAt),
                detail: r.notify[job.notifyStatus as keyof typeof r.notify] ?? job.notifyStatus,
              },
            ]}
          />
        </section>
      </div>

      <section className="admin-section" data-admin-render-payment aria-labelledby="render-payment">
        <h2 id="render-payment">{r.paymentHeading}</h2>
        {job.payment ? (
          <FactList
            items={[
              { label: r.paymentFacts.id, value: <span title={job.payment.id}>{shortId(job.payment.id)}</span> },
              {
                label: r.paymentFacts.status,
                value: (
                  <StatusPill tone={paymentTone(job.payment.status, job.payment.failureCode)}>
                    {c.payments.statuses[job.payment.status as keyof typeof c.payments.statuses] ?? job.payment.status}
                  </StatusPill>
                ),
              },
              { label: r.paymentFacts.amount, value: formatKrw(job.payment.amountKrw, locale) },
              { label: r.paymentFacts.approved, value: when(job.payment.approvedAt) ?? "—" },
              { label: r.paymentFacts.refunded, value: when(job.payment.refundedAt) ?? "—" },
              {
                label: r.paymentFacts.failure,
                value: job.payment.failureCode
                  ? c.payments.reasons[job.payment.failureCode as keyof typeof c.payments.reasons]?.label ?? job.payment.failureCode
                  : "—",
              },
              {
                label: r.paymentFacts.attempts,
                value: interpolate(c.payments.attempts, {
                  refund: String(job.payment.refundAttempts ?? "—"),
                  fulfil: String(job.payment.fulfilAttempts ?? "—"),
                }),
              },
            ]}
          />
        ) : (
          <p className="admin-empty">{r.noPayment}</p>
        )}
      </section>

      {job.feedbackStatus ? (
        <section className="admin-section" data-admin-render-feedback aria-labelledby="render-feedback">
          <h2 id="render-feedback">{r.feedbackHeading}</h2>
          <p className="admin-lede">
            {a.feedbackStatuses[job.feedbackStatus as keyof typeof a.feedbackStatuses] ?? job.feedbackStatus}
            {job.feedbackReason ? ` · ${feedbackReasons[job.feedbackReason] ?? job.feedbackReason}` : ""}
            {job.feedbackAt ? ` · ${formatAdminTime(job.feedbackAt, locale)}` : ""}
          </p>
        </section>
      ) : null}
    </AdminShell>
  );
}
