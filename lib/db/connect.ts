import 'server-only';
import type { SqlRunner } from './sql-runner';
import { DEFAULT_LOCAL_SNAPSHOT, LOCAL_DB_DIR_ENV } from './connect-shared';

/**
 * The server-side `SqlRunner` factory (PLAN §7).
 *
 * M0 built every read model against the driver-agnostic `SqlRunner` so the same query text runs in
 * vitest (PGlite) and in production (`pg` against Supabase Postgres). This is where the app picks
 * one, in strict order:
 *
 *   1. `DATABASE_URL`          → `pg` pool. The production path.
 *   2. `PLAYBOOK_LOCAL_DB_DIR` → a DURABLE PGlite data directory (M5). Opt-in, dev only, single
 *                                process. It exists because the notification worker runs in its
 *                                own process and must see what `/admin` enqueued in another —
 *                                which an in-memory snapshot can never provide.
 *   3. local snapshot          → in-memory PGlite loaded from `.pglite/catalog.tar.gz`
 *                                (`npm run db:local`). The dev/preview path while §11's Supabase
 *                                project stop-gate is open. Writes die with the process.
 *   4. none of the above       → `null`.
 *
 * `null` is a first-class answer, not a failure: the public catalog degrades to its empty state so
 * `npm run build` stays green on a machine with no database at all (CI does exactly that). What it
 * must never do is throw during static generation — a marketing page that cannot build is worse
 * than one with no featured cards.
 */

/**
 * The memo lives on `globalThis`, not in a module variable.
 *
 * `next dev` compiles each route into its own module registry, so a module-level singleton is
 * re-created per route — which is invisible while every read model is read-only (M0–M2) and
 * actively wrong the moment anything WRITES (M3): a subscription reconciled by `/billing/success`
 * would land in that route's private copy of the PGlite snapshot and be invisible to the page it
 * was supposed to unlock. In production this changes nothing (the module graph is already shared);
 * it also stops `next dev` opening one `pg` Pool per route.
 */
interface RunnerCache {
  promise: Promise<SqlRunner | null> | null;
}

const cache: RunnerCache = (((globalThis as Record<string, unknown>).__playbookSqlRunner ??= {
  promise: null,
}) as RunnerCache);

function localSnapshotPath(): string {
  return process.env.PLAYBOOK_LOCAL_DB ?? DEFAULT_LOCAL_SNAPSHOT;
}

async function connectPostgres(connectionString: string): Promise<SqlRunner | null> {
  try {
    const pg = await import('pg');
    const Pool = (pg as unknown as { default?: { Pool: typeof pg.Pool } }).default?.Pool ?? pg.Pool;
    const pool = new Pool({ connectionString, max: 4 });
    return {
      async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
        const result = await pool.query(text, params);
        return { rows: result.rows as T[] };
      },
    };
  } catch (err) {
    console.warn(`[db] DATABASE_URL is set but the pg driver could not connect: ${String(err)}`);
    return null;
  }
}

/**
 * A real PGlite data directory: writes land on disk and are still there for the next process.
 *
 * `null` when the directory is absent or already held by another process, which is the honest
 * answer — the caller then falls through to the read-only snapshot rather than half-working.
 */
async function connectLocalDirectory(dir: string): Promise<SqlRunner | null> {
  try {
    const { resolve } = await import('node:path');
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite({ dataDir: resolve(dir) });
    await db.waitReady;
    return {
      async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
        const result = await db.query<T>(text, params as never[]);
        return { rows: result.rows as T[] };
      },
    };
  } catch (err) {
    console.warn(`[db] ${LOCAL_DB_DIR_ENV}=${dir} could not be opened: ${String(err)}`);
    return null;
  }
}

async function connectLocalSnapshot(): Promise<SqlRunner | null> {
  const path = localSnapshotPath();
  try {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const bytes = await readFile(resolve(path));

    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite({ loadDataDir: new Blob([new Uint8Array(bytes)]) });
    await db.waitReady;

    return {
      async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
        const result = await db.query<T>(text, params as never[]);
        return { rows: result.rows as T[] };
      },
    };
  } catch {
    // No snapshot on this machine — expected in CI and on a fresh clone.
    return null;
  }
}

async function connect(): Promise<SqlRunner | null> {
  const url = process.env.DATABASE_URL;
  if (url) return connectPostgres(url);

  const dir = process.env[LOCAL_DB_DIR_ENV];
  if (dir) {
    const durable = await connectLocalDirectory(dir);
    if (durable !== null) return durable;
  }

  return connectLocalSnapshot();
}

/** Memoised per server process; both drivers are expensive to open and safe to share. */
export function getSqlRunner(): Promise<SqlRunner | null> {
  cache.promise ??= connect();
  return cache.promise;
}

/** Test/dev seam — drops the memoised connection so the next call re-resolves the driver. */
export function resetSqlRunner(): void {
  cache.promise = null;
}
