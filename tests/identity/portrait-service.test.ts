import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {billingDb,seedProfile,USER,type BillingHarness} from '@/tests/helpers/billing';
import {enqueuePortrait,runPortraitPass,portraitState,selectPortrait,selectedPortraitPhoto,ownPortrait,type PortraitDeps} from '@/lib/identity/portrait-service';
import {PortraitProviderError} from '@/lib/identity/portrait-provider';
import {cleanPortraitResult} from '@/lib/identity/portrait-images';
describe('portrait ownership, safety and persistence',()=>{
 let h:BillingHarness,d:PortraitDeps,input:Uint8Array,output:Uint8Array,objects:Map<string,Uint8Array>;
 beforeEach(async()=>{
  h=await billingDb();await seedProfile(h.sql,{id:USER.buyer});await seedProfile(h.sql,{id:USER.other});
  input=new Uint8Array(await sharp({create:{width:300,height:400,channels:3,background:'#d6d6d6'}}).png().toBuffer());
  output=new Uint8Array(await sharp({create:{width:1344,height:2016,channels:3,background:'#d6d6d6'}}).png().toBuffer());
  const seedreamOutput=new Uint8Array(await sharp({create:{width:1664,height:2496,channels:3,background:'#d6d6d6'}}).png().toBuffer());
  objects=new Map();d={sql:h.sql,now:new Date('2026-09-22T00:00:00Z'),provider:{generate:vi.fn(async()=>output)},seedreamProvider:{generate:vi.fn(async()=>seedreamOutput)},store:{name:'local',put:async(k,b)=>{objects.set(k,b)},read:async k=>{const b=objects.get(k);if(!b)throw Error('missing');return b;},url:async()=>null}};
 });
 afterEach(async()=>h.close());
 const request=()=>({requestId:randomUUID(),consent:true,bytes:input,mime:'image/png'});
 async function pair(){const r=await enqueuePortrait(d,USER.buyer,request());expect(r.ok).toBe(true);await runPortraitPass(d,USER.buyer);return portraitState(h.sql,USER.buyer);}
 it('requires login, consent, decoded photo and both providers before reserving',async()=>{
  expect(await enqueuePortrait(d,null,request())).toMatchObject({code:'sign_in_required'});
  expect(await enqueuePortrait(d,USER.buyer,{...request(),consent:false})).toMatchObject({code:'consent_required'});
  expect(await enqueuePortrait(d,USER.buyer,{...request(),bytes:new Uint8Array([1])})).toMatchObject({code:'bad_photo'});
  d.seedreamProvider=null;expect(await enqueuePortrait(d,USER.buyer,request())).toMatchObject({code:'unavailable'});
  expect((await portraitState(h.sql,USER.buyer)).used).toBe(0);expect(objects.size).toBe(0);
 });
 it('prevents cross-owner reads, stale selection changes and pins selected bytes',async()=>{
  const s=await pair();const a=s.attempts.find(x=>x.slot===1),b=s.attempts.find(x=>x.slot===2);expect(a&&b).toBeTruthy();
  expect(await ownPortrait(h.sql,USER.other,a!.id)).toBeNull();expect(await selectPortrait(h.sql,USER.other,a!.id,null)).toBe(false);
  expect(await selectedPortraitPhoto(h.sql,d.store,USER.other,a!.id)).toBeNull();
  expect(await selectPortrait(h.sql,USER.buyer,a!.id,null)).toBe(true);
  const pinned=await selectedPortraitPhoto(h.sql,d.store,USER.buyer,a!.id);
  expect(await selectPortrait(h.sql,USER.buyer,b!.id,null)).toBe(false);
  expect(await selectPortrait(h.sql,USER.buyer,b!.id,a!.id)).toBe(true);expect(pinned?.bytes).toEqual(output);
  expect(await selectedPortraitPhoto(h.sql,d.store,USER.buyer,a!.id)).toBeNull();
 });
 it('recovers saved uncertain output without a second paid call',async()=>{
  d.provider={generate:vi.fn(async()=>{throw new PortraitProviderError('uncertain')})};
  const r=await enqueuePortrait(d,USER.buyer,request());if(!r.ok)throw Error();await runPortraitPass(d,USER.buyer);
  expect(await enqueuePortrait(d,USER.buyer,{...request(),action:'recover'})).toMatchObject({code:'in_progress'});
  objects.set(`${r.id}/result.png`,output);await runPortraitPass(d,USER.buyer);
  expect((await portraitState(h.sql,USER.buyer)).used).toBe(2);expect(d.provider.generate).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid dimensions and rate-limits definite failures without spending the extra retry',async()=>{
  await expect(cleanPortraitResult(input)).rejects.toThrow('invalid_result');
  d.provider={generate:async()=>input};d.seedreamProvider={generate:async()=>input};
  await enqueuePortrait(d,USER.buyer,request());await runPortraitPass(d,USER.buyer);
  for(let i=0;i<2;i++){expect(await enqueuePortrait(d,USER.buyer,{...request(),action:'recover'})).toMatchObject({ok:true});await runPortraitPass(d,USER.buyer);}
  expect((await portraitState(h.sql,USER.buyer)).used).toBe(0);
  expect(await enqueuePortrait(d,USER.buyer,{...request(),action:'recover'})).toMatchObject({code:'rate_limited'});
 });
 it('enforces model slots and duplicate reservations in SQL and denies browser roles',async()=>{
  const r=await enqueuePortrait(d,USER.buyer,request());if(!r.ok)throw Error();
  await expect(h.sql.query(`insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,consent_at)
    values($1,$2,$3,1,'queued','gpt-image-2.5-sunburst','v1','input',now())`,[randomUUID(),USER.buyer,randomUUID()])).rejects.toThrow();
  await expect(h.sql.query("update identity_portrait_attempts set model='gpt-image-2.5-sunburst' where user_id=$1 and slot=2",[USER.buyer])).rejects.toThrow();
  await h.db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await h.db.exec(readFileSync('supabase/migrations/0114_glue_identity_portraits.sql','utf8'));await h.db.exec(readFileSync('supabase/migrations/0115_glue_portrait_comparison.sql','utf8'));
  const permissions=await h.sql.query<{rls:boolean;forced:boolean;anon:boolean;auth:boolean}>(`select relrowsecurity rls,relforcerowsecurity forced,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') anon,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') auth from pg_class where relname in ('identity_portrait_attempts','identity_portrait_selections')`);
  expect(permissions.rows).toHaveLength(2);expect(permissions.rows.every(x=>x.rls&&x.forced&&!x.anon&&!x.auth)).toBe(true);
 });
});
