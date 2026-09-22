import { createHash,randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import { PORTRAIT_FREE_LIMIT, PORTRAIT_MODEL, PORTRAIT_SEEDREAM_MODEL, PORTRAIT_PROMPT_VERSION, PORTRAIT_SEEDREAM_PROMPT_VERSION } from './portrait-contract';
import { cleanPortraitInput, cleanPortraitResult } from './portrait-images';
import { PortraitProviderError, type PortraitProvider } from './portrait-provider';

export type PortraitStatus='queued'|'running'|'uncertain'|'succeeded'|'failed';
export interface PortraitAttempt {
  id:string;user_id:string;slot:number;status:PortraitStatus;input_key:string;result_key:string|null;
  failure_code:string|null;created_at:Date;started_at:Date|null;model:string;rejected_initial_at:Date|null;
}
export interface PortraitDeps {sql:SqlRunner;store:RenderStore;provider:PortraitProvider|null;seedreamProvider?:PortraitProvider|null;now?:Date}
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
  const active=rows.filter(a=>a.status!=='failed'),pending=counts.reserved>0;
  const pairReady=[1,2].every(slot=>active.some(a=>a.slot===slot&&a.status==='succeeded'));
  const hasInitial=rows.some(a=>a.slot<3);
  const hasRetry=rows.some(a=>a.slot===3),retryReserved=active.some(a=>a.slot===3);
  return {remaining:Math.max(0,PORTRAIT_FREE_LIMIT-counts.used-counts.reserved),used:counts.used,selected,
    canStart:!hasInitial,canRetry:pairReady&&!pending&&!hasRetry,
    canRecover:hasInitial&&!pending&&([1,2].some(slot=>!active.some(a=>a.slot===slot))||(hasRetry&&!retryReserved)),
    retryUsed:hasRetry,pairReady,
    attempts:rows.map(a=>({id:a.id,slot:a.slot,status:a.status,failureCode:a.failure_code,createdAt:a.created_at,
      sourceUrl:`/api/identity/portrait/${a.id}/image?kind=source`,imageUrl:a.status==='succeeded'?`/api/identity/portrait/${a.id}/image`:null}))};
}
export type PortraitState=Awaited<ReturnType<typeof portraitState>>;
type EnqueueResult={ok:true;id:string}|{ok:false;code:string};
/** Account lock + partial unique indexes bound concurrency and lifetime allowance, including retries. */
export async function enqueuePortrait(d:PortraitDeps,userId:string|null,input:{requestId:string;consent:boolean;bytes?:Uint8Array;mime:string;action?:string;rejectInitial?:boolean}):Promise<EnqueueResult>{
  if(!userId) return {ok:false,code:'sign_in_required'};
  const action=input.action??'initial';
  if(!['initial','retry','recover'].includes(action))return {ok:false,code:'bad_action'};
  if(!uuid.test(input.requestId) || (action!=='recover'&&!input.consent)) return {ok:false,code:'consent_required'};
  if(action==='retry'&&!input.rejectInitial)return {ok:false,code:'rejection_required'};
  let bytes:Uint8Array|undefined;
  if(action!=='recover')try{bytes=await cleanPortraitInput(input.bytes??new Uint8Array(),input.mime);}catch{return {ok:false,code:'bad_photo'};}
  const now=clock(d);
  return d.sql.transaction(async sql=>{
    const owner=await sql.query('select id from profiles where id=$1 for update',[userId]);
    if(!owner.rows.length) return {ok:false,code:'sign_in_required'};
    const existing=(await sql.query<{id:string}>('select id from identity_portrait_attempts where user_id=$1 and request_id=$2 order by slot limit 1',[userId,input.requestId])).rows[0];
    if(existing) return {ok:true,id:existing.id};
    const active=(await sql.query<{slot:number;status:PortraitStatus}>("select slot,status from identity_portrait_attempts where user_id=$1 and status<>'failed'",[userId])).rows;
    if(active.some(a=>a.status!=='succeeded')) return {ok:false,code:'in_progress'};
    const history=(await sql.query<PortraitAttempt>('select * from identity_portrait_attempts where user_id=$1 order by created_at,id',[userId])).rows;
    const original=history.find(a=>a.slot<3),previousRetry=history.find(a=>a.slot===3);
    let slots:number[],inputKey:string,rejectedAt:Date|null=null;
    if(action==='initial'){
      if(history.length)return {ok:false,code:'comparison_exists'};
      slots=[1,2];inputKey=`${randomUUID()}/input.png`;
    }else if(action==='retry'){
      if(previousRetry)return {ok:false,code:'exhausted'};
      if(!original||![1,2].every(n=>active.some(a=>a.slot===n&&a.status==='succeeded')))return {ok:false,code:'comparison_incomplete'};
      const source=await d.store.read(original.input_key);
      if(createHash('sha256').update(source).digest('hex')===createHash('sha256').update(bytes!).digest('hex'))return {ok:false,code:'new_photo_required'};
      slots=[3];inputKey=`${randomUUID()}/input.png`;rejectedAt=now;
    }else{
      if(!original)return {ok:false,code:'comparison_incomplete'};
      slots=[1,2].filter(n=>!active.some(a=>a.slot===n));
      if(slots.length)inputKey=original.input_key;
      else if(previousRetry&&!active.some(a=>a.slot===3)){slots=[3];inputKey=previousRetry.input_key;rejectedAt=previousRetry.rejected_initial_at;}
      else return {ok:false,code:'exhausted'};
    }
    if(slots.some(slot=>slot===2?!d.seedreamProvider:!d.provider))return {ok:false,code:'unavailable'};
    const recent=(await sql.query<{n:number}>('select count(*)::int n from identity_portrait_attempts where user_id=$1 and created_at>$2',[userId,new Date(now.getTime()-86400000)])).rows[0]?.n ?? 0;
    if(recent+slots.length>PORTRAIT_DAILY_REQUESTS) return {ok:false,code:'rate_limited'};
    if(bytes)await d.store.put(inputKey,bytes,'image/png');
    const ids:string[]=[];
    for(const slot of slots){
      const id=randomUUID();ids.push(id);
      await sql.query(`insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,consent_at,created_at,rejected_initial_at)
        values($1,$2,$3,$4,'queued',$5,$6,$7,$8,$8,$9)`,[id,userId,input.requestId,slot,slot===2?PORTRAIT_SEEDREAM_MODEL:PORTRAIT_MODEL,slot===2?PORTRAIT_SEEDREAM_PROMPT_VERSION:PORTRAIT_PROMPT_VERSION,inputKey,now,rejectedAt]);
    }
    return {ok:true,id:ids[0]!};
  });
}
/** One provider request per attempt. Unknown delivery never triggers another billed generation. */
export async function runPortraitPass(d:PortraitDeps,userId?:string):Promise<void>{
  // Lost responses remain reserved; never submit a second paid call for an uncertain result.
  await d.sql.query(`update identity_portrait_attempts set status='uncertain',failure_code='uncertain'
    where status='running' and started_at<$1 and ($2::uuid is null or user_id=$2)`,[new Date(clock(d).getTime()-10*60000),userId??null]);
  // A saved result is recoverable even if the transaction recording its success failed.
  const uncertain=(await d.sql.query<PortraitAttempt>("select * from identity_portrait_attempts where status='uncertain' and ($1::uuid is null or user_id=$1) limit 5",[userId??null])).rows;
  for(const a of uncertain){try{await cleanPortraitResult(await d.store.read(`${a.id}/result.png`),a.model);await completePortrait(d,a.id);}catch{/* no output: keep the reservation for explicit operational review */}}
  const claimed=await d.sql.transaction(async sql=>(await sql.query<PortraitAttempt>(`update identity_portrait_attempts set status='running',started_at=$1 where id in (
    select id from identity_portrait_attempts where status='queued' and ($2::uuid is null or user_id=$2) order by created_at,slot for update skip locked limit 2) returning *`,[clock(d),userId??null])).rows);
  await Promise.all(claimed.map(a=>runClaimedPortrait(d,a)));
}
async function runClaimedPortrait(d:PortraitDeps,claimed:PortraitAttempt){
  const provider=claimed.slot===2?d.seedreamProvider:d.provider;
  if(!provider){await d.sql.query("update identity_portrait_attempts set status='queued',started_at=null where id=$1 and status='running'",[claimed.id]);return;}
  let received=false;
  try {
    const input=await d.store.read(claimed.input_key);
    const result=await provider.generate({bytes:input,mime:'image/png'},{userId:claimed.user_id,inputKey:claimed.input_key,attemptId:claimed.id});received=true;
    const clean=await cleanPortraitResult(result,claimed.model);
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
