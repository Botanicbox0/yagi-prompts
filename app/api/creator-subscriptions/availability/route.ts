import { NextResponse } from 'next/server';
import { PREPARING_SUBSCRIPTION_AVAILABILITY } from '@/lib/creator-subscriptions/availability';
import { publicSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';

export const dynamic = 'force-dynamic';
export async function GET() {
  // During an outage with nothing cached, the browser still gets JSON it can read, and it closes enrollment.
  const availability = await publicSubscriptionAvailability().catch(() => PREPARING_SUBSCRIPTION_AVAILABILITY);
  return NextResponse.json(availability,{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
}
