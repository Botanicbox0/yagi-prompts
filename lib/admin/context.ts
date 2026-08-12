import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';

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
  | 'rejected';

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
  | 'unknown';

export interface AdminSuccess {
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
