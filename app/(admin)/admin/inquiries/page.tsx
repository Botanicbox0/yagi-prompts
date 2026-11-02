import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate, interpolate } from '@/lib/i18n/format';

/** Raw UUIDs are support lookups, not content: the first block is enough to find the row (P3). */
const shortId = (id: string): string => id.slice(0, 8);
import { listBrandInquiries, type BrandInquiry } from '@/lib/brands/repo';
import { loadBrandInquiryDeliveryStates, type BrandInquiryDeliveryStatus } from '@/lib/brands/slack-delivery';
import { listRenderFeedback, type RenderFeedbackRow } from '@/lib/renders/feedback';
import { inboxFilters, inboxHref, matchesInboxItem, type InboxFilters } from '@/lib/admin/inbox-filters';
import { ADMIN_INQUIRIES_PATH } from '@/lib/campaigns/links';
import { AdminShell, BUTTON, BUTTON_PRIMARY, OpForm, OutcomeBanner, Panel } from '@/components/admin/chrome';

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
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const b = dict.campaigns.brands;
  const t = a.inbox;
  const filters = inboxFilters(params);
  const back = `${inboxHref(filters)}#inbox-results`;

  const open: BrandInquiry[] = sql === null ? [] : await listBrandInquiries(sql, { statuses: ['new', 'contacted'], limit: 200 });
  const closed: BrandInquiry[] = sql === null ? [] : await listBrandInquiries(sql, { statuses: ['closed'], limit: 30 });
  const deliveryStates = sql === null ? new Map<string, BrandInquiryDeliveryStatus>() : await loadBrandInquiryDeliveryStates(sql, [...open, ...closed].map(q => q.id));

  // Result feedback (2026-09-11): the other kind of mail the studio owes an answer to.
  const feedback: RenderFeedbackRow[] = sql === null ? [] : await listRenderFeedback(sql, { statuses: ['new', 'replied'], limit: 200 });
  const brandRows = [...open, ...closed];
  const brandMatches = (q: BrandInquiry, selection = filters) => matchesInboxItem('brand', q.status, [q.company, q.contactName, q.email, q.phone, q.message, q.templateSlug].filter(Boolean).join(' '), selection);
  const feedbackMatches = (f: RenderFeedbackRow, selection = filters) => matchesInboxItem('feedback', f.status, [f.email, f.templateSlug, f.message, f.renderId, f.userId, dict.renders.feedback.reasons[f.reason]].filter(Boolean).join(' '), selection);
  const count = (selection: InboxFilters) => brandRows.filter(q => brandMatches(q, selection)).length + feedback.filter(f => feedbackMatches(f, selection)).length;
  const fresh = open.filter(q => q.status === 'new' && brandMatches(q));
  const contacted = open.filter(q => q.status === 'contacted' && brandMatches(q));
  const closedMatches = closed.filter(q => brandMatches(q));
  const feedbackNew = feedback.filter(f => f.status === 'new' && feedbackMatches(f));
  const feedbackReplied = feedback.filter(f => f.status === 'replied' && feedbackMatches(f));
  const shown = count(filters);
  const forKind = (kind: InboxFilters['kind']) => inboxFilters({ kind, status: filters.status, q: filters.query });
  const statusOptions: InboxFilters['status'][] = filters.kind === 'feedback' ? ['new', 'ongoing', 'all'] : ['new', 'ongoing', 'all', 'closed'];
  const kindLabels = { all: t.allKinds, brand: t.brand, feedback: t.feedback };
  const statusLabels = { all: t.allStatuses, new: t.new, ongoing: filters.kind === 'brand' ? a.inquiryStatuses.contacted : filters.kind === 'feedback' ? a.feedbackStatuses.replied : `${a.inquiryStatuses.contacted} · ${a.feedbackStatuses.replied}`, closed: a.inquiryStatuses.closed };
  const reasonLabel = dict.renders.feedback.reasons;

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
            <span title={f.userId}>{interpolate(a.feedbackUser, { id: shortId(f.userId) })}</span>
          )}
          {' · '}
          <span title={f.renderId}>{a.feedbackRender} {shortId(f.renderId)}</span>
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
      <p className="text-accent font-label text-eyebrow uppercase">{a.navInquiries}</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">{a.inquiriesHeading}</h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{a.inquiriesLede}</p>

      <section className="admin-inbox-filters" aria-label={a.navInquiries} data-inbox-filters>
        <nav className="admin-filter-links" aria-label={t.kindLabel}>
          {(['all', 'brand', 'feedback'] as const).map(kind => <a key={kind} href={inboxHref(forKind(kind))} aria-current={filters.kind === kind ? 'page' : undefined}>{kindLabels[kind]}<span>{count(forKind(kind))}</span></a>)}
        </nav>
        <nav className="admin-filter-links" aria-label={t.statusLabel}>
          {statusOptions.map(value => {
            return <a key={value} href={inboxHref(filters, { status: value })} aria-current={filters.status === value ? 'page' : undefined}>{statusLabels[value]}<span>{count({ ...filters, status: value })}</span></a>;
          })}
        </nav>
        <form method="get" action={ADMIN_INQUIRIES_PATH} className="admin-inbox-search">
          <input type="hidden" name="kind" value={filters.kind} />
          <input type="hidden" name="status" value={filters.status} />
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
        {shown === 0 && <p className="mt-5 border border-hairline p-6 text-sm">{t.noResults}</p>}
        {fresh.length > 0 && <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.new} (${fresh.length})`}><ul data-brand-inquiries="new" className="flex flex-col divide-y divide-hairline">{fresh.map(q => <Row key={q.id} q={q} />)}</ul></Panel>}
        {feedbackNew.length > 0 && <Panel title={`${a.feedbackHeading} · ${a.feedbackStatuses.new} (${feedbackNew.length})`}><ul data-render-feedback-list="new" className="flex flex-col divide-y divide-hairline">{feedbackNew.map(f => <FeedbackRow key={f.id} f={f} />)}</ul></Panel>}
        {contacted.length > 0 && <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.contacted} (${contacted.length})`}><ul data-brand-inquiries="contacted" className="flex flex-col divide-y divide-hairline">{contacted.map(q => <Row key={q.id} q={q} />)}</ul></Panel>}
        {feedbackReplied.length > 0 && <Panel title={`${a.feedbackHeading} · ${a.feedbackStatuses.replied} (${feedbackReplied.length})`}><ul data-render-feedback-list="replied" className="flex flex-col divide-y divide-hairline">{feedbackReplied.map(f => <FeedbackRow key={f.id} f={f} />)}</ul></Panel>}
        {closedMatches.length > 0 && <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.closed} (${closedMatches.length})`}><ul data-brand-inquiries="closed" className="flex flex-col divide-y divide-hairline">{closedMatches.map(q => <Row key={q.id} q={q} />)}</ul></Panel>}
      </div>
    </AdminShell>
  );
}
