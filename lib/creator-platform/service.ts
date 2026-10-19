import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { PlatformInput, demand, type RatingSummary } from './contract';
import { canonicalPost } from './social';

export async function platformReady(sql:SqlRunner):Promise<boolean> {
  const {rows}=await sql.query<{ready:boolean}>(`select to_regclass('public.platform_redemptions') is not null as ready`);
  return rows[0]?.ready===true;
}
/** 0050 is applied separately from 0046. Every caller must keep working on the older schema. */
export async function onboardingReady(sql:SqlRunner):Promise<boolean> {
  const {rows}=await sql.query<{ready:boolean}>(`select to_regclass('public.platform_creator_applications') is not null
    and (select count(*) from pg_attribute where attrelid=to_regclass('public.platform_formats') and attname in ('review_note','reviewed_at','revision_of') and not attisdropped)=3 as ready`);
  return rows[0]?.ready===true;
}
export async function lockUser(sql:SqlRunner,userId:string) {
  const {rows}=await sql.query('select id from profiles where id=$1 for update',[userId]);
  demand(rows.length,'not_found');
}
export async function audit(sql:SqlRunner,actorId:string,entityId:string,action:string,reason:string,details:unknown={}) {
  demand(reason.trim().length>=3 && reason.length<=2000);
  await sql.query('insert into platform_audit(actor_id,entity_id,action,reason,details) values($1,$2,$3,$4,$5::jsonb)',[actorId,entityId,action,reason,JSON.stringify(details)]);
}
export async function approvedCreator(sql:SqlRunner,userId:string) {
  return (await sql.query('select user_id from platform_creators where user_id=$1 and active',[userId])).rows.length>0;
}
async function quota(sql:SqlRunner,userId:string) {
  const {rows}=await sql.query<{n:number}>(`select count(*)::int n from platform_messages where actor_id=$1 and created_at>now()-interval '1 hour'`,[userId]);
  demand(rows[0]!.n<20,'rate_limited');
}
/** Flags are resolved by the server route, never accepted from JSON. Domain enforces ownership again. */
export async function submitPlatform(sql:SqlRunner,viewer:Viewer,raw:unknown,access:{community:boolean;creators:boolean;rewards:boolean}) {
  demand(viewer.userId,'sign_in_required');
  const parsed=PlatformInput.safeParse(raw);demand(parsed.success);
  const input=parsed.data;
  demand(input.action==='format'?access.creators:input.action==='claim'?access.rewards:access.community,'not_open');
  return sql.transaction(async tx=>{
    await lockUser(tx,viewer.userId!);
    const rate=await tx.query(`insert into platform_rate_limits(user_id,window_start,hits) values($1,date_trunc('hour',now()),1)
      on conflict(user_id,window_start) do update set hits=platform_rate_limits.hits+1 where platform_rate_limits.hits<60 returning hits`,[viewer.userId]);
    demand(rate.rows.length,'rate_limited');
    await tx.query("delete from platform_rate_limits where user_id=$1 and window_start<now()-interval '2 hours'",[viewer.userId]);
    if(input.action==='request') {
      const old=await tx.query<{user_id:string}>('select user_id from platform_threads where id=$1',[input.requestId]);
      if(old.rows.length) {demand(old.rows[0]!.user_id===viewer.userId,'not_found');return {id:input.requestId};}
      await quota(tx,viewer.userId!);
      const ref=input.reference?canonicalPost(input.reference):null;demand(!input.reference||ref);
      await tx.query('insert into platform_threads(id,user_id,reference_url) values($1,$2,$3)',[input.requestId,viewer.userId,ref?.url??null]);
      await tx.query('insert into platform_messages(id,thread_id,actor_id,body) values($1,$1,$2,$3)',[input.requestId,viewer.userId,input.message]);
      return {id:input.requestId};
    }
    if(input.action==='reply') {
      const own=await tx.query('select id from platform_threads where id=$1 and user_id=$2 and status=\'open\' for update',[input.threadId,viewer.userId]);demand(own.rows.length,'not_found');
      const old=await tx.query<{thread_id:string;actor_id:string}>('select thread_id,actor_id from platform_messages where id=$1',[input.requestId]);
      if(old.rows.length) {demand(old.rows[0]!.thread_id===input.threadId&&old.rows[0]!.actor_id===viewer.userId,'conflict');return {id:input.threadId};}
      await quota(tx,viewer.userId!);
      await tx.query('insert into platform_messages(id,thread_id,actor_id,body) values($1,$2,$3,$4)',[input.requestId,input.threadId,viewer.userId,input.message]);return {id:input.threadId};
    }
    if(input.action==='format') {
      demand(await approvedCreator(tx,viewer.userId!),'forbidden');
      const old=await tx.query<{user_id:string}>('select user_id from platform_formats where id=$1',[input.requestId]);
      if(old.rows.length) {demand(old.rows[0]!.user_id===viewer.userId,'not_found');return {id:input.requestId};}
      const count=await tx.query<{n:number}>("select count(*)::int n from platform_formats where user_id=$1 and created_at>now()-interval '1 day'",[viewer.userId]);demand(count.rows[0]!.n<3,'rate_limited');
      const example=canonicalPost(input.example);demand(example);
      if(input.revisionOf) {
        // Only the owner's own rejected submission can be revised; accepted recipes need a new review plan.
        demand(await onboardingReady(tx),'not_open');
        demand((await tx.query("select id from platform_formats where id=$1 and user_id=$2 and status='rejected'",[input.revisionOf,viewer.userId])).rows.length,'not_found');
        await tx.query('insert into platform_formats(id,user_id,title,recipe,example_url,medium,revision_of) values($1,$2,$3,$4,$5,$6,$7)',[input.requestId,viewer.userId,input.title,input.recipe,example.url,input.medium,input.revisionOf]);
      } else await tx.query('insert into platform_formats(id,user_id,title,recipe,example_url,medium) values($1,$2,$3,$4,$5,$6)',[input.requestId,viewer.userId,input.title,input.recipe,example.url,input.medium]);
      return {id:input.requestId};
    }
    const render=await tx.query<{template_id:string;status:string}>("select template_id,status from render_jobs where id=$1 and user_id=$2 and status in ('succeeded','failed')",[input.renderId,viewer.userId]);demand(render.rows.length,'not_found');
    const job=render.rows[0]!;
    if(input.action==='rating') {
      demand(!viewer.isAdmin,'forbidden');
      const self=await tx.query('select id from platform_formats where template_id=$1 and user_id=$2',[job.template_id,viewer.userId]);demand(!self.rows.length,'forbidden');
      // Edits do not unhide a moderated rating; only a reasoned admin restoration can do that.
      await tx.query(`insert into platform_ratings(user_id,template_id,render_id,stars,message) values($1,$2,$3,$4,$5)
        on conflict(user_id,template_id) do update set render_id=excluded.render_id,stars=excluded.stars,message=excluded.message,updated_at=now()`,[viewer.userId,job.template_id,input.renderId,input.stars,input.message]);
      return {id:input.renderId};
    }
    demand(job.status==='succeeded'&&!viewer.isAdmin,'not_eligible');
    const paid=await tx.query(`select id from billing_payments where render_id=$1 and user_id=$2 and status='paid' and payment_type='NORMAL' and environment='live'`,[input.renderId,viewer.userId]);demand(paid.rows.length,'not_eligible');
    const post=canonicalPost(input.url);demand(post);
    const old=await tx.query<{id:string;user_id:string;post_key:string;render_id:string}>('select id,user_id,post_key,render_id from platform_claims where render_id=$1 or post_key=$2',[input.renderId,post.key]);
    if(old.rows.length) {demand(old.rows.length===1&&old.rows[0]!.user_id===viewer.userId&&old.rows[0]!.post_key===post.key&&old.rows[0]!.render_id===input.renderId,'already_claimed');return {id:old.rows[0]!.id};}
    const id=randomUUID();
    await tx.query('insert into platform_claims(id,user_id,render_id,post_key,post_url) values($1,$2,$3,$4,$5)',[id,viewer.userId,input.renderId,post.key,post.url]);return {id};
  });
}
export async function ratingSummary(sql:SqlRunner,templateId:string):Promise<RatingSummary> {
  if(!await platformReady(sql)) return {count:0,average:null,distribution:[0,0,0,0,0],studioScore:null};
  const {rows}=await sql.query<{stars:number;n:number}>(`select r.stars,count(*)::int n from platform_ratings r join profiles p on p.id=r.user_id
    where r.template_id=$1 and not r.excluded and not p.is_admin
    and not exists(select 1 from platform_formats f where f.template_id=r.template_id and f.user_id=r.user_id)
    group by r.stars`,[templateId]);
  const distribution=[0,0,0,0,0];for(const row of rows)distribution[row.stars-1]=row.n;
  const count=distribution.reduce((a,b)=>a+b,0),sum=distribution.reduce((a,b,i)=>a+b*(i+1),0);
  const qa=await sql.query<{score:string}>('select score from platform_quality where template_id=$1',[templateId]);
  return {count,average:count?sum/count:null,distribution,studioScore:qa.rows[0]?Number(qa.rows[0]!.score):null};
}
export async function platformHome(sql:SqlRunner,viewer:Viewer) {
  demand(viewer.userId,'sign_in_required');
  const threads=await sql.query<{id:string;status:string;reference_url:string|null;created_at:string}>(`select id,status,reference_url,created_at from platform_threads where user_id=$1 order by created_at desc limit 30`,[viewer.userId]);
  const messages=await sql.query<{id:string;thread_id:string;body:string;from_studio:boolean;created_at:string}>(`select m.id,m.thread_id,m.body,m.from_studio,m.created_at from platform_messages m join platform_threads t on t.id=m.thread_id where t.user_id=$1 and t.id=any($2::uuid[]) order by m.created_at limit 600`,[viewer.userId,threads.rows.map(t=>t.id)]);
  // Explicit projections: never return recipe, costs, email, storage keys, payment keys or other users.
  const formats=await sql.query<{id:string;title:string;status:string;template_id:string|null}>('select id,title,status,template_id from platform_formats where user_id=$1 order by created_at desc limit 30',[viewer.userId]);
  const claims=await sql.query<{id:string;post_url:string;status:string;credits:number}>('select id,post_url,status,credits from platform_claims where user_id=$1 order by created_at desc limit 30',[viewer.userId]);
  const balance=await sql.query<{balance:string}>('select coalesce(sum(delta),0) balance from platform_credit_ledger where user_id=$1',[viewer.userId]);
  const renders=await sql.query<{id:string;template_slug:string;status:string}>("select id,template_slug,status from render_jobs where user_id=$1 and status in ('succeeded','failed') order by created_at desc limit 30",[viewer.userId]);
  const offers=await sql.query<{id:string;title:string;credits:number}>("select o.id,p.title,o.credits from platform_image_offers o join prompt_items p on p.id=o.template_id where o.active and p.status='published' and p.medium='image' and p.audience='public' order by o.created_at desc limit 30");
  const royalties=await sql.query<{currency:string;amount:string}>(`select s.currency,sum(s.creator_due)::text amount from platform_settlements s join billing_payments p on p.id=s.payment_id where s.creator_id=$1 and p.status='paid' group by s.currency`,[viewer.userId]);
  return {threads:threads.rows,messages:messages.rows,formats:formats.rows,claims:claims.rows,balance:Number(balance.rows[0]!.balance),renders:renders.rows,offers:offers.rows,royalties:royalties.rows,creator:await approvedCreator(sql,viewer.userId)};
}
export type PlatformHome=Awaited<ReturnType<typeof platformHome>>;
