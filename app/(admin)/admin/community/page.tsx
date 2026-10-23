import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { getViewer } from '@/lib/auth/viewer';
import { notFound } from 'next/navigation';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { platformReady } from '@/lib/creator-platform/service';
import { loadApplicationQueue,loadFormatReviewNotes } from '@/lib/creator-platform/onboarding';
import { AdminShell,OpForm,OutcomeBanner,INPUT,BUTTON_PRIMARY } from '@/components/admin/chrome';
import { SocialQueue } from '@/components/admin/social-queue';
import { loadSocialQueue } from '@/lib/influencers/admin';
import { lastSocialWorker } from '@/lib/influencers/worker';
import { loadReviewEntries } from '@/lib/recipes/review';
import { RecipeReviewPanel } from '@/components/recipes/review-panel';
export const dynamic='force-dynamic';
export default async function PlatformAdminPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const [viewer,sql,locale,query]=await Promise.all([getViewer(),getSqlRunner(),getLocaleFromHeaders(),searchParams]);if(!viewer.isAdmin)notFound();
 const dict=getDictionary(locale),c=dict.community;
 // docs/PLATFORM-2.0.md §17.1 — the SNS check sits first and works without the 0051 creator tables.
 const [socialQueue,socialWorker]=sql?await Promise.all([loadSocialQueue(sql).catch(()=>null),lastSocialWorker(sql).catch(()=>null)]):[null,null];
 const social=<SocialQueue copy={dict.social} locale={locale} queue={socialQueue} worker={socialWorker}/>;
 const wrap=(children:ReactNode)=><AdminShell dict={dict.admin} locale={locale} active="community"><div className="space-y-6 p-5 sm:p-8"><h1 className="text-2xl font-semibold">{c.adminTitle}</h1><p className="text-sm opacity-65">{c.adminHint}</p><OutcomeBanner dict={dict.admin} ok={typeof query.ok==='string'?query.ok:undefined} err={typeof query.err==='string'?query.err:undefined}/>{social}{children}</div></AdminShell>;
 if(!sql||!await platformReady(sql))return wrap(<p>{c.unavailable}</p>);
 const [threads,messages,formats,ratings,claims,creators,offers,history]=await Promise.all([
  sql.query<{id:string;user_id:string}>('select id,user_id from platform_threads order by created_at desc limit 40'),
  sql.query<{id:string;thread_id:string;body:string;from_studio:boolean}>('select id,thread_id,body,from_studio from platform_messages where thread_id in (select id from platform_threads order by created_at desc limit 40) order by created_at limit 800'),
  sql.query<{id:string;user_id:string;title:string;recipe:string;example_url:string|null;status:string;template_id:string|null;template_status:string|null}>("select f.id,f.user_id,f.title,f.recipe,f.example_url,f.status,f.template_id,p.status template_status from platform_formats f left join prompt_items p on p.id=f.template_id where f.status<>'draft' order by f.created_at desc limit 40"),
  sql.query<{id:string;template_id:string;stars:number;message:string;excluded:boolean}>('select id,template_id,stars,message,excluded from platform_ratings order by updated_at desc limit 40'),
  sql.query<{id:string;render_id:string;post_url:string;status:string;credits:number}>('select id,render_id,post_url,status,credits from platform_claims order by created_at desc limit 40'),
  sql.query<{user_id:string;active:boolean;contract_version:string}>('select user_id,active,contract_version from platform_creators order by created_at desc limit 100'),
  sql.query<{id:string;title:string;credits:number}>('select o.id,p.title,o.credits from platform_image_offers o join prompt_items p on p.id=o.template_id where o.active order by o.created_at desc limit 100'),
  sql.query<{id:string;actor_id:string|null;action:string;reason:string;created_at:string}>('select id,actor_id,action,reason,created_at from platform_audit order by created_at desc limit 100'),
 ]);
 // Both null/empty on the pre-0051 schema; the page then keeps the older review controls.
 const [applications,notes,recipes]=await Promise.all([loadApplicationQueue(sql),loadFormatReviewNotes(sql,formats.rows.map(f=>f.id)),loadReviewEntries(sql,formats.rows.map(f=>f.id))]);
 const mr=dict.makerRecipe,mediums={video:mr.mediumVideo,image:mr.mediumImage,carousel:mr.mediumCarousel};
 const onboarding=applications!==null,p=dict.creatorProgram;
 const hidden=(name:string,value:string)=><input type="hidden" name={name} value={value}/>;
 const input=(name:string,label:string,type='text',step?:string)=><label className="block text-sm">{label}<input className={`${INPUT} mt-1 min-h-10`} name={name} type={type} step={step} required maxLength={type==='text'?2000:undefined}/></label>;
 const reason=()=>input('reason',c.reason);
 const check=(name:string,label:string)=><label className="flex items-center gap-3 text-sm">{hidden(name,'false')}<input type="checkbox" name={name} value="true"/>{label}</label>;
 const form=(action:string,children:ReactNode,id?:string)=><OpForm op="platform.manage" back="/admin/community" className="space-y-3 rounded-xl border border-hairline p-4">{hidden('action',action)}{id?hidden('id',id):null}{children}{reason()}</OpForm>;
 const submit=(label:string,name?:string,value?:string)=><button className={`${BUTTON_PRIMARY} min-h-10`} name={name} value={value}>{label}</button>;
 const optional=(name:string,label:string,hint:string,rows=3)=><label className="block text-sm">{label}<textarea className={`${INPUT} mt-1`} name={name} maxLength={1000} rows={rows}/><span className="mt-1 block text-xs opacity-60">{hint}</span></label>;
 const when=(value:string)=>new Date(value).toLocaleString(locale==='ko'?'ko-KR':'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'});
 const link=(href:string,label:string)=><a key={href} className="block break-all text-sm underline" href={href} target="_blank" rel="noopener noreferrer nofollow">{label} ↗</a>;
 const applicationCard=(a:NonNullable<typeof applications>['open'][number])=><section key={a.id} data-creator-application={a.id} data-status={a.status} className="space-y-3 rounded-xl border border-hairline p-4">
  <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="break-words font-semibold">{a.displayName}</h3><span className="text-xs opacity-60">{c.applicationStatus[a.status]} · {when(a.createdAt)}</span></div>
  <p className="text-xs opacity-60">{a.mediums.map(m=>c[m as 'image'|'video']).join(' · ')}{a.tools?` · ${c.tools}: ${a.tools}`:''}</p>
  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{a.message}</p>
  <div className="space-y-1">{link(a.portfolioUrl,c.portfolio)}{a.sampleUrls.map((u,i)=>link(u,`${c.samples} ${i+1}`))}</div>
  {a.decisionNote?<p className="whitespace-pre-wrap break-words rounded-lg bg-on-surface/5 p-3 text-sm"><strong>{c.decisionNote}: </strong>{a.decisionNote}</p>:null}
  <p className="break-all text-xs opacity-50">{c.accountId} {a.userId}</p>
  {a.status==='submitted'?form('application',<><label className="block text-sm">{c.contract}<input className={`${INPUT} mt-1 min-h-10`} name="contract" maxLength={120}/><span className="mt-1 block text-xs opacity-60">{c.approveContractHint}</span></label>{optional('note',c.decisionNote,c.decisionNoteHint)}<div className="flex flex-wrap gap-3">{submit(c.decideApprove,'decision','approve')}{submit(c.decideDecline,'decision','decline')}</div></>,a.id):null}
 </section>;
 return wrap(<div data-platform-admin className="grid items-start gap-8 xl:grid-cols-2">
  <div className="space-y-5"><h2 className="text-lg font-semibold">{c.requestTitle}</h2>{threads.rows.map(t=><section key={t.id} className="space-y-3 border-b border-hairline pb-5"><p className="break-all text-xs opacity-60">{t.user_id}</p>{messages.rows.filter(m=>m.thread_id===t.id).map(m=><p key={m.id} className="whitespace-pre-wrap break-words text-sm"><strong>{m.from_studio?c.studio:c.you}: </strong>{m.body}</p>)}{form('reply',<>{hidden('requestId',randomUUID())}<label className="block text-sm">{c.message}<textarea name="message" required maxLength={2000} className={INPUT}/></label>{submit(c.reply)}</>,t.id)}</section>)}
   <h2 className="text-lg font-semibold">{c.formatTitle}</h2>{formats.rows.map(f=><section key={f.id} id={`format-${f.id}`} data-platform-format={f.id} className="scroll-mt-24 space-y-3 rounded-xl border border-hairline p-4"><h3>{f.title}</h3>{f.example_url?<a className="text-sm underline" href={f.example_url} target="_blank" rel="noopener noreferrer">{c.example} ↗</a>:null}{recipes.get(f.id)?<RecipeReviewPanel entry={recipes.get(f.id)!} copy={mr} mediums={mediums} locale={locale} submitted={f.status==='submitted'} acceptLabel={c.accept} rejectLabel={c.reject} reason={reason()} note={onboarding?optional('note',c.formatNote,c.formatNoteHint):null}/>:<details><summary className="cursor-pointer text-sm">{c.recipe}</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs">{f.recipe}</pre></details>}{notes.get(f.id)?<p className="whitespace-pre-wrap break-words rounded-lg bg-on-surface/5 p-3 text-sm"><strong>{c.formatNote}: </strong>{notes.get(f.id)}</p>:null}{f.status==='submitted'&&!recipes.get(f.id)?form('format',<>{onboarding?optional('note',c.formatNote,c.formatNoteHint):null}<div className="flex flex-wrap gap-3">{submit(c.accept,'accept','true')}{submit(c.reject,'accept','false')}</div></>,f.id):null}{f.template_status?<p className="text-sm">{c.templateStatus}: {p.templateState[f.template_status as keyof typeof p.templateState]??f.template_status}</p>:null}{f.template_id?<a href={`/admin/prompts/${f.template_id}`} className="underline">{c.manageTemplate}</a>:null}</section>)}
   <h2 className="text-lg font-semibold">{c.customerRating}</h2>{ratings.rows.map(r=><section key={r.id} className="space-y-3"><p className="text-sm">{r.stars} ★ · {r.template_id}</p><p className="whitespace-pre-wrap text-sm">{r.message}</p>{form('moderate',<>{hidden('excluded',String(!r.excluded))}{r.excluded?hidden('category','restore'):<label className="block text-sm">{c.category}<select name="category" className={INPUT}><option value="duplicate">{c.duplicate}</option><option value="fraud">{c.fraud}</option><option value="abuse">{c.abuse}</option></select></label>}{submit(r.excluded?c.restore:c.exclude)}</>,r.id)}</section>)}
   {form('quality',<>{input('id',c.templateId)}{input('score',c.score,'number','0.1')}{submit(c.quality)}</>)}
  </div>
  <div className="space-y-5"><section id="applications" data-creator-applications className="scroll-mt-24 space-y-4"><h2 className="text-lg font-semibold">{c.applicationsTitle}</h2>{applications===null?<p className="text-sm opacity-65">{c.applicationsUnavailable}</p>:<>{applications.open.length?applications.open.map(applicationCard):<p className="text-sm opacity-65">{c.applicationsEmpty}</p>}{applications.decided.length?<details className="space-y-3 rounded-xl border border-hairline p-4"><summary className="cursor-pointer py-2 font-medium">{c.applicationsDecided}</summary>{applications.decided.map(applicationCard)}</details>:null}</>}</section>
   <h2 className="text-lg font-semibold">{c.inviteTitle}</h2>{form('creator',<>{input('id',c.userId)}{input('contract',c.contract)}<div className="flex flex-wrap gap-3">{submit(c.grant,'active','true')}{submit(c.revoke,'active','false')}</div></>)}{creators.rows.map(u=><p key={u.user_id} className="break-all text-xs">{u.user_id} · {u.active?c.grant:c.revoke} · {u.contract_version}</p>)}
   <h2 className="text-lg font-semibold">{c.claimTitle}</h2>{claims.rows.map(r=><section key={r.id} className="space-y-3 border-b border-hairline pb-5"><a className="block break-all text-sm underline" href={r.post_url} target="_blank" rel="noopener noreferrer">{r.post_url} ↗</a><a href={`/api/admin/community/${r.id}/media`} target="_blank" rel="noopener noreferrer" className="text-xs underline">{r.render_id}</a><p className="text-sm">{c.status[r.status as keyof typeof c.status]} · {r.credits}</p>{r.status==='submitted'||r.status==='approved'?form('claim',<>{check('ownership',c.verifiedOwner)}{check('content',c.verifiedContent)}{check('disclosure',c.verifiedDisclosure)}<div className="flex flex-wrap gap-3">{r.status==='submitted'?<>{submit(c.approve,'decision','approve')}{submit(c.reject,'decision','reject')}</>:submit(c.revokeAward,'decision','revoke')}</div></>,r.id):null}</section>)}
   <details className="space-y-4 rounded-xl border border-hairline p-4"><summary className="cursor-pointer py-2 font-medium">{c.settle}</summary>{form('settle',<>{input('id',c.renderId)}{input('tax',c.tax,'number','1')}{input('fees',c.fees,'number','1')}{input('fx',c.fx,'number','0.000001')}{submit(c.settle)}</>)}</details>
   <details className="space-y-4 rounded-xl border border-hairline p-4"><summary className="cursor-pointer py-2 font-medium">{c.policy}</summary><p className="text-sm opacity-65">{c.policyHint}</p>{form('policy',<>{input('version',c.version)}{input('termsVersion',c.termsVersion)}{input('costPerCredit',c.cost,'number','1')}{input('cap',c.cap,'number','1')}{submit(c.configure)}</>)}</details>
   <details className="space-y-4 rounded-xl border border-hairline p-4"><summary className="cursor-pointer py-2 font-medium">{c.offer}</summary>{form('offer',<>{input('id',c.templateId)}{input('credits',c.credits,'number','1')}{input('maxCost',c.maxCost,'number','1')}{submit(c.offerAdd)}</>)}{offers.rows.map(o=><section key={o.id}><p className="my-3 text-sm">{o.title} · {o.credits}</p>{form('offerDisable',submit(c.offerDisable),o.id)}</section>)}</details>
   <details className="space-y-4 rounded-xl border border-hairline p-4"><summary className="cursor-pointer py-2 font-medium">{c.auditHistory}</summary>{history.rows.length?history.rows.map(h=><section key={h.id} className="space-y-2 border-t border-hairline pt-3 text-xs"><p className="break-all opacity-65">{String(h.created_at)} · {h.actor_id}</p><p>{h.action}</p><p className="whitespace-pre-wrap break-words">{h.reason}</p></section>):<p className="text-sm">{c.auditEmpty}</p>}</details>
  </div>
 </div>);
}
