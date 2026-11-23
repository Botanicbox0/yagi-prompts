import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate, interpolate } from '@/lib/i18n/format';

/** Raw UUIDs are support lookups, not content: the first block is enough to find the row (P3). */
const shortId = (id: string): string => id.slice(0, 8);
import { listBrandInquiries, type BrandInquiry } from '@/lib/brands/repo';
import { loadBrandInquiryDeliveryStates, type BrandInquiryDeliveryStatus } from '@/lib/brands/slack-delivery';
import { listRenderFeedback, type RenderFeedbackRow } from '@/lib/renders/feedback';
import {
  inboxFilters,
  inboxHref,
  matchesInboxItem,
  teamNoticeFilters,
  teamNoticeHref,
  type InboxFilters,
} from '@/lib/admin/inbox-filters';
import { TEAM_NOTICE_KINDS } from '@/lib/brands/team-notice-outbox';
import { loadTeamNoticeInbox, type TeamNoticeInboxItem } from '@/lib/brands/team-notice-inbox';
import { ADMIN_INQUIRIES_PATH } from '@/lib/campaigns/links';
import { AdminShell, BUTTON, BUTTON_PRIMARY, INPUT, OpForm, OutcomeBanner, Panel } from '@/components/admin/chrome';
import { AdminPageHeader, StatusPill } from '@/components/admin/patterns';
import { formatCount } from '@/lib/admin/format';
import { IntakeBriefSummary } from '@/components/brand-workspace/intake-brief-summary';
import { IntakeBriefSchema, type IntakeBrief } from '@/lib/brands/workspace/intake-brief';

interface WorkspaceBriefInboxRow {
  id: string;
  organizationId: string;
  organizationName: string;
  title: string;
  createdAt: string;
  brief: IntakeBrief;
}

async function loadRequestedWorkspaceBriefs(
  sql: Awaited<ReturnType<typeof getSqlRunner>>,
): Promise<WorkspaceBriefInboxRow[]> {
  if (!sql || typeof sql.query !== 'function') return [];
  try {
    const { rows } = await sql.query<{
      id: string;
      organization_id: string;
      organization_name: string;
      title: string;
      created_at: string;
      intake_brief: unknown;
    }>(
      `select p.id, p.organization_id, o.name as organization_name, p.title, p.created_at, p.intake_brief
         from public.brand_projects p
         join public.brand_organizations o on o.id = p.organization_id
        where p.status = 'requested'
          and p.intake_brief is not null
        order by p.created_at desc
        limit 50`,
    );
    const out: WorkspaceBriefInboxRow[] = [];
    for (const row of rows) {
      const parsed = IntakeBriefSchema.safeParse(row.intake_brief);
      if (!parsed.success) continue;
      out.push({
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        title: row.title,
        createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
        brief: parsed.data,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * `/admin/inquiries` — the brand inbox (founder, 2026-09-11: "의뢰나 캠페인이 구분이 안 되어서").
 *
 * An enquiry is not a campaign. It is a conversation the studio owes a reply to, and it lives on
 * its own board so the campaigns board can be about campaigns and their lifecycle. Three groups:
 * new (reply owed), contacted (conversation open), closed (kept for the record, latest 30).
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function AdminInquiriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // The layout's check is not enough on its own: a client navigation request can ask for this page
  // segment alone, and then the layout does not run. Every admin page verifies the admin itself.
  await requireAdmin();
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const b = dict.campaigns.brands;
  const t = a.inbox;
  const sCopy = dict.adminConsole.supportInbox;
  const filters = inboxFilters(params);
  const teamFilters = teamNoticeFilters(params);
  const back = `${teamNoticeHref(filters, teamFilters)}#inbox-results`;
  const teamBack = `${teamNoticeHref(filters, teamFilters)}#team-notices`;

  const open: BrandInquiry[] = sql === null ? [] : await listBrandInquiries(sql, { statuses: ['new', 'contacted'], limit: 200 });
  const closed: BrandInquiry[] = sql === null ? [] : await listBrandInquiries(sql, { statuses: ['closed'], limit: 30 });
  const deliveryStates = sql === null ? new Map<string, BrandInquiryDeliveryStatus>() : await loadBrandInquiryDeliveryStates(sql, [...open, ...closed].map(q => q.id));

  // Result feedback (2026-09-11): the other kind of mail the studio owes an answer to.
  const feedback: RenderFeedbackRow[] = sql === null ? [] : await listRenderFeedback(sql, { statuses: ['new', 'replied'], limit: 200 });
  const workspaceBriefs = await loadRequestedWorkspaceBriefs(sql);
  const teamInbox = await loadTeamNoticeInbox(sql, {
    noticeKind: teamFilters.noticeKind,
    deliveryStatus: teamFilters.deliveryStatus,
    awaitingOnly: teamFilters.awaiting,
    query: filters.query,
    page: teamFilters.page,
    pageSize: 50,
  });
  const brandRows = [...open, ...closed];
  const brandMatches = (q: BrandInquiry, selection = filters) => matchesInboxItem('brand', q.status, [q.company, q.contactName, q.email, q.phone, q.message, q.templateSlug].filter(Boolean).join(' '), selection);
  const feedbackMatches = (f: RenderFeedbackRow, selection = filters) => matchesInboxItem('feedback', f.status, [f.email, f.templateSlug, f.message, f.renderId, f.userId, dict.renders.feedback.reasons[f.reason]].filter(Boolean).join(' '), selection);
  const count = (selection: InboxFilters) =>
    (selection.kind === 'team' ? teamInbox.totalFiltered : 0) +
    brandRows.filter(q => brandMatches(q, selection)).length +
    feedback.filter(f => feedbackMatches(f, selection)).length;
  const fresh = open.filter(q => q.status === 'new' && brandMatches(q));
  const contacted = open.filter(q => q.status === 'contacted' && brandMatches(q));
  const closedMatches = closed.filter(q => brandMatches(q));
  const feedbackNew = feedback.filter(f => f.status === 'new' && feedbackMatches(f));
  const feedbackReplied = feedback.filter(f => f.status === 'replied' && feedbackMatches(f));
  const shown = count(filters);
  const forKind = (kind: InboxFilters['kind']) => inboxFilters({ kind, status: filters.status, q: filters.query });
  const statusOptions: InboxFilters['status'][] = filters.kind === 'feedback' ? ['new', 'ongoing', 'all'] : ['new', 'ongoing', 'all', 'closed'];
  const kindLabels = { all: t.allKinds, brand: t.brand, feedback: t.feedback, team: sCopy.heading };
  const statusLabels = { all: t.allStatuses, new: t.new, ongoing: filters.kind === 'brand' ? a.inquiryStatuses.contacted : filters.kind === 'feedback' ? a.feedbackStatuses.replied : `${a.inquiryStatuses.contacted} · ${a.feedbackStatuses.replied}`, closed: a.inquiryStatuses.closed };
  const reasonLabel = dict.renders.feedback.reasons;

  const statusTone = (st: TeamNoticeInboxItem['status']) =>
    st === 'sent' ? 'done' : st === 'failed' ? 'fail' : st === 'skipped' ? 'hold' : 'progress';

  const runtimeLabel =
    teamInbox.runtimeConfig.status === 'configured'
      ? teamInbox.runtimeConfig.transport === 'bot'
        ? sCopy.runtimeBot
        : sCopy.runtimeWebhook
      : interpolate(sCopy.runtimeSkipped, { reason: teamInbox.runtimeConfig.code });

  const TeamNoticeRow = ({ item }: { item: TeamNoticeInboxItem }) => (
    <li id={`notice-${item.sourceId}`} data-team-notice={item.kind} data-delivery-status={item.status} className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-detail">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="hold">{sCopy.kinds[item.kind]}</StatusPill>
            <StatusPill tone={statusTone(item.status)}>
              {sCopy.deliveryStatuses[item.status]}
              {item.attempts > 0 ? ` · ${interpolate(sCopy.attemptsLabel, { count: item.attempts })}` : ''}
            </StatusPill>
            <span data-reply-sync-mode={item.replySyncMode}>
              <StatusPill tone={item.replySyncMode === 'bot_sync' ? 'done' : 'hold'}>
                {item.replySyncMode === 'bot_sync' ? sCopy.syncBot : sCopy.syncAdminOnly}
              </StatusPill>
            </span>
            {item.awaitingReply && <StatusPill tone="action">{sCopy.awaitingBadge}</StatusPill>}
          </div>
          <p className="mt-2 font-mono text-code">
            {item.organizationId ? (
              <a href={`/admin/brand-workspace/organizations/${item.organizationId}`} className="text-accent underline">
                <strong>{item.organizationName ?? shortId(item.organizationId)}</strong>
              </a>
            ) : (
              <strong>
                {sCopy.consumerLabel} · #{item.actorUserId ? shortId(item.actorUserId) : shortId(item.sourceId)}
              </strong>
            )}
            {' · '}
            <span>{item.actorName ?? (item.kind === 'share_guest_note' ? sCopy.guestLabel : sCopy.unknownMember)}</span>
            {item.surface ? ` · ${item.surface}` : ''}
            {' · '}
            {formatDate(item.createdAt, locale)}
          </p>
          {item.preview && <p className="mt-2 text-[0.85rem] leading-relaxed whitespace-pre-line opacity-80">{item.preview}</p>}
          {item.lastErrorCode && (
            <p className="mt-1 font-mono text-[0.72rem] opacity-65">
              code: {item.lastErrorCode}
            </p>
          )}
          {item.latestStaffReply && (
            <p className="mt-2 border-l-2 border-hairline pl-3 text-[0.8rem] opacity-80">
              <strong>{sCopy.latestReplyLabel}</strong>
              {item.latestStaffReplyAt ? ` (${formatDate(item.latestStaffReplyAt, locale)})` : ''}: {item.latestStaffReply}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.organizationId && (
            <a href={`/admin/brand-workspace/organizations/${item.organizationId}`} className={BUTTON}>
              {sCopy.openOrg}
            </a>
          )}
          <a href={item.adminPath} className={BUTTON}>
            {sCopy.openDetail}
          </a>
          {(item.status === 'failed' || item.status === 'skipped') && (
            <OpForm op="support.delivery.retry" back={teamBack}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                {sCopy.retryOne}
              </button>
            </OpForm>
          )}
        </div>
      </div>
      {(item.kind === 'support_message' || item.kind === 'concierge_escalation') &&
        (item.kind === 'support_message' ? Boolean(item.organizationId) : Boolean(item.actorUserId)) && (
        <OpForm op="support.reply" back={teamBack} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="targetType" value={item.kind === 'support_message' ? 'brand' : 'consumer'} />
          {item.organizationId && <input type="hidden" name="organizationId" value={item.organizationId} />}
          {item.actorUserId && <input type="hidden" name="userId" value={item.actorUserId} />}
          <input type="hidden" name="deliveryId" value={item.id} />
          <input
            type="text"
            name="body"
            required
            maxLength={4000}
            placeholder={sCopy.replyPlaceholder}
            aria-label={sCopy.replyPlaceholder}
            className={`${INPUT} max-w-md`}
          />
          <button type="submit" className={BUTTON_PRIMARY}>
            {sCopy.replySubmit}
          </button>
        </OpForm>
      )}
    </li>
  );

  const budgetLabel: Record<BrandInquiry['budgetBand'], string> = {
    under_3m: b.budgetUnder3m,
    '3m_10m': b.budget3mTo10m,
    '10m_30m': b.budget10mTo30m,
    over_30m: b.budgetOver30m,
    undecided: b.budgetUndecided,
  };
  const formatLabel = (slug: string | null) => (slug === 'new' ? b.templateNew : slug === null || slug === 'undecided' ? b.templateUndecided : slug);

  const Row = ({ q }: { q: BrandInquiry }) => (
    <li id={`inquiry-${q.id}`} data-brand-inquiry={q.status} className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 max-w-detail">
        <p className="font-mono text-code">
          <strong>{q.company}</strong> · {q.contactName} ·{' '}
          <a href={`mailto:${q.email}`} className="text-accent">
            {q.email}
          </a>
          {q.phone ? ` · ${q.phone}` : ''}
        </p>
        <p className="mt-1 font-mono text-[0.72rem] opacity-55">
          {b.inquiryTypeLabel} {b.inquiryTypeOptions[q.inquiryType]} · {b.useCaseLabel} {b.useCaseOptions[q.useCase]}
        </p>
        <p className="mt-1 font-mono text-[0.72rem] opacity-55">
          {a.inquiryBudget} {budgetLabel[q.budgetBand]} · {a.inquiryTemplate} {formatLabel(q.templateSlug)} · {a.inquiryTiming} {q.timing ?? '—'} ·{' '}
          {formatDate(q.createdAt, locale)}
          {q.locale === 'en' ? ' · EN' : ''}
        </p>
        <p className="mt-2 text-[0.85rem] leading-relaxed whitespace-pre-line opacity-80">{q.message}</p>
        <p data-inquiry-slack={deliveryStates.get(q.id) ?? 'untracked'} className="mt-2 font-mono text-[0.72rem] opacity-55">
          {b.slackDeliveryLabel} · {b.slackDeliveryStatuses[deliveryStates.get(q.id) ?? 'untracked']}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {q.status === 'new' && (
          <OpForm op="brandInquiry.status" back={back}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="status" value="contacted" />
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.inquiryMarkContacted}
            </button>
          </OpForm>
        )}
        {q.status !== 'closed' && (
          <OpForm op="brandInquiry.status" back={back}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="status" value="closed" />
            <button type="submit" className={BUTTON}>
              {a.inquiryMarkClosed}
            </button>
          </OpForm>
        )}
      </div>
    </li>
  );

  const FeedbackRow = ({ f }: { f: RenderFeedbackRow }) => (
    <li id={`feedback-${f.id}`} data-render-feedback={f.status} className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 max-w-detail">
        <p className="font-mono text-code">
          <strong>{reasonLabel[f.reason]}</strong> · {f.templateSlug} · {a.templateMedia[f.medium as keyof typeof a.templateMedia] ?? a.unknownValue} · {a.renderStatuses[f.renderStatus as keyof typeof a.renderStatuses] ?? a.unknownValue}
        </p>
        <p className="mt-1 font-mono text-[0.72rem] opacity-55">
          {f.email ? (
            <a href={`mailto:${f.email}`} className="text-accent">
              {f.email}
            </a>
          ) : (
            <a href={`/admin/users?q=${shortId(f.userId)}`} className="text-accent underline" title={f.userId}>
              {interpolate(a.feedbackUser, { id: shortId(f.userId) })}
            </a>
          )}
          {' · '}
          <a href={`/admin/renders/${f.renderId}`} className="text-accent underline" title={f.renderId}>
            {a.feedbackRender} {shortId(f.renderId)}
          </a>
          {' · '}
          {formatDate(f.updatedAt, locale)}
        </p>
        {f.message && <p className="mt-2 text-[0.85rem] leading-relaxed whitespace-pre-line opacity-80">{f.message}</p>}
      </div>
      <div className="flex items-center gap-2">
        {f.status === 'new' && (
          <OpForm op="renderFeedback.status" back={back}>
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="status" value="replied" />
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.feedbackMarkReplied}
            </button>
          </OpForm>
        )}
        <OpForm op="renderFeedback.status" back={back}>
          <input type="hidden" name="id" value={f.id} />
          <input type="hidden" name="status" value="closed" />
          <button type="submit" className={BUTTON}>
            {a.feedbackMarkClosed}
          </button>
        </OpForm>
      </div>
    </li>
  );

  return (
    <AdminShell dict={a} locale={locale} active="inquiries">
      <AdminPageHeader
        eyebrow={a.navInquiries}
        title={a.inquiriesHeading}
        count={formatCount(shown, locale)}
        countLabel={interpolate(t.resultCount, { count: shown })}
        lede={a.inquiriesLede}
      />

      <section className="admin-inbox-filters" aria-label={a.navInquiries} data-inbox-filters>
        <nav className="admin-filter-links" aria-label={t.kindLabel}>
          {(['all', 'team', 'brand', 'feedback'] as const).map(kind => (
            <a key={kind} href={inboxHref(forKind(kind))} aria-current={filters.kind === kind ? 'page' : undefined}>
              {kindLabels[kind]}
              <span>{kind === 'team' ? teamInbox.rows.length : count(forKind(kind))}</span>
            </a>
          ))}
        </nav>
        {filters.kind !== 'team' && (
          <nav className="admin-filter-links" aria-label={t.statusLabel}>
            {statusOptions.map(value => {
              return <a key={value} href={inboxHref(filters, { status: value })} aria-current={filters.status === value ? 'page' : undefined}>{statusLabels[value]}<span>{count({ ...filters, status: value })}</span></a>;
            })}
          </nav>
        )}
        <form method="get" action={ADMIN_INQUIRIES_PATH} className="admin-inbox-search">
          <input type="hidden" name="kind" value={filters.kind} />
          <input type="hidden" name="status" value={filters.status} />
          {teamFilters.noticeKind !== 'all' && <input type="hidden" name="noticeKind" value={teamFilters.noticeKind} />}
          {teamFilters.deliveryStatus !== 'all' && <input type="hidden" name="deliveryStatus" value={teamFilters.deliveryStatus} />}
          {teamFilters.awaiting && <input type="hidden" name="awaiting" value="1" />}
          <label>{t.searchLabel}<input type="search" name="q" defaultValue={filters.query} maxLength={200} placeholder={t.searchPlaceholder} /></label>
          <button type="submit" className={BUTTON_PRIMARY}>{t.search}</button>
          <a href={ADMIN_INQUIRIES_PATH} className="text-sm underline underline-offset-4">{t.reset}</a>
        </form>
        <p className="text-xs leading-relaxed opacity-60">{t.windowNote}</p>
      </section>
      <div id="inbox-results" data-inbox-results={shown}>
        <OutcomeBanner
          dict={a}
          {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
          {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
          {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
        />
        <p role="status" className="mt-6 text-sm">{interpolate(t.resultCount, { count: shown })}</p>
        {shown === 0 && workspaceBriefs.length === 0 && !teamInbox.available && <p className="mt-5 border border-hairline p-6 text-sm">{t.noResults}</p>}
        {shown === 0 && (workspaceBriefs.length > 0 || teamInbox.available) && filters.kind !== 'team' && <p className="mt-5 border border-hairline p-6 text-sm">{t.noResults}</p>}
        {(filters.kind === 'all' || filters.kind === 'team') && teamInbox.available && (
          <Panel
            id="team-notices"
            title={`${sCopy.heading} (${teamInbox.rows.length})`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                {teamInbox.failedCount > 0 && (
                  <OpForm op="support.delivery.retry" back={teamBack}>
                    <input type="hidden" name="scope" value="all_failed" />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      {sCopy.retryAllFailed}
                    </button>
                  </OpForm>
                )}
                <OpForm op="support.slack.connectionTest" back={teamBack} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" name="force" value="true" />
                    <span>{sCopy.forceNonProd}</span>
                  </label>
                  <button type="submit" className={BUTTON}>
                    {sCopy.testConnection}
                  </button>
                </OpForm>
              </div>
            }
          >
            <div data-admin-team-notices className="space-y-4">
              {teamInbox.runtimeConfig.status === 'skipped' && (
                <div
                  data-support-sender-banner={teamInbox.runtimeConfig.code}
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-2 border border-hairline px-3 py-2 text-xs"
                >
                  <span>
                    {interpolate(sCopy.senderPausedBanner, { reason: teamInbox.runtimeConfig.code })}
                  </span>
                  <span className="font-mono">
                    {interpolate(sCopy.pendingWaitingSummary, { count: teamInbox.pendingWaitingCount })}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <StatusPill tone={teamInbox.runtimeConfig.status === 'configured' ? 'done' : 'hold'}>
                  {runtimeLabel}
                </StatusPill>
                <span className="font-mono">
                  {interpolate(sCopy.failedSummary, { count: teamInbox.failedCount })}
                </span>
                <span className="font-mono">
                  {interpolate(sCopy.awaitingSummary, { count: teamInbox.awaitingCount })}
                </span>
              </div>
              <p className="text-xs opacity-70">{sCopy.lede}</p>
              <nav className="admin-filter-links" aria-label={sCopy.kindFilterLabel}>
                <a
                  href={teamNoticeHref(filters, teamFilters, { noticeKind: 'all' })}
                  aria-current={teamFilters.noticeKind === 'all' ? 'page' : undefined}
                >
                  {sCopy.allEvents}
                </a>
                {TEAM_NOTICE_KINDS.map((nk) => (
                  <a
                    key={nk}
                    href={teamNoticeHref(filters, teamFilters, { noticeKind: nk })}
                    aria-current={teamFilters.noticeKind === nk ? 'page' : undefined}
                  >
                    {sCopy.kinds[nk]}
                  </a>
                ))}
              </nav>
              <nav className="admin-filter-links" aria-label={sCopy.statusFilterLabel}>
                {(['all', 'sent', 'pending', 'failed', 'skipped'] as const).map((st) => (
                  <a
                    key={st}
                    href={teamNoticeHref(filters, teamFilters, { deliveryStatus: st })}
                    aria-current={teamFilters.deliveryStatus === st ? 'page' : undefined}
                  >
                    {st === 'all' ? sCopy.allDeliveryStatuses : sCopy.deliveryStatuses[st]}
                  </a>
                ))}
                <a
                  href={teamNoticeHref(filters, teamFilters, { awaiting: !teamFilters.awaiting })}
                  aria-current={teamFilters.awaiting ? 'page' : undefined}
                >
                  {sCopy.awaitingOnlyLabel}
                </a>
              </nav>
              {teamInbox.rows.length === 0 ? (
                <p className="border border-hairline p-4 text-sm opacity-75">{sCopy.empty}</p>
              ) : (
                <ul data-team-notice-list className="flex flex-col divide-y divide-hairline">
                  {teamInbox.rows.map((item) => (
                    <TeamNoticeRow key={item.id} item={item} />
                  ))}
                </ul>
              )}
              {teamInbox.totalPages > 1 && (
                <nav
                  data-team-notice-pagination
                  aria-label="Team notices pagination"
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-xs"
                >
                  <span className="font-mono opacity-80">
                    {interpolate(sCopy.paginationSummary, {
                      page: teamInbox.page,
                      totalPages: teamInbox.totalPages,
                      total: teamInbox.totalFiltered,
                    })}
                  </span>
                  <div className="flex items-center gap-2">
                    {teamInbox.page > 1 && (
                      <a
                        href={teamNoticeHref(filters, teamFilters, { page: teamInbox.page - 1 })}
                        className={BUTTON}
                      >
                        {sCopy.prevPage}
                      </a>
                    )}
                    {teamInbox.page < teamInbox.totalPages && (
                      <a
                        href={teamNoticeHref(filters, teamFilters, { page: teamInbox.page + 1 })}
                        className={BUTTON}
                      >
                        {sCopy.nextPage}
                      </a>
                    )}
                  </div>
                </nav>
              )}
            </div>
          </Panel>
        )}
        {filters.kind === 'team' && !teamInbox.available && (
          <p className="mt-5 border border-hairline p-6 text-sm">{sCopy.unavailable}</p>
        )}
        {filters.kind !== 'feedback' && filters.kind !== 'team' && workspaceBriefs.length > 0 && (
          <Panel
            title={
              locale === 'en'
                ? `Workspace Project Briefs (${workspaceBriefs.length})`
                : `워크스페이스 프로젝트 의뢰 접수 (${workspaceBriefs.length})`
            }
          >
            <ul data-admin-workspace-briefs className="flex flex-col divide-y divide-hairline">
              {workspaceBriefs.map((item) => (
                <li key={item.id} id={`workspace-brief-${item.id}`} className="flex flex-wrap items-start justify-between gap-4 py-4">
                  <div className="min-w-0 max-w-detail">
                    <p className="font-mono text-code">
                      <strong>{item.organizationName}</strong> · {item.title} · {formatDate(item.createdAt, locale)}
                    </p>
                    <div className="mt-2">
                      <IntakeBriefSummary brief={item.brief} locale={locale} copy={dict.intakeBrief} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={`/admin/brand-workspace/${item.id}`} className={BUTTON_PRIMARY}>
                      {locale === 'en' ? 'Open project' : '프로젝트 열기'}
                    </a>
                    <a href={`/admin/brand-rooms/${item.organizationId}?channel=project:${item.id}`} className={BUTTON}>
                      {locale === 'en' ? 'Open room' : '룸 열기'}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {fresh.length > 0 && <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.new} (${fresh.length})`}><ul data-brand-inquiries="new" className="flex flex-col divide-y divide-hairline">{fresh.map(q => <Row key={q.id} q={q} />)}</ul></Panel>}
        {feedbackNew.length > 0 && <Panel title={`${a.feedbackHeading} · ${a.feedbackStatuses.new} (${feedbackNew.length})`}><ul data-render-feedback-list="new" className="flex flex-col divide-y divide-hairline">{feedbackNew.map(f => <FeedbackRow key={f.id} f={f} />)}</ul></Panel>}
        {contacted.length > 0 && <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.contacted} (${contacted.length})`}><ul data-brand-inquiries="contacted" className="flex flex-col divide-y divide-hairline">{contacted.map(q => <Row key={q.id} q={q} />)}</ul></Panel>}
        {feedbackReplied.length > 0 && <Panel title={`${a.feedbackHeading} · ${a.feedbackStatuses.replied} (${feedbackReplied.length})`}><ul data-render-feedback-list="replied" className="flex flex-col divide-y divide-hairline">{feedbackReplied.map(f => <FeedbackRow key={f.id} f={f} />)}</ul></Panel>}
        {closedMatches.length > 0 && <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.closed} (${closedMatches.length})`}><ul data-brand-inquiries="closed" className="flex flex-col divide-y divide-hairline">{closedMatches.map(q => <Row key={q.id} q={q} />)}</ul></Panel>}
      </div>
    </AdminShell>
  );
}
