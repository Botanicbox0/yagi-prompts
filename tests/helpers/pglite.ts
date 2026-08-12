import { PGlite } from '@electric-sql/pglite';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { applyCoreMigrations } from '@/lib/db/migrations';

export { MIGRATIONS_DIR, coreMigrationFiles, glueMigrationFiles } from '@/lib/db/migrations';

/**
 * A fresh in-memory Postgres with the core migrations applied.
 *
 * The `auth.users` stub lives HERE, not in a migration: on Supabase that table is managed by
 * GoTrue, and `profiles.id` references it. PLAN §6 / Director deviation 1.
 */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
  `);
  await applyCoreMigrations(db);
  return db;
}

/** Adapt PGlite to the driver-agnostic runner the seed script consumes. */
export function runner(db: PGlite): SqlRunner {
  // PGlite is single-connection, so BEGIN/COMMIT through `query` really are transactional — which
  // is what lets the §14.1 submit path's atomicity be tested here for real (M9).
  return makeSingleConnectionRunner(async <T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ) => {
    const res = await db.query<T>(text, params as never[]);
    return { rows: res.rows as T[] };
  });
}

/** Create a non-superuser role that stands in for Supabase's `service_role`. */
export async function createAppRole(db: PGlite, name = 'app_service'): Promise<string> {
  await db.exec(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${name}') then
        create role ${name} nologin;
      end if;
    end
    $$;
    grant usage on schema public to ${name};
    grant select, insert, update, delete on all tables in schema public to ${name};
  `);
  return name;
}

/** Run `fn` with the session role switched — the publisher gate is a role check. */
export async function asRole<T>(db: PGlite, role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}

/** Assert that a statement is rejected, returning the error message for pattern checks. */
export async function expectReject(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the statement to be rejected, but it succeeded');
}
