import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlRunner } from '@/lib/db/sql-runner';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

/** Migrations that run anywhere Postgres runs — the ones PGlite acceptance applies. */
export function coreMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f.includes('_core_'))
    .sort();
}

/** Migrations that bind to Supabase-managed schemas/roles (auth, storage, anon/service_role). */
export function glueMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f.includes('_glue_'))
    .sort();
}

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
  for (const file of coreMigrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

/** Adapt PGlite to the driver-agnostic runner the seed script consumes. */
export function runner(db: PGlite): SqlRunner {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const res = await db.query<T>(text, params as never[]);
      return { rows: res.rows as T[] };
    },
  };
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
