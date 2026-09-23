'use client';
import { useState } from 'react';
import type { BrandProjectSummary } from '@/lib/brands/workspace/types';
import type { BrandCopy } from './action-form';
import { interpolate } from '@/lib/i18n/format';
import { WorkspacePreview } from './preview';
import { campaignDateLine } from '@/lib/brands/workspace/schedule';

export function CampaignList({ projects, b, locale, studio = false }: { projects: BrandProjectSummary[]; b: BrandCopy; locale: string; studio?: boolean }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all');
  const d = b.dashboard;
  const link = (p: BrandProjectSummary) => `${studio ? '/admin/brand-workspace' : '/brand/projects'}/${p.id}`;
  const needsAction = (p: BrandProjectSummary) => studio ? p.status === 'requested' || (p.status === 'active' && (p.overview?.changes ?? 0) > 0) : p.status === 'active' && (p.overview?.pending ?? 0) > 0;
  const attention = projects.filter(needsAction);
  const filtered = projects.filter(p => (status === 'all' || p.status === status) && `${p.organizationName} ${p.title}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
  const order = { requested: 0, active: 1, completed: 2, cancelled: 3 };
  const sorted = filtered.slice().sort((a, z) => Number(needsAction(z)) - Number(needsAction(a)) || order[a.status] - order[z.status] || Date.parse(z.updatedAt) - Date.parse(a.updatedAt));
  const latest = projects.flatMap(p => (p.overview?.contents ?? []).map(content => ({ p, content }))).sort((a,z) => Date.parse(z.content.createdAt) - Date.parse(a.content.createdAt)).slice(0, 4);
  const shortDate = (date: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date));
  /** Factual per status: never "to be agreed" on an active, completed or cancelled campaign. */
  const dateLine = (p: BrandProjectSummary, labelled = true) => {
    const line = campaignDateLine(p);
    return !line ? null : line.kind === 'pending' ? d.noDate : labelled ? `${b.endsOn} · ${shortDate(line.date)}` : shortDate(line.date);
  };
  function activity(p: BrandProjectSummary) {
    if (studio && p.status === 'requested') return d.openRequest;
    if (studio && p.status === 'active' && p.overview?.changes) return interpolate(d.changeCount, { count: p.overview.changes });
    if (p.status === 'active' && p.overview?.pending) return interpolate(d.reviewCount, { count: p.overview.pending });
    return p.overview?.published ? interpolate(d.publishedCount, { count: p.overview.published }) : d.allClear;
  }
  const featured=attention[0]??projects.find(p=>p.status==='active')??projects[0];
  return <div data-campaign-queue data-workspace-board>
    {!studio&&featured&&<section className="bw-featured-campaign" data-featured-campaign>
      <a className="bw-featured-art" href={link(featured)}><WorkspacePreview cover={featured.coverUrl} content={featured.overview?.contents.find(c=>c.mime?.startsWith('image/'))??featured.overview?.contents[0]} b={b} title={featured.organizationName}/></a>
      <div className="bw-featured-copy"><div><span className="bw-status" data-state={featured.status}>{b.status[featured.status]}</span><p className="bw-kicker">{featured.organizationName}</p><h2>{featured.title}</h2><p>{featured.objective}</p></div><footer><span className="bw-muted" data-campaign-date={campaignDateLine(featured)?.kind ?? 'none'}>{dateLine(featured)}</span><a className="bw-button bw-primary" href={link(featured)}>{d.viewCampaign} ↗</a></footer></div>
    </section>}
    {attention.length > 0 && <section className="bw-attention" data-home-attention>
      <div><h2>{studio ? d.studioAttention : d.attention}<span>{attention.length}</span></h2><p>{interpolate(studio ? d.studioAttentionNote : d.attentionNote, { count: attention.length })}</p></div>
      <div className="bw-attention-links">{attention.slice(0, 3).map(p => <a key={p.id} href={`${link(p)}${studio ? '' : '#review'}`}><span>{p.title}</span><strong>{studio ? (p.status === 'requested' ? d.openRequest : d.openChanges) : d.openReview} <i aria-hidden="true">↗</i></strong></a>)}</div>
    </section>}
    <section className="bw-campaign-section">
      <div className="bw-board-toolbar">
        <div className="bw-status-tabs" aria-label={b.projectStatus}>{(['all','requested','active','completed','cancelled'] as const).map(key => <button type="button" key={key} aria-pressed={status === key} onClick={() => setStatus(key)}>{key === 'all' ? b.performance.allCampaigns : b.status[key]}<span>{(key === 'all' ? projects : projects.filter(p => p.status === key)).length}</span></button>)}</div>
        <label className="bw-search"><span className="sr-only">{d.search}</span><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input value={query} onChange={e => setQuery(e.target.value)} placeholder={d.searchPlaceholder}/></label>
      </div>
      {!sorted.length ? <p className="bw-board-empty" role="status">{b.performance.noCampaignMatch}</p> : studio ? <div className="bw-ops-list">
        <div className="bw-ops-labels" aria-hidden="true"><span>{d.campaign}</span><span>{d.activity}</span><span>{d.schedule}</span></div>
        {sorted.map(p => <a className="bw-ops-row" key={p.id} href={link(p)}><div className="bw-ops-name"><WorkspacePreview cover={p.coverUrl} content={p.overview?.contents.find(c => c.mime?.startsWith('image/')) ?? p.overview?.contents[0]} b={b} title={p.organizationName}/><div><small>{p.organizationName}</small><h3>{p.title}</h3><span className="bw-status" data-state={p.status}>{b.status[p.status]}</span>{p.clientVisible===false&&<small className="bw-private-label">{b.managed.prepared}</small>}</div></div><span className={needsAction(p) ? 'bw-action-needed' : 'bw-muted'}>{activity(p)}</span><span className="bw-ops-date" data-campaign-date={campaignDateLine(p)?.kind ?? 'none'}>{dateLine(p, false) ?? '—'}<span aria-hidden="true">↗</span></span></a>)}
      </div> : <ul className="bw-campaign-grid">{sorted.map(p => <li key={p.id}><a className="bw-campaign-card" href={link(p)}>
        <div className="bw-campaign-art"><WorkspacePreview cover={p.coverUrl} content={p.overview?.contents.find(c => c.mime?.startsWith('image/')) ?? p.overview?.contents[0]} b={b} title={p.organizationName}/><span className="bw-status" data-state={p.status}>{b.status[p.status]}</span></div>
        <div className="bw-card-copy"><p>{p.organizationName}{p.clientVisible===false&&<small className="bw-private-label" data-campaign-unshared>{b.managed.prepared}</small>}</p><h2>{p.title}</h2>{campaignDateLine(p) && <span data-campaign-date={campaignDateLine(p)!.kind}>{dateLine(p)}</span>}<footer><strong className={needsAction(p) ? 'bw-action-needed' : ''}>{activity(p)}</strong><span aria-hidden="true">↗</span></footer></div>
      </a></li>)}</ul>}
    </section>
    {!studio && <section className="bw-recent" data-home-recent><header><h2>{d.recent}</h2><p>{d.recentNote}</p></header>{latest.length ? <div className="bw-content-grid">{latest.map(({ p, content }) => <a key={content.id} href={`${link(p)}#review`} className="bw-content-card"><WorkspacePreview content={content} b={b} title={p.organizationName}/><div><span className="bw-status" data-state={content.decision}>{b.decisionStates[content.decision]}</span><h3>{content.title}</h3><p>{p.title}</p><small>{interpolate(b.version, { number: content.version })}</small></div></a>)}</div> : <p className="bw-board-empty">{d.noRecent}</p>}</section>}
  </div>;
}
