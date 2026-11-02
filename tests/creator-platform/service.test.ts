import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { promptHarness,type PromptHarness } from '@/tests/helpers/prompts';
import { ADMIN_VIEWER,viewerOf } from '@/tests/helpers/admin';
import { ANON_VIEWER } from '@/lib/auth/identity';
import { submitPlatform,platformHome,ratingSummary } from '@/lib/creator-platform/service';
import { administerPlatform } from '@/lib/creator-platform/admin';
import { reserveRewardImage,reconcileRewards } from '@/lib/creator-platform/rewards';
import { insertRenderJob } from '@/lib/renders/repo';

const user=viewerOf('free'),other=viewerOf('pro'),access={community:true,creators:true,rewards:true};
describe('private creator platform against PostgreSQL',()=>{
 let h:PromptHarness,templateId:string,renderId:string;
 beforeAll(async()=>{
  h=await promptHarness();
  templateId=(await h.sql.query<{id:string}>("select id from prompt_items where slug='neon-alley-dolly'")).rows[0]!.id;
  renderId=await render(templateId,'video');
 });
 afterAll(async()=>{await h?.close();});
 async function render(template:string,medium:'image'|'video') {
  const id=randomUUID();await insertRenderJob(h.sql,{id,userId:user.userId!,templateId:template,templateSlug:'neon-alley-dolly',medium,engine:medium==='image'?'gpt-image-2':'seedance-2.0',aspect:'9:16',locale:'ko',inputKey:null,inputMime:null});
  await h.sql.query("update render_jobs set status='succeeded',attempts=1,cost_usd=1,cost_source='provider_usage',result_key='test/result.png',result_mime='image/png',share_token=id::text,share_expires_at=now()+interval '1 day',finished_at=now() where id=$1",[id]);return id;
 }
 it('enforces auth, closed flags, strict properties, private conversations and replay',async()=>{
  const input={action:'request',requestId:randomUUID(),message:'A rainy city portrait please',reference:''};
  await expect(submitPlatform(h.sql,ANON_VIEWER,input,access)).rejects.toThrow('sign_in_required');
  await expect(submitPlatform(h.sql,user,input,{...access,community:false})).rejects.toThrow('not_open');
  await expect(submitPlatform(h.sql,user,{...input,isAdmin:true},access)).rejects.toThrow('invalid');
  await submitPlatform(h.sql,user,input,access);await submitPlatform(h.sql,user,input,access);
  expect((await platformHome(h.sql,user)).threads).toHaveLength(1);
  expect((await platformHome(h.sql,other)).threads).toHaveLength(0);
  await expect(submitPlatform(h.sql,other,{action:'reply',threadId:input.requestId,requestId:randomUUID(),message:'hijack'},access)).rejects.toThrow('not_found');
  const reply={action:'reply',id:input.requestId,requestId:randomUUID(),message:'We can explore this format.',reason:'Studio follow-up'};
  await administerPlatform(h.sql,ADMIN_VIEWER,reply);await administerPlatform(h.sql,ADMIN_VIEWER,reply);
  expect((await platformHome(h.sql,user)).messages).toHaveLength(2);
 });
 it('rates actual terminal results, prevents self rating and audits exclusions without changing stars',async()=>{
  await expect(submitPlatform(h.sql,other,{action:'rating',renderId,stars:5,message:''},access)).rejects.toThrow('not_found');
  await submitPlatform(h.sql,user,{action:'rating',renderId,stars:1,message:'The face changed'},access);
  await submitPlatform(h.sql,user,{action:'rating',renderId,stars:2,message:'Updated review'},access);
  expect(await ratingSummary(h.sql,templateId)).toMatchObject({count:1,average:2});
  const id=(await h.sql.query<{id:string}>('select id from platform_ratings')).rows[0]!.id;
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'moderate',id,excluded:true,category:'fraud',reason:'Verified duplicate account evidence'});
  await submitPlatform(h.sql,user,{action:'rating',renderId,stars:5,message:''},access);
  expect((await ratingSummary(h.sql,templateId)).count).toBe(0);
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'moderate',id,excluded:false,category:'restore',reason:'Appeal verified'});
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'quality',id:templateId,score:3.5,reason:'Studio test matrix v1'});
  expect(await ratingSummary(h.sql,templateId)).toMatchObject({count:1,average:5,studioScore:3.5});
 });
 it('gives approved suppliers a private review queue, never automatic publication',async()=>{
  const input={action:'format',requestId:randomUUID(),title:'Supplier format',recipe:'PRIVATE_RECIPE_CANARY_abc123_never_serialize',example:'https://instagram.com/reel/xyz123/',medium:'image',rights:true};
  await expect(submitPlatform(h.sql,user,input,access)).rejects.toThrow('forbidden');
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'creator',id:user.userId,active:true,contract:'pilot-v1',reason:'Owner-approved invitation'});
  await submitPlatform(h.sql,user,input,access);
  expect(JSON.stringify(await platformHome(h.sql,user))).not.toContain('PRIVATE_RECIPE');
  const accepted=await administerPlatform(h.sql,ADMIN_VIEWER,{action:'format',id:input.requestId,accept:true,reason:'Reviewed private format'});
  expect((await h.sql.query<{status:string}>('select status from prompt_items where id=$1',[accepted.id])).rows[0]!.status).toBe('pending');
  await expect(h.sql.query("update prompt_items set text_visibility='public' where id=$1",[accepted.id])).rejects.toThrow('platform private format contract');
  await expect(h.sql.query('update prompt_items set author_id=$2 where id=$1',[accepted.id,other.userId])).rejects.toThrow('platform private format contract');
  const own=await render(accepted.id,'image');
  await expect(submitPlatform(h.sql,user,{action:'rating',renderId:own,stars:5,message:''},access)).rejects.toThrow('forbidden');
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'creator',id:user.userId,active:false,contract:'pilot-v1',reason:'Permission revoked'});
  await expect(submitPlatform(h.sql,user,{...input,requestId:randomUUID()},access)).rejects.toThrow('forbidden');
 });
 it('awards within real margin once, serializes competing image spends, releases failures once, reverses refunded awards',async()=>{
  const paymentId=randomUUID();
  await h.sql.query(`insert into billing_payments(id,user_id,environment,amount_krw,status,payment_key,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,render_id,consent_at,approved_at,expires_at)
   values($1,$2,'live',10000,'paid',$3,$4,'neon-alley-dolly','test','9:16','ko',$5,'private/input.jpg','image/jpeg',$5,now(),now(),now()+interval '1 day')`,[paymentId,user.userId,`test-payment-${paymentId}`,templateId,renderId]);
  const claim=await submitPlatform(h.sql,user,{action:'claim',renderId,url:'https://instagram.com/reel/reward123/',ownership:true,disclosure:true},access);
  const approval={action:'claim',id:claim.id,decision:'approve',ownership:true,content:true,disclosure:true,reason:'Post account, content and disclosure verified'};
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,approval)).rejects.toThrow('cost_pending');
  const settlement={action:'settle',id:renderId,tax:900,fees:300,fx:1000,reason:'Actual provider invoice and PG fee evidence'};
  await h.sql.query('update render_jobs set attempts=2 where id=$1',[renderId]);
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,settlement)).rejects.toThrow('cost_pending');
  await h.sql.query('update render_jobs set attempts=1 where id=$1',[renderId]);
  // The 7-day defect window after delivery has to pass first.
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,settlement)).rejects.toThrow('settle_too_early');
  await h.sql.query("update render_jobs set finished_at=now()-interval '8 days' where id=$1",[renderId]);
  await administerPlatform(h.sql,ADMIN_VIEWER,settlement);
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'policy',version:'test-v1',costPerCredit:1000,cap:100,termsVersion:'test-terms',reason:'Test only approved terms'});
  await administerPlatform(h.sql,ADMIN_VIEWER,approval);await administerPlatform(h.sql,ADMIN_VIEWER,approval);
  expect((await platformHome(h.sql,user)).balance).toBe(7);
  const imageId=(await h.sql.query<{id:string}>("select id from prompt_items where medium='image' and status='published' limit 1")).rows[0]!.id;
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'offer',id:imageId,credits:5,maxCost:4000,reason:'Measured image API upper cost'});
  const offerId=(await h.sql.query<{id:string}>('select id from platform_image_offers')).rows[0]!.id;
  const selfieId=randomUUID(),requestId=randomUUID();
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,{action:'offer',id:templateId,credits:5,maxCost:4000,reason:'A video cannot be a reward'})).rejects.toThrow('not_eligible');
  const before=await h.sql.query<{prompt_text:string}>('select prompt_text from prompt_items where id=$1',[imageId]);
  await h.sql.query("update prompt_items set prompt_text=prompt_text || ' changed' where id=$1",[imageId]);
  await expect(reserveRewardImage(h.sql,user,{requestId,offerId,selfieId},async()=>({ok:true,id:randomUUID()}))).rejects.toThrow('conflict');
  await h.sql.query('update prompt_items set prompt_text=$2 where id=$1',[imageId,before.rows[0]!.prompt_text]);
  expect(await reserveRewardImage(h.sql,user,{requestId,offerId,selfieId},async()=>({ok:false}))).toEqual({ok:false});
  await expect(reserveRewardImage(h.sql,user,{requestId,offerId,selfieId},async()=>{throw new Error('insertion failed');})).rejects.toThrow('insertion failed');
  expect((await platformHome(h.sql,user)).balance).toBe(7);
  let createdId='';
  const create=async(tx:typeof h.sql)=>{createdId=randomUUID();await insertRenderJob(tx,{id:createdId,userId:user.userId!,templateId:imageId,templateSlug:'test',medium:'image',engine:'gpt-image-2',aspect:'4:5',locale:'ko',inputKey:null,inputMime:null});return {ok:true,id:createdId};};
  const outcomes=await Promise.allSettled([reserveRewardImage(h.sql,user,{requestId,offerId,selfieId},create),reserveRewardImage(h.sql,user,{requestId:randomUUID(),offerId,selfieId},create)]);
  expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect((await platformHome(h.sql,user)).balance).toBe(2);
  await expect(reserveRewardImage(h.sql,other,{requestId,offerId,selfieId},create)).rejects.toThrow('conflict');
  await h.sql.query("update render_jobs set status='failed',error_code='engine_error' where id=$1",[createdId]);
  await reconcileRewards(h.sql);await reconcileRewards(h.sql);
  expect((await platformHome(h.sql,user)).balance).toBe(7);
  await h.sql.query("update billing_payments set status='refunded',refunded_at=now() where id=$1",[paymentId]);
  await reconcileRewards(h.sql);await reconcileRewards(h.sql);
  expect((await platformHome(h.sql,user)).balance).toBe(0);
  await expect(h.sql.query('update platform_credit_ledger set delta=999')).rejects.toThrow('immutable');
 });
 it('keeps a company creative’s whole margin and splits an external one 80/20',async()=>{
  const formatTemplate=(await h.sql.query<{template_id:string}>("select template_id from platform_formats where user_id=$1 and status='accepted'",[user.userId])).rows[0]!.template_id;
  async function settleSale() {
   const id=await render(formatTemplate,'image'),paymentId=randomUUID();
   await h.sql.query("update render_jobs set finished_at=now()-interval '8 days' where id=$1",[id]);
   await h.sql.query(`insert into billing_payments(id,user_id,environment,amount_krw,status,payment_key,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,render_id,consent_at,approved_at,expires_at)
    values($1,$2,'live',10000,'paid',$3,$4,'neon-alley-dolly','test','9:16','ko',$5,'private/input.jpg','image/jpeg',$5,now(),now(),now()+interval '1 day')`,[paymentId,other.userId,`test-payment-${paymentId}`,formatTemplate,id]);
   await administerPlatform(h.sql,ADMIN_VIEWER,{action:'settle',id,tax:909,fees:340,fx:1000,reason:'Actual provider invoice and PG fee evidence'});
   return (await h.sql.query<{creator_due:number;platform_margin:number;margin:number}>('select creator_due,platform_margin,margin from platform_settlements where render_id=$1',[id])).rows[0]!;
  }
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'creator',id:user.userId,active:true,contract:'studio-v1',payout:'company',reason:'Studio-owned promotional profile'});
  const company=await settleSale();
  expect(company.margin).toBeGreaterThan(0);
  expect(company).toMatchObject({creator_due:0,platform_margin:company.margin});
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'creator',id:user.userId,active:true,contract:'pilot-v1',payout:'external',reason:'Outside creative under contract'});
  const external=await settleSale();
  expect(external.creator_due).toBe(Math.floor(external.margin*0.8));
  // Leaving payout out keeps whatever was set.
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'creator',id:user.userId,active:false,contract:'pilot-v1',reason:'Permission revoked'});
  expect((await h.sql.query<{payout:string}>('select payout from platform_creators where user_id=$1',[user.userId])).rows[0]!.payout).toBe('external');
 });
 it('rejects non-admin mutations even if domain service called directly',async()=>{
  await expect(administerPlatform(h.sql,user,{action:'quality',id:templateId,score:5,reason:'Fake'})).rejects.toThrow('forbidden');
 });
});
