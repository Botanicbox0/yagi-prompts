'use client';
import {useState} from 'react';
import type {BrandProjectSummary} from '@/lib/brands/workspace/types';
import type {BrandCopy} from './action-form';
import {formatBrandTimestamp} from './format';
export function CampaignList({projects,b,locale,studio=false}:{projects:BrandProjectSummary[];b:BrandCopy;locale:string;studio?:boolean}){
 const [query,setQuery]=useState(''),[status,setStatus]=useState('all');
 const filtered=projects.filter(p=>(status==='all'||p.status===status)&&`${p.organizationName} ${p.title}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
 const order={requested:0,active:1,completed:2,cancelled:3};
 const sorted=filtered.slice().sort((a,z)=>order[a.status]-order[z.status]||Date.parse(z.updatedAt)-Date.parse(a.updatedAt));
 return <section data-campaign-queue><div className="bw-queue-counts">{(['all','requested','active','completed'] as const).map(key=><button type="button" key={key} aria-pressed={status===key} onClick={()=>setStatus(key)}><span>{key==='all'?b.performance.allCampaigns:b.status[key]}</span><strong>{(key==='all'?projects:projects.filter(p=>p.status===key)).length}</strong></button>)}</div><div className="bw-filter-bar"><label>{b.performance.searchCampaigns}<input value={query} onChange={e=>setQuery(e.target.value)}/></label><label>{b.projectStatus}<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">{b.performance.allCampaigns}</option>{Object.entries(b.status).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>{!sorted.length?<p className="bw-note">{b.performance.noCampaignMatch}</p>:<ul className="bw-list">{sorted.map(p=><li key={p.id} className="bw-row"><div><p className="bw-kicker">{p.organizationName}</p><h3><a href={`${studio?'/admin/brand-workspace':'/brand/projects'}/${p.id}`}>{p.title} →</a></h3><p className="bw-muted">{b.latestUpdate} {formatBrandTimestamp(p.updatedAt,locale)}</p>{p.endsOn&&<p className="bw-muted">{b.endsOn}: {p.endsOn}</p>}</div><span className="bw-status" data-state={p.status}>{b.status[p.status]}</span></li>)}</ul>}</section>;
}
