import type { BlockKind, Localized } from '@/lib/content/schemas';
import {
  resolveVisibility,
  isVisibility,
  type DefaultPolicy,
  type Visibility,
} from '@/lib/content/visibility';
import type { AdminRevision } from './repo';

/**
 * PLAN §3.8 — "**Visibility control = effective-visibility table** per revision:
 * `block | kind | default | override | effective`, inline override editing. This is the 'admin
 * controls exactly which columns are exposed' surface."
 *
 * The `effective` column follows the SAME rule the read path follows (`lib/content/load.ts`), and
 * that is the point of building it here rather than eyeballing it in JSX:
 *
 *   · a STAMPED `resolved_visibility` always wins — after `prepare_publish` the table shows exactly
 *     what will ship, and on a published revision it shows what DID ship (a later policy edit is
 *     non-retroactive, §3.8, and this table must never pretend otherwise);
 *   · otherwise `coalesce(override, default_policy[kind])` through the shared resolver, which is
 *     the "preview approximates current policy" case (R3b).
 */

export interface VisibilityRow {
  blockId: string;
  stepId: string;
  stepOrder: number;
  blockOrder: number;
  /** "3.2" — the block's address in the revision, which is what an author actually navigates by. */
  label: string;
  stepTitle: Localized;
  kind: BlockKind;
  /** `default_policy[kind]` as it stands right now. */
  defaultVisibility: Visibility;
  /** The author's override, or null for inherit. */
  override: Visibility | null;
  effective: Visibility;
  /** True when `effective` came from the stamp rather than from current policy. */
  stamped: boolean;
}

export function buildVisibilityTable(
  revision: AdminRevision,
  policy: DefaultPolicy,
): VisibilityRow[] {
  const rows: VisibilityRow[] = [];
  for (const step of revision.steps) {
    for (const block of step.blocks) {
      const stamped = isVisibility(block.resolvedVisibility) ? block.resolvedVisibility : null;
      rows.push({
        blockId: block.id,
        stepId: step.id,
        stepOrder: step.order,
        blockOrder: block.order,
        label: `${step.order}.${block.order}`,
        stepTitle: step.title,
        kind: block.kind,
        defaultVisibility: policy[block.kind],
        override: block.visibility,
        effective: stamped ?? resolveVisibility(block.visibility, block.kind, policy),
        stamped: stamped !== null,
      });
    }
  }
  return rows;
}

/**
 * A stable fingerprint of "what every block on this revision is gated at".
 *
 * §8 M4 acceptance: "policy edit leaves published output byte-identical". Comparing this string
 * before and after a `/admin/policy` change is a stronger assertion than eyeballing one row —
 * it fails if ANY block on the revision moved.
 */
export function visibilityFingerprint(rows: VisibilityRow[]): string {
  return rows
    .map((row) => `${row.label}:${row.kind}:${row.effective}`)
    .sort()
    .join('|');
}
