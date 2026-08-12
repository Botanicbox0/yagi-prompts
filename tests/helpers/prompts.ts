import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { seedPrompts } from '../../scripts/seed';
import { freshDb, runner } from './pglite';

/**
 * A real Postgres with the §13 prompt fixtures in it, and nothing else.
 *
 * Deliberately NOT the full `seed()`: the playbook fixtures publish through three RPCs and a
 * storage copier, which is a couple of seconds per suite for data none of these tests read. What is
 * shared with the real thing is everything that matters — the real migrations, the real
 * `seedPrompts`, the real staging → public copy, and the real local storage driver.
 */

export interface PromptHarness {
  db: PGlite;
  sql: SqlRunner;
  storage: StorageDriver;
  root: string;
  close(): Promise<void>;
}

export async function promptHarness(): Promise<PromptHarness> {
  const db = await freshDb();
  const sql = runner(db);
  const root = await mkdtemp(join(tmpdir(), 'playbook-prompts-'));
  const storage = createLocalStorageDriver(root);

  // Community submissions carry an `author_id` FK; the entitlement fixtures are the submitters.
  for (const user of Object.values(FIXTURE_USERS)) {
    await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [user.id]);
    await sql.query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
      [user.id, user.email, user.displayName, user.locale, user.plan, user.isAdmin],
    );
  }

  await seedPrompts({ sql, storage });

  return {
    db,
    sql,
    storage,
    root,
    async close() {
      await db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** A bare harness with the migrations applied and no prompts at all. */
export async function emptyPromptHarness(): Promise<PromptHarness> {
  const db = await freshDb();
  const sql = runner(db);
  const root = await mkdtemp(join(tmpdir(), 'playbook-prompts-'));
  const storage = createLocalStorageDriver(root);

  for (const user of Object.values(FIXTURE_USERS)) {
    await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [user.id]);
    await sql.query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
      [user.id, user.email, user.displayName, user.locale, user.plan, user.isAdmin],
    );
  }

  return {
    db,
    sql,
    storage,
    root,
    async close() {
      await db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
