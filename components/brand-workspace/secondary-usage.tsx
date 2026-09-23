import type { BrandUsageCase, BrandUsageView, BrandUsageQuote } from "@/lib/brands/usage/types";
import { interpolate, formatKrw } from "@/lib/i18n/format";
import { ActionForm, type BrandCopy } from "./action-form";
import { formatBrandDate, formatBrandTimestamp } from "./format";
import { UsageSubjectPreselect } from "./secondary-usage-preselect";
import { usageSubjects, type UsageProject, type UsageSubjectDisplay, type UsageSubjects } from "./usage-subjects";

/**
 * The campaign's "2차 활용" tab (docs/SECONDARY-USAGE.md). Renders only the brand projection
 * (`BrandUsageView`): the final quote, never a creator amount, consent detail or internal reason.
 * Actions come from the server's `actions` flags; the server re-checks every one of them.
 */
type Copy = BrandCopy["secondaryUsage"];

/** A grant's instant as the Korea calendar day it falls on; the exclusive end shows the last licensed day. */
function koreaDay(iso: string, minusDay = false): string {
  const t = new Date(+new Date(iso) + 9 * 3600000 - (minusDay ? 86400000 : 0));
  return t.toISOString().slice(0, 10);
}
/** The case's own name for the item first, then the server label, then the localized platform post. */
function itemLabel(itemId: string, s: { label: string | null; platform: string | null }, names: Map<string, string>, subjects: UsageSubjects): string {
  return names.get(itemId) ?? s.label ?? subjects.generic(s.platform);
}

/** A small picture beside the name. Decorative: the name next to it says what it is. */
function SubjectThumb({ d }: { d: UsageSubjectDisplay }) {
  return (
    <span className="bw-post-thumb bw-usage-thumb" aria-hidden="true">
      {d.thumb?.video ? <video src={`${d.thumb.src}#t=0.1`} muted playsInline preload="metadata" />
        : d.thumb ? <img src={d.thumb.src} alt="" loading="lazy" />
        : <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 2.5-2 5 3.5" /></svg>}
    </span>
  );
}

function QuoteCard({ quote, c, b, locale, names, subjects }: { quote: BrandUsageQuote; c: Copy; b: BrandCopy; locale: string; names: Map<string, string>; subjects: UsageSubjects }) {
  const q = c.quote;
  return (
    <div className="bw-usage-quote" data-usage-quote={quote.status} data-quote-expired={quote.expired ? "true" : undefined}>
      <div className="bw-row">
        <div>
          <p className="bw-kicker">{interpolate(q.revision, { number: quote.revision })}</p>
          <h4>{q.title}</h4>
        </div>
        <div className="bw-usage-total">
          <small>{q.total}</small>
          <strong data-usage-total>{formatKrw(quote.totalKrw, locale)}</strong>
          <small>{quote.taxBasis === "included" ? q.taxIncluded : q.taxExcluded}</small>
        </div>
      </div>
      <p className="bw-muted">{q.validUntil}: {formatBrandTimestamp(quote.validUntil, locale)} · {q.validHint}</p>
      <h5>{q.scope}</h5>
      {quote.scope.items.map((item) => (
        <dl className="bw-meta bw-usage-scope" key={item.itemId}>
          <div><dt>{q.subject}</dt><dd>{itemLabel(item.itemId, { label: item.subjectLabel, platform: item.subjectPlatform }, names, subjects)} · {c.subjectKinds[item.subjectKind]}</dd></div>
          <div><dt>{q.usageKinds}</dt><dd>{item.usageKinds.map((k) => c.usageKinds[k]).join(", ")}</dd></div>
          <div><dt>{q.channels}</dt><dd className="bw-prose">{item.channels.join(", ")}</dd></div>
          <div><dt>{q.territory}</dt><dd>{item.territory.join(", ")}</dd></div>
          {item.advertiser && <div><dt>{q.advertiser}</dt><dd className="bw-prose">{item.advertiser}</dd></div>}
          <div><dt>{q.edits}</dt><dd>{c.edits[item.edits]}</dd></div>
          <div><dt>{q.period}</dt><dd>{item.timing.kind === "fixed"
            ? interpolate(q.fixed, { start: formatBrandDate(item.timing.startsOn, locale)!, end: formatBrandDate(item.timing.endsOn, locale)! })
            : interpolate(q.firstUse, { days: item.timing.durationDays })}</dd></div>
          {item.usageKinds.includes("partnership_ads") && <p className="bw-muted">{c.license.adsNote}</p>}
        </dl>
      ))}
      <p className="bw-muted">{q.timeZone}</p>
      <h5>{q.exclusions}</h5>
      <ul className="bw-list">{quote.scope.exclusions.map((x) => <li key={x}>{c.exclusions[x as keyof Copy["exclusions"]] ?? x}</li>)}</ul>
      {quote.scope.excludedNote && <><h5>{q.excluded}</h5><p className="bw-prose">{quote.scope.excludedNote}</p></>}
      {quote.note && <><h5>{q.note}</h5><p className="bw-prose">{quote.note}</p></>}
      {quote.contract && (
        <p data-usage-contract>
          <a className="bw-button" href={quote.contract.url} target="_blank" rel="noopener noreferrer">{q.contract}: {quote.contract.title} v{quote.contract.version} ↗</a>
          <span className="bw-muted"> {q.contractHint}</span>
        </p>
      )}
    </div>
  );
}

function UsageCase({ item: c, view, b, locale, projectId, subjects }: { item: BrandUsageCase; view: BrandUsageView; b: BrandCopy; locale: string; projectId: string; subjects: UsageSubjects }) {
  const u = b.secondaryUsage;
  const named = c.subjects.map((s) => subjects.caseSubject(s)), names = subjects.itemNames(c);
  const fixed = { caseId: c.id, expectedRevision: c.revision };
  const deciding = c.state === "quoted" || c.state === "awaiting_payment";
  // Why the quote cannot be accepted or paid online right now, most specific first. Checkout needs a
  // final tax-inclusive total and the shared contract; the server refuses otherwise.
  const blocker = !deciding || !c.quote ? null
    : c.quote.taxBasis !== "included" ? "tax"
    : c.quote.contract === null ? "contract" : null;
  const buyerNote = deciding && !blocker && !c.actions.accept && !c.actions.pay && view.role !== "studio";
  return (
    <article className="bw-message bw-usage-case" data-usage-case={c.id} data-usage-state={c.state}>
      <header className="bw-row">
        <div>
          <h3>{named.map((d) => d.title).join(", ")}</h3>
          <p className="bw-muted">{formatBrandTimestamp(c.createdAt, locale)}{c.subjects.some((s) => s.origin === "external_import") && <> · {u.linkedPost}</>}</p>
          {named.some((d) => d.href) && (
            <p className="bw-usage-links">
              {named.map((d, i) => d.href && (
                <a key={c.subjects[i]!.itemId} href={d.href} target="_blank" rel="noopener noreferrer" aria-label={`${b.performance.openPost}: ${d.title}`}>
                  {named.length > 1 ? d.title : b.performance.openPost} ↗
                </a>
              ))}
            </p>
          )}
        </div>
        <span className="bw-status" data-state={c.state}>{u.states[c.state]}</span>
      </header>
      <p>{u.stateHints[c.state]}</p>
      {c.availability && <p className="bw-note" data-usage-availability={c.availability}>{u.availability[c.availability]}</p>}
      <details>
        <summary>{u.askedAbout}</summary>
        <dl className="bw-meta">
          <div><dt>{u.intentLabel}</dt><dd>{u.intents[c.intent]}</dd></div>
          {c.question && <div><dt>{u.questionLabel}</dt><dd className="bw-prose">{c.question}</dd></div>}
          <div><dt>{u.hintsLabel}</dt><dd>{c.hints ? c.hints.map((h) => u.hints[h]).join(", ") : u.hintsNone}</dd></div>
          {c.durationHint && <div><dt>{u.durationLabel}</dt><dd>{u.durations[c.durationHint]}</dd></div>}
          {c.timingText && <div><dt>{u.timingLabel}</dt><dd className="bw-prose">{c.timingText}</dd></div>}
          {c.budgetKrw !== null && <div><dt>{u.budgetLabel}</dt><dd>{formatKrw(c.budgetKrw, locale)}</dd></div>}
        </dl>
      </details>
      {c.quote && <QuoteCard quote={c.quote} c={u} b={b} locale={locale} names={names} subjects={subjects} />}
      {blocker && <p className="bw-note" data-usage-not-payable={blocker}>{blocker === "tax" ? u.quote.taxExcludedNote : u.quote.contractUnavailable}</p>}
      {buyerNote && <p className="bw-note" data-usage-buyer-only>{view.paymentsOpen ? u.quote.buyerOnly : u.quote.paymentsClosed}</p>}
      {c.actions.accept && c.quote && (
        <ActionForm operation="usage.accept" fixed={{ ...fixed, quoteId: c.quote.id }} b={b} submit={u.quote.accept} successNotice={u.stateHints.awaiting_payment}>
          <label className="bw-check"><input type="checkbox" name="confirmed" required />{u.quote.acceptConfirm}</label>
        </ActionForm>
      )}
      {c.actions.pay && (
        <p><a className="bw-button bw-primary" data-usage-pay href={`/brand/projects/${projectId}/usage/${c.id}/pay`}>{u.payment.open} →</a></p>
      )}
      {c.payment && <p className="bw-muted" data-usage-payment={c.payment.status}>{u.payment.status[c.payment.status]} · {formatKrw(c.payment.amountKrw, locale)}</p>}
      {c.grants.length > 0 && (
        <div data-usage-grants>
          <h4>{u.license.title}</h4>
          <ul className="bw-list">
            {c.grants.map((g) => (
              <li key={g.id} data-usage-grant={g.state}>
                <strong>{itemLabel(g.itemId, { label: g.subjectLabel, platform: g.subjectPlatform }, names, subjects)}</strong> · <span className="bw-status" data-state={g.state}>{u.license.states[g.state]}</span>
                <p className="bw-muted">{g.startsAt && g.endsAt
                  ? interpolate(u.license.period, { start: formatBrandDate(koreaDay(g.startsAt), locale)!, end: formatBrandDate(koreaDay(g.endsAt, true), locale)! })
                  : interpolate(u.license.pendingStart, { days: g.durationDays ?? 0 })}</p>
                {g.state === "suspended" && <p className="bw-note">{u.license.suspendedBody}</p>}
              </li>
            ))}
          </ul>
          <p className="bw-muted">{u.license.extend}</p>
        </div>
      )}
      {c.actions.requestChanges && (
        <details>
          <summary>{u.quote.requestChanges}</summary>
          <ActionForm operation="usage.requestChanges" fixed={fixed} b={b} submit={u.quote.requestChanges}>
            <label>{u.quote.changesLabel}<textarea name="body" required maxLength={4000} /></label>
            <p className="bw-muted">{u.quote.changesHint}</p>
          </ActionForm>
        </details>
      )}
      <section className="bw-usage-thread" aria-label={u.thread}>
        <h4>{u.thread}</h4>
        {!c.messages.length && <p className="bw-muted">{u.noMessages}</p>}
        {c.messages.map((m) => (
          <div className="bw-message" key={m.id} data-author={m.authorRole}>
            <header><strong>{m.authorRole === "studio" ? b.studioAuthor : b.brandAuthor}</strong> <time dateTime={m.createdAt}>{formatBrandTimestamp(m.createdAt, locale)}</time></header>
            <p className="bw-prose">{m.body}</p>
          </div>
        ))}
        {c.actions.message && (
          <ActionForm operation="usage.message" fixed={{ caseId: c.id }} b={b} submit={u.send}>
            <label>{u.messageLabel}<textarea name="body" required maxLength={4000} /></label>
          </ActionForm>
        )}
      </section>
      {c.actions.withdraw && (
        <ActionForm operation="usage.withdraw" fixed={fixed} b={b} tone="danger" submit={c.state === "quoted" ? u.quote.decline : u.withdraw}
          confirm={{ prompt: c.state === "quoted" ? u.quote.declineConfirm : u.withdrawConfirm, action: c.state === "quoted" ? u.quote.decline : u.withdraw }} />
      )}
    </article>
  );
}

/** `project`: the campaign already on the page, used only to name subjects recognizably (title, thumbnail, link). */
export function SecondaryUsage({ view, projectId, b, locale, project = null }: { view: BrandUsageView; projectId: string; b: BrandCopy; locale: string; project?: UsageProject | null }) {
  const u = b.secondaryUsage;
  const subjects = usageSubjects(b, project);
  const writable = view.role === "owner" || view.role === "editor";
  return (
    <section id="usage" className="bw-panel" data-usage-tab data-usage-role={view.role}>
      <h2>{u.title}</h2>
      <p className="bw-muted">{u.intro}</p>
      {writable && view.eligible.length > 0 && (
        <details className="bw-usage-inquiry" data-usage-inquiry open={view.cases.length === 0 ? true : undefined}>
          <summary>{u.cta}</summary>
          <ActionForm operation="usage.inquire" fixed={{ projectId }} b={b} submit={u.submit} successNotice={u.sent}>
            <fieldset className="bw-usage-subject-set">
              <legend>{u.subjectsLabel} <span className="bw-muted">({u.subjectsHint})</span></legend>
              <UsageSubjectPreselect selectedCount={u.selectedCount} />
              <ul className="bw-usage-subjects">
                {view.eligible.map((s) => {
                  const key = `${s.kind}:${s.id}`, d = subjects.eligible(s);
                  return (
                    <li key={key} className="bw-usage-subject">
                      <label>
                        <input type="checkbox" name="subject" value={key} data-usage-subject={key} />
                        <SubjectThumb d={d} />
                        <span><strong>{d.title}</strong>{d.detail && <small>{d.detail}</small>}</span>
                      </label>
                      {d.href && <a href={d.href} target="_blank" rel="noopener noreferrer" aria-label={`${b.performance.openPost}: ${d.title}`}>{b.performance.openPost} ↗</a>}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <fieldset className="bw-usage-choices">
              <legend>{u.intentLabel}</legend>
              {(["know_cost", "recommend_terms", "question"] as const).map((intent) => (
                <label className="bw-check" key={intent}><input type="radio" name="intent" value={intent} required defaultChecked={intent === "know_cost"} />{u.intents[intent]}</label>
              ))}
            </fieldset>
            <label>{u.questionLabel} <span className="bw-muted">({u.optional})</span><textarea name="question" maxLength={2000} rows={3} /></label>
            <details className="bw-usage-optional" data-usage-optional>
            <summary>{u.plansSummary}</summary>
            <fieldset className="bw-usage-choices">
              <legend>{u.hintsLabel} <span className="bw-muted">({u.optional})</span></legend>
              {(["organic_repost", "paid_ads", "owned_media", "creator_partnership_ads", "offline", "undecided"] as const).map((hint) => (
                <label className="bw-check" key={hint}><input type="checkbox" name="hints" value={hint} />{u.hints[hint]}</label>
              ))}
            </fieldset>
            <label>{u.durationLabel} <span className="bw-muted">({u.optional})</span>
              <select name="durationHint" defaultValue="">
                <option value="">{u.durationNone}</option>
                {(["1m", "3m", "6m", "12m", "custom", "undecided"] as const).map((d) => <option key={d} value={d}>{u.durations[d]}</option>)}
              </select>
            </label>
            <label>{u.timingLabel} <span className="bw-muted">({u.optional})</span><input name="timingText" maxLength={500} /></label>
            <label>{u.budgetLabel} <span className="bw-muted">({u.optional})</span><input name="budgetKrw" type="number" min={0} step={1} inputMode="numeric" /><span className="bw-muted">{u.budgetHint}</span></label>
            </details>
            <p className="bw-note">{u.notice}</p>
          </ActionForm>
        </details>
      )}
      {view.role === "viewer" && <p className="bw-note" data-usage-viewer>{u.viewerBlock}</p>}
      {view.cases.length === 0 ? <p className="bw-muted">{u.empty}</p>
        : view.cases.map((c) => <UsageCase key={c.id} item={c} view={view} b={b} locale={locale} projectId={projectId} subjects={subjects} />)}
    </section>
  );
}
