import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { STUDIO_JOB_KINDS } from '@/lib/brand-studio/contracts';
import { STUDIO_LANES } from '@/lib/brand-studio/models';
import {
  loadBrandStudioOps,
  STUDIO_OPS_PAGE_SIZE,
  studioOpsFilter,
  studioOpsHref,
  type StudioLaneStatusRow,
} from '@/lib/admin/brand-studio-ops';
import { formatAdminTime, formatCount, formatKrw, shortId } from '@/lib/admin/format';
import { interpolate } from '@/lib/i18n/format';
import { AdminShell, Panel } from '@/components/admin/chrome';
import {
  AdminPageHeader,
  AdminTable,
  FilterPills,
  MetricStrip,
  Pager,
  StatusPill,
} from '@/components/admin/patterns';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function formatDurationSeconds(seconds: number | null, locale: 'ko' | 'en'): string {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return locale === 'ko' ? `${s}초` : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return locale === 'ko' ? `${m}분` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return locale === 'ko'
    ? remM > 0
      ? `${h}시간 ${remM}분`
      : `${h}시간`
    : remM > 0
      ? `${h}h ${remM}m`
      : `${h}h`;
}

function renderLaneState(
  row: StudioLaneStatusRow,
  bs: ReturnType<typeof getDictionary>['adminConsole']['brandStudioOps'],
  nowMs: number,
) {
  if (row.stale) {
    return (
      <span
        data-lane-stale="true"
        className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700"
      >
        {bs.laneStates.stale}
      </span>
    );
  }
  if (row.closedUntil && Date.parse(row.closedUntil) > nowMs) {
    return <StatusPill tone="action">{bs.laneStates.closed}</StatusPill>;
  }
  if (row.seenAt || row.runningCount > 0) {
    return <StatusPill tone="done">{bs.laneStates.healthy}</StatusPill>;
  }
  return <StatusPill tone="hold">{bs.laneStates.standby}</StatusPill>;
}

export default async function BrandStudioOpsPage(props?: { searchParams?: Promise<SearchParams> }) {
  const [viewer, sql, locale, params] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    props?.searchParams ?? Promise.resolve({} as SearchParams),
  ]);

  const dict = getDictionary(locale);
  const c = dict.adminConsole;
  const bs = c.brandStudioOps;
  const ol = c.brandOrgList;
  const filter = studioOpsFilter(params);
  const now = new Date();
  const data = sql ? await loadBrandStudioOps(sql, viewer, filter, now) : null;

  const first = data && data.failedFilteredTotal > 0 ? (filter.page - 1) * STUDIO_OPS_PAGE_SIZE + 1 : 0;
  const last = data ? Math.min(filter.page * STUDIO_OPS_PAGE_SIZE, data.failedFilteredTotal) : 0;

  const mcpLane = data?.lanes.find((l) => l.lane === 'sunra_mcp');
  const ratePct =
    data?.hourlyStats.failureRate1h != null ? `${Math.round(data.hourlyStats.failureRate1h * 100)}%` : '—';
  const rateSub =
    data?.hourlyStats.failureRate1h != null
      ? interpolate(bs.failureRateSub, {
          failed: formatCount(data.hourlyStats.failed1h, locale),
          finished: formatCount(data.hourlyStats.finished1h, locale),
        })
      : bs.noFinished1h;

  const rateTone: 'done' | 'action' | 'fail' =
    data?.hourlyStats.failureRate1h != null &&
    data.hourlyStats.failureRate1h >= 0.5 &&
    data.hourlyStats.failed1h >= 5
      ? 'fail'
      : (data?.hourlyStats.failed1h ?? 0) > 0
        ? 'action'
        : 'done';

  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandStudio">
      <div data-brand-studio-ops>
        <AdminPageHeader
          title={bs.title}
          {...(data?.available ? { count: formatCount(data.failedTotal7d, locale) } : {})}
          lede={bs.lede}
          actions={
            <>
              <a className="admin-btn" href="/admin/brand-studio/reviews" data-studio-reviews-link>
                {dict.studioReview.admin.navLink} →
              </a>
              <a className="admin-btn" href="/admin/brand-workspace" data-studio-orgs-link>
                {c.nav.brandWorkspace} →
              </a>
            </>
          }
        />

        {!data?.available ? (
          <p className="admin-notice">{bs.unavailable}</p>
        ) : (
          <>
            <section className="admin-section" data-studio-health-summary>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2>{bs.metricsHeading}</h2>
                {data.accountLaneStale && (
                  <span
                    data-lane-stale="true"
                    className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
                  >
                    {bs.laneStaleBadge}
                  </span>
                )}
              </div>
              <MetricStrip
                label={bs.metricsHeading}
                items={[
                  {
                    key: 'rate-1h',
                    label: bs.failureRate1h,
                    value: ratePct,
                    sub: rateSub,
                    tone: rateTone,
                  },
                  {
                    key: 'fail-24h',
                    label: bs.failures24h,
                    value: formatCount(data.hourlyStats.failed24h, locale),
                    sub: interpolate(bs.failures7d, { count: formatCount(data.failedTotal7d, locale) }),
                    tone: data.hourlyStats.failed24h > 0 ? 'action' : 'done',
                  },
                  {
                    key: 'account-lane',
                    label: bs.laneHealthCard,
                    value: data.accountLaneStale
                      ? bs.laneStaleBadge
                      : mcpLane?.seenAt
                        ? bs.laneHealthy
                        : bs.laneNeverSeen,
                    sub: mcpLane?.seenAt
                      ? `${formatAdminTime(mcpLane.seenAt, locale)} (${formatDurationSeconds(mcpLane.heartbeatAgeSeconds, locale)})`
                      : undefined,
                    tone: data.accountLaneStale ? 'fail' : mcpLane?.seenAt ? 'done' : 'hold',
                  },
                ]}
              />
            </section>

            <Panel title={bs.lanesHeading} id="studio-lanes">
              <AdminTable
                caption={bs.lanesHeading}
                columns={[
                  { key: 'lane', label: bs.laneCols.lane },
                  { key: 'running', label: bs.laneCols.running, numeric: true },
                  { key: 'queued', label: bs.laneCols.queued, numeric: true },
                  { key: 'oldestQueued', label: bs.laneCols.oldestQueued },
                  { key: 'heartbeat', label: bs.laneCols.heartbeat },
                  { key: 'state', label: bs.laneCols.state },
                ]}
                rows={data.lanes.map((row) => ({
                  key: row.lane,
                  data: {
                    'data-lane-row': row.lane,
                    'data-lane-stale': row.stale ? 'true' : 'false',
                  },
                  cells: {
                    lane: <strong>{bs.laneNames[row.lane]}</strong>,
                    running: formatCount(row.runningCount, locale),
                    queued: formatCount(row.queuedCount, locale),
                    oldestQueued: row.oldestQueuedAt ? (
                      <span className="admin-nowrap">
                        {formatDurationSeconds(row.oldestQueuedAgeSeconds, locale)}
                        <span className="admin-cell-sub">{formatAdminTime(row.oldestQueuedAt, locale)}</span>
                      </span>
                    ) : (
                      '—'
                    ),
                    heartbeat: row.seenAt ? (
                      <span className="admin-nowrap">
                        {formatAdminTime(row.seenAt, locale)}
                        <span className="admin-cell-sub">
                          {formatDurationSeconds(row.heartbeatAgeSeconds, locale)}
                        </span>
                      </span>
                    ) : (
                      <span className="admin-cell-sub">{bs.laneNeverSeen}</span>
                    ),
                    state: renderLaneState(row, bs, now.getTime()),
                  },
                }))}
                empty={bs.unavailable}
              />
            </Panel>

            <Panel
              title={bs.failedHeading}
              id="failed-jobs"
              action={<span className="text-xs font-mono opacity-75">{formatCount(data.failedFilteredTotal, locale)}</span>}
            >
              <div className="admin-toolbar" style={{ marginBottom: 12 }}>
                <FilterPills
                  label={bs.kindFilter}
                  pills={[
                    {
                      key: 'all-kinds',
                      label: ol.filters.all,
                      href: studioOpsHref(filter, { kind: null, page: 1 }),
                      current: filter.kind === null,
                    },
                    ...STUDIO_JOB_KINDS.map((kind) => ({
                      key: kind,
                      label: kind,
                      href: studioOpsHref(filter, { kind, page: 1 }),
                      current: filter.kind === kind,
                    })),
                  ]}
                />

                <FilterPills
                  label={bs.laneFilter}
                  pills={[
                    {
                      key: 'all-lanes',
                      label: ol.filters.all,
                      href: studioOpsHref(filter, { lane: null, page: 1 }),
                      current: filter.lane === null,
                    },
                    ...(['held', ...STUDIO_LANES] as const).map((lane) => ({
                      key: lane,
                      label: bs.laneNames[lane],
                      href: studioOpsHref(filter, { lane, page: 1 }),
                      current: filter.lane === lane,
                    })),
                  ]}
                />

                <form method="get" action="/admin/brand-studio" className="admin-search" role="search">
                  {filter.kind && <input type="hidden" name="kind" value={filter.kind} />}
                  {filter.lane && <input type="hidden" name="lane" value={filter.lane} />}
                  <label className="flex items-center gap-1.5 text-xs">
                    <span>{bs.errorFilter}</span>
                    <select
                      name="errorCode"
                      defaultValue={filter.errorCode}
                      className="admin-input"
                      style={{ minHeight: 36, width: 'auto', padding: '0 10px' }}
                    >
                      <option value="">{ol.filters.all}</option>
                      {data.availableErrorCodes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    type="search"
                    name="q"
                    defaultValue={filter.query}
                    placeholder={bs.searchPlaceholder}
                    aria-label={c.list.search}
                  />
                  <button type="submit" className="admin-btn">
                    {c.list.find}
                  </button>
                  {(filter.kind || filter.lane || filter.errorCode || filter.query) && (
                    <a href="/admin/brand-studio" className="admin-btn">
                      {c.list.clear}
                    </a>
                  )}
                </form>
              </div>

              <AdminTable
                caption={bs.failedHeading}
                columns={[
                  { key: 'time', label: bs.columns.time },
                  { key: 'org', label: bs.columns.org },
                  { key: 'kind', label: bs.columns.kind },
                  { key: 'model', label: bs.columns.model },
                  { key: 'error', label: bs.columns.error },
                  { key: 'returned', label: bs.columns.returned, numeric: true },
                ]}
                rows={data.failedJobs.map((j) => ({
                  key: j.id,
                  data: { 'data-failed-job-row': j.id },
                  cells: {
                    time: (
                      <span className="admin-nowrap" title={j.id}>
                        {formatAdminTime(j.finishedAt ?? j.createdAt, locale)}
                        <span className="admin-cell-sub">{shortId(j.id)}</span>
                      </span>
                    ),
                    org: (
                      <a
                        className="font-semibold text-accent hover:underline"
                        href={`/admin/brand-workspace/organizations/${j.organizationId}#studio-jobs`}
                      >
                        {j.organizationName}
                      </a>
                    ),
                    kind: <span className="admin-nowrap">{j.kind}</span>,
                    model: (
                      <span>
                        {j.model}
                        <span className="admin-cell-sub">
                          {j.lane ? bs.laneNames[j.lane] : bs.laneNames.held}
                        </span>
                      </span>
                    ),
                    error: (
                      <span>
                        <code>{j.errorCode ?? 'unknown'}</code>
                        <span className="admin-cell-sub">{j.errorDetail || '—'}</span>
                      </span>
                    ),
                    returned: (
                      <span className="admin-nowrap">
                        <strong>{formatKrw(j.returnedKrw, locale)}</strong>
                        {j.estimateKrw > 0 && (
                          <span className="admin-cell-sub">{formatKrw(j.estimateKrw, locale)}</span>
                        )}
                      </span>
                    ),
                  },
                }))}
                empty={bs.empty}
              />

              {data.failedFilteredTotal > 0 && (
                <Pager
                  label={c.list.pages}
                  summary={interpolate(c.list.range, {
                    from: formatCount(first, locale),
                    to: formatCount(last, locale),
                    total: formatCount(data.failedFilteredTotal, locale),
                  })}
                  prev={filter.page > 1 ? studioOpsHref(filter, { page: filter.page - 1 }) : null}
                  next={last < data.failedFilteredTotal ? studioOpsHref(filter, { page: filter.page + 1 }) : null}
                  prevLabel={c.list.prev}
                  nextLabel={c.list.next}
                />
              )}
            </Panel>
          </>
        )}
      </div>
    </AdminShell>
  );
}
