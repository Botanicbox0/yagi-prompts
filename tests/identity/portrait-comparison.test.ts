import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {billingDb,seedProfile,USER,type BillingHarness} from '@/tests/helpers/billing';
import {enqueuePortrait,runPortraitPass,portraitState,selectPortrait,type PortraitDeps} from '@/lib/identity/portrait-service';
import {PortraitProviderError,PortraitReferencePending} from '@/lib/identity/portrait-provider';
let h:BillingHarness,d:PortraitDeps,input:Uint8Array,other:Uint8Array,output:Uint8Array,objects:Map<string,Uint8Array>;
beforeEach(async()=>{
 h=await billingDb();await seedProfile(h.sql,{id:USER.buyer});
 const picture=async(color:string,width=300,height=400)=>new Uint8Array(await sharp({create:{width,height,channels:3,background:color}}).png().toBuffer());
 input=await picture('#ddd');other=await picture('#aaa');output=await picture('#ddd',1344,2016);objects=new Map();
 d={sql:h.sql,provider:{generate:vi.fn(async()=>output)},seedreamProvider:{generate:vi.fn(async()=>output)},store:{name:'local',put:async(k,b)=>{objects.set(k,b)},read:async k=>objects.get(k)!,url:async()=>null}};
});
afterEach(async()=>h.close());
const req=(extra={})=>({requestId:randomUUID(),consent:true,bytes:input,mime:'image/png',...extra});
async function pair(){const r=await enqueuePortrait(d,USER.buyer,req());expect(r.ok).toBe(true);await runPortraitPass(d,USER.buyer);return portraitState(h.sql,USER.buyer);}
it('creates exactly two initial models from identical original bytes and makes no automatic selection',async()=>{
 const request=req();const first=await enqueuePortrait(d,USER.buyer,request);expect(await enqueuePortrait(d,USER.buyer,request)).toEqual(first);
 await runPortraitPass(d,USER.buyer);await runPortraitPass(d,USER.buyer);
 const s=await portraitState(h.sql,USER.buyer);expect(s.used).toBe(2);expect(s.selected).toBeNull();expect(s.canRetry).toBe(true);
 expect(d.provider!.generate).toHaveBeenCalledTimes(1);expect(d.seedreamProvider!.generate).toHaveBeenCalledTimes(1);
 expect(vi.mocked(d.provider!.generate).mock.calls[0]![0].bytes).toEqual(vi.mocked(d.seedreamProvider!.generate).mock.calls[0]![0].bytes);
 expect(await enqueuePortrait(d,USER.buyer,req())).toMatchObject({ok:false});
});
it('requires explicit rejection and a different photo, gives one Sunburst retry, and preserves the current selection',async()=>{
 const s=await pair();const id=s.attempts.find(a=>a.slot===1)!.id;await selectPortrait(h.sql,USER.buyer,id,null);
 expect(await enqueuePortrait(d,USER.buyer,req({action:'retry',bytes:other}))).toMatchObject({code:'rejection_required'});
 expect(await enqueuePortrait(d,USER.buyer,req({action:'retry',rejectInitial:true}))).toMatchObject({code:'new_photo_required'});
 const r=await enqueuePortrait(d,USER.buyer,req({action:'retry',rejectInitial:true,bytes:other}));expect(r.ok).toBe(true);await runPortraitPass(d,USER.buyer);
 const done=await portraitState(h.sql,USER.buyer);expect(done.used).toBe(3);expect(done.selected).toBe(id);expect(done.canRetry).toBe(false);
 expect(d.provider!.generate).toHaveBeenCalledTimes(2);expect(d.seedreamProvider!.generate).toHaveBeenCalledTimes(1);
 expect(await enqueuePortrait(d,USER.buyer,req({action:'retry',rejectInitial:true,bytes:other}))).toMatchObject({code:'exhausted'});
});
it('recovers only a definitively failed model from the saved original without spending the extra photo retry',async()=>{
 d.seedreamProvider={generate:vi.fn().mockRejectedValueOnce(new PortraitProviderError('provider_failed')).mockResolvedValue(output)};
 const first=await pair();expect(first.used).toBe(1);expect(first.canRecover).toBe(true);expect(first.canRetry).toBe(false);
 expect(await enqueuePortrait(d,USER.buyer,req({action:'recover',bytes:undefined}))).toMatchObject({ok:true});await runPortraitPass(d,USER.buyer);
 const done=await portraitState(h.sql,USER.buyer);expect(done.used).toBe(2);expect(done.canRetry).toBe(true);expect(d.provider!.generate).toHaveBeenCalledTimes(1);
});
it('never reissues an uncertain provider request while the other result remains selectable',async()=>{
 d.seedreamProvider={generate:vi.fn(async()=>{throw new PortraitProviderError('uncertain')})};const s=await pair();
 const id=s.attempts.find(a=>a.status==='succeeded')!.id;expect(await selectPortrait(h.sql,USER.buyer,id,null)).toBe(true);
 await runPortraitPass(d,USER.buyer);expect(d.seedreamProvider.generate).toHaveBeenCalledTimes(1);
 expect(await enqueuePortrait(d,USER.buyer,req({action:'recover'}))).toMatchObject({code:'in_progress'});
});
it('polls asset preparation without treating it as a failed image generation',async()=>{
 d.seedreamProvider={generate:vi.fn().mockRejectedValueOnce(new PortraitReferencePending()).mockResolvedValue(output)};
 const first=await pair();expect(first.attempts.some(a=>a.slot===2&&a.status==='queued')).toBe(true);
 await runPortraitPass(d,USER.buyer);expect((await portraitState(h.sql,USER.buyer)).used).toBe(2);
});
