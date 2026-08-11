import type { SqlRunner } from '@/lib/db/sql-runner';
import { isEntitled } from '@/lib/billing/entitlement';
import type { Tier } from '@/lib/content/visibility';
import type { Locale } from '@/lib/i18n/config';

/**
 * The tier derivation, split out of `lib/auth/viewer.ts` so it can be driven against a real
 * database in vitest.
 *
 * Same seam, same reasoning as `lib/content/playbook-access.ts` (M2): there is no Supabase project
 * yet (§11), so a real session cannot be minted — but the half that turns a *user id* into a
 * *tier* is exactly where the M3 entitlement wiring lives, and it must be tested against real
 * `subscriptions` rows rather than a stub. `getViewer()` keeps the session half and has no
 * parameter that could carry a tier.
 *
 * PLAN §3.4: the tier comes from `subscriptions.status` through `isEntitled` and from nothing else.
 * `profiles.plan` is never read here — it is a display mirror.
 */

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

/** Everything the tier decision needs, from wherever it was read. */
export interface Identity {
  isAdmin: boolean;
  locale: Locale | null;
  email: string | null;
  /** `subscriptions.status`, verbatim, or null when there is no row. */
  subscriptionStatus: string | null;
}

export interface IdentitySource {
  load(userId: string): Promise<Identity | null>;
}

/** The one rule: admin wins, then entitlement, then free. Anon is the absence of a user. */
export function resolveViewer(
  user: { id: string; email?: string | null } | null,
  identity: Identity | null,
): Viewer {
  if (user === null) return ANON_VIEWER;
  const isAdmin = identity?.isAdmin === true;
  const tier: Tier = isAdmin
    ? 'admin'
    : isEntitled(identity?.subscriptionStatus)
      ? 'pro'
      : 'free';
  return {
    tier,
    userId: user.id,
    email: identity?.email ?? user.email ?? null,
    isAdmin,
    locale: identity?.locale ?? null,
  };
}

/**
 * Read the identity over the driver-agnostic `SqlRunner`.
 *
 * One statement rather than two round trips, and a LEFT JOIN rather than two queries so a profile
 * with no subscription row resolves to `free` instead of to "not found".
 */
export function sqlIdentitySource(sql: SqlRunner): IdentitySource {
  return {
    async load(userId) {
      const { rows } = await sql.query<{
        is_admin: boolean;
        locale: string;
        email: string;
        status: string | null;
      }>(
        `select p.is_admin, p.locale, p.email, s.status
           from profiles p
           left join subscriptions s on s.user_id = p.id
          where p.id = $1`,
        [userId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        isAdmin: row.is_admin === true,
        locale: (row.locale === 'ko' || row.locale === 'en' ? row.locale : null) as Locale | null,
        email: row.email,
        subscriptionStatus: row.status,
      };
    },
  };
}
