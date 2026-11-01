import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCreatorSubscriptionAvailability, PREPARING_SUBSCRIPTION_AVAILABILITY } from '@/lib/creator-subscriptions/availability';
import { subscriptionTermsApproved, subscriptionTermsDigest } from '@/lib/creator-subscriptions/evidence';
import { SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { SUBSCRIPTION_PLAN_VERSION } from '@/lib/creator-subscriptions/plans';
import { getSubscriptionSummary, subscriptionSchemaReady } from '@/lib/creator-subscriptions/repo';
import { makePooledRunner, type PoolLike, type SqlRunner } from '@/lib/db/sql-runner';

await vi.hoisted(async () => {
  // Next's server bootstrap sets this before anything loads; the real unstable_cache needs it.
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = (await import('node:async_hooks')).AsyncLocalStorage;
});
const connection = vi.hoisted(() => ({ runner: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => connection.runner }));

import { cachedSubscriptionTermsApproved } from '@/lib/creator-subscriptions/cached-availability';
import { getSubscriptionContext, premiumEditingOperational } from '@/lib/creator-subscriptions/runtime';

/**
 * 2026-11-01: production has no subscription tables yet, and its Postgres log held 953
 * `relation does not exist` in 24 hours: 686 `subscriptionSchemaReady`, 249
 * `subscriptionTermsApproved`, 18 `getSubscriptionSummary`. pg-pool discards the connection of a
 * failed statement, so each one forced a reconnect on a pool of 2.
 *
 * The real pool in front of a real parser (PGlite): only the socket is fake, so a statement naming a
 * missing table really fails and the pool really reacts to it.
 */
function poolOver(db: PGlite, settings: { max?: number; connectionTimeoutMillis?: number } = {}) {
  const seen = { connections: 0, failed: [] as string[] };
  class PostgresClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    constructor() {
      super();
      seen.connections += 1;
    }
    ref() {}
    unref() {}
    connect(done: (err: Error | null) => void) {
      done(null);
    }
    query(text: string, values: unknown[], done: (err: Error | null, result?: { rows: unknown[] }) => void) {
      db.query(text, values).then(
        ({ rows }) => done(null, { rows }),
        (err: Error) => {
          seen.failed.push(err.message);
          done(err);
        },
      );
    }
    end(done?: () => void) {
      this._queryable = false;
      this._ending = true;
      done?.();
    }
  }
  const pool = new pg.Pool({ max: 2, connectionTimeoutMillis: 5_000, ...settings, Client: PostgresClient as never });
  return { pool, seen, sql: makePooledRunner(pool as unknown as PoolLike) };
}

const QUEUE_TIMEOUT = 'timeout exceeded when trying to connect';
const USER = '11111111-1111-4111-8111-111111111111';
const LEDGER_TABLES = ['creator_subscriptions', 'creator_subscription_periods', 'creator_subscription_usage', 'creator_subscription_key_cleanup'];
const PROD_ENV: NodeJS.ProcessEnv = { NODE_ENV: 'test', VERCEL_ENV: 'production', CREATOR_SUBSCRIPTION_PUBLIC: 'on' };

/** The evidence table with only what the terms probe reads, carrying a row that approves. */
const APPROVED_EVIDENCE_TABLE = `create table creator_subscription_launch_evidence(
    environment text, step text, passed boolean, plan_version text, terms_version text, evidence_digest text);
  insert into creator_subscription_launch_evidence values
    ('live', 'terms', true, '${SUBSCRIPTION_PLAN_VERSION}', '${SUBSCRIPTION_TERMS_VERSION}', '${subscriptionTermsDigest()}');`;

describe('creator subscription readiness probes', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role outsider;
      create table render_jobs(id uuid primary key);
      create table prompt_items(status text, medium text, audience text, price_cents integer, price_krw integer, runtime_seconds integer, engine text);`);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.exec(`reset role; drop table if exists creator_subscription_launch_evidence;
      ${LEDGER_TABLES.map(table => `drop table if exists ${table};`).join(' ')}`);
  });
  afterAll(async () => {
    await db.close();
  });

  describe('before the migrations land', () => {
    it('control: a statement naming a missing table fails and costs its connection', async () => {
      const { pool, seen, sql } = poolOver(db);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(sql.query('select 1 from creator_subscriptions where false')).rejects.toThrow(/does not exist/);
      }
      expect(seen.failed).toHaveLength(2);
      expect(seen.connections).toBe(2);
      await pool.end();
    });

    it('subscriptionSchemaReady answers false, runs no failing statement and keeps its connection', async () => {
      const { pool, seen, sql } = poolOver(db);
      expect(await subscriptionSchemaReady(sql)).toBe(false);
      expect(await subscriptionSchemaReady(sql)).toBe(false);
      expect(seen).toEqual({ connections: 1, failed: [] });
      await pool.end();
    });

    it('subscriptionTermsApproved answers false, runs no failing statement and keeps its connection', async () => {
      const { pool, seen, sql } = poolOver(db);
      expect(await subscriptionTermsApproved(sql)).toBe(false);
      expect(await subscriptionTermsApproved(sql)).toBe(false);
      expect(seen).toEqual({ connections: 1, failed: [] });
      await pool.end();
    });

    it('keeps a burst of probes, as static generation makes, on the connections it already has', async () => {
      const { pool, seen, sql } = poolOver(db);
      await Promise.all(Array.from({ length: 13 }, (_, index) => (index % 2 ? subscriptionSchemaReady(sql) : subscriptionTermsApproved(sql))));
      expect(seen.failed).toEqual([]);
      expect(seen.connections).toBeLessThanOrEqual(2);
      await pool.end();
    });

    it.each([
      ['on', { ...PREPARING_SUBSCRIPTION_AVAILABILITY, premiumEditRequestsPerPeriod: null }],
      [undefined, { ...PREPARING_SUBSCRIPTION_AVAILABILITY, premiumEditRequestsPerPeriod: null }],
      ['paused', { ...PREPARING_SUBSCRIPTION_AVAILABILITY, status: 'paused', plans: { creator: { status: 'paused' }, premium: { status: 'paused' } }, premiumEditRequestsPerPeriod: null }],
    ])('availability with CREATOR_SUBSCRIPTION_PUBLIC=%s keeps its answer, with no failing statement', async (requested, expected) => {
      const { pool, seen, sql } = poolOver(db);
      expect(await getCreatorSubscriptionAvailability(sql, { ...PROD_ENV, CREATOR_SUBSCRIPTION_PUBLIC: requested })).toEqual(expected);
      expect(seen.failed).toEqual([]);
      expect(seen.connections).toBe(1);
      await pool.end();
    });

    it('premiumEditingOperational stops at its schema check', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'fixture');
      vi.stubEnv('PREMIUM_EDITING_ENABLED', 'on');
      const { pool, seen, sql } = poolOver(db);
      expect(await premiumEditingOperational(sql, 'live')).toBe(false);
      expect(seen.failed).toEqual([]);
      await pool.end();
    });

    it('getSubscriptionSummary still rejects, so /account says unavailable rather than "no subscription"', async () => {
      const { pool, seen, sql } = poolOver(db);
      await expect(getSubscriptionSummary(sql, USER)).rejects.toThrow();
      expect(seen).toEqual({ connections: 1, failed: [] });
      expect(await getSubscriptionSummary(sql, 'not-a-uuid')).toBeNull();
      await pool.end();
    });
  });

  describe('between migrations', () => {
    it('answers false with no failing statement when one ledger table is still missing', async () => {
      await db.exec(LEDGER_TABLES.slice(0, 3).map(table => `create table ${table}(id uuid);`).join(' '));
      const { pool, seen, sql } = poolOver(db);
      expect(await subscriptionSchemaReady(sql)).toBe(false);
      expect(seen.failed).toEqual([]);
      await pool.end();
    });

    it('answers false when the tables exist without the columns a probe reads', async () => {
      await db.exec(`${LEDGER_TABLES.map(table => `create table ${table}(id uuid);`).join(' ')}
        create table creator_subscription_launch_evidence(id uuid);`);
      const { pool, sql } = poolOver(db);
      expect(await subscriptionSchemaReady(sql)).toBe(false);
      expect(await subscriptionTermsApproved(sql)).toBe(false);
      await pool.end();
    });

    it('answers false when the role may not read the table', async () => {
      await db.exec(`${APPROVED_EVIDENCE_TABLE} set role outsider;`);
      const { pool, seen, sql } = poolOver(db);
      expect(await subscriptionTermsApproved(sql)).toBe(false);
      expect(seen.failed.join()).toMatch(/permission denied/);
      await pool.end();
    });
  });

  describe('after the migrations land', () => {
    it('reads the recorded terms evidence', async () => {
      await db.exec(APPROVED_EVIDENCE_TABLE);
      const { pool, sql } = poolOver(db);
      expect(await subscriptionTermsApproved(sql)).toBe(true);
      await db.exec(`update creator_subscription_launch_evidence set evidence_digest = repeat('c', 64)`);
      expect(await subscriptionTermsApproved(sql)).toBe(false);
      await pool.end();
    });

    it('answers false with no database at all', async () => {
      expect(await subscriptionTermsApproved(null)).toBe(false);
    });
  });

  describe('a pool or connection failure is not an answer', () => {
    async function withExhaustedPool(check: (sql: SqlRunner) => Promise<void>) {
      const { pool, sql } = poolOver(db, { max: 1, connectionTimeoutMillis: 20 });
      const held = await pool.connect();
      try {
        await check(sql);
      } finally {
        held.release();
        await pool.end();
      }
    }

    /** The table check succeeded and the next statement met the failure. */
    const tablesPresentThen = (failure: unknown): SqlRunner => ({
      query: async <T>(text: string) => {
        if (text.includes('to_regclass')) return { rows: [{ present: true }] as T[] };
        throw failure;
      },
      transaction: () => Promise.reject(new Error('unused')),
    });

    it('subscriptionTermsApproved rejects on a queue timeout', async () => {
      await withExhaustedPool(sql => expect(subscriptionTermsApproved(sql)).rejects.toThrow(QUEUE_TIMEOUT));
    });

    it('subscriptionSchemaReady rejects on a queue timeout', async () => {
      await withExhaustedPool(sql => expect(subscriptionSchemaReady(sql)).rejects.toThrow(QUEUE_TIMEOUT));
    });

    it('getSubscriptionSummary rejects on a queue timeout', async () => {
      await withExhaustedPool(sql => expect(getSubscriptionSummary(sql, USER)).rejects.toThrow(QUEUE_TIMEOUT));
    });

    const FAILURES: [string, unknown][] = [
      ['queue timeout', new Error(QUEUE_TIMEOUT)],
      ['dropped connection', new Error('Connection terminated unexpectedly')],
      ['socket reset', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
      ['server shutting down', Object.assign(new Error('terminating connection'), { code: '57P01' })],
      ['too many connections', Object.assign(new Error('too many clients already'), { code: '53300' })],
      ['statement timeout', Object.assign(new Error('canceling statement'), { code: '57014' })],
    ];

    it.each(FAILURES)('subscriptionTermsApproved rejects after the table check: %s', async (_name, failure) => {
      await expect(subscriptionTermsApproved(tablesPresentThen(failure))).rejects.toBe(failure);
    });

    it.each(FAILURES)('subscriptionSchemaReady rejects after the table check: %s', async (_name, failure) => {
      await expect(subscriptionSchemaReady(tablesPresentThen(failure))).rejects.toBe(failure);
    });

    it.each(FAILURES)('fresh availability stays preparing, as it always has: %s', async (_name, failure) => {
      await expect(getCreatorSubscriptionAvailability(tablesPresentThen(failure), PROD_ENV)).resolves.toBe(PREPARING_SUBSCRIPTION_AVAILABILITY);
    });

    it.each(FAILURES)('getSubscriptionContext stays null, as it always has: %s', async (_name, failure) => {
      vi.stubEnv('TOSS_BILLING_CLIENT_KEY', 'test_ck_fixture');
      vi.stubEnv('TOSS_BILLING_SECRET_KEY', 'test_sk_fixture');
      vi.stubEnv('TOSS_BILLING_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
      connection.runner = tablesPresentThen(failure);
      await expect(getSubscriptionContext()).resolves.toBeNull();
    });
  });

  describe('cachedSubscriptionTermsApproved, through the real unstable_cache', () => {
    let stored: Map<string, unknown>;
    const globals = globalThis as { __incrementalCache?: unknown };

    beforeEach(() => {
      stored = new Map();
      globals.__incrementalCache = {
        isOnDemandRevalidate: false,
        generateSimpleCacheKey: async (key: string) => key,
        get: async (key: string) => (stored.has(key) ? { isStale: false, value: stored.get(key) } : null),
        set: async (key: string, value: unknown) => void stored.set(key, value),
      };
    });
    afterEach(() => {
      delete globals.__incrementalCache;
      connection.runner = null;
    });

    it('stores nothing on a pool timeout, so the next read asks the database again', async () => {
      connection.runner = { query: () => Promise.reject(new Error(QUEUE_TIMEOUT)), transaction: () => Promise.reject(new Error('unused')) };
      await expect(cachedSubscriptionTermsApproved()).rejects.toThrow(QUEUE_TIMEOUT);
      expect(stored.size).toBe(0);

      await db.exec(APPROVED_EVIDENCE_TABLE);
      const { pool, sql } = poolOver(db);
      connection.runner = sql;
      expect(await cachedSubscriptionTermsApproved()).toBe(true);
      expect(stored.size).toBe(1);
      await pool.end();
    });

    it('does store the real answer that the table is missing', async () => {
      const { pool, seen, sql } = poolOver(db);
      connection.runner = sql;
      expect(await cachedSubscriptionTermsApproved()).toBe(false);
      expect(stored.size).toBe(1);
      connection.runner = null;
      expect(await cachedSubscriptionTermsApproved()).toBe(false);
      expect(seen.failed).toEqual([]);
      await pool.end();
    });
  });
});
