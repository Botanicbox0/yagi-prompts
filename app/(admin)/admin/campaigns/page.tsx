import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import {
  loadAllCampaigns,
  loadCampaignCounts,
  loadPayoutQueue,
  type ApplicationRow,
  type CampaignCounts,
  type CampaignRow,
} from '@/lib/campaigns/repo';
import { CAMPAIGN_STATUSES, type CampaignStatus } from '@/lib/campaigns/schemas';
import { computePayout, formatWon, needsMetrics } from '@/lib/campaigns/state';
import { ADMIN_CAMPAIGNS_PATH, ADMIN_CAMPAIGN_NEW_PATH, adminCampaignPath, campaignHref } from '@/lib/campaigns/links';
import { listBrandInquiries, type BrandInquiry } from '@/lib/brands/repo';
import { AdminShell, BUTTON, BUTTON_PRIMARY, INPUT, OpForm, OutcomeBanner, Panel } from '@/components/admin/chrome';

/**
 * `/admin/campaigns` — the board (docs/CAMPAIGNS.md §6): one row per campaign with the numbers
 * that say where the work is (applied / selected of slots / posted / verified / paid), grouped by
 * lifecycle so what is live sits on top, plus the payout queue — every verified application whose
 * hold has ended — at the very top, because that is the one list with money waiting in it.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

const ZERO: CampaignCounts = { applied: 0, selected: 0, posted: 0, verified: 0, paid: 0, slotsTaken: 0 };

/** Live first, then drafts, then the closed and archived tail. */
const ORDER: CampaignStatus[] = ['running', 'selecting', 'recruiting', 'draft', 'closed', 'archived'];

export default async function AdminCampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const now = new Date();

  const rows: CampaignRow[] = sql === null ? [] : await loadAllCampaigns(sql);
  const counts = sql === null ? new Map<string, CampaignCounts>() : await loadCampaignCounts(sql, rows.map((row) => row.id));
  const payoutQueue: ApplicationRow[] = sql === null ? [] : await loadPayoutQueue(sql, now);
  const byId = new Map(rows.map((row) => [row.id, row]));
  // The brand inbox (2026-09-11): everything not yet closed, newest first.
  const inquiries: BrandInquiry[] = sql === null ? [] : await listBrandInquiries(sql, { statuses: ['new', 'contacted'], limit: 50 });
  const b = dict.campaigns.brands;
  const budgetLabel: Record<BrandInquiry['budgetBand'], string> = {
    under_3m: b.budgetUnder3m,
    '3m_10m': b.budget3mTo10m,
    '10m_30m': b.budget10mTo30m,
    over_30m: b.budgetOver30m,
    undecided: b.budgetUndecided,
  };
  const formatLabel = (slug: string | null) => (slug === 'new' ? b.templateNew : slug === null || slug === 'undecided' ? b.templateUndecided : slug);

  return (
    <AdminShell dict={a} locale={locale} active="campaigns">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-accent font-label text-eyebrow uppercase">{a.navCampaigns}</p>
          <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">{a.campaignsHeading}</h1>
          <p className="mt-3 max-w-detail text-body opacity-60">{a.campaignsLede}</p>
        </div>
        <a href={ADMIN_CAMPAIGN_NEW_PATH} data-new-campaign className={BUTTON_PRIMARY}>
          {a.newCampaign}
        </a>
      </div>

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      {/* Money waiting: holds that have ended. The pay button is here so settlement day is one screen. */}
      {payoutQueue.length > 0 && (
        <Panel title={`${a.payoutQueueHeading} (${payoutQueue.length})`}>
          <p className="mb-4 font-mono text-[0.75rem] opacity-55">{a.payoutQueueLede}</p>
          <ul data-payout-queue className="flex flex-col gap-3">
            {payoutQueue.map((app) => {
              const campaign = byId.get(app.campaignId);
              const rule = campaign?.payout ?? null;
              const missing = rule !== null && needsMetrics(rule) && app.viewsSnapshot === null;
              const amount = rule === null || missing ? null : computePayout(rule, { views: app.viewsSnapshot ?? 0 }).cents;
              return (
                <li key={app.id} className="flex flex-wrap items-center justify-between gap-3 border border-hairline px-4 py-3 font-mono text-[0.78rem]">
                  <span>
                    {campaign ? <a href={adminCampaignPath(campaign.id)} className="text-accent">{campaign.slug}</a> : app.campaignId}
                    {' · '}
                    <a href={app.snsUrl} target="_blank" rel="noopener noreferrer" className="opacity-70">
                      {app.snsUrl.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                    {' · '}
                    {app.viewsSnapshot === null ? a.viewsMissing : `${app.viewsSnapshot.toLocaleString(locale)} views`}
                    {' · '}
                    <strong>{amount === null ? a.viewsMissing : formatWon(amount, locale)}</strong>
                  </span>
                  <OpForm op="campaignApplication.pay" back={ADMIN_CAMPAIGNS_PATH} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={app.id} />
                    <input type="hidden" name="version" value={app.version} />
                    <input type="text" name="payoutRef" placeholder={a.fieldPayoutRef} className={`${INPUT} w-44`} />
                    <button type="submit" className={BUTTON_PRIMARY} disabled={missing}>
                      {a.payNow}
                    </button>
                  </OpForm>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {/* The brand inbox: who asked, for what, and whether anyone has written back yet. */}
      {inquiries.length > 0 && (
        <Panel title={`${a.inquiriesHeading} (${inquiries.length})`}>
          <p className="mb-4 font-mono text-[0.75rem] opacity-55">{a.inquiriesLede}</p>
          <ul id="inquiries" data-brand-inquiries className="flex flex-col divide-y divide-hairline">
            {inquiries.map((q) => (
              <li key={q.id} data-brand-inquiry={q.status} className="flex flex-wrap items-start justify-between gap-4 py-4">
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
                  </p>
                  <p className="mt-2 text-[0.85rem] leading-relaxed whitespace-pre-line opacity-80">{q.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-60">{a.inquiryStatuses[q.status]}</span>
                  {q.status === 'new' && (
                    <OpForm op="brandInquiry.status" back={ADMIN_CAMPAIGNS_PATH}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="status" value="contacted" />
                      <button type="submit" className={BUTTON_PRIMARY}>
                        {a.inquiryMarkContacted}
                      </button>
                    </OpForm>
                  )}
                  <OpForm op="brandInquiry.status" back={ADMIN_CAMPAIGNS_PATH}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="status" value="closed" />
                    <button type="submit" className={BUTTON}>
                      {a.inquiryMarkClosed}
                    </button>
                  </OpForm>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {rows.length === 0 ? (
        <Panel title={a.navCampaigns}>
          <p className="font-mono text-code opacity-60">{a.campaignListEmpty}</p>
        </Panel>
      ) : (
        ORDER.filter((status) => rows.some((row) => row.status === status)).map((status) => (
          <Panel key={status} title={`${a.campaignStatuses[status]} (${rows.filter((row) => row.status === status).length})`}>
            <ul className="flex flex-col divide-y divide-hairline">
              {rows
                .filter((row) => row.status === status)
                .map((row) => {
                  const c = counts.get(row.id) ?? ZERO;
                  return (
                    <li key={row.id} data-admin-campaign={row.slug} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <a href={adminCampaignPath(row.id)} className="font-mono text-code text-accent">
                          {row.slug}
                        </a>
                        <span className="ml-3 text-[0.85rem] opacity-70">{localize(row.title, locale).replace(/\s+/g, ' ')}</span>
                        <p className="mt-1 font-mono text-[0.72rem] opacity-55">
                          {row.hostName}
                          {row.applicationsCloseAt ? ` · ${interpolate(dict.campaigns.applyBy, { date: formatDate(row.applicationsCloseAt, locale) ?? '' })}` : ''}
                          {row.postDeadlineAt ? ` · ${interpolate(dict.campaigns.postBy, { date: formatDate(row.postDeadlineAt, locale) ?? '' })}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span data-campaign-counts className="font-mono text-[0.72rem] opacity-70">
                          {interpolate(a.campaignCounts, {
                            applied: String(c.applied),
                            selected: String(c.slotsTaken),
                            slots: String(row.slots),
                            posted: String(c.posted),
                            verified: String(c.verified),
                            paid: String(c.paid),
                          })}
                        </span>
                        {c.applied > 0 && <span className="text-accent font-label text-[0.62rem] tracking-[0.1em] uppercase">{interpolate(a.campaignPending, { count: String(c.applied) })}</span>}
                        {(row.status === 'recruiting' || row.status === 'selecting' || row.status === 'running') && (
                          <a href={campaignHref(locale, row.slug)} className={BUTTON}>
                            {a.open}
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </Panel>
        ))
      )}

      {/* Every lifecycle word, once, so a reviewer learns the vocabulary from the board itself. */}
      <p className="mt-8 font-mono text-[0.72rem] opacity-45">{CAMPAIGN_STATUSES.map((status) => a.campaignStatuses[status]).join(' → ')}</p>
    </AdminShell>
  );
}
