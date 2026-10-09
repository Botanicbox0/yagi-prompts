import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { SubscriptionDeps, SubscriptionGateway } from '@/lib/creator-subscriptions/types';
import { TossError, type TossPayment } from '@/lib/billing/toss-gateway';
import { createBillingKeyCipher } from '@/lib/creator-subscriptions/crypto';
import { beginSubscription, completeSubscription, cancelSubscription, processSubscriptionRenewals, refundUnusedSubscription } from '@/lib/creator-subscriptions/service';
import { getSubscriptionSummary, subscriptionSchemaReady } from '@/lib/creator-subscriptions/repo';
import { reserveSubscriptionUsage, settleSubscriptionUsage } from '@/lib/creator-subscriptions/usage';
import type { Viewer } from '@/lib/auth/identity';

const userId = '11111111-1111-4111-8111-111111111111';
const viewer: Viewer = { userId, tier: 'free', email: null, locale: 'ko', isAdmin: false };
const consentVersion = 'test-approved-subscription-v1';
describe('subscription payment and allowance invariants on real Postgres', () => {
  let db: PGlite; let sql: SqlRunner; let deps: SubscriptionDeps; let now: Date;
  let payments: Map<string,TossPayment>; let gateway: SubscriptionGateway;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create table profiles(id uuid primary key); insert into profiles values('${userId}');
      create role anon; create role authenticated; create role service_role bypassrls;`);
    await db.exec(readFileSync('supabase/migrations/0042_core_creator_subscriptions.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/0127_glue_creator_subscriptions.sql','utf8'));
    const wrap = (target: { query: PGlite['query'] }): SqlRunner => ({
      query: async <T>(text: string, params?: unknown[]) => ({ rows: (await target.query<T>(text, params)).rows }),
      transaction: async fn => fn(wrap(target)),
    });
    sql = { ...wrap(db), transaction: fn => db.transaction(tx => fn(wrap(tx as unknown as PGlite))) };
  });
  beforeEach(async () => {
    await db.exec('truncate creator_subscription_key_cleanup,creator_subscription_usage,creator_subscription_periods,creator_subscriptions');
    now = new Date('2028-01-31T00:30:00+09:00');
    payments = new Map();
    gateway = {
      kind: 'test',
      issue: vi.fn(async ({customerKey}) => ({billingKey:'private-billing-token',customerKey})),
      charge: vi.fn(async ({orderId,amount}) => {
        const p = payments.get(orderId) ?? {orderId,paymentKey:randomUUID(),amount,balance:amount,currency:'KRW',status:'DONE'};
        payments.set(orderId,p); return p;
      }),
      retrieveOrder: vi.fn(async id => payments.get(id) ?? null),
      revokeBillingKey: vi.fn(async()=>{}),
      cancel: vi.fn(async ({paymentKey}) => {
        const p = [...payments.values()].find(p=>p.paymentKey===paymentKey)!;
        const canceled = {...p,balance:0,status:'CANCELED'}; payments.set(p.orderId,canceled); return canceled;
      }),
    };
    deps = { sql,gateway,cipher:createBillingKeyCipher(Buffer.alloc(32,1).toString('base64')),environment:'test',consentVersion,premiumEditLimit:30,now:()=>now };
  });
  afterAll(async () => { await db.close(); });
  async function begin(planId: 'creator' | 'premium' = 'creator') {
    const r = await beginSubscription(deps, viewer, {planId,locale:'ko',consentVersion});
    if (!r.ok) throw new Error(r.code); return r;
  }
  async function activate(planId: 'creator' | 'premium' = 'creator') {
    const r = await begin(planId);
    expect((await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'})).ok).toBe(true);
    return r;
  }
  const summary = () => getSubscriptionSummary(sql,userId,{environment:'test',now});
  const reserve = (renderRef: string, units = 100) => reserveSubscriptionUsage(sql,{userId,renderRef,units,environment:'test',now});

  it('rejects new Premium contracts without a valid funded editing limit', async () => {
    for (const premiumEditLimit of [undefined,null,0,29,30.5,1001,NaN]) {
      expect(await beginSubscription({...deps,premiumEditLimit},viewer,{planId:'premium',locale:'ko',consentVersion}))
        .toEqual({ok:false,code:'unavailable'});
    }
    expect((await sql.query('select id from creator_subscriptions')).rows).toHaveLength(0);
    expect(gateway.issue).not.toHaveBeenCalled();
  });
  it('keeps accepted Premium price, allowance and editing limit through config changes and renewal', async () => {
    deps.premiumEditLimit=50;
    const r=await begin('premium');
    deps.premiumEditLimit=null;
    expect((await begin('premium')).subscriptionId).toBe(r.subscriptionId);
    expect(await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'}))
      .toMatchObject({ok:true});
    deps.premiumEditLimit=30;
    now=new Date('2028-02-29T00:31:00+09:00');
    await processSubscriptionRenewals(deps,{limit:2,now});
    expect((await sql.query('select amount_krw,monthly_units,premium_edit_limit from creator_subscriptions')).rows)
      .toEqual([{amount_krw:49000,monthly_units:1200,premium_edit_limit:50}]);
    expect((await sql.query('select amount_krw,monthly_units from creator_subscription_periods order by period_index')).rows)
      .toEqual([{amount_krw:49000,monthly_units:1200},{amount_krw:49000,monthly_units:1200}]);
    expect(gateway.charge).toHaveBeenCalledTimes(2);
  });
  it('never grants editing requests to Creator from a global Premium setting', async () => {
    await activate('creator');
    expect((await sql.query('select premium_edit_limit from creator_subscriptions')).rows[0]).toEqual({premium_edit_limit:null});
  });
  it('returns the requested owned contract instead of replacing it with the latest subscription',async()=>{
    const old=await begin();await cancelSubscription(deps,viewer,old.subscriptionId);
    const current=await activate();
    expect((await summary())?.id).toBe(current.subscriptionId);
    expect(await getSubscriptionSummary(sql,userId,{environment:'test',now,subscriptionId:old.subscriptionId})).toMatchObject({id:old.subscriptionId,status:'ended'});
    expect(await getSubscriptionSummary(sql,userId,{environment:'test',subscriptionId:randomUUID()})).toBeNull();
    expect(await getSubscriptionSummary(sql,userId,{environment:'live',subscriptionId:old.subscriptionId})).toBeNull();
  });

  it('grants only after charge and duplicate callbacks use one issue, charge and period', async () => {
    const r = await begin();
    expect((await summary())?.hasAccess).toBe(false);
    const input = {subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'};
    expect((await completeSubscription(deps,viewer,input)).ok).toBe(true);
    expect((await completeSubscription(deps,viewer,input)).ok).toBe(true);
    expect(gateway.charge).toHaveBeenCalledTimes(1); expect(gateway.issue).toHaveBeenCalledTimes(1);
    expect((await summary())?.hasAccess).toBe(true);
    expect((await sql.query('select * from creator_subscription_periods')).rows).toHaveLength(1);
    const stored = JSON.stringify((await sql.query('select * from creator_subscriptions')).rows);
    expect(stored).not.toContain('private-billing-token'); expect(stored).not.toContain('authorized-test');
  });
  it('serializes concurrent authorization callbacks before provider issuance', async () => {
    const r = await begin();
    const input = {subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'};
    await Promise.all([completeSubscription(deps,viewer,input),completeSubscription(deps,viewer,input)]);
    expect(gateway.issue).toHaveBeenCalledTimes(1); expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('expires an abandoned authorization after its registration and issue lease expire', async () => {
    gateway.issue=vi.fn(async()=>{throw new Error('response lost');});
    const old=await begin();
    expect(await completeSubscription(deps,viewer,{subscriptionId:old.subscriptionId,customerKey:old.customerKey,authKey:'authorized-test'})).toMatchObject({ok:false,code:'authorization_pending'});
    expect(await beginSubscription(deps,viewer,{planId:'creator',locale:'ko',consentVersion})).toMatchObject({ok:false,code:'subscription_exists'});
    now=new Date(now.getTime()+31*60_000);
    const next=await begin();
    expect(next.subscriptionId).not.toBe(old.subscriptionId);
    expect((await sql.query<{status:string}>('select status from creator_subscriptions where id=$1',[old.subscriptionId])).rows[0]?.status).toBe('ended');
    expect(gateway.charge).not.toHaveBeenCalled();
  });
  it('keeps an in-flight authorization protected even after registration expires', async () => {
    const old=await begin();
    now=new Date(now.getTime()+29.9*60_000);
    gateway.issue=vi.fn(async()=>{throw new Error('response lost');});
    await completeSubscription(deps,viewer,{subscriptionId:old.subscriptionId,customerKey:old.customerKey,authKey:'authorized-test'});
    now=new Date(now.getTime()+30_000);
    expect(await beginSubscription(deps,viewer,{planId:'creator',locale:'ko',consentVersion})).toMatchObject({ok:false,code:'subscription_exists'});
    now=new Date(now.getTime()+181_000);
    expect((await begin()).subscriptionId).not.toBe(old.subscriptionId);
  });
  it('ends a definitively rejected authorization so a fresh registration can begin', async () => {
    gateway.issue=vi.fn(async()=>{throw new TossError('HTTP_400',false);});
    const old=await begin();
    expect(await completeSubscription(deps,viewer,{subscriptionId:old.subscriptionId,customerKey:old.customerKey,authKey:'bad-auth'})).toMatchObject({ok:false,code:'authorization_failed'});
    expect((await begin()).subscriptionId).not.toBe(old.subscriptionId);
    expect(gateway.charge).not.toHaveBeenCalled();
  });
  it('a late issue response cannot revive an expired registration or charge its replacement', async () => {
    let finishIssue!: (value:{billingKey:string;customerKey:string})=>void;
    let enteredIssue!: ()=>void;
    const issued=new Promise<void>(resolve=>{enteredIssue=resolve;});
    gateway.issue=vi.fn(async()=>{enteredIssue();return new Promise<{billingKey:string;customerKey:string}>(resolve=>{finishIssue=resolve;});});
    const old=await begin();
    const completion=completeSubscription(deps,viewer,{subscriptionId:old.subscriptionId,customerKey:old.customerKey,authKey:'authorized-test'});
    await issued;now=new Date(now.getTime()+31*60_000);
    const next=await begin();
    finishIssue({billingKey:'late-private-token',customerKey:old.customerKey});
    expect(await completion).toMatchObject({ok:false,code:'already_processed'});
    expect(next.subscriptionId).not.toBe(old.subscriptionId);expect(gateway.charge).not.toHaveBeenCalled();
    expect(gateway.revokeBillingKey).toHaveBeenCalledTimes(1);
    expect((await sql.query<{status:string;encrypted_key:string|null}>('select status,encrypted_key from creator_subscription_key_cleanup')).rows[0]).toEqual({status:'revoked',encrypted_key:null});
  });
  it('stores an encrypted orphan audit when billing-key persistence and immediate deletion fail, then retries cleanup', async () => {
    const original=sql.query.bind(sql);let failed=false;
    deps.sql={...sql,query:async <T>(text:string,params?:unknown[])=>{
      if (!failed && text.includes('set billing_key_ciphertext=$2')) {failed=true;throw new Error('storage failure');}
      return original<T>(text,params);
    }};
    gateway.revokeBillingKey=vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(undefined);
    const r=await begin();
    expect(await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'})).toMatchObject({ok:false,code:'key_cleanup_pending'});
    const audits=(await sql.query('select * from creator_subscription_key_cleanup')).rows;
    expect(audits).toHaveLength(1);expect(JSON.stringify(audits)).not.toContain('private-billing-token');
    expect(audits[0]).toMatchObject({status:'pending',failure_code:'key_revoke_pending'});
    expect(gateway.charge).not.toHaveBeenCalled();expect((await summary())?.status).toBe('ended');
    now=new Date(now.getTime()+181_000);await processSubscriptionRenewals(deps,{limit:2,now});
    expect(gateway.revokeBillingKey).toHaveBeenCalledTimes(2);
    expect((await sql.query('select status,encrypted_key from creator_subscription_key_cleanup')).rows[0]).toEqual({status:'revoked',encrypted_key:null});
  });
  it('does not revoke a successfully stored key when only the database acknowledgement was lost', async () => {
    const original=sql.query.bind(sql);let failed=false;
    deps.sql={...sql,query:async <T>(text:string,params?:unknown[])=>{
      const result=await original<T>(text,params);
      if (!failed && text.includes('set billing_key_ciphertext=$2')) {failed=true;throw new Error('acknowledgement lost');}
      return result;
    }};
    await activate();expect(gateway.revokeBillingKey).not.toHaveBeenCalled();
    expect((await summary())?.hasAccess).toBe(true);expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('maintenance finishes an issued key whose callback stopped before period creation', async () => {
    const started=await begin();
    await sql.query(`update creator_subscriptions set status='authorizing',anchor_at=$2,billing_key_ciphertext=$3 where id=$1`,
      [started.subscriptionId,now,deps.cipher.encrypt('private-billing-token',`test:${started.subscriptionId}`)]);
    await processSubscriptionRenewals(deps,{limit:2,now});
    expect((await summary())?.hasAccess).toBe(true);
    expect(gateway.issue).not.toHaveBeenCalled();expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('reports actionable work without starting network calls when the wall-time budget is exhausted', async () => {
    await activate();now=new Date('2028-02-28T15:30:00.000Z');
    expect(await processSubscriptionRenewals(deps,{limit:2,now,budgetMs:1})).toMatchObject({processed:0,hasMore:true,remaining:1});
    expect(gateway.charge).toHaveBeenCalledTimes(1);
    expect(await processSubscriptionRenewals(deps,{limit:2,now,budgetMs:250_000})).toMatchObject({processed:1,hasMore:false,remaining:0});
  });
  it('isolates test orders and allowances from live execution and other accounts', async () => {
    const r = await activate();
    expect(await getSubscriptionSummary(sql,userId)).toBeNull();
    expect(await reserveSubscriptionUsage(sql,{userId,renderRef:randomUUID(),units:1,environment:'live',now})).toMatchObject({ok:false});
    expect(await completeSubscription({...deps,environment:'live'},viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'})).toMatchObject({ok:false});
    expect(await cancelSubscription(deps,{...viewer,userId:randomUUID()},r.subscriptionId)).toMatchObject({ok:false});
  });
  it('cancels next renewal while keeping already-paid access until expiry', async () => {
    const r = await activate();
    expect(await cancelSubscription(deps,viewer,r.subscriptionId)).toMatchObject({ok:true});
    expect((await summary())?.hasAccess).toBe(true);
    now = new Date('2028-02-28T15:30:00.000Z');
    await processSubscriptionRenewals(deps,{limit:10,now});
    expect((await summary())?.hasAccess).toBe(false); expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('cancellation atomically fails an unstarted pending renewal while preserving this paid month', async () => {
    const r=await activate();
    await sql.query(`insert into creator_subscription_periods(id,subscription_id,period_index,environment,starts_at,ends_at,amount_krw,monthly_units)
      values($1,$2,1,'test','2028-02-28T15:30:00Z','2028-03-30T15:30:00Z',24900,604)`,[randomUUID(),r.subscriptionId]);
    await cancelSubscription(deps,viewer,r.subscriptionId);
    expect((await sql.query('select status,failure_code from creator_subscription_periods where period_index=1')).rows[0]).toEqual({status:'failed',failure_code:'canceled_before_charge'});
    expect((await summary())?.hasAccess).toBe(true);
    now=new Date('2028-02-28T15:30:00Z');await processSubscriptionRenewals(deps,{limit:2,now});
    expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('renews only once per original-anchor month and never rolls remaining units forward', async () => {
    await activate(); await reserve(randomUUID(),600);
    now = new Date('2028-02-28T15:30:00.000Z');
    await processSubscriptionRenewals(deps,{limit:10,now});
    await processSubscriptionRenewals(deps,{limit:10,now});
    expect(gateway.charge).toHaveBeenCalledTimes(2);
    expect(await summary()).toMatchObject({remainingPercent:100,periodEnd:'2028-03-30T15:30:00.000Z'});
  });
  it('reconciles an approved-but-timed-out charge without charging again', async () => {
    const original = gateway.charge;
    gateway.charge = vi.fn(async input => { await original(input); throw new Error('timeout'); });
    const r = await begin();
    expect(await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'})).toMatchObject({ok:false,code:'payment_pending'});
    expect((await summary())?.hasAccess).toBe(false);
    now = new Date(now.getTime()+181_000);
    await processSubscriptionRenewals(deps,{limit:10,now});
    expect(gateway.charge).toHaveBeenCalledTimes(1); expect((await summary())?.hasAccess).toBe(true);
  });
  it('never blindly retries a timeout when provider lookup fails', async () => {
    gateway.charge = vi.fn(async () => {throw new Error('timeout');});
    gateway.retrieveOrder = vi.fn(async () => {throw new Error('lookup outage');});
    const r = await begin(); await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    now = new Date(now.getTime()+181_000); await processSubscriptionRenewals(deps,{limit:10,now});
    expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('same-order retry follows a confirmed not-found query and uses identical idempotency', async () => {
    gateway.charge = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockImplementation(async ({orderId,amount}) => {
      const p={orderId,paymentKey:randomUUID(),amount,balance:amount,currency:'KRW',status:'DONE'};payments.set(orderId,p);return p;
    });
    const r = await begin();await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    now = new Date(now.getTime()+181_000);await processSubscriptionRenewals(deps,{limit:10,now});
    const calls=vi.mocked(gateway.charge).mock.calls;
    expect(calls).toHaveLength(2);expect(calls[1]![0]).toEqual(calls[0]![0]);expect(gateway.retrieveOrder).toHaveBeenCalled();
  });
  it('a definitive provider rejection becomes past due only after a confirmed missing order', async () => {
    gateway.charge=vi.fn(async()=>{throw new TossError('HTTP_400',false);});
    const r=await begin();await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    now=new Date(now.getTime()+181_000);await processSubscriptionRenewals(deps,{limit:10,now});
    expect(gateway.charge).toHaveBeenCalledTimes(1);expect(gateway.retrieveOrder).toHaveBeenCalledTimes(1);
    expect(await summary()).toMatchObject({status:'past_due',hasAccess:false});
  });
  it('never retries an unknown charge after the bounded idempotency recovery window', async () => {
    gateway.charge=vi.fn(async()=>{throw new Error('timeout');});
    const r=await begin();await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    now=new Date(now.getTime()+2*86400_000);await processSubscriptionRenewals(deps,{limit:10,now});
    expect(gateway.charge).toHaveBeenCalledTimes(1);expect((await summary())?.hasAccess).toBe(false);
  });
  it.each(['window','attempts','canceled','expired'])('stops automatic recovery for a confirmed absent %s charge without permitting a new contract',async reason=>{
    gateway.charge=vi.fn(async()=>{throw new Error('timeout');});
    const r=await begin();await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    now=new Date(now.getTime()+181_000);
    if(reason==='window')now=new Date(now.getTime()+2*86400_000);
    if(reason==='attempts')await sql.query('update creator_subscription_periods set attempts=3');
    if(reason==='canceled')await cancelSubscription(deps,viewer,r.subscriptionId);
    if(reason==='expired')now=new Date('2028-03-01T00:00:00Z');
    await processSubscriptionRenewals(deps,{limit:2,now});
    expect((await sql.query('select status,failure_code,lease_until from creator_subscription_periods')).rows[0])
      .toEqual({status:'failed',failure_code:'charge_exhausted_review',lease_until:null});
    expect(await summary()).toMatchObject({status:'past_due',cancelAtPeriodEnd:true,nextBillingAt:null,hasAccess:false});
    expect(await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'}))
      .toMatchObject({ok:false,code:'payment_review_required'});
    await cancelSubscription(deps,viewer,r.subscriptionId);
    expect(await beginSubscription(deps,viewer,{planId:'creator',locale:'ko',consentVersion})).toMatchObject({ok:false,code:'subscription_exists'});
    const lookups=vi.mocked(gateway.retrieveOrder).mock.calls.length;
    expect(await processSubscriptionRenewals(deps,{limit:2,now})).toMatchObject({processed:0,hasMore:false});
    expect(gateway.retrieveOrder).toHaveBeenCalledTimes(lookups);expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('keeps an exhausted charge ambiguous when the provider lookup itself fails',async()=>{
    gateway.charge=vi.fn(async()=>{throw new Error('timeout');});
    gateway.retrieveOrder=vi.fn(async()=>{throw new Error('lookup timeout');});
    const r=await begin();await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    now=new Date(now.getTime()+2*86400_000);await processSubscriptionRenewals(deps,{limit:2,now});
    expect((await sql.query('select status from creator_subscription_periods')).rows[0]).toEqual({status:'charging'});
    expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it.each([{paidFirst:false,expired:false},{paidFirst:true,expired:false},{paidFirst:false,expired:true}])('reconciles a late original success around review (paid first: $paidFirst, expired: $expired)',async({paidFirst,expired})=>{
    let finishCharge!:(p:TossPayment)=>void;let chargeInput!:{orderId:string;amount:number};let entered!:()=>void;
    const enteredCharge=new Promise<void>(resolve=>{entered=resolve;});
    gateway.charge=vi.fn(async input=>{chargeInput=input;entered();return new Promise<TossPayment>(resolve=>{finishCharge=resolve;});});
    const r=await begin();const completion=completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    await enteredCharge;now=expired?new Date('2028-03-01T00:00:00Z'):new Date(now.getTime()+2*86400_000);
    const payment:TossPayment={orderId:chargeInput.orderId,paymentKey:randomUUID(),amount:chargeInput.amount,balance:chargeInput.amount,currency:'KRW',status:'DONE'};
    if(paidFirst){
      let finishLookup!:(p:null)=>void;let queried!:()=>void;const lookup=new Promise<void>(resolve=>{queried=resolve;});
      gateway.retrieveOrder=vi.fn(async()=>{queried();return new Promise<null>(resolve=>{finishLookup=resolve;});});
      const recovery=processSubscriptionRenewals(deps,{limit:2,now});await lookup;
      payments.set(payment.orderId,payment);finishCharge(payment);expect(await completion).toMatchObject({ok:true});finishLookup(null);await recovery;
    }else{
      await processSubscriptionRenewals(deps,{limit:2,now});
      expect((await sql.query('select failure_code from creator_subscription_periods')).rows[0]).toEqual({failure_code:'charge_exhausted_review'});
      await cancelSubscription(deps,viewer,r.subscriptionId);
      payments.set(payment.orderId,payment);finishCharge(payment);
      expect(await completion).toMatchObject(expired?{ok:false,code:'refund_pending'}:{ok:true});
    }
    if(expired){
      expect(await summary()).toMatchObject({status:'refund_pending',hasAccess:false});
      await processSubscriptionRenewals(deps,{limit:2,now});expect(gateway.cancel).toHaveBeenCalledTimes(1);
    }
    expect(await summary()).toMatchObject({status:expired?'refunded':'active',hasAccess:!expired});
    expect((await sql.query('select status,failure_code from creator_subscription_periods')).rows[0]).toEqual({status:expired?'refunded':'paid',failure_code:null});
    expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
  it('rechecks cancellation after a slow absent-order lookup before permitting a retry',async()=>{
    gateway.charge=vi.fn(async()=>{throw new Error('timeout');});
    const r=await begin();await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'});
    let finishLookup!:(p:null)=>void;let queried!:()=>void;const lookup=new Promise<void>(resolve=>{queried=resolve;});
    gateway.retrieveOrder=vi.fn(async()=>{queried();return new Promise<null>(resolve=>{finishLookup=resolve;});});
    now=new Date(now.getTime()+181_000);const recovery=processSubscriptionRenewals(deps,{limit:2,now});await lookup;
    await cancelSubscription(deps,viewer,r.subscriptionId);finishLookup(null);await recovery;
    expect(gateway.charge).toHaveBeenCalledTimes(1);
    expect((await sql.query('select failure_code from creator_subscription_periods')).rows[0]).toEqual({failure_code:'charge_exhausted_review'});
  });
  it('two renewal workers cannot issue two charges for the same month', async () => {
    await activate();now=new Date('2028-02-28T15:30:00.000Z');
    await Promise.all([processSubscriptionRenewals(deps,{limit:10,now}),processSubscriptionRenewals(deps,{limit:10,now})]);
    expect(gateway.charge).toHaveBeenCalledTimes(2);
    expect((await sql.query('select * from creator_subscription_periods')).rows).toHaveLength(2);
  });
  it('prevents overspend, duplicate reservation and double release', async () => {
    await activate(); const ref = randomUUID();
    expect(await reserve(ref,600)).toMatchObject({ok:true,remainingUnits:4});
    expect(await reserve(ref,600)).toMatchObject({ok:true,alreadyReserved:true,remainingUnits:4});
    expect(await reserve(randomUUID(),5)).toMatchObject({ok:false,code:'insufficient_allowance'});
    await settleSubscriptionUsage(sql,ref,'failed');await settleSubscriptionUsage(sql,ref,'failed');
    expect((await summary())?.remainingPercent).toBe(100);
    expect(await reserve(ref,600)).toMatchObject({ok:false,code:'reservation_released'});
  });
  it('settled consumption cannot be undone by a later duplicate failure', async () => {
    await activate(); const ref=randomUUID();await reserve(ref,100);
    await settleSubscriptionUsage(sql,ref,'completed');await settleSubscriptionUsage(sql,ref,'failed');
    expect((await sql.query<{consumed_units:number}>('select consumed_units from creator_subscription_periods')).rows[0]!.consumed_units).toBe(100);
  });
  it('serializes concurrent reservations so their total cannot exceed the allowance', async () => {
    await activate();
    const result=await Promise.all([reserve(randomUUID(),400),reserve(randomUUID(),400)]);
    expect(result.filter(r=>r.ok)).toHaveLength(1);
    expect((await sql.query<{reserved_units:number}>('select reserved_units from creator_subscription_periods')).rows[0]!.reserved_units).toBe(400);
  });
  it('refund and a simultaneous new reservation have exactly one winner', async () => {
    const r=await activate();
    const results=await Promise.all([refundUnusedSubscription(deps,viewer,r.subscriptionId),reserve(randomUUID())]);
    expect(results.filter(r=>r.ok)).toHaveLength(1);
  });
  it('rejects an approved provider response with the wrong amount without granting access', async () => {
    const original=gateway.charge;gateway.charge=vi.fn(async input=>({...await original(input),amount:1}));
    const r=await begin();
    expect(await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'})).toMatchObject({ok:false,code:'payment_review_required'});
    expect((await summary())?.hasAccess).toBe(false);
  });
  it('a DONE payment with unexpected balance stops renewal and enters explicit review without retrying', async () => {
    const original=gateway.charge;gateway.charge=vi.fn(async input=>({...await original(input),balance:1}));
    const r=await begin();
    expect(await completeSubscription(deps,viewer,{subscriptionId:r.subscriptionId,customerKey:r.customerKey,authKey:'authorized-test'})).toMatchObject({ok:false,code:'payment_review_required'});
    expect(await summary()).toMatchObject({status:'past_due',cancelAtPeriodEnd:true,hasAccess:false});
    now=new Date(now.getTime()+181_000);await processSubscriptionRenewals(deps,{limit:2,now});
    expect(gateway.charge).toHaveBeenCalledTimes(1);expect(gateway.retrieveOrder).not.toHaveBeenCalled();
    expect((await sql.query('select failure_code from creator_subscription_periods')).rows[0]).toEqual({failure_code:'provider_review_required'});
  });
  it('avoids retroactive charges after multiple months of scheduler downtime', async () => {
    await activate();now=new Date('2028-05-01T12:00:00+09:00');
    await processSubscriptionRenewals(deps,{limit:10,now});
    expect(gateway.charge).toHaveBeenCalledTimes(2);
    expect(await summary()).toMatchObject({periodStart:'2028-04-29T15:30:00.000Z',periodEnd:'2028-05-30T15:30:00.000Z'});
  });
  it('releasing an old-period render never increases a new period allowance', async () => {
    await activate();const ref=randomUUID();await reserve(ref,600);
    now=new Date('2028-02-28T15:30:00.000Z');await processSubscriptionRenewals(deps,{limit:10,now});
    await reserve(randomUUID(),100);await settleSubscriptionUsage(sql,ref,'failed');
    const periods=(await sql.query<{reserved_units:number}>('select reserved_units from creator_subscription_periods order by period_index')).rows;
    expect(periods.map(p=>p.reserved_units)).toEqual([0,100]);
  });
  it('refund locks out usage and requires the entire current period to be unused', async () => {
    const r=await activate();const ref=randomUUID();await reserve(ref);
    expect(await refundUnusedSubscription(deps,viewer,r.subscriptionId)).toMatchObject({ok:false,code:'period_used'});
    await settleSubscriptionUsage(sql,ref,'failed');
    expect(await refundUnusedSubscription(deps,viewer,r.subscriptionId)).toMatchObject({ok:true});
    expect(await reserve(randomUUID())).toMatchObject({ok:false});expect(gateway.cancel).toHaveBeenCalledTimes(1);
    expect(await refundUnusedSubscription(deps,viewer,r.subscriptionId)).toMatchObject({ok:true});expect(gateway.cancel).toHaveBeenCalledTimes(1);
  });
  it('retains refund_pending after an ambiguous refund and reconciles without double cancel', async () => {
    const r=await activate();const original=gateway.cancel;
    gateway.cancel=vi.fn(async input=>{await original(input);throw new Error('timeout');});
    expect(await refundUnusedSubscription(deps,viewer,r.subscriptionId)).toMatchObject({ok:false,code:'refund_pending'});
    expect(await reserve(randomUUID())).toMatchObject({ok:false});
    now=new Date(now.getTime()+181_000);await processSubscriptionRenewals(deps,{limit:10,now});
    expect(gateway.cancel).toHaveBeenCalledTimes(1);expect((await summary())?.status).toBe('refunded');
  });
  it('checks Premium eligibility from a paid row and rejects quote-only access', async () => {
    expect(await reserve(randomUUID())).toMatchObject({ok:false});await activate();
    expect(await reserveSubscriptionUsage(sql,{userId,renderRef:randomUUID(),units:10,environment:'test',now,premium:true})).toMatchObject({ok:false,code:'premium_required'});
  });
  it('probes RLS and browser privilege protection; no client can read billing ciphertext', async () => {
    expect(await subscriptionSchemaReady(sql)).toBe(true);
    await db.exec('set role authenticated');
    await expect(sql.query('select * from creator_subscriptions')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
});
