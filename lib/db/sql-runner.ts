/**
 * Driver-agnostic query surface.
 *
 * The seed script (scripts/seed.ts) runs identically against PGlite inside vitest and against a
 * real Postgres URL via `pg`. Both drivers already speak `query(text, params) -> { rows }` with
 * `$1` placeholders, so that is the whole abstraction for reads.
 *
 * WRITES that must be atomic need one more thing, and M9 is the milestone that found out why: the
 * cloud driver is a `pg.Pool`, so two consecutive `query()` calls may run on two different
 * connections. `BEGIN` on one and `INSERT` on another is not a transaction — it is a `BEGIN` that
 * is rolled back when its connection is returned to the pool, and an insert that autocommits. Any
 * multi-statement invariant (§14.1's entry quota, its deadline check and its profile write-back)
 * therefore has to be expressed through `transaction()`, which pins one connection for the whole
 * callback.
 */
export interface SqlRunner {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /**
   * Run `fn` inside ONE transaction on ONE connection: `BEGIN` → `fn(tx)` → `COMMIT`, with
   * `ROLLBACK` on any thrown error (the error is re-thrown).
   *
   * The `tx` handed to the callback is a `SqlRunner` bound to that connection — use it, not the
   * outer runner, or the statement escapes the transaction. Nesting reuses the same connection
   * rather than opening a savepoint: nothing in this codebase needs partial rollback, and a
   * savepoint that looked like a transaction would be the more dangerous thing to have.
   */
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>;
}

/**
 * The single-connection implementation, shared by every PGlite driver.
 *
 * PGlite serialises everything onto one connection by construction, so `BEGIN`/`COMMIT` issued
 * through `query()` are genuinely transactional — which is what makes it a faithful test target for
 * SQL that has to be atomic in production.
 */
/**
 * The shape of a `pg.Pool`, named structurally so this module stays driver-agnostic.
 *
 * Only the two methods that matter are declared: `query` (any connection) and `connect` (a pinned
 * one). Anything that offers both — the real pool, a stub in a test — can be wrapped.
 */
export interface PoolLike {
  query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<{
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
}

/**
 * A pooled runner whose `transaction()` pins ONE connection for the whole callback.
 *
 * This is the implementation the M9 review demanded and the reason the method exists at all:
 * `pool.query('BEGIN')` followed by `pool.query('INSERT …')` may take two different connections, so
 * the BEGIN is discarded on release and the insert autocommits. Three callers share this one
 * implementation (the app's connect factory, the notification worker, the Stripe retry sweep) so
 * there is exactly one place that can get it wrong.
 */
export function makePooledRunner(pool: PoolLike): SqlRunner {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = await pool.query(text, params);
      return { rows: result.rows as T[] };
    },
    async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: SqlRunner = {
        async query<R = Record<string, unknown>>(text: string, params: unknown[] = []) {
          const result = await client.query(text, params);
          return { rows: result.rows as R[] };
        },
        // Already inside one; nesting reuses it rather than opening a savepoint.
        transaction: (inner) => inner(tx),
      };
      try {
        await client.query('BEGIN');
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // A failed rollback must not mask the original error.
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export function makeSingleConnectionRunner(query: SqlRunner['query']): SqlRunner {
  const runner: SqlRunner = {
    query,
    transaction: (fn) => singleConnectionTransaction(runner)(fn),
  };
  return runner;
}

export function singleConnectionTransaction(
  runner: Pick<SqlRunner, 'query'>,
): <T>(fn: (tx: SqlRunner) => Promise<T>) => Promise<T> {
  const self = runner as SqlRunner;
  return async <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
    await self.query('begin');
    try {
      const result = await fn(self);
      await self.query('commit');
      return result;
    } catch (err) {
      try {
        await self.query('rollback');
      } catch {
        // A rollback that itself fails must not mask the original error.
      }
      throw err;
    }
  };
}
