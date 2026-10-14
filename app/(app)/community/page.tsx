import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { AppHeader } from '@/components/app/app-header';
import { CommunityHub } from '@/components/community/hub';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { platformHome } from '@/lib/creator-platform/service';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function CommunityPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const [viewer,sql,locale,query]=await Promise.all([getViewer(),getSqlRunner(),getLocaleFromHeaders(),searchParams]);
 const dict=getDictionary(locale),copy=dict.community;
 if(!viewer.userId)redirect(`/auth/choose?next=%2Fcommunity&locale=${locale}`);
 const access=sql?await platformAccess(sql):{ready:false,community:false,creators:false,rewards:false};
 const available=access.community||access.creators||access.rewards;
 const home=available&&sql?await platformHome(sql,viewer):null;
 const portraitId=home&&sql?(await sql.query<{attempt_id:string}>('select attempt_id from identity_portrait_selections where user_id=$1',[viewer.userId])).rows[0]?.attempt_id??null:null;
 return <div data-section data-theme="light" className="section min-h-screen"><AppHeader locale={locale} dict={dict} rest="/community"/><main id="main" className="band py-12 lg:py-16"><h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{copy.title}</h1><p className="mt-5 max-w-2xl text-base leading-relaxed opacity-65">{copy.intro}</p>{home?<CommunityHub initial={home} copy={copy} access={access} portraitId={portraitId} initialRender={typeof query.render==='string'?query.render:''}/>:<p role="status" className="mt-10">{copy.unavailable}</p>}</main></div>;
}
