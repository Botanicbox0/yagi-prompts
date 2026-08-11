import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the migration files live, and which of them run on a plain Postgres.
 *
 * Node-only (`node:fs`): consumed by the vitest PGlite helper and by `scripts/db-local.ts`.
 * Application code never imports this — it talks to an already-migrated database through
 * `lib/db/connect.ts`.
 */

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

function migrationsMatching(marker: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql') && file.includes(marker))
    .sort();
}

/** Migrations that run anywhere Postgres runs — the ones PGlite acceptance applies. */
export function coreMigrationFiles(): string[] {
  return migrationsMatching('_core_');
}

/** Migrations that bind to Supabase-managed schemas/roles (auth, storage, anon/service_role). */
export function glueMigrationFiles(): string[] {
  return migrationsMatching('_glue_');
}

export function readMigration(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

/** Anything that can run a multi-statement script — PGlite's `exec`, structurally. */
export interface MigrationTarget {
  exec(sql: string): Promise<unknown>;
}

/** Apply every `*_core_*` migration, in filename order, failing loudly on the first bad file. */
export async function applyCoreMigrations(target: MigrationTarget): Promise<void> {
  for (const file of coreMigrationFiles()) {
    try {
      await target.exec(readMigration(file));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
}
