import type { AdminOperation } from './operations';
import { administerPlatform,PlatformAdminInput } from '@/lib/creator-platform/admin';
import { PlatformError } from '@/lib/creator-platform/contract';
import { ok,fail } from './context';
import { PlatformReviewInput,startReviewRenders,studioReviewFaces } from '@/lib/recipes/review';
import { getRenderStore } from '@/lib/renders/store';
import { siteUrl } from '@/lib/seo/site-url';
const operation:AdminOperation={
 parse(form){
  const input:Record<string,unknown>={};
  const numbers=new Set(['score','tax','fees','fx','costPerCredit','cap','credits','maxCost','priceKrw']);
  const booleans=new Set(['active','accept','excluded','ownership','content','disclosure']);
  // An empty optional price (a rejection, or a v1 format) is absent, not 0.
  for(const [key,value] of form)if(!key.startsWith('_')&&!(key==='priceKrw'&&value==='')&&!(key==='payout'&&value===''))input[key]=numbers.has(key)?Number(value):booleans.has(key)?value==='true':value;
  const parsed=PlatformAdminInput.safeParse(input);
  return parsed.success?{ok:true,value:parsed.data}:{ok:false,detail:'invalid platform input'};
 },
 async run(ctx,input){
  try{const result=await administerPlatform(ctx.sql,ctx.viewer,input);ctx.revalidatePrompts?.();return ok('saved',{to:'/admin/community',detail:result.id});}
  catch(error){if(error instanceof PlatformError)return fail(error.code==='forbidden'?'forbidden':error.code==='not_found'?'notFound':'invalid',error.code);return fail('unknown');}
 }
};
/** `platform.review` — three review renders of a submitted recipe (lib/recipes/review.ts). */
const review:AdminOperation<PlatformReviewInput>={
 parse(form){
  const input:Record<string,unknown>={};
  for(const [key,value] of form)if(!key.startsWith('_'))input[key]=value;
  const parsed=PlatformReviewInput.safeParse(input);
  return parsed.success?{ok:true,value:parsed.data}:{ok:false,detail:'invalid review input'};
 },
 async run(ctx,input){
  try{
   const store=await getRenderStore(),origin=ctx.mail?.siteUrl??siteUrl();
   const fetchGuide=async(path:string)=>{try{const response=await fetch(new URL(path,origin));return response.ok?new Uint8Array(await response.arrayBuffer()):null;}catch{return null;}};
   const result=await startReviewRenders({sql:ctx.sql,store,faces:()=>studioReviewFaces(ctx.sql,store,ctx.viewer.userId!,fetchGuide)},ctx.viewer,input);
   // The renders run after the redirect; the queue page shows each one as it finishes.
   // Imported here: the live pass is server-only and the registry is also loaded by tests.
   ctx.defer?.(async()=>{const {runLiveRenderPass}=await import('@/lib/renders/runtime');for(const id of result.renderIds){try{await runLiveRenderPass(ctx.sql,{jobId:id,limit:1});}catch{/* The queued job stays recoverable by the next pass. */}}});
   return ok('saved',{to:`/admin/community#format-${input.id}`,detail:String(result.renderIds.length)});
  }catch(error){if(error instanceof PlatformError)return fail(error.code==='forbidden'?'forbidden':error.code==='not_found'?'notFound':'invalid',error.code);return fail('unknown');}
 }
};
export const PLATFORM_OPERATIONS={'platform.manage':operation,'platform.review':review};
