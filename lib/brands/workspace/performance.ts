import type {BrandPost} from './types';
type Count={total:number|null;measured:number};
export type Ranking='views'|'engagement';
export function postEngagement(post:BrandPost):number|null{return post.likes===null||post.comments===null?null:post.likes+post.comments;}
function sum(values:Array<number|null>):Count{const known=values.filter((n):n is number=>n!==null);return {total:known.length?known.reduce((a,b)=>a+b,0):null,measured:known.length};}
/**
 * Counts are latest observations per post. Never infer unique people or fill missing data with zero.
 * A view count read from a publicly rounded display ("12.3K") stays in the sum but makes the views
 * total, and any rate using those views, approximate: `viewsApproximate` counts the posts involved.
 */
export function campaignPerformance(posts:readonly BrandPost[]){
 const complete=posts.filter(p=>postEngagement(p)!==null&&p.views!==null&&p.views>0);
 const denominator=complete.reduce((n,p)=>n+p.views!,0);
 const times=posts.flatMap(p=>p.measuredAt&&Number.isFinite(Date.parse(p.measuredAt))?[p.measuredAt]:[]).sort((a,b)=>Date.parse(a)-Date.parse(b));
 return {totalPosts:posts.length,views:sum(posts.map(p=>p.views)),likes:sum(posts.map(p=>p.likes)),comments:sum(posts.map(p=>p.comments)),shares:sum(posts.map(p=>p.shares)),saves:sum(posts.map(p=>p.saves)),engagement:sum(posts.map(postEngagement)),
  viewsApproximate:posts.filter(p=>p.views!==null&&p.viewsApproximate).length,
  engagementRate:denominator?complete.reduce((n,p)=>n+postEngagement(p)!,0)/denominator*100:null,ratePosts:complete.length,engagementRateApproximate:complete.some(p=>p.viewsApproximate),
  firstMeasuredAt:times[0]??null,lastMeasuredAt:times.at(-1)??null};
}
export function rankCampaignPosts(posts:readonly BrandPost[],ranking:Ranking):BrandPost[]{
 const value=(p:BrandPost)=>ranking==='views'?p.views:postEngagement(p);
 return posts.filter(p=>value(p)!==null).slice().sort((a,b)=>value(b)!-value(a)!||a.id.localeCompare(b.id));
}
/** Quoted cells are still formulas in spreadsheets unless dangerous prefixes are neutralized. */
export function csvCell(value:unknown):string{
 let text=value==null?'':String(value);if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
/** Title of the approved content behind a post; linked existing posts have none. */
export function postContentTitle(post:BrandPost,titles:Record<string,string>):string|undefined{return post.contentVersionId?titles[post.contentVersionId]:undefined;}
/** The platform's own post id from the normalized link, so several linked posts stay distinguishable. */
export function postShortId(url:string):string{try{const u=new URL(url);return u.searchParams.get('v')??u.pathname.split('/').filter(Boolean).at(-1)??'';}catch{return '';}}
/** Newest first; an unknown publish time sorts last instead of being given a guessed date. */
export function byLatestPublished(a:BrandPost,z:BrandPost):number{
 if(a.publishedAt===null||z.publishedAt===null)return Number(a.publishedAt===null)-Number(z.publishedAt===null)||a.id.localeCompare(z.id);
 return Date.parse(z.publishedAt)-Date.parse(a.publishedAt);
}
export function campaignCsv(posts:readonly BrandPost[],titles:Record<string,string>,headers:string[]):string{
 const rows=posts.map(p=>[p.id,postContentTitle(p,titles)??'',p.platform,p.url,p.publishedAt,p.views,p.likes,p.comments,p.shares,p.saves,p.metricsSource,p.measuredAt,p.origin,p.viewsApproximate]);
 return '\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
