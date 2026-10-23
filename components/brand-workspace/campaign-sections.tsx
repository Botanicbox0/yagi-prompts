import type { BrandCopy } from "./action-form";
import type { CampaignTimeline } from "@/lib/brands/workspace/timeline";
import type { ProjectApplicant, ProjectApplicantCampaign, CollaborationCampaign } from "@/lib/campaigns/collaboration/service";
import { ApplicantPreference } from "./applicant-preference";
import { PLATFORM_NAMES } from "./campaign-terms-summary";
import { InvitationForm, CollaborationForm } from "@/components/campaigns/collaboration-forms";
import { FundingAction, FundingStatus, RewardProposalForm } from "@/components/campaigns/funding-actions";
import { formatBrandTimestamp } from "./format";
import { formatKrw, interpolate, localize } from "@/lib/i18n/format";

/** docs/PLATFORM-2.0.md §16.4 — brief → review → recruiting → selection → making → report → payouts. */
export function CampaignTimelineView({ timeline, b }: { timeline: CampaignTimeline; b: BrandCopy }) {
  const t = b.timeline;
  return (
    <div className="bw-timeline" data-campaign-timeline={timeline.current}>
      <h2>{t.title}</h2>
      <ol aria-label={t.title}>
        {timeline.stages.map((s) => (
          <li key={s.key} data-stage={s.key} data-stage-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="bw-timeline-dot" aria-hidden="true" />
            <strong>{t.stages[s.key]}</strong>
            <span className="bw-muted">{t.states[s.state]}</span>
          </li>
        ))}
      </ol>
      {timeline.current === "done" && <p className="bw-note">{t.done}</p>}
      {timeline.current === "cancelled" && <p className="bw-note">{t.cancelled}</p>}
    </div>
  );
}

function Applicant({ a, b, locale, canPrefer, projectId }: { a: ProjectApplicant; b: BrandCopy; locale: string; canPrefer: boolean; projectId: string }) {
  const t = b.applicants;
  const name = a.handle ? `@${a.handle}` : a.platform ? PLATFORM_NAMES[a.platform] : t.profile;
  const waiting = a.status === "applied";
  return (
    <li className="bw-applicant" data-applicant={a.status} data-applicant-preferred={a.preferred || undefined}>
      <div className="bw-row">
        <div>
          <strong>{name}</strong>
          <p className="bw-muted">
            {a.platform && a.handle && <>{PLATFORM_NAMES[a.platform]} · </>}
            {interpolate(t.followers, { count: a.followers.toLocaleString(locale) })} <span data-followers-source={a.followersSource}>({t.sources[a.followersSource]})</span>
          </p>
        </div>
        <span className="bw-status" data-state={a.status}>{t.states[a.status as keyof typeof t.states] ?? a.status}</span>
      </div>
      {a.profileUrl && <a href={a.profileUrl} target="_blank" rel="noopener noreferrer" className="bw-prose" title={b.external}>{t.profile} ↗</a>}
      {waiting && (
        <>
          <p className="bw-muted">{t.message}</p>
          <p className="bw-prose">{a.pitch}</p>
          {a.preferred && <span className="bw-badge" data-preferred>{t.preferred}</span>}
          {canPrefer && <ApplicantPreference applicationId={a.id} preferred={a.preferred} labels={{ prefer: t.prefer, unprefer: t.unprefer, failed: b.error, working: b.working }} />}
        </>
      )}
      {!waiting && (
        <dl className="bw-meta">
          <div><dt>{t.post}</dt><dd>{a.postUrl ? <a href={a.postUrl} target="_blank" rel="noopener noreferrer" title={b.external}>{t.post} ↗</a> : b.tax.unspecified}</dd></div>
          <div><dt>{b.views}</dt><dd>{a.views === null ? t.notMeasured : <>{interpolate(t.views, { count: a.views.toLocaleString(locale) })}{a.metricsSource && <> · <span data-metrics-source={a.metricsSource}>{t.metricSources[a.metricsSource]}</span></>}</>}</dd></div>
          <div><dt>{t.open}</dt><dd><a className="bw-button" href={`/brand/projects/${projectId}/participants/${a.id}`}>{t.open} →</a></dd></div>
        </dl>
      )}
    </li>
  );
}

/**
 * Applicants and participants, one campaign at a time. `applied` applications are listed with what
 * the creator told us; the brand may mark a preference, never select (selection is TWINGS's).
 * `view === null` means the collaboration rollout is closed: the tab explains when it opens.
 */
export function CampaignApplicants({ view, invitations, canInvite, b, locale, projectId }: {
  view: { canPrefer: boolean; campaigns: ProjectApplicantCampaign[] } | null;
  invitations: CollaborationCampaign[];
  canInvite: boolean;
  b: BrandCopy;
  locale: string;
  projectId: string;
}) {
  const t = b.applicants;
  return (
    <section id="applicants" className="bw-panel" data-brand-applicants={view ? "open" : "closed"}>
      <h2>{t.title}</h2>
      {!view ? (
        <p className="bw-note" data-applicants-closed>{t.closed}</p>
      ) : (
        <>
          <p className="bw-muted">{t.intro}</p>
          {!view.campaigns.length && <p className="bw-note">{t.noCampaign}</p>}
          {view.campaigns.map((c) => {
            const waiting = c.applicants.filter((a) => a.status === "applied");
            const joined = c.applicants.filter((a) => a.status !== "applied");
            const links = invitations.find((i) => i.id === c.id)?.invitations ?? [];
            return (
              <article key={c.id} className="bw-applicant-campaign" data-applicant-campaign={c.slug}>
                <h3>{localize(c.title, locale)}</h3>
                {!c.applicants.length && <p className="bw-muted">{t.none}</p>}
                {waiting.length > 0 && (
                  <>
                    <h4>{t.waiting} · {waiting.length}</h4>
                    {view.canPrefer && <p className="bw-muted">{t.preferHint}</p>}
                    <ul className="bw-applicant-list" data-applicants-waiting>{waiting.map((a) => <Applicant key={a.id} a={a} b={b} locale={locale} canPrefer={view.canPrefer} projectId={projectId} />)}</ul>
                  </>
                )}
                {joined.length > 0 && (
                  <>
                    <h4>{t.participating} · {joined.length} / {c.slots}</h4>
                    <ul className="bw-applicant-list" data-applicants-joined>{joined.map((a) => <Applicant key={a.id} a={a} b={b} locale={locale} canPrefer={false} projectId={projectId} />)}</ul>
                  </>
                )}
                <div className="bw-collab" data-applicant-invitations>
                  <h4>{t.invitations}</h4>
                  {canInvite && <InvitationForm locale={locale} campaignId={c.id} />}
                  <ul className="bw-list">
                    {links.map((i) => (
                      <li key={i.id}>
                        <p>{t.invitationStates[i.status]} · <time dateTime={i.expiresAt}>{formatBrandTimestamp(i.expiresAt, locale)}</time></p>
                        {i.status === "pending" && canInvite && (
                          <CollaborationForm locale={locale} operation="invitation.revoke" hidden={{ invitationId: i.id }} label={t.revoke}>{null}</CollaborationForm>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}

type FundingView = NonNullable<Awaited<ReturnType<typeof import("@/lib/campaigns/funding/service").loadFundingProject>>>;
const SETTLED = ["confirming", "awaiting_deposit", "paid", "review", "refund_pending", "refunded"];

/**
 * Quote → accept → pay → receipt, in one tab (the former /funding page, rearranged). A receipt is
 * only a receipt: it opens, produces and pays nothing. `rollout === false`: the tab says when it opens.
 */
export function CampaignPayments({ view, rollout, enabled, failed, b, locale, projectId, now = new Date() }: {
  view: FundingView | null;
  /** CAMPAIGN_FUNDING_PUBLIC is on. */
  rollout: boolean;
  /** Policy, gateway and environment all allow acceptance and payment (`open(deps)`). */
  enabled: boolean;
  failed: boolean;
  b: BrandCopy;
  locale: string;
  projectId: string;
  now?: Date;
}) {
  const t = b.payments;
  if (!rollout || !view)
    return (
      <section id="payments" className="bw-panel" data-campaign-funding="closed">
        <h2>{t.title}</h2>
        <p className="bw-note" data-payments-closed>{t.closed}</p>
      </section>
    );
  return (
    <section id="payments" className="bw-panel" data-campaign-funding="open">
      <h2>{t.title}</h2>
      <p className="bw-muted">{t.intro}</p>
      <ol className="bw-payment-steps" aria-label={t.title}>
        {(["quote", "accept", "pay", "receipt"] as const).map((s) => <li key={s}>{t.steps[s]}</li>)}
      </ol>
      {!view.ready ? (
        <p className="bw-note" role="status">{t.unavailable}</p>
      ) : (
        <>
          {!enabled && <p className="bw-note" role="status">{t.paymentsClosed}</p>}
          {failed && <p className="bw-error" role="alert">{t.failed}</p>}
          {!view.campaigns.length && <p className="bw-muted">{t.noCampaign}</p>}
          {!view.items.length && <p className="bw-note">{t.empty}</p>}
          <p className="bw-muted">{t.buyer}</p>
          {view.items.map((item) => {
            const q = item.quote, expired = q && new Date(q.validUntil) <= now;
            return (
              <article key={item.id} className="bw-message" data-funding-case={item.status}>
                <div className="bw-row">
                  <h3>{interpolate(t.quote, { revision: q?.revision ?? "—" })}</h3>
                  <span className="bw-status" data-state={item.status}>{fundingState(b, item.status)}</span>
                </div>
                {q && (
                  <dl className="bw-meta">
                    <div><dt>{t.total}</dt><dd className="bw-amount">{formatKrw(q.totalKrw, locale)}</dd></div>
                    <div><dt>{t.tax}</dt><dd className="bw-prose">{q.taxBasis}</dd></div>
                    <div><dt>{t.terms}</dt><dd className="bw-prose">{q.termsSummary}</dd></div>
                    <div><dt>{t.termsRef}</dt><dd className="bw-prose">{q.termsRef}</dd></div>
                    <div><dt>{t.valid}</dt><dd>{formatBrandTimestamp(q.validUntil, locale)}</dd></div>
                  </dl>
                )}
                {expired && <p className="bw-note">{t.expired}</p>}
                {enabled && view.canBuy && q && !expired && item.status === "quoted" && q.status === "proposed" && (
                  <FundingAction locale={locale} operation="quote.accept" input={{ quoteId: q.id, revision: q.revision }} label={t.accept} consent />
                )}
                {enabled && view.canBuy && item.status === "accepted" && q && !expired && !item.payments.some((p) => SETTLED.includes(p.status)) && (
                  <FundingAction locale={locale} operation="order.create" input={{ caseId: item.id }} label={t.pay} />
                )}
                <h4>{t.receipt}</h4>
                {!item.payments.length && <p className="bw-muted">{t.noReceipt}</p>}
                <ul className="bw-list">
                  {item.payments.map((p) => (
                    <li key={p.id} className="bw-row">
                      <div>
                        <p>{fundingState(b, p.status)} · {formatKrw(p.amountKrw, locale)}</p>
                        <p className="bw-muted">{t.environments[p.environment === "live" ? "live" : p.environment === "fake" ? "fake" : "test"]}</p>
                      </div>
                      {view.canBuy && p.status === "pending" && enabled && <a className="bw-button" href={`/brand/projects/${projectId}/funding/${p.id}`}>{t.pay}</a>}
                      {view.canBuy && ["confirming", "awaiting_deposit", "refund_pending"].includes(p.status) && (
                        <FundingStatus locale={locale} projectId={projectId} orderId={p.id} status={p.status} />
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
          <section className="bw-payment-reward" data-campaign-reward-proposals>
            <h3>{t.reward.title}</h3>
            <p className="bw-muted">{t.reward.hint}</p>
            <p className="bw-muted">{t.reward.writer}</p>
            {view.canPropose && view.campaigns.length > 0 && <div className="bw-collab"><RewardProposalForm locale={locale} projectId={projectId} campaigns={view.campaigns} /></div>}
            {!view.proposals.length && <p className="bw-muted">{t.reward.empty}</p>}
            <ul className="bw-list">
              {view.proposals.map((p) => (
                <li key={p.id}>
                  <p><strong>{formatKrw(p.amount_krw, locale)}</strong> · {t.reward.states[p.state as keyof typeof t.reward.states] ?? p.state}</p>
                  <p className="bw-prose">{p.conditions}</p>
                  {p.review_note && <p className="bw-prose">{t.reward.note}: {p.review_note}</p>}
                </li>
              ))}
            </ul>
          </section>
          <a className="bw-button" href={`/brand/projects/${projectId}#payments`}>{t.refresh}</a>
        </>
      )}
    </section>
  );
}

/** Funding case and payment states, read from the funding copy the checkout itself uses. */
function fundingState(b: BrandCopy, status: string): string {
  return (b.paymentStates as Record<string, string>)[status] ?? status;
}
