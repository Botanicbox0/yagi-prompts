import { resolve } from 'node:path';
import {
  makePooledRunner,
  makeSingleConnectionRunner,
  type PoolLike,
  type SqlRunner,
} from '@/lib/db/sql-runner';
import { LOCAL_DB_DIR_ENV } from '@/lib/db/connect-shared';
import { getMailer } from '@/lib/notify/service';
import { isNotifyConfigured } from '@/lib/notify/mailer';
import { formatReport, runNotifyPass, type NotifyWorkerReport } from '@/lib/notify/worker';
import { siteUrl } from '@/lib/seo/site-url';

/**
 * `npm run notify:worker` — one pass of the §3.5 outbox worker.
 *
 * A single pass, on purpose. §3.5 asks for "a scheduled Edge Function (cron, every minute)", and a
 * cron-invoked process that exits is far easier to reason about than a daemon: no lease held across
 * a deploy, no memory growth, and "did it run?" is a question the scheduler answers. The pass ITSELF
 * is `runNotifyPass` in `lib/notify/worker.ts` — importable, so the Edge Function will call the same
 * function rather than a second copy of it (exactly like `retryUnprocessedEvents` in M3).
 *
 * It WRITES, so — like `npm run stripe:retry` — it refuses the in-memory dev snapshot, whose writes
 * die with the process. Two databases it will accept:
 *
 *   DATABASE_URL=…                          the real one
 *   PLAYBOOK_LOCAL_DB_DIR=.pglite/dev       the durable local PGlite directory (M5), built with
 *                                           `npm run db:local -- --dir .pglite/dev`
 *
 * Usage:
 *   npm run notify:worker
 *   npm run notify:worker -- --dry            # report what it WOULD do; claim nothing
 *   npm run notify:worker -- --batch 10
 */

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

/**
 * Both drivers hold open handles, so the script owns a `close()`: a cron-invoked process that never
 * exits is a cron-invoked process that piles up. (A PGlite data directory also stays LOCKED until
 * it is closed, which would block the next `next dev` on the same folder.)
 */
interface Connection {
  sql: SqlRunner;
  close(): Promise<void>;
}

async function connectPostgres(connectionString: string): Promise<Connection> {
  const pg = await import('pg');
  const Pool = (pg as unknown as { default?: { Pool: typeof pg.Pool } }).default?.Pool ?? pg.Pool;
  const pool = new Pool({ connectionString, max: 2 });
  return {
    sql: makePooledRunner(pool as unknown as PoolLike),
    close: () => pool.end(),
  };
}

async function connectDirectory(dir: string): Promise<Connection> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite({ dataDir: resolve(dir) });
  await db.waitReady;
  return {
    sql: makeSingleConnectionRunner(async <T = Record<string, unknown>>(
      text: string,
      params: unknown[] = [],
    ) => {
      const result = await db.query<T>(text, params as never[]);
      return { rows: result.rows as T[] };
    }),
    close: () => db.close(),
  };
}

/** What is still waiting, printed before and after so a run is legible without reading the DB. */
async function outstanding(sql: SqlRunner): Promise<string> {
  const { rows } = await sql.query<{ status: string; n: number }>(
    `select status, count(*)::int as n from notification_deliveries group by status order by status`,
  );
  if (rows.length === 0) return 'no deliveries';
  return rows.map((row) => `${row.status} ${row.n}`).join(' · ');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const localDir = process.env[LOCAL_DB_DIR_ENV];

  if (!databaseUrl && !localDir) {
    console.error(
      'The notification worker WRITES, so it needs a durable database.\n\n' +
        '  DATABASE_URL=…                      the real one, or\n' +
        `  ${LOCAL_DB_DIR_ENV}=.pglite/dev     a durable local PGlite directory:\n` +
        '      npm run db:local -- --dir .pglite/dev\n\n' +
        'It deliberately will NOT run against .pglite/catalog.tar.gz — that snapshot is loaded\n' +
        'into memory and every row it wrote would vanish when this process exits.',
    );
    process.exitCode = 1;
    return;
  }

  const connection = databaseUrl
    ? await connectPostgres(databaseUrl)
    : await connectDirectory(localDir!);
  const { sql } = connection;

  try {
    await pass(sql, databaseUrl, localDir);
  } finally {
    await connection.close();
  }
}

async function pass(
  sql: SqlRunner,
  databaseUrl: string | undefined,
  localDir: string | undefined,
): Promise<void> {
  const mailer = getMailer();
  console.log(
    [
      `database : ${databaseUrl ? 'DATABASE_URL' : `${LOCAL_DB_DIR_ENV}=${localDir}`}`,
      `mailer   : ${mailer === null ? 'NOT CONFIGURED' : `${mailer.kind} (${mailer.from})`}`,
      `site url : ${siteUrl()}`,
      `before   : ${await outstanding(sql)}`,
      '',
    ].join('\n'),
  );

  if (mailer === null) {
    console.error(
      'No mailer. Set RESEND_API_KEY + NOTIFY_FROM_EMAIL, or PLAYBOOK_FAKE_MAILER=1 for an\n' +
        'offline dry run. Nothing was claimed and nothing was changed.',
    );
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--dry')) {
    // "Dry" is a COUNT, never a claim: claiming would spend an attempt on a message we then throw
    // away, and the whole point of the outbox is that an attempt is a real, budgeted thing.
    const { rows } = await sql.query<{ n: number }>(
      `select count(*)::int as n from notification_deliveries where status = 'pending'`,
    );
    console.log(`pending deliveries: ${rows[0]?.n ?? 0} (dry run — nothing claimed)`);
    return;
  }

  const batchArg = flag('batch');
  const batchSize = batchArg === null || batchArg === '' ? undefined : Number(batchArg);
  if (batchSize !== undefined && (!Number.isFinite(batchSize) || batchSize <= 0)) {
    console.error(`--batch must be a positive number, got "${batchArg}"`);
    process.exitCode = 1;
    return;
  }

  const report: NotifyWorkerReport = await runNotifyPass({
    sql,
    mailer,
    siteUrl: siteUrl(),
    ...(batchSize === undefined ? {} : { batchSize }),
  });

  console.log(formatReport(report));
  for (const message of report.delivered) {
    console.log(`  sent  ${message.to}  [${message.idempotencyKey}]  ${message.subject}`);
  }
  console.log(`after    : ${await outstanding(sql)}`);

  // A deferred delivery is the next run's work, not a failure; a permanently failed one is worth
  // a non-zero exit so a scheduler surfaces it.
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

// Re-exported so a future Supabase Edge Function can `import { runNotifyPass }` from the library
// rather than reaching for this CLI. Nothing else should import from a script.
export { runNotifyPass, isNotifyConfigured };
