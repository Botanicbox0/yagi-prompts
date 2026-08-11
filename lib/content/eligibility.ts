import type { PlaybookGate } from './load';
import type { Tier } from './visibility';

/**
 * PLAN §3.3 / §7 — playbook-level eligibility, as a pure function of (gate facts × tier).
 *
 * This is the decision the façade and the media gateway must agree on, so it lives in exactly one
 * place and both call it. It is deliberately separate from BLOCK-level visibility (`canView`):
 * eligibility answers "may this viewer open this playbook at all", visibility answers "may they see
 * these bytes". A viewer can be eligible for the page and still be locked out of every prompt on it.
 *
 * The three answers map onto three HTTP behaviours (§3.3 + M2 brief):
 *   · `ok`              → render / serve
 *   · `requires_signin` → the playbook EXISTS in public card metadata (§3.1) but is not showcase.
 *                         Anon is sent into Journey A, not to a 404 — a 404 here would contradict
 *                         the card the visitor just clicked.
 *   · `not_found`       → draft, archived, unpublished or unknown. 404 for everyone but an admin
 *                         using the preview path.
 */
export type Eligibility = 'ok' | 'requires_signin' | 'not_found';

export function decideEligibility(gate: PlaybookGate | null, tier: Tier): Eligibility {
  // Nothing published (draft-only, or a pointer that is not a published revision) ⇒ nothing to
  // serve on the read path. Admins reach drafts through the explicit preview path instead, which
  // is authorized separately — never by widening this rule.
  if (gate === null || gate.publishedRevisionId === null) return 'not_found';

  if (tier === 'admin') return 'ok';

  // `archived` is a playbook status, not a revision state: the pointer survives archiving, so the
  // status check is the only thing standing between an archived playbook and the public read path.
  if (gate.status !== 'published') return 'not_found';

  if (tier === 'anon') return gate.isShowcase ? 'ok' : 'requires_signin';

  // free / pro: published is enough. Block-level gating does the rest.
  return 'ok';
}
