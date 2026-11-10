import 'server-only';
import { cache } from 'react';
import { createDataClient } from '@/lib/supabase/data-client';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase/auth-client';
import { getSqlRunner } from '@/lib/db/connect';
import { ENTITLED_STATUSES, isEntitled } from '@/lib/billing/entitlement';
import type { Locale } from '@/lib/i18n/config';
import { devIdentityUserId } from './dev-identity';
import {
  ANON_VIEWER,
  resolveViewer,
  sqlIdentitySource,
  type Identity,
  type IdentitySource,
  type Viewer,
} from './identity';

/**
 * PLAN §3.4 — viewer resolution, from a server-verified session only.
 *
 *   Pro iff `subscriptions.status IN ('active','past_due')` — the ONE definition, imported from
 *   `lib/billing/entitlement.ts` and shared with the reconciler and `/account`.
 *   `profiles.plan` is a display mirror and is never consulted for gating.
 *
 * Two readers, one rule (`resolveViewer`, in lib/auth/identity.ts):
 *   · Supabase service-role client when a project is configured — the production path;
 *   · the `SqlRunner` otherwise, which is how the local snapshot (`npm run db:local`) can resolve a
 *     dev identity for render-verify. Same query semantics, same derivation.
 *
 * Nothing here ever accepts a client-supplied plan or admin flag.
 */

export type { Viewer, Identity, IdentitySource } from './identity';
export { ANON_VIEWER, resolveViewer, sqlIdentitySource } from './identity';
export { ENTITLED_STATUSES, isEntitled };

interface ProfileRow {
  is_admin: boolean;
  locale: Locale;
  email: string;
}

interface SubscriptionRow {
  status: string;
}

/** The production reader: service role, RLS-deny-all-safe, two point lookups in parallel. */
function supabaseIdentitySource(): IdentitySource {
  return {
    async load(userId) {
      const db = createDataClient();
      const [{ data: profile }, { data: subscription }] = await Promise.all([
        db.from('profiles').select('is_admin, locale, email').eq('id', userId).maybeSingle<ProfileRow>(),
        db
          .from('subscriptions')
          .select('status')
          .eq('user_id', userId)
          .maybeSingle<SubscriptionRow>(),
      ]);
      if (!profile) return null;
      return {
        isAdmin: profile.is_admin === true,
        locale: profile.locale ?? null,
        email: profile.email ?? null,
        subscriptionStatus: subscription?.status ?? null,
      } satisfies Identity;
    },
  };
}

/**
 * `local` ⇒ the SqlRunner (the snapshot the dev identity actually lives in); otherwise Supabase
 * when a project is configured.
 *
 * The `local` argument is what makes the doc-comment above TRUE. Since cloud credentials landed in
 * `.env.local` (M7), `isAuthConfigured()` has been true on this machine at all times, so a dev
 * identity — a FIXTURE id that exists only in the local snapshot — was looked up in the CLOUD
 * database, found nothing, and resolved to anonymous. `/admin/*` therefore 404'd for every local
 * render-verify, which is why admin-form regressions kept reaching the founder instead of the
 * Director. Production is untouched: `devIdentityUserId()` is null under NODE_ENV=production.
 */
async function identitySource(local: boolean): Promise<IdentitySource | null> {
  if (!local && isAuthConfigured()) return supabaseIdentitySource();
  const sql = await getSqlRunner();
  if (sql !== null) return sqlIdentitySource(sql);
  return isAuthConfigured() ? supabaseIdentitySource() : null;
}

/** anon | free | pro | admin, derived server-side. `anon` is the absence of a user. Memoised per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const sessionUser = await getSessionUser();

  // Dev-only, and only when there is no real session to speak of. See lib/auth/dev-identity.ts for
  // why this cannot exist in a production build — and why it grants an identity, never a tier.
  const devUserId = sessionUser === null ? devIdentityUserId() : null;
  const userId = sessionUser?.id ?? devUserId;
  if (!userId) return ANON_VIEWER;

  const source = await identitySource(devUserId !== null);
  if (source === null) return ANON_VIEWER;

  const identity = await source.load(userId);
  // A session whose profile row is missing is not a free user — it is an unknown one. Fail closed.
  if (identity === null && sessionUser === null) return ANON_VIEWER;

  // `app_metadata` is written by the auth server and is not user-editable (docs/qa/toss-checkout/
  // REVIEW-ACCOUNT.md); `user_metadata` would be, so it is never consulted here.
  const review = sessionUser?.app_metadata?.purpose === 'toss_review';
  return resolveViewer({ id: userId, email: sessionUser?.email ?? null }, identity, { review });
});

/** §3.7 — `/admin/*` is gated at the edge on session, and HERE on `is_admin`. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.isAdmin) {
    throw new Error('forbidden: admin only');
  }
  return viewer;
}
