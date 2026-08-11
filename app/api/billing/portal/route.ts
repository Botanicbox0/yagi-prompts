import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { startPortal } from '@/lib/billing/checkout';
import { signInHref } from '@/lib/billing/links';
import { getBillingContext } from '@/lib/billing/service';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';

/**
 * `POST /api/billing/portal` — "Manage billing" on `/account` (§3.4: cancel anytime via the Stripe
 * customer portal; §3.7 lists the portal link as an account-page element).
 *
 * We never render a cancel/downgrade UI of our own. Stripe owns subscription state, and a second
 * place to change it would be a second source of truth.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function seeOther(location: string, request: Request): NextResponse {
  const target = location.startsWith('http') ? location : new URL(location, request.url).toString();
  return new NextResponse(null, { status: 303, headers: { ...HEADERS, Location: target } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  const rawLocale = new URL(request.url).searchParams.get('locale');
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  if (viewer.userId === null) {
    return seeOther(signInHref('/account', locale), request);
  }

  const context = await getBillingContext(request);
  if (context === null) {
    return NextResponse.json(
      {
        error: 'billing_not_configured',
        message: {
          en: 'The billing portal is not connected on this deployment yet.',
          ko: '이 배포에는 아직 결제 포털이 연결되지 않았습니다.',
        },
      },
      { status: 503, headers: HEADERS },
    );
  }

  const result = await startPortal(context, viewer.userId);
  if (result.status === 'no_customer') {
    // Never linked to Stripe (a seeded fixture, or a plan granted by hand). There is no portal to
    // open, and inventing one would be a lie — send them back to the page that told them so.
    return seeOther('/account?portal=unavailable', request);
  }
  return seeOther(result.url, request);
}
