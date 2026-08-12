import { describe, expect, it } from 'vitest';
import { makePooledRunner, type PoolLike } from '@/lib/db/sql-runner';

/**
 * The pooled `transaction()` (M9 review, finding 1).
 *
 * This is the implementation that made the whole seam necessary, and it cannot be exercised against
 * PGlite — PGlite has one connection, so it would pass whether or not the code pinned one. The
 * property under test is precisely the pooling behaviour:
 *
 *   `pool.query('BEGIN')` then `pool.query('INSERT …')` may take two DIFFERENT connections. The
 *   BEGIN is then discarded when its connection is released and the insert autocommits — a
 *   transaction that silently is not one.
 *
 * So the pool is a stub that records WHICH connection each statement ran on, and the assertions are
 * about connection identity rather than about SQL.
 */

interface Recorded {
  connection: number | 'pool';
  text: string;
}

function stubPool() {
  const log: Recorded[] = [];
  let opened = 0;
  let released = 0;

  const pool: PoolLike = {
    query(text) {
      log.push({ connection: 'pool', text });
      return Promise.resolve({ rows: [] });
    },
    connect() {
      opened += 1;
      const id = opened;
      return Promise.resolve({
        query(text: string) {
          log.push({ connection: id, text });
          return Promise.resolve({ rows: [] });
        },
        release() {
          released += 1;
        },
      });
    },
  };

  return { pool, log, opened: () => opened, released: () => released };
}

describe('makePooledRunner (§14.1 atomicity)', () => {
  it('runs BEGIN, the callback and COMMIT on ONE pinned connection', async () => {
    const { pool, log, opened, released } = stubPool();
    const runner = makePooledRunner(pool);

    await runner.transaction(async (tx) => {
      await tx.query('insert into contest_entry_writes values (1)');
      await tx.query('select count(*) from contest_entry_writes');
    });

    expect(opened()).toBe(1);
    expect(released()).toBe(1);
    // Every statement — the BEGIN, both of the callback's, and the COMMIT — on connection 1.
    expect(log.map((entry) => entry.connection)).toEqual([1, 1, 1, 1]);
    expect(log.map((entry) => entry.text)).toEqual([
      'BEGIN',
      'insert into contest_entry_writes values (1)',
      'select count(*) from contest_entry_writes',
      'COMMIT',
    ]);
  });

  it('ROLLBACKs on a throw, releases the connection, and re-throws', async () => {
    const { pool, log, released } = stubPool();
    const runner = makePooledRunner(pool);

    await expect(
      runner.transaction(async (tx) => {
        await tx.query('insert into contest_entries values (1)');
        throw new Error('ledger unavailable');
      }),
    ).rejects.toThrow('ledger unavailable');

    expect(log.map((entry) => entry.text)).toEqual([
      'BEGIN',
      'insert into contest_entries values (1)',
      'ROLLBACK',
    ]);
    // A leaked connection is a pool that stops answering after `max` failures.
    expect(released()).toBe(1);
  });

  it('releases the connection even when the ROLLBACK itself fails', async () => {
    const log: string[] = [];
    let released = 0;
    const pool: PoolLike = {
      query: () => Promise.resolve({ rows: [] }),
      connect: () =>
        Promise.resolve({
          query(text: string) {
            log.push(text);
            if (text === 'ROLLBACK') return Promise.reject(new Error('connection is dead'));
            return Promise.resolve({ rows: [] });
          },
          release() {
            released += 1;
          },
        }),
    };

    await expect(
      makePooledRunner(pool).transaction(async () => {
        throw new Error('original failure');
      }),
      // The ORIGINAL error survives; a failed rollback must not mask what actually went wrong.
    ).rejects.toThrow('original failure');
    expect(released).toBe(1);
  });

  it('nests onto the same connection rather than opening a savepoint', async () => {
    const { pool, log, opened } = stubPool();
    const runner = makePooledRunner(pool);

    await runner.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.query('select 1');
      });
    });

    expect(opened()).toBe(1);
    expect(log.map((entry) => entry.text)).toEqual(['BEGIN', 'select 1', 'COMMIT']);
  });

  it('sends plain queries through the pool, not through a pinned connection', async () => {
    const { pool, log, opened } = stubPool();
    await makePooledRunner(pool).query('select 1');
    expect(opened()).toBe(0);
    expect(log).toEqual([{ connection: 'pool', text: 'select 1' }]);
  });
});
