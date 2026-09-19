import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyCoreMigrations } from '@/lib/db/migrations';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { DEFAULT_LOCAL_SNAPSHOT, LOCAL_DB_DIR_ENV } from '@/lib/db/connect-shared';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { RUNTIME_MODE_ENV } from '@/lib/runtime-mode';
import { seed, seedContests, seedEdgeFixtures } from './seed';
import { seedBrandWorkspaceFixtures } from './brand-workspace-fixtures';

/**
 * Hermetic by construction (M7). This script builds the OFFLINE database, so it pins the mode
 * rather than inheriting it: without the pin, a `.env.local` carrying cloud credentials would make
 * anything reaching for `getStorage()` write fixture media into live buckets. Safe here because
 * every consumer reads the env at CALL time, not at import time (ESM hoists the imports above this
 * line, so an import-time reader would not see it).
 */
process.env[RUNTIME_MODE_ENV] = 'local';

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
/** `--dir <path>` builds the DURABLE variant instead of the tar.gz dump. */
function dirFlag(): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--dir');
  if (index === -1) return null;
  return argv[index + 1] ?? '.pglite/dev';
}

async function main(): Promise<void> {
  const target = resolve(process.env.PLAYBOOK_LOCAL_DB ?? DEFAULT_LOCAL_SNAPSHOT);
  const dir = dirFlag();

  /**
   * M5: with `--dir`, the very same migrations and the very same publish pipeline land in a PGlite
   * DATA DIRECTORY rather than a dump. That is what makes the notification worker demonstrable
   * offline — `next dev` enqueues a job in one process and `npm run notify:worker` reads it in
   * another, which an in-memory snapshot can never do. Everything else about the build is
   * identical, deliberately: one seed, one set of fixtures, two containers.
   */
  const db = dir === null ? new PGlite() : new PGlite({ dataDir: resolve(dir) });
  // auth.users belongs to GoTrue on Supabase; the local snapshot needs a stub to hang profiles off.
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
  `);
  await applyCoreMigrations(db);

  const sql: SqlRunner = makeSingleConnectionRunner(async <T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ) => {
    const res = await db.query<T>(text, params as never[]);
    return { rows: res.rows };
  });

  const storage = createLocalStorageDriver();
  const options = { sql, storage, createAuthUsers: true, log: (m: string) => console.log(m) };
  const result = await seed(options);
  // M2: the dev snapshot also carries the states the read path must refuse (draft / archived /
  // superseded), so `npm run sweep:anon` can assert them against a real server.
  const edges = await seedEdgeFixtures(options);
  // M9 §14: the DRAFT demo contest and its four entries. Local-only for the same reason as the edge
  // fixtures — and because leaving the public listing empty is what lets the sweep assert the
  // designed empty state against a real server.
  const contests = await seedContests(options);
  await seedBrandWorkspaceFixtures(sql, storage);

  const inventory =
    `${result.playbooks.length} core playbooks, ${edges.length} edge fixtures, ` +
    `${result.prompts.length} prompt items, ${contests.length} contest(s) ` +
    `(${contests.map((c) => c.status).join('/')}), 3 entitlement fixtures`;

  if (dir === null) {
    const dump = await db.dumpDataDir('gzip');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(await dump.arrayBuffer()));
    await db.close();
    console.log(`local snapshot written: ${target} (${inventory})`);
    return;
  }

  await db.close();
  console.log(
    `durable local database written: ${resolve(dir)} (${inventory})\n` +
      `Point the app at it with ${LOCAL_DB_DIR_ENV}=${dir} — one process at a time.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
