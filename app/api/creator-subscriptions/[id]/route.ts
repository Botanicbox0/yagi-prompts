import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { loadSubscription, getSubscriptionSummary } from '@/lib/creator-subscriptions/repo';
import { subscriptionFailure, subscriptionJson } from '@/lib/creator-subscriptions/http';

export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const viewer=await getViewer();if(!viewer.userId)return subscriptionFailure('sign_in_required');
  const sql=await getSqlRunner();if(!sql)return subscriptionFailure('unavailable');
  try{
    const own=await loadSubscription(sql,(await params).id);
    if(!own||own.user_id!==viewer.userId||(own.environment==='test'&&!subscriptionQaAllowed(viewer)))return subscriptionFailure('not_found');
    const summary=await getSubscriptionSummary(sql,viewer.userId,{environment:own.environment,subscriptionId:own.id});
    return subscriptionJson({ok:true,subscription:summary});
  }catch{return subscriptionFailure('unavailable');}
}
