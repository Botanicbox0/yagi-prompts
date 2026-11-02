/**
 * What `lib/db/connect.ts` (server-only) shares with the node scripts and the tests. Kept in its own
 * module so they do not have to import the `server-only` guard.
 */
export const DEFAULT_LOCAL_SNAPSHOT = '.pglite/catalog.tar.gz';

/**
 * The DURABLE local database (M5).
 *
 * The snapshot above is loaded into memory, so every write dies with the process — fine for reading
 * a catalog, useless for a queue. The notification worker is a *second process* that has to see
 * what `/admin` just enqueued, so it needs a data directory that survives, and PGlite can open one.
 *
 * Opt-in via `PLAYBOOK_LOCAL_DB_DIR` and dev-only by nature: exactly one process may hold a PGlite
 * data directory at a time. Build it with `npm run db:local -- --dir .pglite/dev`.
 */
export const LOCAL_DB_DIR_ENV = 'PLAYBOOK_LOCAL_DB_DIR';

/**
 * The `pg.Pool` settings. Only the wait differs, and only during `next build`.
 *
 * pg-pool uses `connectionTimeoutMillis` for two waits: opening a connection, and queueing for a free
 * one. Five seconds is right for a visitor and wrong for static generation, where nobody is waiting
 * and one rejected catalog read fails the whole deployment (`lib/db/read-policy.ts`).
 *
 * Measured on Vercel, 2026-11-01. The build machine is in iad1 and the database in Seoul, so a
 * connection takes about 750 ms to open. pg-pool discards a connection whenever a statement fails, and
 * a probe of a table whose migration has not landed always fails. Ten such probes cost twelve
 * connections, and reads queued behind them passed five seconds even in a build that succeeded: those
 * reads were probes that catch the error. When the read at the limit was a catalog read, the build
 * failed with `timeout exceeded when trying to connect`, which is why it looked random.
 *
 * 30 s stays below Next's 60 s `staticPageGenerationTimeout`, so a dead database still names itself.
 */
const BUILD_POOL_WAIT_MS = 30_000;
const RUNTIME_POOL_WAIT_MS = 5_000;

export function pgPoolSettings(env: Record<string, string | undefined>) {
  return {
    max: Math.max(1, Math.min(10, Number(env.PG_POOL_MAX ?? '2') || 2)),
    connectionTimeoutMillis: env.NEXT_PHASE === 'phase-production-build' ? BUILD_POOL_WAIT_MS : RUNTIME_POOL_WAIT_MS,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  };
}
