import { NextResponse } from 'next/server';
import { publicSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';

export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json(await publicSubscriptionAvailability(),{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
}
