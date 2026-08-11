/**
 * The one constant `lib/db/connect.ts` (server-only) and `scripts/db-local.ts` (node script) both
 * need. Kept in its own module so the script does not have to import the `server-only` guard.
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
