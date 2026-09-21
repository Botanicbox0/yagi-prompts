'use client';
import {usePathname} from 'next/navigation';
import {setLocaleAction} from '@/app/actions/locale';
export function WorkspaceLanguage({locale,label}:{locale:string;label:string}){
 const pathname=usePathname();
 return <nav className="bw-language bw-no-print" aria-label={label}>{(['ko','en'] as const).map(value=><form key={value} action={setLocaleAction}><input type="hidden" name="locale" value={value}/><input type="hidden" name="next" value={pathname}/><button type="submit" aria-current={locale===value?'true':undefined}>{value==='ko'?'한국어':'English'}</button></form>)}</nav>;
}
