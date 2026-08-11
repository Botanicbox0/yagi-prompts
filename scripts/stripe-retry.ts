import { countUnprocessedEvents, retryUnprocessedEvents } from '@/lib/billing/ledger';
import { createLiveStripeGateway } from '@/lib/billing/stripe-live';
import { stripeConfigFromEnv } from '@/lib/billing/stripe-gateway';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * `npm run stripe:retry` — reprocess the `stripe_events` rows that still carry
 * `processed_at IS NULL` (PLAN §3.4: "a retry sweep reprocesses them").
 *
 * The sweep ITSELF is `retryUnprocessedEvents` in `lib/billing/ledger.ts`, deliberately importable
 * rather than inlined here, so the same function can be wired to a cron/Edge invocation later
 * (§3.5 already runs a scheduled worker for notifications; this joins it in M5) without a second
 * implementation to keep in step.
 *
 * A row goes NULL for exactly two reasons, and the sweep fixes both:
 *   · the handler threw (Stripe unreachable, a transient DB error);
 *   · the event's customer did not map to a profile yet — typically a subscription event that
 *     overtook `checkout.session.completed`.
 *
 * Reprocessing is safe by construction: every handler re-fetches current truth from Stripe and
 * applies the fetch-time fenced upsert, so running this twice, or during live traffic, converges.
 *
 * Usage:
 *   npm run stripe:retry            # process up to 100, oldest first
 *   npm run stripe:retry -- --dry   # count only, touch nothing
 *   npm run stripe:retry -- --limit 500
 */

async function connect(connectionString: string): Promise<SqlRunner> {
  const pg = await import('pg');
  const Pool = (pg as unknown as { default?: { Pool: typeof pg.Pool } }).default?.Pool ?? pg.Pool;
  const pool = new Pool({ connectionString, max: 2 });
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = await pool.query(text, params);
      return { rows: result.rows as T[] };
    },
  };
}

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is required. The retry sweep WRITES, so it will not run against the\n' +
        'in-memory dev snapshot (`.pglite/catalog.tar.gz`), whose writes die with the process.',
    );
    process.exitCode = 1;
    return;
  }

  const sql = await connect(databaseUrl);
  const pending = await countUnprocessedEvents(sql);
  console.log(`stripe_events pending: ${pending}`);

  if (process.argv.includes('--dry')) return;
  if (pending === 0) return;

  const config = stripeConfigFromEnv();
  if (config === null) {
    console.error('STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_PRO are required.');
    process.exitCode = 1;
    return;
  }

  const limitArg = flag('limit');
  const limit = limitArg === null || limitArg === '' ? 100 : Number(limitArg);
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`--limit must be a positive number, got "${limitArg}"`);
    process.exitCode = 1;
    return;
  }

  const report = await retryUnprocessedEvents(
    { sql, gateway: createLiveStripeGateway(config) },
    { limit },
  );

  console.log(
    `attempted ${report.attempted} · processed ${report.processed} · ` +
      `unresolved ${report.unresolved} · failed ${report.failed}`,
  );
  // A row left unresolved or failed is not an error for the sweep — it is the next run's work.
  console.log(`still pending: ${await countUnprocessedEvents(sql)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
