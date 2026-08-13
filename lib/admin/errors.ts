import type { AdminErrorCode } from './context';

/**
 * PLAN §3.8 — "Draft-only writes (the DB triggers enforce it — surface their errors as friendly
 * form errors, don't pre-duplicate every rule client-side)."
 *
 * The database is the authority on immutability, locale completeness, change notes and manifest
 * currentness (§6 triggers + the two RPCs). Re-implementing those rules in TypeScript would create
 * a second, drifting source of truth — so instead every mutation runs and its rejection is
 * CLASSIFIED here into one of the codes the admin dictionary knows how to phrase.
 *
 * Ordering matters: the patterns are checked most-specific first, because several RPC messages
 * legitimately contain more than one of these words.
 */

interface Rule {
  code: AdminErrorCode;
  pattern: RegExp;
}

const RULES: Rule[] = [
  /**
   * §14 contests — named first because these constraint names contain words later rules match
   * ("requires", "published"). The TypeScript gates in `lib/contests/schemas.ts` normally answer
   * before the database has to; these rules exist for the case they did not (a concurrent edit, a
   * direct SQL write, a future caller that forgot).
   */
  { code: 'duplicatePlacement', pattern: /uq_contest_entries_placement/i },
  {
    code: 'notPublishable',
    pattern: /contests_published_requires_|contests_deadline_after_start|contests_brand_name_present/i,
  },
  { code: 'invalid', pattern: /contest_entries_[a-z_]+(?:_len|_http|_range|_approved)/i },
  { code: 'manifestStale', pattern: /manifest is stale/i },
  { code: 'manifestIncomplete', pattern: /manifest incomplete/i },
  { code: 'notPrepared', pattern: /not prepared|requires a draft revision/i },
  { code: 'changeNoteRequired', pattern: /requires a bilingual change_note/i },
  {
    code: 'localeIncomplete',
    pattern: /requires both en and ko|missing a locale/i,
  },
  { code: 'assetIncomplete', pattern: /must carry sha256 \+ staging_key/i },
  {
    code: 'notDraft',
    pattern:
      /published content is immutable|is (published|superseded) and immutable|revisions are born draft|publish manifest of a .* revision/i,
  },
  /**
   * Deleting the revision `playbooks.published_revision_id` points at trips the composite FK before
   * the immutability trigger gets a word in. Same meaning to the author — "that one is live" — so
   * it is classified the same way rather than surfaced as a raw constraint name.
   */
  { code: 'notDraft', pattern: /fk_published_revision_same_playbook/i },
  {
    code: 'privileged',
    pattern: /reserved to the publish RPCs|stamped by (prepare_publish|publish_revision)|swapped by publish_revision/i,
  },
  { code: 'duplicateSlug', pattern: /playbooks_slug_key|duplicate key value.*slug/i },
  // Before `notFound`: "storage object not found" contains it, and a missing OBJECT is a different
  // problem for the author than a missing ROW.
  { code: 'storage', pattern: /storage object not found|illegal storage key/i },
  { code: 'notFound', pattern: /not found/i },
];

/** The raw driver message, trimmed to something a banner can carry without leaking a query. */
export function shortMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function classifyDbError(error: unknown): AdminErrorCode {
  const message = shortMessage(error);
  for (const rule of RULES) {
    if (rule.pattern.test(message)) return rule.code;
  }
  return 'unknown';
}
