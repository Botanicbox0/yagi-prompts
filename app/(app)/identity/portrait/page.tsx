import {redirect} from 'next/navigation';
import {getViewer} from '@/lib/auth/viewer';
import {getDictionary} from '@/lib/i18n/dictionaries';
import {getLocaleFromHeaders} from '@/lib/i18n/server';
import {portraitDeps} from '@/lib/identity/portrait-runtime';
import {portraitState} from '@/lib/identity/portrait-service';
import {safeNextPath} from '@/lib/identity/links';
import {PortraitStudio} from '@/components/identity/portrait-studio';
import {TwingsLogo} from '@/components/brand/twings-mark';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function PortraitPage({searchParams}:{searchParams:Promise<{next?:string}>}){
  const viewer=await getViewer();if(!viewer.userId)redirect('/auth/choose?next=%2Fidentity%2Fportrait');
  const locale=await getLocaleFromHeaders(),copy=getDictionary(locale).portrait;
  const next=safeNextPath((await searchParams).next);
  const deps=await portraitDeps();
  let state=null;try{if(deps)state=await portraitState(deps.sql,viewer.userId);}catch{/* Missing cloud migration keeps this closed. */}
  return <main id="main" className="mx-auto min-h-screen max-w-3xl px-5 py-8 sm:px-8" data-section data-theme="light">
    <header className="flex items-center justify-between border-b border-hairline pb-6"><a href={`/${locale}`}><TwingsLogo size={22}/></a><a href="/account" className="text-sm underline underline-offset-4">{copy.back}</a></header>
    <h1 className="mt-12 text-3xl font-semibold leading-tight sm:text-4xl">{copy.title}</h1><p className="mt-4 max-w-xl text-lg leading-relaxed opacity-75">{copy.intro}</p>
    {state?<PortraitStudio copy={copy} initial={state} next={next} available={!!deps?.provider}/>:<p role="status" className="mt-8 rounded-xl border border-hairline p-6">{copy.unavailable}</p>}
  </main>;
}
