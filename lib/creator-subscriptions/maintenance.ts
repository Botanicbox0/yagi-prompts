import { createHash,timingSafeEqual } from 'node:crypto';
import type { SubscriptionDeps } from './types';
import { processSubscriptionRenewals } from './service';
import { SUBSCRIPTION_PLAN_VERSION } from './plans';
import { SUBSCRIPTION_RELEASE_VERSION } from './availability';
import { SUBSCRIPTION_TERMS_VERSION } from './legal';
import { currentImplementationSha,launchConfigurationDigest } from './evidence';

/** Public maintenance must remain closed when deployment credentials are absent. */
export function authorizeSubscriptionCron(request:Request,env:Record<string,string|undefined>=process.env):boolean {
  const secret=env.CRON_SECRET?.trim();
  if (!secret) return false;
  const supplied=request.headers.get('authorization') ?? '';
  if (supplied.length>4096) return false;
  const digest=(value:string)=>createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied),digest(`Bearer ${secret}`));
}

export type MaintenanceResult = {ok:true;processed:number;pending:number;hasMore:boolean;remaining:number;heartbeatRecorded:boolean}
  | {ok:false;code:'unavailable'|'test_disabled'|'contract_unverified'};

/** Also used by a protected Hobby daily backup. Calling code must authenticate the request first.
 * Existing subscriptions can recover while new enrollment is paused; no proof is synthesized here.
 */
export async function runSubscriptionMaintenance(deps:SubscriptionDeps,env:Record<string,string|undefined>=process.env,
  options:{now?:Date;processor?:typeof processSubscriptionRenewals}={}):Promise<MaintenanceResult> {
  if (!env.CRON_SECRET?.trim() || !['test','live'].includes(deps.environment) || deps.environment!==deps.gateway.kind || deps.consentVersion!==SUBSCRIPTION_TERMS_VERSION)
    return {ok:false,code:'unavailable'};
  const schema=await deps.sql.query<{ready:boolean}>("select to_regclass('public.creator_subscription_launch_evidence') is not null as ready");
  if (schema.rows[0]?.ready!==true) return {ok:false,code:'unavailable'};
  if (deps.environment==='test') {
    if (env.CREATOR_SUBSCRIPTION_QA!=='on') return {ok:false,code:'test_disabled'};
  } else {
    if (env.VERCEL_ENV!=='production') return {ok:false,code:'unavailable'};
    const proof=await deps.sql.query<{ready:boolean}>(`select exists(select 1 from creator_subscription_launch_evidence
      where environment='live' and step='contract' and passed=true and plan_version=$1 and release_version=$2 and terms_version=$3) as ready`,
      [SUBSCRIPTION_PLAN_VERSION,SUBSCRIPTION_RELEASE_VERSION,SUBSCRIPTION_TERMS_VERSION]);
    if (proof.rows[0]?.ready!==true) return {ok:false,code:'contract_unverified'};
  }
  const report=await (options.processor ?? processSubscriptionRenewals)(deps,{limit:2,budgetMs:250_000,now:options.now ?? new Date()});
  // This proves the scheduler actually ran. It cannot grant contract/payment approval or insert a
  // worker proof that has never been reviewed, or refresh approval for another deployment/config.
  // Ambiguous individual payments stay in the ledger. Missing build identity cannot refresh proof.
  const heartbeat=await deps.sql.query(`update creator_subscription_launch_evidence set verified_at=$5
    where environment=$1 and step='worker' and passed=true and plan_version=$2 and release_version=$3 and terms_version=$4
      and implementation_sha=$6 and configuration_digest=$7 returning step`,
    [deps.environment,SUBSCRIPTION_PLAN_VERSION,SUBSCRIPTION_RELEASE_VERSION,SUBSCRIPTION_TERMS_VERSION,options.now ?? new Date(),
      currentImplementationSha(env),launchConfigurationDigest(env)]);
  return {ok:true,...report,heartbeatRecorded:heartbeat.rows.length===1};
}

/**
 * Most ticks leave the public answer as it was. Purging pages anyway throws away the last good copy
 * that ISR serves through a database outage (lib/db/read-policy.ts), so a tick purges only when the
 * answer pages were built from differs from the answer they would get now: the heartbeat that ends a
 * lapse, or a lapse that began since the pages were built.
 * A read that fails gave no answer, and a purge during an outage leaves visitors a render that
 * throws. So that is no change; the next tick, or the pages' hourly revalidation, catches up.
 */
export async function publicAnswerChanged(shown:()=>Promise<unknown>,current:()=>Promise<unknown>):Promise<boolean> {
  try {
    // Compared as JSON, the form the cache stores: a field left undefined is absent on both sides.
    return JSON.stringify(await shown())!==JSON.stringify(await current());
  } catch {
    return false;
  }
}
