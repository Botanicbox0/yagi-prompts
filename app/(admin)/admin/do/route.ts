import { after, NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/viewer';
import { revalidateCampaigns, revalidateCatalog, revalidateContests, revalidateLandingMedia, revalidatePrompts } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { getStorage } from '@/lib/storage';
import { getMailer } from '@/lib/notify/service';
import { siteUrl } from '@/lib/seo/site-url';
import { fail, type AdminOutcome } from '@/lib/admin/context';
import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
import { BACK_FIELD, OP_FIELD, str } from '@/lib/admin/form';
import { resolveRequestUrl } from '@/lib/routing/surfaces';

/**
 * `POST /admin/do` — the one admin mutation door, as a ROUTE rather than a server action.
 *
 * Why it moved (2026-08-14, the founder's third report of "저장이 안 된다"): a React server action
 * is addressed by a build-scoped `$ACTION_ID` embedded in the page. The founder works in a
 * long-lived admin tab while this repo deploys many times a day, so their open page kept posting an
 * action id the new deployment no longer knows — and a stale action id does not error usefully: the
 * request is answered with a plain re-render, which reads exactly as "the button does nothing and
 * my edit disappeared". Verified from the outside: the database showed no write for their attempts,
 * while the identical edit from a freshly loaded page saved on the first try.
 *
 * A route handler has a URL, and a URL survives deployment. Same guard, same dispatcher, same
 * operations, same outcome codes — only the address is stable. It also removes React's own
 * FormData re-encoding from the path, which is what turned untouched file inputs into named
 * zero-byte "uploads" (fixed in lib/admin/form.ts the same day; this makes it structural).
 *
 * §3.8's "requireAdmin() first" is unchanged, and `requireAdmin()` throwing still means 404, not
 * 403 (§3.7 — the admin surface does not confirm its own existence).
 */
export const dynamic = 'force-dynamic';
/** A broadcast to every subscriber runs in `after()` inside this invocation; give it the full budget. */
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

/**
 * Server actions carry their own origin check; a route handler must state one. Same-origin form
 * posts send `Sec-Fetch-Site: same-origin` (and `Origin` on every modern browser), so a
 * cross-site POST — the shape a CSRF attempt takes — is refused before the operation is named.
 * `requireAdmin()` runs anyway; this is the layer that stops a logged-in admin's browser from
 * being used as the attacker's hands.
 */
function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  if (origin === null) return true; // no Origin at all: not a cross-site browser post
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch {
    return notFound();
  }
  if (!sameOrigin(request)) return notFound();
  const requestUrl = resolveRequestUrl(new URL(request.url), request.headers);
  if (requestUrl === null) return notFound();

  const form = await request.formData();
  const name = str(form, OP_FIELD);
  const back = str(form, BACK_FIELD) || '/admin';

  const outcome = await execute(name, form);
  // Keep refused new-template forms mounted; still use the guarded operation above.
  if (name === 'prompt.create' && request.headers.get('accept') === 'application/vnd.twings.admin-form+json') {
    const field = outcome.ok ? undefined : outcome.detail?.split(':')[0];
    return NextResponse.json(outcome.ok
      ? { ok: true, to: outcomeUrl(back, outcome) }
      : { ok: false, code: outcome.code, field: ['useCase', 'poster'].includes(field ?? '') ? field : undefined },
    { status: outcome.ok ? 200 : 400, headers: NO_STORE });
  }
  if(request.headers.get('accept')==='application/json') return NextResponse.json(outcome.ok ? {ok:true,to:outcome.to,...(outcome.invitationToken?{invitationToken:outcome.invitationToken}:{})} : {ok:false,code:outcome.code}, {status:outcome.ok?200:400,headers:NO_STORE});
  // 303: the POST becomes a GET on the way back, so a refresh never re-submits the operation.
  return NextResponse.redirect(new URL(outcomeUrl(back, outcome), requestUrl.origin), {
    status: 303,
    headers: NO_STORE,
  });
}

async function execute(name: string, form: FormData): Promise<AdminOutcome> {
  const viewer = await requireAdmin();
  const [sql, storage] = await Promise.all([getSqlRunner(), getStorage()]);
  if (sql === null) {
    // No database configured (§11) — every mutation is a no-op, and saying so is better than a 500.
    return fail('unknown', 'no database is configured on this deployment');
  }
  return dispatchAdmin(name, form, {
    sql,
    storage,
    viewer,
    revalidate: revalidateCatalog,
    revalidatePrompts,
    revalidateContests,
    revalidateCampaigns,
    revalidateLandingMedia,
    mail: { mailer: getMailer(), siteUrl: siteUrl() },
    // After the redirect, never on the request path; a failure is logged, never a 500 for the operator.
    defer: (task) =>
      after(async () => {
        try {
          await task();
        } catch (error) {
          console.error('[admin] deferred task failed', error);
        }
      }),
  });
}
