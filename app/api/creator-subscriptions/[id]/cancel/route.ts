import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { getSubscriptionContext } from '@/lib/creator-subscriptions/runtime';
import { cancelSubscription } from '@/lib/creator-subscriptions/service';
import { getSubscriptionSummary } from '@/lib/creator-subscriptions/repo';
import { subscriptionFailure, subscriptionJson } from '@/lib/creator-subscriptions/http';

export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!isSameOrigin(request))return subscriptionFailure('forbidden');
  const viewer=await getViewer();if(!viewer.userId)return subscriptionFailure('sign_in_required');
  try{
    const deps=await getSubscriptionContext();if(!deps)return subscriptionFailure('unavailable');
    if(deps.environment==='test'&&!subscriptionQaAllowed(viewer))return subscriptionFailure('not_open');
    const result=await cancelSubscription(deps,viewer,(await params).id);
    return result.ok?subscriptionJson({ok:true,subscription:await getSubscriptionSummary(deps.sql,viewer.userId,{environment:deps.environment,subscriptionId:result.subscriptionId})}):subscriptionFailure(result.code);
  }catch{return subscriptionFailure('unavailable');}
}
