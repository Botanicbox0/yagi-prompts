import { riskEvidenceSegments } from '@/lib/campaigns/risk/evidence';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { AdminShell, Panel, OpForm, INPUT, BUTTON } from '@/components/admin/chrome';
import { loadRiskInbox } from '@/lib/campaigns/risk/admin';
import { campaignRiskMessages } from '@/messages/campaign-risk';
export const dynamic = 'force-dynamic';
export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, sql, locale, params] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    searchParams,
  ]);
  const t = campaignRiskMessages[locale];
  const label = (s: string) => t[s as keyof typeof t] ?? s;
  const inbox = sql
    ? await loadRiskInbox(
        sql,
        viewer,
        typeof params.view === 'string' ? params.view : undefined,
        new Date(),
        typeof params.flag === 'string' ? params.flag : undefined,
      )
    : { ready: false as const };
  if (!inbox) notFound();
  return (
    <AdminShell dict={getDictionary(locale).admin} locale={locale} active="risk">
      <div data-risk-inbox>
        <h1 className="font-display text-3xl">{t.title}</h1>
        <p className="my-4">{t.lede}</p>
        {!inbox.ready ? (
          <p role="status">{t.unavailable}</p>
        ) : (
          <>
            {!inbox.enabled && (
              <p role="status" className="border border-hairline p-4">
                {t.disabled}
              </p>
            )}
            <Panel title={t.worker}>
              <div data-risk-worker-status>
                <p>{inbox.lastSeen ? new Date(inbox.lastSeen).toISOString() : t.never}</p>
                {inbox.workerUnavailable && <p role="status">{t.workerDown}</p>}
                {inbox.modelUnavailable && <p role="status">{t.modelDown}</p>}
              </div>
            </Panel>
            <Panel title={t.queue}>
              {inbox.jobs.map((j) => (
                <p key={`${j.state}:${j.error_code ?? ''}`}>
                  {label(j.state)}: {j.n}
                  {j.error_code ? ` · ${label(j.error_code)}` : ''}
                </p>
              ))}
            </Panel>
            <Panel title={t.slack}>
              <p>{inbox.slackConfig === 'disabled' ? t.slackDisabled : label(inbox.slackConfig)}</p>
              {inbox.slack.map((j) => (
                <p key={j.state}>
                  {label(j.state)}: {j.n}
                </p>
              ))}
            </Panel>
            {!inbox.flags.length && <p>{t.empty}</p>}
            {inbox.flags.map((flag) => (
              <Panel key={flag.id} title={label(flag.category)}>
                <article id={`flag-${flag.id}`}>
                  <p>
                    {t.state}: {label(flag.state)} · {Math.round(flag.confidence * 100)}%
                  </p>
                  <p>
                    {t.detector}: {label(flag.detector)} · {flag.detector_version}
                    {flag.model_id ? ` · ${flag.model_id}` : ''}
                  </p>
                  <p>
                    {t.evidence}: {flag.evidence.map((e) => `${e.start}–${e.end}`).join(', ')}
                  </p>
                  {inbox.source?.id === flag.id ? (
                    <>
                      <p>{t.source}</p>
                      {inbox.source.stale && <p role="alert">{t.stale}</p>}
                      <pre className="my-3 whitespace-pre-wrap break-words border border-hairline p-3">
                        {riskEvidenceSegments(
                          inbox.source.body,
                          inbox.source.stale ? [] : flag.evidence,
                        ).map((s, i) =>
                          s.highlight ? (
                            <mark key={i}>{s.text}</mark>
                          ) : (
                            <span key={i}>{s.text}</span>
                          ),
                        )}
                      </pre>
                    </>
                  ) : (
                    <>
                      <p>{t.sourceHidden}</p>
                      <a className={BUTTON} href={`/admin/risk?view=${flag.id}#flag-${flag.id}`}>
                        {t.view}
                      </a>
                    </>
                  )}
                  <OpForm
                    op="campaignRisk.review"
                    back="/admin/risk"
                    className="mt-4 flex flex-col gap-3"
                  >
                    <input name="id" type="hidden" value={flag.id} />
                    <label>
                      {t.state}
                      <select className={INPUT} name="state" defaultValue="reviewed">
                        <option value="reviewed">{t.reviewed}</option>
                        <option value="dismissed">{t.dismissed}</option>
                        <option value="escalated">{t.escalated}</option>
                      </select>
                    </label>
                    <label>
                      {t.reason}
                      <textarea
                        className={INPUT}
                        name="reason"
                        required
                        minLength={1}
                        maxLength={1000}
                      />
                    </label>
                    {flag.review_reason && <p>{flag.review_reason}</p>}
                    <button className={BUTTON}>{t.save}</button>
                  </OpForm>
                </article>
              </Panel>
            ))}
          </>
        )}
      </div>
    </AdminShell>
  );
}
