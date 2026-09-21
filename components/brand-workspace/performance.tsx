'use client';
import {useMemo,useState} from 'react';
import type {BrandCopy} from './action-form';
import type {BrandPost,BrandProjectDetail,BrandReport} from '@/lib/brands/workspace/types';
import {campaignPerformance,rankCampaignPosts,postEngagement,campaignCsv} from '@/lib/brands/workspace/performance';
import {interpolate} from '@/lib/i18n/format';
import {formatBrandTimestamp} from './format';

export function CampaignPerformance({project:p,posts=p.posts,b,locale,frozen=false,compact=false}:{project:Pick<BrandProjectDetail,'title'|'posts'|'contents'|'attachments'|'criteria'>;posts?:BrandPost[];b:BrandCopy;locale:string;frozen?:boolean;compact?:boolean}){
 const c=b.performance;
 const stats=useMemo(()=>campaignPerformance(posts),[posts]);
 const number=(n:number|null)=>n===null?'—':n.toLocaleString(locale);
 const [query,setQuery]=useState(''),[platform,setPlatform]=useState('all'),[sort,setSort]=useState('views');
 const titles=Object.fromEntries(p.contents.map(content=>[content.id,content.title]));
 const filtered=posts.filter(post=>(platform==='all'||post.platform===platform)&&`${titles[post.contentVersionId]??''} ${post.url}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
 const sorted=sort==='latest'?filtered.slice().sort((a,z)=>Date.parse(z.publishedAt)-Date.parse(a.publishedAt)): [...rankCampaignPosts(filtered,sort==='engagement'?'engagement':'views'),...filtered.filter(post=>(sort==='engagement'?postEngagement(post):post.views)===null)];
 const targetValue=p.criteria.primaryMetric==='views'?stats.views.total:p.criteria.primaryMetric==='engagement'?stats.engagement.total:stats.totalPosts;
 const target=p.criteria.targetValue;
 const coverage=(known:number)=>interpolate(c.coverage,{known,total:posts.length});
 function download(){const csv=campaignCsv(posts,titles,[c.csvId,c.csvTitle,b.platformLabel,c.csvUrl,b.postPublishedAt,b.views,b.likes,b.comments,b.shares,b.saves,b.source,b.measuredAt]);const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download='twings-campaign-results.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const metricCards=[{label:c.views,...stats.views},{label:c.engagement,...stats.engagement},{label:b.comments,...stats.comments},{label:c.posts,total:stats.totalPosts,measured:posts.length}];
 return <section className="bw-performance" data-campaign-performance>
  <div className="bw-row"><div><p className="bw-kicker">{frozen?c.snapshot:c.live}</p><h2>{c.title}</h2><p className="bw-muted">{c.subtitle}</p></div>{!compact&&<button type="button" className="bw-button bw-no-print" onClick={download} disabled={!posts.length}>{c.download}</button>}</div>
  <div className="bw-performance-stats">{metricCards.map(metric=><div key={metric.label}><span>{metric.label}</span><strong>{number(metric.total)}</strong><small>{coverage(metric.measured)}</small></div>)}</div>
  {!frozen&&target!==null&&target>0&&<div className="bw-target"><div className="bw-row"><span>{c.target} · {b.metricNames[p.criteria.primaryMetric]}</span><strong>{number(targetValue)} / {number(target)}</strong></div><progress max={target} value={targetValue===null?0:Math.min(target,targetValue)} aria-label={c.target}/><small>{c.targetNote}</small></div>}
  <p className="bw-muted">{c.viewsNote} {c.unknownNote}</p>
  {!compact&&<>
   <div className="bw-highlights">{(['views','engagement'] as const).map(ranking=><section key={ranking}><h3>{ranking==='views'?c.topViews:c.topEngagement}</h3><ol className="bw-top-posts">{rankCampaignPosts(posts,ranking).slice(0,3).map((post,index)=>{
    const content=p.contents.find(item=>item.id===post.contentVersionId),attachment=p.attachments.find(item=>item.id===content?.attachmentId);
    return <li key={post.id} className="bw-top-post"><div className="bw-preview">{content&&attachment?.mime.startsWith('image/')?<img src={content.mediaUrl} alt={`${c.preview}: ${content.title}`} loading="lazy"/>:content&&attachment?.mime.startsWith('video/')?<video src={`${content.mediaUrl}#t=0.1`} aria-label={`${c.preview}: ${content.title}`} muted playsInline preload="metadata" controls/>:<span>{c.previewUnavailable}</span>}</div><div><span className="bw-kicker">{String(index+1).padStart(2,'0')} · {b.platforms[post.platform]}</span><h4>{content?.title??b.posts}</h4><span className="bw-muted">{c.preview}</span><strong>{number(ranking==='views'?post.views:postEngagement(post))}</strong><small>{ranking==='views'?b.views:c.engagement}</small><a href={post.url} target="_blank" rel="noopener noreferrer">{c.openPost} ↗</a><span className="bw-muted">{b.sourceLabels[post.metricsSource]}</span></div></li>;
   })}</ol>{!rankCampaignPosts(posts,ranking).length&&<p className="bw-note">{c.noRanking}</p>}</section>)}</div>
   <div className="bw-method"><p>{c.engagementNote}</p><p><strong>{c.rate}: {stats.engagementRate===null?'—':`${stats.engagementRate.toLocaleString(locale,{maximumFractionDigits:2})}%`}</strong> · {interpolate(c.rateCoverage,{count:stats.ratePosts})}</p><p className="bw-muted">{c.firstMeasured}: {formatBrandTimestamp(stats.firstMeasuredAt,locale)??'—'} · {c.lastMeasured}: {formatBrandTimestamp(stats.lastMeasuredAt,locale)??'—'}</p><p className="bw-muted">{c.sourceNotice}</p></div>
   <h3>{c.allPosts}</h3><div className="bw-filter-bar bw-no-print"><label>{c.search}<input value={query} onChange={event=>setQuery(event.target.value)} placeholder={c.searchHint}/></label><label>{b.platformLabel}<select value={platform} onChange={event=>setPlatform(event.target.value)}><option value="all">{c.allPlatforms}</option>{Object.entries(b.platforms).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><label>{c.sort}<select value={sort} onChange={event=>setSort(event.target.value)}><option value="views">{c.topViews}</option><option value="engagement">{c.topEngagement}</option><option value="latest">{c.latest}</option></select></label></div>
   {sorted.length?<div className="bw-table-wrap" tabIndex={0} role="region" aria-label={c.allPosts}><table className="bw-table"><thead><tr>{[b.posts,b.views,b.likes,b.comments,b.shares,b.saves,b.source,b.measuredAt].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{sorted.map(post=><tr key={post.id}><td><a href={post.url} target="_blank" rel="noopener noreferrer">{titles[post.contentVersionId]??b.platforms[post.platform]} ↗</a><p className="bw-muted">{b.platforms[post.platform]} · {b.verificationLabels[post.verification]}</p></td>{[post.views,post.likes,post.comments,post.shares,post.saves].map((value,i)=><td key={i}>{number(value)}</td>)}<td>{b.sourceLabels[post.metricsSource]}</td><td>{formatBrandTimestamp(post.measuredAt,locale)??'—'}</td></tr>)}</tbody></table></div>:<p className="bw-note">{posts.length?c.noMatch:b.noPosts}</p>}
  </>}
 </section>;
}

export function ReportResult({project,report,b,locale}:{project:BrandProjectDetail;report:BrandReport;b:BrandCopy;locale:string}){
 return <article className="bw-report" data-report-version={report.version}><header className="bw-heading"><div><p className="bw-kicker">{b.performance.reportTitle} · {interpolate(b.reportCount,{number:report.version})}</p><h1>{project.title}</h1><p>{project.organizationName}</p></div><button type="button" className="bw-button bw-no-print" onClick={()=>window.print()}>{b.performance.print}</button></header><p>{b.period}: {report.periodStart} — {report.periodEnd}</p><p className="bw-muted">{b.publishedAt}: {formatBrandTimestamp(report.createdAt,locale)} · {b.performance.reportBasis}</p><p className="bw-note">{b.performance.reportFrozen}</p><p className="bw-prose bw-report-summary">{report.summary}</p><CampaignPerformance project={project} posts={report.snapshot.posts} b={b} locale={locale} frozen/></article>;
}
