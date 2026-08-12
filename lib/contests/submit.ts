import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { contestPhase } from './phase';
import {
  countRecentEntryWrites,
  loadContestBySlug,
  loadEntryByAuthor,
  loadProfileSnsUrl,
  recordEntryWrite,
  saveProfileSnsUrl,
  upsertEntry,
  type ContestRow,
  type EntryRow,
} from './repo';
import {
  ENTRY_WRITES_PER_DAY,
  EntrySubmissionSchema,
  RATE_WINDOW_HOURS,
} from './schemas';

/**
 * PLAN §14.1/§14.2 — the contest entry, as one injectable service.
 *
 * Everything abuse-facing is decided HERE, server-side, against the real database, and nothing is
 * trusted from the form:
 *
 *   · the AUTHOR is the session's user id — there is no field that could carry another;
 *   · the STATUS is `pending`, always. A resubmit RESETS to pending (§14.1) rather than keeping an
 *     approval, because the thing that was approved is not the thing that is now there;
 *   · the DEADLINE is compared against the contest's own `deadline_at` and the server's clock:
 *     "entry editing closes at the deadline (server-enforced)";
 *   · the RATE LIMIT is a `count(*)` over an append-only write ledger, not a cookie;
 *   · the PLACEMENT is cleared by the upsert — a medal belongs to a film, not to a slot.
 *
 * The §14.1 sns_url round trip lives here too, and it is deliberately two statements inside one
 * service call rather than two features: read the profile's `sns_url` to prefill the form, write it
 * back with the entry so the second contest never asks again. "Google login stays extra-info-free
 * until the first submission asks."
 */

export interface EntrySubmitDeps {
  sql: SqlRunner;
  /** Injected so the deadline tests can stand on the boundary instead of waiting for it. */
  now?: Date | number;
}

export type EntrySubmitFailure =
  | { code: 'sign_in_required' }
  | { code: 'not_found' }
  | { code: 'not_open'; detail: string }
  | { code: 'invalid'; detail: string }
  | { code: 'rate_limited'; detail: string };

export type EntrySubmitOutcome =
  | { ok: true; id: string; resubmitted: boolean }
  | ({ ok: false } & EntrySubmitFailure);

export interface EntrySubmitInput {
  title: string;
  videoUrl: string;
  snsUrl: string;
  note: string | null;
  consent: boolean;
}

/** §14.1: "≤10 entry writes/day/user" — so the ELEVENTH inside the window is refused. */
export function isRateLimited(recentWrites: number, limit = ENTRY_WRITES_PER_DAY): boolean {
  return recentWrites >= limit;
}

/**
 * What the form needs to render before anyone has typed anything: the contest, the reader's
 * existing entry (if any) and the SNS link to prefill.
 *
 * Returned as one object from one call so the page cannot render a form whose prefill came from a
 * different request than its resubmit notice.
 */
export interface EntryFormState {
  contest: ContestRow;
  existing: EntryRow | null;
  /** `profiles.sns_url`, or the existing entry's — whichever the reader last confirmed. */
  snsPrefill: string | null;
  open: boolean;
}

export async function loadEntryFormState(
  deps: EntrySubmitDeps,
  slug: string,
  userId: string | null,
): Promise<EntryFormState | null> {
  const contest = await loadContestBySlug(deps.sql, slug);
  if (contest === null || contest.status !== 'published') return null;

  const existing = userId === null ? null : await loadEntryByAuthor(deps.sql, contest.id, userId);
  const profileSns = userId === null ? null : await loadProfileSnsUrl(deps.sql, userId);

  return {
    contest,
    existing,
    // The entry's own SNS wins over the profile: it is the more recent statement of the same fact.
    snsPrefill: existing?.snsUrl ?? profileSns,
    open: contestPhase(contest, deps.now ?? Date.now()) === 'open',
  };
}

export async function submitEntry(
  deps: EntrySubmitDeps,
  viewer: Viewer,
  slug: string,
  input: EntrySubmitInput,
): Promise<EntrySubmitOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };

  const contest = await loadContestBySlug(deps.sql, slug);
  // An unpublished contest does not exist for an entrant, exactly as on the detail route — so a
  // draft's submit URL cannot be used to discover that a contest is coming.
  if (contest === null || contest.status !== 'published') return { ok: false, code: 'not_found' };

  const phase = contestPhase(contest, deps.now ?? Date.now());
  if (phase !== 'open') {
    return {
      ok: false,
      code: 'not_open',
      detail: phase,
    };
  }

  const parsed = EntrySubmissionSchema.safeParse({
    title: input.title,
    videoUrl: input.videoUrl,
    snsUrl: input.snsUrl,
    note: input.note === null || input.note.trim() === '' ? null : input.note,
    consent: input.consent === true ? true : undefined,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, code: 'invalid', detail };
  }

  const recent = await countRecentEntryWrites(deps.sql, viewer.userId, RATE_WINDOW_HOURS);
  if (isRateLimited(recent)) {
    return {
      ok: false,
      code: 'rate_limited',
      detail: `${recent}/${ENTRY_WRITES_PER_DAY} in ${RATE_WINDOW_HOURS}h`,
    };
  }

  const existing = await loadEntryByAuthor(deps.sql, contest.id, viewer.userId);

  const id = await upsertEntry(deps.sql, {
    id: randomUUID(),
    contestId: contest.id,
    authorId: viewer.userId,
    title: parsed.data.title,
    videoUrl: parsed.data.videoUrl,
    note: parsed.data.note,
    snsUrl: parsed.data.snsUrl,
  });

  // §14.1 write-back: the next contest's form is already filled in. Written AFTER the entry so a
  // refused write never updates the profile, and unconditionally so a corrected link corrects both.
  await saveProfileSnsUrl(deps.sql, viewer.userId, parsed.data.snsUrl);
  await recordEntryWrite(deps.sql, viewer.userId, contest.id);

  return { ok: true, id, resubmitted: existing !== null };
}
