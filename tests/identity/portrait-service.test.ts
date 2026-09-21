import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {billingDb,seedProfile,USER,type BillingHarness} from '@/tests/helpers/billing';
import {enqueuePortrait,runPortraitPass,portraitState,selectPortrait,selectedPortraitPhoto,ownPortrait,type PortraitDeps} from '@/lib/identity/portrait-service';
import {PortraitProviderError} from '@/lib/identity/portrait-provider';
import {cleanPortraitResult} from '@/lib/identity/portrait-images';

describe('two lifetime identity portraits',()=>{
 let h:BillingHarness,d:PortraitDeps,input:Uint8Array,output:Uint8Array,objects:Map<string,Uint8Array>;
 beforeEach(async()=>{
  h=await billingDb();await seedProfile(h.sql,{id:USER.buyer});await seedProfile(h.sql,{id:USER.other});
  input=new Uint8Array(await sharp({create:{width:300,height:400,channels:3,background:'#d6d6d6'}}).png().toBuffer());
  output=new Uint8Array(await sharp({create:{width:1344,height:2016,channels:3,background:'#d6d6d6'}}).png().toBuffer());
  objects=new Map();d={sql:h.sql,now:new Date('2026-09-22T00:00:00Z'),provider:{generate:vi.fn(async()=>output)},store:{name:'local',put:async(k,b)=>{objects.set(k,b)},read:async k=>{const b=objects.get(k);if(!b)throw Error('missing');return b;},url:async()=>null}};
 });
 afterEach(async()=>{await h.close()});
 const request=(id=randomUUID())=>({requestId:id,consent:true,bytes:input,mime:'image/png'});
 async function success(){const r=await enqueuePortrait(d,USER.buyer,request());expect(r.ok).toBe(true);if(!r.ok)throw Error(r.code);await runPortraitPass(d,USER.buyer);return r.id;}
 it('requires login, valid decoded photo and explicit own-photo consent before reserving',async()=>{
  expect(await enqueuePortrait(d,null,request())).toMatchObject({code:'sign_in_required'});
  expect(await enqueuePortrait(d,USER.buyer,{...request(),consent:false})).toMatchObject({code:'consent_required'});
  expect(await enqueuePortrait(d,USER.buyer,{...request(),bytes:new Uint8Array([1])})).toMatchObject({code:'bad_photo'});
  expect((await portraitState(h.sql,USER.buyer)).remaining).toBe(2);
 });
 it('deduplicates request IDs, blocks a second inflight request and calls the provider only once',async()=>{
  const r=request();const a=await enqueuePortrait(d,USER.buyer,r);
  expect(await enqueuePortrait(d,USER.buyer,r)).toEqual(a);
  expect(await enqueuePortrait(d,USER.buyer,request())).toMatchObject({code:'in_progress'});
  await runPortraitPass(d,USER.buyer);await runPortraitPass(d,USER.buyer);
  expect(d.provider!.generate).toHaveBeenCalledTimes(1);
  expect((await portraitState(h.sql,USER.buyer)).remaining).toBe(1);
 });
 it('allows two successes including first, never resets, and retains selection after exhaustion',async()=>{
  const a=await success();expect(await selectPortrait(h.sql,USER.buyer,a,null)).toBe(true);
  const b=await success();expect((await portraitState(h.sql,USER.buyer)).selected).toBe(a);
  d.now=new Date('2030-01-01');expect(await enqueuePortrait(d,USER.buyer,request())).toMatchObject({code:'exhausted'});
  expect(await selectPortrait(h.sql,USER.buyer,b,a)).toBe(true);
  expect((await selectedPortraitPhoto(h.sql,d.store,USER.buyer,b))?.bytes).toEqual(output);
 });
 it('releases definitive failures once, does not select automatically and does not expose another owner',async()=>{
  d.provider={generate:vi.fn(async()=>{throw new PortraitProviderError('provider_access')})};
  await enqueuePortrait(d,USER.buyer,request());await runPortraitPass(d,USER.buyer);await runPortraitPass(d,USER.buyer);
  expect((await portraitState(h.sql,USER.buyer)).remaining).toBe(2);
  d.provider={generate:async()=>output};const a=await success();
  expect((await portraitState(h.sql,USER.buyer)).selected).toBeNull();
  expect(await ownPortrait(h.sql,USER.other,a)).toBeNull();
  expect(await selectPortrait(h.sql,USER.other,a,null)).toBe(false);
  expect(await selectedPortraitPhoto(h.sql,d.store,USER.other,a)).toBeNull();
 });
 it('keeps uncertain charges reserved and recovers a stored output without a second API call',async()=>{
  d.provider={generate:vi.fn(async()=>{throw new PortraitProviderError('uncertain')})};
  const r=await enqueuePortrait(d,USER.buyer,request());if(!r.ok)throw Error();
  await runPortraitPass(d,USER.buyer);await runPortraitPass(d,USER.buyer);
  expect((await portraitState(h.sql,USER.buyer)).attempts[0]?.status).toBe('uncertain');
  expect(await enqueuePortrait(d,USER.buyer,request())).toMatchObject({code:'in_progress'});
  objects.set(`${r.id}/result.png`,output);await runPortraitPass(d,USER.buyer);
  expect((await portraitState(h.sql,USER.buyer)).used).toBe(1);
  expect(d.provider.generate).toHaveBeenCalledTimes(1);
 });
 it('prevents stale selection changes and pins output bytes when selected for a job',async()=>{
  const a=await success(),b=await success();
  expect(await selectPortrait(h.sql,USER.buyer,a,null)).toBe(true);
  const pinned=await selectedPortraitPhoto(h.sql,d.store,USER.buyer,a);
  expect(await selectPortrait(h.sql,USER.buyer,b,null)).toBe(false);
  expect(await selectPortrait(h.sql,USER.buyer,b,a)).toBe(true);
  expect(pinned?.bytes).toEqual(output);
  expect(await selectedPortraitPhoto(h.sql,d.store,USER.buyer,a)).toBeNull();
 });
 it('rejects wrong output dimensions and bounds paid provider failures per day',async()=>{
  await expect(cleanPortraitResult(input)).rejects.toThrow('invalid_result');
  d.provider={generate:async()=>input};
  for(let i=0;i<6;i++){await enqueuePortrait(d,USER.buyer,request());await runPortraitPass(d,USER.buyer);}
  expect((await portraitState(h.sql,USER.buyer)).remaining).toBe(2);
  expect(await enqueuePortrait(d,USER.buyer,request())).toMatchObject({code:'rate_limited'});
 });
 it('enforces slot and inflight limits in SQL and denies browser-role table access',async()=>{
  const r=await enqueuePortrait(d,USER.buyer,request());if(!r.ok)throw Error();
  await expect(h.sql.query(`insert into identity_portrait_attempts select $2,user_id,$3,2,status,model,prompt_version,input_key,result_key,failure_code,consent_at,started_at,completed_at,created_at from identity_portrait_attempts where id=$1`,[r.id,randomUUID(),randomUUID()])).rejects.toThrow();
  await h.db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await h.db.exec(readFileSync('supabase/migrations/0114_glue_identity_portraits.sql','utf8'));
  const permissions=await h.sql.query<{rls:boolean;forced:boolean;anon:boolean;auth:boolean}>(`select relrowsecurity rls,relforcerowsecurity forced,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') anon,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') auth from pg_class where relname in ('identity_portrait_attempts','identity_portrait_selections')`);
  expect(permissions.rows).toHaveLength(2);
  expect(permissions.rows.every(x=>x.rls && x.forced && !x.anon && !x.auth)).toBe(true);
 });
});
