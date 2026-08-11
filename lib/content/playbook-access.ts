import type { Viewer } from '@/lib/auth/viewer';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicContentUrl } from './asset-url';
import { decideEligibility } from './eligibility';
import {
  loadNeighbours,
  loadPlaybookGate,
  loadPublishedRevisionBySlug,
  loadRevisionById,
  type Neighbours,
  type PlaybookGate,
} from './load';
import { shapeRevision, type ShapedRevision } from './shape';
import type { Tier } from './visibility';

/**
 * PLAN §7 — **the one gate**, with its two dependencies injected.
 *
 * `lib/content/facade.ts` is the thin `server-only` wrapper that resolves those two (the
 * server-verified session and the SqlRunner) and is what routes call. The split exists so this
 * half — where every eligibility decision actually happens — can be driven directly against PGlite
 * with a fabricated viewer. That is the M2 brief's stated seam: with no Supabase project yet (§11)
 * there is no way to mint a real session, so the tier × status × showcase matrix is exercised by
 * INJECTING the viewer, never by faking a session or adding a backdoor to the real one.
 *
 * The order below is the security-relevant part, and it is the same order §3.3 gives the media
 * gateway so a page and the bytes it references can never disagree:
 *
 *   1. tier arrives already resolved from a server-verified session — no caller supplies it
 *   2. playbook eligibility  → ok | requires_signin | not_found  (pure, `decideEligibility`)
 *   3. load the CURRENT published revision (the loader refuses anything else)
 *   4. pure `shapeRevision`, every block carrying a non-null effective visibility
 *   5. gated content AND gated storage keys are gone by construction — the shaper never emits a
 *      staging key, and a private published key becomes an entitlement-checked gateway path.
 */

export interface ShapedPlaybookOptions {
  /**
   * Admin preview (§3.8 "preview-as", §7). Honoured ONLY after `is_admin` verification; a
   * non-admin supplying either option gets 404, never a silent downgrade to the public path.
   * The admin UI that passes these lands in M4 — this is the plumbing, and it is tested.
   */
  revisionId?: string;
  previewTier?: Tier;
}

export interface ShapedPlaybookDeps {
  sql: SqlRunner;
  viewer: Viewer;
}

export interface ShapedPlaybookOk {
  status: 'ok';
  playbook: ShapedRevision;
  viewer: Viewer;
  gate: PlaybookGate;
  neighbours: Neighbours;
  /** True when an admin is looking through the preview path rather than the public one. */
  preview: boolean;
}

export type ShapedPlaybookResult =
  | ShapedPlaybookOk
  | { status: 'requires_signin' }
  | { status: 'not_found' };

export const PLAYBOOK_NOT_FOUND = { status: 'not_found' } as const;

/** Public-bucket objects are served by URL when a CDN exists, else through the gateway (§11). */
const SHAPE_URLS = { publicUrl: (key: string) => publicContentUrl(key) };

export async function shapePlaybook(
  deps: ShapedPlaybookDeps,
  slug: string,
  options: ShapedPlaybookOptions = {},
): Promise<ShapedPlaybookResult> {
  const { sql, viewer } = deps;

  const wantsPreview = options.revisionId !== undefined || options.previewTier !== undefined;
  if (wantsPreview && !viewer.isAdmin) return PLAYBOOK_NOT_FOUND;

  const gate = await loadPlaybookGate(sql, slug);
  if (gate === null) return PLAYBOOK_NOT_FOUND;

  const tier: Tier = options.previewTier ?? viewer.tier;

  // A pinned revision id IS the admin asking for a specific draft/superseded revision; playbook
  // eligibility would answer `not_found` for exactly the thing they asked to see. `is_admin` was
  // verified above, and the revision is still checked to belong to this playbook below.
  if (options.revisionId === undefined) {
    const eligibility = decideEligibility(gate, tier);
    if (eligibility === 'requires_signin') return { status: 'requires_signin' };
    if (eligibility === 'not_found') return PLAYBOOK_NOT_FOUND;
  }

  const revision =
    options.revisionId === undefined
      ? await loadPublishedRevisionBySlug(sql, slug)
      : await loadRevisionById(sql, options.revisionId);

  if (revision === null) return PLAYBOOK_NOT_FOUND;
  // A cross-playbook preview id is a 404, not someone else's draft.
  if (revision.playbook_id !== gate.playbookId) return PLAYBOOK_NOT_FOUND;

  return {
    status: 'ok',
    playbook: shapeRevision(revision, tier, SHAPE_URLS),
    viewer,
    gate,
    neighbours: await loadNeighbours(sql, slug),
    preview: wantsPreview,
  };
}
