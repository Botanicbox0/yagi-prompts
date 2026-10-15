import { getViewer } from '@/lib/auth/viewer';
import { linkedParticipationIds } from '@/lib/campaigns/collaboration/service';
import { collaborationCopy } from '@/messages/campaign-collaboration';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { formatCampaignDateTime } from '@/lib/campaigns/dates';
import { signInHref } from '@/lib/billing/links';
import { loadMyCampaigns } from '@/lib/campaigns/service';
import { payoutSentence } from '@/lib/campaigns/copy';
import { MY_CAMPAIGNS_PATH, campaignHref, campaignsHref, campaignMakePath } from '@/lib/campaigns/links';
import { renderHref } from '@/lib/renders/share';
import { applicationStep, formatWon } from '@/lib/campaigns/state';
import { URL_MAX } from '@/lib/campaigns/schemas';
import { AppHeader } from '@/components/app/app-header';
import { campaignLabels } from '@/components/campaigns/labels';
import { TextSwap } from '@/components/ui/text-swap';
import { reportViewsAction, submitPostAction } from './actions';

/**
 * `/campaigns/mine` — every campaign the signed-in creator applied to, each with its five-step
 * bar, and the two forms a creator ever needs: the post link (when selected) and the seven-day
 * view count (when posted). The payout sentence here is the same one they applied under.
 */
export const dynamic = 'force-dynamic';

const INPUT = 'w-full border border-hairline bg-transparent px-3 py-2 font-mono text-code outline-none focus:border-accent';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function MyCampaignsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const [locale, viewer, query] = await Promise.all([getLocaleFromHeaders(), getViewer(), searchParams ?? Promise.resolve({} as SearchParams)]);
  const dict = getDictionary(locale);
  const c = dict.campaigns;
  const labels = campaignLabels(dict);
  const sql = await getSqlRunner();
  const mine = viewer.userId === null || sql === null ? [] : await loadMyCampaigns({ sql }, viewer.userId);
  const linked = sql ? await linkedParticipationIds(sql, mine.map(({ application }) => application.id)) : new Set<string>();
  const ok = one(query, 'ok');
  const err = one(query, 'err');
  const steps = [c.stepApplied, c.stepSelected, c.stepPosted, c.stepVerified, c.stepPaid];

  const notice = (() => {
    if (ok === 'posted') return c.postSaved;
    if (ok === 'views') return c.viewsSaved;
    switch (err) {
      case 'production_required':
        return c.production.errors.production_required;
      case 'sign_in_required':
        return c.errSignIn;
      case 'wrong_platform':
        return c.errWrongPlatform;
      case 'not_open':
        return c.errPostNotOpen;
      case 'not_selected':
      case 'not_posted':
      case 'not_found':
        return c.errNotFound;
      case 'invalid':
        return c.errInvalid;
      default:
        return null;
    }
  })();

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={MY_CAMPAIGNS_PATH} />

      <main id="main" className="band py-16 lg:py-20">
        <p className="text-accent font-label text-eyebrow uppercase">{c.eyebrow}</p>
        <h1 className="mt-4 font-display text-title font-black uppercase">{c.mineTitle}</h1>
        <p className="mt-6 max-w-detail text-body opacity-70">{c.mineLede}</p>

        {notice && (
          <p role="status" data-mine-notice={ok ?? err} className={`mt-6 max-w-detail border px-4 py-3 text-[0.95rem] ${err ? 'text-accent border-accent' : 'border-hairline'}`}>
            {notice}
          </p>
        )}

        {viewer.userId === null ? (
          <a href={signInHref(MY_CAMPAIGNS_PATH, locale)} className="mt-10 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
            <TextSwap>{dict.auth.signIn} →</TextSwap>
          </a>
        ) : mine.length === 0 ? (
          <div className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="text-body opacity-70">{c.mineEmpty}</p>
            <a href={campaignsHref(locale)} className="text-accent mt-6 inline-block font-label text-label uppercase">
              <TextSwap>{c.mineBrowse} →</TextSwap>
            </a>
          </div>
        ) : (
          <ul className="mt-10 flex flex-col gap-6">
            {mine.map(({ application, campaign, canPost, canReportViews, production }) => {
              const step = applicationStep(application.status);
              const title = localize(campaign.title, locale);
              return (
                <li key={application.id} id={application.id} data-my-campaign={campaign.slug} data-status={application.status} className="border border-hairline p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <a href={campaignHref(locale, campaign.slug)} className="font-display text-[1.3rem] leading-[1] font-black uppercase">
                        {title}
                      </a>
                      <p className="mt-2 font-mono text-[0.75rem] opacity-60">
                        {campaign.hostName} · {campaign.payout ? payoutSentence(campaign.payout, locale, labels.payout) : '—'}
                      </p>
                    </div>
                    <span data-app-status={application.status} className="border border-current px-2 py-1 font-label text-[0.7rem] tracking-[0.12em] uppercase">
                      {c.appStatus[application.status]}
                    </span>
                  </div>

                  {/* The five steps, the current one in the accent. */}
                  {linked.has(application.id) && <a className="mt-4 inline-block text-accent underline" href={`/campaigns/participations/${application.id}`}>{collaborationCopy(locale).open} →</a>}
                  <ol className="mt-6 grid grid-cols-5 gap-2 font-label text-[0.62rem] tracking-[0.1em] uppercase">
                    {steps.map((label, index) => (
                      <li key={label} className={`border-t-2 pt-2 ${index + 1 <= step ? 'border-accent text-accent' : 'border-hairline opacity-40'}`}>
                        {index + 1}. {label}
                      </li>
                    ))}
                  </ol>

                  {application.status === 'rejected' && application.rejectReason && (
                    <p className="text-accent mt-5 font-mono text-[0.78rem]">
                      {c.rejectedReason}: {application.rejectReason}
                    </p>
                  )}

                  {production && <div data-campaign-production className="mt-6 rounded-xl border border-hairline p-5">
                    <p className="text-sm opacity-70">{c.production.sponsored}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {production.canCreate && <a href={campaignMakePath(campaign.slug)} className="rounded-full bg-accent px-5 py-3 text-sm text-white">{c.production.create} →</a>}
                      {production.job && <a href={renderHref(production.job.id)} className="rounded-full border border-current px-5 py-3 text-sm">{c.production.result} · {c.production.states[production.job.status as keyof typeof c.production.states]} →</a>}
                    </div>
                    {!production.canCreate && !production.job && <p className="mt-3 text-sm opacity-60">{c.production.errors[production.blockedReason as keyof typeof c.production.errors] ?? c.production.unavailable}</p>}
                    {production.job?.status === 'failed' && !production.canCreate && <p className="mt-3 text-sm opacity-60">{c.production.retryPending}</p>}
                  </div>}
                  {canPost && (
                    <form action={submitPostAction} data-post-form className="mt-6 flex flex-col gap-3 border-t border-hairline pt-5">
                      <input type="hidden" name="id" value={application.id} />
                      <label className="block">
                        <span className="block font-label text-eyebrow uppercase opacity-60">{c.fieldPostUrl}</span>
                        <input type="url" name="postUrl" required maxLength={URL_MAX} defaultValue={application.postUrl ?? ''} placeholder="https://www.instagram.com/reel/…" className={`${INPUT} mt-2`} />
                        <span className="mt-1.5 block font-mono text-[0.72rem] opacity-45">
                          {interpolate(c.postHint, {
                            platforms: campaign.platforms.map((p) => labels.platform[p]).join(', '),
                            date: formatCampaignDateTime(campaign.postDeadlineAt, locale) ?? '',
                          })}
                        </span>
                      </label>
                      <div>
                        <button type="submit" className="inline-block bg-accent px-5 py-2.5 font-label text-label text-white uppercase">
                          <TextSwap>{application.status === 'rejected' ? c.postResubmit : c.postSubmit}</TextSwap>
                        </button>
                      </div>
                    </form>
                  )}

                  {(application.status === 'posted' || application.status === 'verified' || application.status === 'paid') && application.postUrl && (
                    <p className="mt-5 font-mono text-[0.78rem] break-all opacity-70">
                      <a href={application.postUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent">
                        {application.postUrl} ↗
                      </a>
                    </p>
                  )}

                  {application.status === 'verified' && application.holdUntil && (
                    <p data-hold-until className="mt-3 font-mono text-[0.78rem] opacity-70">
                      {interpolate(c.holdUntilLine, { date: formatDate(application.holdUntil, locale) ?? '' })}
                    </p>
                  )}

                  {canReportViews && (
                    <form action={reportViewsAction} data-views-form className="mt-5 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={application.id} />
                      <label className="block">
                        <span className="block font-label text-eyebrow uppercase opacity-60">{c.fieldViews}</span>
                        <input type="number" name="views" min={0} step={1} defaultValue={application.viewsSnapshot ?? ''} className={`${INPUT} mt-2 w-48`} />
                      </label>
                      <button type="submit" className="inline-block border border-current px-4 py-2.5 font-label text-eyebrow uppercase">
                        {c.viewsSubmit}
                      </button>
                      <span className="basis-full font-mono text-[0.72rem] opacity-45">{c.viewsHint}</span>
                    </form>
                  )}

                  {application.status === 'paid' && application.payoutCents !== null && (
                    <p data-paid-line className="mt-5 font-mono text-[0.85rem]">
                      {interpolate(c.paidLine, { amount: formatWon(application.payoutCents, locale), date: formatDate(application.paidAt, locale) ?? '' })}
                      {application.payoutRef ? ` · ${application.payoutRef}` : ''}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
