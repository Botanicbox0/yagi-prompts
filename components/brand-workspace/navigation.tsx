
'use client';
import { usePathname } from 'next/navigation';
export function WorkspaceNavigation({home,members,settings,library,studio}:{home:string;members:string;settings:string;library:string;studio:string}) {
 const path=usePathname();
 const entries=[['/brand',home,'M3 3h14v14H3z M3 8h14M8 8v9'],['/brand/studio',studio,'M3 4h10v12H3z M13 8l5-3v10l-5-3'],['/brand/library',library,'M3 5h14v12H3z M6 2h8M6 13l3-4 3 3 2-2 3 4'],['/brand/settings',settings,'M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M8 13v4'],['/brand/members',members,'M2 17v-2a6 6 0 0 1 12 0v2M5 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0M16 12v5M14 14h5']] as const;
 return <nav>{entries.map(([href,label,d])=><a key={href} href={href} aria-current={(href==='/brand'?path==='/brand'||path.startsWith('/brand/projects'):path.startsWith(href))?'page':undefined}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={d}/></svg>{label}</a>)}</nav>;
}
