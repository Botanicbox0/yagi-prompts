import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countRecentEntryWrites, loadProfileSnsUrl } from '@/lib/contests/repo';
import { exceedsQuota, isRateLimited, submitEntry } from '@/lib/contests/submit';
import { ENTRY_WRITES_PER_DAY, RATE_WINDOW_HOURS } from '@/lib/contests/schemas';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import {
  contestHarness,
  entrantViewer,
  makeContest,
  NOW,
  type ContestHarness,
} from '../helpers/contests';

/**
 * PLAN §14.1 — the entry write as ONE transaction (M9 review, finding 1).
 *
 * The blocker was that the deadline check, the quota count, the upsert, the profile write-back and
 * the ledger insert were five independent statements. PGlite is single-connection, so this file
 * cannot spawn two racing requests — what it CAN do, and what actually matters, is pin the
 * transactional SEMANTICS the fix rests on:
 *
 *   · every statement runs inside a transaction, so a failure rolls ALL of them back — including
 *     the reserved ledger row, the property a check-then-insert can never have;
 *   · the reservation ordering is insert-then-check, so the write being decided is counted;
 *   · the entrant's row is locked before the quota is read;
 *   · the deadline is evaluated by the DATABASE, in the same transaction as the write.
 *
 * The concurrency itself is a property of `FOR UPDATE` plus `transaction()` pinning one connection;
 * the pooled implementation of the latter is asserted in `tests/db/transaction.test.ts`.
 */

const entrant = entrantViewer('free');

const input = (overrides: Partial<Parameters<typeof submitEntry>[3]> = {}) => ({
  title: 'Last train, Yeongdeungpo',
  videoUrl: 'https://www.youtube.com/watch?v=abc',
  snsUrl: 'https://www.instagram.com/hana.films',
  note: null,
  consent: true,
  ...overrides,
});

/**
 * A runner that observes (and may fail) every statement — INCLUDING the ones inside the
 * transaction.
 *
 * The delegation shape is the point: `transaction()` opens the real one on the base runner but
 * hands the CALLBACK this wrapper, so statements stay on the same connection and still pass through
 * the spy. Delegating naively (`base.transaction(fn)`) would hand `fn` the base runner and the spy
 * would silently observe nothing — which is exactly the bug this helper exists to avoid writing.
 */
function spyRunner(
  base: SqlRunner,
  hook: (text: string) => Error | null = () => null,
): { runner: SqlRunner; statements: string[] } {
  const statements: string[] = [];
  const runner: SqlRunner = {
    query(text, params) {
      statements.push(text);
      const failure = hook(text);
      if (failure) return Promise.reject(failure);
      return base.query(text, params);
    },
    transaction: (fn) => base.transaction(() => fn(runner)),
  };
  return { runner, statements };
}

describe('quota arithmetic (§14.1)', () => {
  it('reserves before it checks, and the two vantage points agree', () => {
    // `exceedsQuota` counts the write being decided; `isRateLimited` counts the ones before it.
    for (let before = 0; before <= ENTRY_WRITES_PER_DAY + 2; before += 1) {
      expect(exceedsQuota(before + 1), `before=${before}`).toBe(isRateLimited(before));
    }
  });
});

describe('submitEntry atomicity (§14.1 / M9 review)', () => {
  let harness: ContestHarness;
  const deps = () => ({ sql: harness.sql, now: NOW });

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  const writes = () =>
    countRecentEntryWrites(harness.sql, FIXTURE_USERS.free.id, RATE_WINDOW_HOURS);

  const entries = async () => {
    const { rows } = await harness.sql.query<{ n: number }>(
      'select count(*)::int as n from contest_entries',
    );
    return rows[0]?.n ?? 0;
  };

  it('wraps the whole write in a transaction, in the specified order', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -1, deadlineInDays: 7 });
    const { runner, statements } = spyRunner(harness.sql);

    const result = await submitEntry({ sql: runner, now: NOW }, entrant, 'open-now', input());
    expect(result.ok).toBe(true);

    // BEGIN/COMMIT are issued by the runner itself, so the spy sees only what the CALLBACK ran —
    // which is the thing whose order matters. That every one of these lands inside the transaction
    // is what the rollback tests below measure.
    const at = (needle: string) => statements.findIndex((s) => s.includes(needle));

    // 1 lock → 2 contest+clock → 3 reserve → 4 count → 5 upsert → 6 profile.
    expect(at('for update')).toBe(0);
    expect(at('from contests')).toBeGreaterThan(at('for update'));
    expect(at('insert into contest_entry_writes')).toBeGreaterThan(at('from contests'));
    expect(at('count(*)::int as n from contest_entry_writes')).toBeGreaterThan(
      at('insert into contest_entry_writes'),
    );
    expect(at('insert into contest_entries')).toBeGreaterThan(
      at('count(*)::int as n from contest_entry_writes'),
    );
    expect(at('update profiles set sns_url')).toBeGreaterThan(at('insert into contest_entries'));
  });

  /**
   * The reservation must not survive its own refusal. Before the fix a rate-limited attempt could
   * leave a counted write with no entry — the quota would then decay for a reason no row explained.
   */
  it('rolls the reserved ledger row back when the quota is refused', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -1, deadlineInDays: 7 });
    for (let n = 0; n < ENTRY_WRITES_PER_DAY; n += 1) {
      expect(
        (await submitEntry(deps(), entrant, 'open-now', input({ title: `Cut ${n}` }))).ok,
      ).toBe(true);
    }
    expect(await writes()).toBe(ENTRY_WRITES_PER_DAY);

    const refused = await submitEntry(deps(), entrant, 'open-now', input({ title: 'One too many' }));
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.code).toBe('rate_limited');
    // Exactly the quota, not one more: the eleventh reservation was rolled back with the refusal.
    expect(await writes()).toBe(ENTRY_WRITES_PER_DAY);
  });

  it('leaves ZERO rows behind when the LAST statement fails', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -1, deadlineInDays: 7 });
    // The profile write-back is last, so everything before it has already been written and only a
    // real rollback can undo it.
    const { runner } = spyRunner(harness.sql, (text) =>
      text.includes('update profiles set sns_url') ? new Error('connection terminated') : null,
    );

    await expect(
      submitEntry({ sql: runner, now: NOW }, entrant, 'open-now', input()),
    ).rejects.toThrow('connection terminated');

    expect(await entries()).toBe(0);
    expect(await writes()).toBe(0);
    expect(await loadProfileSnsUrl(harness.sql, FIXTURE_USERS.free.id)).toBeNull();
  });

  it('leaves ZERO rows behind when the reservation itself fails', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -1, deadlineInDays: 7 });
    const { runner } = spyRunner(harness.sql, (text) =>
      text.includes('insert into contest_entry_writes') ? new Error('ledger unavailable') : null,
    );

    await expect(
      submitEntry({ sql: runner, now: NOW }, entrant, 'open-now', input()),
    ).rejects.toThrow('ledger unavailable');

    expect(await entries()).toBe(0);
    expect(await writes()).toBe(0);
  });

  it('leaves the PREVIOUS entry untouched when a resubmit fails', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -1, deadlineInDays: 7 });
    expect((await submitEntry(deps(), entrant, 'open-now', input({ title: 'First cut' }))).ok).toBe(
      true,
    );

    const { runner } = spyRunner(harness.sql, (text) =>
      text.includes('update profiles set sns_url') ? new Error('boom') : null,
    );
    await expect(
      submitEntry({ sql: runner, now: NOW }, entrant, 'open-now', input({ title: 'Second cut' })),
    ).rejects.toThrow('boom');

    const { rows } = await harness.sql.query<{ title: string }>(
      'select title from contest_entries',
    );
    // A partially applied resubmit would have replaced the content and reset the status; it did not.
    expect(rows.map((r) => r.title)).toEqual(['First cut']);
    expect(await writes()).toBe(1);
  });

  /**
   * The deadline is the database's opinion, not the app's. No `now` override is what a production
   * request does, so this is the path that has to be right.
   */
  it('evaluates the deadline with the database clock when no override is given', async () => {
    const { id } = await makeContest(harness, {
      slug: 'just-closed',
      startsInDays: -10,
      deadlineInDays: 5,
    });
    // Both instants moved onto the DATABASE's clock — the fixture's `NOW` is a different day, and
    // a deadline behind the start would trip `contests_deadline_after_start` before the test began.
    await harness.sql.query(
      `update contests
          set starts_at = now() - interval '1 day', deadline_at = now() - interval '1 second'
        where id = $1`,
      [id],
    );

    const result = await submitEntry({ sql: harness.sql }, entrant, 'just-closed', input());
    expect(result).toMatchObject({ ok: false, code: 'not_open', detail: 'closed' });
    expect(await writes()).toBe(0);
  });

  it('accepts a write the database clock still considers open', async () => {
    const { id } = await makeContest(harness, {
      slug: 'just-open',
      startsInDays: -10,
      deadlineInDays: 5,
    });
    await harness.sql.query(
      `update contests
          set starts_at = now() - interval '1 day', deadline_at = now() + interval '1 minute'
        where id = $1`,
      [id],
    );
    expect((await submitEntry({ sql: harness.sql }, entrant, 'just-open', input())).ok).toBe(true);
  });

  it('refuses when the entrant has no profile row, and writes nothing', async () => {
    await makeContest(harness, { slug: 'open-now', startsInDays: -1, deadlineInDays: 7 });
    const ghost = { ...entrant, userId: '00000000-0000-4000-8000-0000000000ff' };
    expect(await submitEntry(deps(), ghost, 'open-now', input())).toEqual({
      ok: false,
      code: 'sign_in_required',
    });
    expect(await countRecentEntryWrites(harness.sql, ghost.userId, RATE_WINDOW_HOURS)).toBe(0);
    expect(await entries()).toBe(0);
  });
});

describe('singleConnectionTransaction (PGlite / `pg.Client`)', () => {
  let harness: ContestHarness;

  beforeEach(async () => {
    harness = await contestHarness();
  });
  afterEach(async () => harness.close());

  it('commits on success', async () => {
    const runner = makeSingleConnectionRunner(harness.sql.query);
    await runner.transaction(async (tx) => {
      await tx.query('update profiles set sns_url = $2 where id = $1', [
        FIXTURE_USERS.free.id,
        'https://example.com/committed',
      ]);
    });
    expect(await loadProfileSnsUrl(harness.sql, FIXTURE_USERS.free.id)).toBe(
      'https://example.com/committed',
    );
  });

  it('rolls back on a throw, and leaves the connection usable', async () => {
    const runner = makeSingleConnectionRunner(harness.sql.query);
    await expect(
      runner.transaction(async (tx) => {
        await tx.query('update profiles set sns_url = $2 where id = $1', [
          FIXTURE_USERS.free.id,
          'https://example.com/rolled-back',
        ]);
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');

    expect(await loadProfileSnsUrl(harness.sql, FIXTURE_USERS.free.id)).toBeNull();
    // A rollback that left the session aborted would poison every later query on this instance.
    const { rows } = await runner.query<{ ok: number }>('select 1 as ok');
    expect(rows[0]?.ok).toBe(1);
  });
});
