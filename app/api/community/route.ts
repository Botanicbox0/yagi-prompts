import { after,NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { platformHome,submitPlatform } from '@/lib/creator-platform/service';
import { PlatformError } from '@/lib/creator-platform/contract';
import { createRewardImageJob } from '@/lib/renders/service';
import { getRenderStore } from '@/lib/renders/store';
import { runLiveRenderPass } from '@/lib/renders/runtime';
export const dynamic='force-dynamic';
export const maxDuration=300;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
export async function GET() {
 const viewer=await getViewer();if(!viewer.userId)return json({code:'sign_in_required'},401);
 try {const sql=await getSqlRunner();if(!sql)return json({code:'unavailable'},503);const access=await platformAccess(sql);if(!access.community&&!access.creators&&!access.rewards)return json({code:'not_open'},403);return json({home:await platformHome(sql,viewer),access});}
 catch{return json({code:'unavailable'},503);}
}
export async function POST(request:Request) {
 if(!isSameOrigin(request))return json({code:'forbidden'},403);
 const viewer=await getViewer();if(!viewer.userId)return json({code:'sign_in_required'},401);
 try {
  const bytes=await readBoundedBody(request,28_000);if(!bytes)return json({code:'too_large'},413);
  let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({code:'invalid'},400);}
  const sql=await getSqlRunner();if(!sql)return json({code:'unavailable'},503);
  const access=await platformAccess(sql);if(!access.ready)return json({code:'not_open'},403);
  const image=z.object({action:z.literal('image'),requestId:z.uuid(),offerId:z.uuid(),portraitId:z.uuid()}).strict().safeParse(raw);
  if(image.success) {
   if(!access.rewards)return json({code:'not_open'},403);
   const result=await createRewardImageJob({sql,store:await getRenderStore()},viewer,image.data);
   if(!result.ok)return json(result,409);
   after(async()=>{try{await runLiveRenderPass(sql,{jobId:result.id,limit:1});}catch{/* Durable render remains recoverable; no recipe/error details leave server. */}});
   return json({ok:true,href:`/renders/${result.id}`},201);
  }
  const result=await submitPlatform(sql,viewer,raw,access);
  if(raw&&typeof raw==='object'&&'action' in raw&&raw.action==='rating')revalidateTag('prompts');
  return json({ok:true,...result});
 }catch(error) {
  if(error instanceof PlatformError)return json({code:error.code},error.code==='sign_in_required'?401:error.code==='forbidden'||error.code==='not_open'?403:error.code==='not_found'?404:error.code==='rate_limited'?429:409);
  return json({code:'unavailable'},503);
 }
}
