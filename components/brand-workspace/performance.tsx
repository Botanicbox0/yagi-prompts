'use client';
import {useMemo,useState} from 'react';
import type {BrandCopy} from './action-form';
import type {BrandPost,BrandProjectDetail,BrandReport} from '@/lib/brands/workspace/types';
import {campaignPerformance,rankCampaignPosts,postEngagement,campaignCsv,postContentTitle,byLatestPublished,postPresentation,postHandle,postSearchText} from '@/lib/brands/workspace/performance';
import {interpolate} from '@/lib/i18n/format';
import {formatBrandDate,formatBrandTimestamp} from './format';

type PerformanceProject=Pick<BrandProjectDetail,'title'|'posts'|'contents'|'attachments'|'criteria'>;
const shortDate=(iso:string,locale:string)=>new Intl.DateTimeFormat(locale==='ko'?'ko-KR':'en-US',{month:'short',day:'numeric',timeZone:'Asia/Seoul'}).format(new Date(iso));

/**
 * The post's own picture only: the studio's thumbnail, else the approved content file behind the post.
 * Never the campaign cover or another post's image. Without one, a small neutral mark, not a banner.
 */
function PostThumb({post,project,label,c}:{post:BrandPost;project:PerformanceProject;label:string;c:BrandCopy['performance']}){
 const thumbnail=postPresentation(post).thumbnailUrl;
 const content=project.contents.find(item=>item.id===post.contentVersionId),mime=project.attachments.find(item=>item.id===content?.attachmentId)?.mime;
 const alt=`${c.thumbnailAlt}: ${label}`;
 return <div className="bw-post-thumb" data-post-thumbnail={thumbnail?'studio':content&&mime?'content':undefined} data-thumbnail-missing={!thumbnail&&!(content&&mime&&/^(image|video)\//.test(mime))?'true':undefined}>
  {thumbnail?<img src={thumbnail} alt={alt} loading="lazy"/>
  :content&&mime?.startsWith('image/')?<img src={content.mediaUrl} alt={alt} loading="lazy"/>
  :content&&mime?.startsWith('video/')?<video src={`${content.mediaUrl}#t=0.1`} aria-label={alt} muted playsInline preload="metadata"/>
  :<span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 2.5-2 5 3.5"/></svg>{c.thumbnailMissing}</span>}
 </div>;
}

export function CampaignPerformance({project:p,posts=p.posts,b,locale,frozen=false,compact=false}:{project:PerformanceProject;posts?:BrandPost[];b:BrandCopy;locale:string;frozen?:boolean;compact?:boolean}){
 const c=b.performance;
 const stats=useMemo(()=>campaignPerformance(posts),[posts]);
 const number=(n:number|null)=>n===null?'—':n.toLocaleString(locale);
 // A publicly rounded count keeps its value but never reads as exact: "약 12,300" / "≈ 12,300".
 const approx=(n:number|null,approximate:boolean)=>n!==null&&approximate?interpolate(c.approxValue,{value:n.toLocaleString(locale)}):number(n);
 const views=(post:BrandPost)=>approx(post.views,post.viewsApproximate);
 const [query,setQuery]=useState(''),[platform,setPlatform]=useState('all'),[sort,setSort]=useState('views');
 const titles=Object.fromEntries(p.contents.map(content=>[content.id,content.title]));
 const linked=posts.filter(post=>post.origin==='external_import').length,undated=posts.filter(post=>post.publishedAt===null).length;
 // Customer-facing name: the recorded @handle, the approved content title, the recorded display name, or
 // the localized generic "Instagram post". The platform's raw post code is never shown as text; it stays
 // only in the link destination (and the CSV).
 const label=(post:BrandPost)=>postHandle(post)??postContentTitle(post,titles)??postPresentation(post).displayName??b.platforms[post.platform];
 const followers=(post:BrandPost)=>{const v=postPresentation(post);return v.followers===null||v.followersMeasuredAt===null?c.followersUnknown:`${interpolate(c.followers,{count:approx(v.followers,v.followersApproximate)})} · ${interpolate(c.followersAsOf,{date:shortDate(v.followersMeasuredAt,locale)})}`;};
 const filtered=posts.filter(post=>(platform==='all'||post.platform===platform)&&postSearchText(post,titles).toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
 const sorted=sort==='latest'?filtered.slice().sort(byLatestPublished): [...rankCampaignPosts(filtered,sort==='engagement'?'engagement':'views'),...filtered.filter(post=>(sort==='engagement'?postEngagement(post):post.views)===null)];
 const targetValue=p.criteria.primaryMetric==='views'?stats.views.total:p.criteria.primaryMetric==='engagement'?stats.engagement.total:stats.totalPosts;
 const target=p.criteria.targetValue;
 const coverage=(known:number)=>interpolate(c.coverage,{known,total:posts.length});
 function download(){const csv=campaignCsv(posts,titles,[c.csvId,c.csvTitle,b.platformLabel,c.csvUrl,b.postPublishedAt,b.views,b.likes,b.comments,b.shares,b.saves,b.source,b.measuredAt,c.csvOrigin,c.csvViewsApproximate]);const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download='twings-campaign-results.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const metricCards=[{label:c.views,...stats.views,approximate:stats.viewsApproximate>0},{label:c.engagement,...stats.engagement,approximate:false},{label:b.comments,...stats.comments,approximate:false},{label:c.posts,total:stats.totalPosts,measured:posts.length,approximate:false}];
 return <section className="bw-performance" data-campaign-performance>
  <div className="bw-row"><div><p className="bw-kicker">{frozen?c.snapshot:c.live}</p><h2>{c.title}</h2><p className="bw-muted">{c.subtitle}</p></div>{!compact&&<button type="button" className="bw-button bw-no-print" onClick={download} disabled={!posts.length}>{c.download}</button>}</div>
  <div className="bw-performance-stats">{metricCards.map(metric=><div key={metric.label} data-approximate={metric.approximate?'true':undefined}><span>{metric.label}</span><strong>{approx(metric.total,metric.approximate)}</strong><small>{coverage(metric.measured)}</small></div>)}</div>
  {!frozen&&target!==null&&target>0&&<div className="bw-target"><div className="bw-row"><span>{c.target} · {b.metricNames[p.criteria.primaryMetric]}</span><strong>{approx(targetValue,p.criteria.primaryMetric==='views'&&stats.viewsApproximate>0)} / {number(target)}</strong></div><progress max={target} value={targetValue===null?0:Math.min(target,targetValue)} aria-label={c.target}/><small>{c.targetNote}</small></div>}
  <p className="bw-muted">{c.viewsNote} {c.unknownNote}</p>
  {stats.viewsApproximate>0&&<p className="bw-note" data-approximate-views={stats.viewsApproximate}>{interpolate(c.approxNote,{count:stats.viewsApproximate})}</p>}
  {linked>0&&<p className="bw-note" data-linked-posts={linked}>{interpolate(c.linkedNote,{count:linked})}{undated>0&&<> {interpolate(frozen?c.reportUndated:c.undatedNote,{count:undated})}</>}</p>}
  {!compact&&<>
   <div className="bw-highlights">{(['views','engagement'] as const).map(ranking=><section key={ranking}><h3>{ranking==='views'?c.topViews:c.topEngagement}</h3><ol className="bw-top-posts">{rankCampaignPosts(posts,ranking).slice(0,3).map((post,index)=>
    <li key={post.id} className="bw-top-post"><PostThumb post={post} project={p} label={label(post)} c={c}/><div><span className="bw-kicker">{String(index+1).padStart(2,'0')} · {c.platformNames[post.platform]}</span><h4>{label(post)}</h4><span className="bw-muted">{followers(post)}</span><strong>{ranking==='views'?views(post):number(postEngagement(post))}</strong><small>{ranking==='views'?b.views:c.engagement}</small><a href={post.url} target="_blank" rel="noopener noreferrer">{c.openPost} ↗</a><span className="bw-muted">{b.sourceLabels[post.metricsSource]}</span></div></li>
   )}</ol>{!rankCampaignPosts(posts,ranking).length&&<p className="bw-note">{c.noRanking}</p>}</section>)}</div>
   <div className="bw-method"><p>{c.engagementNote}</p><p><strong>{c.rate}: {stats.engagementRate===null?'—':stats.engagementRateApproximate?interpolate(c.approxValue,{value:`${stats.engagementRate.toLocaleString(locale,{maximumFractionDigits:2})}%`}):`${stats.engagementRate.toLocaleString(locale,{maximumFractionDigits:2})}%`}</strong> · {interpolate(c.rateCoverage,{count:stats.ratePosts})}</p><p className="bw-muted">{c.firstMeasured}: {formatBrandTimestamp(stats.firstMeasuredAt,locale)??'—'} · {c.lastMeasured}: {formatBrandTimestamp(stats.lastMeasuredAt,locale)??'—'}</p><p className="bw-muted">{c.sourceNotice}</p></div>
   <h3>{c.allPosts}</h3><div className="bw-filter-bar bw-no-print"><label>{c.search}<input value={query} onChange={event=>setQuery(event.target.value)} placeholder={c.searchHint}/></label><label>{b.platformLabel}<select value={platform} onChange={event=>setPlatform(event.target.value)}><option value="all">{c.allPlatforms}</option>{Object.entries(b.platforms).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><label>{c.sort}<select value={sort} onChange={event=>setSort(event.target.value)}><option value="views">{c.topViews}</option><option value="engagement">{c.topEngagement}</option><option value="latest">{c.latest}</option></select></label></div>
   {sorted.length?<ul className="bw-post-grid" aria-label={c.allPosts}>{sorted.map(post=>{
    const v=postPresentation(post),handle=postHandle(post),title=postContentTitle(post,titles);
    return <li key={post.id} className="bw-post-card" data-post-card={post.id}>
     <PostThumb post={post} project={p} label={label(post)} c={c}/>
     <div className="bw-post-body">
      <header><strong className="bw-post-name">{label(post)}</strong><span className="bw-post-meta">{[v.displayName&&handle?v.displayName:null,c.platformNames[post.platform]].filter(Boolean).join(' · ')}</span><span className="bw-post-meta" data-followers={v.followers===null?'unknown':v.followersApproximate?'approximate':'exact'}>{followers(post)}</span></header>
      <dl className="bw-post-metrics">
       <div data-approximate={post.viewsApproximate&&post.views!==null?'true':undefined}><dt>{b.views}</dt><dd>{views(post)}</dd></div>
       <div><dt>{b.likes}</dt><dd>{number(post.likes)}</dd></div>
       <div><dt>{b.comments}</dt><dd>{number(post.comments)}</dd></div>
      </dl>
      <a className="bw-post-open" href={post.url} target="_blank" rel="noopener noreferrer">{c.openPost} ↗</a>
      <p className="bw-post-context">{[handle&&title,post.origin==='external_import'?c.linkedPost:null,b.verificationLabels[post.verification],post.publishedAt===null?c.publishedUnknown:interpolate(c.publishedOn,{date:shortDate(post.publishedAt,locale)}),b.sourceLabels[post.metricsSource],post.measuredAt&&interpolate(c.measuredOn,{date:formatBrandTimestamp(post.measuredAt,locale)!}),post.shares!==null?`${b.shares} ${number(post.shares)}`:null,post.saves!==null?`${b.saves} ${number(post.saves)}`:null].filter(Boolean).join(' · ')}</p>
     </div>
    </li>;})}</ul>:<p className="bw-note">{posts.length?c.noMatch:b.noPosts}</p>}
  </>}
 </section>;
}

export function ReportResult({project,report,b,locale}:{project:BrandProjectDetail;report:BrandReport;b:BrandCopy;locale:string}){
 return <article className="bw-report" data-report-version={report.version}><header className="bw-heading"><div><p className="bw-kicker">{b.performance.reportTitle} · {interpolate(b.reportCount,{number:report.version})}</p><h1>{project.title}</h1><p>{project.organizationName}</p></div><button type="button" className="bw-button bw-no-print" onClick={()=>window.print()}>{b.performance.print}</button></header><p>{b.period}: {formatBrandDate(report.periodStart,locale)} — {formatBrandDate(report.periodEnd,locale)}</p><p className="bw-muted">{b.publishedAt}: {formatBrandTimestamp(report.createdAt,locale)} · {b.performance.reportBasis}</p><p className="bw-note">{b.performance.reportFrozen}</p><p className="bw-prose bw-report-summary">{report.summary}</p><CampaignPerformance project={project} posts={report.snapshot.posts} b={b} locale={locale} frozen/></article>;
}
