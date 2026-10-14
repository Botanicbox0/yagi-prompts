import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { platformReady } from './service';
export async function platformAccess(sql:SqlRunner) {
  const ready=await platformReady(sql);
  const community=ready&&process.env.TWINGS_COMMUNITY==='on';
  const creators=ready&&process.env.TWINGS_FORMAT_CREATORS==='on';
  let rewards=false;
  if(ready&&process.env.TWINGS_IMAGE_REWARDS==='on') {
    const {rows}=await sql.query<{terms_version:string}>('select terms_version from platform_reward_policy where id=1');
    rewards=!!rows[0]&&rows[0].terms_version===process.env.TWINGS_REWARD_TERMS_VERSION;
  }
  return {ready,community,creators,rewards};
}
