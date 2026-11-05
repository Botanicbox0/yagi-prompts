import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { PREPARING_SUBSCRIPTION_AVAILABILITY, type PublicSubscriptionAvailability } from '@/lib/creator-subscriptions/availability';
import { publicSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';
import { getSubscriptionContext } from '@/lib/creator-subscriptions/runtime';

export const dynamic = 'force-dynamic';
export async function GET() {
  // During an outage with nothing cached, the browser still gets JSON it can read, and it closes enrollment.
  let availability: PublicSubscriptionAvailability = await publicSubscriptionAvailability().catch(() => PREPARING_SUBSCRIPTION_AVAILABILITY);
  if (availability.status === 'preparing' && process.env.CREATOR_SUBSCRIPTION_QA === 'on') {
    const viewer = await getViewer().catch(() => null);
    if (viewer && subscriptionQaAllowed(viewer)) {
      const deps = await getSubscriptionContext().catch(() => null);
      if (deps?.environment === 'test') {
        const premiumOpen = typeof deps.premiumEditLimit === 'number' && deps.premiumEditLimit >= 30 && deps.premiumEditLimit <= 1000;
        availability = {
          status: 'open',
          version: availability.version,
          plans: {
            creator: { status: 'open' },
            premium: { status: premiumOpen ? 'open' : 'preparing' },
          },
          editing: premiumOpen ? 'open' : 'preparing',
          ...(premiumOpen ? { premiumEditRequestsPerPeriod: deps.premiumEditLimit } : {}),
        };
      }
    }
  }
  return NextResponse.json(availability,{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
}
