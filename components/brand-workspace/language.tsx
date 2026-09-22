'use client';
import {usePathname} from 'next/navigation';
import {useEffect,useState,type FormEvent} from 'react';
export function WorkspaceLanguage({locale,label,compact=false,applyLabel=label}:{locale:string;label:string;compact?:boolean;applyLabel?:string}){
 const pathname=usePathname();
 const [ready,setReady]=useState(false);
 useEffect(()=>setReady(true),[]);
 const preserveLocation=(e:FormEvent<HTMLFormElement>)=>{const input=e.currentTarget.elements.namedItem('next') as HTMLInputElement;input.value=window.location.pathname+window.location.search;};
 if(compact) return <form className="bw-language-select bw-no-print" data-auto-submit={ready} action="/api/workspace-locale" method="post" onSubmit={preserveLocation}>
   <input type="hidden" name="next" value={pathname}/>
   <label>
     <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>
     <span className="sr-only">{label}</span>
     <select name="locale" defaultValue={locale} onChange={e=>e.currentTarget.form?.requestSubmit()}>
       <option value="ko" lang="ko">한국어</option><option value="en" lang="en">English</option>
     </select>
   </label>
   {!ready && <button type="submit" className="bw-language-apply">{applyLabel}</button>}
 </form>;
 return <nav className="bw-language bw-no-print" aria-label={label}>{(['ko','en'] as const).map(value=><form key={value} action="/api/workspace-locale" method="post" onSubmit={preserveLocation}><input type="hidden" name="locale" value={value}/><input type="hidden" name="next" value={pathname}/><button type="submit" aria-current={locale===value?'true':undefined}>{value==='ko'?'한국어':'English'}</button></form>)}</nav>;
}
