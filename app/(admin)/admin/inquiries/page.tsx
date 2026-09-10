import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';
import { listBrandInquiries, type BrandInquiry } from '@/lib/brands/repo';
import { listRenderFeedback, type RenderFeedbackRow } from '@/lib/renders/feedback';
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

  const open: BrandInquiry[] = sql === null ? [] : await listBrandInquiries(sql, { statuses: ['new', 'contacted'], limit: 200 });
  const closed: BrandInquiry[] = sql === null ? [] : await listBrandInquiries(sql, { statuses: ['closed'], limit: 30 });
  const fresh = open.filter((q) => q.status === 'new');
  const contacted = open.filter((q) => q.status === 'contacted');
  // Result feedback (2026-09-11): the other kind of mail the studio owes an answer to.
  const feedback: RenderFeedbackRow[] = sql === null ? [] : await listRenderFeedback(sql, { statuses: ['new', 'replied'], limit: 200 });
  const feedbackNew = feedback.filter((f) => f.status === 'new');
  const feedbackReplied = feedback.filter((f) => f.status === 'replied');
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
    <li data-brand-inquiry={q.status} className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 max-w-detail">
        <p className="font-mono text-code">
          <strong>{q.company}</strong> · {q.contactName} ·{' '}
          <a href={`mailto:${q.email}`} className="text-accent">
            {q.email}
          </a>
          {q.phone ? ` · ${q.phone}` : ''}
        </p>
        <p className="mt-1 font-mono text-[0.72rem] opacity-55">
          {a.inquiryBudget} {budgetLabel[q.budgetBand]} · {a.inquiryTemplate} {formatLabel(q.templateSlug)} · {a.inquiryTiming} {q.timing ?? '—'} ·{' '}
          {formatDate(q.createdAt, locale)}
          {q.locale === 'en' ? ' · EN' : ''}
        </p>
        <p className="mt-2 text-[0.85rem] leading-relaxed whitespace-pre-line opacity-80">{q.message}</p>
      </div>
      <div className="flex items-center gap-2">
        {q.status === 'new' && (
          <OpForm op="brandInquiry.status" back={ADMIN_INQUIRIES_PATH}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="status" value="contacted" />
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.inquiryMarkContacted}
            </button>
          </OpForm>
        )}
        {q.status !== 'closed' && (
          <OpForm op="brandInquiry.status" back={ADMIN_INQUIRIES_PATH}>
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
    <li data-render-feedback={f.status} className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 max-w-detail">
        <p className="font-mono text-code">
          <strong>{reasonLabel[f.reason]}</strong> · {f.templateSlug} · {f.medium} · {f.renderStatus}
        </p>
        <p className="mt-1 font-mono text-[0.72rem] opacity-55">
          {f.email ? (
            <a href={`mailto:${f.email}`} className="text-accent">
              {f.email}
            </a>
          ) : (
            f.userId
          )}
          {' · '}
          {a.feedbackRender} {f.renderId}
          {' · '}
          {formatDate(f.updatedAt, locale)}
        </p>
        {f.message && <p className="mt-2 text-[0.85rem] leading-relaxed whitespace-pre-line opacity-80">{f.message}</p>}
      </div>
      <div className="flex items-center gap-2">
        {f.status === 'new' && (
          <OpForm op="renderFeedback.status" back={ADMIN_INQUIRIES_PATH}>
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="status" value="replied" />
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.feedbackMarkReplied}
            </button>
          </OpForm>
        )}
        <OpForm op="renderFeedback.status" back={ADMIN_INQUIRIES_PATH}>
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

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      {/* ---- result feedback: reply owed ------------------------------------------------ */}
      <Panel title={`${a.feedbackHeading} · ${a.feedbackStatuses.new} (${feedbackNew.length})`}>
        {feedbackNew.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.feedbackEmpty}</p>
        ) : (
          <ul data-render-feedback-list="new" className="flex flex-col divide-y divide-hairline">
            {feedbackNew.map((f) => (
              <FeedbackRow key={f.id} f={f} />
            ))}
          </ul>
        )}
      </Panel>
      {feedbackReplied.length > 0 && (
        <Panel title={`${a.feedbackHeading} · ${a.feedbackStatuses.replied} (${feedbackReplied.length})`}>
          <ul data-render-feedback-list="replied" className="flex flex-col divide-y divide-hairline">
            {feedbackReplied.map((f) => (
              <FeedbackRow key={f.id} f={f} />
            ))}
          </ul>
        </Panel>
      )}

      {/* ---- brand enquiries ------------------------------------------------------------ */}
      <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.new} (${fresh.length})`}>
        {fresh.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.inquiriesEmpty}</p>
        ) : (
          <ul data-brand-inquiries="new" className="flex flex-col divide-y divide-hairline">
            {fresh.map((q) => (
              <Row key={q.id} q={q} />
            ))}
          </ul>
        )}
      </Panel>

      {contacted.length > 0 && (
        <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.contacted} (${contacted.length})`}>
          <ul data-brand-inquiries="contacted" className="flex flex-col divide-y divide-hairline">
            {contacted.map((q) => (
              <Row key={q.id} q={q} />
            ))}
          </ul>
        </Panel>
      )}

      {closed.length > 0 && (
        <Panel title={`${a.inquiriesBrandsHeading} · ${a.inquiryStatuses.closed} (${closed.length})`}>
          <ul data-brand-inquiries="closed" className="flex flex-col divide-y divide-hairline opacity-60">
            {closed.map((q) => (
              <Row key={q.id} q={q} />
            ))}
          </ul>
        </Panel>
      )}
    </AdminShell>
  );
}
