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
 * The same rule, asked the other way round: the quota is RESERVED by inserting the ledger row
 * first, so by the time it is checked the write being decided is already counted.
 *
 * `exceedsQuota(n) === isRateLimited(n - 1)` by construction — one rule, two vantage points. The
 * reservation ordering is what the M9 review asked for: a check-then-insert leaves a window in
 * which a crash (or a later failure) drops a write that was never counted, whereas an
 * insert-then-check that rolls back removes the reservation with everything else.
 */
export function exceedsQuota(writesIncludingThisOne: number, limit = ENTRY_WRITES_PER_DAY): boolean {
  return writesIncludingThisOne > limit;
}

/**
 * Thrown to unwind the transaction with a REASON.
 *
 * A refusal has to roll back (the reserved ledger row must not survive) and it is not an error —
 * so the outcome rides on the exception and is unwrapped immediately outside the transaction.
 */
class RefuseEntry extends Error {
  constructor(readonly outcome: { ok: false } & EntrySubmitFailure) {
    super(`entry refused: ${outcome.code}`);
    this.name = 'RefuseEntry';
  }
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

/**
 * One entry write, as ONE database transaction.
 *
 * The M9 review's blocker was that the deadline check, the quota count, the upsert, the profile
 * write-back and the ledger insert were five independent statements: two concurrent requests could
 * both read a quota of 9 and both write, and a failure between statements could leave a counted
 * write with no entry (or an entry with no count). All five now run on ONE connection inside ONE
 * transaction, in this order and for these reasons:
 *
 *   1. **lock the entrant's profile row** (`FOR UPDATE`). Every write by this user serialises here,
 *      which is what makes the quota count below a decision rather than a guess. The profile row is
 *      the natural choice over an advisory lock: it is the very row step 5 updates, so locking it
 *      also removes the lost-update window on `sns_url`, and there is no hash to collide.
 *   2. **read the phase from the DATABASE's clock**, not the app's. `now()` is evaluated inside the
 *      same transaction as the write it authorises, so a request that arrives a millisecond before
 *      the deadline cannot be committed a second after it by a slow app server. `deps.now`
 *      overrides it for tests and is null in production.
 *   3. **reserve the quota by inserting the ledger row FIRST**, then count. A rollback removes the
 *      reservation along with everything else, so a refused or failed write can never leave an
 *      uncounted one behind.
 *   4. upsert the entry (§14.1: replaces + resets to pending + clears the placement).
 *   5. write `profiles.sns_url` back.
 *
 * A refusal unwinds through `RefuseEntry`, so it rolls back too — the reserved ledger row for a
 * rate-limited attempt does not survive to consume tomorrow's quota.
 */
export async function submitEntry(
  deps: EntrySubmitDeps,
  viewer: Viewer,
  slug: string,
  input: EntrySubmitInput,
): Promise<EntrySubmitOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const userId = viewer.userId;

  // Validation happens BEFORE the transaction: it needs no database, and holding a row lock while
  // running zod would serialise every entrant behind the slowest malformed payload.
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

  const at = deps.now === undefined ? null : new Date(deps.now).toISOString();

  try {
    return await deps.sql.transaction(async (tx) => {
      // 1 — serialise this user's writes.
      const locked = await tx.query<{ id: string }>(
        'select id from profiles where id = $1 for update',
        [userId],
      );
      // No profile row means no account this server knows about. Fail closed rather than write.
      if (locked.rows.length === 0) throw new RefuseEntry({ ok: false, code: 'sign_in_required' });

      // 2 — the contest and its phase, decided by the database's clock inside this transaction.
      const found = await tx.query<{
        id: string;
        status: string;
        started: boolean | null;
        ended: boolean | null;
      }>(
        `select id, status,
                (starts_at is not null and coalesce($2::timestamptz, now()) >= starts_at) as started,
                (deadline_at is not null and coalesce($2::timestamptz, now()) >= deadline_at) as ended
           from contests
          where slug = $1`,
        [slug, at],
      );
      const contest = found.rows[0];
      // An unpublished contest does not exist for an entrant, exactly as on the detail route — so a
      // draft's submit URL cannot be used to discover that a contest is coming.
      if (!contest || contest.status !== 'published') {
        throw new RefuseEntry({ ok: false, code: 'not_found' });
      }
      if (!contest.started) throw new RefuseEntry({ ok: false, code: 'not_open', detail: 'upcoming' });
      if (contest.ended) throw new RefuseEntry({ ok: false, code: 'not_open', detail: 'closed' });

      // 3 — reserve, then count. The row just written is included in the count.
      await recordEntryWrite(tx, userId, contest.id);
      const writes = await countRecentEntryWrites(tx, userId, RATE_WINDOW_HOURS);
      if (exceedsQuota(writes)) {
        throw new RefuseEntry({
          ok: false,
          code: 'rate_limited',
          detail: `${writes - 1}/${ENTRY_WRITES_PER_DAY} in ${RATE_WINDOW_HOURS}h`,
        });
      }

      // 4 — the entry itself.
      const existing = await loadEntryByAuthor(tx, contest.id, userId);
      const id = await upsertEntry(tx, {
        id: randomUUID(),
        contestId: contest.id,
        authorId: userId,
        title: parsed.data.title,
        videoUrl: parsed.data.videoUrl,
        note: parsed.data.note,
        snsUrl: parsed.data.snsUrl,
      });

      // 5 — §14.1 write-back: the next contest's form is already filled in.
      await saveProfileSnsUrl(tx, userId, parsed.data.snsUrl);

      return { ok: true, id, resubmitted: existing !== null };
    });
  } catch (err) {
    if (err instanceof RefuseEntry) return err.outcome;
    throw err;
  }
}
