import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { CampaignProductionAdmin as Data } from '@/lib/campaigns/production-admin';
import { Panel, Field, OpForm, INPUT, BUTTON, BUTTON_PRIMARY } from '@/components/admin/chrome';
import { ProductionBinding } from './production-binding';
export function CampaignProductionAdmin({ campaignId, data, back, copy, locale }: { campaignId: string; data: Data | null; back: string; copy: Dictionary['campaigns']['production']; locale: string }) {
  if (!data) return null;
  const a = copy.admin, config = data.config, projectId = data.formats.find(f => f.templateId === config?.templateId)?.projectId;
  return <Panel title={a.title}><div data-campaign-production-admin>
    <p className="mb-5 text-sm leading-relaxed opacity-70">{a.hint}</p>
    {!data.ready ? <p className="text-sm opacity-70">{a.schema}</p> : <>
      {!data.open && <p className="mb-4 border border-hairline p-4 text-sm">{a.rollout}</p>}
      {data.formats.length === 0 ? <p className="text-sm opacity-70">{a.empty}</p> : <OpForm op="campaignProduction.configure" back={back} className="grid gap-4">
        <input type="hidden" name="campaignId" value={campaignId} /><input type="hidden" name="expectedRevision" value={config?.revision ?? -1} />
        <ProductionBinding formats={data.formats} references={data.references} config={config} frozen={data.jobs.length > 0} copy={a} locale={locale} />
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="enabled" defaultChecked={config?.enabled} className="mt-1" /><span>{a.enabled}</span></label><div><button className={BUTTON_PRIMARY}>{a.save}</button></div>
      </OpForm>}
      {projectId && <a href={`/admin/brand-workspace/${projectId}`} className="mt-5 inline-block text-sm text-accent">{a.project} →</a>}
      {data.jobs.length > 0 && <div className="mt-8"><h3 className="font-semibold">{a.queue}</h3><ul className="mt-3 grid gap-3">{data.jobs.map(job => <li key={job.id} id={`render-${job.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline p-4"><span className="font-mono text-xs">{job.applicationId.slice(0, 8)}</span><span className="text-sm">{copy.states[job.status as keyof typeof copy.states]}</span>{job.status === 'succeeded' && <a className={BUTTON} href={`/api/campaign-production/${job.id}/media`} target="_blank" rel="noopener noreferrer">{a.output} ↗</a>}{job.status === 'failed' && (job.retryApproved ? <span className="text-sm opacity-60">{a.approvedRetry}</span> : <OpForm op="campaignProduction.retry" back={back}><input type="hidden" name="campaignId" value={campaignId} /><input type="hidden" name="renderId" value={job.id} /><button className={BUTTON}>{a.retry}</button></OpForm>)}</li>)}</ul></div>}
      {data.jobs.filter(j => j.needsReview).map(job => <div key={`resolve-${job.id}`} className="mt-5 rounded-xl border border-hairline p-4">
        <h3 className="font-semibold">{a.dispatchTitle} · {job.applicationId.slice(0, 8)}</h3><p className="mt-2 text-sm leading-relaxed opacity-70">{a.dispatchHint}</p>
        <OpForm op="campaignProduction.resolve" back={back} className="mt-4 grid gap-3"><input type="hidden" name="campaignId" value={campaignId} /><input type="hidden" name="renderId" value={job.id} />
          <select name="action" aria-label={a.dispatchAction} className={INPUT}><option value="attach">{a.attachTask}</option><option value="not_created">{a.noTask}</option></select>
          <Field label={a.taskId}><input name="taskId" type="text" maxLength={200} className={INPUT} /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" required className="mt-1" /><span>{a.dispatchConfirm}</span></label><div><button className={BUTTON}>{a.resolveTask}</button></div>
        </OpForm>
      </div>)}
    </>}
  </div></Panel>;
}
