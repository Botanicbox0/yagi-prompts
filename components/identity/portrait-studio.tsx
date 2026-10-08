'use client';
import {useEffect,useRef,useState} from 'react';
import type {Dictionary} from '@/messages/en';
import type {PortraitState} from '@/lib/identity/portrait-service';
import {shrinkPhoto} from '@/components/twings/studio';
import {PortraitPhotoGuide} from './portrait-photo-guide';

export function PortraitStudio({copy,initial,next,available}:{copy:Dictionary['portrait'];initial:PortraitState;next:string|null;available:boolean}){
 const [state,setState]=useState(initial),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<string|null>(null);
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retryOpen,setRetryOpen]=useState(false);
 const requestId=useRef<string|null>(null),results=useRef<HTMLDivElement>(null),upload=useRef<HTMLDivElement>(null),completedCount=useRef(initial.used);
 const pending=state.attempts.some(a=>['queued','running','uncertain'].includes(a.status));
 const canUpload=state.canStart||(retryOpen&&state.canRetry);
 const latest=(slot:number)=>state.attempts.find(a=>a.slot===slot&&a.status!=='failed')??state.attempts.find(a=>a.slot===slot);
 const source=latest(1)??latest(2);
 const scroll=(element:HTMLElement|null)=>element?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 useEffect(()=>{if(state.used>completedCount.current)scroll(results.current);completedCount.current=state.used;},[state.used]);
 const message=(code?:string)=>code==='bad_photo'?copy.badPhoto:code==='new_photo_required'?copy.newPhotoRequired:code==='rate_limited'?copy.rateLimited:code==='exhausted'?copy.exhausted:code==='selection_changed'?copy.selectionChanged:code==='unavailable'?copy.unavailable:copy.error;
 async function refresh(){const r=await fetch('/api/identity/portrait',{cache:'no-store'});if(r.ok)setState(await r.json());}
 useEffect(()=>{if(!pending)return;const timer=setInterval(()=>{void refresh().catch(()=>{});},6000);return()=>clearInterval(timer);},[pending]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 useEffect(()=>{if(retryOpen)scroll(upload.current);},[retryOpen]);
 async function create(action:'initial'|'retry'|'recover'){
  if(busy||(action!=='recover'&&(!file||!consent)))return;
  setBusy(true);setError('');requestId.current??=crypto.randomUUID();
  try{
   const form=new FormData();form.set('requestId',requestId.current);form.set('action',action);
   if(action!=='recover'){const image=await shrinkPhoto(file!);form.set('photo',image,'selfie');form.set('consent','yes');}
   if(action==='retry')form.set('rejectInitial','yes');
   const r=await fetch('/api/identity/portrait',{method:'POST',body:form}),data=await r.json();
   if(!r.ok){setError(message(data.code));await refresh();return;}
   requestId.current=null;setFile(null);setPreview(null);setConsent(false);setRetryOpen(false);await refresh();
  }catch{setError(copy.error);}finally{setBusy(false);}
 }
 async function select(id:string){
  setBusy(true);setError('');
  try{const r=await fetch('/api/identity/portrait',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,expected:state.selected})});const data=await r.json();if(!r.ok)setError(message(data.code));await refresh();}
  catch{setError(copy.error);}finally{setBusy(false);}
 }
 function candidate(slot:number){
  const a=latest(slot),label=slot===1?copy.optionOne:slot===2?copy.optionTwo:copy.retryResult;
  return <section key={slot} data-portrait-candidate={slot} className="min-w-0 space-y-3">
   <h3 className="text-sm font-medium">{label}</h3>
   <div className="aspect-[2/3] overflow-hidden rounded-xl bg-black/5">
    {a?.imageUrl?<img src={a.imageUrl} alt={label} className="h-full w-full object-contain"/>:<div className="flex h-full items-center justify-center p-4 text-center text-sm leading-relaxed" role="status">{a?.status==='failed'?copy.failed:a?.status==='uncertain'?copy.uncertain:copy.pendingTitle}</div>}
   </div>
   {a?.status==='succeeded'?(state.selected===a.id?<p data-portrait-selected className="flex min-h-12 items-center justify-center rounded-full border-2 border-current px-3 py-2 text-center text-sm font-medium">{copy.selected}</p>:<button data-portrait-result={a.id} type="button" disabled={busy} aria-label={`${label}: ${copy.use}`} onClick={()=>void select(a.id)} className="min-h-12 w-full rounded-full border border-current px-3 py-3 text-sm disabled:opacity-40">{copy.use}</button>):null}
  </section>;
 }
 return <div data-identity-portrait className="mt-8 space-y-8">
  <p className="max-w-xl text-sm leading-relaxed opacity-70">{copy.allowance}</p>
  {!state.canStart?<div ref={results} className="scroll-mt-6 space-y-6">
   <div><h2 className="text-2xl font-semibold">{copy.comparing}</h2><p className="mt-3 text-sm leading-relaxed opacity-70">{copy.compareHint}</p></div>
   {source?<details className="rounded-xl border border-hairline p-4"><summary className="min-h-8 cursor-pointer text-sm">{copy.original}</summary><img src={source.sourceUrl} alt={copy.original} className="mx-auto mt-3 max-h-72 max-w-full rounded-lg object-contain"/></details>:null}
   <div className="grid grid-cols-2 gap-3 sm:gap-6">{candidate(1)}{candidate(2)}</div>
   {latest(3)?<div className="max-w-sm space-y-3 border-t border-hairline pt-6"><details className="rounded-xl border border-hairline p-4"><summary className="min-h-8 cursor-pointer text-sm">{copy.retryOriginal}</summary><img src={latest(3)!.sourceUrl} alt={copy.retryOriginal} className="mx-auto mt-3 max-h-72 max-w-full rounded-lg object-contain"/></details>{candidate(3)}</div>:null}
   {pending?<p role="status" data-portrait-pending className="text-sm leading-relaxed opacity-70">{state.attempts.some(a=>a.status==='uncertain')?copy.uncertain:copy.creating}</p>:null}
   {state.canRecover?<div className="space-y-3 rounded-xl border border-hairline p-5"><p className="text-sm leading-relaxed">{copy.partialFailure}</p><button disabled={busy||!available} onClick={()=>{requestId.current=null;void create('recover')}} className="min-h-12 rounded-full border border-current px-6 py-3 text-sm disabled:opacity-40">{busy?copy.busy:copy.recover}</button></div>:null}
   {state.canRetry&&!retryOpen?<div className="border-t border-hairline pt-6"><button disabled={busy} onClick={()=>{setRetryOpen(true);requestId.current=null;}} className="min-h-12 underline underline-offset-4">{copy.neither}</button><p className="mt-2 text-sm leading-relaxed opacity-70">{copy.retry}</p></div>:null}
   {!pending&&!state.canRetry&&!state.canRecover&&state.retryUsed?<p className="text-sm leading-relaxed opacity-70">{copy.exhausted}</p>:null}
  </div>:null}
  {canUpload?<div ref={upload} className="scroll-mt-6 rounded-2xl border border-hairline p-5 sm:p-7">
   <h2 className="text-xl font-medium">{retryOpen?copy.retryTitle:copy.uploadTitle}</h2>
   <p className="mt-3 max-w-xl text-sm leading-relaxed">{retryOpen?copy.retry:copy.guidance}</p>
   <PortraitPhotoGuide copy={copy}/>
   {!available?<p role="status" className="mt-5">{copy.unavailable}</p>:<>
    <label className="mt-5 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-current p-5 text-center focus-within:ring-2 focus-within:ring-accent">
     {preview?<img src={preview} alt={copy.original} className="max-h-64 max-w-full rounded-lg object-contain"/>:null}
     <span>{copy.choose}</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={copy.choose} className="max-w-full text-sm" disabled={busy} onChange={e=>{const f=e.target.files?.[0]??null;setFile(f);setPreview(f?URL.createObjectURL(f):null);requestId.current=null;setConsent(false);setError('');}}/>
    </label>
    <label className="mt-5 flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)} className="mt-1 size-4 shrink-0"/>{copy.consent}</label>
    <button type="button" disabled={!file||!consent||busy} onClick={()=>void create(retryOpen?'retry':'initial')} className="mt-6 min-h-12 rounded-full bg-on-surface px-7 py-3 text-surface disabled:opacity-40">{busy?copy.busy:retryOpen?copy.retryCreate:copy.create}</button>
    {retryOpen?<button disabled={busy} className="ml-4 min-h-12 text-sm underline underline-offset-4" onClick={()=>setRetryOpen(false)}>{copy.cancelRetry}</button>:null}
   </>}
  </div>:null}
  {error?<p role="alert" className="text-accent">{error}</p>:null}
  <p className="text-sm leading-relaxed opacity-65">{copy.identityNote}</p>
  {next&&state.selected?<a href={next} className="inline-flex min-h-12 items-center rounded-full bg-on-surface px-6 py-3 text-surface">{copy.continue}</a>:null}
 </div>;
}
