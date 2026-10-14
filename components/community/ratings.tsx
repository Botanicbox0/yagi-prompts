import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { ratingSummary } from '@/lib/creator-platform/service';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import type { Dictionary } from '@/messages/en';
const summary=unstable_cache(async(id:string)=>{const sql=await getSqlRunner();return sql?ratingSummary(sql,id):null;},['platform-ratings-v1',resolveRuntimeMode()],{tags:['prompts'],revalidate:3600});
export async function TemplateRatings({templateId,copy}:{templateId:string;copy:Dictionary['community']}) {
 if(process.env.TWINGS_COMMUNITY!=='on')return null;
 const rating=await summary(templateId);if(!rating)return null;
 return <section data-template-ratings className="my-8 space-y-3 border-y border-hairline py-5"><h2 className="text-sm font-semibold">{copy.customerRating}</h2><p className="text-sm">{rating.average===null?copy.noRatings:`★ ${rating.average.toFixed(1)} / 5 · ${rating.count} ${copy.reviews}`}</p>{rating.count>0?<details className="text-sm"><summary className="cursor-pointer py-2">{copy.distribution}</summary><ul>{rating.distribution.map((n,i)=><li key={i}>{i+1} ★ · {n}</li>)}</ul></details>:null}{rating.studioScore!==null?<p className="text-sm opacity-70">{copy.studioScore} · {rating.studioScore.toFixed(1)} / 5</p>:null}</section>;
}
