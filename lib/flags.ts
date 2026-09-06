/**
 * PLAN §3.5 — "delivery ships in M5; zero notification UI before that. Until M5, the publish RPC
 * is called with p_notify_kind = NULL (enforced by a server flag) and no checkbox exists in admin."
 *
 * This is that server flag. **M5 flipped it**, and flipping it is what turns on, together:
 *   · the admin publish checkbox (`components/admin/editor-panels.tsx`) and the `p_notify_kind`
 *     argument it reaches the RPC through (`lib/publish/pipeline.ts`);
 *   · the two `/account` toggles;
 *   · the worker's willingness to find work at all — with no jobs enqueued, it has none.
 * Turning it back off stops NEW jobs being enqueued; jobs already in the outbox stay valid, which
 * is the correct kill-switch semantics for a durable queue.
 */
export const NOTIFICATIONS_ENABLED = true;

/** PLAN §3.6 — the ad rail is a single house placeholder until a real advertiser exists. */
export const AD_SLOTS_DB_BACKED = false;

/**
 * PLAN §4 — `/[locale]/p/[slug]`. M2 shipped it, so the §3.1 split is live again: showcase cards
 * link to the public detail page, everything else funnels through the login wall.
 */
export const PLAYBOOK_DETAIL_ROUTE_READY = true;

/**
 * PLAN §13.2 — "Nav becomes: **Prompts · Pricing** (+ locale toggle, sign in). Library/playbooks
 * denavigated behind `PLAYBOOKS_IN_NAV=false` (routes stay functional; fixtures keep the machinery
 * tested)."
 *
 * DENAVIGATED, not deleted, and the distinction is the whole point of the flag: `/library`,
 * `/[locale]/p/[slug]`, the media gateway, the publish RPCs and every one of their tests keep
 * working exactly as merged. Flipping this back to `true` restores the link in the nav and the
 * footer and nothing else has to change — which is what "leave the nav until re-activated" asks
 * for, as one greppable constant rather than a deletion somebody has to undo by hand.
 */
export const PLAYBOOKS_IN_NAV = false;

/**
 * docs/TEMPLATES-IA.md §8 — the render queue is LIVE for admins and a demo for everyone else until
 * payment is wired. Flipping this opens `POST /api/renders` to every signed-in reader; the studio
 * follows through `/api/renders/access`. Leave false until the pay step creates the job.
 */
export const RENDER_PIPELINE_PUBLIC = false;
