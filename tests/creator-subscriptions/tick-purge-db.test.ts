import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SUBSCRIPTION_RELEASE_VERSION, SUBSCRIPTION_REQUIRED_STEPS } from '@/lib/creator-subscriptions/availability';
import { SUBSCRIPTION_PLAN_VERSION } from '@/lib/creator-subscriptions/plans';
import { SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { launchConfigurationDigest, premiumConfigurationDigest, subscriptionTermsDigest } from '@/lib/creator-subscriptions/evidence';

await vi.hoisted(async () => {
  // Next's server bootstrap sets this before anything loads; the real unstable_cache needs it.
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = (await import('node:async_hooks')).AsyncLocalStorage;
});
const mock = vi.hoisted(() => ({ runner: null as unknown, tag: vi.fn(), path: vi.fn(), renewals: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mock.runner }));
vi.mock('next/cache', async original => ({ ...await original<typeof import('next/cache')>(), revalidateTag: mock.tag, revalidatePath: mock.path }));
vi.mock('@/lib/creator-subscriptions/service', async original => ({
  ...await original<typeof import('@/lib/creator-subscriptions/service')>(), processSubscriptionRenewals: mock.renewals,
}));

import { POST } from '@/app/api/creator-subscriptions/tick/route';
import { cachedSubscriptionAvailability, cachedSubscriptionTermsApproved } from '@/lib/creator-subscriptions/cached-availability';

/**
 * 2026-11-02: every recorded heartbeat purged every subscription page, so after launch each page lost
 * its last good copy at least hourly, and an outage right after a heartbeat gave visitors a 500.
 *
 * The real route, maintenance, heartbeat SQL and unstable_cache, over real migrations: what the tick
 * compares is the JSON the cache stored against an object read just now.
 */
describe('subscription tick purges public pages only when their answer changed', () => {
  let db: PGlite; let sql: SqlRunner;
  let stored: Map<string, unknown>; let stale: boolean;
  const globals = globalThis as { __incrementalCache?: unknown };
  const QUEUE_TIMEOUT = 'timeout exceeded when trying to connect';
  const env: Record<string, string> = { VERCEL_ENV: 'production', CREATOR_SUBSCRIPTION_PUBLIC: 'on', VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40),
    TOSS_BILLING_CLIENT_KEY: 'live_ck_fixture', TOSS_BILLING_SECRET_KEY: 'live_sk_fixture', TOSS_BILLING_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    ARK_API_KEY: 'fixture', ARK_ACCESS_KEY: 'fixture', ARK_SECRET_KEY: 'fixture', CRON_SECRET: 'fixture-private-cron',
    OPENAI_API_KEY: 'fixture', PREMIUM_EDITING_ENABLED: 'on', PREMIUM_EDIT_REQUESTS_PER_PERIOD: '30' };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table profiles(id uuid primary key);create table render_jobs(id uuid primary key);
      create table prompt_items(status text,medium text,audience text,price_cents integer,price_krw integer,runtime_seconds integer,engine text);
      insert into prompt_items values('published','video','public',0,6900,25,'seedance-2.5');`);
    for (const file of ['0042_core_creator_subscriptions.sql', '0127_glue_creator_subscriptions.sql', '0043_core_premium_edits.sql',
      '0128_glue_premium_edits.sql', '0044_core_creator_subscription_release.sql', '0129_glue_creator_subscription_release.sql'])
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    sql = { query: async <T>(text: string, params?: unknown[]) => ({ rows: (await db.query<T>(text, params)).rows }), transaction: async fn => fn(sql) };
  });
  beforeEach(async () => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    mock.runner = sql; mock.tag.mockClear(); mock.path.mockClear();
    mock.renewals.mockReset().mockResolvedValue({ processed: 0, pending: 0, hasMore: false, remaining: 0 });
    stored = new Map(); stale = false;
    globals.__incrementalCache = {
      isOnDemandRevalidate: false,
      generateSimpleCacheKey: async (key: string) => key,
      get: async (key: string) => (stored.has(key) ? { isStale: stale, value: stored.get(key) } : null),
      set: async (key: string, value: unknown) => void stored.set(key, value),
    };
    await db.exec('truncate creator_subscription_launch_evidence');
    for (const step of [...SUBSCRIPTION_REQUIRED_STEPS, 'premium_editing']) await sql.query(`insert into creator_subscription_launch_evidence
      (environment,step,plan_version,release_version,terms_version,passed,evidence_digest,implementation_sha,configuration_digest,verified_at)
      values('live',$1,$2,$3,$4,true,$5,$6,$7,now())`, [step, SUBSCRIPTION_PLAN_VERSION, SUBSCRIPTION_RELEASE_VERSION, SUBSCRIPTION_TERMS_VERSION,
      step === 'terms' ? subscriptionTermsDigest() : 'a'.repeat(64), env.VERCEL_GIT_COMMIT_SHA,
      step === 'premium_editing' ? premiumConfigurationDigest(env) : launchConfigurationDigest(env)]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete globals.__incrementalCache;
  });
  afterAll(async () => {
    await db.close();
  });

  /** One request on the server: a stale entry is served while it refreshes in the background. */
  async function inRequest<T>(handle: () => Promise<T>): Promise<T> {
    const store = { route: '/api/creator-subscriptions/tick', isRevalidate: false, incrementalCache: globals.__incrementalCache } as unknown as { pendingRevalidates?: Record<string, Promise<unknown>> };
    const result = await workAsyncStorage.run(store as never, handle);
    await Promise.all(Object.values(store.pendingRevalidates ?? {}));
    return result;
  }
  /** A visitor's page render stores what it read, as the public pages do. */
  const renderPage = () => inRequest(async () => [(await cachedSubscriptionAvailability()).status, await cachedSubscriptionTermsApproved()]);
  const tick = () => inRequest(() => POST(new Request('https://twings.app/api/creator-subscriptions/tick', { method: 'POST', headers: { authorization: 'Bearer fixture-private-cron' } })));
  const lastHeartbeat = async () => (await sql.query<{ at: Date }>(`select verified_at as at from creator_subscription_launch_evidence where step='worker'`)).rows[0]!.at.getTime();
  const lapse = () => sql.query(`update creator_subscription_launch_evidence set verified_at=now()-interval '2 hours' where step='worker'`);

  it.each([['fresh', false], ['past its revalidate time', true]] as const)('purges nothing for a heartbeat while open, with the stored answer %s', async (_name, isStale) => {
    await sql.query(`update creator_subscription_launch_evidence set verified_at=now()-interval '10 minutes' where step='worker'`);
    expect(await renderPage()).toEqual(['open', true]);
    stale = isStale;
    const before = await lastHeartbeat();
    const response = await tick();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, heartbeatRecorded: true });
    expect(await lastHeartbeat()).toBeGreaterThan(before);
    expect(mock.tag).not.toHaveBeenCalled();
    expect(mock.path).not.toHaveBeenCalled();
  });

  it('purges every subscription page on the heartbeat that ends a lapse', async () => {
    await lapse();
    expect(await renderPage()).toEqual(['preparing', true]);
    const response = await tick();
    expect(await response.json()).toMatchObject({ ok: true, heartbeatRecorded: true });
    expect(mock.tag.mock.calls).toEqual([['creator-subscription-status']]);
    expect(mock.path).toHaveBeenCalledTimes(15);
    // revalidateTag is mocked here, so drop what the purge drops: the pages that render next read the reopened answer.
    stored.clear();
    expect(await renderPage()).toEqual(['open', true]);
  });

  it('purges once when a worker that keeps failing lets the heartbeat lapse, and not again while it stays lapsed', async () => {
    expect(await renderPage()).toEqual(['open', true]);
    await lapse();
    mock.renewals.mockRejectedValue(new Error('processor failed'));
    const response = await tick();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'maintenance_failed' });
    expect(mock.tag).toHaveBeenCalledOnce();
    stored.clear();
    expect(await renderPage()).toEqual(['preparing', true]);
    mock.tag.mockClear(); mock.path.mockClear();
    await tick();
    expect(mock.tag).not.toHaveBeenCalled();
    expect(mock.path).not.toHaveBeenCalled();
  });

  it('keeps every page when the database stops answering right after the heartbeat', async () => {
    await lapse();
    expect(await renderPage()).toEqual(['preparing', true]);
    let down = false;
    const failsAfterHeartbeat: SqlRunner = {
      async query<T>(text: string, params?: unknown[]) {
        if (down) throw new Error(QUEUE_TIMEOUT);
        const result = await sql.query<T>(text, params);
        if (text.includes('set verified_at')) down = true;
        return result;
      },
      transaction: fn => sql.transaction(fn),
    };
    mock.runner = failsAfterHeartbeat;
    const response = await tick();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, heartbeatRecorded: true });
    expect(down).toBe(true);
    expect(mock.tag).not.toHaveBeenCalled();
    expect(mock.path).not.toHaveBeenCalled();
  });
});
