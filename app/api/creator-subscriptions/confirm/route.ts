import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { getSubscriptionContext } from '@/lib/creator-subscriptions/runtime';
import { completeSubscription } from '@/lib/creator-subscriptions/service';
import { readSubscriptionJson, subscriptionFailure, subscriptionJson } from '@/lib/creator-subscriptions/http';

export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return subscriptionFailure('forbidden');
  const viewer=await getViewer(); if(!viewer.userId)return subscriptionFailure('sign_in_required');
  const input=await readSubscriptionJson(request);
  if (!input || typeof input.subscriptionId!=='string' || typeof input.authKey!=='string' || typeof input.customerKey!=='string') return subscriptionFailure('bad_request');
  try {
    const deps=await getSubscriptionContext();if(!deps)return subscriptionFailure('unavailable');
    if(deps.environment==='test'&&!subscriptionQaAllowed(viewer))return subscriptionFailure('not_open');
    // Ownership, stored consent, customerKey and environment are all re-checked inside the service.
    const result=await completeSubscription(deps,viewer,{subscriptionId:input.subscriptionId,authKey:input.authKey,customerKey:input.customerKey});
    return result.ok?subscriptionJson({ok:true,href:'/account?subscription=active'}):subscriptionFailure(result.code);
  }catch{return subscriptionFailure('unavailable');}
}
