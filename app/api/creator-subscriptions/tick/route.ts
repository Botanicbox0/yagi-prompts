import { NextResponse } from 'next/server';
import { authorizeSubscriptionCron,publicAnswerChanged,runSubscriptionMaintenance } from '@/lib/creator-subscriptions/maintenance';
import { getSubscriptionContext,SUBSCRIPTION_HEADERS } from '@/lib/creator-subscriptions/runtime';
import { cachedPublicSubscriptionAnswer,freshPublicSubscriptionAnswer } from '@/lib/creator-subscriptions/cached-availability';
import { revalidateSubscriptions } from '@/lib/cache';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=300;

async function tick(request:Request) {
  if (!authorizeSubscriptionCron(request))
    return NextResponse.json({ok:false,code:'unauthorized'},{status:401,headers:SUBSCRIPTION_HEADERS});
  try {
    const context=await getSubscriptionContext();
    if (!context) return NextResponse.json({ok:false,code:'unavailable'},{status:503,headers:SUBSCRIPTION_HEADERS});
    try {
      const result=await runSubscriptionMaintenance(context);
      return NextResponse.json(result,{status:result.ok?200:503,headers:SUBSCRIPTION_HEADERS});
    } finally {
      // After the heartbeat is written, and after a failed run too: a worker that keeps failing lets it lapse.
      if (await publicAnswerChanged(cachedPublicSubscriptionAnswer,()=>freshPublicSubscriptionAnswer(context.sql))) revalidateSubscriptions();
    }
  } catch {
    // Request headers, billing keys, SQL parameters, and provider bodies never enter this response.
    return NextResponse.json({ok:false,code:'maintenance_failed'},{status:503,headers:SUBSCRIPTION_HEADERS});
  }
}

export const GET=tick;
export const POST=tick;
