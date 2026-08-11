import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyCoreMigrations } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { seed } from './seed';

/**
 * `npm run db:local` — build the local development database snapshot.
 *
 * PLAN §11 open item: the Supabase cloud project does not exist yet, so `next dev` / `next build`
 * have no `DATABASE_URL` to read the catalog from. Rather than invent a parallel fixture path,
 * this builds a REAL Postgres (PGlite), applies the REAL migrations, and runs the REAL
 * prepare → copy → publish seed — the same code the vitest acceptance run uses — then dumps the
 * data directory to `.pglite/catalog.tar.gz` (gitignored).
 *
 * `lib/db/connect.ts` loads that dump into an in-memory PGlite when `DATABASE_URL` is absent.
 * A dump rather than a live `dataDir` on purpose: it needs no file lock, so Next's parallel
 * static-generation workers can each open their own read-only copy.
 *
 * The moment a real `DATABASE_URL` exists this script becomes irrelevant — `connect.ts` prefers it.
 */
async function main(): Promise<void> {
  const target = resolve(process.env.PLAYBOOK_LOCAL_DB ?? DEFAULT_LOCAL_SNAPSHOT);

  const db = new PGlite();
  // auth.users belongs to GoTrue on Supabase; the local snapshot needs a stub to hang profiles off.
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
  `);
  await applyCoreMigrations(db);

  const sql: SqlRunner = {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const res = await db.query<T>(text, params as never[]);
      return { rows: res.rows };
    },
  };

  const storage = createLocalStorageDriver();
  const result = await seed({
    sql,
    storage,
    createAuthUsers: true,
    log: (message) => console.log(message),
  });

  const dump = await db.dumpDataDir('gzip');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, new Uint8Array(await dump.arrayBuffer()));
  await db.close();

  console.log(
    `local snapshot written: ${target} (${result.playbooks.length} playbooks, 3 entitlement fixtures)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
