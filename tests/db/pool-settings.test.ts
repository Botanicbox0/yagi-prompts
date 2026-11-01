import { EventEmitter } from 'node:events';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pgPoolSettings } from '@/lib/db/connect-shared';

/**
 * 2026-11-01: three Vercel previews failed prerendering `/en` with `timeout exceeded when trying to
 * connect`. That message is pg-pool's QUEUE timeout, not a slow connection (which reports
 * `Connection terminated due to connection timeout`).
 *
 * The real pool, with only the network faked, because the bug lives in how pg-pool treats a failed
 * statement: it discards the connection. Until the subscription migrations land, every readiness
 * probe fails with `relation does not exist`, so each one costs a reconnect, and reconnecting from
 * the build machine (iad1) to the database (Seoul) costs far more than the query.
 */
const CONNECT_MS = 750; // Measured on Vercel builds: 732–779 ms.
const ROUND_TRIP_MS = 180; // Measured on Vercel builds: 178–196 ms per small query.
const FAILED_PROBES = 13; // Measured: 13 `relation does not exist` when no read timed out first.

class RemoteClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  ref() {}
  unref() {}
  connect(done: (err: Error | null) => void) {
    setTimeout(() => done(null), CONNECT_MS);
  }
  query(text: string, _values: unknown, done: (err: Error | null, result?: { rows: unknown[] }) => void) {
    setTimeout(() => {
      if (text === 'probe missing table') done(new Error('relation does not exist'));
      else done(null, { rows: [] });
    }, ROUND_TRIP_MS);
  }
  end(done?: () => void) {
    this._queryable = false;
    this._ending = true;
    done?.();
  }
}

/** What the failed builds did: a page's catalog read queued behind other pages' failing probes. */
async function catalogReadBehindFailingProbes(env: Record<string, string | undefined>) {
  const pool = new pg.Pool({ ...pgPoolSettings(env), Client: RemoteClient as never });
  const probes = Array.from({ length: FAILED_PROBES }, () => pool.query('probe missing table').catch(() => 'probe failed'));
  const catalog = pool.query('select catalog').then(() => 'read', (err: Error) => err.message);
  await vi.advanceTimersByTimeAsync(60_000);
  await Promise.all(probes);
  const outcome = await catalog;
  await pool.end();
  return outcome;
}

describe('pgPoolSettings', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reproduces the build failure with the runtime settings', async () => {
    await expect(catalogReadBehindFailingProbes({})).resolves.toBe('timeout exceeded when trying to connect');
  });

  it('lets the same read finish during next build', async () => {
    await expect(catalogReadBehindFailingProbes({ NEXT_PHASE: 'phase-production-build' })).resolves.toBe('read');
  });

  it('keeps the runtime settings exactly as they were', () => {
    const runtime = { max: 2, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true };
    expect(pgPoolSettings({})).toEqual(runtime);
    expect(pgPoolSettings({ NEXT_PHASE: 'phase-production-server' })).toEqual(runtime);
  });

  it('changes only the wait during next build', () => {
    expect(pgPoolSettings({ NEXT_PHASE: 'phase-production-build' })).toEqual({ ...pgPoolSettings({}), connectionTimeoutMillis: 30_000 });
  });

  it('reports a dead database before Next gives up on the page (staticPageGenerationTimeout, 60 s)', () => {
    expect(pgPoolSettings({ NEXT_PHASE: 'phase-production-build' }).connectionTimeoutMillis).toBeLessThan(60_000);
  });

  it.each([
    ['4', 4], ['1', 1], ['0', 2], ['99', 10], ['-3', 1], ['many', 2],
  ])('reads PG_POOL_MAX=%s as %i', (value, max) => {
    expect(pgPoolSettings({ PG_POOL_MAX: value }).max).toBe(max);
  });
});
