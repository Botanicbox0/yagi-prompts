import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { insertContest } from '@/lib/contests/repo';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { freshDb, runner } from './pglite';

/**
 * A real Postgres with the entitlement profiles in it and nothing else — the §14 harness.
 *
 * Deliberately NOT the full `seed()` or even `seedContests()`: almost every contest test needs a
 * contest with SPECIFIC dates relative to a chosen `now`, and a shared fixture would force each of
 * them to work around whatever dates the fixture happened to have. What is shared with the real
 * thing is everything that matters — the real migrations, the real repo functions and the real
 * local storage driver.
 */

export interface ContestHarness {
  db: PGlite;
  sql: SqlRunner;
  storage: StorageDriver;
  root: string;
  close(): Promise<void>;
}

export async function contestHarness(): Promise<ContestHarness> {
  const db = await freshDb();
  const sql = runner(db);
  const root = await mkdtemp(join(tmpdir(), 'playbook-contests-'));
  const storage = createLocalStorageDriver(root);

  // Entries carry an `author_id` FK; the entitlement fixtures are the entrants.
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

export const DAY = 24 * 60 * 60 * 1000;

/** A fixed instant every dated test can reason from, so "now" is never the machine's clock. */
export const NOW = Date.parse('2026-09-15T12:00:00.000Z');

const L = (text: string) => ({ en: text, ko: `${text} (ko)` });

export interface MakeContestArgs {
  id?: string;
  slug?: string;
  status?: 'draft' | 'published' | 'archived';
  /** Days from `NOW`; negative is the past. */
  startsInDays?: number;
  deadlineInDays?: number;
  media?: unknown;
  brandUrl?: string | null;
}

/**
 * One contest, dated relative to `NOW`.
 *
 * `published` is written straight into the row rather than through the publish operation, because
 * most tests are about what happens AFTER a contest is live and should not be coupled to the
 * publish gate — `tests/contests/moderation.test.ts` exercises that path for real.
 */
export async function makeContest(
  harness: ContestHarness,
  args: MakeContestArgs = {},
): Promise<{ id: string; slug: string }> {
  const id = args.id ?? crypto.randomUUID();
  const slug = args.slug ?? `contest-${id.slice(0, 8)}`;
  const status = args.status ?? 'published';
  const startsAt =
    args.startsInDays === undefined ? null : new Date(NOW + args.startsInDays * DAY).toISOString();
  const deadlineAt =
    args.deadlineInDays === undefined
      ? null
      : new Date(NOW + args.deadlineInDays * DAY).toISOString();

  await insertContest(harness.sql, {
    id,
    slug,
    status,
    title: L('Launch film contest'),
    summary: L('Make a short film with the prompts on this site.'),
    prize: L('$3,000'),
    rules: L('## What we are looking for\n\nA short film.'),
    brandName: 'YAGI WORKSHOP',
    brandUrl: args.brandUrl === undefined ? 'https://yagiworkshop.xyz' : args.brandUrl,
    startsAt,
    deadlineAt,
    media:
      args.media ??
      (status === 'published'
        ? {
            poster: {
              staging_key: `content/contest/${id}/poster.png`,
              sha256: 'a'.repeat(64),
              published_key: `${'a'.repeat(64)}.png`,
              bucket: 'public-content',
              mime: 'image/png',
            },
          }
        : null),
  });

  return { id, slug };
}

export function entrantViewer(key: 'free' | 'pro' | 'admin' = 'free'): Viewer {
  const user = FIXTURE_USERS[key];
  return {
    tier: key === 'admin' ? 'admin' : key,
    userId: user.id,
    email: user.email,
    isAdmin: key === 'admin',
    locale: 'en',
  };
}

export const ANON: Viewer = {
  tier: 'anon',
  userId: null,
  email: null,
  isAdmin: false,
  locale: null,
};
