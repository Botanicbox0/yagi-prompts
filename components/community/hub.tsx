'use client';
import { useRef,useState,type FormEvent } from 'react';
import type { Dictionary } from '@/messages/en';
import type { PlatformHome } from '@/lib/creator-platform/service';

const field='mt-2 min-h-12 w-full rounded-xl border border-hairline bg-transparent px-4 py-3 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-accent';
const button='min-h-12 rounded-full bg-on-surface px-6 py-3 text-sm text-surface disabled:opacity-40';
const panel='space-y-5 rounded-2xl border border-hairline p-5 sm:p-7';
type Access={community:boolean;creators:boolean;rewards:boolean};
/** `creatorDoor` is resolved on the server: the program page for others, the workspace for approved suppliers. */
export function CommunityHub({initial,copy,access,selfieId,initialRender,creatorDoor}:{initial:PlatformHome;copy:Dictionary['community'];access:Access;selfieId:string|null;initialRender:string;creatorDoor?:{href:string;label:string}|null}) {
 const [home,setHome]=useState(initial),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(false);
 const requests=useRef(new Map<string,string>());
 const status=(s:string)=>copy.status[s as keyof typeof copy.status]??s;
 async function send(event:FormEvent<HTMLFormElement>,action:string,extra:Record<string,unknown>={}) {
  event.preventDefault();if(busy)return;const form=event.currentTarget,data=new FormData(form);
  const key=`${action}:${String(extra.threadId??'')}`;let requestId=requests.current.get(key);if(!requestId){requestId=crypto.randomUUID();requests.current.set(key,requestId);}
  const values:Record<string,unknown>={action,...Object.fromEntries(data),...extra};
  if(['request','reply','image'].includes(action))values.requestId=requestId;
  for(const name of ['rights','disclosure','ownership'])if(name in values)values[name]=values[name]==='on';
  if('stars' in values)values.stars=Number(values.stars);
  setBusy(true);setNotice('');
  try {
   const response=await fetch('/api/community',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
   const result=await response.json();if(!response.ok){setError(true);setNotice(copy.errors[result.code as keyof typeof copy.errors]??copy.error);return;}
   requests.current.delete(key);form.reset();setError(false);setNotice(copy.saved);
   if(typeof result.href==='string'&&/^\/renders\/[0-9a-f-]+$/.test(result.href)){window.location.assign(result.href);return;}
   const next=await fetch('/api/community',{cache:'no-store'});if(next.ok)setHome((await next.json()).home);
  }catch{setError(true);setNotice(copy.error);}finally{setBusy(false);}
 }
 const resultPicker=(succeeded=false)=><label className="block text-sm">{copy.result}<select name="renderId" required defaultValue={initialRender} className={field}><option value="">{copy.chooseResult}</option>{home.renders.filter(r=>!succeeded||r.status==='succeeded').map(r=><option key={r.id} value={r.id}>{r.template_slug} · {status(r.status)} · {r.id.slice(0,8)}</option>)}</select></label>;
 return <div data-community-hub className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
  <div className="space-y-8">
   {notice?<p role={error?'alert':'status'} className="rounded-xl border border-hairline p-4 text-sm">{notice}</p>:null}
   {access.community?<>
    <section className={panel}><h2 className="text-xl font-semibold">{copy.requestTitle}</h2><p className="text-sm leading-relaxed opacity-70">{copy.requestHint}</p>
     <form className="space-y-4" onSubmit={e=>void send(e,'request')}>
      <label className="block text-sm">{copy.message}<textarea name="message" required minLength={5} maxLength={2000} rows={4} className={field}/></label>
      <label className="block text-sm">{copy.reference}<input name="reference" type="url" maxLength={2048} className={field}/></label>
      <button disabled={busy} className={button}>{busy?copy.busy:copy.send}</button>
     </form>
    </section>
    {home.threads.length?home.threads.map(t=><section key={t.id} className={panel}>
     <p className="text-xs opacity-60">{status(t.status)}</p>
     {home.messages.filter(m=>m.thread_id===t.id).map(m=><div key={m.id} className={`rounded-xl p-4 ${m.from_studio?'bg-on-surface/5':'border border-hairline'}`}><p className="mb-2 text-xs font-medium opacity-60">{m.from_studio?copy.studio:copy.you}</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p></div>)}
     {t.reference_url?<a href={t.reference_url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm underline">{copy.reference} ↗</a>:null}
     {t.status==='open'?<form className="space-y-3" onSubmit={e=>void send(e,'reply',{threadId:t.id})}><label className="block text-sm">{copy.message}<textarea name="message" required maxLength={2000} className={field}/></label><button disabled={busy} className={button}>{copy.reply}</button></form>:null}
    </section>):<p className="text-sm opacity-65">{copy.empty}</p>}
   </>:null}
   {creatorDoor?<p data-creator-door className="border-t border-hairline pt-5 text-sm"><a href={creatorDoor.href} className="underline underline-offset-4">{creatorDoor.label} →</a></p>:null}
  </div>
  <div className="space-y-8">
   {access.community?<section className={panel}><h2 className="text-xl font-semibold">{copy.ratingTitle}</h2><p className="text-sm leading-relaxed opacity-70">{copy.ratingHint}</p>
    <form className="space-y-4" onSubmit={e=>void send(e,'rating')}>{resultPicker()}
     <fieldset><legend className="text-sm">{copy.stars}</legend><div className="mt-2 flex flex-wrap gap-2">{[1,2,3,4,5].map(n=><label key={n} className="flex min-h-12 items-center gap-2 rounded-lg border border-hairline px-3"><input type="radio" name="stars" value={n} required/><span aria-hidden="true">{n} ★</span><span className="sr-only">{n} / 5</span></label>)}</div></fieldset>
     <label className="block text-sm">{copy.review}<textarea name="message" maxLength={1000} rows={3} className={field}/></label><button disabled={busy||!home.renders.length} className={button}>{copy.rate}</button>
    </form>
   </section>:null}
   {access.rewards?<>
    <section className={panel}><h2 className="text-xl font-semibold">{copy.claimTitle}</h2><p className="text-sm leading-relaxed opacity-70">{copy.claimHint}</p>
     <form className="space-y-4" onSubmit={e=>void send(e,'claim')}>{resultPicker(true)}<label className="block text-sm">{copy.postUrl}<input name="url" type="url" required maxLength={2048} className={field}/></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="ownership" required className="mt-1"/>{copy.ownership}</label><label className="flex items-start gap-3 text-sm"><input type="checkbox" name="disclosure" required className="mt-1"/>{copy.disclosure}</label><button disabled={busy} className={button}>{copy.claim}</button>
     </form>
     {home.claims.map(c=><p key={c.id} className="border-t border-hairline pt-3 text-sm"><a href={c.post_url} target="_blank" rel="noopener noreferrer" className="underline">{status(c.status)} ↗</a>{c.status==='approved'?` · ${c.credits}`:''}</p>)}
     {!home.claims.length?<p className="text-sm opacity-65">{copy.claimEmpty}</p>:null}
    </section>
    <section className={panel}><h2 className="text-xl font-semibold">{copy.balance}</h2><p className="text-4xl font-semibold tabular-nums">{home.balance.toLocaleString()}</p><p className="text-sm leading-relaxed opacity-70">{copy.rewardHint}</p>
     {!selfieId?<p className="text-sm">{copy.selfieRequired} <a className="underline" href="/identity/selfie?next=%2Fcommunity">{copy.selfieLink}</a></p>:null}
     {home.offers.map(o=><form key={o.id} className="space-y-3 border-t border-hairline pt-4" onSubmit={e=>void send(e,'image',{offerId:o.id,selfieId})}><h3>{o.title}</h3><p className="text-sm">{o.credits} · {copy.balance}</p><button disabled={busy||!selfieId||home.balance<o.credits} className={button}>{copy.creditUse}</button></form>)}
    </section>
   </>:null}
  </div>
 </div>;
}
