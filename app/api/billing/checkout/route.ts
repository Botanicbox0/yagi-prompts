import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { startCheckout } from '@/lib/billing/checkout';
import { originPath, sanitizeSlug, signInHref } from '@/lib/billing/links';
import { getBillingContext } from '@/lib/billing/service';
import { trackAsync } from '@/lib/events/server';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';

/**
 * `POST /api/billing/checkout` — the one place a Checkout Session is created (§3.4).
 *
 * POST, not GET, on purpose: creating a session is a side effect, and a GET would be prefetchable,
 * crawlable and replayable from the address bar. The CTAs post a plain HTML form, so the flow needs
 * no client JavaScript at all.
 *
 * The guard lives in `lib/billing/checkout.ts` (`startCheckout`): an already-entitled user is sent
 * to the customer portal instead of a second subscription, after a real reconcile against Stripe.
 *
 * Outcomes:
 *   303 → Stripe Checkout        signed-in, not entitled
 *   303 → Stripe customer portal signed-in and already entitled (duplicate-subscription policy)
 *   303 → /auth/signin?next=…    anonymous — Journey A, returning to where they were
 *   503                          no Stripe configured on this deployment (§11)
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

/** 303 so the browser follows with GET — a form POST must not be replayed at the destination. */
function seeOther(location: string, request: Request): NextResponse {
  const target = location.startsWith('http') ? location : new URL(location, request.url).toString();
  return new NextResponse(null, { status: 303, headers: { ...HEADERS, Location: target } });
}

/** Accepts a form post (the CTAs) or a JSON body (anything programmatic). */
async function readInput(request: Request): Promise<{ slug: string | null; locale: Locale }> {
  const url = new URL(request.url);
  let rawSlug: unknown = url.searchParams.get('slug');
  let rawLocale: unknown = url.searchParams.get('locale');

  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      const body = (await request.json()) as { slug?: unknown; locale?: unknown };
      rawSlug = body.slug ?? rawSlug;
      rawLocale = body.locale ?? rawLocale;
    } else {
      const form = await request.formData();
      rawSlug = form.get('slug') ?? rawSlug;
      rawLocale = form.get('locale') ?? rawLocale;
    }
  } catch {
    // No body, or an unparseable one — the query string already carried what we need.
  }

  return {
    slug: sanitizeSlug(rawSlug),
    locale: isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const [viewer, { slug, locale }] = await Promise.all([getViewer(), readInput(request)]);
  const returnTo = originPath({ slug, locale });

  if (viewer.userId === null) {
    return seeOther(signInHref(returnTo, locale), request);
  }

  const context = await getBillingContext(request);
  if (context === null) {
    return NextResponse.json(
      {
        error: 'billing_not_configured',
        message: {
          en: 'Checkout is not connected on this deployment yet.',
          ko: '이 배포에는 아직 결제가 연결되지 않았습니다.',
        },
      },
      { status: 503, headers: HEADERS },
    );
  }

  trackAsync({
    type: 'start_checkout',
    userId: viewer.userId,
    meta: { surface: 'cta', locale, ...(slug === null ? {} : { slug }) },
  });

  const result = await startCheckout(context, {
    userId: viewer.userId,
    email: viewer.email,
    origin: { slug, locale },
  });

  switch (result.status) {
    case 'checkout':
      return seeOther(result.url, request);
    case 'portal':
      return seeOther(result.url, request);
    case 'already_pro':
      return seeOther(result.returnTo, request);
  }
}
