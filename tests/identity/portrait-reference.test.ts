import {it,expect,vi} from 'vitest';
import {billingDb,seedProfile,USER} from '@/tests/helpers/billing';
import {portraitSeedreamReference} from '@/lib/identity/portrait-reference';
import {PortraitReferencePending} from '@/lib/identity/portrait-provider';
import type {ArkAssetsClient} from '@/lib/ark/assets';
import type {RenderStore} from '@/lib/renders/store';
it('commits moderated asset registration while pending and reuses it when ready',async()=>{
 const h=await billingDb();try{
  await seedProfile(h.sql,{id:USER.buyer});let active=false;
  const create=vi.fn(async()=>({id:'asset-test'})),group=vi.fn(async()=>({id:'group-test'}));
  const assets={createAssetGroup:group,createAsset:create,getAsset:async()=>({status:active?'Active':'Processing'})} as unknown as ArkAssetsClient;
  const deps={sql:h.sql,assets,siteUrl:'https://example.test',mode:'virtual' as const};
  const store={url:async()=> 'https://example.test/signed-original'} as unknown as RenderStore;
  const photo={bytes:new Uint8Array([1,2]),mime:'image/png' as const},context={userId:USER.buyer,inputKey:'original/input.png',attemptId:'attempt'};
  await expect(portraitSeedreamReference(deps,store,photo,context)).rejects.toBeInstanceOf(PortraitReferencePending);
  expect((await h.sql.query('select * from identity_assets')).rows).toHaveLength(1);
  active=true;expect(await portraitSeedreamReference(deps,store,photo,context)).toBe('asset://asset-test');
  expect(create).toHaveBeenCalledTimes(1);expect(group).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]).toEqual([expect.objectContaining({url:'https://example.test/signed-original',assetType:'Image'})]);
 }finally{await h.close();}
});
it('does not send bytes or create AIGC groups when liveness mode requires verification',async()=>{
 const h=await billingDb();try{
  await seedProfile(h.sql,{id:USER.buyer});const create=vi.fn();
  await expect(portraitSeedreamReference({sql:h.sql,assets:{createAssetGroup:create} as unknown as ArkAssetsClient,siteUrl:'https://example.test',mode:'liveness'},{} as RenderStore,{bytes:new Uint8Array([1]),mime:'image/png'},{userId:USER.buyer,inputKey:'input',attemptId:'attempt'})).rejects.toMatchObject({code:'identity_required'});
  expect(create).not.toHaveBeenCalled();
 }finally{await h.close();}
});
