import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { demand } from './contract';
import { lockUser, platformReady } from './service';
import { revokeClaim } from './admin';
import { loadPromptById } from '@/lib/prompts/repo';
import { imageOfferFingerprint } from './offer';

/** Run within the same transaction as render insertion; callback never invokes a provider. */
export async function reserveRewardImage<T extends {ok:boolean;id?:string}>(sql:SqlRunner,viewer:Viewer,input:{requestId:string;offerId:string;selfieId:string},create:(tx:SqlRunner,templateId:string)=>Promise<T>):Promise<T|{ok:true;id:string}> {
 demand(viewer.userId,'sign_in_required');
 return sql.transaction(async tx=>{
  await lockUser(tx,viewer.userId!);
  // Reconcile invalid awards BEFORE calculating a spendable balance.
  await revokeRefundedClaims(tx,viewer.userId!);
  const old=await tx.query<{user_id:string;offer_id:string;portrait_id:string;render_id:string}>('select user_id,offer_id,portrait_id,render_id from platform_redemptions where request_id=$1',[input.requestId]);
  if(old.rows.length){const r=old.rows[0]!;demand(r.user_id===viewer.userId&&r.offer_id===input.offerId&&r.portrait_id===input.selfieId,'conflict');return {ok:true,id:r.render_id};}
  const offer=await tx.query<{template_id:string;credits:number;template_fingerprint:string}>(`select o.template_id,o.credits,o.template_fingerprint from platform_image_offers o join prompt_items p on p.id=o.template_id
   where o.id=$1 and o.active and p.medium='image' and p.status='published' and p.audience='public'
   and not exists(select 1 from platform_formats f where f.template_id=p.id) for share of o,p`,[input.offerId]);demand(offer.rows.length,'not_eligible');
  const source=await loadPromptById(tx,offer.rows[0]!.template_id);demand(source&&imageOfferFingerprint(source)===offer.rows[0]!.template_fingerprint,'conflict');
  const balance=await tx.query<{balance:string}>('select coalesce(sum(delta),0) balance from platform_credit_ledger where user_id=$1',[viewer.userId]);demand(Number(balance.rows[0]!.balance)>=offer.rows[0]!.credits,'insufficient_credits');
  const created=await create(tx,offer.rows[0]!.template_id);if(!created.ok)return created;demand(created.id);
  await tx.query('insert into platform_redemptions(request_id,user_id,offer_id,portrait_id,render_id,credits) values($1,$2,$3,$4,$5,$6)',[input.requestId,viewer.userId,input.offerId,input.selfieId,created.id,offer.rows[0]!.credits]);
  await tx.query("insert into platform_credit_ledger(user_id,delta,kind,render_id,event_key) values($1,$2,'reserve',$3,$4)",[viewer.userId,-offer.rows[0]!.credits,created.id,`reserve:${created.id}`]);return created;
 });
}
async function revokeRefundedClaims(sql:SqlRunner,userId:string) {
 const {rows}=await sql.query<{id:string;credits:number}>(`select c.id,c.credits from platform_claims c join platform_settlements s on s.render_id=c.render_id
  join billing_payments p on p.id=s.payment_id where c.user_id=$1 and c.status='approved' and p.status<>'paid' for update of c`,[userId]);
 for(const row of rows) await revokeClaim(sql,row.id,userId,row.credits);
}
/** Terminal reconciliation is retry-safe and continues even while new awards are disabled. */
export async function reconcileRewards(sql:SqlRunner) {
 if(!await platformReady(sql))return;
 const users=await sql.query<{user_id:string}>(`select distinct r.user_id from platform_redemptions r join render_jobs j on j.id=r.render_id where r.state='reserved' and j.status in ('succeeded','failed')
  union select distinct c.user_id from platform_claims c join platform_settlements s on s.render_id=c.render_id join billing_payments p on p.id=s.payment_id where c.status='approved' and p.status<>'paid' limit 100`);
 for(const {user_id} of users.rows) await sql.transaction(async tx=>{
  await lockUser(tx,user_id);await revokeRefundedClaims(tx,user_id);
  const {rows}=await tx.query<{render_id:string;credits:number;status:string}>(`select r.render_id,r.credits,j.status from platform_redemptions r join render_jobs j on j.id=r.render_id
   where r.user_id=$1 and r.state='reserved' and j.status in ('succeeded','failed') for update of r`,[user_id]);
  for(const row of rows) {
   if(row.status==='failed')await tx.query("insert into platform_credit_ledger(user_id,delta,kind,render_id,event_key) values($1,$2,'release',$3,$4) on conflict(event_key) do nothing",[user_id,row.credits,row.render_id,`release:${row.render_id}`]);
   await tx.query('update platform_redemptions set state=$2 where render_id=$1',[row.render_id,row.status==='failed'?'released':'completed']);
  }
 });
}
