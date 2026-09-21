import 'server-only';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { openAiConfigFromEnv } from '@/lib/images/openai';
import { createPortraitProvider } from './portrait-provider';
import type { PortraitDeps } from './portrait-service';

/** Separate rollout from paid generation. Remains closed until this feature's migrations are applied. */
export function portraitEnabled(){return process.env.IDENTITY_PORTRAIT_ENABLED==='true';}
export async function portraitDeps():Promise<PortraitDeps|null>{
  if(!portraitEnabled()) return null;
  const sql=await getSqlRunner();if(!sql)return null;
  const config=openAiConfigFromEnv();
  return {sql,store:await getRenderStore(),provider:config?createPortraitProvider(config):null};
}
