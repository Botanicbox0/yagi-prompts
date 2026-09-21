'use client';

import {useEffect,useRef,useState} from 'react';
import type {Dictionary} from '@/messages/en';
import type {PortraitState} from '@/lib/identity/portrait-service';
import {shrinkPhoto} from '@/components/twings/studio';
import {PortraitPhotoGuide} from './portrait-photo-guide';

export function PortraitStudio({copy,initial,next,available}:{copy:Dictionary['portrait'];initial:PortraitState;next:string|null;available:boolean}){
  const [state,setState]=useState(initial),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<string|null>(null);
  const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const requestId=useRef<string|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const results=useRef<HTMLDivElement>(null);
  const completedCount=useRef(initial.used);
  useEffect(()=>{if(state.used>completedCount.current)results.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});completedCount.current=state.used;},[state.used]);
  const pending=state.attempts.some(a=>['queued','running','uncertain'].includes(a.status));
  const message=(code?:string)=>code==='bad_photo'?copy.badPhoto:code==='rate_limited'?copy.rateLimited:code==='exhausted'?copy.exhausted:code==='selection_changed'?copy.selectionChanged:copy.error;
  async function refresh(){const r=await fetch('/api/identity/portrait',{cache:'no-store'});if(r.ok){const data=await r.json();setState(data);}}
  useEffect(()=>{if(!pending)return;const timer=setInterval(()=>{void refresh().catch(()=>{});},6000);return()=>clearInterval(timer);},[pending]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  async function create(){
    if(!file || !consent || busy)return;
    setBusy(true);setError('');requestId.current??=crypto.randomUUID();
    try{
      const image=await shrinkPhoto(file);const form=new FormData();form.set('photo',image,'selfie');form.set('consent','yes');form.set('requestId',requestId.current);
      const r=await fetch('/api/identity/portrait',{method:'POST',body:form});const data=await r.json();
      if(!r.ok){setError(message(data.code));return;}
      requestId.current=null;setFile(null);setPreview(null);setConsent(false);await refresh();
    }catch{setError(copy.error);}finally{setBusy(false);}
  }
  async function select(id:string){
    setBusy(true);setError('');
    try{const r=await fetch('/api/identity/portrait',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,expected:state.selected})});const data=await r.json();if(!r.ok)setError(message(data.code));await refresh();}
    catch{setError(copy.error);}finally{setBusy(false);}
  }
  return <div data-identity-portrait className="mt-8 space-y-10">
    <div className="rounded-2xl border border-hairline p-5 sm:p-7">
      <p className="text-lg font-medium" data-portrait-remaining={state.remaining}>{pending?copy.pendingTitle:state.remaining===0?copy.remainingNone:state.remaining===1?copy.remainingOne:copy.remaining.replace('{count}',String(state.remaining))}</p>
      <p className="mt-2 text-sm opacity-65">{copy.allowance}</p>
      {!available?<p role="status" className="mt-5">{copy.unavailable}</p>:!pending && state.remaining>0?<>
        <p className="mt-6 max-w-xl leading-relaxed">{copy.guidance}</p>
        <PortraitPhotoGuide copy={copy}/>
        <label className="mt-5 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-current p-6 text-center focus-within:ring-2 focus-within:ring-accent">
          {preview?<img src={preview} alt={copy.original} className="max-h-64 max-w-full rounded-lg object-contain"/>:null}
          <span>{copy.choose}</span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={copy.choose} className="max-w-full text-sm" disabled={busy} onChange={e=>{const f=e.target.files?.[0]??null;setFile(f);setPreview(f?URL.createObjectURL(f):null);requestId.current=null;setConsent(false);setError('');}}/>
        </label>
        <label className="mt-5 flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)} className="mt-1 size-4 shrink-0"/>{copy.consent}</label>
        <button type="button" disabled={!file||!consent||busy} onClick={()=>void create()} className="mt-6 min-h-12 rounded-full bg-on-surface px-7 py-3 text-surface disabled:opacity-40">{busy?copy.busy:copy.create}</button>
        {state.used>0?<p className="mt-4 text-sm opacity-65">{copy.retry}</p>:null}
      </>:!pending?<p className="mt-5">{copy.exhausted}</p>:null}
      {pending?<p role="status" className="mt-5" data-portrait-pending>{state.attempts.some(a=>a.status==='uncertain')?copy.uncertain:copy.creating}</p>:null}
      {error?<p role="alert" className="mt-5 text-accent">{error}</p>:null}
    </div>
    <div ref={results} className="space-y-6 scroll-mt-6">{state.attempts.filter(a=>a.status==='succeeded').map(a=><section key={a.id} data-portrait-result={a.id} className="rounded-2xl border border-hairline p-5 sm:p-7">
      <h2 className="text-xl font-medium">{copy.comparing}</h2>
      <p className="mt-2 text-sm opacity-65">{copy.compareHint}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-6">{[[copy.original,a.sourceUrl],[copy.result,a.imageUrl!]].map(([label,src])=><figure key={src}><div className="aspect-[2/3] overflow-hidden rounded-xl bg-black/5"><img src={src} alt={label} className="h-full w-full object-contain"/></div><figcaption className="mt-2 text-sm opacity-65">{label}</figcaption></figure>)}</div>
      {state.selected===a.id?<p className="mt-5 font-medium" data-portrait-selected>{copy.selected}</p>:<button type="button" disabled={busy} onClick={()=>void select(a.id)} className="mt-5 min-h-12 rounded-full border border-current px-6 py-3 disabled:opacity-40">{copy.use}</button>}
      {state.remaining>0 && !pending?<button type="button" disabled={busy} className="mt-3 block min-h-12 underline underline-offset-4" onClick={()=>{fileInput.current?.scrollIntoView({block:'center'});fileInput.current?.click();}}>{copy.retryAction}</button>:null}
    </section>)}</div>
    {state.attempts[0]?.status==='failed'?<p role="status">{copy.failed}</p>:null}
    <p className="text-sm opacity-65">{copy.identityNote}</p>
    {next && state.selected?<a href={next} className="inline-flex min-h-12 items-center rounded-full bg-on-surface px-6 py-3 text-surface">{copy.continue}</a>:null}
  </div>;
}
