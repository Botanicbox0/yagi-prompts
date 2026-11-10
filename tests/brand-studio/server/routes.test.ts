import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioEnv } from '@/lib/brand-studio/env';
import { studioFixture, type StudioFixture } from './helpers';

/** The two machine doors: the provider webhook and the account-lane worker (docs/BRAND-STUDIO-V2.md §7). */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, after: [] as Array<() => unknown> }));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (callback: () => unknown) => mocks.after.push(callback) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));

const webhook = await import('@/app/api/brand-studio/webhook/route');
const lane = await import('@/app/api/brand-studio/lane/route');

let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture();
  mocks.sql = f.sql;
  mocks.after.length = 0;
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  vi.stubEnv('BRAND_STUDIO_WEBHOOK_SECRET', 'hook-secret-fixture');
  vi.stubEnv('BRAND_STUDIO_LANE_SECRET', 'lane-secret-fixture');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const hook = (token: string | null, body: unknown) =>
  webhook.POST(new NextRequest(`https://twings.app/api/brand-studio/webhook${token === null ? '' : `?token=${token}`}`, { method: 'POST', body: JSON.stringify(body) }));
const laneCall = (auth: string | null, body: unknown) =>
  lane.POST(new NextRequest('https://twings.app/api/brand-studio/lane', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) }));

describe('webhook', () => {
  it('builds its own address only with a secret and a public https origin', () => {
    expect(studioEnv({ BRAND_STUDIO_PROVIDER: 'live', NEXT_PUBLIC_APP_URL: 'https://twings.app', BRAND_STUDIO_WEBHOOK_SECRET: 's' }).webhookUrl).toBe('https://twings.app/api/brand-studio/webhook?token=s');
    expect(studioEnv({ BRAND_STUDIO_PROVIDER: 'live', NEXT_PUBLIC_APP_URL: 'http://localhost:3000', BRAND_STUDIO_WEBHOOK_SECRET: 's' }).webhookUrl).toBeNull();
    expect(studioEnv({ BRAND_STUDIO_PROVIDER: 'live', NEXT_PUBLIC_APP_URL: 'https://twings.app' }).webhookUrl).toBeNull();
    expect(studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', NEXT_PUBLIC_APP_URL: 'https://twings.app', BRAND_STUDIO_WEBHOOK_SECRET: 's' }).webhookUrl).toBeNull();
  });

  it('refuses a missing or wrong token', async () => {
    expect((await hook(null, { id: 'pd_1' })).status).toBe(401);
    expect((await hook('wrong', { id: 'pd_1' })).status).toBe(401);
    vi.stubEnv('BRAND_STUDIO_WEBHOOK_SECRET', '');
    expect((await hook('', { id: 'pd_1' })).status).toBe(401);
  });

  it('acknowledges unknown ids without work, and re-checks a known task through the engine (never the body)', async () => {
    expect((await hook('hook-secret-fixture', { id: 'pd_unknown', status: 'succeeded', output: { images: [{ url: 'https://evil.example/x.png' }] } })).status).toBe(200);
    expect(mocks.after).toHaveLength(0);
    const job = (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, started_at)
          values ($1, $2, 'req_webhook_fixture', 'image', 'running', 'sunra_api', 'seedream-5-pro', now()) returning id`,
        [f.orgId, f.ids.owner],
      )
    ).rows[0]!;
    await f.sql.query("insert into brand_studio_outputs (job_id, organization_id, idx, kind, provider_task_id) values ($1, $2, 0, 'image', 'pd_known')", [job.id, f.orgId]);
    const response = await hook('hook-secret-fixture', { id: 'pd_known', status: 'succeeded', output: { images: [{ url: 'https://evil.example/x.png' }] } });
    expect(response.status).toBe(200);
    expect(mocks.after).toHaveLength(1);
    // Nothing from the body was stored.
    expect((await f.sql.query('select work from brand_studio_jobs where id = $1', [job.id])).rows[0]).toEqual({ work: {} });
  });
});

describe('lane door', () => {
  it('needs the bearer secret', async () => {
    expect((await laneCall(null, { op: 'heartbeat' })).status).toBe(401);
    expect((await laneCall('Bearer nope', { op: 'heartbeat' })).status).toBe(401);
    vi.stubEnv('BRAND_STUDIO_LANE_SECRET', '');
    expect((await laneCall('Bearer ', { op: 'heartbeat' })).status).toBe(401);
  });

  it('records a heartbeat, claims nothing when nothing waits, and validates its inputs', async () => {
    const beat = await laneCall('Bearer lane-secret-fixture', { op: 'heartbeat', info: { host: 'ws' } });
    expect(beat.status).toBe(200);
    expect((await f.sql.query("select lane from brand_studio_lanes where seen_at is not null")).rows).toEqual([{ lane: 'sunra_mcp' }]);
    expect(await (await laneCall('Bearer lane-secret-fixture', { op: 'claim' })).json()).toEqual({ ok: true, jobs: [] });
    expect((await laneCall('Bearer lane-secret-fixture', { op: 'complete', jobId: 'nope', outputs: [] })).status).toBe(400);
    expect((await laneCall('Bearer lane-secret-fixture', { op: 'fail', jobId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await laneCall('Bearer lane-secret-fixture', { op: 'explode' })).status).toBe(400);
  });
});
