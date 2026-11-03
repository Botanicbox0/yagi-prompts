import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell } from "@/components/admin/chrome";
import {
  AdminPageHeader,
  AdminTable,
  FilterPills,
  Pager,
  StatusPill,
} from "@/components/admin/patterns";
import {
  RENDER_MEDIA,
  RENDER_PAGE_SIZE,
  RENDER_STATUSES,
  loadRenderBoard,
  paymentTone,
  renderBoardFilter,
  renderBoardHref,
  renderTone,
} from "@/lib/admin/render-board";
import { formatAdminTime, formatCount, formatDuration, formatUsd, shortId } from "@/lib/admin/format";

/**
 * `/admin/renders` — the render board (docs/ADMIN.md §7.1, PLATFORM-2.0 §10). Every render, newest
 * first, with its status, time, provider cost, the payment behind it and why it failed. Filters are
 * links and a GET form, so a filtered board is a URL an operator can send. Read-only.
 */
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function RenderBoardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const c = dict.adminConsole;
  const r = c.renders;
  const filter = renderBoardFilter(params);
  const board = sql === null ? null : await loadRenderBoard(sql, filter);

  const allCount = board ? Object.values(board.byStatus).reduce((sum, n) => sum + n, 0) : 0;
  const first = board && board.total > 0 ? (filter.page - 1) * RENDER_PAGE_SIZE + 1 : 0;
  const last = board ? Math.min(filter.page * RENDER_PAGE_SIZE, board.total) : 0;

  return (
    <AdminShell dict={a} locale={locale} active="renders">
      <AdminPageHeader
        title={r.title}
        {...(board ? { count: formatCount(board.total, locale), countLabel: interpolate(r.count, { count: formatCount(board.total, locale) }) } : {})}
        lede={r.lede}
      />

      {board === null ? (
        <p role="status" className="admin-notice">
          {dict.adminWorkflow.unavailable}
        </p>
      ) : (
        <section className="admin-section" data-admin-render-board aria-label={r.title}>
          <div className="admin-stats" data-admin-render-summary>
            {(
              [
                [
                  r.summary.week,
                  [
                    [r.summary.recent, formatCount(board.summary.recent, locale)],
                    [r.summary.failed, formatCount(board.summary.failed, locale)],
                    [r.summary.cost, formatUsd(board.summary.costUsd)],
                  ],
                ],
                [
                  r.summary.now,
                  [
                    [r.summary.held, formatCount(board.summary.held, locale)],
                    [r.summary.queued, formatCount(board.summary.queued, locale)],
                    [r.summary.running, formatCount(board.summary.running, locale)],
                  ],
                ],
              ] as const
            ).map(([heading, stats]) => (
              <section key={heading} aria-label={heading}>
                <h2>{heading}</h2>
                <dl>
                  {stats.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          <div className="admin-toolbar">
            <FilterPills
              label={r.statusFilter}
              pills={[
                { key: "all", label: c.list.all, href: renderBoardHref(filter, { status: null }), count: formatCount(allCount, locale), current: filter.status === null },
                ...RENDER_STATUSES.map((status) => ({
                  key: status,
                  label: a.renderStatuses[status],
                  href: renderBoardHref(filter, { status }),
                  count: formatCount(board.byStatus[status], locale),
                  current: filter.status === status,
                })),
              ]}
            />
            <FilterPills
              label={r.mediumFilter}
              pills={[
                { key: "all-media", label: c.list.all, href: renderBoardHref(filter, { medium: null }), current: filter.medium === null },
                ...RENDER_MEDIA.map((medium) => ({
                  key: medium,
                  label: r.media[medium],
                  href: renderBoardHref(filter, { medium }),
                  current: filter.medium === medium,
                })),
              ]}
            />
            <form method="get" action="/admin/renders" className="admin-search" role="search">
              {filter.status ? <input type="hidden" name="status" value={filter.status} /> : null}
              {filter.medium ? <input type="hidden" name="medium" value={filter.medium} /> : null}
              <input
                type="search"
                name="q"
                defaultValue={filter.query}
                placeholder={r.searchPlaceholder}
                aria-label={c.list.search}
              />
              <button type="submit" className="admin-btn">
                {c.list.find}
              </button>
              {filter.query ? (
                <a href={renderBoardHref(filter, { query: "" })} className="admin-btn">
                  {c.list.clear}
                </a>
              ) : null}
            </form>
          </div>

          <AdminTable
            caption={r.title}
            empty={allCount === 0 ? r.emptyAll : r.empty}
            columns={[
              { key: "created", label: r.columns.created },
              { key: "template", label: r.columns.template },
              { key: "engine", label: r.columns.engine },
              { key: "status", label: r.columns.status },
              { key: "duration", label: r.columns.duration, numeric: true },
              { key: "cost", label: r.columns.cost, numeric: true },
              { key: "kind", label: r.columns.kind },
              { key: "payment", label: r.columns.payment },
              { key: "notify", label: r.columns.notify },
              { key: "error", label: r.columns.error },
            ]}
            rows={board.rows.map((job) => {
              const title = (locale === "ko" ? job.templateTitleKo : null) ?? job.templateTitle ?? job.templateSlug;
              return {
                key: job.id,
                data: { "data-render-row": job.id, "data-status": job.status },
                cells: {
                  created: <span className="admin-nowrap">{formatAdminTime(job.createdAt, locale)}</span>,
                  template: (
                    <a href={`/admin/renders/${job.id}`} className="admin-row-link">
                      <span>{title}</span>
                      <span className="admin-cell-sub" title={job.id}>
                        {job.templateSlug} · {shortId(job.id)}
                      </span>
                    </a>
                  ),
                  engine: (
                    <span>
                      {job.engine}
                      <span className="admin-cell-sub">
                        {[r.media[job.medium as "video" | "image"] ?? job.medium, job.aspect, job.resolution].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  ),
                  status: <StatusPill tone={renderTone(job.status)}>{a.renderStatuses[job.status]}</StatusPill>,
                  duration: formatDuration(job.startedAt ?? job.createdAt, job.finishedAt, locale) ?? "—",
                  cost: formatUsd(job.costUsd),
                  kind: <span className="admin-nowrap">{r.kinds[job.kind]}</span>,
                  payment: job.paymentStatus ? (
                    <StatusPill tone={paymentTone(job.paymentStatus, job.paymentFailure)}>
                      {c.payments.statuses[job.paymentStatus as keyof typeof c.payments.statuses] ?? job.paymentStatus}
                    </StatusPill>
                  ) : (
                    "—"
                  ),
                  notify: <span className="admin-nowrap">{r.notify[job.notifyStatus as keyof typeof r.notify] ?? job.notifyStatus}</span>,
                  error: job.errorCode ? (
                    <span title={job.errorMessage ?? undefined}>
                      <code>{job.errorCode}</code>
                      {job.errorMessage ? <span className="admin-cell-sub">{job.errorMessage.slice(0, 80)}</span> : null}
                    </span>
                  ) : (
                    "—"
                  ),
                },
              };
            })}
          />

          {board.total > 0 ? (
            <Pager
              label={c.list.pages}
              summary={interpolate(c.list.range, {
                from: formatCount(first, locale),
                to: formatCount(last, locale),
                total: formatCount(board.total, locale),
              })}
              prev={filter.page > 1 ? renderBoardHref(filter, { page: filter.page - 1 }) : null}
              next={last < board.total ? renderBoardHref(filter, { page: filter.page + 1 }) : null}
              prevLabel={c.list.prev}
              nextLabel={c.list.next}
            />
          ) : null}
        </section>
      )}
    </AdminShell>
  );
}
