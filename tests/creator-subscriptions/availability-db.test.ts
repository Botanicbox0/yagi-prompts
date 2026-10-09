import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getCreatorSubscriptionAvailability, SUBSCRIPTION_RELEASE_VERSION, SUBSCRIPTION_REQUIRED_STEPS } from '@/lib/creator-subscriptions/availability';
import { SUBSCRIPTION_PLAN_VERSION } from '@/lib/creator-subscriptions/plans';
import { SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { launchConfigurationDigest, premiumConfigurationDigest, subscriptionTermsDigest } from '@/lib/creator-subscriptions/evidence';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db/connect',()=>({getSqlRunner:vi.fn()}));
import { subscriptionLiveQaReady } from '@/lib/creator-subscriptions/runtime';

describe('public availability through real Postgres schemas, roles and evidence',()=>{
  let db:PGlite;let sql:SqlRunner;
  const now=new Date('2028-04-01T00:00:00Z');
  const env:NodeJS.ProcessEnv={NODE_ENV:'test',VERCEL_ENV:'production',CREATOR_SUBSCRIPTION_PUBLIC:'on',
    VERCEL_GIT_COMMIT_SHA:'b'.repeat(40),TOSS_BILLING_CLIENT_KEY:'live_ck_fixture',TOSS_BILLING_SECRET_KEY:'live_sk_fixture',
    TOSS_BILLING_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),ARK_API_KEY:'fixture',ARK_ACCESS_KEY:'fixture',ARK_SECRET_KEY:'fixture',
    CRON_SECRET:'fixture',OPENAI_API_KEY:'fixture',PREMIUM_EDITING_ENABLED:'on',PREMIUM_EDIT_REQUESTS_PER_PERIOD:'30'};
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table profiles(id uuid primary key);create table render_jobs(id uuid primary key);
      create table prompt_items(status text,medium text,audience text,price_cents integer,price_krw integer,runtime_seconds integer,engine text);
      grant select on prompt_items to service_role;`);
    for(const file of ['0042_core_creator_subscriptions.sql','0127_glue_creator_subscriptions.sql','0043_core_premium_edits.sql',
      '0128_glue_premium_edits.sql','0044_core_creator_subscription_release.sql','0129_glue_creator_subscription_release.sql'])
      await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
    sql={query:async<T>(text:string,params?:unknown[])=>({rows:(await db.query<T>(text,params)).rows}),transaction:async fn=>fn(sql)};
  });
  beforeEach(async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now.getTime());
    await db.exec(`reset role;alter role service_role bypassrls;truncate creator_subscription_launch_evidence,prompt_items;
      insert into prompt_items values('published','video','public',0,6900,25,'seedance-2.5');
      alter table creator_subscriptions enable row level security;alter table creator_subscriptions force row level security;
      alter table creator_subscription_launch_evidence enable row level security;alter table creator_subscription_launch_evidence force row level security;
      revoke all on creator_subscriptions,creator_subscription_launch_evidence from anon,authenticated;
      revoke select(customer_key) on creator_subscriptions from authenticated;
      revoke update(passed) on creator_subscription_launch_evidence from authenticated;
      drop policy if exists exposed_subscription on creator_subscriptions;
      drop policy if exists exposed_evidence on creator_subscription_launch_evidence;
      grant select,insert,update,delete on creator_subscriptions,creator_subscription_launch_evidence to service_role;`);
    for(const step of [...SUBSCRIPTION_REQUIRED_STEPS,'premium_editing']) await sql.query(`insert into creator_subscription_launch_evidence
      (environment,step,plan_version,release_version,terms_version,passed,evidence_digest,implementation_sha,configuration_digest,verified_at)
      values('live',$1,$2,$3,$4,true,$5,$6,$7,$8)`,[step,SUBSCRIPTION_PLAN_VERSION,SUBSCRIPTION_RELEASE_VERSION,SUBSCRIPTION_TERMS_VERSION,
        step==='terms'?subscriptionTermsDigest():'a'.repeat(64),env.VERCEL_GIT_COMMIT_SHA,
        step==='premium_editing'?premiumConfigurationDigest(env):launchConfigurationDigest(env),now]);
  });
  afterAll(async()=>{vi.restoreAllMocks();await db.close();});
  async function availability(config=env){
    await db.exec('set role service_role');
    try{return await getCreatorSubscriptionAvailability(sql,config);}finally{await db.exec('reset role');}
  }
  it('opens both plans only with actual query-compatible schema and complete matching proof',async()=>{
    expect(await availability()).toMatchObject({status:'open',plans:{creator:{status:'open'},premium:{status:'open'}},editing:'open',premiumEditRequestsPerPeriod:30});
  });
  it.each([
    'alter table creator_subscriptions disable row level security',
    'alter table creator_subscription_launch_evidence no force row level security',
    'grant select on creator_subscriptions to authenticated',
    'grant update on creator_subscription_launch_evidence to anon',
    'revoke select on creator_subscription_launch_evidence from service_role',
    'alter role service_role nobypassrls',
    'grant select(customer_key) on creator_subscriptions to authenticated',
    'grant update(passed) on creator_subscription_launch_evidence to authenticated',
    'create policy exposed_subscription on creator_subscriptions to authenticated using(true)',
    'create policy exposed_evidence on creator_subscription_launch_evidence to authenticated using(true)',
  ])('closes enrollment when schema privileges drift: %s',async mutation=>{
    await db.exec(mutation);expect((await availability()).status).toBe('preparing');
  });
  it.each([
    "update creator_subscription_launch_evidence set implementation_sha=repeat('c',40) where step='approval'",
    "update creator_subscription_launch_evidence set configuration_digest=repeat('c',64) where step='render'",
    "update creator_subscription_launch_evidence set evidence_digest=repeat('c',64) where step='terms'",
    "update creator_subscription_launch_evidence set verified_at='2028-03-31T22:59:59Z' where step='worker'",
    "update creator_subscription_launch_evidence set verified_at='2028-04-01T00:00:01Z' where step='worker'",
    "update creator_subscription_launch_evidence set passed=false where step='refund'",
    "update prompt_items set status='draft'",
  ])('closes enrollment for invalid operational evidence: %s',async mutation=>{
    await db.exec(mutation);expect((await availability()).status).toBe('preparing');
  });
  it.each([{OPENAI_API_KEY:undefined},{PREMIUM_EDIT_REQUESTS_PER_PERIOD:undefined},{PREMIUM_EDIT_REQUESTS_PER_PERIOD:'29'},
    {PREMIUM_EDIT_REQUESTS_PER_PERIOD:'50'},{PREMIUM_EDITING_ENABLED:'off'}])('keeps Creator open when only editing configuration changes: %j',async change=>{
    expect(await availability({...env,...change})).toMatchObject({status:'open',plans:{creator:{status:'open'},premium:{status:'preparing'}},editing:'preparing'});
  });
  it('adding Premium configuration never invalidates existing Creator proof',async()=>{
    const withoutEditing={...env,OPENAI_API_KEY:undefined,PREMIUM_EDIT_REQUESTS_PER_PERIOD:undefined,PREMIUM_EDITING_ENABLED:'off'};
    expect(launchConfigurationDigest(withoutEditing)).toBe(launchConfigurationDigest(env));
    expect((await availability(withoutEditing)).plans.creator.status).toBe('open');
    expect((await availability()).plans.creator.status).toBe('open');
  });
  it('never projects evidence, credentials or private recipe fields',async()=>{
    const result=await availability();
    expect(Object.keys(result).sort()).toEqual(['editing','plans','premiumEditRequestsPerPeriod','status','version']);
    expect(JSON.stringify(result)).not.toMatch(/fixture|implementationSha|configurationDigest|base_prompt|billing_key/);
  });
  it('rejects noncanonical encryption keys even when they decode to exactly 32 bytes',async()=>{
    const bad=env.TOSS_BILLING_ENCRYPTION_KEY!.slice(0,-2)+'F=';
    expect(Buffer.from(bad,'base64')).toEqual(Buffer.from(env.TOSS_BILLING_ENCRYPTION_KEY!,'base64'));
    expect((await availability({...env,TOSS_BILLING_ENCRYPTION_KEY:bad})).status).toBe('preparing');
  });
  it('does not open Premium for an unsupported model despite matching configuration evidence',async()=>{
    const bad={...env,PREMIUM_EDIT_MODEL:'unapproved-model'};
    await sql.query("update creator_subscription_launch_evidence set configuration_digest=$1 where step='premium_editing'",[premiumConfigurationDigest(bad)]);
    expect((await availability(bad)).plans).toEqual({creator:{status:'open'},premium:{status:'preparing'}});
  });
  it('allows live QA only with current implementation, configuration and exact terms proof',async()=>{
    expect(await subscriptionLiveQaReady(sql,env)).toBe(true);
    expect(await subscriptionLiveQaReady(sql,{...env,VERCEL_GIT_COMMIT_SHA:undefined})).toBe(false);
    expect(await subscriptionLiveQaReady(sql,{...env,VERCEL_ENV:'preview'})).toBe(false);
    for(const step of ['contract','costs','terms']){
      await sql.query('update creator_subscription_launch_evidence set implementation_sha=$1 where step=$2',['c'.repeat(40),step]);
      expect(await subscriptionLiveQaReady(sql,env)).toBe(false);
      await sql.query('update creator_subscription_launch_evidence set implementation_sha=$1,configuration_digest=$2 where step=$3',[env.VERCEL_GIT_COMMIT_SHA,'c'.repeat(64),step]);
      expect(await subscriptionLiveQaReady(sql,env)).toBe(false);
      await sql.query('update creator_subscription_launch_evidence set configuration_digest=$1 where step=$2',[launchConfigurationDigest(env),step]);
    }
    await sql.query("update creator_subscription_launch_evidence set evidence_digest=repeat('c',64) where step='terms'");
    expect(await subscriptionLiveQaReady(sql,env)).toBe(false);
  });
});
