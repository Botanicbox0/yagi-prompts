import { NextResponse } from 'next/server';
import { authorizeSubscriptionCron,runSubscriptionMaintenance } from '@/lib/creator-subscriptions/maintenance';
import { getSubscriptionContext,SUBSCRIPTION_HEADERS } from '@/lib/creator-subscriptions/runtime';
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
    const result=await runSubscriptionMaintenance(context);
    if (result.ok && result.heartbeatRecorded) revalidateSubscriptions();
    return NextResponse.json(result,{status:result.ok?200:503,headers:SUBSCRIPTION_HEADERS});
  } catch {
    // Request headers, billing keys, SQL parameters, and provider bodies never enter this response.
    return NextResponse.json({ok:false,code:'maintenance_failed'},{status:503,headers:SUBSCRIPTION_HEADERS});
  }
}

export const GET=tick;
export const POST=tick;
