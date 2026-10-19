import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { promptHarness,type PromptHarness } from '@/tests/helpers/prompts';
import { ADMIN_VIEWER,viewerOf } from '@/tests/helpers/admin';
import { ANON_VIEWER,type Viewer } from '@/lib/auth/identity';
import { submitPlatform } from '@/lib/creator-platform/service';
import { administerPlatform } from '@/lib/creator-platform/admin';
import { creatorApplicationCount,loadApplicationQueue,loadCreatorWorkspace,loadFormatReviewNotes,portfolioHref,submitCreatorApplication } from '@/lib/creator-platform/onboarding';
import { approvePrompt,rejectPrompt,setPromptArchived,updatePrompt,loadPromptById } from '@/lib/prompts/repo';
import { insertRenderJob } from '@/lib/renders/repo';
import { marginSplit } from '@/lib/creator-platform/economics';

const open={applications:true},ready={onboarding:true};
const all={community:true,creators:true,rewards:false};
const RECIPE='PRIVATE_RECIPE_CANARY_onboarding_never_serialize';
const application=(over:Record<string,unknown>={})=>({requestId:randomUUID(),displayName:'Rain Maker',portfolioUrl:'https://example.com/portfolio#top',
 samples:['https://www.instagram.com/reels/ABC_123/?igsh=tracking',''],mediums:['video'],tools:'Seedance, image models',
 message:'I design rainy city formats and test them on my own channel every week.',rights:true,program:true,...over});
const format=(over:Record<string,unknown>={})=>({action:'format',requestId:randomUUID(),title:'Rain alley walk',recipe:RECIPE,example:'https://instagram.com/reel/rain123/',medium:'video',rights:true,...over});

describe('creator onboarding against PostgreSQL',()=>{
 let h:PromptHarness;const applicant=viewerOf('free'),other=viewerOf('pro');let third:Viewer;
 beforeAll(async()=>{
  h=await promptHarness();
  const id=randomUUID();third={tier:'free',userId:id,email:'third@playbook.test',isAdmin:false,locale:'ko'};
  await h.sql.query('insert into auth.users(id) values($1)',[id]);
  await h.sql.query("insert into profiles(id,email,locale,plan,is_admin) values($1,'third@playbook.test','ko','free',false)",[id]);
 });
 afterAll(async()=>{await h?.close();});
 const age=(userId:string)=>h.sql.query("update platform_creator_applications set created_at=created_at-interval '2 days' where user_id=$1",[userId]);

 it('accepts only https public portfolio hosts and never echoes credentials',()=>{
  expect(portfolioHref('https://example.com/me#x')).toBe('https://example.com/me');
  for(const bad of ['http://example.com','javascript:alert(1)','https://u:p@example.com','https://example.com:8443/','https://127.0.0.1/','https://localhost/','https://intranet/','https://a.local/','https://exa mple.com'])expect(portfolioHref(bad),bad).toBeNull();
 });

 it('refuses anonymous, closed, studio, injected and malformed applications with the field named',async()=>{
  await expect(submitCreatorApplication(h.sql,ANON_VIEWER,application(),open)).rejects.toThrow('sign_in_required');
  await expect(submitCreatorApplication(h.sql,applicant,application(),{applications:false})).rejects.toThrow('not_open');
  await expect(submitCreatorApplication(h.sql,ADMIN_VIEWER,application(),open)).rejects.toThrow('forbidden');
  await expect(submitCreatorApplication(h.sql,applicant,{...application(),status:'approved'},open)).rejects.toThrow('invalid');
  for(const [over,field] of [[{portfolioUrl:'http://example.com'},'portfolioUrl'],[{portfolioUrl:'https://u:p@example.com'},'portfolioUrl'],[{samples:['https://evil.test/p/1']},'samples'],[{samples:['']},'samples'],[{mediums:[]},'mediums'],[{message:'short'},'message'],[{rights:false},'rights'],[{program:false},'program']] as const)
   await expect(submitCreatorApplication(h.sql,applicant,application(over),open)).rejects.toMatchObject({code:'invalid',field});
  expect((await h.sql.query('select id from platform_creator_applications')).rows).toHaveLength(0);
 });

 it('stores one open, normalized application per account and replays a retry',async()=>{
  const input=application();
  await submitCreatorApplication(h.sql,applicant,input,open);
  await submitCreatorApplication(h.sql,applicant,input,open);
  const mine=await loadCreatorWorkspace(h.sql,applicant,ready);
  expect(mine.application).toMatchObject({id:input.requestId,status:'submitted',displayName:'Rain Maker',portfolioUrl:'https://example.com/portfolio',sampleCount:1,mediums:['video'],decisionNote:null});
  expect((await h.sql.query<{sample_urls:string[]}>('select sample_urls from platform_creator_applications')).rows[0]!.sample_urls).toEqual(['https://www.instagram.com/reel/ABC_123/']);
  await expect(submitCreatorApplication(h.sql,applicant,application(),open)).rejects.toThrow('already_open');
  await expect(submitCreatorApplication(h.sql,other,{...application(),requestId:input.requestId},open)).rejects.toThrow('not_found');
  expect((await loadCreatorWorkspace(h.sql,other,ready)).application).toBeNull();
  expect(await creatorApplicationCount(h.sql)).toBe(1);
 });

 it('declines with a visible note, keeps the audit free of it and limits a same-day reapplication',async()=>{
  const id=(await loadCreatorWorkspace(h.sql,applicant,ready)).application!.id;
  await expect(administerPlatform(h.sql,applicant,{action:'application',id,decision:'decline',note:'no',reason:'Self review'})).rejects.toThrow('forbidden');
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,{action:'application',id,decision:'decline',reason:'Portfolio reviewed'})).rejects.toThrow('invalid');
  const decline={action:'application',id,decision:'decline',note:'We need examples where a different face can carry the format.',reason:'Portfolio reviewed against brief'};
  await administerPlatform(h.sql,ADMIN_VIEWER,decline);await administerPlatform(h.sql,ADMIN_VIEWER,decline);
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,{action:'application',id,decision:'approve',contract:'pilot-v1',reason:'Changed mind'})).rejects.toThrow('conflict');
  const mine=await loadCreatorWorkspace(h.sql,applicant,ready);
  expect(mine.application).toMatchObject({status:'declined',decisionNote:decline.note});
  expect(mine.application!.decidedAt).not.toBeNull();
  expect(mine.creator).toBeNull();
  const audit=await h.sql.query<{details:unknown;reason:string}>("select details,reason from platform_audit where action='application'");
  expect(audit.rows).toHaveLength(1);
  expect(JSON.stringify(audit.rows)).not.toContain(decline.note);
  await expect(submitCreatorApplication(h.sql,applicant,application(),open)).rejects.toThrow('rate_limited');
  await age(applicant.userId!);
  await submitCreatorApplication(h.sql,applicant,application(),open);
  expect((await loadCreatorWorkspace(h.sql,applicant,ready)).application!.status).toBe('submitted');
  expect((await loadApplicationQueue(h.sql))!.open).toHaveLength(1);
 });

 it('approves only with a contract label, grants the supplier permission once and refuses a further application',async()=>{
  const id=(await loadCreatorWorkspace(h.sql,applicant,ready)).application!.id;
  await expect(submitPlatform(h.sql,applicant,format(),all)).rejects.toThrow('forbidden');
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,{action:'application',id,decision:'approve',contract:'',reason:'Approved'})).rejects.toThrow('invalid');
  const approve={action:'application',id,decision:'approve',contract:'pilot-v1',note:'Welcome. Start with one video format.',reason:'Owner-approved contract version'};
  await administerPlatform(h.sql,ADMIN_VIEWER,approve);await administerPlatform(h.sql,ADMIN_VIEWER,approve);
  const mine=await loadCreatorWorkspace(h.sql,applicant,ready);
  expect(mine.application).toMatchObject({status:'approved',decisionNote:approve.note});
  expect(mine.creator).toMatchObject({active:true,contractVersion:'pilot-v1'});
  expect((await h.sql.query("select id from platform_audit where action='application'")).rows).toHaveLength(2);
  await expect(submitCreatorApplication(h.sql,applicant,application(),open)).rejects.toThrow('already_creator');
  expect(await creatorApplicationCount(h.sql)).toBe(0);
 });

 it('shows creator-facing review notes and template state, never recipe, costs or moderation text',async()=>{
  const rejected=format({title:'First try'});
  await submitPlatform(h.sql,applicant,rejected,all);
  expect((await loadCreatorWorkspace(h.sql,applicant,ready)).formats[0]).toMatchObject({id:rejected.requestId,status:'submitted',reviewNote:null,template:null});
  await expect(administerPlatform(h.sql,ADMIN_VIEWER,{action:'format',id:rejected.requestId,accept:false,reason:'Reviewed'})).rejects.toThrow('invalid');
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'format',id:rejected.requestId,accept:false,note:'The face is hidden for most of the clip.',reason:'Reviewed recipe privately'});
  expect((await loadFormatReviewNotes(h.sql,[rejected.requestId])).get(rejected.requestId)).toBe('The face is hidden for most of the clip.');
  // Revisions: only the owner's own rejected row.
  await expect(submitPlatform(h.sql,other,format({revisionOf:rejected.requestId}),all)).rejects.toThrow('forbidden');
  const revised=format({title:'Second try',revisionOf:rejected.requestId});
  await submitPlatform(h.sql,applicant,revised,all);
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'format',id:revised.requestId,accept:true,note:'Accepted for studio QA.',reason:'Reviewed revision'});
  await expect(submitPlatform(h.sql,applicant,format({revisionOf:revised.requestId}),all)).rejects.toThrow('not_found');
  let mine=await loadCreatorWorkspace(h.sql,applicant,ready);
  const accepted=mine.formats.find(f=>f.id===revised.requestId)!;
  expect(accepted).toMatchObject({status:'accepted',revisionOf:rejected.requestId,reviewNote:'Accepted for studio QA.',template:{state:'pending',slug:null}});
  const templateId=(await h.sql.query<{template_id:string}>('select template_id from platform_formats where id=$1',[revised.requestId])).rows[0]!.template_id;
  // Studio-internal moderation reason is not creator copy.
  await rejectPrompt(h.sql,templateId,'INTERNAL_MODERATION_CANARY');
  mine=await loadCreatorWorkspace(h.sql,applicant,ready);
  expect(mine.formats.find(f=>f.id===revised.requestId)!.template).toEqual({state:'rejected',slug:null});
  expect(JSON.stringify(mine)).not.toContain('INTERNAL_MODERATION_CANARY');
  await approvePrompt(h.sql,{id:templateId,slug:'rain-alley-walk',authorHandle:null,useCase:[],featured:false});
  mine=await loadCreatorWorkspace(h.sql,applicant,ready);
  expect(mine.formats.find(f=>f.id===revised.requestId)!.template).toEqual({state:'published',slug:'rain-alley-walk'});
  // The existing editor can still save the accepted row as long as the recipe stays hidden (trigger regression).
  const row=(await loadPromptById(h.sql,templateId))!;
  expect(await updatePrompt(h.sql,{id:templateId,slug:row.slug,authorHandle:null,title:'Rain alley walk',titleKo:null,promptText:row.promptText,textVisibility:'hidden',useCase:[],featured:false,models:row.models,medium:row.medium})).toBe(true);
  await setPromptArchived(h.sql,templateId,true);
  expect((await loadCreatorWorkspace(h.sql,applicant,ready)).formats.find(f=>f.id===revised.requestId)!.template).toEqual({state:'archived',slug:null});
  await setPromptArchived(h.sql,templateId,false);
  const json=JSON.stringify(await loadCreatorWorkspace(h.sql,applicant,ready));
  for(const secret of ['PRIVATE_RECIPE','recipe','provider_cost','providerCost','fees','tax','email','payment_key','reason'])expect(json,secret).not.toContain(secret);
 });

 it('counts only live paid one-time orders, records settled shares and drops refunds',async()=>{
  const templateId=(await h.sql.query<{template_id:string}>("select template_id from platform_formats where user_id=$1 and status='accepted'",[applicant.userId])).rows[0]!.template_id;
  expect((await loadCreatorWorkspace(h.sql,applicant,ready)).earnings).toEqual([]);
  const order=async(environment='live',paymentType='NORMAL')=>{
   const renderId=randomUUID(),paymentId=randomUUID();
   await insertRenderJob(h.sql,{id:renderId,userId:other.userId!,templateId,templateSlug:'rain-alley-walk',medium:'video',engine:'seedance-2.0',aspect:'9:16',locale:'ko',inputKey:null,inputMime:null});
   await h.sql.query("update render_jobs set status='succeeded',attempts=1,cost_usd=1,cost_source='provider_usage',result_key='test/r.mp4',result_mime='video/mp4',share_token=id::text,share_expires_at=now()+interval '1 day',finished_at=now() where id=$1",[renderId]);
   await h.sql.query(`insert into billing_payments(id,user_id,environment,payment_type,amount_krw,status,payment_key,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,render_id,consent_at,approved_at,expires_at)
    values($1,$2,$3,$4,10000,'paid',$5,$6,'rain-alley-walk','test','9:16','ko',$7,'private/input.jpg','image/jpeg',$7,now(),now(),now()+interval '1 day')`,[paymentId,other.userId,environment,paymentType,`test-${paymentId}`,templateId,renderId]);
   return {renderId,paymentId};
  };
  const live=await order();await order('test');
  let earnings=(await loadCreatorWorkspace(h.sql,applicant,ready)).earnings;
  expect(earnings).toEqual([{templateId,title:'Second try',orders:1,settled:0,pending:1,creatorDue:0}]);
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'settle',id:live.renderId,tax:900,fees:300,fx:1000,reason:'Actual provider invoice and PG fee evidence'});
  earnings=(await loadCreatorWorkspace(h.sql,applicant,ready)).earnings;
  expect(earnings[0]).toMatchObject({orders:1,settled:1,pending:0,creatorDue:marginSplit({revenue:10000,tax:900,fees:300,providerCost:1000,creator:true}).creator});
  expect((await loadCreatorWorkspace(h.sql,other,ready)).earnings).toEqual([]);
  await h.sql.query("update billing_payments set status='refunded',refunded_at=now() where id=$1",[live.paymentId]);
  expect((await loadCreatorWorkspace(h.sql,applicant,ready)).earnings).toEqual([]);
 });

 it('keeps a revoked creator read-only',async()=>{
  await administerPlatform(h.sql,ADMIN_VIEWER,{action:'creator',id:applicant.userId,active:false,contract:'pilot-v1',reason:'Permission revoked'});
  await expect(submitPlatform(h.sql,applicant,format(),all)).rejects.toThrow('forbidden');
  const mine=await loadCreatorWorkspace(h.sql,applicant,ready);
  expect(mine.creator).toMatchObject({active:false});
  expect(mine.formats.length).toBeGreaterThan(0);
  // A revoked supplier may apply again for a fresh review (after the daily limit).
  await age(applicant.userId!);
  await submitCreatorApplication(h.sql,applicant,application(),open);
  expect((await loadCreatorWorkspace(h.sql,applicant,ready)).application!.status).toBe('submitted');
 });

 it('fails closed for applications when 0050 is absent while invited suppliers keep submitting',async()=>{
  const old=await promptHarness();try{
   await old.sql.query('drop table platform_creator_applications');
   await old.sql.query('alter table platform_formats drop column revision_of,drop column review_note,drop column reviewed_at');
   expect(await loadApplicationQueue(old.sql)).toBeNull();
   expect(await creatorApplicationCount(old.sql)).toBe(0);
   expect(await loadFormatReviewNotes(old.sql,[randomUUID()])).toEqual(new Map());
   const supplier=viewerOf('pro');
   await administerPlatform(old.sql,ADMIN_VIEWER,{action:'creator',id:supplier.userId,active:true,contract:'pilot-v1',reason:'Owner-approved invitation'});
   const a=format(),b=format();
   await submitPlatform(old.sql,supplier,a,all);await submitPlatform(old.sql,supplier,b,all);
   await expect(submitPlatform(old.sql,supplier,format({revisionOf:a.requestId}),all)).rejects.toThrow('not_open');
   await expect(administerPlatform(old.sql,ADMIN_VIEWER,{action:'format',id:a.requestId,accept:false,note:'Would be lost',reason:'Reviewed'})).rejects.toThrow('not_open');
   await administerPlatform(old.sql,ADMIN_VIEWER,{action:'format',id:a.requestId,accept:false,reason:'Reviewed'});
   await administerPlatform(old.sql,ADMIN_VIEWER,{action:'format',id:b.requestId,accept:true,reason:'Reviewed'});
   await expect(administerPlatform(old.sql,ADMIN_VIEWER,{action:'application',id:randomUUID(),decision:'decline',note:'none',reason:'Reviewed'})).rejects.toThrow('not_open');
   const mine=await loadCreatorWorkspace(old.sql,supplier,{onboarding:false});
   expect(mine).toMatchObject({onboarding:false,application:null,creator:{active:true}});
   expect(mine.formats.map(f=>f.status).sort()).toEqual(['accepted','rejected']);
   expect(mine.formats.every(f=>f.reviewNote===null&&f.revisionOf===null)).toBe(true);
   expect(JSON.stringify(mine)).not.toContain('PRIVATE_RECIPE');
  }finally{await old.close();}
 });
});
