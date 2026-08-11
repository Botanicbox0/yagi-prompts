import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from './pglite';

/**
 * A minimal billing fixture: a real Postgres with the real migrations, and profiles to reconcile
 * against. Deliberately NOT the content seed — M3's subject is `subscriptions` / `stripe_events`,
 * and dragging the whole publish pipeline in would make every fencing test a 20-second one.
 */

export interface BillingHarness {
  db: PGlite;
  sql: SqlRunner;
  close(): Promise<void>;
}

export async function billingDb(): Promise<BillingHarness> {
  const db = await freshDb();
  const sql = runner(db);
  return {
    db,
    sql,
    close: () => db.close(),
  };
}

export interface SeedProfileArgs {
  id: string;
  email?: string;
  customerId?: string | null;
  isAdmin?: boolean;
  locale?: 'en' | 'ko';
  plan?: 'free' | 'pro';
}

export async function seedProfile(sql: SqlRunner, args: SeedProfileArgs): Promise<string> {
  await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [args.id]);
  await sql.query(
    `insert into profiles (id, email, locale, plan, is_admin, stripe_customer_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update
       set email = excluded.email,
           locale = excluded.locale,
           plan = excluded.plan,
           is_admin = excluded.is_admin,
           stripe_customer_id = excluded.stripe_customer_id`,
    [
      args.id,
      args.email ?? `${args.id}@playbook.test`,
      args.locale ?? 'en',
      args.plan ?? 'free',
      args.isAdmin ?? false,
      args.customerId ?? null,
    ],
  );
  return args.id;
}

export interface StoredSubscription {
  status: string;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string;
  stripe_fetched_at: string;
  plan: string;
}

/** The two rows every reconcile assertion looks at, read together so they cannot be seen apart. */
export async function readState(
  sql: SqlRunner,
  userId: string,
): Promise<StoredSubscription | null> {
  const { rows } = await sql.query<StoredSubscription>(
    // `at time zone 'utc'` on purpose: `::text` on a timestamptz renders in the session's zone, so
    // a fence assertion would read differently on a machine that is not on UTC.
    `select s.status, s.cancel_at_period_end, s.stripe_subscription_id,
            (s.stripe_fetched_at at time zone 'utc')::text as stripe_fetched_at, p.plan
       from profiles p left join subscriptions s on s.user_id = p.id
      where p.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || row.stripe_subscription_id === null) {
    return row ? ({ ...row } as StoredSubscription) : null;
  }
  return row;
}

/** ISO timestamps a fence test can order by eye. */
export const T = {
  early: '2026-08-12T10:00:00.000Z',
  middle: '2026-08-12T10:00:05.000Z',
  late: '2026-08-12T10:00:10.000Z',
} as const;

export const USER = {
  buyer: 'a0000000-0000-4000-8000-00000000b001',
  other: 'a0000000-0000-4000-8000-00000000b002',
} as const;

export const CUSTOMER = {
  buyer: 'cus_test_buyer',
  other: 'cus_test_other',
} as const;
