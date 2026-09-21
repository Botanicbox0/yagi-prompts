import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import { PORTRAIT_FREE_LIMIT, PORTRAIT_MODEL, PORTRAIT_PROMPT_VERSION } from './portrait-contract';
import { cleanPortraitInput, cleanPortraitResult } from './portrait-images';
import { PortraitProviderError, type PortraitProvider } from './portrait-provider';

export type PortraitStatus='queued'|'running'|'uncertain'|'succeeded'|'failed';
export interface PortraitAttempt {
  id:string;user_id:string;slot:number;status:PortraitStatus;input_key:string;result_key:string|null;
  failure_code:string|null;created_at:Date;started_at:Date|null;
}
export interface PortraitDeps {sql:SqlRunner;store:RenderStore;provider:PortraitProvider|null;now?:Date}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clock=(d:{now?:Date})=>d.now??new Date();
export const PORTRAIT_DAILY_REQUESTS=6;
export async function ownPortrait(sql:SqlRunner,userId:string,id:string):Promise<PortraitAttempt|null>{
  if(!uuid.test(id)) return null;
  return (await sql.query<PortraitAttempt>('select * from identity_portrait_attempts where user_id=$1 and id=$2',[userId,id])).rows[0]??null;
}
export async function portraitState(sql:SqlRunner,userId:string){
  const {rows}=await sql.query<PortraitAttempt>(`select * from identity_portrait_attempts where user_id=$1 and
    (status='succeeded' or id in (select id from identity_portrait_attempts where user_id=$1 order by created_at desc,id desc limit 10)) order by created_at desc,id desc`,[userId]);
  const selected=(await sql.query<{attempt_id:string}>('select attempt_id from identity_portrait_selections where user_id=$1',[userId])).rows[0]?.attempt_id??null;
  // Compute the lifetime total independently of the bounded display history.
  const counts=(await sql.query<{used:number;reserved:number}>(`select count(*) filter(where status='succeeded')::int used,
    count(*) filter(where status in ('queued','running','uncertain'))::int reserved from identity_portrait_attempts where user_id=$1`,[userId])).rows[0] ?? {used:0,reserved:0};
  return {remaining:Math.max(0,PORTRAIT_FREE_LIMIT-counts.used-counts.reserved),used:counts.used,selected,
    attempts:rows.map(a=>({id:a.id,status:a.status,failureCode:a.failure_code,createdAt:a.created_at,
      sourceUrl:`/api/identity/portrait/${a.id}/image?kind=source`,imageUrl:a.status==='succeeded'?`/api/identity/portrait/${a.id}/image`:null}))};
}
export type PortraitState=Awaited<ReturnType<typeof portraitState>>;
type EnqueueResult={ok:true;id:string}|{ok:false;code:string};
/** Account lock + partial unique indexes bound concurrency and lifetime allowance, including retries. */
export async function enqueuePortrait(d:PortraitDeps,userId:string|null,input:{requestId:string;consent:boolean;bytes:Uint8Array;mime:string}):Promise<EnqueueResult>{
  if(!userId) return {ok:false,code:'sign_in_required'};
  if(!uuid.test(input.requestId) || !input.consent) return {ok:false,code:'consent_required'};
  if(!d.provider) return {ok:false,code:'unavailable'};
  let bytes:Uint8Array;
  try{bytes=await cleanPortraitInput(input.bytes,input.mime);}catch{return {ok:false,code:'bad_photo'};}
  const now=clock(d);
  return d.sql.transaction(async sql=>{
    const owner=await sql.query('select id from profiles where id=$1 for update',[userId]);
    if(!owner.rows.length) return {ok:false,code:'sign_in_required'};
    const existing=(await sql.query<{id:string}>('select id from identity_portrait_attempts where user_id=$1 and request_id=$2',[userId,input.requestId])).rows[0];
    if(existing) return {ok:true,id:existing.id};
    const active=(await sql.query<{slot:number;status:PortraitStatus}>("select slot,status from identity_portrait_attempts where user_id=$1 and status<>'failed'",[userId])).rows;
    if(active.some(a=>a.status!=='succeeded')) return {ok:false,code:'in_progress'};
    if(active.length>=PORTRAIT_FREE_LIMIT) return {ok:false,code:'exhausted'};
    const recent=(await sql.query<{n:number}>('select count(*)::int n from identity_portrait_attempts where user_id=$1 and created_at>$2',[userId,new Date(now.getTime()-86400000)])).rows[0]?.n ?? 0;
    if(recent>=PORTRAIT_DAILY_REQUESTS) return {ok:false,code:'rate_limited'};
    const id=randomUUID(),inputKey=`${id}/input.png`;
    await d.store.put(inputKey,bytes,'image/png');
    const slot=[1,2].find(n=>!active.some(a=>a.slot===n))!;
    await sql.query(`insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,consent_at,created_at)
      values($1,$2,$3,$4,'queued',$5,$6,$7,$8,$8)`,[id,userId,input.requestId,slot,PORTRAIT_MODEL,PORTRAIT_PROMPT_VERSION,inputKey,now]);
    return {ok:true,id};
  });
}
/** One provider request per attempt. Unknown delivery never triggers another billed generation. */
export async function runPortraitPass(d:PortraitDeps,userId?:string):Promise<void>{
  // Lost responses remain reserved; the user is never charged a third successful free portrait.
  await d.sql.query(`update identity_portrait_attempts set status='uncertain',failure_code='uncertain'
    where status='running' and started_at<$1 and ($2::uuid is null or user_id=$2)`,[new Date(clock(d).getTime()-10*60000),userId??null]);
  // A saved result is recoverable even if the transaction recording its success failed.
  const uncertain=(await d.sql.query<PortraitAttempt>("select * from identity_portrait_attempts where status='uncertain' and ($1::uuid is null or user_id=$1) limit 5",[userId??null])).rows;
  for(const a of uncertain){try{await cleanPortraitResult(await d.store.read(`${a.id}/result.png`));await completePortrait(d,a.id);}catch{/* no output: keep the reservation for explicit operational review */}}
  if(!d.provider) return;
  const claimed=await d.sql.transaction(async sql=>(await sql.query<PortraitAttempt>(`update identity_portrait_attempts set status='running',started_at=$1 where id=(
    select id from identity_portrait_attempts where status='queued' and ($2::uuid is null or user_id=$2) order by created_at for update skip locked limit 1) returning *`,[clock(d),userId??null])).rows[0]);
  if(!claimed) return;
  let received=false;
  try {
    const input=await d.store.read(claimed.input_key);
    const result=await d.provider.generate({bytes:input,mime:'image/png'});received=true;
    const clean=await cleanPortraitResult(result);
    await d.store.put(`${claimed.id}/result.png`,clean,'image/png');
    await completePortrait(d,claimed.id);
  }catch(error){
    const code=error instanceof PortraitProviderError?error.code:received?'uncertain':'provider_failed';
    // Invalid output is definitive and releases the allowance. Storage/commit errors are ambiguous.
    const invalid=error instanceof Error && error.message==='invalid_result';
    const failure=invalid?'provider_failed':code;
    await d.sql.query("update identity_portrait_attempts set status=$2,failure_code=$3 where id=$1 and status in ('running','uncertain')",[claimed.id,failure==='uncertain'?'uncertain':'failed',failure]);
  }
}
async function completePortrait(d:PortraitDeps,id:string){
  await d.sql.query("update identity_portrait_attempts set status='succeeded',result_key=$2,completed_at=$3,failure_code=null where id=$1 and status in ('running','uncertain')",[id,`${id}/result.png`,clock(d)]);
}
export async function selectPortrait(sql:SqlRunner,userId:string,id:string,expected:string|null):Promise<boolean>{
  if(!uuid.test(id)) return false;
  return sql.transaction(async tx=>{
    await tx.query('select id from profiles where id=$1 for update',[userId]);
    const a=await ownPortrait(tx,userId,id);
    if(a?.status!=='succeeded' || !a.result_key) return false;
    const current=(await tx.query<{attempt_id:string}>('select attempt_id from identity_portrait_selections where user_id=$1',[userId])).rows[0]?.attempt_id??null;
    if(current===id) return true;
    if(current!==expected) return false;
    await tx.query(`insert into identity_portrait_selections(user_id,attempt_id) values($1,$2)
      on conflict(user_id) do update set attempt_id=excluded.attempt_id,updated_at=now()`,[userId,id]);
    return true;
  });
}
/** Owner-bound immutable version. Render/payment creation copies bytes, so later selection cannot alter a paid job. */
export async function selectedPortraitPhoto(sql:SqlRunner,store:RenderStore,userId:string,id:string){
  const row=(await sql.query<{result_key:string}>(`select a.result_key from identity_portrait_attempts a join identity_portrait_selections s on s.user_id=a.user_id and s.attempt_id=a.id
    where a.user_id=$1 and a.id=$2 and a.status='succeeded'`,[userId,uuid.test(id)?id:null])).rows[0];
  return row?{bytes:await store.read(row.result_key),mime:'image/png'}:null;
}
