import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { DEFAULT_LOCALE, isLocale, LOCALE_HEADER, type Locale } from '@/lib/i18n/config';
import { disableRoomEmail } from '@/lib/brand-rooms/notice-prefs';
import type { NotifyToggle } from '@/lib/notify/kinds';
import { disableToggle } from '@/lib/notify/preferences';
import { renderRoomEmailUnsubscribed, renderUnsubscribed, renderUnsubscribeInvalid } from '@/lib/notify/unsubscribe-page';
import { ROOM_EMAIL_SCOPE, verifyUnsubscribeToken } from '@/lib/notify/unsubscribe';
import { brandSiteUrl } from '@/lib/seo/site-url';

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
 * is the one a prefetching client's user was already asking for. The same URL also answers the
 * RFC 8058 one-click POST (below) with the same write and no page.
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

type Applied =
  | { ok: false }
  | { ok: true; scope: 'room'; locale: Locale }
  | { ok: true; scope: 'toggle'; locale: Locale; toggle: NotifyToggle };

/** The one write both doors share: check the token, then switch off exactly what it names. */
async function apply(token: string | null, fallbackLocale: Locale): Promise<Applied> {
  if (!token) return { ok: false };

  const verified = verifyUnsubscribeToken(token);
  if (!verified.ok) return { ok: false };

  const sql = await getSqlRunner();
  if (sql === null) return { ok: false };

  // Project room mail (docs/BRAND-ROOMS-FEEDBACK.md §2.2): the token names one organization, and the
  // only thing it can do is switch that organization's room mail off for that person.
  if (verified.claims.toggle === ROOM_EMAIL_SCOPE) {
    const room = await disableRoomEmail(sql, verified.claims.userId, verified.claims.organizationId).catch(() => ({ ok: false, locale: fallbackLocale }));
    return room.ok ? { ok: true, scope: 'room', locale: room.locale } : { ok: false };
  }

  const result = await disableToggle(sql, verified.claims.userId, verified.claims.toggle);
  // A perfectly signed token for a profile that no longer exists reads as invalid rather than as
  // success — claiming to have changed a setting we did not change would be a lie.
  if (!result.ok) return { ok: false };
  return { ok: true, scope: 'toggle', locale: result.locale, toggle: verified.claims.toggle };
}

export async function GET(request: Request): Promise<NextResponse> {
  // Only used for the REFUSAL page — a valid token gives us the profile's own locale, which is the
  // language the email was written in and therefore the right one to answer in.
  const headerLocale = request.headers.get(LOCALE_HEADER);
  const fallbackLocale = isLocale(headerLocale) ? headerLocale : DEFAULT_LOCALE;

  const applied = await apply(new URL(request.url).searchParams.get('t'), fallbackLocale);
  if (!applied.ok) return page(renderUnsubscribeInvalid(fallbackLocale), 400);
  if (applied.scope === 'room') {
    return page(renderRoomEmailUnsubscribed({ locale: applied.locale, messagesUrl: `${brandSiteUrl()}/brand/rooms` }), 200);
  }
  return page(renderUnsubscribed({ locale: applied.locale, toggle: applied.toggle }), 200);
}

/**
 * RFC 8058 one-click: the mail client's own unsubscribe control POSTs the `List-Unsubscribe` URL (the
 * live mailer sends `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) with no cookies and no Origin.
 * The token in the URL is the whole authorisation, exactly as for the GET, so the body is not read. The
 * provider shows no page: 200 with an empty body, or the GET's 400 for a token that changes nothing.
 * Reachable on twings.app only — the links are built there; the brand and admin hosts 404 it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const applied = await apply(new URL(request.url).searchParams.get('t'), DEFAULT_LOCALE);
  return new NextResponse(null, {
    status: applied.ok ? 200 : 400,
    headers: { 'Cache-Control': HEADERS['Cache-Control']!, 'X-Robots-Tag': HEADERS['X-Robots-Tag']! },
  });
}
