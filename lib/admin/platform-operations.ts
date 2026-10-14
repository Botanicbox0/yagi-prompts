import type { AdminOperation } from './operations';
import { administerPlatform,PlatformAdminInput } from '@/lib/creator-platform/admin';
import { PlatformError } from '@/lib/creator-platform/contract';
import { ok,fail } from './context';
const operation:AdminOperation={
 parse(form){
  const input:Record<string,unknown>={};
  const numbers=new Set(['score','tax','fees','fx','costPerCredit','cap','credits','maxCost']);
  const booleans=new Set(['active','accept','excluded','ownership','content','disclosure']);
  for(const [key,value] of form)if(!key.startsWith('_'))input[key]=numbers.has(key)?Number(value):booleans.has(key)?value==='true':value;
  const parsed=PlatformAdminInput.safeParse(input);
  return parsed.success?{ok:true,value:parsed.data}:{ok:false,detail:'invalid platform input'};
 },
 async run(ctx,input){
  try{const result=await administerPlatform(ctx.sql,ctx.viewer,input);ctx.revalidatePrompts?.();return ok('saved',{to:'/admin/community',detail:result.id});}
  catch(error){if(error instanceof PlatformError)return fail(error.code==='forbidden'?'forbidden':error.code==='not_found'?'notFound':'invalid',error.code);return fail('unknown');}
 }
};
export const PLATFORM_OPERATIONS={'platform.manage':operation};
