'use client';
import { useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { CampaignProductionAdmin } from '@/lib/campaigns/production-admin';
type Copy = Dictionary['campaigns']['production']['admin'];
export function ProductionBinding({ formats, references, config, frozen, copy, locale }: { formats: CampaignProductionAdmin['formats']; references: CampaignProductionAdmin['references']; config: CampaignProductionAdmin['config']; frozen: boolean; copy: Copy; locale: string }) {
  const [binding, setBinding] = useState(config ? `${config.contractId}|${config.templateId}` : '');
  const projectId = formats.find(f => `${f.contractId}|${f.templateId}` === binding)?.projectId;
  const images = references.filter(r => r.projectId === projectId);
  return <>
    {frozen && <><input type="hidden" name="binding" value={binding} />{config?.referenceAttachmentIds.map(id => <input key={id} type="hidden" name="referenceAttachmentIds" value={id} />)}</>}
    <label className="grid gap-2 text-sm"><span>{copy.binding}</span><select name={frozen ? undefined : 'binding'} disabled={frozen} required value={binding} onChange={e => setBinding(e.target.value)} className="w-full min-w-0 border border-hairline bg-transparent px-3 py-2 text-sm"><option value="">{copy.noBinding}</option>{formats.map(f => <option value={`${f.contractId}|${f.templateId}`} key={f.templateId}>{f.projectTitle} · {f.contractTitle} · {locale === 'ko' ? f.titleKo : f.title}</option>)}</select></label>
    {frozen && <p className="text-xs opacity-60">{copy.frozen}</p>}
    <fieldset disabled={frozen} className="grid gap-2 rounded-xl border border-hairline p-4"><legend className="px-1 text-sm">{copy.productImages}</legend><p className="text-xs leading-relaxed opacity-60">{copy.productHint}</p>
      {!images.length && <p className="text-sm opacity-60">{copy.noReferences}</p>}
      {images.map(r => <label key={`${binding}:${r.id}`} className="flex items-start gap-2 text-sm"><input type="checkbox" name={frozen ? undefined : 'referenceAttachmentIds'} value={r.id} defaultChecked={config?.referenceAttachmentIds.includes(r.id)} className="mt-1" /><span className="break-all">{r.name}</span></label>)}
    </fieldset>
  </>;
}
