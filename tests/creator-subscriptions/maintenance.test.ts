import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { SubscriptionDeps } from '@/lib/creator-subscriptions/types';
import { authorizeSubscriptionCron,runSubscriptionMaintenance } from '@/lib/creator-subscriptions/maintenance';
import { SUBSCRIPTION_RELEASE_VERSION } from '@/lib/creator-subscriptions/availability';
import { SUBSCRIPTION_PLAN_VERSION } from '@/lib/creator-subscriptions/plans';
import { SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { launchConfigurationDigest } from '@/lib/creator-subscriptions/evidence';

describe('protected maintenance and genuine worker heartbeat',()=>{
  let db:PGlite;let sql:SqlRunner;let deps:SubscriptionDeps;
  const now=new Date('2028-04-01T00:00:00Z');
  const processor=vi.fn(async()=>({processed:1,pending:0,hasMore:false,remaining:0}));
  beforeAll(async()=>{
    db=new PGlite();await db.exec('create table profiles(id uuid primary key)');
    await db.exec(readFileSync('supabase/migrations/0044_core_creator_subscription_release.sql','utf8'));
    sql={query:async<T>(text:string,params?:unknown[])=>({rows:(await db.query<T>(text,params)).rows}),transaction:async fn=>fn(sql)};
  });
  beforeEach(async()=>{
    await db.exec('truncate creator_subscription_launch_evidence');processor.mockClear();
    deps={sql,environment:'live',consentVersion:SUBSCRIPTION_TERMS_VERSION,gateway:{kind:'live'} as SubscriptionDeps['gateway'],cipher:{} as SubscriptionDeps['cipher']};
  });
  afterAll(async()=>{await db.close();});
  const env={VERCEL_ENV:'production',CRON_SECRET:'fixture-private-cron',VERCEL_GIT_COMMIT_SHA:'b'.repeat(40),PREMIUM_EDIT_REQUESTS_PER_PERIOD:'30'};
  async function proof(step:string,passed=true,release=SUBSCRIPTION_RELEASE_VERSION){
    await sql.query(`insert into creator_subscription_launch_evidence(environment,step,plan_version,release_version,terms_version,passed,evidence_digest,implementation_sha,configuration_digest,verified_at)
      values('live',$1,$2,$3,$4,$5,$6,$7,$8,'2028-01-01T00:00:00Z')`,[step,SUBSCRIPTION_PLAN_VERSION,release,SUBSCRIPTION_TERMS_VERSION,passed,'a'.repeat(64),env.VERCEL_GIT_COMMIT_SHA,launchConfigurationDigest(env)]);
  }
  it('fails closed for unset, blank, wrong and malformed bearer values',()=>{
    const request=(value?:string)=>new Request('https://twings.app/api/creator-subscriptions/tick',{headers:value?{authorization:value}:{}});
    expect(authorizeSubscriptionCron(request(),{})).toBe(false);
    expect(authorizeSubscriptionCron(request('Bearer fixture-private-cron'),{CRON_SECRET:' '})).toBe(false);
    expect(authorizeSubscriptionCron(request('Bearer wrong'),env)).toBe(false);
    expect(authorizeSubscriptionCron(request('Bearer  fixture-private-cron'),env)).toBe(false);
    expect(authorizeSubscriptionCron(request('Bearer fixture-private-cron'),env)).toBe(true);
  });
  it('rejects test payments until QA is explicitly enabled and never crosses environments',async()=>{
    const test={...deps,environment:'test' as const,gateway:{kind:'test'} as SubscriptionDeps['gateway']};
    expect(await runSubscriptionMaintenance(test,env,{processor,now})).toMatchObject({ok:false});
    expect(processor).not.toHaveBeenCalled();
    expect(await runSubscriptionMaintenance(test,{...env,CREATOR_SUBSCRIPTION_QA:'on'},{processor,now})).toMatchObject({ok:true,heartbeatRecorded:false});
    expect(processor).toHaveBeenCalledWith(test,{limit:2,budgetMs:250000,now});
    expect(await runSubscriptionMaintenance({...deps,gateway:{kind:'test'} as SubscriptionDeps['gateway']},env,{processor,now})).toMatchObject({ok:false});
  });
  it('requires actual matching contract approval before any live processor runs',async()=>{
    expect(await runSubscriptionMaintenance(deps,env,{processor,now})).toMatchObject({ok:false,code:'contract_unverified'});
    await proof('contract',true,'old-release');
    expect(await runSubscriptionMaintenance(deps,env,{processor,now})).toMatchObject({ok:false,code:'contract_unverified'});
    expect(processor).not.toHaveBeenCalled();
  });
  it('refreshes only an already-approved worker proof after a completed pass',async()=>{
    await proof('contract');await proof('worker');
    expect(await runSubscriptionMaintenance(deps,env,{processor,now})).toMatchObject({ok:true,heartbeatRecorded:true,processed:1});
    const rows=(await sql.query<{step:string;verified_at:Date}>('select step,verified_at from creator_subscription_launch_evidence order by step')).rows;
    expect(new Date(rows.find(r=>r.step==='worker')!.verified_at)).toEqual(now);
    expect(new Date(rows.find(r=>r.step==='contract')!.verified_at).toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });
  it('does not manufacture worker approval from a successful empty or ordinary pass',async()=>{
    await proof('contract');
    expect(await runSubscriptionMaintenance(deps,env,{processor,now})).toMatchObject({ok:true,heartbeatRecorded:false});
    expect((await sql.query("select * from creator_subscription_launch_evidence where step='worker'")).rows).toHaveLength(0);
    await proof('worker',false);
    expect(await runSubscriptionMaintenance(deps,env,{processor,now})).toMatchObject({ok:true,heartbeatRecorded:false});
    expect((await sql.query<{passed:boolean}>("select passed from creator_subscription_launch_evidence where step='worker'")).rows[0]?.passed).toBe(false);
  });
  it('continues paid recovery but never refreshes evidence for a changed implementation or configuration',async()=>{
    await proof('contract');await proof('worker');
    for (const changed of [
      {...env,VERCEL_GIT_COMMIT_SHA:'c'.repeat(40)},
      {...env,VERCEL_GIT_COMMIT_SHA:undefined},
    ]) {
      expect(await runSubscriptionMaintenance(deps,changed,{processor,now})).toMatchObject({ok:true,heartbeatRecorded:false});
    }
    await sql.query("update creator_subscription_launch_evidence set configuration_digest=$1 where step='worker'",['c'.repeat(64)]);
    expect(await runSubscriptionMaintenance(deps,env,{processor,now})).toMatchObject({ok:true,heartbeatRecorded:false});
    expect(processor).toHaveBeenCalledTimes(3);
    const row=(await sql.query<{verified_at:Date}>("select verified_at from creator_subscription_launch_evidence where step='worker'")).rows[0]!;
    expect(row.verified_at.toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });
  it('cannot refresh an old release or update the heartbeat after an exception',async()=>{
    await proof('contract');await proof('worker',true,'old-release');
    expect(await runSubscriptionMaintenance(deps,env,{processor,now})).toMatchObject({ok:true,heartbeatRecorded:false});
    await proof('worker');
    const broken=vi.fn(async()=>{throw new Error('private transport detail');});
    await expect(runSubscriptionMaintenance(deps,env,{processor:broken,now})).rejects.toThrow();
    expect((await sql.query<{verified_at:Date}>("select verified_at from creator_subscription_launch_evidence where step='worker' and release_version=$1",[SUBSCRIPTION_RELEASE_VERSION])).rows[0]?.verified_at.toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });
});
