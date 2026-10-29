import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import type { Mailer } from '@/lib/notify/mailer';

/**
 * PLAN §3.8 — everything an admin mutation needs, injected.
 *
 * Same seam as `lib/content/playbook-access.ts` (M2) and `lib/billing/checkout.ts` (M3): the server
 * action resolves the three dependencies (`requireAdmin()`, the `SqlRunner`, the storage driver) and
 * hands them over, so the whole operations layer can be driven against real PGlite + a real local
 * storage root in vitest without a session, a request or a backdoor.
 *
 * `viewer` is carried rather than a boolean so the guard reads the SAME resolved viewer every other
 * gate reads. Nothing here ever accepts a client-supplied admin flag.
 */
export interface AdminContext {
  sql: SqlRunner;
  storage: StorageDriver;
  viewer: Viewer;
  /**
   * `revalidateTag('catalog')` (§3.1), injected rather than imported.
   *
   * `next/cache` only works inside a request scope, so importing it here would make the whole
   * operations layer un-testable. The server action passes `revalidateCatalog`; vitest passes a spy
   * and asserts that publishing — and only publishing — calls it.
   */
  revalidate?: () => void;
  /**
   * `revalidateTag('prompts')` (§13.2), injected on the same terms and for the same reason.
   *
   * A second function rather than a parameter on the first: the two tags belong to two different
   * publication events (a playbook goes live vs a community prompt is approved), and an operation
   * that called the wrong one would be a silently stale page rather than a test failure.
   */
  revalidatePrompts?: () => void;
  /**
   * `revalidateTag('contests')` (§14.2), injected on the same terms as the other two.
   *
   * A third function rather than a flag, because the contests surface has the most write events per
   * day of the three (every entry approval touches it) and the fewest reasons to move the others.
   */
  revalidateContests?: () => void;
  /** `revalidateTag('campaigns')` (docs/CAMPAIGNS.md), injected on the same terms as the other three. */
  revalidateCampaigns?: () => void;
  /**
   * Mail (2026-09-13): the configured mailer and the public origin, injected so the operations
   * layer never reads env. Absent in older tests → the operation simply sends nothing.
   */
  mail?: AdminMail;
  /**
   * Run `task` after the response has gone out (`next/server`'s `after()` in the route). The
   * campaign mails and the template-drop broadcast go through here so a slow provider can neither
   * delay the redirect nor turn a committed status change into a 500. The test harness runs the
   * task inline and records it.
   */
  defer?: (task: () => Promise<void>) => void;
}

export interface AdminMail {
  mailer: Mailer | null;
  siteUrl: string;
}

/** Codes, never prose: the UI maps them through the bilingual dictionary (§3.9). */
export type AdminSuccessCode =
  | 'created'
  | 'saved'
  | 'deleted'
  | 'moved'
  | 'prepared'
  | 'published'
  | 'cachesRefreshed'
  | 'draftOpened'
  | 'archived'
  | 'unarchived'
  /** §13.1 moderation outcomes — a submission becoming public is not the same event as a save. */
  | 'approved'
  | 'rejected'
  /** §14 — taking a contest off the listing is not an archive and not a save. */
  | 'unpublished'
  /** Campaigns (docs/CAMPAIGNS.md): the four application outcomes a creator is told about. */
  | 'selected'
  | 'declined'
  | 'verified'
  | 'paid'
  /** 2026-09-13 — the weekly drop's mail went out (or is going out, after the redirect). */
  | 'announced';

export type AdminErrorCode =
  | 'forbidden'
  | 'unknownOperation'
  | 'invalid'
  | 'notFound'
  | 'duplicateSlug'
  | 'notDraft'
  | 'privileged'
  | 'notPrepared'
  | 'manifestIncomplete'
  | 'manifestStale'
  | 'changeNoteRequired'
  | 'localeIncomplete'
  | 'assetIncomplete'
  | 'storage'
  /** §13.1 caps: a posted file the server refused (size, duration or type). */
  | 'upload'
  /**
   * §14 contests. Three genuinely distinct refusals, each with its own next action:
   *   notPublishable    — the contest is missing something a published contest must have
   *   deadlineNotPassed — placements are a post-deadline act (§14.1)
   *   duplicatePlacement— that podium step is taken (the partial unique index says so)
   */
  | 'notPublishable'
  | 'deadlineNotPassed'
  | 'duplicatePlacement'
  /**
   * The entrant replaced their film between the queue being rendered and the moderator pressing a
   * button. Not an error the moderator made — an instruction to watch the new one.
   */
  | 'staleReview'
  /** A judged contest's deadline cannot be pushed outwards while medals are on the board. */
  | 'placementsLocked'
  /**
   * Campaigns. Each is a distinct next action:
   *   badTransition   — the state machine refuses that move from where the row is
   *   slotsFull       — the client's slot count is a promise; the N+1th selection is refused
   *   notReleasable   — the seven-day hold has not ended
   *   metricsRequired — a view-based payout needs the snapshot before it can be priced
   */
  | 'badTransition'
  | 'slotsFull'
  | 'notReleasable'
  | 'metricsRequired'
  /**
   * Brand workspace (P2-6). The service's own refusal, phrased for a campaign rather than for the
   * contest queue the generic `staleReview` sentence was written for:
   *   brandConflict        — the campaign changed since the page loaded, or that status move is not allowed
   *   brandNotActive       — only an active campaign takes content, posts and metrics
   *   brandConsentRequired — studio production needs the creator-consent box ticked
   *   brandNotShared       — a campaign-only invite for a campaign the client cannot see yet
   */
  | 'brandConflict'
  | 'collaborationRateLimited'
  /** The brand host's studio door: this admin's action budget for the window is spent (lib/admin/brand-host-audit.ts). */
  | 'studioRateLimited'
  | 'brandNotActive'
  | 'brandConsentRequired'
  | 'brandNotShared'
  | 'unknown';

export interface AdminSuccess {
  /** One-time response body only; never included in redirects or logs. */
  invitationToken?: string;
  ok: true;
  code: AdminSuccessCode;
  /** Extra context for the banner (a slug, a revision number) — never a secret. */
  detail?: string;
  /** Where the dispatcher should land afterwards; defaults to the form's `_back`. */
  to?: string;
}

export interface AdminFailure {
  ok: false;
  code: AdminErrorCode;
  detail?: string;
}

export type AdminOutcome = AdminSuccess | AdminFailure;

export const ok = (code: AdminSuccessCode, extra: Omit<AdminSuccess, 'ok' | 'code'> = {}): AdminSuccess => ({
  ok: true,
  code,
  ...extra,
});

export const fail = (code: AdminErrorCode, detail?: string): AdminFailure =>
  detail === undefined ? { ok: false, code } : { ok: false, code, detail };
