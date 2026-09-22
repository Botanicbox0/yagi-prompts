'use client';
import {usePathname} from 'next/navigation';
export function WorkspaceLanguage({locale,label}:{locale:string;label:string}){
 const pathname=usePathname();
 return <nav className="bw-language bw-no-print" aria-label={label}>{(['ko','en'] as const).map(value=><form key={value} action="/api/workspace-locale" method="post" onSubmit={e=>{const input=e.currentTarget.elements.namedItem('next') as HTMLInputElement;input.value=window.location.pathname+window.location.search;}}><input type="hidden" name="locale" value={value}/><input type="hidden" name="next" value={pathname}/><button type="submit" aria-current={locale===value?'true':undefined}>{value==='ko'?'한국어':'English'}</button></form>)}</nav>;
}
