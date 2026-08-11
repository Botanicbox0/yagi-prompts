/**
 * PLAN §3.5 — "delivery ships in M5; zero notification UI before that. Until M5, the publish RPC
 * is called with p_notify_kind = NULL (enforced by a server flag) and no checkbox exists in admin."
 *
 * This is that server flag. Flip it in M5, not before.
 */
export const NOTIFICATIONS_ENABLED = false;

/** PLAN §3.6 — the ad rail is a single house placeholder until a real advertiser exists. */
export const AD_SLOTS_DB_BACKED = false;

/**
 * PLAN §4 — `/[locale]/p/[slug]` is M2's route. Until it exists, every catalog card funnels
 * through the login wall rather than linking into a 404. Flip this in M2 to restore the §3.1
 * split (showcase → public detail page; everything else → login wall).
 */
export const PLAYBOOK_DETAIL_ROUTE_READY = false;
