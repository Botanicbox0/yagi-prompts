import { NextResponse, type NextRequest } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase/auth-client';
import { getSqlRunner } from '@/lib/db/connect';
import { deletionInProgress } from '@/lib/account/deletion';
import { SIGNUP_COOKIES } from '@/lib/cookies/wallet';
import { authFailurePath, authReturnPath, resolveRequestUrl } from '@/lib/routing/surfaces';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  type Locale,
} from '@/lib/i18n/config';

/**
 * OAuth return trip (§3.7 / §3.9).
 *
 *   1. exchange the code for a session (PKCE; @supabase/ssr holds the verifier in a cookie);
 *   2. create `profiles` on first login, with the locale of the UI the user started from;
 *   3. write the locale cookie FROM THE PROFILE — this is what lets the edge run the precedence
 *      chain without a service-role round trip on every request (see middleware.ts);
 *   4. land on the originating page.
 *
 * One refusal (docs/RUNBOOK-deletion.md): a sign-in account whose rows have been deleted and whose own
 * removal is still on a deletion request's list gets NO new profile. The retry of that removal would
 * cascade the new profile away with anything it paid for, so the session is ended and the person is
 * sent back with the sign-in notice; once the request closes they can join again.
 *
 * `is_admin` is never derived here. The DB sets it from `auth.users` alone: a confirmed exact
 * @yagiworkshop.xyz email (0038_core_staff_admin.sql, also on this insert), otherwise a manual grant
 * (docs/SETUP.md §4). Nothing from the OAuth payload's metadata decides it.
 *
 * §15.1-2 — the signup grant arrives through the COLUMN DEFAULT (`cookie_balance` defaults 3;
 * the insert below deliberately does not name it), so this route cannot get the number wrong.
 * What it does add: `cookies_granted_at` is stamped at creation so a brand-new account reads
 * exactly 3 — NULL means "weekly clock never read", which §15.1-3 treats as due, and that
 * behavior belongs to backfilled pre-cookie profiles, not to someone who joined a minute ago.
 *
 * (M10 review R1, finding 1.) The profile row and its 'signup' ledger line are ONE transaction on
 * `SqlRunner` — two PostgREST calls could commit the wallet and drop the audit line, breaking the
 * "ledger is the truth" invariant on the very first row. `on conflict do nothing returning id`
 * makes the racing second callback lose the insert AND the ledger write together, and a failed
 * transaction rolls both back so the next login simply retries the branch.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  if (url === null) return new NextResponse(null, { status: 404 });
  const code = url.searchParams.get('code');
  const uiLocaleRaw = url.searchParams.get('locale');
  const uiLocale: Locale = isLocale(uiLocaleRaw) ? uiLocaleRaw : DEFAULT_LOCALE;
  // A return trip with nowhere to go lands where `/auth/signin` would have sent it: the video
  // templates (docs/TEMPLATES-IA.md). It used to be the denavigated `/library` (audit P1-4).
  const next = authReturnPath(url.searchParams.get('next'), url.hostname, `/${uiLocale}/video`);

  if (!code) {
    return NextResponse.redirect(new URL(authFailurePath(url.hostname, uiLocale, 'oauth', next), url.origin));
  }

  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL(authFailurePath(url.hostname, uiLocale, 'oauth', next), url.origin));
  }

  let profileLocale: Locale = uiLocale;
  let beingDeleted = false;
  try {
    const sql = await getSqlRunner();
    if (sql !== null) {
      const existing = await sql.query<{ locale: string }>(
        'select locale from profiles where id = $1',
        [data.user.id],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        profileLocale = isLocale(row.locale) ? row.locale : uiLocale;
      } else if (await deletionInProgress(sql, data.user.id)) {
        beingDeleted = true;
      } else {
        await sql.transaction(async (tx) => {
          // The column default supplies the 3; naming it here would be a second place to get the
          // number wrong. `now()` is the DB clock — the same one the weekly grant compares against.
          const inserted = await tx.query<{ id: string }>(
            `insert into profiles (id, email, display_name, locale, cookies_granted_at)
             values ($1, $2, $3, $4, now())
             on conflict (id) do nothing
             returning id`,
            [
              data.user.id,
              // A Kakao account that did not share an email has none: NULL, never '' (0053).
              data.user.email?.trim() || null,
              (data.user.user_metadata?.['full_name'] as string | undefined) ?? null,
              uiLocale,
            ],
          );
          // Only the login that actually CREATED the row writes the audit line — a racing second
          // callback loses the insert on the primary key and with it the ledger write.
          if (inserted.rows.length > 0) {
            await tx.query(
              `insert into cookie_ledger (profile_id, delta, reason) values ($1, $2, 'signup')`,
              [data.user.id, SIGNUP_COOKIES],
            );
          }
        });
      }
    }
  } catch {
    // A profile write failure must not strand the user mid-login; the session is already valid,
    // and the rolled-back transaction retries wholesale on the next login.
  }

  if (beingDeleted) {
    // The exchange above already set session cookies; take them back before leaving.
    await supabase.auth.signOut().catch(() => undefined);
    return NextResponse.redirect(new URL(authFailurePath(url.hostname, uiLocale, 'oauth', next), url.origin));
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  response.cookies.set(LOCALE_COOKIE, profileLocale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
  return response;
}
