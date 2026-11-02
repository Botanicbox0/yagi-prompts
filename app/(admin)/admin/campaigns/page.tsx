import { PublicLink } from '@/components/admin/public-link';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { interpolate, localize } from '@/lib/i18n/format';
import { formatCampaignDateTime } from '@/lib/campaigns/dates';
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
import { AdminShell, BUTTON, BUTTON_PRIMARY, ConfirmCheck, INPUT, OpForm, OutcomeBanner, Panel } from '@/components/admin/chrome';

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
          <ul id="payout-queue" data-payout-queue className="flex flex-col gap-3">
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
                    {app.viewsSnapshot === null ? a.viewsMissing : interpolate(a.viewsCount, { count: app.viewsSnapshot.toLocaleString(locale) })}
                    {' · '}
                    <strong>{amount === null ? a.viewsMissing : formatWon(amount, locale)}</strong>
                  </span>
                  <OpForm op="campaignApplication.pay" back={ADMIN_CAMPAIGNS_PATH} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={app.id} />
                    <input type="hidden" name="version" value={app.version} />
                    <input type="text" name="payoutRef" placeholder={a.fieldPayoutRef} className={`${INPUT} w-44`} />
                    {!missing && <ConfirmCheck label={a.confirmPay} />}
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

      {/* Where everything stands, in one line — each count jumps to its group below. */}
      {rows.length > 0 && (
        <p data-campaign-status-strip className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.75rem]">
          <span className="opacity-50">{a.campaignsStatusStrip}</span>
          {ORDER.map((status) => {
            const n = rows.filter((row) => row.status === status).length;
            return (
              <a key={status} href={`#status-${status}`} className={n > 0 ? 'text-accent' : 'opacity-40'}>
                {a.campaignStatuses[status]} {n}
              </a>
            );
          })}
        </p>
      )}

      {rows.length === 0 ? (
        <Panel title={a.navCampaigns}>
          <p className="font-mono text-code opacity-60">{a.campaignListEmpty}</p>
        </Panel>
      ) : (
        ORDER.filter((status) => rows.some((row) => row.status === status)).map((status) => (
          <Panel key={status} title={`${a.campaignStatuses[status]} (${rows.filter((row) => row.status === status).length})`}>
            <ul id={`status-${status}`} data-campaign-group={status} className="flex flex-col divide-y divide-hairline">
              {rows
                .filter((row) => row.status === status)
                .map((row) => {
                  const c = counts.get(row.id) ?? ZERO;
                  return (
                    <li key={row.id} data-admin-campaign={row.slug} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <span data-campaign-status-chip={row.status} className={`mr-3 inline-block border px-2 py-0.5 font-label text-[0.62rem] tracking-[0.1em] uppercase ${status === 'draft' ? 'border-hairline opacity-60' : 'border-accent text-accent'}`}>
                          {a.campaignStatuses[row.status]}
                        </span>
                        <a href={adminCampaignPath(row.id)} className="font-mono text-code text-accent">
                          {row.slug}
                        </a>
                        <span className="ml-3 text-[0.85rem] opacity-70">{localize(row.title, locale).replace(/\s+/g, ' ')}</span>
                        <p className="mt-1 font-mono text-[0.72rem] opacity-55">
                          {row.hostName}
                          {row.applicationsCloseAt ? ` · ${interpolate(dict.campaigns.applyBy, { date: formatCampaignDateTime(row.applicationsCloseAt, locale) ?? '' })}` : ''}
                          {row.postDeadlineAt ? ` · ${interpolate(dict.campaigns.postBy, { date: formatCampaignDateTime(row.postDeadlineAt, locale) ?? '' })}` : ''}
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
                          <PublicLink href={campaignHref(locale, row.slug)} className={BUTTON}>
                            {a.open}
                          </PublicLink>
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
