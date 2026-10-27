import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { getSubscriptionContext, liveSubscriptionAvailability, subscriptionLiveQaReady } from '@/lib/creator-subscriptions/runtime';
import { mayEnrollSubscription } from '@/lib/creator-subscriptions/access';
import { isSubscriptionPlan } from '@/lib/creator-subscriptions/plans';
import { beginSubscription } from '@/lib/creator-subscriptions/service';
import { readSubscriptionJson, subscriptionFailure, subscriptionJson } from '@/lib/creator-subscriptions/http';
import { isStoreRequest } from '@/lib/mobile/store-bridge';

export const dynamic='force-dynamic';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return subscriptionFailure('forbidden');
  if (isStoreRequest(request.headers)) return subscriptionFailure('store_companion');
  const viewer=await getViewer(); if (!viewer.userId) return subscriptionFailure('sign_in_required');
  const input=await readSubscriptionJson(request);
  if (!input || !isSubscriptionPlan(input.planId)) return subscriptionFailure('bad_request');
  if (input.consent !== true || typeof input.consentVersion !== 'string') return subscriptionFailure('consent_required');
  try {
    const deps=await getSubscriptionContext(); if (!deps) return subscriptionFailure('unavailable');
    const availability = await liveSubscriptionAvailability();
    const liveQaReady = viewer.isAdmin && deps.environment === 'live' && process.env.CREATOR_SUBSCRIPTION_LIVE_QA === 'on' && await subscriptionLiveQaReady(deps.sql);
    if (!mayEnrollSubscription(viewer,input.planId,availability,deps.environment,process.env,liveQaReady)) return subscriptionFailure('not_open');
    const result=await beginSubscription(deps,viewer,{planId:input.planId,locale:typeof input.locale==='string'?input.locale:'en',consentVersion:input.consentVersion});
    return result.ok ? subscriptionJson({ok:true,id:result.subscriptionId,href:`/billing/subscription/${result.subscriptionId}`},201) : subscriptionFailure(result.code);
  } catch {return subscriptionFailure('unavailable');}
}
