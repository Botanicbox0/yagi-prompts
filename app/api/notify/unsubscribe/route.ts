import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { DEFAULT_LOCALE, isLocale, LOCALE_HEADER } from '@/lib/i18n/config';
import { disableToggle } from '@/lib/notify/preferences';
import { renderUnsubscribed, renderUnsubscribeInvalid } from '@/lib/notify/unsubscribe-page';
import { verifyUnsubscribeToken } from '@/lib/notify/unsubscribe';

/**
 * `/api/notify/unsubscribe?t=…` — PLAN §3.5, "signed token flips the toggle".
 *
 * **No login required, and that is the entire point.** A recipient who has lost access to their
 * account, or who never wanted one open on this device, must still be able to stop the email. The
 * signed token IS the authorisation: it names one profile and one column, it can only ever set that
 * column to `false`, and it is unforgeable without `NOTIFY_TOKEN_SECRET`
 * (`lib/notify/unsubscribe.ts`). Possession of it is not a session — it cannot read anything, it
 * cannot re-enable anything, and it cannot reach another user's row.
 *
 * GET rather than POST because mail clients follow links, not forms. That makes it prefetchable,
 * which is *fine here and only here*: the operation is idempotent and its effect — fewer emails —
 * is the one a prefetching client's user was already asking for.
 *
 * `private, no-store` + `noindex` like every other API response (§3.4); `robots.ts` disallows /api
 * as well, so a token can never end up in an index.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'text/html; charset=utf-8',
};

function page(html: string, status: 200 | 400): NextResponse {
  return new NextResponse(html, { status, headers: HEADERS });
}

export async function GET(request: Request): Promise<NextResponse> {
  // Only used for the REFUSAL page — a valid token gives us the profile's own locale, which is the
  // language the email was written in and therefore the right one to answer in.
  const headerLocale = request.headers.get(LOCALE_HEADER);
  const fallbackLocale = isLocale(headerLocale) ? headerLocale : DEFAULT_LOCALE;

  const token = new URL(request.url).searchParams.get('t');
  if (!token) return page(renderUnsubscribeInvalid(fallbackLocale), 400);

  const verified = verifyUnsubscribeToken(token);
  if (!verified.ok) return page(renderUnsubscribeInvalid(fallbackLocale), 400);

  const sql = await getSqlRunner();
  if (sql === null) return page(renderUnsubscribeInvalid(fallbackLocale), 400);

  const result = await disableToggle(sql, verified.claims.userId, verified.claims.toggle);
  // A perfectly signed token for a profile that no longer exists reads as invalid rather than as
  // success — claiming to have changed a setting we did not change would be a lie.
  if (!result.ok) return page(renderUnsubscribeInvalid(fallbackLocale), 400);

  return page(renderUnsubscribed({ locale: result.locale, toggle: verified.claims.toggle }), 200);
}
