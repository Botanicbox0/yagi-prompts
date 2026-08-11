import 'server-only';
import { createDataClient } from '@/lib/supabase/data-client';
import { getSessionUser } from '@/lib/supabase/auth-client';
import type { Tier } from '@/lib/content/visibility';
import type { Locale } from '@/lib/i18n/config';

/**
 * PLAN §3.4 — the single entitlement definition.
 *
 *   Pro  iff subscriptions.status IN ('active','past_due')   ← Stripe owns the retry window
 *   `profiles.plan` is a DISPLAY MIRROR and is never consulted for gating.
 *
 * Resolution happens on the server, from a server-verified session, with the service-role client
 * (RLS is deny-all). Nothing here ever accepts a client-supplied plan or admin flag.
 */

export const ENTITLED_STATUSES = ['active', 'past_due'] as const;

export interface Viewer {
  tier: Tier;
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  locale: Locale | null;
}

export const ANON_VIEWER: Viewer = {
  tier: 'anon',
  userId: null,
  email: null,
  isAdmin: false,
  locale: null,
};

interface ProfileRow {
  is_admin: boolean;
  locale: Locale;
  email: string;
}

interface SubscriptionRow {
  status: string;
}

export function isEntitled(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && (ENTITLED_STATUSES as readonly string[]).includes(status);
}

/** anon | free | pro | admin, derived server-side. `anon` is the absence of a user. */
export async function getViewer(): Promise<Viewer> {
  const user = await getSessionUser();
  if (!user) return ANON_VIEWER;

  const db = createDataClient();
  const [{ data: profile }, { data: subscription }] = await Promise.all([
    db.from('profiles').select('is_admin, locale, email').eq('id', user.id).maybeSingle<ProfileRow>(),
    db.from('subscriptions').select('status').eq('user_id', user.id).maybeSingle<SubscriptionRow>(),
  ]);

  const isAdmin = profile?.is_admin === true;
  const tier: Tier = isAdmin ? 'admin' : isEntitled(subscription?.status) ? 'pro' : 'free';

  return {
    tier,
    userId: user.id,
    email: profile?.email ?? user.email ?? null,
    isAdmin,
    locale: profile?.locale ?? null,
  };
}

/** §3.7 — `/admin/*` is gated at the edge on session, and HERE on `is_admin`. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.isAdmin) {
    throw new Error('forbidden: admin only');
  }
  return viewer;
}
