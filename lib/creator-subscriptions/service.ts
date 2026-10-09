import { createHash, randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { TossError, type TossPayment } from '@/lib/billing/toss-gateway';
import { billingBoundary, currentBillingIndex, isSubscriptionPlan, SUBSCRIPTION_PLANS, SUBSCRIPTION_PLAN_VERSION } from './plans';
import { loadSubscription, UUID } from './repo';
import type { Failure, PeriodRow, SubscriptionDeps, SubscriptionRow } from './types';

export { getSubscriptionSummary } from './repo';

export type SubscriptionResult = { ok: true; subscriptionId: string } | Failure;
const fail = (code: string): Failure => ({ok:false,code});
const clock = (deps: SubscriptionDeps) => deps.now?.() ?? new Date();
const consistent = (deps: SubscriptionDeps) => deps.environment === deps.gateway.kind;
const context = (s: SubscriptionRow) => `${s.environment}:${s.id}`;
// Recovery/refund can perform a 65-second lookup followed by a 65-second mutation.
const lease = (now: Date) => new Date(now.getTime()+180_000);

interface KeyCleanup { id:string;subscription_id:string;environment:'test'|'live';key_fingerprint:string;encrypted_key:string|null;status:'pending'|'revoked' }
const cleanupContext=(environment:string,fingerprint:string)=>`${environment}:cleanup:${fingerprint}`;
async function queueKeyCleanup(deps:SubscriptionDeps,sql:SqlRunner,s:SubscriptionRow,billingKey:string):Promise<string> {
  const fingerprint=createHash('sha256').update(billingKey).digest('hex');
  const encrypted=deps.cipher.encrypt(billingKey,cleanupContext(s.environment,fingerprint));
  const {rows}=await sql.query<{id:string}>(`insert into creator_subscription_key_cleanup(id,subscription_id,environment,key_fingerprint,encrypted_key)
    values($1,$2,$3,$4,$5) on conflict(environment,key_fingerprint) do update set subscription_id=creator_subscription_key_cleanup.subscription_id returning id`,
    [randomUUID(),s.id,s.environment,fingerprint,encrypted]);
  return rows[0]!.id;
}
async function cleanupKey(deps:SubscriptionDeps,id:string):Promise<boolean> {
  const now=clock(deps);
  const {rows}=await deps.sql.query<KeyCleanup>(`update creator_subscription_key_cleanup set lease_until=$3
    where id=$1 and environment=$2 and status='pending' and (lease_until is null or lease_until <= $4) returning *`,
    [id,deps.environment,lease(now),now]);
  const row=rows[0];if (!row || !row.encrypted_key) return false;
  try {
    await deps.gateway.revokeBillingKey({billingKey:deps.cipher.decrypt(row.encrypted_key,cleanupContext(row.environment,row.key_fingerprint)),
      idempotencyKey:`sub-key-revoke-${row.key_fingerprint}`});
    await deps.sql.query(`update creator_subscription_key_cleanup set status='revoked',encrypted_key=null,lease_until=null,
      failure_code=null,revoked_at=$2 where id=$1`,[id,clock(deps)]);
    return true;
  } catch {
    await deps.sql.query(`update creator_subscription_key_cleanup set failure_code='key_revoke_pending' where id=$1 and status='pending'`,[id]);
    return false;
  }
}
/** Compensate only an unadopted key: an uncertain DB write may have actually saved it. */
async function recoverIssuedKey(deps:SubscriptionDeps,original:SubscriptionRow,billingKey:string):Promise<'adopted'|'revoked'|'cleanup_pending'> {
  let cleanupId:string|null=null;
  try {
    const result=await deps.sql.transaction(async tx => {
      const current=await loadSubscription(tx,original.id,true);
      if (current?.billing_key_ciphertext && !current.cancel_at_period_end && ['authorizing','active'].includes(current.status)
        && deps.cipher.decrypt(current.billing_key_ciphertext,context(current))===billingKey) return 'adopted' as const;
      await tx.query(`update creator_subscriptions set status='ended',auth_lease_until=null,updated_at=$2
        where id=$1 and status='authorizing' and billing_key_ciphertext is null`,[original.id,clock(deps)]);
      return queueKeyCleanup(deps,tx,original,billingKey);
    });
    if (result==='adopted') return result;
    cleanupId=result;
  } catch {
    // A database outage can prevent even an encrypted audit write. Try provider compensation;
    // if both stores are unavailable, retain the authorization row and surface an operator error.
    try {
      const fingerprint=createHash('sha256').update(billingKey).digest('hex');
      await deps.gateway.revokeBillingKey({billingKey,idempotencyKey:`sub-key-revoke-${fingerprint}`});
      return 'revoked';
    } catch { throw new Error('billing_key_cleanup_unrecorded'); }
  }
  return await cleanupKey(deps,cleanupId) ? 'revoked' : 'cleanup_pending';
}

export async function beginSubscription(deps: SubscriptionDeps, viewer: Viewer, input: {
  planId: string; locale: string; consentVersion: string;
}): Promise<{ok:true;subscriptionId:string;customerKey:string;planId:'creator'|'premium';amountKrw:number} | Failure> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!consistent(deps)) return fail('unavailable');
  if (!isSubscriptionPlan(input.planId) || !['ko','en'].includes(input.locale)) return fail('bad_request');
  if (!deps.consentVersion || input.consentVersion !== deps.consentVersion) return fail('consent_required');
  const planId = input.planId;
  const plan = SUBSCRIPTION_PLANS[planId];
  const now = clock(deps);
  return deps.sql.transaction(async tx => {
    // Also serializes the absence of a subscription so two tabs cannot register two billing keys.
    // NO KEY UPDATE also permits the FK KEY SHARE check of an in-flight usage reservation.
    const owner = await tx.query('select id from profiles where id=$1 for no key update',[viewer.userId]);
    if (!owner.rows.length) return fail('sign_in_required');
    await tx.query(`update creator_subscriptions set status='ended',updated_at=$3 where user_id=$1 and environment=$2
      and billing_key_ciphertext is null and expires_at <= $3
      and (status='awaiting_auth' or (status='authorizing' and (auth_lease_until is null or auth_lease_until <= $3)))`,[viewer.userId,deps.environment,now]);
    const old = (await tx.query<SubscriptionRow>(`select * from creator_subscriptions where user_id=$1 and environment=$2
      and status not in ('ended','refunded')`,[viewer.userId,deps.environment])).rows[0];
    if (old) {
      if (old.status === 'awaiting_auth' && old.plan_id === planId && old.consent_version === deps.consentVersion)
        return {ok:true,subscriptionId:old.id,customerKey:old.customer_key,planId,amountKrw:old.amount_krw};
      return fail('subscription_exists');
    }
    const premiumEditLimit=planId==='premium' ? deps.premiumEditLimit : null;
    if (planId==='premium' && (premiumEditLimit==null || !Number.isInteger(premiumEditLimit)
      || premiumEditLimit<30 || premiumEditLimit>1000)) return fail('unavailable');
    const count = (await tx.query<{n:number}>('select count(*)::int n from creator_subscriptions where user_id=$1 and created_at>$2',
      [viewer.userId,new Date(now.getTime()-86400_000)])).rows[0]?.n ?? 0;
    if (count >= 10) return fail('rate_limited');
    const id = randomUUID(); const customerKey = randomUUID();
    await tx.query(`insert into creator_subscriptions(id,user_id,environment,plan_id,plan_version,amount_krw,monthly_units,
      consent_version,consent_at,locale,customer_key,expires_at,created_at,updated_at,premium_edit_limit)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$9,$9,$13)`,
      [id,viewer.userId,deps.environment,planId,SUBSCRIPTION_PLAN_VERSION,plan.amountKrw,plan.monthlyUnits,
        deps.consentVersion,now,input.locale,customerKey,new Date(now.getTime()+30*60_000),premiumEditLimit]);
    return {ok:true,subscriptionId:id,customerKey,planId,amountKrw:plan.amountKrw};
  });
}

export async function completeSubscription(deps: SubscriptionDeps, viewer: Viewer, input: {
  subscriptionId: string; authKey: string; customerKey: string;
}): Promise<SubscriptionResult> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!consistent(deps)) return fail('unavailable');
  if (!UUID.test(input.subscriptionId) || !input.authKey || input.authKey.length>300 || !input.customerKey || input.customerKey.length>50)
    return fail('bad_request');
  const now = clock(deps);
  const fingerprint = createHash('sha256').update(input.authKey).digest('hex');
  const claimed = await deps.sql.transaction(async tx => {
    const s = await loadSubscription(tx,input.subscriptionId,true);
    if (!s || s.user_id !== viewer.userId) return fail('not_found');
    if (s.environment !== deps.environment || s.customer_key !== input.customerKey) return fail('unavailable');
    if (s.status === 'active') return {ok:true as const,subscriptionId:s.id};
    if(s.status==='past_due' && (await tx.query(`select id from creator_subscription_periods where subscription_id=$1
      and status='failed' and failure_code in ('charge_exhausted_review','provider_review_required')`,[s.id])).rows.length)
      return fail('payment_review_required');
    if (s.cancel_at_period_end || !['awaiting_auth','authorizing'].includes(s.status)) return fail('already_processed');
    if (s.billing_key_ciphertext) return s;
    if (new Date(s.expires_at)<=now) return fail('expired');
    if (s.auth_fingerprint && s.auth_fingerprint !== fingerprint) return fail('authorization_mismatch');
    if (s.auth_lease_until && new Date(s.auth_lease_until)>now) return fail('authorization_pending');
    await tx.query(`update creator_subscriptions set status='authorizing',auth_fingerprint=$2,auth_lease_until=$3,updated_at=$4 where id=$1`,
      [s.id,fingerprint,lease(now),now]);
    return s;
  });
  if ('ok' in claimed) return claimed;
  if (!claimed.billing_key_ciphertext) {
    let issuedKey:string|null=null;
    try {
      const issued = await deps.gateway.issue({authKey:input.authKey,customerKey:claimed.customer_key,idempotencyKey:`sub-auth-${claimed.id}`});
      if (issued.customerKey !== claimed.customer_key) return fail('provider_mismatch');
      issuedKey=issued.billingKey;
      const encrypted = deps.cipher.encrypt(issued.billingKey,context(claimed));
      const saved = await deps.sql.query(`update creator_subscriptions set billing_key_ciphertext=$2,anchor_at=$3,auth_lease_until=null,updated_at=$3
        where id=$1 and status='authorizing' and cancel_at_period_end=false returning id`,[claimed.id,encrypted,now]);
      if (!saved.rows.length) {
        const recovered=await recoverIssuedKey(deps,claimed,issuedKey);
        if (recovered!=='adopted') return fail(recovered==='revoked'?'already_processed':'key_cleanup_pending');
      }
    } catch (error) {
      if (issuedKey) {
        const recovered=await recoverIssuedKey(deps,claimed,issuedKey);
        if (recovered!=='adopted') return fail(recovered==='revoked'?'authorization_failed':'key_cleanup_pending');
      } else {
      if (error instanceof TossError && ['HTTP_400','HTTP_401','HTTP_403'].includes(error.code)) {
        // Issuance does not charge. A definite rejection can end only OUR still-keyless claim.
        // A transport failure remains authorizing until the callback retries or registration expires.
        await deps.sql.query(`update creator_subscriptions set status='ended',auth_lease_until=null,updated_at=$4
          where id=$1 and status='authorizing' and billing_key_ciphertext is null
          and auth_fingerprint=$2 and auth_lease_until=$3`,[claimed.id,fingerprint,lease(now),now]);
        return fail('authorization_failed');
      }
      return fail('authorization_pending');
      }
    }
  }
  const period = await ensurePeriod(deps,claimed.id,0);
  return period ? chargePeriod(deps,period.id) : fail('payment_pending');
}

async function ensurePeriod(deps: SubscriptionDeps, subscriptionId: string, index: number): Promise<PeriodRow | null> {
  return deps.sql.transaction(async tx => {
    const s = await loadSubscription(tx,subscriptionId,true);
    if (!s || s.environment !== deps.environment || !s.anchor_at || !s.billing_key_ciphertext) return null;
    const old = (await tx.query<PeriodRow>('select * from creator_subscription_periods where subscription_id=$1 and period_index=$2',[s.id,index])).rows[0];
    if (old) return old;
    if (s.cancel_at_period_end || !['active','authorizing'].includes(s.status)) return null;
    const unsettled = await tx.query(`select id from creator_subscription_periods where subscription_id=$1 and status in ('pending','charging','refund_pending')`,[s.id]);
    if (unsettled.rows.length) return null;
    const anchor = new Date(s.anchor_at);
    return (await tx.query<PeriodRow>(`insert into creator_subscription_periods(id,subscription_id,period_index,environment,starts_at,ends_at,amount_krw,monthly_units)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[randomUUID(),s.id,index,s.environment,billingBoundary(anchor,index),billingBoundary(anchor,index+1),s.amount_krw,s.monthly_units])).rows[0] ?? null;
  });
}
function matches(p: TossPayment, o: PeriodRow): boolean {
  return p.orderId === o.id && p.amount === o.amount_krw && p.currency === 'KRW' && (!o.payment_key || p.paymentKey === o.payment_key);
}
async function acceptPayment(deps: SubscriptionDeps, p: TossPayment, order: PeriodRow): Promise<SubscriptionResult> {
  const now = clock(deps);
  return deps.sql.transaction(async tx => {
    const s = await loadSubscription(tx,order.subscription_id,true);
    const o = (await tx.query<PeriodRow>('select * from creator_subscription_periods where id=$1 for update',[order.id])).rows[0];
    if (!s || s.environment !== deps.environment || !o || o.environment !== deps.environment) return fail('unavailable');
    if (o.status === 'paid') return {ok:true,subscriptionId:s.id};
    // A prior not-found lookup cannot rule out a delayed original POST. Its actual response
    // remains authoritative even after automatic retries were stopped for operator review.
    if (o.status !== 'charging' && !(o.status==='failed' && o.failure_code==='charge_exhausted_review')) return fail('payment_pending');
    if (!matches(p,o) || (p.status==='DONE' && p.balance!==o.amount_krw)) {
      await tx.query(`update creator_subscription_periods set status='failed',failure_code='provider_review_required',lease_until=null where id=$1`,[o.id]);
      await tx.query(`update creator_subscriptions set status='past_due',cancel_at_period_end=true,next_billing_at=null,updated_at=$2 where id=$1`,[s.id,now]);
      return fail('payment_review_required');
    }
    if (p.status !== 'DONE' || p.balance !== o.amount_krw) {
      if (['ABORTED','EXPIRED','CANCELED'].includes(p.status)) {
        await tx.query(`update creator_subscription_periods set status='failed',failure_code='provider_declined',lease_until=null where id=$1`,[o.id]);
        await tx.query(`update creator_subscriptions set status='past_due',next_billing_at=null,updated_at=$2 where id=$1`,[s.id,now]);
        return fail('payment_failed');
      }
      return fail('payment_pending');
    }
    const expired = new Date(o.ends_at)<=now;
    await tx.query(`update creator_subscription_periods set status=$2,payment_key=$3,paid_at=$4,lease_until=null,failure_code=null where id=$1`,
      [o.id,expired?'refund_pending':'paid',p.paymentKey,now]);
    await tx.query(`update creator_subscriptions set status=$2,current_period_index=$3,next_billing_at=$4,
      cancel_at_period_end=cancel_at_period_end or $5,updated_at=$6 where id=$1`,
      [s.id,expired?'refund_pending':'active',o.period_index,expired?null:o.ends_at,expired,now]);
    return expired ? fail('refund_pending') : {ok:true,subscriptionId:s.id};
  });
}
/** Not-found is a point-in-time observation, not cancellation of a possibly delayed POST.
 * Stop bounded retries, preserve the contract/order for reconciliation, and never enable a
 * second enrollment based solely on this observation. A late response may still settle it.
 */
async function reviewAbsentCharge(deps:SubscriptionDeps,order:PeriodRow,claimedAt:Date):Promise<SubscriptionResult|null> {
  return deps.sql.transaction(async (tx):Promise<SubscriptionResult|null>=>{
    const s=await loadSubscription(tx,order.subscription_id,true);
    const o=(await tx.query<PeriodRow>('select * from creator_subscription_periods where id=$1 for update',[order.id])).rows[0];
    if(!s || !o || s.environment!==deps.environment || o.environment!==deps.environment)return fail('unavailable');
    if(o.status==='paid')return {ok:true,subscriptionId:s.id};
    if(o.status==='failed' && o.failure_code==='charge_exhausted_review')return fail('payment_review_required');
    if(o.status!=='charging' || !o.lease_until || new Date(o.lease_until).getTime()!==lease(claimedAt).getTime())return fail('payment_pending');
    const now=clock(deps);
    if(o.failure_code==='provider_rejected'){
      await tx.query(`update creator_subscription_periods set status='failed',lease_until=null where id=$1`,[o.id]);
      await tx.query(`update creator_subscriptions set status='past_due',next_billing_at=null,updated_at=$2 where id=$1`,[s.id,now]);
      return fail('payment_failed');
    }
    if(!s.cancel_at_period_end && new Date(o.ends_at)>now && o.attempts<3 && o.charge_started_at
      && now.getTime()-new Date(o.charge_started_at).getTime()<=86400_000)return null;
    await tx.query(`update creator_subscription_periods set status='failed',failure_code='charge_exhausted_review',lease_until=null where id=$1`,[o.id]);
    await tx.query(`update creator_subscriptions set status='past_due',cancel_at_period_end=true,next_billing_at=null,updated_at=$2 where id=$1`,[s.id,now]);
    return fail('payment_review_required');
  });
}
async function chargePeriod(deps: SubscriptionDeps, id: string): Promise<SubscriptionResult> {
  const now=clock(deps);
  const found=(await deps.sql.query<PeriodRow>('select * from creator_subscription_periods where id=$1',[id])).rows[0];
  if (!found) return fail('not_found');
  const claimed=await deps.sql.transaction(async (tx): Promise<{s:SubscriptionRow;o:PeriodRow}|SubscriptionResult> => {
    const s=await loadSubscription(tx,found.subscription_id,true);
    const o=(await tx.query<PeriodRow>('select * from creator_subscription_periods where id=$1 for update',[id])).rows[0];
    if (!s || !o || s.environment!==deps.environment || o.environment!==deps.environment || !s.billing_key_ciphertext) return fail('unavailable');
    if (o.status==='paid') return {ok:true as const,subscriptionId:s.id};
    if (!['pending','charging'].includes(o.status) || (o.lease_until && new Date(o.lease_until)>now)) return fail('payment_pending');
    if (o.status==='pending' && (s.cancel_at_period_end || new Date(o.ends_at)<=now)) {
      await tx.query(`update creator_subscription_periods set status='failed',failure_code='not_started' where id=$1`,[id]);
      return fail('already_processed');
    }
    await tx.query(`update creator_subscription_periods set status='charging',lease_until=$2,charge_started_at=coalesce(charge_started_at,$3) where id=$1`,[id,lease(now),now]);
    return {s,o};
  });
  if ('ok' in claimed) return claimed;
  const {s,o}=claimed;
  try {
    if (o.status==='charging') {
      const known=await deps.gateway.retrieveOrder(o.id);
      if (known) return await acceptPayment(deps,known,o);
      // A verified absent order may retry only its SAME order/key, within a bounded recovery window.
      const decision=await reviewAbsentCharge(deps,o,now);
      if(decision)return decision;
    }
    await deps.sql.query('update creator_subscription_periods set attempts=attempts+1 where id=$1',[o.id]);
    const payment=await deps.gateway.charge({billingKey:deps.cipher.decrypt(s.billing_key_ciphertext!,context(s)),
      customerKey:s.customer_key,orderId:o.id,orderName:SUBSCRIPTION_PLANS[s.plan_id].name,amount:o.amount_krw,idempotencyKey:`sub-charge-${o.id}`});
    return await acceptPayment(deps,payment,o);
  } catch (error) {
    // A deterministic rejection still requires a provider lookup before we mark the period failed.
    // 409/429 and transport failures stay ambiguous and must retain the same order identity.
    if (error instanceof TossError && ['HTTP_400','HTTP_401','HTTP_403'].includes(error.code))
      await deps.sql.query(`update creator_subscription_periods set failure_code='provider_rejected' where id=$1 and status='charging'`,[o.id]);
    return fail('payment_pending');
  }
}

export async function cancelSubscription(deps: SubscriptionDeps, viewer: Viewer, id: string): Promise<SubscriptionResult> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!consistent(deps)) return fail('unavailable');
  return deps.sql.transaction(async tx => {
    const s=await loadSubscription(tx,id,true);
    if (!s || s.user_id!==viewer.userId || s.environment!==deps.environment) return fail('not_found');
    await tx.query(`update creator_subscription_periods set status='failed',failure_code='canceled_before_charge',lease_until=null
      where subscription_id=$1 and status='pending'`,[id]);
    const pending=await tx.query(`select id from creator_subscription_periods where subscription_id=$1 and
      (status in ('charging','refund_pending') or (status='failed' and failure_code in ('charge_exhausted_review','provider_review_required')))`,[id]);
    const paid=await tx.query(`select id from creator_subscription_periods where subscription_id=$1 and status='paid' and starts_at<=$2 and ends_at>$2`,[id,clock(deps)]);
    const ended=['awaiting_auth','authorizing','past_due'].includes(s.status) && !pending.rows.length && !paid.rows.length;
    if (ended && s.billing_key_ciphertext) await queueKeyCleanup(deps,tx,s,deps.cipher.decrypt(s.billing_key_ciphertext,context(s)));
    await tx.query(`update creator_subscriptions set cancel_at_period_end=true,canceled_at=coalesce(canceled_at,$2),
      status=case when $3 then 'ended' else status end,billing_key_ciphertext=case when $3 then null else billing_key_ciphertext end,
      updated_at=$2 where id=$1`,[id,clock(deps),ended]);
    return {ok:true,subscriptionId:id};
  });
}

export async function refundUnusedSubscription(deps: SubscriptionDeps, viewer: Viewer, id: string): Promise<SubscriptionResult> {
  if (!viewer.userId) return fail('sign_in_required');
  if (!consistent(deps)) return fail('unavailable');
  const claimed=await deps.sql.transaction(async tx => {
    const s=await loadSubscription(tx,id,true);
    if (!s || s.user_id!==viewer.userId || s.environment!==deps.environment) return fail('not_found');
    if (s.status==='refunded') return {ok:true as const,subscriptionId:id};
    const o=(await tx.query<PeriodRow>('select * from creator_subscription_periods where subscription_id=$1 and period_index=$2 for update',[id,s.current_period_index])).rows[0];
    if (!o || !['paid','refund_pending'].includes(o.status)) return fail('not_refundable');
    if (o.reserved_units || o.consumed_units) return fail('period_used');
    if (o.status==='paid' && new Date(o.ends_at)<=clock(deps)) return fail('period_expired');
    const pending=await tx.query(`select id from creator_subscription_periods where subscription_id=$1 and id<>$2 and
      (status in ('pending','charging') or (status='failed' and failure_code in ('charge_exhausted_review','provider_review_required')))`,[id,o.id]);
    if (pending.rows.length) return fail('payment_pending');
    await tx.query(`update creator_subscription_periods set status='refund_pending' where id=$1`,[o.id]);
    await tx.query(`update creator_subscriptions set status='refund_pending',cancel_at_period_end=true,next_billing_at=null,updated_at=$2 where id=$1`,[id,clock(deps)]);
    return o;
  });
  if ('ok' in claimed) return claimed;
  return refundPeriod(deps,claimed.id);
}
async function refundPeriod(deps: SubscriptionDeps, id: string): Promise<SubscriptionResult> {
  const now=clock(deps);
  const {rows}=await deps.sql.query<PeriodRow>(`update creator_subscription_periods set lease_until=$3
    where id=$1 and environment=$2 and status='refund_pending' and (lease_until is null or lease_until <= $4) returning *`,[id,deps.environment,lease(now),now]);
  const o=rows[0];
  if (!o || !o.payment_key) return fail('refund_pending');
  try {
    let p=await deps.gateway.retrieveOrder(o.id);
    if (!p || !matches(p,o)) return fail('refund_pending');
    if (p.status!=='CANCELED' || p.balance!==0) {
      if (p.status!=='DONE' || p.balance!==o.amount_krw) return fail('refund_pending');
      p=await deps.gateway.cancel({paymentKey:o.payment_key,reason:'TWINGS unused subscription period',idempotencyKey:`sub-refund-${o.id}`});
    }
    if (!matches(p,o) || p.status!=='CANCELED' || p.balance!==0) return fail('refund_pending');
    await deps.sql.transaction(async tx => {
      const s=await loadSubscription(tx,o.subscription_id,true);
      if (s?.billing_key_ciphertext) await queueKeyCleanup(deps,tx,s,deps.cipher.decrypt(s.billing_key_ciphertext,context(s)));
      await tx.query(`update creator_subscription_periods set status='refunded',refunded_at=$2,lease_until=null where id=$1 and status='refund_pending'`,[id,now]);
      await tx.query(`update creator_subscriptions set status='refunded',next_billing_at=null,billing_key_ciphertext=null,updated_at=$2 where id=$1`,[o.subscription_id,now]);
    });
    return {ok:true,subscriptionId:o.subscription_id};
  } catch { return fail('refund_pending'); }
}

/** Only work immediately claimable by a new pass; a live lease does not request another batch. */
async function countActionableRenewals(deps: SubscriptionDeps, now: Date): Promise<number> {
  const {rows}=await deps.sql.query<{remaining:number}>(`select (
    (select count(*) from creator_subscription_periods where environment=$1
      and status in ('pending','charging','refund_pending') and (lease_until is null or lease_until <= $2))
    + (select count(*) from creator_subscriptions s where environment=$1
      and ((status='active' and next_billing_at <= $2) or (status='authorizing' and billing_key_ciphertext is not null))
      and not exists(select 1 from creator_subscription_periods p where p.subscription_id=s.id
        and p.status in ('pending','charging','refund_pending')))
    + (select count(*) from creator_subscription_key_cleanup where environment=$1 and status='pending'
      and (lease_until is null or lease_until <= $2))
    )::int as remaining`,[deps.environment,now]);
  return rows[0]?.remaining ?? 0;
}

/** Bounded maintenance pass; recover durable orders BEFORE scheduling new periods.
 * budgetMs leaves room for a worst-case GET + POST (2 x 65s) plus database bookkeeping.
 */
export async function processSubscriptionRenewals(deps: SubscriptionDeps, input: {limit?:number;now?:Date;budgetMs?:number} = {}): Promise<{processed:number;pending:number;hasMore:boolean;remaining:number}> {
  if (!consistent(deps)) return {processed:0,pending:0,hasMore:false,remaining:0};
  const started=Date.now();
  const budget=Number.isFinite(input.budgetMs) ? Math.max(0,input.budgetMs!) : Infinity;
  const canStart=()=>Date.now()-started+135_000<=budget;
  const now=input.now ?? clock(deps);
  // Advance the injected wall clock too: the second batch item must not inherit an already-aged lease.
  const d={...deps,now:()=>new Date(now.getTime()+Date.now()-started)};
  const limit=Number.isFinite(input.limit) ? Math.max(1,Math.min(50,Math.floor(input.limit!))) : 10;
  let processed=0;let pending=0;
  const result=async()=>{const remaining=await countActionableRenewals(d,clock(d));return {processed,pending,hasMore:remaining>0,remaining};};
  const recover=(await deps.sql.query<PeriodRow>(`select * from creator_subscription_periods where environment=$1
    and status in ('pending','charging','refund_pending') and (lease_until is null or lease_until<=$2)
    order by case when status='refund_pending' then 0 else 1 end,coalesce(lease_until,created_at) limit $3`,[deps.environment,now,limit])).rows;
  for (const p of recover) {
    if (!canStart()) return result();
    const r=p.status==='refund_pending'?await refundPeriod(d,p.id):await chargePeriod(d,p.id);
    processed++;if (!r.ok) pending++;
  }
  if (processed>=limit || !canStart()) return result();
  const cleanup=(await deps.sql.query<KeyCleanup>(`select * from creator_subscription_key_cleanup where environment=$1
    and status='pending' and (lease_until is null or lease_until <= $2) order by created_at limit $3`,[deps.environment,now,limit-processed])).rows;
  for (const key of cleanup) {
    if (!canStart()) return result();
    const done=await cleanupKey(d,key.id);processed++;if (!done) pending++;
  }
  if (processed>=limit || !canStart()) return result();
  const due=(await deps.sql.query<SubscriptionRow>(`select * from creator_subscriptions where environment=$1 and
    ((status='active' and next_billing_at<=$2) or (status='authorizing' and billing_key_ciphertext is not null))
    and not exists(select 1 from creator_subscription_periods p where p.subscription_id=creator_subscriptions.id
      and p.status in ('pending','charging','refund_pending'))
    order by coalesce(next_billing_at,created_at) limit $3`,[deps.environment,now,limit-processed])).rows;
  for (const s of due) {
    if (!canStart()) break;
    if (s.cancel_at_period_end) {
      await deps.sql.transaction(async tx=>{
        const current=await loadSubscription(tx,s.id,true);
        if (!current || current.status!=='active' || !current.cancel_at_period_end || !current.next_billing_at || new Date(current.next_billing_at)>now) return;
        const pending=await tx.query(`select id from creator_subscription_periods where subscription_id=$1 and status in ('charging','refund_pending')`,[s.id]);
        if (pending.rows.length) return;
        if (current.billing_key_ciphertext) await queueKeyCleanup(d,tx,current,deps.cipher.decrypt(current.billing_key_ciphertext,context(current)));
        await tx.query(`update creator_subscriptions set status='ended',next_billing_at=null,billing_key_ciphertext=null,updated_at=$2 where id=$1`,[s.id,now]);
      });
      processed++;continue;
    }
    if (!s.anchor_at) continue;
    // Downtime never causes a batch of retroactive charges for months the user could not use.
    const index=s.status==='authorizing'?0:Math.max(s.current_period_index+1,currentBillingIndex(new Date(s.anchor_at),now));
    const p=await ensurePeriod(d,s.id,index);
    if (p) {const r=await chargePeriod(d,p.id);processed++;if (!r.ok) pending++;}
  }
  return result();
}
