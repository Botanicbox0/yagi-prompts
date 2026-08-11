/**
 * The local render-verify seam, and nothing else.
 *
 * The problem it solves: `/account`, the Pro render of a playbook and the whole checkout loop are
 * all behind a session, and there is no Supabase project on this machine (§11) — so without this,
 * every locally rendered page is anonymous and the Director cannot look at a Pro view at all.
 *
 * The rule it must not break: **env never grants Pro.** This function resolves an *identity* (a
 * `profiles.id` that must already exist in the database); the tier is then derived from that
 * profile's real `subscriptions` row through the same `resolveViewer` every request uses. Point it
 * at the free fixture and you get `free`; at the pro fixture and you get `pro` — because of the
 * row, not because of the variable.
 *
 * Three independent fences, all required:
 *   1. `NODE_ENV !== 'production'` — `next build` inlines the literal, so in a production bundle
 *      this is dead code that returns null. `npm start` (and therefore `npm run sweep:anon`) can
 *      never see a dev identity.
 *   2. `PLAYBOOK_DEV_IDENTITY` explicitly set, by `scripts/dev-as.ts` and nothing else.
 *   3. a real Supabase session always wins — `getViewer()` only consults this after
 *      `getSessionUser()` has already answered null.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEV_IDENTITY_ENV = 'PLAYBOOK_DEV_IDENTITY';

/**
 * `env` is injectable for the tests only. The default branch reads both variables STATICALLY —
 * `process.env.NAME`, never `env[NAME]` — because this module is also imported by `middleware.ts`,
 * and the Edge bundle only substitutes statically-referenced `process.env` members. A dynamic
 * lookup would silently resolve to `undefined` at the edge, which would fail closed but confusingly.
 */
export function devIdentityUserId(env?: NodeJS.ProcessEnv): string | null {
  const nodeEnv = env ? env.NODE_ENV : process.env.NODE_ENV;
  if (nodeEnv === 'production') return null;
  const raw = env ? env[DEV_IDENTITY_ENV] : process.env.PLAYBOOK_DEV_IDENTITY;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return UUID.test(value) ? value : null;
}
