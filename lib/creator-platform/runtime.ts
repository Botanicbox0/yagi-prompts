import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { onboardingReady, platformReady } from './service';
import { creatorProgramOpen } from './links';
export async function platformAccess(sql:SqlRunner) {
  const ready=await platformReady(sql);
  const community=ready&&process.env.TWINGS_COMMUNITY==='on';
  const creators=ready&&process.env.TWINGS_FORMAT_CREATORS==='on';
  let rewards=false;
  if(ready&&process.env.TWINGS_IMAGE_REWARDS==='on') {
    const {rows}=await sql.query<{terms_version:string}>('select terms_version from platform_reward_policy where id=1');
    rewards=!!rows[0]&&rows[0].terms_version===process.env.TWINGS_REWARD_TERMS_VERSION;
  }
  // Review notes, revisions and applications need 0051. Invited suppliers keep the older submission path without it.
  const onboarding=ready&&await onboardingReady(sql);
  // Public intake collects new personal data, so it has its own default-off gate on top of the supplier gate.
  const applications=creators&&onboarding&&creatorProgramOpen();
  return {ready,community,creators,rewards,onboarding,applications};
}
export type PlatformAccess=Awaited<ReturnType<typeof platformAccess>>;
