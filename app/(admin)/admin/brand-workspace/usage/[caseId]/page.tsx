import "@/app/(brand)/workspace.css";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate, formatKrw } from "@/lib/i18n/format";
import { loadStudioUsageCase } from "@/lib/brands/usage/service";
import { USAGE_KINDS } from "@/lib/brands/usage/schemas";
import type { AdminOperationName } from "@/lib/admin/operations";
import { AdminShell, ConfirmCheck, OpForm, OutcomeBanner } from "@/components/admin/chrome";
import { formatBrandDate, formatBrandTimestamp } from "@/components/brand-workspace/format";

/**
 * One secondary-usage case in the studio console (docs/SECONDARY-USAGE.md). The only page that shows
 * creator compensation and consent evidence; every form posts to `/admin/do` (`brandUsage.*`).
 */
export const dynamic = "force-dynamic";
export default async function StudioUsageCase({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ caseId }, viewer, sql, locale, search] = await Promise.all([params, requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale), b = dict.brandWorkspace, u = b.secondaryUsage, a = u.admin;
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const c = await loadStudioUsageCase({ sql }, viewer, caseId);
  if (!c) notFound();
  const back = `/admin/brand-workspace/usage/${c.id}`;
  const Form = ({ op, submit, children, tone = "primary", confirm }: { op: AdminOperationName; submit: string; children?: ReactNode; tone?: "primary" | "danger" | "plain"; confirm?: string }) => (
    <OpForm op={op} back={back} className="bw-form">
      <input type="hidden" name="caseId" value={c.id} />
      <input type="hidden" name="requestId" value={randomUUID()} />
      <input type="hidden" name="expectedRevision" value={c.revision} />
      {children}
      {confirm && <ConfirmCheck label={confirm} />}
      <button className={`bw-button ${tone === "primary" ? "bw-primary" : tone === "danger" ? "bw-danger" : ""}`} type="submit">{submit}</button>
    </OpForm>
  );
  const scope = c.scopes[0] ?? null;
  const draft = scope?.scope.items[0];
  const liveCompensation = scope ? c.compensations.find((x) => x.scopeRevisionId === scope.id) ?? null : null;
  const openQuote = c.quotes.find((q) => q.status === "open" || q.status === "accepted") ?? null;
  const sharedContracts = c.contracts.filter((d) => d.shared);
  const itemLabel = (id: string) => c.items.find((i) => i.id === id)?.label ?? id;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner dict={dict.admin} ok={typeof search.ok === "string" ? search.ok : undefined} err={typeof search.err === "string" ? search.err : undefined} detail={typeof search.detail === "string" ? search.detail : undefined} />
      <div data-studio-usage-case={c.status}>
        <div className="bw-heading">
          <div>
            <a href="/admin/brand-workspace/usage">← {a.openQueue}</a>
            <p className="bw-kicker">{c.organizationName} · <a href={`/admin/brand-workspace/${c.projectId}`}>{c.projectTitle}</a></p>
            <h1>{a.queue}</h1>
          </div>
          <span className="bw-status" data-state={c.status}>{a.statuses[c.status]}</span>
        </div>
        <p className="bw-note" data-usage-private-boundary>{a.privateBoundary}</p>
        {c.status === "blocked_after_payment" && <p className="bw-error" role="alert">{interpolate(a.blocked, { reason: c.blockedReason ?? "" })}</p>}

        <section className="bw-panel">
          <h2>{a.request}</h2>
          <dl className="bw-meta">
            <div><dt>{a.intent}</dt><dd>{u.intents[c.intent as keyof typeof u.intents] ?? c.intent}</dd></div>
            {c.question && <div><dt>{u.questionLabel}</dt><dd className="bw-prose">{c.question}</dd></div>}
            <div><dt>{a.hints}</dt><dd>{c.hints ? c.hints.map((h) => u.hints[h as keyof typeof u.hints] ?? h).join(", ") : a.notGiven}</dd></div>
            <div><dt>{a.duration}</dt><dd>{c.durationHint ? u.durations[c.durationHint as keyof typeof u.durations] : a.notGiven}</dd></div>
            <div><dt>{a.timing}</dt><dd className="bw-prose">{c.timingText ?? a.notGiven}</dd></div>
            <div><dt>{a.budget}</dt><dd>{c.budgetKrw === null ? a.notGiven : formatKrw(c.budgetKrw, locale)}</dd></div>
          </dl>
          <h3>{a.items}</h3>
          <ul className="bw-list">{c.items.map((i) => <li key={i.id}>{i.position}. {i.label} {i.postOrigin === "external_import" && <span className="bw-status">{u.linkedPost}</span>} {i.postUrl && <a href={i.postUrl} target="_blank" rel="noopener noreferrer">↗</a>}</li>)}</ul>
          {c.status === "inquiry" && <Form op="brandUsage.triage" submit={a.triage} />}
        </section>

        <section className="bw-panel">
          <h2>{a.thread}</h2>
          {!c.messages.length && <p className="bw-muted">{u.noMessages}</p>}
          {c.messages.map((m) => <article className="bw-message" key={m.id} data-author={m.authorRole}><header><strong>{m.authorRole === "studio" ? b.studioAuthor : b.brandAuthor}</strong> <time>{formatBrandTimestamp(m.createdAt, locale)}</time></header><p className="bw-prose">{m.body}</p></article>)}
          <Form op="brandUsage.message" submit={u.send}><label>{a.reply}<textarea name="body" required maxLength={4000} /></label></Form>
        </section>

        {(c.status === "scoping" || c.status === "scope_defined") && (
          <section className="bw-panel" data-usage-scope-form>
            <h2>{a.scopeTitle}</h2>
            <p className="bw-muted">{a.scopeHint}</p>
            <Form op="brandUsage.scope" submit={a.saveScope}>
              {c.items.map((i) => (
                <fieldset key={i.id} className="bw-usage-choices">
                  <legend>{i.position}. {i.label}</legend>
                  <input type="hidden" name="itemId" value={i.id} />
                  <label className="bw-check"><input type="checkbox" name={`include:${i.id}`} defaultChecked />{a.include}</label>
                  <label>{a.pin}
                    <select name={`pin:${i.id}`} required defaultValue={i.kind === "content_version" || i.postContentVersionId ? "content_version" : "original_post"}>
                      {(i.kind === "content_version" || i.postContentVersionId) && <option value="content_version">{a.pinContent}</option>}
                      {i.kind === "post" && <option value="original_post">{a.pinPost}</option>}
                      {c.masters.map((m) => <option key={m.id} value={`master:${m.id}`}>{interpolate(a.pinMaster, { name: m.name })}</option>)}
                    </select>
                  </label>
                </fieldset>
              ))}
              <fieldset className="bw-usage-choices"><legend>{u.quote.usageKinds}</legend>
                {USAGE_KINDS.map((k) => <label className="bw-check" key={k}><input type="checkbox" name="usageKinds" value={k} defaultChecked={draft?.usageKinds.includes(k)} />{u.usageKinds[k]}</label>)}
              </fieldset>
              <label>{u.quote.channels}<textarea name="channels" required defaultValue={draft?.channels.join("\n")} /><span className="bw-muted">{a.channelsHint}</span></label>
              <label>{u.quote.territory}<input name="territory" required defaultValue={draft?.territory.join(", ")} /><span className="bw-muted">{a.territoryHint}</span></label>
              <label>{u.quote.advertiser} <span className="bw-muted">({u.optional})</span><input name="advertiser" maxLength={120} defaultValue={draft?.advertiser ?? ""} /></label>
              <label>{u.quote.edits}<select name="edits" defaultValue={draft?.edits ?? "none"}>{(["none", "studio_edits", "brand_edits"] as const).map((e) => <option key={e} value={e}>{u.edits[e]}</option>)}</select></label>
              <fieldset className="bw-usage-choices"><legend>{a.timingKind}</legend>
                <label className="bw-check"><input type="radio" name="timingKind" value="fixed" defaultChecked={draft?.timing.kind !== "first_use"} />{a.fixed}</label>
                <label className="bw-check"><input type="radio" name="timingKind" value="first_use" defaultChecked={draft?.timing.kind === "first_use"} />{a.firstUse}</label>
              </fieldset>
              <div className="bw-grid">
                <label>{a.startsOn}<input type="date" name="startsOn" defaultValue={draft?.timing.kind === "fixed" ? draft.timing.startsOn : ""} /></label>
                <label>{a.endsOn}<input type="date" name="endsOn" defaultValue={draft?.timing.kind === "fixed" ? draft.timing.endsOn : ""} /></label>
                <label>{a.durationDays}<input type="number" name="durationDays" min={1} max={3650} defaultValue={draft?.timing.kind === "first_use" ? draft.timing.durationDays : ""} /></label>
              </div>
              <label>{a.excludedNote} <span className="bw-muted">({u.optional})</span><textarea name="excludedNote" maxLength={1000} defaultValue={scope?.scope.excludedNote ?? ""} /></label>
            </Form>
          </section>
        )}

        {scope && (
          <section className="bw-panel" data-usage-scope={scope.revision}>
            <h2>{interpolate(a.scopeCurrent, { number: scope.revision })}</h2>
            <p className="bw-muted"><code>{scope.sha256.slice(0, 12)}</code> · {formatBrandTimestamp(scope.createdAt, locale)}</p>
            {scope.scope.items.map((i) => (
              <dl className="bw-meta" key={i.itemId}>
                <div><dt>{u.quote.subject}</dt><dd>{itemLabel(i.itemId)} · {u.subjectKinds[i.subject.kind]}</dd></div>
                <div><dt>{u.quote.usageKinds}</dt><dd>{i.usageKinds.map((k) => u.usageKinds[k]).join(", ")}</dd></div>
                <div><dt>{u.quote.channels}</dt><dd>{i.channels.join(", ")}</dd></div>
                <div><dt>{u.quote.territory}</dt><dd>{i.territory.join(", ")}</dd></div>
                <div><dt>{u.quote.period}</dt><dd>{i.timing.kind === "fixed" ? interpolate(u.quote.fixed, { start: formatBrandDate(i.timing.startsOn, locale)!, end: formatBrandDate(i.timing.endsOn, locale)! }) : interpolate(u.quote.firstUse, { days: i.timing.durationDays })}</dd></div>
                {i.usageKinds.includes("partnership_ads") && <p className="bw-muted">{u.license.adsNote}</p>}
              </dl>
            ))}
          </section>
        )}

        {scope && c.status === "scope_defined" && (
          <section className="bw-panel" data-usage-internal>
            <h2>{a.compensationTitle}</h2>
            <p className="bw-muted">{a.compensationHint}</p>
            {c.compensations.filter((x) => x.scopeRevisionId === scope.id).map((x) => <p key={x.id}>#{x.revision} · {formatKrw(x.amountKrw, locale)} · {x.taxBasis === "included" ? a.taxIncluded : a.taxExcluded} {x.note && <>· {x.note}</>}</p>)}
            <Form op="brandUsage.compensation" submit={a.saveCompensation}>
              <input type="hidden" name="scopeRevisionId" value={scope.id} />
              <label>{a.amount}<input name="amountKrw" type="number" min={0} step={1} required /></label>
              <label>{a.taxBasis}<select name="taxBasis" required defaultValue=""><option value="" disabled>—</option><option value="included">{a.taxIncluded}</option><option value="excluded">{a.taxExcluded}</option></select></label>
              <label>{a.note} <span className="bw-muted">({u.optional})</span><textarea name="note" maxLength={2000} /></label>
            </Form>
            <h2>{a.consentTitle}</h2>
            <p className="bw-muted">{a.consentHint}</p>
            {liveCompensation && scope.scope.items.map((i) => {
              const live = c.consents.find((x) => x.itemId === i.itemId && x.scopeRevisionId === scope.id && !x.withdrawnAt);
              return live ? (
                <div key={i.itemId} className="bw-note">
                  <strong>{itemLabel(i.itemId)}</strong> · {a.consentLive} · {a.approverKinds[live.approverKind as keyof typeof a.approverKinds]} · {formatBrandTimestamp(live.approvedAt, locale)} · {live.evidenceReference}
                  {live.compensationId !== liveCompensation.id && <p className="bw-error">{a.compensationHint}</p>}
                  <Form op="brandUsage.consentWithdraw" submit={a.withdrawConsent} tone="danger"><input type="hidden" name="consentId" value={live.id} /></Form>
                </div>
              ) : (
                <Form key={i.itemId} op="brandUsage.consent" submit={`${a.saveConsent}: ${itemLabel(i.itemId)}`}>
                  <input type="hidden" name="itemId" value={i.itemId} />
                  <input type="hidden" name="scopeRevisionId" value={scope.id} />
                  <input type="hidden" name="compensationId" value={liveCompensation.id} />
                  <label>{a.approver}<select name="approverKind">{(["creator", "agency", "rights_holder"] as const).map((k) => <option key={k} value={k}>{a.approverKinds[k]}</option>)}</select></label>
                  <label>{a.approvedAt}<input type="datetime-local" name="approvedAt" required /></label>
                  <label>{a.evidence}<input name="evidenceReference" required maxLength={500} /><span className="bw-muted">{a.evidenceHint}</span></label>
                  <fieldset className="bw-usage-choices"><legend>{a.rightsChecks}</legend>
                    {(["ownership", "music", "people", "marks"] as const).map((k) => <label className="bw-check" key={k}><input type="checkbox" name="rightsChecks" value={k} required />{a.rights[k]}</label>)}
                  </fieldset>
                </Form>
              );
            })}
            <h2>{a.quoteTitle}</h2>
            <p className="bw-muted">{a.quoteHint}</p>
            {sharedContracts.length === 0 ? <p className="bw-error">{a.contractHint}</p> : (
              <Form op="brandUsage.quote" submit={a.sendQuote} confirm={a.sendQuoteConfirm}>
                <input type="hidden" name="scopeRevisionId" value={scope.id} />
                <label>{a.total}<input name="totalKrw" type="number" min={1} step={1} required /></label>
                <label>{a.taxBasis}<select name="taxBasis" required defaultValue=""><option value="" disabled>—</option><option value="included">{a.taxIncluded}</option><option value="excluded">{a.taxExcluded}</option></select></label>
                <label>{a.validUntil}<input type="datetime-local" name="validUntil" required /></label>
                <label>{a.contract}<select name="contractId" required>{sharedContracts.map((d) => <option key={d.id} value={d.id}>{d.title} v{d.version}</option>)}</select><span className="bw-muted">{a.contractHint}</span></label>
                <label>{u.quote.note} <span className="bw-muted">({u.optional})</span><textarea name="note" maxLength={2000} /></label>
              </Form>
            )}
          </section>
        )}

        <section className="bw-panel">
          <h2>{a.quotes}</h2>
          {!c.quotes.length && <p className="bw-muted">{a.empty}</p>}
          {c.quotes.map((q) => <p key={q.id} data-usage-studio-quote={q.status}>{interpolate(u.quote.revision, { number: q.revision })} · {formatKrw(q.totalKrw, locale)} · {q.taxBasis === "included" ? a.taxIncluded : a.taxExcluded} · {q.status}{q.expired && q.status === "open" ? " · expired" : ""} · {u.quote.validUntil} {formatBrandTimestamp(q.validUntil, locale)}{q.acceptedAt && <> · {formatBrandTimestamp(q.acceptedAt, locale)}</>}</p>)}
          {(c.status === "quoted" || (c.status === "accepted" && !c.payments.some((p) => ["confirming", "paid", "refund_pending", "refunded"].includes(p.status)))) && openQuote && <Form op="brandUsage.reopen" submit={a.reopen} tone="plain" />}
          {["inquiry", "scoping", "scope_defined", "quoted", "accepted"].includes(c.status) && (
            <Form op="brandUsage.close" submit={a.close} tone="danger">
              <label>{a.reason}<select name="reason">{(["answered_only", "creator_declined", "no_response", "other"] as const).map((r) => <option key={r} value={r}>{a.closeReasons[r]}</option>)}</select></label>
            </Form>
          )}
        </section>

        <section className="bw-panel">
          <h2>{a.paymentsTitle}</h2>
          {!c.payments.length && <p className="bw-muted">{a.empty}</p>}
          {c.payments.map((p) => <p key={p.id} data-usage-studio-payment={p.status}><code>{p.id.slice(0, 8)}</code> · {u.payment.status[p.status as keyof typeof u.payment.status] ?? p.status} · {formatKrw(p.amountKrw, locale)} · {p.environment}{p.failureCode && <> · {p.failureCode}</>} · {formatBrandTimestamp(p.createdAt, locale)}</p>)}
          {c.status === "blocked_after_payment" && <Form op="brandUsage.resolve" submit={a.reverify} tone="plain"><input type="hidden" name="action" value="reverify" /><label>{a.reason}<input name="reason" required maxLength={500} /></label></Form>}
          {c.payments.some((p) => p.status === "confirming" || p.status === "review") && (
            <Form op="brandUsage.resolve" submit={a.abandon} tone="plain"><input type="hidden" name="action" value="abandon" /><p className="bw-muted">{a.abandonHint}</p><label>{a.reason}<input name="reason" required maxLength={500} /></label></Form>
          )}
          {((["blocked_after_payment", "fulfilled", "paid"].includes(c.status) && c.payments.some((p) => p.status === "paid" || p.status === "refund_pending")) || c.payments.some((p) => p.status === "review")) && (
            <Form op="brandUsage.resolve" submit={a.refund} tone="danger" confirm={a.refundConfirm}><input type="hidden" name="action" value="refund" /><label>{a.reason}<input name="reason" required maxLength={500} /></label></Form>
          )}
        </section>

        <section className="bw-panel">
          <h2>{a.grantsTitle}</h2>
          {!c.grants.length && <p className="bw-muted">{a.empty}</p>}
          {c.grants.map((g) => (
            <div key={g.id} className="bw-message" data-usage-studio-grant={g.state}>
              <strong>{itemLabel(g.itemId)}</strong> · {u.license.states[g.state]} · {g.startsAt ? `${formatBrandTimestamp(g.startsAt, locale)} → ${formatBrandTimestamp(g.endsAt, locale)}` : interpolate(u.license.pendingStart, { days: g.durationDays ?? 0 })}
              {g.events.map((e, i) => <p key={i} className="bw-muted">{e.kind} · {e.reason} · {formatBrandTimestamp(e.createdAt, locale)}</p>)}
              {g.state === "pending_start" && (
                <Form op="brandUsage.grantStart" submit={a.startGrant}><input type="hidden" name="grantId" value={g.id} /><label>{a.startsOn}<input type="date" name="startsOn" required /></label><label>{a.reason}<input name="reason" required maxLength={500} /></label></Form>
              )}
              {g.state !== "terminated" && (
                <Form op="brandUsage.grantEvent" submit={a.grantEvent} tone="plain">
                  <input type="hidden" name="grantId" value={g.id} />
                  <label>{a.grantEvent}<select name="kind">{(["suspended", "resumed", "terminated"] as const).map((k) => <option key={k} value={k}>{a.grantKinds[k]}</option>)}</select></label>
                  <label>{a.reason}<input name="reason" required maxLength={500} /></label>
                </Form>
              )}
            </div>
          ))}
        </section>

        <section className="bw-panel">
          <h2>{a.buyersTitle}</h2>
          <p className="bw-muted">{a.buyersHint}</p>
          {c.buyers.map((x) => (
            <Form key={x.userId} op="brandUsage.buyer" submit={`${a.removeBuyer}: ${x.email}`} tone="plain">
              <input type="hidden" name="organizationId" value={c.organizationId} /><input type="hidden" name="userId" value={x.userId} /><input type="hidden" name="grant" value="false" />
            </Form>
          ))}
          {c.members.some((m) => m.role === "editor" && !c.buyers.some((x) => x.userId === m.userId)) && (
            <Form op="brandUsage.buyer" submit={a.addBuyer}>
              <input type="hidden" name="organizationId" value={c.organizationId} /><input type="hidden" name="grant" value="true" />
              <label>{b.members}<select name="userId">{c.members.filter((m) => m.role === "editor" && !c.buyers.some((x) => x.userId === m.userId)).map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}</select></label>
              <label>{a.buyerReason}<input name="reason" required maxLength={500} /></label>
            </Form>
          )}
        </section>

        <section className="bw-panel">
          <h2>{a.events}</h2>
          <ul className="bw-list">{c.events.map((e, i) => <li key={i} className="bw-muted">{formatBrandTimestamp(e.createdAt, locale)} · {e.actor} · {e.kind}</li>)}</ul>
        </section>
      </div>
    </AdminShell>
  );
}
