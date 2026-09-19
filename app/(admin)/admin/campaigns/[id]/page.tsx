import { PublicLink } from '@/components/admin/public-link';
import { notFound } from 'next/navigation';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary, type Dictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { loadApplicationsForCampaign, loadCampaignById, type ApplicationRow, type CampaignRow } from '@/lib/campaigns/repo';
import { CAMPAIGN_STATUSES, recruitBlockers } from '@/lib/campaigns/schemas';
import { canCampaignTransition, computePayout, formatWon, holdsSlot, needsMetrics, payoutReleasable } from '@/lib/campaigns/state';
import { ADMIN_CAMPAIGNS_PATH, adminCampaignPath, campaignHref } from '@/lib/campaigns/links';
import { loadPublishedPrompts } from '@/lib/prompts/repo';
import { AdminShell, BUTTON, BUTTON_PRIMARY, Field, INPUT, OpForm, OutcomeBanner, Panel } from '@/components/admin/chrome';
import { CampaignFields } from '@/components/admin/campaign-fields';

/**
 * `/admin/campaigns/[id]` — one campaign: its lifecycle buttons, the recruit gate stated before it
 * is pressed, the editor, and the application queue split by what the reviewer has to do next —
 * choose (applied), check (posted), settle (verified, hold ended) — with the rest folded as history.
 *
 * Every review form carries the row's version token (`ApplicationRow.version`): if the creator
 * moves the row between render and press, the guarded UPDATE matches nothing and the banner says
 * "stale" rather than blessing a post the reviewer never saw.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

type Dict = Dictionary;

/** `recruitBlockers` speaks English literals (the operation's refusal detail); the page speaks the dictionary. */
const BLOCKER_KEYS: Record<string, keyof Dict['admin']> = {
  'title (en + ko)': 'blockerTitle',
  'summary (en + ko)': 'blockerSummary',
  'brief (en + ko)': 'blockerBrief',
  'application deadline': 'blockerApplyDeadline',
  'post deadline': 'blockerPostDeadline',
  'a post deadline after the application deadline': 'blockerPostOrder',
  'payout rule': 'blockerPayout',
  slots: 'blockerSlots',
};

function Creator({ app, dict }: { app: ApplicationRow; dict: Dict }) {
  const a = dict.admin;
  return (
    <div className="min-w-0">
      <a href={app.snsUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-code text-accent break-all">
        {app.snsUrl.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
      <span className="ml-2 font-mono text-[0.72rem] opacity-55">
        {interpolate(a.colFollowers, { count: app.followerCount.toLocaleString('en') })}
      </span>
      <p className="mt-1.5 max-w-detail text-[0.85rem] opacity-75">{app.pitch}</p>
    </div>
  );
}

function Version({ app }: { app: ApplicationRow }) {
  return (
    <>
      <input type="hidden" name="id" value={app.id} />
      <input type="hidden" name="version" value={app.version} />
    </>
  );
}

function ApplicantRow({ app, back, dict, slotsLeft }: { app: ApplicationRow; back: string; dict: Dict; slotsLeft: number }) {
  const a = dict.admin;
  return (
    <li data-application={app.id} data-status={app.status} className="flex flex-wrap items-start justify-between gap-4 border border-hairline p-4">
      <Creator app={app} dict={dict} />
      <div className="flex items-center gap-2">
        <OpForm op="campaignApplication.select" back={back}>
          <Version app={app} />
          <button type="submit" className={BUTTON_PRIMARY} disabled={slotsLeft <= 0}>
            {a.selectApplicant}
          </button>
        </OpForm>
        <OpForm op="campaignApplication.decline" back={back}>
          <Version app={app} />
          <button type="submit" className={BUTTON}>
            {a.declineApplicant}
          </button>
        </OpForm>
      </div>
    </li>
  );
}

function PostRow({ app, campaign, back, dict, locale }: { app: ApplicationRow; campaign: CampaignRow; back: string; dict: Dict; locale: string }) {
  const a = dict.admin;
  const c = dict.campaigns;
  const rule = campaign.payout;
  const releasable = app.status === 'verified' && payoutReleasable(app, Date.now());
  const missing = rule !== null && needsMetrics(rule) && app.viewsSnapshot === null;
  const amount = rule === null || missing ? null : computePayout(rule, { views: app.viewsSnapshot ?? 0 }).cents;
  return (
    <li data-application={app.id} data-status={app.status} className="border border-hairline p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Creator app={app} dict={dict} />
        <span className="font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-55">
          {c.appStatus[app.status]} · {formatDate(app.postedAt, locale) ?? ''}
        </span>
      </div>

      {app.postUrl && (
        <p className="mt-3 font-mono text-[0.78rem] break-all">
          <a href={app.postUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent">
            {app.postUrl} ↗
          </a>
          {app.postPlatform ? <span className="ml-2 opacity-55">{app.postPlatform}</span> : null}
        </p>
      )}
      {/* The checklist the brief asked for, so the reviewer opens the post knowing what to look for. */}
      <p className="mt-2 font-mono text-[0.72rem] opacity-55">
        {[
          campaign.requirements.disclosure ? c.reqDisclosure : null,
          campaign.requirements.hashtags.length > 0 ? campaign.requirements.hashtags.map((tag) => `#${tag}`).join(' ') : null,
          campaign.requirements.mentions.length > 0 ? campaign.requirements.mentions.map((m) => `@${m}`).join(' ') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* The number: shown with its source, editable by the admin at any point after posting. */}
        <OpForm op="campaignApplication.metrics" back={back} className="flex items-end gap-2">
          <Version app={app} />
          <Field label={a.adminViews} hint={app.metricsSource ? a.viewsSource[app.metricsSource] : undefined}>
            <input type="number" name="views" min={0} step={1} defaultValue={app.viewsSnapshot ?? ''} className={`${INPUT} w-36`} />
          </Field>
          <button type="submit" className={BUTTON}>
            {a.saveViews}
          </button>
        </OpForm>

        {app.status === 'posted' && (
          <>
            <OpForm op="campaignApplication.verify" back={back} className="flex items-end">
              <Version app={app} />
              <button type="submit" className={BUTTON_PRIMARY}>
                {a.verifyPost}
              </button>
            </OpForm>
            <OpForm op="campaignApplication.reject" back={back} className="flex flex-col gap-2">
              <Version app={app} />
              <Field label={a.rejectReason} hint={a.postRejectHint}>
                <textarea name="reason" rows={2} required minLength={3} className={INPUT} />
              </Field>
              <div>
                <button type="submit" className={BUTTON}>
                  {a.rejectPost}
                </button>
              </div>
            </OpForm>
          </>
        )}

        {app.status === 'verified' && (
          <div className="lg:col-span-2">
            <p data-hold className="font-mono text-[0.78rem]">
              {interpolate(a.holdEnds, { date: formatDate(app.holdUntil, locale) ?? '' })}
              {' · '}
              <span className={releasable ? 'text-accent' : 'opacity-55'}>{releasable ? a.releasable : a.notReleasable}</span>
              {' · '}
              {amount === null ? a.viewsMissing : interpolate(a.amountPreview, { amount: formatWon(amount, locale) })}
            </p>
            <OpForm op="campaignApplication.pay" back={back} className="mt-3 flex items-end gap-2">
              <Version app={app} />
              <Field label={a.fieldPayoutRef} hint={a.payoutRefHint}>
                <input type="text" name="payoutRef" maxLength={120} className={`${INPUT} w-64`} />
              </Field>
              <button type="submit" className={BUTTON_PRIMARY} disabled={!releasable || missing}>
                {a.payNow}
              </button>
            </OpForm>
          </div>
        )}
      </div>
    </li>
  );
}

export default async function AdminCampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, locale, query, sql] = await Promise.all([params, getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const c = dict.campaigns;
  if (sql === null) notFound();
  const row = await loadCampaignById(sql, id);
  if (row === null) notFound();

  const [applications, prompts] = await Promise.all([loadApplicationsForCampaign(sql, row.id), loadPublishedPrompts(sql)]);
  const back = adminCampaignPath(row.id);
  const blockers = recruitBlockers(row);
  const slotsTaken = applications.filter((app) => holdsSlot(app.status)).length;
  const slotsLeft = Math.max(0, row.slots - slotsTaken);

  const applicants = applications.filter((app) => app.status === 'applied');
  const awaitingPost = applications.filter((app) => app.status === 'selected' || app.status === 'rejected');
  const posts = applications.filter((app) => app.status === 'posted');
  const holds = applications.filter((app) => app.status === 'verified');
  const history = applications.filter((app) => app.status === 'declined' || app.status === 'withdrawn' || app.status === 'paid' || app.status === 'expired');
  const moves = CAMPAIGN_STATUSES.filter((to) => canCampaignTransition(row.status, to));

  return (
    <AdminShell dict={a} locale={locale} active="campaigns">
      <a href={ADMIN_CAMPAIGNS_PATH} className="font-label text-eyebrow uppercase opacity-60">
        ← {a.backToCampaigns}
      </a>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">{localize(row.title, locale)}</h1>
          <p className="mt-2 font-mono text-[0.78rem] opacity-60">
            {row.slug} · {row.hostName} · <span data-campaign-status={row.status}>{a.campaignStatuses[row.status]}</span> ·{' '}
            {interpolate(c.slotsLine, { left: String(slotsLeft), slots: String(row.slots) })}
          </p>
        </div>
        {row.status !== 'draft' && row.status !== 'archived' && (
          <PublicLink href={campaignHref(locale, row.slug)} className={BUTTON}>
            {a.open}
          </PublicLink>
        )}
      </div>

      <OutcomeBanner
        dict={a}
        {...(one(query, 'ok') ? { ok: one(query, 'ok')! } : {})}
        {...(one(query, 'err') ? { err: one(query, 'err')! } : {})}
        {...(one(query, 'detail') ? { detail: one(query, 'detail')! } : {})}
      />

      {/* The lifecycle: only the moves the state machine allows from here, the recruit gate stated first. */}
      <Panel title={a.lifecycleHeading}>
        {/* The recruit gate, stated before it is pressed — and only while it still applies. */}
        {row.status === 'draft' && (
          <p data-recruit-readiness={blockers.length === 0 ? 'ready' : 'blocked'} className="mb-4 font-mono text-[0.75rem] opacity-60">
            {blockers.length === 0
              ? a.campaignReady
              : interpolate(a.campaignNotReady, { missing: blockers.map((b) => String(a[BLOCKER_KEYS[b] ?? 'blockerTitle'] ?? b)).join(', ') })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {/* Where it stands, then the verbs — each button says what happens, not which noun it lands on. */}
          <span data-lifecycle-current className="font-label text-[0.68rem] tracking-[0.12em] text-accent uppercase">
            {interpolate(a.lifecycleCurrent, { status: a.campaignStatuses[row.status] })}
          </span>
          {moves.map((to) => (
            <OpForm key={to} op="campaign.status" back={back}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="to" value={to} />
              <button type="submit" className={to === 'recruiting' ? BUTTON_PRIMARY : BUTTON} disabled={to === 'recruiting' && blockers.length > 0}>
                {a.moveToStatus[to]}
              </button>
            </OpForm>
          ))}
        </div>
        <p className="mt-3 font-mono text-[0.72rem] opacity-45">{a.lifecycleHint}</p>
      </Panel>

      {/* Work waiting, in the order it arrives. */}
      <Panel title={`${a.queueApplicants} (${applicants.length})`}>
        {applicants.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.campaignQueueEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {applicants.map((app) => (
              <ApplicantRow key={app.id} app={app} back={back} dict={dict} slotsLeft={slotsLeft} />
            ))}
          </ul>
        )}
      </Panel>

      {awaitingPost.length > 0 && (
        <Panel title={`${a.queueAwaitingPost} (${awaitingPost.length})`}>
          <ul className="flex flex-col gap-3">
            {awaitingPost.map((app) => (
              <li key={app.id} data-application={app.id} data-status={app.status} className="flex flex-wrap items-start justify-between gap-4 border border-hairline p-4">
                <Creator app={app} dict={dict} />
                <span className="font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-55">
                  {c.appStatus[app.status]}
                  {app.rejectReason ? ` · ${app.rejectReason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`${a.queuePosts} (${posts.length})`}>
        {posts.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.campaignQueueEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {posts.map((app) => (
              <PostRow key={app.id} app={app} campaign={row} back={back} dict={dict} locale={locale} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`${a.queueHold} (${holds.length})`}>
        {holds.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.campaignQueueEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {holds.map((app) => (
              <PostRow key={app.id} app={app} campaign={row} back={back} dict={dict} locale={locale} />
            ))}
          </ul>
        )}
      </Panel>

      {history.length > 0 && (
        <details className="mt-8 border border-hairline">
          <summary className="cursor-pointer px-4 py-2.5 font-label text-eyebrow uppercase">
            {a.queueHistory} ({history.length})
          </summary>
          <ul className="flex flex-col divide-y divide-hairline px-4 pb-2">
            {history.map((app) => (
              <li key={app.id} data-application={app.id} data-status={app.status} className="flex flex-wrap items-center justify-between gap-3 py-3 font-mono text-[0.78rem]">
                <a href={app.snsUrl} target="_blank" rel="noopener noreferrer" className="text-accent break-all">
                  {app.snsUrl.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
                <span className="opacity-60">
                  {c.appStatus[app.status]}
                  {app.status === 'paid' && app.payoutCents !== null ? ` · ${formatWon(app.payoutCents, locale)} · ${formatDate(app.paidAt, locale) ?? ''}${app.payoutRef ? ` · ${app.payoutRef}` : ''}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Panel title={a.editorHeading}>
        <OpForm op="campaign.update" back={back} className="flex flex-col gap-5">
          <input type="hidden" name="id" value={row.id} />
          <CampaignFields row={row} dict={dict} styleSlugs={prompts.map((prompt) => prompt.slug)} />
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.saveCampaign}
            </button>
          </div>
        </OpForm>
      </Panel>
    </AdminShell>
  );
}
