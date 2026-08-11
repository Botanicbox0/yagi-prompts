import type { BlockKind } from './schemas';

/**
 * PLAN §6 — the shared visibility resolver.
 *
 * `coalesce(override, default_policy[kind])` exists in exactly two places by design:
 *   · SQL, inside `prepare_publish` (stamps `blocks.resolved_visibility` at publish time)
 *   · here, for the draft-preview path, which must approximate the same answer against
 *     CURRENT policy ("preview approximates current policy; prepare/publish stamps it", R3b)
 * Both must agree. `tests/content/visibility.test.ts` pins the table; the SQL side is verified
 * against a real prepare_publish run in `tests/db/rpc-guards.test.ts`.
 */

export const VISIBILITY_ORDER = ['public', 'free', 'pro', 'hidden'] as const;
export type Visibility = (typeof VISIBILITY_ORDER)[number];

export const TIER_ORDER = ['anon', 'free', 'pro', 'admin'] as const;
export type Tier = (typeof TIER_ORDER)[number];

export type DefaultPolicy = Record<BlockKind, Visibility>;

/**
 * Mirrors the `default_policy` seed rows in migration 0002 (§3.8 /admin/policy).
 * The DB is authoritative at publish time; this constant is the fallback for pure/preview code
 * paths and the fixture the migration test compares against.
 */
export const DEFAULT_POLICY: DefaultPolicy = {
  asset: 'free',
  note: 'free',
  prompt: 'pro',
  params: 'pro',
  workflow_file: 'pro',
  link: 'public',
};

export function visibilityRank(v: Visibility): number {
  return VISIBILITY_ORDER.indexOf(v);
}

export function tierRank(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}

/** `coalesce(override, default_policy[kind])`. */
export function resolveVisibility(
  override: Visibility | null | undefined,
  kind: BlockKind,
  policy: DefaultPolicy = DEFAULT_POLICY,
): Visibility {
  return override ?? policy[kind];
}

/** A viewer sees a block iff the block's gate is at or below their tier. */
export function canView(tier: Tier, visibility: Visibility): boolean {
  return visibilityRank(visibility) <= tierRank(tier);
}

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === 'string' && (VISIBILITY_ORDER as readonly string[]).includes(value);
}
