import type {ReferenceImage} from '@/lib/images/openai';
import type {RenderStore} from '@/lib/renders/store';
import {assetLibraryMode,ensureVirtualGroup,ensureIdentityAsset,loadIdentityGroup,recordIdentityUse,type IdentityDeps} from './service';
import {PortraitProviderError,PortraitReferencePending,type PortraitProviderContext} from './portrait-provider';

/** Register the original through the existing moderated asset library; never substitute a result. */
export async function portraitSeedreamReference(deps:IdentityDeps,store:RenderStore,photo:ReferenceImage,context:PortraitProviderContext):Promise<string>{
 return deps.sql.transaction(async sql=>{
  await sql.query('select id from profiles where id=$1 for update',[context.userId]);
  const scoped={...deps,sql};
  let group;
  if((deps.mode??assetLibraryMode())==='virtual'){
   const result=await ensureVirtualGroup(scoped,context.userId);
   if(!result.ok)return {error:'provider_access' as const};
   group=result.group;
  }else{
   group=await loadIdentityGroup(sql,context.userId);
   if(!group||group.status!=='active'||group.groupType!=='LivenessFace')return {error:'identity_required' as const};
  }
  const result=await ensureIdentityAsset(scoped,{group,photo:photo.bytes,photoUrl:await store.url(context.inputKey,900)});
  // Return the pending marker rather than throwing inside the transaction: registration must commit.
  if(result.status==='processing')return {pending:true as const};
  if(result.status!=='active')return {error:'moderated' as const};
  await recordIdentityUse(sql,{userId:context.userId,assetId:result.assetId,now:deps.now??new Date()});
  return {reference:`asset://${result.assetId}`};
 }).then(result=>{if(result.error)throw new PortraitProviderError(result.error);if(result.pending)throw new PortraitReferencePending();return result.reference!;});
}
