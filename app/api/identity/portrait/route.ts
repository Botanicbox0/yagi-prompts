import {after,NextResponse} from 'next/server';
import {getViewer} from '@/lib/auth/viewer';
import {isSameOrigin} from '@/lib/billing/toss-runtime';
import {portraitDeps} from '@/lib/identity/portrait-runtime';
import {enqueuePortrait,portraitState,runPortraitPass,selectPortrait} from '@/lib/identity/portrait-service';

export const dynamic='force-dynamic';
export const maxDuration=300;
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'};
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers});
async function context(){const viewer=await getViewer();return {viewer,deps:viewer.userId?await portraitDeps():null};}
export async function GET(){
  const {viewer,deps}=await context();
  if(!viewer.userId)return json({code:'sign_in_required'},401);
  if(!deps)return json({code:'unavailable'},503);
  try{
    const state=await portraitState(deps.sql,viewer.userId);
    if(state.attempts.some(a=>['queued','running','uncertain'].includes(a.status)))after(async()=>{try{await runPortraitPass(deps,viewer.userId!);}catch{/* Durable attempt remains recoverable. */}});
    return json({ok:true,...state,available:deps.provider!==null});
  }catch{return json({code:'unavailable'},503);}
}
export async function POST(request:Request){
  if(!isSameOrigin(request))return json({code:'forbidden'},403);
  const {viewer,deps}=await context();
  if(!viewer.userId)return json({code:'sign_in_required'},401);
  if(!deps)return json({code:'unavailable'},503);
  if(Number(request.headers.get('content-length')??0)>3_100_000)return json({code:'bad_photo'},413);
  try{
    const form=await request.formData(),photo=form.get('photo');
    if(!(photo instanceof File) || photo.size>3_000_000)return json({code:'bad_photo'},400);
    const result=await enqueuePortrait(deps,viewer.userId,{requestId:String(form.get('requestId')??''),consent:form.get('consent')==='yes',bytes:new Uint8Array(await photo.arrayBuffer()),mime:photo.type});
    if(!result.ok)return json(result,result.code==='rate_limited'?429:409);
    after(async()=>{try{await runPortraitPass(deps,viewer.userId!);}catch{/* Redacted; poll can recover saved output. */}});
    return json(result,202);
  }catch{return json({code:'unavailable'},503);}
}
export async function PATCH(request:Request){
  if(!isSameOrigin(request))return json({code:'forbidden'},403);
  const {viewer,deps}=await context();
  if(!viewer.userId)return json({code:'sign_in_required'},401);
  if(!deps)return json({code:'unavailable'},503);
  try{
    const body=await request.json();
    const ok=await selectPortrait(deps.sql,viewer.userId,typeof body.id==='string'?body.id:'',typeof body.expected==='string'?body.expected:null);
    return json({ok,...(!ok?{code:'selection_changed'}:{})},ok?200:409);
  }catch{return json({code:'unavailable'},503);}
}
