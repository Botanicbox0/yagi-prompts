'use client';
import {usePathname,useSearchParams} from 'next/navigation';
import {useCallback,useEffect,useId,useRef,useState,type CSSProperties,type FormEvent,type KeyboardEvent,type Ref} from 'react';

const LANGUAGES=[{value:'ko',name:'한국어'},{value:'en',name:'English'}] as const;
type Language=(typeof LANGUAGES)[number]['value'];

const Globe=()=><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>;
const Check=()=><svg className="bw-language-check" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5 8.5 14.5 15.5 6"/></svg>;

/** Where the menu floats: right of the rail on a wide screen, under the button on a phone (the top bar). */
type MenuAt={top?:number;bottom?:number;left?:number;right?:number};
function menuPlacement(rect:DOMRect):MenuAt{
  if(window.innerWidth<=640) return {top:rect.bottom+8,right:Math.max(8,window.innerWidth-rect.right)};
  return {bottom:Math.max(12,window.innerHeight-rect.bottom),left:rect.right+12};
}

export function WorkspaceLanguage({locale,label,compact=false,applyLabel=label}:{locale:string;label:string;compact?:boolean;applyLabel?:string}){
 // The no-JS form posts this value as is, so it carries the query too (?organizationId= keeps the brand).
 const search=useSearchParams()?.toString()??'';
 const pathname=usePathname()+(search?`?${search}`:'');
 const [ready,setReady]=useState(false);
 useEffect(()=>setReady(true),[]);
 const preserveLocation=(e:FormEvent<HTMLFormElement>)=>{const input=e.currentTarget.elements.namedItem('next') as HTMLInputElement;input.value=window.location.pathname+window.location.search;};
 if(compact) return <CompactLanguage locale={locale} label={label} applyLabel={applyLabel} pathname={pathname} ready={ready} preserveLocation={preserveLocation}/>;
 return <nav className="bw-language bw-no-print" aria-label={label}>{(['ko','en'] as const).map(value=><form key={value} action="/api/workspace-locale" method="post" onSubmit={preserveLocation}><input type="hidden" name="locale" value={value}/><input type="hidden" name="next" value={pathname}/><button type="submit" aria-current={locale===value?'true':undefined}>{value==='ko'?'한국어':'English'}</button></form>)}</nav>;
}

/**
 * The rail's language control (docs/BRAND-STUDIO-V3.md §12). Without JavaScript it is the plain form
 * (a select and a submit button), exactly as before. Once hydrated, in the workspace rail, the form is
 * hidden and a globe button opens a small menu of the two languages; picking one sets the form's value
 * and submits it, so the same POST carries the current path and query. In the other layout modes
 * (a sandboxed brand's sidebar, the topbar) the form stays what it was; the CSS decides (rail.css).
 */
function CompactLanguage({locale,label,applyLabel,pathname,ready,preserveLocation}:{locale:string;label:string;applyLabel:string;pathname:string;ready:boolean;preserveLocation:(e:FormEvent<HTMLFormElement>)=>void}){
 const current=LANGUAGES.find(l=>l.value===locale)??LANGUAGES[0];
 const [at,setAt]=useState<MenuAt|null>(null);
 const form=useRef<HTMLFormElement>(null);
 const select=useRef<HTMLSelectElement>(null);
 const button=useRef<HTMLButtonElement>(null);
 const menu=useRef<HTMLDivElement>(null);
 const menuId=useId();
 const pendingFocus=useRef<'current'|'first'|'last'|null>(null);
 const open=at!==null;
 const items=()=>[...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[])];
 const focusItem=(index:number)=>{items()[index]?.focus();};
 const show=useCallback((focus:'current'|'first'|'last'='current')=>{
  const rect=button.current?.getBoundingClientRect();
  if(!rect)return;
  setAt(menuPlacement(rect));
  pendingFocus.current=focus;
 },[]);
 const close=useCallback((returnFocus:boolean)=>{setAt(null);if(returnFocus)button.current?.focus();},[]);
 useEffect(()=>{
  if(!open)return;
  const want=pendingFocus.current;pendingFocus.current=null;
  const list=items();
  if(want==='first')list[0]?.focus();
  else if(want==='last')list[list.length-1]?.focus();
  else (list.find(i=>i.getAttribute('aria-checked')==='true')??list[0])?.focus();
  const away=(event:PointerEvent)=>{const target=event.target as Node|null;if(target&&(menu.current?.contains(target)||button.current?.contains(target)))return;close(false);};
  const resize=()=>close(false);
  document.addEventListener('pointerdown',away);
  window.addEventListener('resize',resize);
  return()=>{document.removeEventListener('pointerdown',away);window.removeEventListener('resize',resize);};
 },[open,close]);
 const choose=(value:Language)=>{
  setAt(null);
  if(value===locale){button.current?.focus();return;}
  if(select.current)select.current.value=value;
  form.current?.requestSubmit();
 };
 const buttonKeys=(event:KeyboardEvent<HTMLButtonElement>)=>{
  if(event.key==='ArrowDown'){event.preventDefault();show('first');}
  else if(event.key==='ArrowUp'){event.preventDefault();show('last');}
 };
 const menuKeys=(event:KeyboardEvent<HTMLDivElement>)=>{
  const list=items();
  const move=languageMenuKey(event.key,list.indexOf(document.activeElement as HTMLButtonElement),list.length);
  if(move===null)return;
  if(move==='tab'){close(false);return;}
  event.preventDefault();
  if(move==='close'){event.stopPropagation();close(true);return;}
  focusItem(move);
 };
 return <div className="bw-language-menu bw-no-print" data-language-menu data-ready={ready?'true':'false'} data-open={open?'true':undefined}>
  <form ref={form} className="bw-language-select" data-auto-submit={ready} action="/api/workspace-locale" method="post" onSubmit={preserveLocation}>
   <input type="hidden" name="next" value={pathname}/>
   <label>
     <Globe/>
     <span className="sr-only">{label}</span>
     <select ref={select} name="locale" defaultValue={locale} onChange={e=>e.currentTarget.form?.requestSubmit()}>
       <option value="ko" lang="ko">한국어</option><option value="en" lang="en">English</option>
     </select>
   </label>
   {!ready && <button type="submit" className="bw-language-apply">{applyLabel}</button>}
  </form>
  <button ref={button} type="button" className="bw-language-trigger" data-language-trigger aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} aria-label={`${label}: ${current.name}`} title={label} tabIndex={ready?undefined:-1} onClick={()=>open?close(false):show()} onKeyDown={buttonKeys}>
   <Globe/>
   <span className="bw-language-current" lang={current.value}>{current.name}</span>
  </button>
  {open?<LanguageMenu ref={menu} id={menuId} locale={locale} label={label} style={at??undefined} onKeyDown={menuKeys} onChoose={choose}/>:null}
 </div>;
}

/** The open menu: one radio row per language, the current one checked. Kept apart so it renders on its own. */
export function LanguageMenu({ref,id,locale,label,style,onKeyDown,onChoose}:{ref?:Ref<HTMLDivElement>;id?:string;locale:string;label:string;style?:CSSProperties;onKeyDown?:(event:KeyboardEvent<HTMLDivElement>)=>void;onChoose:(value:Language)=>void}){
 return <div ref={ref} id={id} role="menu" aria-label={label} className="bw-language-popover" data-language-popover style={style} onKeyDown={onKeyDown}>
  <p className="bw-language-popover-title" aria-hidden="true">{label}</p>
  {LANGUAGES.map(l=><button key={l.value} type="button" role="menuitemradio" aria-checked={l.value===locale} lang={l.value} data-language-option={l.value} tabIndex={-1} onClick={()=>onChoose(l.value)}>
   <span>{l.name}</span>{l.value===locale?<Check/>:null}
  </button>)}
 </div>;
}

/**
 * What a key does inside the open menu: the index to focus (arrows wrap, Home/End jump), `close`
 * (Escape: close and give focus back to the button), `tab` (close and let focus move on), or null.
 */
export function languageMenuKey(key:string,index:number,count:number):number|'close'|'tab'|null{
 if(count<=0)return key==='Escape'?'close':null;
 if(key==='ArrowDown')return (index+1+count)%count;
 if(key==='ArrowUp')return index<0?count-1:(index-1+count)%count;
 if(key==='Home')return 0;
 if(key==='End')return count-1;
 if(key==='Escape')return 'close';
 if(key==='Tab')return 'tab';
 return null;
}
