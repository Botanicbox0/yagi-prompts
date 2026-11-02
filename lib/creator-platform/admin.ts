import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { insertPrompt,loadPromptById } from '@/lib/prompts/repo';
import { imageOfferFingerprint } from './offer';
import { demand } from './contract';
import { audit, approvedCreator, lockUser, onboardingReady } from './service';
import { marginSplit, rewardQuote } from './economics';
import { legacyPromptText, parseRecipe, primaryStep } from '@/lib/recipes/schema';
import { centsForKrw, quoteRecipe } from '@/lib/recipes/pricing';
import { parseDisclosure, parsePresentation } from '@/lib/recipes/repo';

const reason=z.string().trim().min(3).max(2000), money=z.number().int().min(0).max(100_000_000);
// Creator-facing text. Empty form fields arrive as '' and mean "no note".
const note=z.string().trim().max(1000).optional();
export const PlatformAdminInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('creator'),id:z.uuid(),active:z.boolean(),contract:z.string().trim().min(1).max(120),reason}).strict(),
 z.object({action:z.literal('reply'),id:z.uuid(),message:z.string().trim().min(1).max(2000),requestId:z.uuid(),reason}).strict(),
 // priceKrw: a recipe (v2) acceptance names the final won price; the floor + royalty is only the proposal.
 z.object({action:z.literal('format'),id:z.uuid(),accept:z.boolean(),note,priceKrw:z.number().int().min(100).max(1_000_000).optional(),reason}).strict(),
 z.object({action:z.literal('application'),id:z.uuid(),decision:z.enum(['approve','decline']),contract:z.string().trim().max(120).optional(),note,reason}).strict(),
 z.object({action:z.literal('moderate'),id:z.uuid(),excluded:z.boolean(),category:z.enum(['duplicate','fraud','abuse','restore']),reason}).strict(),
 z.object({action:z.literal('quality'),id:z.uuid(),score:z.number().min(1).max(5).multipleOf(0.1),reason}).strict(),
 z.object({action:z.literal('settle'),id:z.uuid(),tax:money,fees:money,fx:z.number().positive().max(1_000_000),reason}).strict(),
 z.object({action:z.literal('claim'),id:z.uuid(),decision:z.enum(['approve','reject','revoke']),ownership:z.boolean(),content:z.boolean(),disclosure:z.boolean(),reason}).strict(),
 z.object({action:z.literal('policy'),version:z.string().min(1).max(120),costPerCredit:money.min(1),cap:money.min(1),termsVersion:z.string().min(1).max(120),reason}).strict(),
 z.object({action:z.literal('offer'),id:z.uuid(),credits:money.min(1),maxCost:money.min(1),reason}).strict(),
 z.object({action:z.literal('offerDisable'),id:z.uuid(),reason}).strict(),
]);
export async function administerPlatform(sql:SqlRunner,viewer:Viewer,raw:unknown) {
 demand(viewer.isAdmin&&viewer.userId,'forbidden');
 const parsed=PlatformAdminInput.safeParse(raw);demand(parsed.success);const input=parsed.data;
 return sql.transaction(async tx=>{
  let entityId='id' in input?input.id:randomUUID();
  if(input.action==='creator') {
   await lockUser(tx,input.id);
   await tx.query(`insert into platform_creators(user_id,active,approved_by,contract_version) values($1,$2,$3,$4)
    on conflict(user_id) do update set active=excluded.active,approved_by=excluded.approved_by,contract_version=excluded.contract_version`,[input.id,input.active,viewer.userId,input.contract]);
  } else if(input.action==='reply') {
   demand((await tx.query('select id from platform_threads where id=$1',[input.id])).rows.length,'not_found');
   const old=await tx.query<{thread_id:string}>('select thread_id from platform_messages where id=$1',[input.requestId]);
   if(old.rows.length){demand(old.rows[0]!.thread_id===input.id,'conflict');return {id:input.id};}
   await tx.query('insert into platform_messages(id,thread_id,actor_id,from_studio,body) values($1,$2,$3,true,$4)',[input.requestId,input.id,viewer.userId,input.message]);
  } else if(input.action==='application') {
   demand(await onboardingReady(tx),'not_open');
   const {rows}=await tx.query<{user_id:string;status:string}>('select user_id,status from platform_creator_applications where id=$1 for update',[input.id]);demand(rows.length,'not_found');const row=rows[0]!;
   const decided=input.decision==='approve'?'approved':'declined';
   if(row.status!=='submitted'){demand(row.status===decided,'conflict');return {id:input.id};}
   const text=input.note||null;
   if(input.decision==='approve') {
    demand(input.contract,'invalid');
    await lockUser(tx,row.user_id);
    await tx.query(`insert into platform_creators(user_id,active,approved_by,contract_version) values($1,true,$2,$3)
     on conflict(user_id) do update set active=true,approved_by=excluded.approved_by,contract_version=excluded.contract_version`,[row.user_id,viewer.userId,input.contract]);
   } else demand(text&&text.length>=3,'invalid');
   await tx.query('update platform_creator_applications set status=$2,decision_note=$3,decided_by=$4,decided_at=now() where id=$1',[input.id,decided,text,viewer.userId]);
  } else if(input.action==='format') {
   // to_jsonb: the v2 columns (0059) are read without naming them, so the older schema still answers.
   const {rows}=await tx.query<{user_id:string;title:string;recipe:string;medium:'video'|'image';status:string;template_id:string|null;v2:{recipe_v2?:unknown;title_ko?:string|null;disclosure?:unknown;presentation?:string;royalty_krw?:number|null}}>("select user_id,title,recipe,medium,status,template_id,jsonb_build_object('recipe_v2',to_jsonb(f.*)->'recipe_v2','title_ko',to_jsonb(f.*)->'title_ko','disclosure',to_jsonb(f.*)->'disclosure','presentation',to_jsonb(f.*)->'presentation','royalty_krw',to_jsonb(f.*)->'royalty_krw') v2 from platform_formats f where id=$1 for update",[input.id]);demand(rows.length,'not_found');const row=rows[0]!;
   if(row.status!=='submitted'){demand((input.accept&&row.status==='accepted')||(!input.accept&&row.status==='rejected'),'conflict');return {id:row.template_id??input.id};}
   // A note is never silently discarded: on the older schema it is refused, on 0051 a rejection needs one.
   const text=input.note||null,feedback=await onboardingReady(tx);
   if(!feedback)demand(!text,'not_open');else if(!input.accept)demand(text&&text.length>=3,'invalid');
   if(input.accept) {
    demand(await approvedCreator(tx,row.user_id),'forbidden');
    const templateId=randomUUID();
    // The retired community-prompt path mandates public recipes. This private supplier path uses
    // the studio catalog source and separate supplier attribution; it is never a public prompt submission.
    if(row.v2?.recipe_v2!==null&&row.v2?.recipe_v2!==undefined) await acceptRecipe(tx,templateId,row,input.priceKrw);
    else {demand(input.priceKrw===undefined,'invalid');await insertPrompt(tx,{id:templateId,slug:`format-${templateId}`,source:'yagi',authorId:row.user_id,authorHandle:null,status:'pending',models:[row.medium==='image'?'gpt-image-2':'seedance-2.5'],title:row.title,titleKo:null,promptText:row.recipe,textVisibility:'hidden',media:null,useCase:[],featured:false,medium:row.medium});}
    await tx.query("update platform_formats set status='accepted',template_id=$2 where id=$1",[input.id,templateId]);entityId=templateId;
   } else await tx.query("update platform_formats set status='rejected' where id=$1",[input.id]);
   if(feedback)await tx.query('update platform_formats set review_note=$2,reviewed_at=now() where id=$1',[input.id,text]);
  } else if(input.action==='moderate') {
   demand(input.excluded?input.category!=='restore':input.category==='restore');
   const old=await tx.query<{excluded:boolean}>('select excluded from platform_ratings where id=$1 for update',[input.id]);demand(old.rows.length,'not_found');
   await tx.query('update platform_ratings set excluded=$2 where id=$1',[input.id,input.excluded]);
   await audit(tx,viewer.userId!,input.id,'rating_visibility',input.reason,{before:old.rows[0]!.excluded,after:input.excluded,category:input.category});return {id:input.id};
  } else if(input.action==='quality') {
   await tx.query('insert into platform_quality(template_id,score) values($1,$2) on conflict(template_id) do update set score=excluded.score,updated_at=now()',[input.id,input.score]);
  } else if(input.action==='settle') {
   // Current paid provider is KRW-only. Global currencies need their own verified order adapters.
   const {rows}=await tx.query<{payment_id:string;amount_krw:number;cost_usd:string|null;cost_source:string|null;attempts:number;creator_id:string|null}>(`select p.id payment_id,p.amount_krw,j.cost_usd,j.cost_source,j.attempts,f.user_id creator_id from render_jobs j
    join billing_payments p on p.render_id=j.id left join platform_formats f on f.template_id=j.template_id and f.status='accepted'
    where j.id=$1 and j.status='succeeded' and p.status='paid' and p.environment='live' and p.payment_type='NORMAL' for update of p`,[input.id]);
   demand(rows.length,'not_eligible');const row=rows[0]!;demand(row.cost_source==='provider_usage'&&row.cost_usd!==null&&Number.isFinite(Number(row.cost_usd)),'cost_pending');
   // The render row records the final result's cost, not every possibly billable retry.
   // Keep retry jobs pending until a complete per-attempt invoice adapter exists.
   demand(row.attempts===1,'cost_pending');
   const existing=await tx.query('select render_id from platform_settlements where render_id=$1',[input.id]);demand(!existing.rows.length,'already_settled');
   demand(input.tax+input.fees<=row.amount_krw);
   const cost=Math.ceil(Number(row.cost_usd)*input.fx),split=marginSplit({revenue:row.amount_krw,tax:input.tax,fees:input.fees,providerCost:cost,creator:!!row.creator_id});
   await tx.query(`insert into platform_settlements(render_id,payment_id,creator_id,currency,revenue,tax,fees,provider_cost,fx,margin,creator_due,platform_margin,evidence)
    values($1,$2,$3,'KRW',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[input.id,row.payment_id,row.creator_id,row.amount_krw,input.tax,input.fees,cost,input.fx,split.margin,split.creator,split.platform,input.reason]);
  } else if(input.action==='policy') {
   await tx.query('insert into platform_reward_policy(id,version,cost_per_credit,award_cap,terms_version) values(1,$1,$2,$3,$4)',[input.version,input.costPerCredit,input.cap,input.termsVersion]);
  } else if(input.action==='offer') {
   const policy=await tx.query<{cost_per_credit:number}>('select cost_per_credit from platform_reward_policy where id=1');demand(policy.rows.length,'not_open');
   demand(input.maxCost<=input.credits*policy.rows[0]!.cost_per_credit,'budget_exceeded');
   const template=await tx.query("select id from prompt_items where id=$1 and medium='image' and audience='public' and status='published'",[input.id]);demand(template.rows.length,'not_eligible');
   // No creator royalties can be generated by spending rewards: offer only studio-owned images.
   demand(!(await tx.query('select id from platform_formats where template_id=$1',[input.id])).rows.length,'not_eligible');
   const source=await loadPromptById(tx,input.id);demand(source);
   await tx.query('insert into platform_image_offers(template_id,credits,max_cost,template_fingerprint,active) values($1,$2,$3,$4,true)',[input.id,input.credits,input.maxCost,imageOfferFingerprint(source)]);
  } else if(input.action==='offerDisable') {
   demand((await tx.query('update platform_image_offers set active=false where id=$1 returning id',[input.id])).rows.length,'not_found');
  } else {
   const owner=await tx.query<{user_id:string}>('select user_id from platform_claims where id=$1',[input.id]);demand(owner.rows.length,'not_found');await lockUser(tx,owner.rows[0]!.user_id);
   const {rows}=await tx.query<{user_id:string;render_id:string;status:string;credits:number}>('select user_id,render_id,status,credits from platform_claims where id=$1 for update',[input.id]);const row=rows[0]!;
   if(input.decision==='approve') {
    if(row.status==='approved')return {id:input.id};
    demand(row.status==='submitted','conflict');demand(input.ownership&&input.content&&input.disclosure,'evidence_required');
    const settled=await tx.query<{platform_margin:number}>("select s.platform_margin from platform_settlements s join billing_payments p on p.id=s.payment_id where s.render_id=$1 and p.status='paid' for update of p",[row.render_id]);demand(settled.rows.length,'cost_pending');
    const policy=await tx.query<{version:string;cost_per_credit:number;award_cap:number}>('select version,cost_per_credit,award_cap from platform_reward_policy where id=1');demand(policy.rows.length,'not_open');
    const quote=rewardQuote({platformMargin:settled.rows[0]!.platform_margin,costPerCredit:policy.rows[0]!.cost_per_credit,cap:policy.rows[0]!.award_cap});demand(quote.credits>0,'budget_exceeded');
    await tx.query("insert into platform_credit_ledger(user_id,delta,kind,claim_id,event_key) values($1,$2,'grant',$3,$4)",[row.user_id,quote.credits,input.id,`grant:${input.id}`]);
    await tx.query("update platform_claims set status='approved',credits=$2,policy_version=$3 where id=$1",[input.id,quote.credits,policy.rows[0]!.version]);
   } else if(input.decision==='reject') {
    demand(row.status==='submitted','conflict');await tx.query("update platform_claims set status='rejected' where id=$1",[input.id]);
   } else {
    if(row.status==='revoked')return {id:input.id};demand(row.status==='approved','conflict');
    await revokeClaim(tx,input.id,row.user_id,row.credits);
   }
  }
  // Recipe and customer message bodies are deliberately absent from the audit payload.
  const details=input.action==='creator'?{active:input.active,contract:input.contract}:input.action==='application'?{decision:input.decision,contract:input.decision==='approve'?input.contract:null}:input.action==='quality'?{score:input.score}:{};
  await audit(tx,viewer.userId!,entityId,input.action,input.reason,details);
  return {id:entityId};
 });
}
/**
 * A recipe (v2) becomes a pending studio template: the recipe, the maker's page choices, the
 * studio's final price (never below the cost floor) and the maker as author. Still `pending` and
 * hidden — publishing (media, translation) stays the studio's step in /admin/prompts. The recipe is
 * written before the format links to the row, so 0059's guard freezes it from then on.
 */
async function acceptRecipe(tx:SqlRunner,templateId:string,row:{user_id:string;title:string;v2:{recipe_v2?:unknown;title_ko?:string|null;disclosure?:unknown;presentation?:string;royalty_krw?:number|null}},priceKrw:number|undefined) {
 const checked=parseRecipe(row.v2.recipe_v2);demand(checked.ok,'recipe_invalid');
 const recipe=checked.recipe,primary=primaryStep(recipe),film=recipe.steps.find(step=>step.kind==='video');
 demand(priceKrw!==undefined,'price_required');
 const quote=quoteRecipe(recipe,row.v2.royalty_krw??0);demand(priceKrw>=quote.floorKrw,'price_below_floor');
 await insertPrompt(tx,{id:templateId,slug:`format-${templateId}`,source:'yagi',authorId:row.user_id,authorHandle:null,status:'pending',models:[primary.engine],title:row.title,titleKo:row.v2.title_ko??null,promptText:legacyPromptText(recipe),textVisibility:'hidden',media:null,useCase:[],featured:false,
  medium:primary.kind,engine:primary.engine,aspectDefault:primary.params.aspect,runtimeSeconds:film?.kind==='video'?film.params.duration:null,priceKrw,priceCents:centsForKrw(priceKrw)});
 await tx.query('update prompt_items set recipe=$2::jsonb,disclosure=$3::jsonb,presentation=$4 where id=$1',[templateId,JSON.stringify(recipe),JSON.stringify(parseDisclosure(row.v2.disclosure)),parsePresentation(row.v2.presentation)]);
}
export async function revokeClaim(sql:SqlRunner,id:string,userId:string,credits:number) {
 await sql.query("insert into platform_credit_ledger(user_id,delta,kind,claim_id,event_key) values($1,$2,'revoke',$3,$4) on conflict(event_key) do nothing",[userId,-credits,id,`revoke:${id}`]);
 await sql.query("update platform_claims set status='revoked' where id=$1",[id]);
}
