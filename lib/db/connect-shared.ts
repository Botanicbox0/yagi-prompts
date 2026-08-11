/**
 * The one constant `lib/db/connect.ts` (server-only) and `scripts/db-local.ts` (node script) both
 * need. Kept in its own module so the script does not have to import the `server-only` guard.
 */
export const DEFAULT_LOCAL_SNAPSHOT = '.pglite/catalog.tar.gz';
